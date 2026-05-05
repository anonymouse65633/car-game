/**
 * SaveManager.js
 * Versioned localStorage wrapper — the single read/write gateway for all
 * persistent game data in Horizon City.
 *
 * Responsibilities:
 *  - Own the save schema and current SCHEMA_VERSION constant
 *  - Provide typed section accessors (player, cars, accolades, mastery,
 *    playlist, inventory, settings) so callers never touch raw JSON
 *  - Detect schema version mismatches and run sequential migrations
 *  - Debounce writes (default 500 ms) so rapid XP ticks don't thrash
 *    localStorage — a single flush timer covers all dirty sections
 *  - Expose save(), load(), reset(), exportJSON(), importJSON()
 *  - Fire 'save', 'load', 'reset', 'migrate' events for debugging / HUD
 *  - Guard against storage quota errors and parse failures with graceful
 *    fallback to in-memory state (game still runs, user warned once)
 *
 * Usage:
 *   const save = new SaveManager();
 *   save.load();                         // call once at game start
 *
 *   save.player.addXP(500);              // mutate through section API
 *   save.inventory.addCredits(3000);
 *   // SaveManager auto-saves after DEBOUNCE_MS
 *
 *   save.on('levelUp', (level) => …);    // listen for cross-system events
 *   save.exportJSON();                   // returns JSON string for backup
 *   save.importJSON(jsonString);         // restores from backup, validates
 */

/* ══════════════════════════════════════════════════════════════════════════
   SCHEMA
   Bump SCHEMA_VERSION whenever the shape of DEFAULT_SAVE changes in a way
   that old saves won't understand. Add a migration function to MIGRATIONS.
══════════════════════════════════════════════════════════════════════════ */

const SCHEMA_VERSION = 1;

/** Canonical empty save for new players. */
const DEFAULT_SAVE = {
  _version: SCHEMA_VERSION,
  _createdAt: null,    // ISO timestamp, set on first save

  // ── Player identity & level ──────────────────────────────────────────
  player: {
    name:          'Driver',
    pronouns:      'they/them',
    level:         1,
    xp:            0,
    xpToNextLevel: 5000,
    totalXP:       0,
    prestigeLevel: 0,    // > 0 after level 200+

    // Active XP boost item
    xpBoostActive:   false,
    xpBoostExpiresAt: null,   // epoch ms

    // Streak / daily state
    lastLoginDate:      null,   // 'YYYY-MM-DD' UTC
    loginStreakDays:    0,
    firstEventDoneToday: false,

    // Unlocks gated by level
    unlockedFeatures: [],       // e.g. ['championship', 's1_races', 'showcase']
  },

  // ── Economy ──────────────────────────────────────────────────────────
  inventory: {
    credits:       50000,    // starter credits for new players
    wheelspins:    0,        // queued standard wheelspins
    superWheelspins: 0,      // queued super wheelspins

    // Owned cars: { id, purchasedAt, upgrades, tuning, livery, masteryPoints, masteryUnlocked[] }
    cars:          [],
    activeCarId:   null,

    // Owned clothing items: { id, equippedSlot | null }
    clothing:      [],

    // Consumables: { type: 'xpBoost', expiresAt, grantedAt }
    consumables:   [],

    // Exclusive cosmetics (livery stickers, unique paints) won from wheelspins / accolades
    cosmetics:     [],
  },

  // ── Accolades ────────────────────────────────────────────────────────
  accolades: {
    // Map of accoladeId → { tier: 'none'|'bronze'|'silver'|'gold', progress: number, claimedTiers: [] }
    progress: {},
  },

  // ── Car Mastery ──────────────────────────────────────────────────────
  mastery: {
    // Map of carId → { mp: number, unlockedNodes: string[], appliedEffects: {} }
    cars: {},
  },

  // ── Festival Playlist ────────────────────────────────────────────────
  playlist: {
    seasonIndex:        0,      // increments every 4 weeks from epoch
    weekIndex:          0,      // increments every week from epoch
    weeklyCompleted:    [],     // accolade/challenge IDs completed this week
    seasonalCompleted:  [],     // event IDs completed this season
    seasonTiersClaimed: [],     // [1,2,3,4] — which tiers have been claimed

    // Exclusive seasonal cars earned (stored here to flag as earnable, not in inventory yet)
    seasonCarsEarned:   [],
  },

  // ── Barn Finds ───────────────────────────────────────────────────────
  barnFinds: {
    discovered:  [],   // barnFindId[]
    restored:    [],   // barnFindId[]
  },

  // ── Map / World ──────────────────────────────────────────────────────
  world: {
    discoveredLandmarks: [],
    collectedBoards:     [],
    fastTravelPoints:    [],
  },

  // ── Settings (mirrors SettingsStore but persisted here) ──────────────
  settings: {
    units:              'kmh',
    difficulty:         'novice',
    transmission:       'automatic',
    minimap_rotation:   'car',   // 'car' | 'north'

    assist_abs:         true,
    assist_tc:          true,
    assist_sc:          true,
    assist_rewind:      true,
    suggested_line:     'full',  // 'off' | 'braking' | 'full'

    graphics_shadow:    'medium',
    graphics_draw:      'high',
    graphics_aa:        'fxaa',
    graphics_ao:        true,
    graphics_bloom:     'low',
    graphics_blur:      'low',
    graphics_speedlines: true,
    graphics_chroma:    true,

    audio_master:       80,
    audio_engine:       80,
    audio_music:        60,
    audio_ui:           70,
    audio_world:        70,
    audio_radio:        true,

    accessibility_scale:       '100%',
    accessibility_colourblind: 'off',
    accessibility_highcontrast: false,
    accessibility_reducemotion: false,
    accessibility_screenflash:  true,

    camera:    'chase',
    camera_shake: 'low',
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   MIGRATIONS
   Each key is a schema version that the migration upgrades FROM.
   e.g. MIGRATIONS[1] upgrades a v1 save to v2.
══════════════════════════════════════════════════════════════════════════ */

const MIGRATIONS = {
  // Example: when SCHEMA_VERSION becomes 2, add the upgrade path here:
  // 1: (save) => { save.player.newField = 'default'; save._version = 2; return save; },
};

/* ══════════════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY    = 'horizonCity_save_v1';
const DEBOUNCE_MS    = 500;
const QUOTA_WARN_KEY = 'horizonCity_quotaWarned';

/* ══════════════════════════════════════════════════════════════════════════
   SaveManager
══════════════════════════════════════════════════════════════════════════ */

export class SaveManager {
  constructor() {
    /** Live in-memory copy of the full save object. */
    this._data = null;

    /** Debounce timer handle */
    this._saveTimer = null;

    /** Whether localStorage is usable (false if quota error or unavailable) */
    this._storageAvailable = this._checkStorageAvailable();

    /** Event listeners: Map<string, Function[]> */
    this._listeners = new Map();

    // Section proxy cache — built lazily, exposed as public properties
    this._sectionCache = {};
  }

  /* ─────────────────────────── lifecycle ──────────────────────────────── */

  /**
   * Load from localStorage (or initialise as new game).
   * Must be called once at game start before any section is accessed.
   * @returns {boolean} true if an existing save was found, false if new game
   */
  load() {
    let existingSave = false;

    if (this._storageAvailable) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          this._data   = this._migrate(parsed);
          existingSave = true;
          this._emit('load', { version: this._data._version });
        }
      } catch (err) {
        console.warn('[SaveManager] Failed to parse save — resetting.', err);
      }
    }

    if (!this._data) {
      this._data = this._freshSave();
      this._emit('load', { version: SCHEMA_VERSION, newGame: true });
    }

    // Invalidate section cache after loading
    this._sectionCache = {};

    return existingSave;
  }

  /**
   * Flush in-memory state to localStorage immediately.
   * Usually called by the debounced path — but exposed for forced saves
   * (e.g., before page unload).
   */
  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;

    if (!this._data) return;
    if (!this._storageAvailable) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
      this._emit('save', { timestamp: Date.now() });
    } catch (err) {
      if (err.name === 'QuotaExceededError') {
        this._handleQuotaError();
      } else {
        console.error('[SaveManager] Save failed:', err);
      }
    }
  }

  /**
   * Queue a debounced save. Call this after any mutation.
   * Multiple calls within DEBOUNCE_MS collapse to a single write.
   */
  markDirty() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), DEBOUNCE_MS);
  }

  /**
   * Wipe all progress and reset to new-game state.
   * @param {boolean} keepSettings - if true, preserve settings section
   */
  reset(keepSettings = false) {
    const preserved = keepSettings && this._data?.settings
      ? { ...this._data.settings }
      : null;

    this._data = this._freshSave();
    if (preserved) this._data.settings = preserved;

    this._sectionCache = {};

    if (this._storageAvailable) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    }

    this._emit('reset', { keepSettings });
    this.save();
  }

  /* ─────────────────────────── import / export ────────────────────────── */

  /**
   * Export the current save as a JSON string (for player backup).
   * @returns {string}
   */
  exportJSON() {
    if (!this._data) return '{}';
    return JSON.stringify(this._data, null, 2);
  }

  /**
   * Restore save from a JSON string.
   * Validates schema version and runs migrations if needed.
   * @param {string} json
   * @throws {Error} if the JSON is invalid or clearly not a valid save
   */
  importJSON(json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (_) {
      throw new Error('Invalid JSON — could not parse backup.');
    }

    if (!parsed || typeof parsed !== 'object' || typeof parsed._version !== 'number') {
      throw new Error('This does not look like a Horizon City save file.');
    }

    this._data       = this._migrate(parsed);
    this._sectionCache = {};
    this.save();
    this._emit('load', { version: this._data._version, imported: true });
  }

  /* ─────────────────────────── section accessors ──────────────────────── */

  /*
   * Each section is a thin proxy that:
   *   1. Reads from / writes to this._data.<section>
   *   2. Calls this.markDirty() on any mutation
   *
   * They are created lazily and cached so callers can hold a reference:
   *   const { player } = save;   // reference is stable across saves
   */

  /** @returns {PlayerSection} */
  get player()    { return this._section('player');    }
  /** @returns {InventorySection} */
  get inventory() { return this._section('inventory'); }
  /** @returns {AccoladeSection} */
  get accolades() { return this._section('accolades'); }
  /** @returns {MasterySection} */
  get mastery()   { return this._section('mastery');   }
  /** @returns {PlaylistSection} */
  get playlist()  { return this._section('playlist');  }
  /** @returns {BarnFindSection} */
  get barnFinds() { return this._section('barnFinds'); }
  /** @returns {WorldSection} */
  get world()     { return this._section('world');     }
  /** @returns {SettingsSection} */
  get settings()  { return this._section('settings');  }

  /** Raw read of any key within a section (no proxy overhead). */
  get(section, key) {
    return this._data?.[section]?.[key];
  }

  /** Raw write of any key within a section + markDirty. */
  set(section, key, value) {
    if (!this._data) return;
    if (!this._data[section]) this._data[section] = {};
    this._data[section][key] = value;
    this.markDirty();
  }

  /* ─────────────────────────── event bus ─────────────────────────────── */

  /**
   * @param {string}   event  - 'save' | 'load' | 'reset' | 'migrate' | any custom
   * @param {Function} cb
   */
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(cb);
    return this;
  }

  off(event, cb) {
    const arr = this._listeners.get(event);
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i !== -1) arr.splice(i, 1);
  }

  _emit(event, data) {
    (this._listeners.get(event) ?? []).forEach(cb => {
      try { cb(data); } catch (e) { console.error(`[SaveManager] ${event} listener threw:`, e); }
    });
  }

  /* ─────────────────────────── internals ──────────────────────────────── */

  _freshSave() {
    const save        = this._deepClone(DEFAULT_SAVE);
    save._createdAt   = new Date().toISOString();
    save._version     = SCHEMA_VERSION;
    return save;
  }

  /**
   * Run sequential migrations until save._version === SCHEMA_VERSION.
   * Mutates and returns the save object.
   */
  _migrate(save) {
    let v = save._version ?? 0;

    if (v === SCHEMA_VERSION) return save;

    if (v > SCHEMA_VERSION) {
      console.warn(`[SaveManager] Save is newer than this game version (${v} > ${SCHEMA_VERSION}). Proceeding carefully.`);
      return this._mergeWithDefaults(save);
    }

    while (v < SCHEMA_VERSION) {
      const migrateFn = MIGRATIONS[v];
      if (typeof migrateFn === 'function') {
        save = migrateFn(save);
        this._emit('migrate', { from: v, to: save._version });
        v = save._version;
      } else {
        // No migration defined — merge with defaults to fill new fields
        console.warn(`[SaveManager] No migration for v${v} → v${v + 1}. Merging with defaults.`);
        save = this._mergeWithDefaults(save);
        save._version = SCHEMA_VERSION;
        v = SCHEMA_VERSION;
      }
    }

    return save;
  }

  /**
   * Deep-merge a save with DEFAULT_SAVE so new fields from a schema bump
   * are present even on old saves that don't have them.
   * Existing values are always preserved.
   */
  _mergeWithDefaults(save) {
    return this._deepMerge(this._deepClone(DEFAULT_SAVE), save);
  }

  _deepMerge(target, source) {
    for (const key of Object.keys(source)) {
      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  _deepClone(obj) {
    // structuredClone is available in all modern browsers (2022+)
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  }

  _checkStorageAvailable() {
    try {
      const test = '__hc_test__';
      localStorage.setItem(test, '1');
      localStorage.removeItem(test);
      return true;
    } catch (_) {
      return false;
    }
  }

  _handleQuotaError() {
    // Warn the player once per session
    if (!sessionStorage.getItem(QUOTA_WARN_KEY)) {
      sessionStorage.setItem(QUOTA_WARN_KEY, '1');
      console.error('[SaveManager] localStorage quota exceeded — progress may not save.');
      this._emit('quotaError', {});
    }
  }

  /** Build or return cached section proxy for `name`. */
  _section(name) {
    if (!this._sectionCache[name]) {
      this._sectionCache[name] = this._makeSection(name);
    }
    return this._sectionCache[name];
  }

  /**
   * Returns a Proxy that:
   *  - reads go straight to this._data[section]
   *  - writes go to this._data[section] AND call markDirty()
   *
   * Also exposes higher-level helper methods specific to each section.
   */
  _makeSection(name) {
    const mgr = this;

    const helpers = SECTION_HELPERS[name] ?? {};

    // Build a plain object that proxies the data section
    const proxy = new Proxy(Object.create(null), {
      get(_, prop) {
        // Prefer named helpers first so callers get addXP() etc.
        if (prop in helpers) {
          return helpers[prop].bind({ mgr, name });
        }
        const val = mgr._data?.[name]?.[prop];
        // Bind functions that live directly on the section data
        if (typeof val === 'function') return val.bind(mgr._data[name]);
        return val;
      },
      set(_, prop, value) {
        if (!mgr._data) return false;
        if (!mgr._data[name]) mgr._data[name] = {};
        mgr._data[name][prop] = value;
        mgr.markDirty();
        return true;
      },
      has(_, prop) {
        return prop in (mgr._data?.[name] ?? {}) || prop in helpers;
      },
      ownKeys(_) {
        return Object.keys(mgr._data?.[name] ?? {});
      },
      getOwnPropertyDescriptor(_, prop) {
        const v = mgr._data?.[name]?.[prop];
        if (v !== undefined) return { value: v, writable: true, enumerable: true, configurable: true };
      },
    });

    return proxy;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SECTION HELPERS
   High-level mutation methods attached to each section proxy.
   `this` inside each helper = { mgr: SaveManager, name: string }
══════════════════════════════════════════════════════════════════════════ */

const SECTION_HELPERS = {

  /* ── player ────────────────────────────────────────────────────────── */
  player: {
    /** Return a shallow snapshot of the player section (safe to read). */
    snapshot() {
      return { ...this.mgr._data.player };
    },

    /** Directly set player name. */
    setName(name) {
      this.mgr._data.player.name = String(name).trim().slice(0, 32) || 'Driver';
      this.mgr.markDirty();
    },

    /** Mark an unlock as granted. */
    grantUnlock(feature) {
      const arr = this.mgr._data.player.unlockedFeatures;
      if (!arr.includes(feature)) {
        arr.push(feature);
        this.mgr.markDirty();
      }
    },

    hasUnlock(feature) {
      return this.mgr._data.player.unlockedFeatures.includes(feature);
    },

    /** Activate an XP boost for `durationMs` milliseconds. */
    activateXPBoost(durationMs) {
      const p = this.mgr._data.player;
      p.xpBoostActive    = true;
      p.xpBoostExpiresAt = Date.now() + durationMs;
      this.mgr.markDirty();
    },

    /** Check and expire boost if time has passed. Returns whether boost is active. */
    checkXPBoost() {
      const p = this.mgr._data.player;
      if (!p.xpBoostActive) return false;
      if (Date.now() >= (p.xpBoostExpiresAt ?? 0)) {
        p.xpBoostActive    = false;
        p.xpBoostExpiresAt = null;
        this.mgr.markDirty();
        return false;
      }
      return true;
    },
  },

  /* ── inventory ─────────────────────────────────────────────────────── */
  inventory: {
    snapshot() {
      return { ...this.mgr._data.inventory };
    },

    /** @returns {number} current credit balance */
    getCredits() {
      return this.mgr._data.inventory.credits ?? 0;
    },

    /** Add credits (positive) or deduct (negative). Returns new balance. */
    addCredits(amount) {
      const inv   = this.mgr._data.inventory;
      inv.credits = Math.max(0, (inv.credits ?? 0) + amount);
      this.mgr.markDirty();
      return inv.credits;
    },

    /** Returns false and does NOT deduct if insufficient funds. */
    spendCredits(amount) {
      const inv = this.mgr._data.inventory;
      if ((inv.credits ?? 0) < amount) return false;
      inv.credits -= amount;
      this.mgr.markDirty();
      return true;
    },

    /** Add one or more standard wheelspins to the queue. */
    addWheelspin(count = 1) {
      this.mgr._data.inventory.wheelspins =
        (this.mgr._data.inventory.wheelspins ?? 0) + count;
      this.mgr.markDirty();
    },

    consumeWheelspin() {
      const inv = this.mgr._data.inventory;
      if ((inv.wheelspins ?? 0) < 1) return false;
      inv.wheelspins--;
      this.mgr.markDirty();
      return true;
    },

    addSuperWheelspin(count = 1) {
      this.mgr._data.inventory.superWheelspins =
        (this.mgr._data.inventory.superWheelspins ?? 0) + count;
      this.mgr.markDirty();
    },

    consumeSuperWheelspin() {
      const inv = this.mgr._data.inventory;
      if ((inv.superWheelspins ?? 0) < 1) return false;
      inv.superWheelspins--;
      this.mgr.markDirty();
      return true;
    },

    /** Check if the player owns a car by its ID. */
    ownsCar(carId) {
      return this.mgr._data.inventory.cars.some(c => c.id === carId);
    },

    /**
     * Add a car to the garage.
     * @param {object} carData - { id, name, class, pr, shopPrice, … }
     */
    addCar(carData) {
      const inv = this.mgr._data.inventory;
      if (inv.cars.some(c => c.id === carData.id)) return false;  // already owned
      inv.cars.push({
        id:             carData.id,
        name:           carData.name,
        class:          carData.class,
        pr:             carData.pr,
        shopPrice:      carData.shopPrice ?? 0,
        purchasedAt:    new Date().toISOString(),
        upgrades:       {},
        tuning:         {},
        livery:         null,
        isFavourite:    false,
        isUnrestored:   carData.isUnrestored ?? false,
        masteryPoints:  0,
      });
      if (!inv.activeCarId) inv.activeCarId = carData.id;
      this.mgr.markDirty();
      return true;
    },

    removeCar(carId) {
      const inv = this.mgr._data.inventory;
      inv.cars  = inv.cars.filter(c => c.id !== carId);
      if (inv.activeCarId === carId) {
        inv.activeCarId = inv.cars[0]?.id ?? null;
      }
      this.mgr.markDirty();
    },

    getActiveCar() {
      const inv = this.mgr._data.inventory;
      return inv.cars.find(c => c.id === inv.activeCarId) ?? null;
    },

    setActiveCar(carId) {
      if (!this.ownsCar(carId)) return false;
      this.mgr._data.inventory.activeCarId = carId;
      this.mgr.markDirty();
      return true;
    },

    getCarById(carId) {
      return this.mgr._data.inventory.cars.find(c => c.id === carId) ?? null;
    },

    addClothingItem(itemId) {
      const inv = this.mgr._data.inventory;
      if (!inv.clothing.some(c => c.id === itemId)) {
        inv.clothing.push({ id: itemId, equippedSlot: null });
        this.mgr.markDirty();
      }
    },

    ownsClothing(itemId) {
      return this.mgr._data.inventory.clothing.some(c => c.id === itemId);
    },

    addCosmetic(cosmeticId) {
      const inv = this.mgr._data.inventory;
      if (!inv.cosmetics.includes(cosmeticId)) {
        inv.cosmetics.push(cosmeticId);
        this.mgr.markDirty();
      }
    },

    /**
     * Add a prize from a Wheelspin.
     * Handles: credits, car, clothing, cosmetic, xpBoost, superWheelspin.
     * @param {object} prize - prize object from WheelspinUI / prize pool
     */
    addPrize(prize) {
      switch (prize.type) {
        case 'credits':
          this.addCredits(prize.amount ?? 0);
          break;
        case 'car':
          this.addCar(prize);
          break;
        case 'clothing':
          this.addClothingItem(prize.id);
          break;
        case 'cosmetic':
          this.addCosmetic(prize.id);
          break;
        case 'xpBoost':
          this.mgr.player.activateXPBoost(30 * 60 * 1000);   // 30 minutes
          break;
        case 'superWheelspin':
          this.addSuperWheelspin(1);
          break;
        default:
          console.warn('[SaveManager] Unknown prize type:', prize.type);
      }
    },
  },

  /* ── accolades ─────────────────────────────────────────────────────── */
  accolades: {
    snapshot() {
      return { ...this.mgr._data.accolades };
    },

    getProgress(accoladeId) {
      return this.mgr._data.accolades.progress[accoladeId] ?? {
        tier: 'none', progress: 0, claimedTiers: [],
      };
    },

    setProgress(accoladeId, progress, tier, claimedTiers) {
      this.mgr._data.accolades.progress[accoladeId] = { progress, tier, claimedTiers };
      this.mgr.markDirty();
    },
  },

  /* ── mastery ───────────────────────────────────────────────────────── */
  mastery: {
    snapshot() {
      return { ...this.mgr._data.mastery };
    },

    getCarMastery(carId) {
      return this.mgr._data.mastery.cars[carId] ?? {
        mp: 0, unlockedNodes: [], appliedEffects: {},
      };
    },

    setCarMastery(carId, state) {
      this.mgr._data.mastery.cars[carId] = state;
      this.mgr.markDirty();
    },

    addMP(carId, amount) {
      const mastery = this.mgr._data.mastery;
      if (!mastery.cars[carId]) {
        mastery.cars[carId] = { mp: 0, unlockedNodes: [], appliedEffects: {} };
      }
      mastery.cars[carId].mp = (mastery.cars[carId].mp ?? 0) + amount;
      this.mgr.markDirty();
      return mastery.cars[carId].mp;
    },

    unlockNode(carId, nodeId) {
      const car = this.mgr._data.mastery.cars[carId];
      if (!car) return false;
      if (!car.unlockedNodes.includes(nodeId)) {
        car.unlockedNodes.push(nodeId);
        this.mgr.markDirty();
        return true;
      }
      return false;
    },
  },

  /* ── playlist ──────────────────────────────────────────────────────── */
  playlist: {
    snapshot() {
      return { ...this.mgr._data.playlist };
    },

    completeWeeklyChallenge(challengeId) {
      const pl = this.mgr._data.playlist;
      if (!pl.weeklyCompleted.includes(challengeId)) {
        pl.weeklyCompleted.push(challengeId);
        this.mgr.markDirty();
      }
    },

    completeSeasonalEvent(eventId) {
      const pl = this.mgr._data.playlist;
      if (!pl.seasonalCompleted.includes(eventId)) {
        pl.seasonalCompleted.push(eventId);
        this.mgr.markDirty();
      }
    },

    claimSeasonTier(tier) {
      const pl = this.mgr._data.playlist;
      if (!pl.seasonTiersClaimed.includes(tier)) {
        pl.seasonTiersClaimed.push(tier);
        this.mgr.markDirty();
      }
    },

    /** Called when weekly reset fires — clears weekly progress. */
    resetWeek(newWeekIndex) {
      const pl = this.mgr._data.playlist;
      pl.weekIndex       = newWeekIndex;
      pl.weeklyCompleted = [];
      this.mgr.markDirty();
    },

    /** Called when season rolls over — clears seasonal progress. */
    resetSeason(newSeasonIndex) {
      const pl = this.mgr._data.playlist;
      pl.seasonIndex        = newSeasonIndex;
      pl.weekIndex          = 0;
      pl.weeklyCompleted    = [];
      pl.seasonalCompleted  = [];
      pl.seasonTiersClaimed = [];
      this.mgr.markDirty();
    },
  },

  /* ── barnFinds ─────────────────────────────────────────────────────── */
  barnFinds: {
    discover(barnFindId) {
      const bf = this.mgr._data.barnFinds;
      if (!bf.discovered.includes(barnFindId)) {
        bf.discovered.push(barnFindId);
        this.mgr.markDirty();
        return true;
      }
      return false;
    },

    restore(barnFindId) {
      const bf = this.mgr._data.barnFinds;
      if (!bf.restored.includes(barnFindId)) {
        bf.restored.push(barnFindId);
        this.mgr.markDirty();
        return true;
      }
      return false;
    },

    isDiscovered(barnFindId) {
      return this.mgr._data.barnFinds.discovered.includes(barnFindId);
    },

    isRestored(barnFindId) {
      return this.mgr._data.barnFinds.restored.includes(barnFindId);
    },
  },

  /* ── world ─────────────────────────────────────────────────────────── */
  world: {
    discoverLandmark(landmarkId) {
      const w = this.mgr._data.world;
      if (!w.discoveredLandmarks.includes(landmarkId)) {
        w.discoveredLandmarks.push(landmarkId);
        this.mgr.markDirty();
        return true;
      }
      return false;
    },

    collectBoard(boardId) {
      const w = this.mgr._data.world;
      if (!w.collectedBoards.includes(boardId)) {
        w.collectedBoards.push(boardId);
        this.mgr.markDirty();
        return true;
      }
      return false;
    },

    isBoardCollected(boardId) {
      return this.mgr._data.world.collectedBoards.includes(boardId);
    },
  },

  /* ── settings ──────────────────────────────────────────────────────── */
  settings: {
    snapshot() {
      return { ...this.mgr._data.settings };
    },

    /** @param {string} key  @param {*} value */
    set(key, value) {
      if (!(key in DEFAULT_SAVE.settings)) {
        console.warn(`[SaveManager] Unknown settings key: "${key}"`);
      }
      this.mgr._data.settings[key] = value;
      this.mgr.markDirty();
    },

    /** @param {string} key  @param {*} fallback */
    get(key, fallback) {
      const val = this.mgr._data?.settings?.[key];
      return val !== undefined ? val : fallback;
    },
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   SINGLETON EXPORT
   Most systems import the same instance so they all read/write the same
   in-memory copy.

   import { saveManager } from './SaveManager.js';
   saveManager.load();   // once in main.js
══════════════════════════════════════════════════════════════════════════ */

export const saveManager = new SaveManager();

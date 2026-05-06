/**
 * BarnFindManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages all 5 hidden Barn Find garages in Horizon City.
 *
 * Responsibilities:
 *  - Barn Find catalogue (location, lore, car, NPC hint, restoration cost)
 *  - Proximity detection — glow trigger at 10 m, interaction prompt at 4 m
 *  - Discovery flow  → save state, fanfare toast, accolade report
 *  - Restoration flow → charge CR, mark car as restored, add to garage
 *  - NPC hint system — unlocks one vague hint per find, in sequence
 *  - UI query helpers for the Phone Menu "Barn Finds" tab
 *
 * Dependencies (injected via constructor):
 *  - saveManager        — persist discovered / restored state
 *  - notificationSystem — toast + fanfare
 *  - accoladeManager    — report('barn_found', 1), report('all_barns_found', 1)
 *  - progressionManager — addXP()
 *
 * Economy functions (imported directly from Economy.js):
 *  - getBalance, spend, canAfford
 *
 * Usage:
 *  const barnFindManager = new BarnFindManager({ saveManager, progressionManager, accoladeManager, notificationSystem });
 *  barnFindManager.tick(playerPos);          // called every frame from game loop
 *  barnFindManager.tryInteract(playerPos);   // called on player pressing F / X
 *  barnFindManager.tryRestore(barnId);       // called from Garage / Parts Shop UI
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { getBalance, spend, canAfford } from '../shops/Economy.js';
import { audioManager }                 from '../engine/audio.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const GLOW_RADIUS_M     = 10;   // barn door starts glowing
const INTERACT_RADIUS_M = 4;    // interaction prompt appears
const DISCOVERY_XP      = 1500; // XP awarded on first discovery

// ─── Barn Find Catalogue ──────────────────────────────────────────────────────
//
// world positions are in Three.js scene units (1 unit = 1 metre).
// Each barn is on foot-only terrain — no road directly to the door.
//
// Car stat block uses the same schema as CarDatabase:
//   { make, model, year, class, pi, top_speed_kmh, acceleration, handling, braking }

const BARN_CATALOGUE = [
  // ─────────────────────────────────────────────────────────
  // Barn 1 — Industrial Zone (District 3)
  // Hidden behind the container yard, down a narrow service alley
  // ─────────────────────────────────────────────────────────
  {
    id: 'barn_001',
    name: 'The Forgotten Racer',
    district: 3,
    districtName: 'Industrial Zone',
    worldPos: { x: -680, y: 0, z: 420 },   // behind container yard, east end
    restorationCost: 45000,

    // NPC who gives the hint — name + dialogue line
    npc: {
      id: 'npc_dock_worker_miro',
      name: 'Miro',
      dialogue: 'Worked here fifteen years. There\'s a locked-up unit behind the crane yard — old racing plates on the door. Never seen anyone open it.',
    },

    // The car inside
    car: {
      id: 'car_bf_001',
      make: 'Lancia',
      model: 'Stratos HF',
      year: 1974,
      class: 'B',
      pi: 580,
      top_speed_kmh: 230,
      acceleration: 7,
      handling: 8,
      braking: 7,
      unrestoredAppearance: 'rust_panel_lancia_stratos',
      restoredAppearance: 'default_lancia_stratos',
    },

    // Lore card shown in the Barn Find details screen
    lore: {
      title: 'A Rally Legend, Quietly Rusting',
      body: 'Horizon City Docks records show this Lancia Stratos arrived by freight in 1981, consigned to a driver named "E. Carver" — no further address. Carver\'s name appears in three local race programme booklets between 1981 and 1983. After that, nothing. The car was never collected. Dock management eventually moved it to long-term storage and forgot about it entirely. The fuel still smells like race day.',
    },

    // Hint unlock condition — which barn must be found first (null = always available)
    requiresBarnFirst: null,
    hintUnlocked: false,
    discovered: false,
    restored: false,
  },

  // ─────────────────────────────────────────────────────────
  // Barn 2 — Suburbs & Hillside (District 4)
  // Tucked into a residential side-street behind a row of garages
  // ─────────────────────────────────────────────────────────
  {
    id: 'barn_002',
    name: 'The Hillside Secret',
    district: 4,
    districtName: 'Suburbs & Hillside',
    worldPos: { x: 320, y: 85, z: -560 },  // elevated hillside lane
    restorationCost: 80000,

    npc: {
      id: 'npc_gardener_priya',
      name: 'Priya',
      dialogue: 'The old Nakamura place up the hill — they sold it years ago but left a car behind. I\'ve seen it through the hedge. Covered in dust. Beautiful shape, though.',
    },

    car: {
      id: 'car_bf_002',
      make: 'Toyota',
      model: '2000GT',
      year: 1967,
      class: 'C',
      pi: 510,
      top_speed_kmh: 215,
      acceleration: 6,
      handling: 7,
      braking: 6,
      unrestoredAppearance: 'rust_panel_toyota_2000gt',
      restoredAppearance: 'default_toyota_2000gt',
    },

    lore: {
      title: 'The Nakamura House',
      body: 'The 2000GT was a retirement gift — Kenji Nakamura bought it the year the factory closed production, swearing he\'d restore it "properly" when time allowed. He spent thirty years as the city\'s most respected driving instructor, never finding that time. His daughter sold the property in 2018. She said her father asked only one thing: that the car go to someone who would drive it. She didn\'t know it was still there.',
    },

    requiresBarnFirst: null,
    hintUnlocked: false,
    discovered: false,
    restored: false,
  },

  // ─────────────────────────────────────────────────────────
  // Barn 3 — Waterfront & Harbor (District 2)
  // Beneath the Grand Bridge access road, in a maintenance bay
  // ─────────────────────────────────────────────────────────
  {
    id: 'barn_003',
    name: 'Under the Bridge',
    district: 2,
    districtName: 'Waterfront & Harbor',
    worldPos: { x: -120, y: -8, z: 890 },  // under bridge strut, maintenance bay
    restorationCost: 150000,

    npc: {
      id: 'npc_harbourmaster_felix',
      name: 'Felix',
      dialogue: 'Bridge maintenance crew found a car locked up in the old service bay years back. Nobody claimed it. They just... bricked up the access, mostly. There\'s still a gap on the east side if you look.',
    },

    car: {
      id: 'car_bf_003',
      make: 'Ferrari',
      model: '250 GTO',
      year: 1962,
      class: 'A',
      pi: 720,
      top_speed_kmh: 280,
      acceleration: 8,
      handling: 8,
      braking: 7,
      unrestoredAppearance: 'rust_panel_ferrari_250gto',
      restoredAppearance: 'default_ferrari_250gto',
    },

    lore: {
      title: 'Chassis 3223 GT',
      body: 'Motorsport historians have argued for decades about whether a factory 250 GTO made it to this part of the world. Here is your answer. Race logbooks in the glovebox record entries at six now-defunct hillclimb events between 1963 and 1968, signed by a driver identified only as "D.V." The car\'s provenance after that is a mystery the bridge\'s concrete has kept very well indeed.',
    },

    requiresBarnFirst: 'barn_001',  // NPC only hints after first barn found
    hintUnlocked: false,
    discovered: false,
    restored: false,
  },

  // ─────────────────────────────────────────────────────────
  // Barn 4 — Outskirts & Highway Ring (District 6)
  // A derelict petrol station forecourt, around the back
  // ─────────────────────────────────────────────────────────
  {
    id: 'barn_004',
    name: 'The Last Stop',
    district: 6,
    districtName: 'Outskirts & Highway Ring',
    worldPos: { x: 1100, y: 2, z: 680 },   // disused petrol station, north ring
    restorationCost: 60000,

    npc: {
      id: 'npc_roadside_vendor_sal',
      name: 'Sal',
      dialogue: 'That old Shell station on the ring road — closed in \'02. Something big under a tarp out back. Nobody\'s touched it. The owner\'s long gone. Might be worth a look.',
    },

    car: {
      id: 'car_bf_004',
      make: 'Dodge',
      model: 'Charger R/T',
      year: 1969,
      class: 'B',
      pi: 610,
      top_speed_kmh: 250,
      acceleration: 7,
      handling: 6,
      braking: 6,
      unrestoredAppearance: 'rust_panel_dodge_charger_69',
      restoredAppearance: 'default_dodge_charger_69',
    },

    lore: {
      title: 'End of the Road',
      body: 'The petrol station\'s last owner, Roy Hess, bought the Charger in 1987 for what he called "emergency getaway money" — he planned to sell it if things got bad. Things didn\'t get bad; they just got slow. He ran the pumps solo for fifteen years, using the Charger as his office chair while he read paperbacks. When the lease expired he drove away in a pickup truck and left the Charger exactly where it sat. The paperback is still on the passenger seat.',
    },

    requiresBarnFirst: 'barn_002',
    hintUnlocked: false,
    discovered: false,
    restored: false,
  },

  // ─────────────────────────────────────────────────────────
  // Barn 5 — Downtown Core (District 1)
  // Sub-basement of a derelict office block, pre-demolition zone
  // ─────────────────────────────────────────────────────────
  {
    id: 'barn_005',
    name: 'The Urban Vault',
    district: 1,
    districtName: 'Downtown Core',
    worldPos: { x: 55, y: -12, z: 80 },    // sub-basement, west of Central Tower
    restorationCost: 20000,

    npc: {
      id: 'npc_security_guard_brenda',
      name: 'Brenda',
      dialogue: 'That condemned block near Central Tower — before they stripped it, someone parked a car in the B2 level. Never got towed. Demolition\'s been delayed three years. Might still be there.',
    },

    car: {
      id: 'car_bf_005',
      make: 'Mini',
      model: 'Cooper S',
      year: 1967,
      class: 'D',
      pi: 380,
      top_speed_kmh: 160,
      acceleration: 6,
      handling: 9,
      braking: 7,
      unrestoredAppearance: 'rust_panel_mini_cooper_s_67',
      restoredAppearance: 'default_mini_cooper_s_67',
    },

    lore: {
      title: 'Small Car, Big Stories',
      body: 'Building permits from 1968 list this Mini as belonging to one "Clara Morrow, Journalist." City archive photographs show a Mini matching this exact colour — pale blue, white roof — at five major civic events between 1968 and 1972. What it was doing in the basement of a financial services block forty years later is anyone\'s guess. Clara\'s last known article was published in 1974. She wrote about a road trip. She said small cars see everything.',
    },

    requiresBarnFirst: 'barn_003',
    hintUnlocked: false,
    discovered: false,
    restored: false,
  },
];

// ─── BarnFindManager Class ────────────────────────────────────────────────────

export class BarnFindManager {
  /**
   * @param {object} opts
   * @param {object}   opts.saveManager        – SaveManager singleton
   * @param {object}   opts.progressionManager – ProgressionManager instance
   * @param {object}   opts.accoladeManager    – AccoladeManager instance
   * @param {object}   opts.notificationSystem – NotificationSystem instance
   */
  constructor({ saveManager, progressionManager, accoladeManager, notificationSystem }) {
    this._save          = saveManager;
    this._progression   = progressionManager;
    this._accolades     = accoladeManager;
    this._notifications = notificationSystem;

    // Working copy — merged with save data in _loadState()
    this._barns = BARN_CATALOGUE.map(b => ({ ...b, car: { ...b.car } }));

    // Proximity state (updated each tick — not persisted)
    this._nearbyBarn     = null;  // barn within GLOW_RADIUS_M
    this._interactable   = null;  // barn within INTERACT_RADIUS_M
    this._glowingBarnIds = new Set();

    this._loadState();
    this._unlockAvailableHints();

    console.log('[BarnFindManager] Initialised —', this._barns.length, 'barns registered.');
  }

  // ─── Save / Load ──────────────────────────────────────────────────────────

  _loadState() {
    const saved = this._save.get('barnFinds', '_mgr') ?? {};
    for (const barn of this._barns) {
      if (saved[barn.id]) {
        barn.discovered   = saved[barn.id].discovered   ?? false;
        barn.restored     = saved[barn.id].restored     ?? false;
        barn.hintUnlocked = saved[barn.id].hintUnlocked ?? false;
      }
    }
  }

  _saveState() {
    const data = {};
    for (const barn of this._barns) {
      data[barn.id] = {
        discovered:   barn.discovered,
        restored:     barn.restored,
        hintUnlocked: barn.hintUnlocked,
      };
    }
    this._save.set('barnFinds', '_mgr', data);
  }

  // ─── Hint Unlock Logic ────────────────────────────────────────────────────

  /**
   * After each save we re-evaluate which hints should now be unlocked.
   * A hint unlocks when:
   *   - requiresBarnFirst is null (always available), OR
   *   - the prerequisite barn has been discovered
   */
  _unlockAvailableHints() {
    const discoveredIds = new Set(
      this._barns.filter(b => b.discovered).map(b => b.id)
    );

    let changed = false;
    for (const barn of this._barns) {
      if (barn.hintUnlocked) continue;
      if (barn.requiresBarnFirst === null || discoveredIds.has(barn.requiresBarnFirst)) {
        barn.hintUnlocked = true;
        changed = true;
      }
    }
    if (changed) this._saveState();
  }

  // ─── Frame Tick — Proximity Detection ────────────────────────────────────

  /**
   * Call every frame from the game loop, passing the player's world position.
   * Fires glow toggles on the Three.js barn door meshes via events.
   *
   * @param {{ x: number, y: number, z: number }} playerPos
   */
  tick(playerPos) {
    this._nearbyBarn   = null;
    this._interactable = null;

    for (const barn of this._barns) {
      if (barn.discovered) continue; // already found — door is open, no glow needed

      const dist = this._distanceTo(playerPos, barn.worldPos);

      if (dist <= INTERACT_RADIUS_M) {
        this._interactable = barn;
        this._nearbyBarn   = barn;
        this._ensureGlow(barn.id, true);
      } else if (dist <= GLOW_RADIUS_M) {
        this._nearbyBarn = barn;
        this._ensureGlow(barn.id, true);
      } else {
        this._ensureGlow(barn.id, false);
      }
    }

    // Broadcast UI prompt state
    window.dispatchEvent(new CustomEvent('barnfind:proximity', {
      detail: {
        nearbyBarn:   this._nearbyBarn   ? this._nearbyBarn.id   : null,
        interactable: this._interactable ? this._interactable.id : null,
      },
    }));
  }

  /** Toggle barn door glow mesh via a scene event — only fires on state change */
  _ensureGlow(barnId, shouldGlow) {
    const isGlowing = this._glowingBarnIds.has(barnId);
    if (shouldGlow === isGlowing) return;

    if (shouldGlow) {
      this._glowingBarnIds.add(barnId);
    } else {
      this._glowingBarnIds.delete(barnId);
    }

    window.dispatchEvent(new CustomEvent('barnfind:glowchange', {
      detail: { barnId, glowing: shouldGlow },
    }));
  }

  // ─── Discovery Flow ───────────────────────────────────────────────────────

  /**
   * Called when the player presses F / X in the world.
   * If they are within INTERACT_RADIUS_M of an undiscovered barn, triggers discovery.
   *
   * @param {{ x: number, y: number, z: number }} playerPos
   * @returns {boolean} true if a barn was discovered this call
   */
  tryInteract(playerPos) {
    if (!this._interactable) return false;

    const barn = this._interactable;
    if (barn.discovered) return false;

    this._discoverBarn(barn);
    return true;
  }

  _discoverBarn(barn) {
    barn.discovered = true;
    this._glowingBarnIds.delete(barn.id);

    // Add car to player's garage in unrestored state
    this._save.inventory.addCar({ ...barn.car, isUnrestored: true });

    // Progression rewards
    this._progression.awardXP('barn_find_discovery', DISCOVERY_XP);
    this._accolades.report('barn_found', 1);

    // Check all-barns-found
    if (this._barns.every(b => b.discovered)) {
      this._accolades.report('all_barns_found', 1);
    }

    // Unlock any hints that this discovery gates
    this._unlockAvailableHints();
    this._saveState();

    // Fanfare
    audioManager.play?.('sfx_barn_discovery');

    // Toast notification
    this._notifications.show({
      type:    'barn_find',
      title:   '🏚️ Barn Find Discovered!',
      body:    `${barn.car.year} ${barn.car.make} ${barn.car.model} — Needs Restoration`,
      subtext: `Restoration cost: ${this._formatCR(barn.restorationCost)} CR`,
      duration: 6000,
    });

    // Broadcast for scene — door-open animation, confetti burst, etc.
    window.dispatchEvent(new CustomEvent('barnfind:discovered', {
      detail: { barnId: barn.id, car: barn.car },
    }));

    console.log(`[BarnFindManager] Barn discovered: ${barn.id} — ${barn.car.year} ${barn.car.make} ${barn.car.model}`);
  }

  // ─── Restoration Flow ─────────────────────────────────────────────────────

  /**
   * Attempt to restore a barn find car.
   * Called from the Garage Car Detail screen or the Parts Shop.
   *
   * @param {string} barnId
   * @returns {{ success: boolean, reason?: string }}
   */
  tryRestore(barnId) {
    const barn = this._getBarn(barnId);
    if (!barn) return { success: false, reason: 'Unknown barn find.' };
    if (!barn.discovered) return { success: false, reason: 'This barn has not been discovered yet.' };
    if (barn.restored)    return { success: false, reason: 'Already restored.' };

    if (!canAfford(barn.restorationCost)) {
      const shortfall = barn.restorationCost - getBalance();
      return {
        success: false,
        reason: `Not enough credits. You need ${this._formatCR(shortfall)} CR more.`,
      };
    }

    // Charge the player
    spend(barn.restorationCost, `barn_restoration`, `Barn restoration: ${barn.car.make} ${barn.car.model}`);

    // Mark the car as restored in garage and in barn state
    barn.restored = true;
    const _barnCar = this._save.inventory.getCarById(barn.car.id);
    if (_barnCar) { Object.assign(_barnCar, { isUnrestored: false }); this._save.markDirty(); }

    this._saveState();

    // Rewards
    this._progression.awardXP('barn_restoration', 500);
    this._accolades.report('barn_restored', 1);

    // Notification
    this._notifications.show({
      type:    'barn_restored',
      title:   '🔧 Restoration Complete!',
      body:    `${barn.car.year} ${barn.car.make} ${barn.car.model} is ready to race.`,
      duration: 5000,
    });

    window.dispatchEvent(new CustomEvent('barnfind:restored', {
      detail: { barnId: barn.id, car: barn.car },
    }));

    console.log(`[BarnFindManager] Barn restored: ${barnId}`);
    return { success: true };
  }

  // ─── NPC Hint System ──────────────────────────────────────────────────────

  /**
   * Returns the NPC hint dialogue for barns whose hint is now unlocked,
   * sorted by district number.
   * Used by the NPC dialogue system to inject hints into conversations.
   *
   * @returns {Array<{ npcId: string, npcName: string, barnId: string, dialogue: string }>}
   */
  getAvailableHints() {
    return this._barns
      .filter(b => b.hintUnlocked && !b.discovered)
      .sort((a, b) => a.district - b.district)
      .map(b => ({
        npcId:    b.npc.id,
        npcName:  b.npc.name,
        barnId:   b.id,
        dialogue: b.npc.dialogue,
        district: b.districtName,
      }));
  }

  /**
   * Returns the hint for a specific NPC (used by NPC dialogue manager).
   * Returns null if that NPC's hint is not yet unlocked or barn is found.
   *
   * @param {string} npcId
   * @returns {{ dialogue: string, barnId: string } | null}
   */
  getHintForNPC(npcId) {
    const barn = this._barns.find(b => b.npc.id === npcId);
    if (!barn || !barn.hintUnlocked || barn.discovered) return null;
    return { dialogue: barn.npc.dialogue, barnId: barn.id };
  }

  // ─── UI Query Helpers ─────────────────────────────────────────────────────

  /**
   * Full barn find list for the Phone Menu "Barn Finds" tab.
   * Undiscovered barns show district and hint (if unlocked) but hide car details.
   *
   * @returns {Array<Object>}
   */
  getAllForUI() {
    return this._barns.map(barn => {
      if (!barn.discovered) {
        return {
          id:           barn.id,
          discovered:   false,
          restored:     false,
          district:     barn.districtName,
          hintUnlocked: barn.hintUnlocked,
          hint:         barn.hintUnlocked ? barn.npc.dialogue : null,
          // Redacted — don't spoil location or car
          name:         barn.hintUnlocked ? '???' : 'Unknown',
          carPreview:   null,
          lore:         null,
        };
      }

      return {
        id:              barn.id,
        discovered:      true,
        restored:        barn.restored,
        name:            barn.name,
        district:        barn.districtName,
        car:             `${barn.car.year} ${barn.car.make} ${barn.car.model}`,
        carClass:        barn.car.class,
        restorationCost: barn.restored ? 0 : barn.restorationCost,
        canAffordRestore: barn.restored ? false : canAfford(barn.restorationCost),
        lore:            barn.lore,
        hintUnlocked:    true,
        hint:            barn.npc.dialogue,
      };
    });
  }

  /**
   * Summary counts for the Accolades screen and HUD badge.
   *
   * @returns {{ total: number, discovered: number, restored: number, remaining: number }}
   */
  getSummary() {
    const discovered = this._barns.filter(b => b.discovered).length;
    const restored   = this._barns.filter(b => b.restored).length;
    return {
      total:      this._barns.length,
      discovered,
      restored,
      remaining:  this._barns.length - discovered,
      allFound:   discovered === this._barns.length,
      allRestored: restored === this._barns.length,
    };
  }

  /**
   * Whether a specific barn has been discovered.
   * Used by AccoladeManager to check Barn Hunter progress.
   *
   * @param {string} barnId
   * @returns {boolean}
   */
  isDiscovered(barnId) {
    const barn = this._getBarn(barnId);
    return barn ? barn.discovered : false;
  }

  /**
   * Whether a specific barn car has been restored.
   *
   * @param {string} barnId
   * @returns {boolean}
   */
  isRestored(barnId) {
    const barn = this._getBarn(barnId);
    return barn ? barn.restored : false;
  }

  /**
   * Restoration cost for a given barn, or 0 if already restored / not found.
   *
   * @param {string} barnId
   * @returns {number}
   */
  getRestorationCost(barnId) {
    const barn = this._getBarn(barnId);
    if (!barn || !barn.discovered || barn.restored) return 0;
    return barn.restorationCost;
  }

  /**
   * Lore text for a discovered barn — shown in the detail card.
   *
   * @param {string} barnId
   * @returns {{ title: string, body: string } | null}
   */
  getLore(barnId) {
    const barn = this._getBarn(barnId);
    if (!barn || !barn.discovered) return null;
    return barn.lore;
  }

  /**
   * Returns all barn IDs — used by the world renderer to place door meshes.
   *
   * @returns {Array<{ id: string, worldPos: Object, discovered: boolean }>}
   */
  getWorldPositions() {
    return this._barns.map(b => ({
      id:         b.id,
      worldPos:   b.worldPos,
      discovered: b.discovered,
    }));
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────

  _getBarn(barnId) {
    return this._barns.find(b => b.id === barnId) || null;
  }

  _distanceTo(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _formatCR(amount) {
    return amount.toLocaleString('en-US');
  }
}

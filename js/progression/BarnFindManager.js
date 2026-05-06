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
  // ─── 1. Caldera Bunker — Ferrari Testarossa 1984 ────────────────────────────
  {
    id: 'barn_001', name: 'The Caldera Bunker',
    district: 'caldera', districtName: 'Gran Caldera',
    worldPos: { x: 3200, y: 420, z: -3800 },
    restorationCost: 120_000,
    npc: {
      id: 'npc_caldera_geologist',
      name: 'Dr. Reyes',
      dialogue: 'There\'s an old military observation post near the volcano rim. Sealed up decades ago. I swear I saw a rear wing through the rusted door.',
    },
    car: {
      id: 'car_bf_001', make: 'Ferrari', model: 'Testarossa', year: 1984,
      class: 'A', pi: 720, top_speed_kmh: 291, acceleration: 8, handling: 72, braking: 78,
      description: 'A flat-12 supercar icon from the 1980s, found sealed inside a volcanic observation bunker.',
    },
    hints: ['Somewhere near the caldera rim, above the treeline.', 'Look for a concrete structure with military markings.'],
    discovered: false, restored: false,
  },
  // ─── 2. Dunas Ruins — Ford GT40 1968 ───────────────────────────────────────
  {
    id: 'barn_002', name: 'The Dunas Ruins',
    district: 'dunas', districtName: 'Dunas Blancas',
    worldPos: { x: -3400, y: 80, z: -2800 },
    restorationCost: 180_000,
    npc: {
      id: 'npc_dunas_nomad',
      name: 'Rosa',
      dialogue: 'My grandfather used to tell a story about a racing car buried in the dune valley. He saw it in the 70s. The sand drifts cover everything out there.',
    },
    car: {
      id: 'car_bf_002', make: 'Ford', model: 'GT40', year: 1968,
      class: 'S1', pi: 820, top_speed_kmh: 328, acceleration: 9, handling: 80, braking: 82,
      description: 'Le Mans legend, half-swallowed by the white dunes of Dunas Blancas.',
    },
    hints: ['Deep in the dune valley, west side of Dunas Blancas.', 'The sand drift almost covers the roof — look for the shadow at golden hour.'],
    discovered: false, restored: false,
  },
  // ─── 3. Jungle Temple — Lamborghini Countach 1982 ───────────────────────────
  {
    id: 'barn_003', name: 'The Jungle Temple',
    district: 'jungle', districtName: 'La Selva',
    worldPos: { x: 1800, y: 30, z: 3200 },
    restorationCost: 140_000,
    npc: {
      id: 'npc_jungle_guide',
      name: 'Tomás',
      dialogue: 'Tourists never go south of the old aqueduct trail. The ruins back there aren\'t on any map. I saw headlights one night — didn\'t know ruins had headlights.',
    },
    car: {
      id: 'car_bf_003', make: 'Lamborghini', model: 'Countach LP400S', year: 1982,
      class: 'A', pi: 760, top_speed_kmh: 296, acceleration: 8, handling: 75, braking: 76,
      description: 'A scissor-door icon, half-consumed by jungle growth inside a Mayan-style ruin.',
    },
    hints: ['South of the main jungle trail, past the waterfall.', 'The ruin has three stone arches — the car is through the middle one.'],
    discovered: false, restored: false,
  },
  // ─── 4. Baja Mesa — Dodge Viper GTS 1996 ───────────────────────────────────
  {
    id: 'barn_004', name: 'The Baja Mesa',
    district: 'baja', districtName: 'Baja Desert',
    worldPos: { x: -3800, y: 120, z: 600 },
    restorationCost: 55_000,
    npc: {
      id: 'npc_baja_mechanic',
      name: 'Eduardo',
      dialogue: 'There\'s an old trading post up on the mesa flat. Abandoned in the 90s. The owner just walked away — left everything inside.',
    },
    car: {
      id: 'car_bf_004', make: 'Dodge', model: 'Viper GTS', year: 1996,
      class: 'A', pi: 730, top_speed_kmh: 290, acceleration: 9, handling: 70, braking: 74,
      description: 'A raw V10 brute from the desert, waiting in a sun-bleached trading post on the Baja mesa.',
    },
    hints: ['High up on the western mesa, near the abandoned trading route.', 'Follow the dirt road to the flat-top — you\'ll see the garage door.'],
    discovered: false, restored: false,
  },
  // ─── 5. Riviera Boathouse — Ferrari 308 GTB 1977 ────────────────────────────
  {
    id: 'barn_005', name: 'The Riviera Boathouse',
    district: 'riviera', districtName: 'Riviera Maya',
    worldPos: { x: 3800, y: 5, z: -800 },
    restorationCost: 85_000,
    npc: {
      id: 'npc_riviera_sailor',
      name: 'Capitán Vela',
      dialogue: 'Old boat storage shed at the south marina. Locked since \'92. Nobody knows what\'s inside — but the owner paid boat storage rent until 2019.',
    },
    car: {
      id: 'car_bf_005', make: 'Ferrari', model: '308 GTB', year: 1977,
      class: 'B', pi: 640, top_speed_kmh: 240, acceleration: 7, handling: 74, braking: 72,
      description: 'The car that made Magnum famous. Found locked in a Riviera boathouse, smelling of salt and nostalgia.',
    },
    hints: ['The south marina — look for the green boathouse near the old jetty.', 'The padlock is rusted through. One good bump should do it.'],
    discovered: false, restored: false,
  },
  // ─── 6. Farmland Silo — Porsche 911 Carrera RS 1973 ────────────────────────
  {
    id: 'barn_006', name: 'The Farmland Silo',
    district: 'farmland', districtName: 'Expedición',
    worldPos: { x: 800, y: 10, z: -400 },
    restorationCost: 200_000,
    npc: {
      id: 'npc_farmland_elder',
      name: 'Señora Herrera',
      dialogue: 'My husband worked in Germany in the 70s. Drove his Porsche all the way home when they finished. Parked it in the grain silo and never took it out again.',
    },
    car: {
      id: 'car_bf_006', make: 'Porsche', model: '911 Carrera RS 2.7', year: 1973,
      class: 'B', pi: 680, top_speed_kmh: 240, acceleration: 8, handling: 85, braking: 80,
      description: 'The most celebrated 911 ever built. Hidden behind a working grain silo for fifty years.',
    },
    hints: ['The old Herrera farm, east side of the farmland district.', 'The silo is behind the main barn — there\'s a duck pond.'],
    discovered: false, restored: false,
  },
  // ─── 7. Festival Old Hangar — Ford Escort RS1600 1970 ────────────────────────
  {
    id: 'barn_007', name: 'The Old Hangar',
    district: 'festival', districtName: 'Festival Grounds',
    worldPos: { x: -2000, y: 20, z: 1600 },
    restorationCost: 40_000,
    npc: {
      id: 'npc_festival_groundskeeper',
      name: 'Pepe',
      dialogue: 'Airstrip\'s been here since the 60s. Old maintenance hangar at the far end hasn\'t been used since we switched to modern equipment. There\'s something under the tarp.',
    },
    car: {
      id: 'car_bf_007', make: 'Ford', model: 'Escort RS1600', year: 1970,
      class: 'C', pi: 540, top_speed_kmh: 190, acceleration: 8, handling: 82, braking: 78,
      description: 'The original rally icon, sitting under an oilstained tarp in the airstrip\'s forgotten maintenance hangar.',
    },
    hints: ['West end of the airstrip — the old hangar with the blue corrugated roof.', 'It\'s not locked, just stuck.'],
    discovered: false, restored: false,
  },
  // ─── 8. Guanajuato Cellar — Alfa Romeo GTA 1965 ─────────────────────────────
  {
    id: 'barn_008', name: 'The Guanajuato Cellar',
    district: 'guanajuato', districtName: 'Guanajuato',
    worldPos: { x: 1600, y: 60, z: -2000 },
    restorationCost: 95_000,
    npc: {
      id: 'npc_guanajuato_innkeeper',
      name: 'Miguel',
      dialogue: 'This colonial building has been in my family for generations. The lower cellar? That\'s always been locked. Father said the key was lost before he was born.',
    },
    car: {
      id: 'car_bf_008', make: 'Alfa Romeo', model: 'Giulia GTA', year: 1965,
      class: 'C', pi: 560, top_speed_kmh: 218, acceleration: 8, handling: 88, braking: 80,
      description: 'A lightweight homologation special from a golden age of Italian racing. Found in the cellar of a 300-year-old colonial townhouse.',
    },
    hints: ['One of the oldest buildings in Guanajuato, near the cathedral steps.', 'The cellar entrance is around the back, behind the fountain.'],
    discovered: false, restored: false,
  },
  // ─── 9. Canyon Hideout — Lancia Stratos 1974 ────────────────────────────────
  {
    id: 'barn_009', name: 'The Canyon Hideout',
    district: 'highway', districtName: 'Canyon',
    worldPos: { x: -800, y: 200, z: -1600 },
    restorationCost: 160_000,
    npc: {
      id: 'npc_canyon_hiker',
      name: 'Andrea',
      dialogue: 'I do trail running in the canyon. There\'s a cave cut into the cliff wall partway up — sealed with a metal shutter. I\'ve always wondered what\'s inside.',
    },
    car: {
      id: 'car_bf_009', make: 'Lancia', model: 'Stratos HF', year: 1974,
      class: 'B', pi: 660, top_speed_kmh: 230, acceleration: 8, handling: 90, braking: 82,
      description: 'The purpose-built rally weapon that won everything. Hidden in a canyon cliff cache for unknown reasons.',
    },
    hints: ['The canyon below the overlook — there\'s a cut in the east cliff face.', 'You need to approach from the canyon floor, not the road above.'],
    discovered: false, restored: false,
  },
  // ─── 10. Coastal Cliff — Toyota 2000GT 1967 ─────────────────────────────────
  {
    id: 'barn_010', name: 'The Coastal Cliff Garage',
    district: 'riviera', districtName: 'Riviera Maya',
    worldPos: { x: 3200, y: 80, z: -1600 },
    restorationCost: 250_000,
    npc: {
      id: 'npc_cliff_villa_owner',
      name: 'Señor Ito',
      dialogue: 'My father was a Japanese engineer who fell in love with this coastline in 1969. He built a villa on the cliff. There is a room beneath the villa. He said it was just storage.',
    },
    car: {
      id: 'car_bf_010', make: 'Toyota', model: '2000GT', year: 1967,
      class: 'B', pi: 600, top_speed_kmh: 220, acceleration: 7, handling: 86, braking: 80,
      description: 'Japan\'s first supercar and rarest road car — found in a cliff-side vault above the Riviera coast.',
    },
    hints: ['The white villa on the cliff north of the marina.', 'The garage is below cliff level — enter from the beach path, not the road.'],
    discovered: false, restored: false,
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

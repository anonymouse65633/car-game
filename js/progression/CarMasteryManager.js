/**
 * CarMasteryManager.js
 * Part 9 — Progression & Rewards
 *
 * Manages the Car Mastery system:
 *  - Mastery Point (MP) accumulation per car from 4 sources
 *    (km driven, race wins, drift seconds, speed trap golds)
 *  - 20-node tree template with parent-dependency unlock logic
 *  - Node effect application: CR%, XP%, discount, cosmetic, Wheelspin,
 *    Super Wheelspin, Credit Cache, stat buff, lore text unlock
 *  - Circular ring progress value for the Garage card
 *  - Per-car override system so individual cars can have unique tree flavour
 *  - Persists all trees through SaveManager
 *
 * Dependencies: saveManager, progressionManager, accoladeManager, notificationSystem
 */

// ---------------------------------------------------------------------------
// MP source constants — used by callers to identify the award source
// ---------------------------------------------------------------------------

export const MP_SOURCE = {
  KM_DRIVEN:       'km_driven',       //  5 MP per km
  RACE_WIN:        'race_win',        // 50 MP per win in this car
  DRIFT_SECOND:    'drift_second',    //  2 MP per second drifting in this car
  SPEED_TRAP_GOLD: 'speed_trap_gold', // 25 MP per speed-trap gold in this car
  CAR_ACCOLADE:    'car_accolade',    // 100 MP per car-specific accolade completed
};

const MP_RATES = {
  [MP_SOURCE.KM_DRIVEN]:       5,
  [MP_SOURCE.RACE_WIN]:        50,
  [MP_SOURCE.DRIFT_SECOND]:    2,
  [MP_SOURCE.SPEED_TRAP_GOLD]: 25,
  [MP_SOURCE.CAR_ACCOLADE]:    100,
};

// ---------------------------------------------------------------------------
// Node type constants
// ---------------------------------------------------------------------------

export const NODE_TYPE = {
  CREDIT_BONUS:    'credit_bonus',    // +CR% earned in this car
  XP_BONUS:        'xp_bonus',        // +XP% earned in this car
  DISCOUNT:        'discount',        // % off parts for this car model
  COSMETIC:        'cosmetic',        // unique paint / livery unlock
  WHEELSPIN:       'wheelspin',       // 1× Wheelspin grant (one-time)
  SUPER_WHEELSPIN: 'super_wheelspin', // 1× Super Wheelspin grant (one-time)
  CREDIT_CACHE:    'credit_cache',    // one-time CR grant
  STAT_BONUS:      'stat_bonus',      // permanent +2 to one stat for this car
  LORE:            'lore',            // flavour / lore text reveal
};

// ---------------------------------------------------------------------------
// Generic 20-node tree template
// ---------------------------------------------------------------------------
// Layout: left-to-right columns, each node lists its parent ids.
// Every car uses this template unless overrides are provided.
//
// Visual columns (for the UI renderer):
//   Col 0 (root):  node 0
//   Col 1:         nodes 1, 2
//   Col 2:         nodes 3, 4, 5
//   Col 3:         nodes 6, 7, 8, 9
//   Col 4:         nodes 10, 11, 12, 13
//   Col 5:         nodes 14, 15, 16
//   Col 6:         nodes 17, 18
//   Col 7 (final): node 19
// ---------------------------------------------------------------------------

export const GENERIC_TREE_TEMPLATE = [
  // ── Column 0 — root ────────────────────────────────────────────────────
  {
    id: 0,
    col: 0, row: 1,
    parents: [],
    mpCost: 50,
    type: NODE_TYPE.CREDIT_BONUS,
    value: 5,           // +5% CR
    label: '+5% CR',
    description: 'Earn 5% more Credits when driving this car.',
  },

  // ── Column 1 ───────────────────────────────────────────────────────────
  {
    id: 1,
    col: 1, row: 0,
    parents: [0],
    mpCost: 75,
    type: NODE_TYPE.XP_BONUS,
    value: 10,          // +10% XP
    label: '+10% XP',
    description: 'Earn 10% more XP when driving this car.',
  },
  {
    id: 2,
    col: 1, row: 2,
    parents: [0],
    mpCost: 75,
    type: NODE_TYPE.CREDIT_BONUS,
    value: 5,
    label: '+5% CR',
    description: 'A second Credit bonus — stacks with other CR nodes.',
  },

  // ── Column 2 ───────────────────────────────────────────────────────────
  {
    id: 3,
    col: 2, row: 0,
    parents: [1],
    mpCost: 100,
    type: NODE_TYPE.CREDIT_CACHE,
    value: 20_000,
    label: '20,000 CR',
    description: 'One-time 20,000 CR bonus.',
  },
  {
    id: 4,
    col: 2, row: 1,
    parents: [1, 2],
    mpCost: 100,
    type: NODE_TYPE.DISCOUNT,
    value: 15,          // 15% off parts for this model
    label: '15% Parts Discount',
    description: 'Save 15% on all upgrades for this car.',
  },
  {
    id: 5,
    col: 2, row: 2,
    parents: [2],
    mpCost: 100,
    type: NODE_TYPE.STAT_BONUS,
    value: { stat: 'acceleration', amount: 2 },
    label: '+2 Acceleration',
    description: 'A permanent acceleration buff for this car.',
  },

  // ── Column 3 ───────────────────────────────────────────────────────────
  {
    id: 6,
    col: 3, row: 0,
    parents: [3],
    mpCost: 150,
    type: NODE_TYPE.XP_BONUS,
    value: 10,
    label: '+10% XP',
    description: 'A second XP bonus — stacks.',
  },
  {
    id: 7,
    col: 3, row: 1,
    parents: [3, 4],
    mpCost: 150,
    type: NODE_TYPE.WHEELSPIN,
    value: 1,
    label: '1× Wheelspin',
    description: 'Claim a Wheelspin reward.',
  },
  {
    id: 8,
    col: 3, row: 2,
    parents: [4, 5],
    mpCost: 150,
    type: NODE_TYPE.COSMETIC,
    value: 'car_specific_colour_1',
    label: 'Unique Colour',
    description: 'Unlock a unique paint colour exclusive to this car.',
  },
  {
    id: 9,
    col: 3, row: 3,
    parents: [5],
    mpCost: 150,
    type: NODE_TYPE.STAT_BONUS,
    value: { stat: 'handling', amount: 2 },
    label: '+2 Handling',
    description: 'A permanent handling buff for this car.',
  },

  // ── Column 4 ───────────────────────────────────────────────────────────
  {
    id: 10,
    col: 4, row: 0,
    parents: [6],
    mpCost: 200,
    type: NODE_TYPE.CREDIT_CACHE,
    value: 40_000,
    label: '40,000 CR',
    description: 'One-time 40,000 CR bonus.',
  },
  {
    id: 11,
    col: 4, row: 1,
    parents: [6, 7],
    mpCost: 200,
    type: NODE_TYPE.CREDIT_BONUS,
    value: 5,
    label: '+5% CR',
    description: 'Third stacking Credit bonus.',
  },
  {
    id: 12,
    col: 4, row: 2,
    parents: [7, 8],
    mpCost: 200,
    type: NODE_TYPE.LORE,
    value: 'lore_page_1',
    label: 'Car Lore',
    description: 'Unlock a hidden story about this car\'s history.',
  },
  {
    id: 13,
    col: 4, row: 3,
    parents: [8, 9],
    mpCost: 200,
    type: NODE_TYPE.STAT_BONUS,
    value: { stat: 'braking', amount: 2 },
    label: '+2 Braking',
    description: 'A permanent braking buff for this car.',
  },

  // ── Column 5 ───────────────────────────────────────────────────────────
  {
    id: 14,
    col: 5, row: 0,
    parents: [10, 11],
    mpCost: 300,
    type: NODE_TYPE.XP_BONUS,
    value: 10,
    label: '+10% XP',
    description: 'Third stacking XP bonus.',
  },
  {
    id: 15,
    col: 5, row: 1,
    parents: [11, 12],
    mpCost: 300,
    type: NODE_TYPE.WHEELSPIN,
    value: 1,
    label: '1× Wheelspin',
    description: 'A second Wheelspin reward.',
  },
  {
    id: 16,
    col: 5, row: 2,
    parents: [12, 13],
    mpCost: 300,
    type: NODE_TYPE.COSMETIC,
    value: 'car_specific_colour_2',
    label: 'Rare Colour',
    description: 'Unlock a second exclusive paint colour for this car.',
  },

  // ── Column 6 ───────────────────────────────────────────────────────────
  {
    id: 17,
    col: 6, row: 0,
    parents: [14, 15],
    mpCost: 400,
    type: NODE_TYPE.CREDIT_CACHE,
    value: 80_000,
    label: '80,000 CR',
    description: 'A large one-time Credit reward for mastery dedication.',
  },
  {
    id: 18,
    col: 6, row: 2,
    parents: [15, 16],
    mpCost: 400,
    type: NODE_TYPE.STAT_BONUS,
    value: { stat: 'speed', amount: 2 },
    label: '+2 Speed',
    description: 'A permanent top-speed buff for this car.',
  },

  // ── Column 7 — final node ───────────────────────────────────────────────
  {
    id: 19,
    col: 7, row: 1,
    parents: [17, 18],
    mpCost: 500,
    type: NODE_TYPE.SUPER_WHEELSPIN,
    value: 1,
    label: '1× Super Wheelspin',
    description: 'The ultimate reward for fully mastering this car.',
  },
];

// Total MP cost to unlock the entire tree (pre-computed for progress rings)
export const FULL_TREE_MP_COST = GENERIC_TREE_TEMPLATE.reduce((sum, n) => sum + n.mpCost, 0);

// ---------------------------------------------------------------------------
// Per-car tree overrides
// Override only the nodes that differ from the generic template.
// Key = carId, value = Map<nodeId, Partial<node>>
// ---------------------------------------------------------------------------

const CAR_OVERRIDES = {
  // Example: a sports car gets a livery instead of generic colour node 8,
  // and a unique lore page.
  ferrari_f40: {
    8:  { label: 'F40 Rosso Corsa',  value: 'ferrari_f40_rosso',      description: 'Unlock the iconic Ferrari Red exclusive to the F40.' },
    12: { label: 'F40 Story',        value: 'lore_ferrari_f40',       description: 'Read the legendary history of the Ferrari F40.' },
    16: { label: 'F40 Giallo Fly',   value: 'ferrari_f40_yellow',     description: 'Unlock a rare yellow livery for the F40.' },
  },

  lamborghini_countach: {
    8:  { label: 'Countach White',   value: 'countach_white',         description: 'The classic white Countach colour.' },
    12: { label: 'Countach Story',   value: 'lore_countach',          description: 'The story of the poster car of a generation.' },
    16: { label: 'Countach Gold',    value: 'countach_gold_flake',    description: 'A rare gold-flake finish for the Countach.' },
  },

  toyota_supra_mk4: {
    5:  { type: NODE_TYPE.STAT_BONUS, value: { stat: 'acceleration', amount: 3 }, label: '+3 Acceleration',
          description: 'The 2JZ rewards you: a bigger acceleration buff than most.' },
    8:  { label: 'Supra Orange',     value: 'supra_mk4_orange',       description: 'Unlock the famous Supra orange.' },
    12: { label: '2JZ Story',        value: 'lore_supra_mk4',         description: 'The legend of the 2JZ engine.' },
  },

  ford_mustang_gt500: {
    9:  { type: NODE_TYPE.STAT_BONUS, value: { stat: 'handling', amount: 3 }, label: '+3 Handling',
          description: 'The Shelby suspension tuning shows through.' },
    8:  { label: 'Mustang Blue',     value: 'mustang_gt500_blue',     description: 'Ford Performance Blue for the GT500.' },
    12: { label: 'Shelby Story',     value: 'lore_mustang_gt500',     description: 'Carroll Shelby\'s legacy.' },
  },
};

// ---------------------------------------------------------------------------
// Helper: build a resolved tree for a given carId
// Merges the generic template with any per-car overrides.
// ---------------------------------------------------------------------------

function buildTreeForCar(carId) {
  const overrides = CAR_OVERRIDES[carId] ?? {};
  return GENERIC_TREE_TEMPLATE.map(node => {
    const override = overrides[node.id];
    return override ? { ...node, ...override } : node;
  });
}

// ---------------------------------------------------------------------------
// CarMasteryManager
// ---------------------------------------------------------------------------

export class CarMasteryManager extends EventTarget {
  /**
   * @param {object} deps
   * @param {import('./SaveManager.js').SaveManager}                    deps.saveManager
   * @param {import('./ProgressionManager.js').ProgressionManager}      deps.progressionManager
   * @param {import('./AccoladeManager.js').AccoladeManager}            deps.accoladeManager
   * @param {import('../ui/NotificationSystem.js').NotificationSystem}  [deps.notificationSystem]
   */
  constructor({ saveManager, progressionManager, accoladeManager, notificationSystem = null }) {
    super();
    this._save        = saveManager;
    this._progression = progressionManager;
    this._accolades   = accoladeManager;
    this._notify      = notificationSystem;

    // In-memory state keyed by carId
    // { [carId]: { mp: number, unlockedNodes: number[], appliedEffects: number[] } }
    this._state = this._loadState();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _loadState() {
    const saved = this._save.mastery?.getAll?.() ?? {};
    return new Proxy(saved, {
      get: (target, carId) => {
        if (!(carId in target)) {
          target[carId] = { mp: 0, unlockedNodes: [], appliedEffects: [] };
        }
        return target[carId];
      },
    });
  }

  _persist() {
    this._save.mastery?.setAll?.(this._getRawState());
  }

  _getRawState() {
    // Proxy traps don't serialize cleanly — extract plain object
    return Object.fromEntries(
      Object.keys(this._state).map(k => [k, this._state[k]])
    );
  }

  _carState(carId) {
    return this._state[carId];
  }

  /**
   * Apply the effects of a node to the car's stat profile and the player's
   * inventory / progression. Only fires once (tracked in appliedEffects).
   */
  _applyNodeEffect(carId, node) {
    const state = this._carState(carId);
    if (state.appliedEffects.includes(node.id)) return;
    state.appliedEffects.push(node.id);

    const carData = this._save.mastery?.getCarEffects?.(carId) ?? {};

    switch (node.type) {

      case NODE_TYPE.CREDIT_BONUS:
        carData.crBonus = (carData.crBonus ?? 0) + node.value;
        this._save.mastery?.setCarEffects?.(carId, carData);
        break;

      case NODE_TYPE.XP_BONUS:
        carData.xpBonus = (carData.xpBonus ?? 0) + node.value;
        this._save.mastery?.setCarEffects?.(carId, carData);
        break;

      case NODE_TYPE.DISCOUNT:
        carData.partsDiscount = (carData.partsDiscount ?? 0) + node.value;
        this._save.mastery?.setCarEffects?.(carId, carData);
        break;

      case NODE_TYPE.STAT_BONUS: {
        const { stat, amount } = node.value;
        if (!carData.statBonuses) carData.statBonuses = {};
        carData.statBonuses[stat] = (carData.statBonuses[stat] ?? 0) + amount;
        this._save.mastery?.setCarEffects?.(carId, carData);
        break;
      }

      case NODE_TYPE.CREDIT_CACHE:
        this._save.inventory?.addCredits(node.value);
        this._notify?.push({
          text: `💰 Mastery Reward — ${node.value.toLocaleString()} CR`,
          colour: '#FFD700',
          size: 'medium',
          duration: 4_000,
        });
        break;

      case NODE_TYPE.WHEELSPIN:
        this._save.inventory?.addWheelspin(1);
        this._notify?.push({
          text: '🎡 Mastery Reward — 1× Wheelspin earned!',
          colour: '#00E5FF',
          size: 'medium',
          duration: 4_000,
        });
        break;

      case NODE_TYPE.SUPER_WHEELSPIN:
        this._save.inventory?.addSuperWheelspin(1);
        this._notify?.push({
          text: '🌟 Mastery Complete — 1× Super Wheelspin earned!',
          colour: '#FF6B00',
          size: 'large',
          duration: 6_000,
        });
        break;

      case NODE_TYPE.COSMETIC:
        this._save.inventory?.addCosmetic(node.value);
        this._notify?.push({
          text: `🎨 Mastery Reward — ${node.label} unlocked!`,
          colour: '#E040FB',
          size: 'medium',
          duration: 4_000,
        });
        break;

      case NODE_TYPE.LORE:
        this._save.inventory?.addLorePage(node.value);
        this._notify?.push({
          text: `📖 Lore Unlocked — ${node.label}`,
          colour: '#80CBC4',
          size: 'small',
          duration: 3_500,
        });
        break;

      default:
        break;
    }
  }

  // ── Public: MP accumulation ───────────────────────────────────────────────

  /**
   * Award MP to a specific car. Called by RaceManager, DriftZoneManager, etc.
   *
   * @param {string} carId     - the car that earned the MP
   * @param {string} source    - one of MP_SOURCE values
   * @param {number} [qty=1]   - quantity of the source event (e.g. km driven)
   */
  addMP(carId, source, qty = 1) {
    const rate  = MP_RATES[source] ?? 0;
    const award = rate * qty;
    if (award <= 0) return;

    const state = this._carState(carId);
    state.mp   += award;

    // Report to AccoladeManager (node unlocks feed accolade hooks separately)
    this._accolades?.report('mastery_mp_earned', award, { carId, source });

    this._persist();

    // Dispatch event for HUD "MP earned" flash
    this.dispatchEvent(new CustomEvent('mp_earned', {
      detail: { carId, source, award, totalMp: state.mp },
    }));
  }

  /**
   * Convenience wrappers used by game systems
   */
  onKmDriven(carId, km)         { this.addMP(carId, MP_SOURCE.KM_DRIVEN,       km); }
  onRaceWin(carId)              { this.addMP(carId, MP_SOURCE.RACE_WIN,         1);  }
  onDriftSeconds(carId, secs)   { this.addMP(carId, MP_SOURCE.DRIFT_SECOND,     secs); }
  onSpeedTrapGold(carId)        { this.addMP(carId, MP_SOURCE.SPEED_TRAP_GOLD,  1);  }
  onCarAccoladeComplete(carId)  { this.addMP(carId, MP_SOURCE.CAR_ACCOLADE,     1);  }

  // ── Public: Node unlocking ────────────────────────────────────────────────

  /**
   * Attempt to unlock a node for a car. Returns true if successful.
   *
   * @param {string} carId
   * @param {number} nodeId
   * @returns {boolean}
   */
  unlockNode(carId, nodeId) {
    const tree  = buildTreeForCar(carId);
    const node  = tree.find(n => n.id === nodeId);
    if (!node) return false;

    const state = this._carState(carId);

    // Already unlocked?
    if (state.unlockedNodes.includes(nodeId)) return false;

    // Parent dependency check
    const parentsUnlocked = node.parents.every(p => state.unlockedNodes.includes(p));
    if (!parentsUnlocked) return false;

    // MP cost check
    const spentMp = this._getSpentMP(carId, tree);
    const availMp = state.mp - spentMp;
    if (availMp < node.mpCost) return false;

    // All checks passed — unlock
    state.unlockedNodes.push(nodeId);
    this._applyNodeEffect(carId, node);

    // Report mastery node to AccoladeManager + ProgressionManager
    this._accolades?.report('mastery_node_unlocked', 1, { carId, nodeId });
    this._progression?.addXP(300, 'mastery_node');

    this._persist();

    this.dispatchEvent(new CustomEvent('node_unlocked', {
      detail: { carId, nodeId, node },
    }));

    // Check for full tree completion
    if (state.unlockedNodes.length === tree.length) {
      this.dispatchEvent(new CustomEvent('tree_complete', { detail: { carId } }));
      this._notify?.push({
        text: `🏅 Car Mastery Complete!`,
        colour: '#FFD700',
        size: 'large',
        duration: 6_000,
      });
    }

    return true;
  }

  /**
   * Check whether a node can be unlocked right now (for UI greying).
   *
   * @param {string} carId
   * @param {number} nodeId
   * @returns {{ canUnlock: boolean, reason?: string }}
   */
  canUnlockNode(carId, nodeId) {
    const tree  = buildTreeForCar(carId);
    const node  = tree.find(n => n.id === nodeId);
    if (!node) return { canUnlock: false, reason: 'Node not found' };

    const state = this._carState(carId);

    if (state.unlockedNodes.includes(nodeId))
      return { canUnlock: false, reason: 'Already unlocked' };

    const parentsUnlocked = node.parents.every(p => state.unlockedNodes.includes(p));
    if (!parentsUnlocked)
      return { canUnlock: false, reason: 'Parent nodes required' };

    const available = state.mp - this._getSpentMP(carId, tree);
    if (available < node.mpCost)
      return { canUnlock: false, reason: `Need ${node.mpCost - available} more MP` };

    return { canUnlock: true };
  }

  // ── Public: Query helpers for UI ──────────────────────────────────────────

  /**
   * Returns the full resolved tree with unlock state for a given car.
   * Used by the Car Detail screen to render the node web.
   *
   * @param {string} carId
   * @returns {Array<{ node, unlocked, available, canUnlock, reason }>}
   */
  getTreeState(carId) {
    const tree  = buildTreeForCar(carId);
    const state = this._carState(carId);

    return tree.map(node => {
      const unlocked  = state.unlockedNodes.includes(node.id);
      const { canUnlock, reason } = this.canUnlockNode(carId, node.id);
      // A node is "available" (lit up but locked) if parents are done but not yet bought
      const parentsOk = node.parents.every(p => state.unlockedNodes.includes(p));
      return { node, unlocked, available: !unlocked && parentsOk, canUnlock, reason };
    });
  }

  /**
   * Circular ring progress value for the Garage card (0–1).
   * Based on MP earned vs full tree cost.
   *
   * @param {string} carId
   * @returns {number} 0.0 – 1.0
   */
  getRingProgress(carId) {
    const state = this._carState(carId);
    return Math.min(state.mp / FULL_TREE_MP_COST, 1);
  }

  /**
   * Percentage of nodes unlocked for this car.
   * @param {string} carId
   * @returns {number} 0–100
   */
  getNodeCompletionPct(carId) {
    const state = this._carState(carId);
    return Math.round((state.unlockedNodes.length / GENERIC_TREE_TEMPLATE.length) * 100);
  }

  /**
   * Current MP total and available (unspent) MP for a car.
   * @param {string} carId
   * @returns {{ total: number, spent: number, available: number }}
   */
  getMPSummary(carId) {
    const tree    = buildTreeForCar(carId);
    const state   = this._carState(carId);
    const spent   = this._getSpentMP(carId, tree);
    return { total: state.mp, spent, available: state.mp - spent };
  }

  /**
   * Active effects for a car (CR%, XP%, discount, stat bonuses).
   * Used by RaceManager and EconomyManager to apply multipliers.
   *
   * @param {string} carId
   * @returns {{ crBonus: number, xpBonus: number, partsDiscount: number, statBonuses: object }}
   */
  getCarEffects(carId) {
    return this._save.mastery?.getCarEffects?.(carId) ?? {
      crBonus:      0,
      xpBonus:      0,
      partsDiscount: 0,
      statBonuses:  {},
    };
  }

  /**
   * All unlocked cosmetic / lore rewards for a car.
   * @param {string} carId
   * @returns {{ cosmetics: string[], lorePages: string[] }}
   */
  getUnlockedRewards(carId) {
    const tree  = buildTreeForCar(carId);
    const state = this._carState(carId);
    const cosmetics = [];
    const lorePages = [];

    for (const nodeId of state.unlockedNodes) {
      const node = tree.find(n => n.id === nodeId);
      if (!node) continue;
      if (node.type === NODE_TYPE.COSMETIC) cosmetics.push(node.value);
      if (node.type === NODE_TYPE.LORE)     lorePages.push(node.value);
    }

    return { cosmetics, lorePages };
  }

  /**
   * Summary rows for every car the player owns — used by the Garage overview.
   * @param {string[]} ownedCarIds
   * @returns {Array<{ carId, mp, ringProgress, nodesPct, unlockedNodes }>}
   */
  getGarageSummary(ownedCarIds) {
    return ownedCarIds.map(carId => ({
      carId,
      mp:            this._carState(carId).mp,
      ringProgress:  this.getRingProgress(carId),
      nodesPct:      this.getNodeCompletionPct(carId),
      unlockedNodes: this._carState(carId).unlockedNodes.length,
    }));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Sum of MP costs of all already-unlocked nodes for a car. */
  _getSpentMP(carId, tree) {
    const state = this._carState(carId);
    return state.unlockedNodes.reduce((sum, nodeId) => {
      const node = tree.find(n => n.id === nodeId);
      return sum + (node?.mpCost ?? 0);
    }, 0);
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance = null;

/**
 * Call once during game init with all dependencies.
 * Import { carMasteryManager } anywhere else.
 */
export function createCarMasteryManager(deps) {
  if (_instance) return _instance;
  _instance = new CarMasteryManager(deps);
  return _instance;
}

export { _instance as carMasteryManager };

// Export tree data for the UI renderer
export { CAR_OVERRIDES, buildTreeForCar };

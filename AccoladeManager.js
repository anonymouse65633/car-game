/**
 * AccoladeManager.js
 * Part 9 — Progression & Rewards
 *
 * Manages the full accolade system:
 *  - Definition registry across 6 categories (~36 accolades, each with Bronze/Silver/Gold tiers)
 *  - Single report(eventType, value, context) API so every other system feeds progress
 *    without direct coupling to this module
 *  - Tier completion detection and reward dispatch (CR, XP, Wheelspins, cosmetics)
 *  - NotificationSystem hooks for on-screen fanfare
 *  - Nearest-to-completion sort for the Accolades UI screen
 *  - Persists all progress through SaveManager
 *
 * Dependencies: saveManager (singleton), progressionManager, notificationSystem (injected)
 */

import { saveManager } from '../save/SaveManager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CATEGORY = {
  EXPLORATION:   'Exploration',
  RACING:        'Racing',
  CAR:           'Car',
  CUSTOMIZATION: 'Customization',
  DRIFT:         'Drift',
  SOCIAL:        'Social',
};

export const TIER = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD:   'gold',
};

// ---------------------------------------------------------------------------
// Accolade Definition Registry
// ---------------------------------------------------------------------------
// Each accolade:
//   id           : unique camelCase string
//   category     : one of CATEGORY values
//   name         : display name
//   description  : what the player must do
//   icon         : emoji / asset key used by UI
//   eventType    : string (or string[]) that report() listens for
//   accumulate   : true  → progress += value each call
//                  false → progress = value (max-count or single-fire)
//   maxTracked   : true  → progress = Math.max(current, incoming value)
//   tiers        : array of { tier, threshold, crReward, xpReward, extra? }
//                  extra: { type: 'wheelspin'|'superWheelspin'|'cosmetic', value? }
// ---------------------------------------------------------------------------

const ACCOLADE_DEFINITIONS = [

  // ── EXPLORATION ──────────────────────────────────────────────────────────

  {
    id: 'cityDiscoverer',
    category: CATEGORY.EXPLORATION,
    name: 'City Discoverer',
    description: 'Discover landmarks across Horizon City.',
    icon: '🗺️',
    eventType: 'landmark_discovered',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 3,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 7,  crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 12, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'cosmetic', value: 'explorer_livery_sticker' } },
    ],
  },

  {
    id: 'boardCollector',
    category: CATEGORY.EXPLORATION,
    name: 'Board Collector',
    description: 'Collect Credit Boards hidden around the city.',
    icon: '💸',
    eventType: 'board_collected',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 10, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 25, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 50, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'wheelspin' } },
    ],
  },

  {
    id: 'nightOwl',
    category: CATEGORY.EXPLORATION,
    name: 'Night Owl',
    description: 'Drive kilometres during the night cycle.',
    icon: '🌙',
    eventType: 'night_km_driven',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 5,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 20, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 50, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'cosmetic', value: 'neon_underglow_purple' } },
    ],
  },

  {
    id: 'urbanExplorer',
    category: CATEGORY.EXPLORATION,
    name: 'Urban Explorer',
    description: 'Walk to every district of Horizon City on foot.',
    icon: '🚶',
    eventType: 'district_visited_foot',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 2, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 4, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 7, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  {
    id: 'barnHunter',
    category: CATEGORY.EXPLORATION,
    name: 'Barn Hunter',
    description: 'Discover hidden Barn Finds around the city.',
    icon: '🏚️',
    eventType: 'barn_find_discovered',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 3, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 5, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'superWheelspin' } },
    ],
  },

  // ── RACING ───────────────────────────────────────────────────────────────

  {
    id: 'firstBlood',
    category: CATEGORY.RACING,
    name: 'First Blood',
    description: 'Win your first race.',
    icon: '🏁',
    eventType: 'race_won',
    accumulate: false,
    tiers: [
      { tier: TIER.GOLD, threshold: 1, crReward: 5_000, xpReward: 1_000 },
    ],
  },

  {
    id: 'districtChampion',
    category: CATEGORY.RACING,
    name: 'District Champion',
    description: 'Sweep all races in multiple districts.',
    icon: '🏆',
    eventType: 'district_races_swept',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 3, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 7, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'wheelspin' } },
    ],
  },

  {
    id: 'grandChampion',
    category: CATEGORY.RACING,
    name: 'Grand Champion',
    description: 'Win Championship events across the game.',
    icon: '👑',
    eventType: 'championships_won',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1,  crReward: 2_000,   xpReward: 500 },
      { tier: TIER.SILVER, threshold: 5,  crReward: 8_000,   xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 12, crReward: 100_000, xpReward: 15_000,
        extra: { type: 'superWheelspin' } },
    ],
  },

  {
    id: 'speedFreak',
    category: CATEGORY.RACING,
    name: 'Speed Freak',
    description: 'Hit high top speeds in free roam.',
    icon: '💨',
    eventType: 'top_speed_kmh',
    accumulate: false,
    maxTracked: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 200, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 250, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 300, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'cosmetic', value: 'speed_demon_livery_sticker' } },
    ],
  },

  {
    id: 'perfectRound',
    category: CATEGORY.RACING,
    name: 'Perfect Round',
    description: 'Win races on Pro difficulty or higher without using Rewind.',
    icon: '✨',
    eventType: 'clean_pro_win',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 5,  crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 10, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'wheelspin' } },
    ],
  },

  {
    id: 'cleanRacer',
    category: CATEGORY.RACING,
    name: 'Clean Racer',
    description: 'Complete races without colliding with another car.',
    icon: '🕊️',
    eventType: 'clean_race_no_collision',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 5,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 10, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 20, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  {
    id: 'comebackKing',
    category: CATEGORY.RACING,
    name: 'Comeback King',
    description: 'Win races after being in last place at the halfway point.',
    icon: '🔄',
    accumulate: true,
    eventType: 'comeback_win',
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 3, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 5, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'cosmetic', value: 'underdog_helmet' } },
    ],
  },

  {
    id: 'dragLegend',
    category: CATEGORY.RACING,
    name: 'Drag Legend',
    description: 'Win drag races with a reaction time under 0.05 seconds.',
    icon: '🚦',
    eventType: 'drag_win_fast_reaction',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 3, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 5, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  // ── CAR ──────────────────────────────────────────────────────────────────

  {
    id: 'collector',
    category: CATEGORY.CAR,
    name: 'Collector',
    description: 'Build a diverse garage of different cars.',
    icon: '🚗',
    eventType: 'cars_owned',
    accumulate: false,
    maxTracked: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 5,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 10, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 25, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'wheelspin' } },
    ],
  },

  {
    id: 'purist',
    category: CATEGORY.CAR,
    name: 'Purist',
    description: 'Win races using only a stock (unupgraded) car.',
    icon: '🔩',
    eventType: 'stock_race_won',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 5,  crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 10, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  {
    id: 'sClassLegend',
    category: CATEGORY.CAR,
    name: 'S-Class Legend',
    description: 'Win races in S2-class vehicles.',
    icon: '🚀',
    eventType: 's2_race_won',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 5,  crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 10, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'cosmetic', value: 's2_legend_driver_suit' } },
    ],
  },

  {
    id: 'dClassHero',
    category: CATEGORY.CAR,
    name: 'D-Class Hero',
    description: 'Beat S-class AI in an open-class event using a D-class car.',
    icon: '🐢',
    eventType: 'david_vs_goliath_win',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 3, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 5, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'cosmetic', value: 'underdog_livery' } },
    ],
  },

  {
    id: 'gearhead',
    category: CATEGORY.CAR,
    name: 'Gearhead',
    description: 'Max out all performance stats on a car.',
    icon: '⚙️',
    eventType: 'car_fully_upgraded',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 3, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 5, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'wheelspin' } },
    ],
  },

  // ── CUSTOMIZATION ────────────────────────────────────────────────────────

  {
    id: 'stylist',
    category: CATEGORY.CUSTOMIZATION,
    name: 'Stylist',
    description: 'Apply custom liveries to your cars.',
    icon: '🎨',
    eventType: 'livery_applied',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 5,  crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 10, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  {
    id: 'fashionIcon',
    category: CATEGORY.CUSTOMIZATION,
    name: 'Fashion Icon',
    description: 'Unlock clothing items from shops and Wheelspins.',
    icon: '👗',
    eventType: 'clothing_items_owned',
    accumulate: false,
    maxTracked: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 10, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 20, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 30, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'cosmetic', value: 'exclusive_festival_cap' } },
    ],
  },

  {
    id: 'bodySculptor',
    category: CATEGORY.CUSTOMIZATION,
    name: 'Body Sculptor',
    description: 'Apply wide body kits to different cars.',
    icon: '🏋️',
    eventType: 'wide_body_applied',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 2, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 3, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  {
    id: 'colorSpectrum',
    category: CATEGORY.CUSTOMIZATION,
    name: 'Color Spectrum',
    description: 'Use all 6 paint types across your cars.',
    icon: '🌈',
    eventType: 'paint_type_used',
    accumulate: false,
    maxTracked: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 2, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 4, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 6, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  // ── DRIFT ────────────────────────────────────────────────────────────────

  {
    id: 'firstSlide',
    category: CATEGORY.DRIFT,
    name: 'First Slide',
    description: 'Earn any score in a Drift Zone.',
    icon: '🌀',
    eventType: 'drift_zone_scored',
    accumulate: false,
    tiers: [
      { tier: TIER.GOLD, threshold: 1, crReward: 2_000, xpReward: 500 },
    ],
  },

  {
    id: 'driftKing',
    category: CATEGORY.DRIFT,
    name: 'Drift King',
    description: 'Achieve Platinum scores in Drift Zones.',
    icon: '🔥',
    eventType: 'drift_zone_platinum',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 3, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 7, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'cosmetic', value: 'drift_king_livery' } },
    ],
  },

  {
    id: 'chainReaction',
    category: CATEGORY.DRIFT,
    name: 'Chain Reaction',
    description: 'Maintain a drift chain through 5 consecutive corners.',
    icon: '⛓️',
    eventType: 'drift_chain_5_corners',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 5,  crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 10, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  {
    id: 'smokeMachine',
    category: CATEGORY.DRIFT,
    name: 'Smoke Machine',
    description: 'Accumulate total drift distance across all cars.',
    icon: '💨',
    eventType: 'total_drift_km',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 2,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 5,  crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 10, crReward: 25_000, xpReward: 5_000,
        extra: { type: 'wheelspin' } },
    ],
  },

  // ── SOCIAL / FESTIVAL ─────────────────────────────────────────────────────

  {
    id: 'seasonRegular',
    category: CATEGORY.SOCIAL,
    name: 'Season Regular',
    description: 'Complete Festival Playlist events.',
    icon: '📅',
    eventType: 'playlist_event_completed',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 5,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 10, crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 20, crReward: 25_000, xpReward: 5_000 },
    ],
  },

  {
    id: 'festivalVeteran',
    category: CATEGORY.SOCIAL,
    name: 'Festival Veteran',
    description: 'Complete full seasonal cycles.',
    icon: '🌟',
    eventType: 'season_cycle_completed',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1, crReward: 2_000,   xpReward: 500 },
      { tier: TIER.SILVER, threshold: 2, crReward: 8_000,   xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 4, crReward: 100_000, xpReward: 15_000,
        extra: { type: 'superWheelspin' } },
    ],
  },

  {
    id: 'trendsetter',
    category: CATEGORY.SOCIAL,
    name: 'Trendsetter',
    description: 'Share car livery codes with other players.',
    icon: '🤝',
    eventType: 'livery_shared',
    accumulate: true,
    tiers: [
      { tier: TIER.BRONZE, threshold: 1,  crReward: 2_000,  xpReward: 500 },
      { tier: TIER.SILVER, threshold: 5,  crReward: 8_000,  xpReward: 1_500 },
      { tier: TIER.GOLD,   threshold: 10, crReward: 25_000, xpReward: 5_000 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Fast lookup structures built from the definition array
// ---------------------------------------------------------------------------

const ACCOLADES_BY_ID    = new Map(ACCOLADE_DEFINITIONS.map(a => [a.id, a]));
const ACCOLADES_BY_EVENT = new Map();

for (const accolade of ACCOLADE_DEFINITIONS) {
  const types = Array.isArray(accolade.eventType)
    ? accolade.eventType
    : [accolade.eventType];
  for (const type of types) {
    if (!ACCOLADES_BY_EVENT.has(type)) ACCOLADES_BY_EVENT.set(type, []);
    ACCOLADES_BY_EVENT.get(type).push(accolade);
  }
}

// ---------------------------------------------------------------------------
// AccoladeManager class
// ---------------------------------------------------------------------------

export class AccoladeManager extends EventTarget {
  /**
   * @param {object} deps
   * @param {import('./SaveManager.js').SaveManager}                    deps.saveManager
   * @param {import('./ProgressionManager.js').ProgressionManager}      deps.progressionManager
   * @param {import('../ui/NotificationSystem.js').NotificationSystem}  [deps.notificationSystem]
   */
  constructor({ saveManager, progressionManager, notificationSystem = null }) {
    super();
    this._save        = saveManager;
    this._progression = progressionManager;
    this._notify      = notificationSystem;
    this._progress    = this._loadProgress();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /** Seed in-memory state from SaveManager, filling defaults for any new accolades. */
  _loadProgress() {
    const saved    = this._save.accolades.getAll?.() ?? {};
    const progress = {};
    for (const accolade of ACCOLADE_DEFINITIONS) {
      progress[accolade.id] = saved[accolade.id] ?? {
        value:         0,    // running total / max / single flag
        unlockedTiers: [],   // e.g. ['bronze', 'silver']
      };
    }
    return progress;
  }

  /** Flush in-memory state back to SaveManager. */
  _persist() {
    this._save.accolades?.setAll(this._progress);
  }

  /**
   * Attempt to unlock a single tier. No-ops if already unlocked.
   * Dispatches rewards and notifications on first unlock.
   */
  _unlockTier(accolade, tierDef) {
    const prog = this._progress[accolade.id];
    if (prog.unlockedTiers.includes(tierDef.tier)) return;

    prog.unlockedTiers.push(tierDef.tier);
    this._persist();

    // Credits
    if (tierDef.crReward) {
      this._save.inventory?.addCredits(tierDef.crReward);
    }

    // XP (routed through ProgressionManager so level-up logic fires)
    if (tierDef.xpReward && this._progression) {
      this._progression.addXP(tierDef.xpReward, 'accolade');
    }

    // Extra reward
    if (tierDef.extra) {
      const { type, value } = tierDef.extra;
      switch (type) {
        case 'wheelspin':      this._save.inventory?.addWheelspin(1);        break;
        case 'superWheelspin': this._save.inventory?.addSuperWheelspin(1);   break;
        case 'cosmetic':       this._save.inventory?.addCosmetic(value);     break;
      }
    }

    // Notification fanfare
    const label  = tierDef.tier.charAt(0).toUpperCase() + tierDef.tier.slice(1);
    const colour = { gold: '#FFD700', silver: '#C0C0C0', bronze: '#CD7F32' }[tierDef.tier];
    const text   = `${accolade.icon} Accolade — ${accolade.name} (${label})`;

    this._notify?.push({ text, colour, size: 'large', duration: 5_000 });

    // DOM event for UI listeners
    this.dispatchEvent(new CustomEvent('accolade_tier_unlocked', {
      detail: { accoladeId: accolade.id, tier: tierDef.tier, tierDef, accolade },
    }));

    console.log(`[AccoladeManager] ${text}`);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * The single entry point every other system calls.
   *
   * Examples:
   *   accoladeManager.report('race_won', 1);
   *   accoladeManager.report('top_speed_kmh', 287, { carId: 'supra_mk4' });
   *   accoladeManager.report('cars_owned', garage.ownedCars.length);
   *
   * @param {string} eventType - string matching an accolade's eventType
   * @param {number} value     - quantity to add, or new max/total value
   * @param {object} [context] - optional debug context (carId, raceId, etc.)
   */
  report(eventType, value = 1, context = {}) {
    const accolades = ACCOLADES_BY_EVENT.get(eventType);
    if (!accolades?.length) return;

    for (const accolade of accolades) {
      const prog = this._progress[accolade.id];

      // Update running value
      if (accolade.maxTracked) {
        if (value > prog.value) prog.value = value;
      } else if (accolade.accumulate) {
        prog.value += value;
      } else {
        // Single-fire or snapshot (e.g. cars_owned): value IS the new total
        prog.value = Math.max(prog.value, value);
      }

      // Check each tier
      for (const tierDef of accolade.tiers) {
        if (prog.value >= tierDef.threshold) {
          this._unlockTier(accolade, tierDef);
        }
      }
    }

    this._persist();
  }

  // ── Query helpers for UI ─────────────────────────────────────────────────

  /**
   * All accolades sorted by proximity to next tier unlock (nearest first).
   * Fully completed accolades sink to the bottom.
   */
  getSortedByCompletion() {
    return ACCOLADE_DEFINITIONS
      .map(accolade => {
        const prog     = this._progress[accolade.id];
        const nextTier = this._getNextTier(accolade, prog);
        const pct      = nextTier ? Math.min(prog.value / nextTier.threshold, 1) : 1;
        return { accolade, prog, nextTier, pct };
      })
      .sort((a, b) => {
        if (a.pct === 1 && b.pct < 1) return  1;
        if (b.pct === 1 && a.pct < 1) return -1;
        return b.pct - a.pct;
      });
  }

  /**
   * Accolades grouped by category.
   * @returns {Map<string, Array<{accolade, prog, nextTier}>>}
   */
  getByCategory() {
    const result = new Map(Object.values(CATEGORY).map(c => [c, []]));
    for (const accolade of ACCOLADE_DEFINITIONS) {
      const prog     = this._progress[accolade.id];
      const nextTier = this._getNextTier(accolade, prog);
      result.get(accolade.category).push({ accolade, prog, nextTier });
    }
    return result;
  }

  /**
   * Top N accolades nearest to unlocking their next tier.
   * Used by the "Nearest to Completion" strip in the Accolades screen.
   * @param {number} count
   */
  getNearestToCompletion(count = 5) {
    return this.getSortedByCompletion()
      .filter(e => e.pct < 1)
      .slice(0, count);
  }

  /**
   * Full progress detail for one accolade (for detail panel).
   * @param {string} id
   * @returns {{ accolade, prog, nextTier } | null}
   */
  getProgress(id) {
    const accolade = ACCOLADES_BY_ID.get(id);
    if (!accolade) return null;
    const prog     = this._progress[id];
    const nextTier = this._getNextTier(accolade, prog);
    return { accolade, prog, nextTier };
  }

  /** True if an accolade's final tier is unlocked. */
  isCompleted(id) {
    const accolade = ACCOLADES_BY_ID.get(id);
    if (!accolade) return false;
    const prog     = this._progress[id];
    const lastTier = accolade.tiers[accolade.tiers.length - 1];
    return prog.unlockedTiers.includes(lastTier.tier);
  }

  /** Number of accolades with at least one tier unlocked. */
  get startedCount()   { return Object.values(this._progress).filter(p => p.unlockedTiers.length > 0).length; }

  /** Number of fully completed accolades (all tiers unlocked). */
  get completedCount() { return ACCOLADE_DEFINITIONS.filter(a => this.isCompleted(a.id)).length; }

  /** Total accolades in the registry. */
  get totalCount()     { return ACCOLADE_DEFINITIONS.length; }

  // ── Private helpers ──────────────────────────────────────────────────────

  _getNextTier(accolade, prog) {
    for (const tierDef of accolade.tiers) {
      if (!prog.unlockedTiers.includes(tierDef.tier)) return tierDef;
    }
    return null;   // all tiers complete
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance = null;

/**
 * Call once during game init. Returns the singleton thereafter.
 * @param {{ saveManager, progressionManager, notificationSystem? }} deps
 */
export function createAccoladeManager(deps) {
  if (_instance) return _instance;
  _instance = new AccoladeManager(deps);
  return _instance;
}

/** Import this in any module that just needs to call report(). */
export { _instance as accoladeManager };

// Raw definitions exported for the Accolades UI screen builder
export { ACCOLADE_DEFINITIONS, ACCOLADES_BY_ID, ACCOLADES_BY_EVENT };

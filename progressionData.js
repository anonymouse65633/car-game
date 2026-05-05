/**
 * progressionData.js  (js/progression/progressionData.js)
 * ─────────────────────────────────────────────────────────────────────────────
 * All static data tables for the progression system.
 * Imported by ProgressionManager.js — extracted here to avoid a circular
 * self-import and to allow other systems (RaceResultsScreen, SettingsMenu)
 * to read XP sources and level data without pulling in the full manager.
 *
 * No logic here — pure data exports only.
 */

/**
 * Base XP amounts per named source.
 * Sources that vary (race_finish: 500–3000) are handled in code;
 * the values here are the fixed amounts referenced by awardXP().
 */
export const XP_SOURCES = {
  // Race
  race_finish:        0,      // computed — see _raceFinishXP()
  race_win:         500,
  race_pb:          300,
  clean_race:       200,

  // World
  landmark:         400,
  board_min:        200,
  board_max:        500,
  drift_per_second:   5,
  speed_trap_gold:  600,

  // Progression
  accolade_min:     500,
  accolade_max:    5000,
  mastery_node:     300,

  // Daily
  daily_login:     1000,
  first_event:     2000,

  // Wheelspin prize (range — actual amount set in prize pool definition)
  wheelspin_xp_min: 2000,
  wheelspin_xp_max: 10000,
};

/**
 * XP threshold bands.
 * Each band defines the XP required to advance through one level
 * for levels up to `max`.
 */
export const LEVEL_THRESHOLDS = [
  { max:  20, xp:  5_000 },
  { max:  50, xp: 12_000 },
  { max: 100, xp: 25_000 },
  { max: 150, xp: 40_000 },
  { max: 200, xp: 60_000 },
  { max: Infinity, xp: 80_000 },   // prestige
];

/**
 * XP multiplier per difficulty setting.
 * These are the same ratios as the credit multipliers in Part 7 §7.7.
 */
export const DIFFICULTY_XP_MULT = {
  tourist:      0.50,
  novice:       0.75,
  experienced:  1.00,
  pro:          1.25,
  unbeatable:   1.50,
};

/**
 * Additive XP bonus (as a fraction) earned when each assist is OFF.
 * Max total when all are off: 0.80 (+80%).
 */
export const ASSIST_XP_BONUS = {
  abs:      0.10,   // ABS off       → +10%
  tc:       0.10,   // TC off        → +10%
  sc:       0.15,   // SC off        → +15%
  steering: 0.10,   // Steering off  → +10%
  braking:  0.20,   // Braking off   → +20%
  manual:   0.15,   // Manual gears  → +15%
};

/** Human-readable labels for the multiplier breakdown panel. */
export const ASSIST_LABELS = {
  abs:      'ABS',
  tc:       'Traction Control',
  sc:       'Stability Control',
  steering: 'Steering Assist',
  braking:  'Braking Assist',
  manual:   'Manual Gears',
};

/**
 * CR bonus per 5-level milestone.
 * Scales from 5,000 early on to 20,000 at high levels.
 */
export const MILESTONE_CR = [
  { maxLevel:  20, cr:  5_000 },
  { maxLevel:  50, cr: 10_000 },
  { maxLevel: 100, cr: 15_000 },
  { maxLevel: Infinity, cr: 20_000 },
];

/**
 * Feature unlocks granted at specific levels.
 * Consumed by ProgressionManager._dispatchLevelRewards().
 * The `feature` string matches what the rest of the game checks via
 *   saveManager.player.hasUnlock('championship')
 */
export const LEVEL_UNLOCKS = {
  10:  { feature: 'championship',       label: 'Championship Events Unlocked' },
  20:  { feature: 's1_races',           label: 'S1 Class Races Unlocked' },
  30:  { feature: 'showcase',           label: 'Showcase Events Unlocked' },
  50:  { feature: 'festival_seasonal',  label: 'Festival Seasonal Challenges Unlocked' },
};

/**
 * Cosmetic / title / car rewards at named milestone levels.
 * type: 'title' | 'clothing' | 'car' | 'cosmetic'
 */
export const LEVEL_COSMETICS = {
  100: {
    type:  'title',
    id:    'legend',
    label: '"Legend" Title Unlocked',
    clothingId: 'legend_driver_suit',   // also grants the suit
  },
  200: {
    type:  'car',
    id:    'icon_hypercar',
    name:  'Horizon Icon Hypercar',
    class: 'S2',
    pr:    999,
    shopPrice: 0,   // not purchasable — Level 200 exclusive
    label: 'Horizon Icon Hypercar Unlocked',
  },
};

/**
 * Daily login reward table.
 * `fixed`    — days 1–4 (index 0–3): credits awarded.
 * `rotation` — days 5+ rotate through this list indefinitely.
 */
export const DAILY_LOGIN_REWARDS = {
  fixed: [5_000, 8_000, 12_000, 20_000],   // Days 1, 2, 3, 4

  rotation: [
    { type: 'xpBoost',  label: 'XP Boost (30 min)' },
    { type: 'credits',  amount: 30_000, label: '30,000 CR' },
    { type: 'wheelspin',label: '1× Wheelspin' },
    { type: 'credits',  amount: 50_000, label: '50,000 CR' },
    { type: 'xpBoost',  label: 'XP Boost (30 min)' },
    { type: 'credits',  amount: 40_000, label: '40,000 CR' },
    // Day 7 (7 % 7 === 0) is handled separately → Super Wheelspin
  ],
};

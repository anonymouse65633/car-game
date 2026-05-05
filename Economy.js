/**
 * js/economy/economy.js
 * Horizon City — Credits economy engine.
 *
 * Responsibilities:
 *   • Persist credit balance to localStorage
 *   • Earn / spend helpers with validation
 *   • All reward-amount tables (races, boards, accolades, etc.)
 *   • Daily-login streak tracking
 *   • Transaction history (last 50 entries)
 *   • Observable balance — listeners notified on every change
 */

// ── Storage keys ───────────────────────────────────────────────────────────────
const STORAGE_KEY_CREDITS     = 'hc_credits';
const STORAGE_KEY_HISTORY     = 'hc_tx_history';
const STORAGE_KEY_LOGIN       = 'hc_login_streak';
const STORAGE_KEY_DAILY_TS    = 'hc_daily_last_ts';
const STORAGE_KEY_SPIN_READY  = 'hc_wheelspin_ready';

// ── Starting values ────────────────────────────────────────────────────────────
export const STARTING_CREDITS   = 50_000;
export const INTRO_BONUS        = 25_000;
const HISTORY_MAX               = 50;

// ── Balance listeners ──────────────────────────────────────────────────────────
const _listeners = new Set();

export function onBalanceChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn); // returns unsubscribe
}

function _notify(balance, delta, reason) {
  _listeners.forEach(fn => fn({ balance, delta, reason }));
}

// ── Core read / write ──────────────────────────────────────────────────────────

export function getBalance() {
  const raw = localStorage.getItem(STORAGE_KEY_CREDITS);
  if (raw === null) return null; // first-run not yet initialised
  return parseInt(raw, 10);
}

function _setBalance(amount) {
  localStorage.setItem(STORAGE_KEY_CREDITS, String(Math.max(0, amount)));
}

/**
 * Initialise economy for a brand-new save.
 * Safe to call multiple times — skips if balance already exists.
 * @param {boolean} [grantIntroBonus=false]
 */
export function initEconomy(grantIntroBonus = false) {
  if (getBalance() !== null) return; // already initialised
  _setBalance(STARTING_CREDITS);
  _addHistory(STARTING_CREDITS, 'STARTING_GRANT', 'New player starting credits');
  if (grantIntroBonus) {
    earn(INTRO_BONUS, 'INTRO_BONUS', 'Intro sequence bonus');
  }
}

// ── Earn / spend ───────────────────────────────────────────────────────────────

/**
 * Add credits to the player's balance.
 * @param {number} amount   Must be a positive integer.
 * @param {string} source   Short code (e.g. 'RACE_WIN', 'WHEELSPIN').
 * @param {string} [label]  Human-readable description for history.
 * @returns {number} New balance.
 */
export function earn(amount, source, label = '') {
  if (!Number.isFinite(amount) || amount <= 0) throw new RangeError(`earn: invalid amount ${amount}`);
  const current = getBalance() ?? 0;
  const next    = current + Math.floor(amount);
  _setBalance(next);
  _addHistory(Math.floor(amount), source, label);
  _notify(next, Math.floor(amount), source);
  return next;
}

/**
 * Deduct credits from the player's balance.
 * @param {number} amount
 * @param {string} source
 * @param {string} [label]
 * @returns {{ success: boolean, balance: number }}
 */
export function spend(amount, source, label = '') {
  if (!Number.isFinite(amount) || amount <= 0) throw new RangeError(`spend: invalid amount ${amount}`);
  const current = getBalance() ?? 0;
  const cost    = Math.floor(amount);
  if (current < cost) {
    return { success: false, balance: current };
  }
  const next = current - cost;
  _setBalance(next);
  _addHistory(-cost, source, label);
  _notify(next, -cost, source);
  return { success: true, balance: next };
}

/**
 * Check whether the player can afford an amount without deducting.
 */
export function canAfford(amount) {
  return (getBalance() ?? 0) >= Math.floor(amount);
}

// ── Transaction history ────────────────────────────────────────────────────────

function _addHistory(delta, source, label) {
  const history = getHistory();
  history.unshift({
    ts:     Date.now(),
    delta,
    source,
    label,
    balance: getBalance(),
  });
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
}

export function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_HISTORY) || '[]');
  } catch {
    return [];
  }
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY_HISTORY);
}

// ── Daily login & streak ───────────────────────────────────────────────────────

/**
 * Attempt to claim the daily login reward.
 * Returns { claimed: true, reward, streak } or { claimed: false, msUntilNext }.
 */
export function claimDailyLogin() {
  const now         = Date.now();
  const lastStr     = localStorage.getItem(STORAGE_KEY_DAILY_TS);
  const lastTs      = lastStr ? parseInt(lastStr, 10) : 0;
  const streakRaw   = localStorage.getItem(STORAGE_KEY_LOGIN);
  let   streak      = streakRaw ? parseInt(streakRaw, 10) : 0;

  const MS_DAY      = 86_400_000;
  const elapsed     = now - lastTs;

  if (elapsed < MS_DAY) {
    return { claimed: false, msUntilNext: MS_DAY - elapsed };
  }

  // Break streak if more than 48 h since last claim
  if (elapsed > MS_DAY * 2) streak = 0;

  streak = Math.min(streak + 1, 7); // cap at 7-day cycle
  const reward = DAILY_LOGIN_REWARDS[streak - 1] ?? DAILY_LOGIN_REWARDS[6];

  localStorage.setItem(STORAGE_KEY_DAILY_TS, String(now));
  localStorage.setItem(STORAGE_KEY_LOGIN, String(streak));

  earn(reward.credits, 'DAILY_LOGIN', `Day ${streak} login reward`);

  // Grant wheelspin on day 3 and day 7
  if (reward.wheelspin) grantWheelspin();

  return { claimed: true, reward, streak };
}

export const DAILY_LOGIN_REWARDS = [
  { day: 1, credits:  3_000, wheelspin: false, label: 'Welcome back!' },
  { day: 2, credits:  5_000, wheelspin: false, label: 'Two days running!' },
  { day: 3, credits:  8_000, wheelspin: true,  label: 'Keep it up — Wheelspin earned!' },
  { day: 4, credits: 10_000, wheelspin: false, label: 'Consistent driver!' },
  { day: 5, credits: 15_000, wheelspin: false, label: 'Five days strong!' },
  { day: 6, credits: 20_000, wheelspin: false, label: 'Almost there!' },
  { day: 7, credits: 30_000, wheelspin: true,  label: '7-day streak — Max Reward!' },
];

// ── Wheelspin tokens ───────────────────────────────────────────────────────────

export function grantWheelspin(count = 1) {
  const current = getWheelspinCount();
  localStorage.setItem(STORAGE_KEY_SPIN_READY, String(current + count));
}

export function getWheelspinCount() {
  return parseInt(localStorage.getItem(STORAGE_KEY_SPIN_READY) || '0', 10);
}

export function consumeWheelspin() {
  const count = getWheelspinCount();
  if (count <= 0) return false;
  localStorage.setItem(STORAGE_KEY_SPIN_READY, String(count - 1));
  return true;
}

// ── Reward tables ──────────────────────────────────────────────────────────────

/**
 * Race payout.
 * position: 1 = win, 2 = second, etc.
 * class: 'D' | 'C' | 'B' | 'A' | 'S1' | 'S2'
 * difficulty: 'easy' | 'normal' | 'hard' | 'unbeatable'
 */
export const RACE_PAYOUTS = {
  // [class][position] base CR  (multiplied by difficulty modifier below)
  D:  [5_000,  3_000, 2_000, 1_500, 1_000],
  C:  [8_000,  5_000, 3_500, 2_500, 1_500],
  B:  [14_000, 9_000, 6_000, 4_000, 2_500],
  A:  [22_000, 14_000, 9_000, 6_000, 4_000],
  S1: [40_000, 25_000, 15_000, 10_000, 7_000],
  S2: [80_000, 50_000, 30_000, 20_000, 12_000],
};

export const DIFFICULTY_MULTIPLIER = {
  easy:        0.75,
  normal:      1.00,
  hard:        1.40,
  unbeatable:  1.80,
};

/**
 * Calculate race reward for a given result.
 * @param {object} p
 * @param {string} p.carClass   'D'|'C'|'B'|'A'|'S1'|'S2'
 * @param {number} p.position   1-indexed finishing position
 * @param {string} p.difficulty
 * @param {boolean} [p.championship] Championship races pay an extra 20%
 * @returns {number} Credits earned (floored to nearest 50)
 */
export function calcRacePayout({ carClass, position, difficulty, championship = false }) {
  const table  = RACE_PAYOUTS[carClass] ?? RACE_PAYOUTS['D'];
  const idx    = Math.min(position - 1, table.length - 1);
  const base   = table[idx];
  const mult   = DIFFICULTY_MULTIPLIER[difficulty] ?? 1.0;
  const bonus  = championship ? 1.20 : 1.00;
  return Math.floor((base * mult * bonus) / 50) * 50;
}

/** Grant & record a race reward. */
export function awardRacePayout(params) {
  const amount = calcRacePayout(params);
  const label  = `Race ${params.position === 1 ? 'WIN' : `P${params.position}`} — ${params.carClass} class`;
  earn(amount, params.position === 1 ? 'RACE_WIN' : 'RACE_FINISH', label);
  return amount;
}

// ── Credit board bonuses ───────────────────────────────────────────────────────

export const CREDIT_BOARD_AMOUNTS = [500, 750, 1_000, 1_250, 1_500, 2_000];

export function awardCreditBoard(tier = 0) {
  const amount = CREDIT_BOARD_AMOUNTS[Math.min(tier, CREDIT_BOARD_AMOUNTS.length - 1)];
  earn(amount, 'CREDIT_BOARD', `Driving Bonus Board smash (tier ${tier + 1})`);
  return amount;
}

// ── Landmark discovery ─────────────────────────────────────────────────────────

export const LANDMARK_REWARD = 1_000;

export function awardLandmark(landmarkId, landmarkName) {
  earn(LANDMARK_REWARD, 'LANDMARK', `Discovered: ${landmarkName}`);
  return LANDMARK_REWARD;
}

// ── Accolade rewards ───────────────────────────────────────────────────────────

/** Tier 1–5 accolades scale from 2 000 → 25 000 CR */
export const ACCOLADE_TIER_REWARDS = {
  1: 2_000,
  2: 5_000,
  3: 10_000,
  4: 18_000,
  5: 25_000,
};

export function awardAccolade(tier, accoladeLabel) {
  const amount = ACCOLADE_TIER_REWARDS[tier] ?? 2_000;
  earn(amount, 'ACCOLADE', `Accolade: ${accoladeLabel}`);
  return amount;
}

// ── Wheelspin prize pool ───────────────────────────────────────────────────────

/**
 * Complete weighted prize pool drawn by spinWheelspin().
 * Each entry: { type, label, value, weight }
 *   type: 'credits' | 'car' | 'clothing'
 */
export const WHEELSPIN_PRIZES = [
  // Credits (most common)
  { type: 'credits', label: '5,000 CR',    value: 5_000,    weight: 20 },
  { type: 'credits', label: '10,000 CR',   value: 10_000,   weight: 18 },
  { type: 'credits', label: '15,000 CR',   value: 15_000,   weight: 14 },
  { type: 'credits', label: '25,000 CR',   value: 25_000,   weight: 10 },
  { type: 'credits', label: '50,000 CR',   value: 50_000,   weight:  6 },
  { type: 'credits', label: '75,000 CR',   value: 75_000,   weight:  4 },
  { type: 'credits', label: '100,000 CR',  value: 100_000,  weight:  2 },
  // Clothing (common)
  { type: 'clothing', label: 'Rare Helmet',     value: 'helmet_rare_spin',   weight: 8 },
  { type: 'clothing', label: 'Exclusive Suit',  value: 'suit_exclusive_spin', weight: 5 },
  { type: 'clothing', label: 'Rare Shoes',      value: 'shoes_rare_spin',    weight: 6 },
  // Car (rare)
  { type: 'car', label: 'D-Class Car',  value: 'SPIN_D',  weight: 4 },
  { type: 'car', label: 'C-Class Car',  value: 'SPIN_C',  weight: 2 },
  { type: 'car', label: 'B-Class Car',  value: 'SPIN_B',  weight: 1 },
];

const _totalWeight = WHEELSPIN_PRIZES.reduce((s, p) => s + p.weight, 0);

/**
 * Draw one random Wheelspin prize using weighted selection.
 * Automatically grants credits if prize type is 'credits'.
 * Returns the prize entry.
 */
export function spinWheelspin() {
  if (!consumeWheelspin()) return null;

  let roll = Math.random() * _totalWeight;
  let prize = WHEELSPIN_PRIZES[WHEELSPIN_PRIZES.length - 1];

  for (const p of WHEELSPIN_PRIZES) {
    roll -= p.weight;
    if (roll <= 0) { prize = p; break; }
  }

  if (prize.type === 'credits') {
    earn(prize.value, 'WHEELSPIN', `Wheelspin: ${prize.label}`);
  }

  return prize;
}

// ── Barn Find sell values ──────────────────────────────────────────────────────

export const BARN_FIND_SELL_MIN = 15_000;
export const BARN_FIND_SELL_MAX = 150_000;

export function calcBarnFindValue(carPR) {
  // Linear interpolation across PR 100–999
  const t = Math.min(Math.max((carPR - 100) / 899, 0), 1);
  return Math.round((BARN_FIND_SELL_MIN + t * (BARN_FIND_SELL_MAX - BARN_FIND_SELL_MIN)) / 1_000) * 1_000;
}

// ── Festival Playlist rewards ──────────────────────────────────────────────────

export const PLAYLIST_REWARD_RANGES = {
  weekly_chapter:     { min: 25_000,  max: 50_000  },
  seasonal_complete:  { min: 50_000,  max: 100_000 },
  series_complete:    { min: 100_000, max: 250_000 },
};

// ── Car Mastery node rewards ───────────────────────────────────────────────────

/** Node rewards in CR — mastery trees range from 10 000 → 50 000 CR */
export const MASTERY_NODE_REWARDS = [
  10_000, 10_000, 15_000, 20_000,
  25_000, 30_000, 40_000, 50_000,
];

// ── Championship entry fees ────────────────────────────────────────────────────

export const CHAMPIONSHIP_ENTRY_FEE = {
  standard:  0,
  champion:  1_000,
  elite:     10_000,
};

export const CHAMPIONSHIP_PAYOUT_MULTIPLIER = {
  standard: 1.0,
  champion: 5.0,
  elite:    10.0,
};

// ── Sell-back calculation ──────────────────────────────────────────────────────

export const SELL_BACK_RATE = 0.60; // 60% of purchase price

export function calcSellBackValue(purchasePrice) {
  return Math.floor(purchasePrice * SELL_BACK_RATE);
}

// ── Economy balance summary (dev/debug helper) ─────────────────────────────────

export function getEconomySummary() {
  return {
    balance:       getBalance(),
    wheelspins:    getWheelspinCount(),
    historyLength: getHistory().length,
    loginStreak:   parseInt(localStorage.getItem(STORAGE_KEY_LOGIN) || '0', 10),
    lastLogin:     parseInt(localStorage.getItem(STORAGE_KEY_DAILY_TS) || '0', 10),
  };
}

// ── Reset (for dev / new-game-plus) ───────────────────────────────────────────

export function resetEconomy() {
  [
    STORAGE_KEY_CREDITS,
    STORAGE_KEY_HISTORY,
    STORAGE_KEY_LOGIN,
    STORAGE_KEY_DAILY_TS,
    STORAGE_KEY_SPIN_READY,
  ].forEach(k => localStorage.removeItem(k));
}
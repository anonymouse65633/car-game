/**
 * DailyRewardManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages all daily login and first-event rewards for Horizon City.
 *
 * Responsibilities:
 *  - Daily login streak tracking (resets if a calendar day is missed)
 *  - Day 1–4 fixed rewards, Day 5+ rotating reward pool
 *  - 7-day streak bonus: 1× Super Wheelspin
 *  - First-race/challenge bonus each calendar day: +2,000 XP + 5,000 CR
 *  - Auto-show reward UI on game startup
 *  - Streak display data for the Phone Menu profile tab
 *
 * Dependencies (global singletons):
 *  - SaveManager        — persist streak data
 *  - EconomyManager     — addCredits()
 *  - ProgressionManager — addXP(), addWheelspin(), addSuperWheelspin()
 *  - NotificationSystem — toast display
 *  - AudioManager       — reward sting SFX
 *
 * Usage:
 *  dailyRewardManager.checkOnStartup();        // call once when game loads
 *  dailyRewardManager.reportEventCompleted();  // call after any race/challenge
 *  dailyRewardManager.claimLoginReward();      // called by startup reward UI
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { saveManager } from '../save/SaveManager.js';

// ─── Day 1–4 Fixed Rewards ────────────────────────────────────────────────────

const FIXED_DAY_REWARDS = [
  { day: 1, type: 'credits', amount: 5000,  label: '5,000 CR' },
  { day: 2, type: 'credits', amount: 8000,  label: '8,000 CR' },
  { day: 3, type: 'credits', amount: 12000, label: '12,000 CR' },
  { day: 4, type: 'credits', amount: 20000, label: '20,000 CR' },
];

// ─── Day 5+ Rotating Reward Pool ──────────────────────────────────────────────
// Picked by seeded rotation so the sequence is predictable per day-number.

const ROTATING_REWARD_POOL = [
  { type: 'credits',       amount: 25000, label: '25,000 CR',          weight: 4 },
  { type: 'credits',       amount: 40000, label: '40,000 CR',          weight: 3 },
  { type: 'credits',       amount: 60000, label: '60,000 CR',          weight: 2 },
  { type: 'xp_boost',      amount: 1,     label: 'XP Boost (30 min)',  weight: 3 },
  { type: 'wheelspin',     amount: 1,     label: '1× Wheelspin',       weight: 3 },
  { type: 'super_wheelspin', amount: 1,   label: '1× Super Wheelspin', weight: 1 },
];

// ─── 7-Day Streak Bonus ───────────────────────────────────────────────────────

const STREAK_MILESTONE_REWARD = {
  type:   'super_wheelspin',
  amount: 1,
  label:  '1× Super Wheelspin (7-Day Streak!)',
};

// ─── First Daily Event Bonus ──────────────────────────────────────────────────

const FIRST_EVENT_XP      = 2000;
const FIRST_EVENT_CREDITS = 5000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a YYYY-MM-DD string in UTC for a given Date (or now). */
function toUTCDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Returns today's UTC date string. */
function todayUTC() {
  return toUTCDateString(new Date());
}

/**
 * Returns the UTC date string for yesterday.
 * Used to check whether the streak is still intact.
 */
function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return toUTCDateString(d);
}

/**
 * Simple seeded PRNG (mulberry32) — deterministic per day number.
 * Keeps the rotating pool consistent for a given day regardless of when
 * the player logs in during that day.
 *
 * @param {number} seed
 * @returns {function(): number} 0–1 float generator
 */
function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted pick from ROTATING_REWARD_POOL using the seeded RNG.
 *
 * @param {number} dayNumber  Absolute day streak count (5, 6, 8, 9, …)
 * @returns {Object} reward entry
 */
function pickRotatingReward(dayNumber) {
  const rng   = seededRng(dayNumber * 1337 + 42);
  const total = ROTATING_REWARD_POOL.reduce((s, r) => s + r.weight, 0);
  let roll    = rng() * total;

  for (const reward of ROTATING_REWARD_POOL) {
    roll -= reward.weight;
    if (roll <= 0) return reward;
  }
  return ROTATING_REWARD_POOL[0]; // fallback
}

// ─── DailyRewardManager Class ─────────────────────────────────────────────────

class DailyRewardManager {
  constructor() {
    // Loaded from SaveManager in _loadState()
    this._streak          = 0;       // current consecutive login streak
    this._lastLoginDate   = null;    // YYYY-MM-DD of last login reward claim
    this._loginClaimed    = false;   // whether today's login reward has been claimed
    this._eventBonusDone  = false;   // whether today's first-event bonus has fired
    this._totalDaysPlayed = 0;       // lifetime login days (never resets)

    // Transient — set during checkOnStartup, read by the startup reward UI
    this._pendingReward   = null;

    this._loadState();
    console.log('[DailyRewardManager] Initialised — streak:', this._streak, '| last login:', this._lastLoginDate);
  }

  // ─── Save / Load ────────────────────────────────────────────────────────

  _loadState() {
    const saved = saveManager.get('player', 'dailyRewards') || {};
    this._streak          = saved.streak          ?? 0;
    this._lastLoginDate   = saved.lastLoginDate   ?? null;
    this._loginClaimed    = saved.loginClaimed    ?? false;
    this._eventBonusDone  = saved.eventBonusDone  ?? false;
    this._totalDaysPlayed = saved.totalDaysPlayed ?? 0;
  }

  _saveState() {
    saveManager.set('player', 'dailyRewards', {
      streak:          this._streak,
      lastLoginDate:   this._lastLoginDate,
      loginClaimed:    this._loginClaimed,
      eventBonusDone:  this._eventBonusDone,
      totalDaysPlayed: this._totalDaysPlayed,
    });
  }

  // ─── Startup Check ───────────────────────────────────────────────────────

  /**
   * Call once when the game finishes loading.
   * Evaluates whether it's a new calendar day and prepares the pending reward.
   * Does NOT grant anything yet — waits for the player to interact with
   * the startup reward screen (claimLoginReward()).
   *
   * @returns {{ shouldShow: boolean, reward: Object|null, streak: number }}
   */
  checkOnStartup() {
    const today     = todayUTC();
    const yesterday = yesterdayUTC();

    // Same day — reward already claimed or not yet, no streak change
    if (this._lastLoginDate === today) {
      if (!this._loginClaimed) {
        // Edge case: game crashed after date update but before claim
        this._pendingReward = this._buildRewardForStreak(this._streak);
        return { shouldShow: true, reward: this._pendingReward, streak: this._streak };
      }
      return { shouldShow: false, reward: null, streak: this._streak };
    }

    // New day — evaluate streak
    if (this._lastLoginDate === yesterday) {
      // Consecutive day — increment streak
      this._streak++;
    } else {
      // Missed one or more days — reset streak
      if (this._lastLoginDate !== null) {
        console.log('[DailyRewardManager] Streak broken. Was:', this._streak, '→ resetting to 1.');
      }
      this._streak = 1;
    }

    this._lastLoginDate   = today;
    this._loginClaimed    = false;
    this._eventBonusDone  = false;
    this._totalDaysPlayed++;

    this._pendingReward = this._buildRewardForStreak(this._streak);
    this._saveState();

    console.log('[DailyRewardManager] New day detected. Streak:', this._streak,
      '| Reward:', this._pendingReward.label);

    return {
      shouldShow: true,
      reward:     this._pendingReward,
      streak:     this._streak,
    };
  }

  // ─── Claim Login Reward ──────────────────────────────────────────────────

  /**
   * Grants the pending daily login reward to the player.
   * Called when the player dismisses / interacts with the startup reward screen.
   *
   * @returns {{ success: boolean, reward: Object|null, streakMilestone: boolean }}
   */
  claimLoginReward() {
    if (this._loginClaimed) {
      return { success: false, reward: null, streakMilestone: false };
    }
    if (!this._pendingReward) {
      // Rebuild in case of cold-start edge case
      this._pendingReward = this._buildRewardForStreak(this._streak);
    }

    const reward = this._pendingReward;
    this._dispatchReward(reward);

    // Check 7-day streak milestone
    let streakMilestone = false;
    if (this._streak > 0 && this._streak % 7 === 0) {
      this._dispatchReward(STREAK_MILESTONE_REWARD);
      streakMilestone = true;
      NotificationSystem.show({
        type:     'streak_milestone',
        title:    '🔥 7-Day Streak!',
        body:     'You\'ve logged in 7 days in a row — here\'s a Super Wheelspin!',
        duration: 6000,
      });
    }

    this._loginClaimed  = true;
    this._pendingReward = null;
    this._saveState();

    // Main toast
    NotificationSystem.show({
      type:     'daily_login',
      title:    `📅 Day ${this._streak} Login Reward`,
      body:     reward.label,
      subtext:  streakMilestone
        ? '🔥 7-Day Streak Bonus also claimed!'
        : `${this._streak} day streak${this._streak >= 7 ? ' 🔥' : ''}`,
      duration: 5000,
    });

    if (typeof AudioManager !== 'undefined') {
      AudioManager.play('sfx_reward_claim');
    }

    window.dispatchEvent(new CustomEvent('dailyreward:claimed', {
      detail: { reward, streak: this._streak, streakMilestone },
    }));

    console.log(`[DailyRewardManager] Login reward claimed — Day ${this._streak}:`, reward.label,
      streakMilestone ? '+ 7-day bonus' : '');

    return { success: true, reward, streakMilestone };
  }

  // ─── First Daily Event Bonus ─────────────────────────────────────────────

  /**
   * Call after any race or challenge completes.
   * Grants the first-event bonus once per calendar day.
   *
   * @returns {boolean} true if the bonus was granted this call
   */
  reportEventCompleted() {
    if (this._eventBonusDone) return false;

    // Guard: only award if we're in the correct day state
    const today = todayUTC();
    if (this._lastLoginDate !== today) {
      // Shouldn't happen in normal play — startup check handles date transitions
      console.warn('[DailyRewardManager] reportEventCompleted called before checkOnStartup for today.');
      return false;
    }

    this._eventBonusDone = true;
    this._saveState();

    EconomyManager.addCredits(FIRST_EVENT_CREDITS, 'first_daily_event_bonus');
    ProgressionManager.addXP(FIRST_EVENT_XP, 'first_daily_event_bonus');

    NotificationSystem.show({
      type:     'first_event_bonus',
      title:    '⚡ First Event Bonus!',
      body:     `+${FIRST_EVENT_XP.toLocaleString()} XP  ·  +${FIRST_EVENT_CREDITS.toLocaleString()} CR`,
      subtext:  'First event of the day complete.',
      duration: 4500,
    });

    if (typeof AudioManager !== 'undefined') {
      AudioManager.play('sfx_bonus_ding');
    }

    window.dispatchEvent(new CustomEvent('dailyreward:firstEventBonus', {
      detail: { xp: FIRST_EVENT_XP, credits: FIRST_EVENT_CREDITS },
    }));

    console.log('[DailyRewardManager] First-event bonus granted:', FIRST_EVENT_XP, 'XP +', FIRST_EVENT_CREDITS, 'CR');
    return true;
  }

  // ─── Reward Builder ──────────────────────────────────────────────────────

  /**
   * Returns the reward object for a given streak day.
   * Days 1–4 are fixed; day 5+ uses the seeded rotating pool.
   *
   * @param {number} streakDay  1-based current streak count
   * @returns {Object} reward entry
   */
  _buildRewardForStreak(streakDay) {
    if (streakDay <= 4) {
      return { ...FIXED_DAY_REWARDS[streakDay - 1] };
    }
    return { ...pickRotatingReward(streakDay) };
  }

  // ─── Reward Dispatch ─────────────────────────────────────────────────────

  /**
   * Routes a reward object to the correct manager method.
   *
   * @param {{ type: string, amount: number }} reward
   */
  _dispatchReward(reward) {
    switch (reward.type) {
      case 'credits':
        EconomyManager.addCredits(reward.amount, 'daily_login_reward');
        break;
      case 'xp_boost':
        ProgressionManager.activateXPBoost(30 * 60 * 1000); // 30 minutes in ms
        break;
      case 'wheelspin':
        ProgressionManager.addWheelspin(reward.amount, 'daily_login_reward');
        break;
      case 'super_wheelspin':
        ProgressionManager.addSuperWheelspin(reward.amount, 'daily_login_reward');
        break;
      default:
        console.warn('[DailyRewardManager] Unknown reward type:', reward.type);
    }
  }

  // ─── UI Query Helpers ────────────────────────────────────────────────────

  /**
   * Full streak display data for the Phone Menu Profile tab and
   * the startup reward overlay.
   *
   * @returns {Object}
   */
  getStreakInfo() {
    const today          = todayUTC();
    const isNewDay       = this._lastLoginDate !== today;
    const daysToMilestone = 7 - ((this._streak % 7) || 7);

    // Build the 7-slot visual strip (days relative to the current streak position)
    const stripStart = Math.floor((this._streak - 1) / 7) * 7; // start of current 7-day block
    const slots = Array.from({ length: 7 }, (_, i) => {
      const dayNum = stripStart + i + 1;
      const isMilestone = dayNum % 7 === 0;
      const reward = this._buildRewardForStreak(dayNum);
      return {
        dayNum,
        label:       reward.label,
        isMilestone,
        claimed:     dayNum < this._streak || (dayNum === this._streak && this._loginClaimed),
        isToday:     dayNum === this._streak,
        rewardType:  isMilestone ? 'super_wheelspin' : reward.type,
      };
    });

    return {
      streak:             this._streak,
      lastLoginDate:      this._lastLoginDate,
      loginClaimedToday:  !isNewDay && this._loginClaimed,
      eventBonusDoneToday: !isNewDay && this._eventBonusDone,
      totalDaysPlayed:    this._totalDaysPlayed,
      daysToMilestone:    daysToMilestone === 7 ? 0 : daysToMilestone, // 0 = just hit milestone
      pendingReward:      this._pendingReward,
      streakSlots:        slots,
      nextRewardPreview:  this._buildRewardForStreak(this._streak + (this._loginClaimed ? 1 : 0)),
    };
  }

  /**
   * Whether the startup reward screen should be shown right now.
   * Called by the boot sequence after checkOnStartup() to decide
   * whether to display the reward modal.
   *
   * @returns {boolean}
   */
  hasPendingLoginReward() {
    return this._pendingReward !== null && !this._loginClaimed;
  }

  /**
   * Whether the player has already claimed their first-event bonus today.
   *
   * @returns {boolean}
   */
  hasEventBonusFired() {
    return this._eventBonusDone;
  }

  /**
   * Current streak count.
   *
   * @returns {number}
   */
  getStreak() {
    return this._streak;
  }

  /**
   * Reward preview for a specific future day — used by the streak UI to
   * show upcoming rewards across the 7-day strip.
   *
   * @param {number} streakDay
   * @returns {Object}
   */
  previewRewardForDay(streakDay) {
    if (streakDay % 7 === 0) return { ...STREAK_MILESTONE_REWARD };
    return this._buildRewardForStreak(streakDay);
  }

  /**
   * Lifetime stats for the Profile screen.
   *
   * @returns {{ streak: number, totalDaysPlayed: number, lastLogin: string|null }}
   */
  getLifetimeStats() {
    return {
      streak:          this._streak,
      totalDaysPlayed: this._totalDaysPlayed,
      lastLogin:       this._lastLoginDate,
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

const dailyRewardManager = new DailyRewardManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DailyRewardManager, dailyRewardManager };
}
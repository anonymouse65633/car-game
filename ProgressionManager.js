/**
 * ProgressionManager.js
 * Owns all XP accounting, level-up logic, and daily/first-event bonuses.
 *
 * Responsibilities:
 *  - Accept XP from every labelled source via awardXP() / awardRaceXP()
 *  - Apply the full multiplier stack:
 *      difficulty × (1 + assist-off bonuses) × XP boost item
 *  - Detect level-ups (a single award can span multiple levels)
 *  - Dispatch per-level rewards — Wheelspin every level, CR at 5-level
 *    milestones, Super Wheelspin every 10th level, feature unlocks and
 *    cosmetics at named milestone levels
 *  - Track the UTC-day login streak and first-event-of-the-day bonus gate
 *  - Fire typed events so HUDManager / NotificationSystem can react without
 *    direct coupling back into this module
 *
 * Dependencies:
 *  - SaveManager  (read / write player, inventory sections)
 *  - NotificationSystem (optional — passed in, can be null)
 *
 * Usage:
 *   import { saveManager } from '../save/SaveManager.js';
 *   const pm = new ProgressionManager(saveManager, notificationSystem);
 *
 *   // On game start
 *   pm.checkDailyLogin();
 *
 *   // After finishing a race
 *   pm.awardRaceXP({
 *     position: 1, totalRacers: 6,
 *     distanceKm: 4.2,
 *     cleanRace: true, newPB: true,
 *     difficulty: 'pro',
 *     assists: { abs: false, tc: false, sc: true,
 *                steering: true, braking: true, manual: true },
 *   });
 *
 *   // For non-race sources
 *   pm.awardXP('landmark', 400);
 *   pm.awardXP('board',    300);
 *   pm.awardXP('drift',    5 * driftSeconds, { applyMultipliers: false });
 *
 *   // Listen for HUD animations
 *   pm.on('levelUp', ({ oldLevel, newLevel, rewards }) => { … });
 *   pm.on('xpGained', ({ source, base, final, multiplier }) => { … });
 */

import { XP_SOURCES, LEVEL_THRESHOLDS, DIFFICULTY_XP_MULT,
         ASSIST_XP_BONUS, ASSIST_LABELS, MILESTONE_CR, LEVEL_UNLOCKS,
         LEVEL_COSMETICS, DAILY_LOGIN_REWARDS } from './progressionData.js';

export class ProgressionManager {
  /* ─────────────────────────── constructor ────────────────────────────── */

  /**
   * @param {import('./SaveManager.js').SaveManager} saveManager
   * @param {object|null} notificationSystem  - optional NotificationSystem instance
   */
  constructor(saveManager, notificationSystem = null) {
    this._save   = saveManager;
    this._notify = notificationSystem;

    /** Registered event listeners: Map<string, Function[]> */
    this._listeners = new Map();
  }

  /* ─────────────────────────── public API ─────────────────────────────── */

  // ── XP awards ──────────────────────────────────────────────────────────

  /**
   * Award XP from any source.
   *
   * @param {string} source
   *   One of the keys in XP_SOURCES, or a freeform label for display.
   * @param {number} baseAmount
   *   Raw XP before multipliers.
   * @param {object} [opts]
   * @param {boolean}  [opts.applyMultipliers=true]
   *   Set false for fixed XP (e.g. daily login bonus, accolade XP reward)
   *   that should not be multiplied by difficulty/assists/boost.
   * @param {string}   [opts.difficulty]
   *   Override current settings difficulty for this award.
   * @param {object}   [opts.assists]
   *   Override current settings assists for this award.
   * @returns {{ base: number, final: number, multiplier: number, levelsGained: number }}
   */
  awardXP(source, baseAmount, opts = {}) {
    const {
      applyMultipliers = true,
      difficulty       = this._save.settings.get('difficulty', 'experienced'),
      assists          = this._currentAssists(),
    } = opts;

    const base       = Math.max(0, Math.round(baseAmount));
    const multiplier = applyMultipliers ? this._buildMultiplier(difficulty, assists) : 1;
    const final      = Math.round(base * multiplier);

    if (final <= 0) return { base, final: 0, multiplier, levelsGained: 0 };

    // Write to save
    const player     = this._save._data.player;
    player.xp        += final;
    player.totalXP   += final;
    this._save.markDirty();

    // Level-up loop
    const levelsGained = this._processLevelUps();

    // Notify listeners
    this._emit('xpGained', { source, base, final, multiplier, levelsGained });

    // Toast (non-intrusive — only for notable sources)
    if (this._notify && NOTABLE_SOURCES.includes(source)) {
      this._notify.show(`+${final.toLocaleString()} XP`, 'xp', 'small');
    }

    return { base, final, multiplier, levelsGained };
  }

  /**
   * Convenience wrapper that calculates all the XP components for a race
   * finish, then calls awardXP() once per component so each source fires
   * its own 'xpGained' event and the HUD can display them line-by-line
   * in the results screen.
   *
   * @param {object} result
   * @param {number}  result.position        1-based finishing position
   * @param {number}  result.totalRacers
   * @param {number}  result.distanceKm
   * @param {boolean} result.cleanRace       no rewinds used
   * @param {boolean} result.newPB           new personal best time
   * @param {string}  result.difficulty      tourist|novice|experienced|pro|unbeatable
   * @param {object}  result.assists         { abs, tc, sc, steering, braking, manual }
   * @returns {object[]}  array of { source, base, final, multiplier } for the results screen
   */
  awardRaceXP(result) {
    const { position, totalRacers, distanceKm,
            cleanRace, newPB, difficulty, assists } = result;

    const opts = { applyMultipliers: true, difficulty, assists };

    // Base finish XP — scales with position (1st gets full, last gets ~1/6)
    const finishBase = this._raceFinishXP(position, totalRacers, distanceKm);

    const breakdown = [];

    // 1. Finish XP
    breakdown.push({
      source: 'race_finish',
      label:  position === 1 ? 'Race Win' : `Finished ${this._ordinal(position)}`,
      ...this.awardXP('race_finish', finishBase, opts),
    });

    // 2. Win bonus
    if (position === 1) {
      breakdown.push({
        source: 'race_win',
        label:  'Win Bonus',
        ...this.awardXP('race_win', XP_SOURCES.race_win, opts),
      });
    }

    // 3. Personal best
    if (newPB) {
      breakdown.push({
        source: 'race_pb',
        label:  'Personal Best',
        ...this.awardXP('race_pb', XP_SOURCES.race_pb, opts),
      });
    }

    // 4. Clean race (no rewinds)
    if (cleanRace) {
      breakdown.push({
        source: 'clean_race',
        label:  'Clean Race',
        ...this.awardXP('clean_race', XP_SOURCES.clean_race, opts),
      });
    }

    // First-event-of-the-day bonus (fixed — no multiplier)
    const firstEventBonus = this._claimFirstEventBonus();
    if (firstEventBonus > 0) {
      breakdown.push({
        source: 'first_event',
        label:  'First Event Today',
        base:   firstEventBonus,
        final:  firstEventBonus,
        multiplier: 1,
        levelsGained: this.awardXP('first_event', firstEventBonus,
                        { applyMultipliers: false }).levelsGained,
      });
    }

    return breakdown;
  }

  // ── Specific source helpers ─────────────────────────────────────────────

  /** Award landmark discovery XP. Fixed — not multiplied. */
  awardLandmarkXP(landmarkId) {
    return this.awardXP('landmark', XP_SOURCES.landmark,
                        { applyMultipliers: false });
  }

  /** Award board collection XP. boardXP = 200–500 per game design doc. */
  awardBoardXP(boardXP) {
    return this.awardXP('board', boardXP, { applyMultipliers: false });
  }

  /**
   * Award drift XP — called every second the player sustains a drift
   * in a Drift Zone. No multipliers (performance-sensitive path).
   */
  awardDriftXP() {
    return this.awardXP('drift', XP_SOURCES.drift_per_second,
                        { applyMultipliers: false });
  }

  /** Award speed trap gold XP. */
  awardSpeedTrapXP() {
    return this.awardXP('speed_trap', XP_SOURCES.speed_trap_gold,
                        { applyMultipliers: false });
  }

  /** Award XP for completing an accolade (called by AccoladeManager). */
  awardAccoladeXP(xpAmount) {
    return this.awardXP('accolade', xpAmount, { applyMultipliers: false });
  }

  /** Award XP for unlocking a Car Mastery node (called by CarMasteryManager). */
  awardMasteryXP() {
    return this.awardXP('mastery_node', XP_SOURCES.mastery_node,
                        { applyMultipliers: false });
  }

  /**
   * Award XP prize from a Wheelspin (called by WheelspinUI / InventoryStore).
   * Amount varies — 2,000 – 10,000 per game design doc.
   */
  awardWheelspinXP(amount) {
    return this.awardXP('wheelspin_xp', amount, { applyMultipliers: false });
  }

  // ── Daily / login ───────────────────────────────────────────────────────

  /**
   * Call once on game startup. Detects whether a new UTC day has started,
   * awards the login streak bonus, resets the first-event gate, and returns
   * the reward object so the startup screen can display it.
   *
   * @returns {{ isNewDay: boolean, streakDays: number, reward: object|null }}
   */
  checkDailyLogin() {
    const today  = this._utcDateString();
    const player = this._save._data.player;

    const lastLogin = player.lastLoginDate;

    // Not a new day
    if (lastLogin === today) {
      return { isNewDay: false, streakDays: player.loginStreakDays, reward: null };
    }

    // Check if streak continues or resets
    const yesterday = this._utcDateString(-1);
    const continued = lastLogin === yesterday;

    player.loginStreakDays    = continued ? (player.loginStreakDays ?? 0) + 1 : 1;
    player.lastLoginDate      = today;
    player.firstEventDoneToday = false;
    this._save.markDirty();

    const reward = this._grantLoginReward(player.loginStreakDays);

    this._emit('dailyLogin', {
      streakDays: player.loginStreakDays,
      continued,
      reward,
    });

    return { isNewDay: true, streakDays: player.loginStreakDays, reward };
  }

  // ── Multiplier introspection ────────────────────────────────────────────

  /**
   * Calculate and return the current XP multiplier without awarding anything.
   * Useful for the results screen to preview the multiplier before confirming.
   *
   * @param {string} difficulty
   * @param {object} assists   { abs, tc, sc, steering, braking, manual }
   * @returns {number}  e.g. 2.4
   */
  getMultiplier(difficulty, assists) {
    return this._buildMultiplier(difficulty, assists);
  }

  /**
   * Returns a human-readable breakdown of how the multiplier is composed.
   * Used by the race results screen to show the XP breakdown panel.
   *
   * @returns {object[]}  [{ label, value, type: 'base'|'difficulty'|'assist'|'boost' }]
   */
  getMultiplierBreakdown(difficulty, assists) {
    const lines = [];

    lines.push({ label: 'Base',       value: 1.0,     type: 'base' });

    const diffMult = DIFFICULTY_XP_MULT[difficulty] ?? 1.0;
    if (diffMult !== 1.0) {
      lines.push({ label: `Difficulty (${difficulty})`, value: diffMult, type: 'difficulty' });
    }

    let assistBonus = 0;
    for (const [key, bonus] of Object.entries(ASSIST_XP_BONUS)) {
      if (assists && assists[key] === false) {
        assistBonus += bonus;
        lines.push({
          label: `${ASSIST_LABELS[key]} off`,
          value: bonus,
          type:  'assist',
        });
      }
    }

    const boostActive = this._save.player.checkXPBoost();
    if (boostActive) {
      lines.push({ label: 'XP Boost (2×)', value: 2.0, type: 'boost' });
    }

    const total = diffMult * (1 + assistBonus) * (boostActive ? 2 : 1);
    lines.push({ label: 'Total Multiplier', value: total, type: 'total' });

    return lines;
  }

  // ── Read helpers ────────────────────────────────────────────────────────

  /** Current level. */
  getLevel() {
    return this._save._data.player.level ?? 1;
  }

  /** Current XP within the current level (for progress bar display). */
  getLevelProgress() {
    const player   = this._save._data.player;
    const xpInLevel = player.xp ?? 0;
    const required  = player.xpToNextLevel ?? this._xpForLevel(player.level ?? 1);
    return { current: xpInLevel, required, fraction: Math.min(1, xpInLevel / required) };
  }

  /** Returns which milestone badge tier the level falls into. */
  getLevelBadgeTier(level = this.getLevel()) {
    if (level >= 200) return 'icon';
    if (level >= 100) return 'legend';
    if (level >= 50)  return 'elite';
    if (level >= 25)  return 'veteran';
    if (level >= 10)  return 'racer';
    return 'rookie';
  }

  // ── Event bus ───────────────────────────────────────────────────────────

  /**
   * @param {string}   event  - 'xpGained' | 'levelUp' | 'prestige' |
   *                            'dailyLogin' | 'firstEventBonus'
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

  /* ─────────────────────────── level-up loop ──────────────────────────── */

  /**
   * Consume accumulated XP from player.xp and increment player.level
   * until XP runs out or the current level's threshold is not reached.
   * A single large XP award (e.g., 10,000 XP at level 2) can push the
   * player through multiple levels in one call.
   *
   * @returns {number} count of levels gained this call
   */
  _processLevelUps() {
    const player    = this._save._data.player;
    let levelsGained = 0;

    // Loop until XP is exhausted or level threshold not met
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const threshold = player.xpToNextLevel ?? this._xpForLevel(player.level);

      if ((player.xp ?? 0) < threshold) break;

      // Level up
      player.xp      -= threshold;
      player.level    = (player.level ?? 1) + 1;
      levelsGained++;

      const newLevel  = player.level;

      // Recalculate next threshold
      player.xpToNextLevel = this._xpForLevel(newLevel);

      // Dispatch rewards for this level
      const rewards = this._dispatchLevelRewards(newLevel);

      // Emit event — HUDManager listens to trigger the level-up animation
      this._emit('levelUp', {
        oldLevel: newLevel - 1,
        newLevel,
        rewards,
        levelsGained,
      });

      // Prestige detection
      if (newLevel > 200 && newLevel % 200 === 1) {
        player.prestigeLevel = (player.prestigeLevel ?? 0) + 1;
        this._emit('prestige', { prestigeLevel: player.prestigeLevel });
      }

      // Safety: never loop more than 50 levels in a single award
      // (guards against a bug producing infinite XP)
      if (levelsGained >= 50) {
        console.warn('[ProgressionManager] 50-level cap hit in a single award. Check XP source.');
        break;
      }
    }

    if (levelsGained > 0) this._save.markDirty();
    return levelsGained;
  }

  /* ─────────────────────────── reward dispatch ────────────────────────── */

  /**
   * Grant all rewards appropriate for reaching `level`.
   * Rewards are pushed directly into the inventory/player sections and
   * returned as an array for the level-up modal to display.
   *
   * @param {number} level
   * @returns {object[]}  reward descriptors for the UI
   */
  _dispatchLevelRewards(level) {
    const rewards = [];
    const inv     = this._save.inventory;

    // ── Every level: 1× Wheelspin ──────────────────────────────────────
    inv.addWheelspin(1);
    rewards.push({ type: 'wheelspin', count: 1, label: '1× Wheelspin' });

    // ── Every 10th level: 1× Super Wheelspin ──────────────────────────
    if (level % 10 === 0) {
      inv.addSuperWheelspin(1);
      rewards.push({ type: 'superWheelspin', count: 1, label: '1× Super Wheelspin' });
    }

    // ── Every 5th level: CR milestone bonus ───────────────────────────
    if (level % 5 === 0) {
      const cr = this._milestoneCR(level);
      inv.addCredits(cr);
      rewards.push({ type: 'credits', amount: cr, label: `${cr.toLocaleString()} CR` });
    }

    // ── Named milestone unlocks ────────────────────────────────────────
    const unlock = LEVEL_UNLOCKS[level];
    if (unlock) {
      this._save.player.grantUnlock(unlock.feature);
      rewards.push({ type: 'unlock', ...unlock });
    }

    // ── Named cosmetic / title grants ─────────────────────────────────
    const cosmetic = LEVEL_COSMETICS[level];
    if (cosmetic) {
      if (cosmetic.type === 'clothing') {
        inv.addClothingItem(cosmetic.id);
      } else if (cosmetic.type === 'car') {
        inv.addCar({ ...cosmetic, isUnrestored: false });
      } else if (cosmetic.type === 'title') {
        this._save.player.grantUnlock(`title_${cosmetic.id}`);
      } else if (cosmetic.type === 'cosmetic') {
        inv.addCosmetic(cosmetic.id);
      }
      rewards.push({ type: cosmetic.type, ...cosmetic });
    }

    // ── Notification toast ─────────────────────────────────────────────
    if (this._notify) {
      this._notify.show(`Level ${level}!`, 'levelUp', 'large');
    }

    return rewards;
  }

  /* ─────────────────────────── daily logic ────────────────────────────── */

  /**
   * Grant the login reward for the given streak day.
   * Pushes credits / wheelspin directly into inventory.
   *
   * @param {number} streakDay   1-indexed
   * @returns {object}  { type, amount?, label }
   */
  _grantLoginReward(streakDay) {
    const inv = this._save.inventory;

    // Day 7 is always a Super Wheelspin regardless of the rotation
    if (streakDay % 7 === 0) {
      inv.addSuperWheelspin(1);
      const reward = { type: 'superWheelspin', label: '7-Day Streak! Super Wheelspin' };
      this._emit('loginReward', reward);
      if (this._notify) this._notify.show('7-Day Streak! 🌟 Super Wheelspin earned!', 'gold', 'large');
      return reward;
    }

    // Days 1–4: fixed escalating CR
    if (streakDay <= 4) {
      const cr = DAILY_LOGIN_REWARDS.fixed[streakDay - 1];
      inv.addCredits(cr);
      // Also award the fixed daily XP (not multiplied)
      this.awardXP('daily_login', XP_SOURCES.daily_login, { applyMultipliers: false });
      const reward = { type: 'credits', amount: cr, label: `Day ${streakDay} Login: ${cr.toLocaleString()} CR` };
      this._emit('loginReward', reward);
      if (this._notify) this._notify.show(`Day ${streakDay} Login Bonus: ${cr.toLocaleString()} CR`, 'gold', 'medium');
      return reward;
    }

    // Day 5+: rotating table — XP Boost / Wheelspin / large CR
    const rotIndex = (streakDay - 5) % DAILY_LOGIN_REWARDS.rotation.length;
    const rotEntry = DAILY_LOGIN_REWARDS.rotation[rotIndex];

    if (rotEntry.type === 'credits') {
      inv.addCredits(rotEntry.amount);
    } else if (rotEntry.type === 'wheelspin') {
      inv.addWheelspin(1);
    } else if (rotEntry.type === 'xpBoost') {
      this._save.player.activateXPBoost(30 * 60 * 1000);
    }

    this.awardXP('daily_login', XP_SOURCES.daily_login, { applyMultipliers: false });
    const reward = { ...rotEntry, label: `Day ${streakDay} Login: ${rotEntry.label}` };
    this._emit('loginReward', reward);
    if (this._notify) this._notify.show(`Day ${streakDay} Login Bonus: ${rotEntry.label}`, 'gold', 'medium');
    return reward;
  }

  /**
   * Award the first-event-of-the-day bonus if it hasn't been claimed yet.
   * Returns the XP amount awarded (0 if already claimed today).
   */
  _claimFirstEventBonus() {
    const player = this._save._data.player;
    if (player.firstEventDoneToday) return 0;

    player.firstEventDoneToday = true;
    this._save.markDirty();

    // +5,000 CR and +2,000 XP fixed
    this._save.inventory.addCredits(5000);

    this._emit('firstEventBonus', { xp: XP_SOURCES.first_event, credits: 5000 });
    if (this._notify) {
      this._notify.show('First Event Today! +5,000 CR, +2,000 XP', 'blue', 'medium');
    }

    return XP_SOURCES.first_event;   // 2000 — will be awarded by the caller
  }

  /* ─────────────────────────── multiplier stack ───────────────────────── */

  /**
   * Build the combined XP multiplier.
   *
   * Formula: difficultyMult × (1 + assistBonus) × (xpBoostActive ? 2 : 1)
   *
   * Difficulty:
   *   tourist=0.5, novice=0.75, experienced=1.0, pro=1.25, unbeatable=1.5
   *
   * Assists (additive bonus when OFF):
   *   abs=-10%, tc=+10%, sc=+15%, steering=+10%, braking=+20%, manual=+15%
   *   max total assist bonus = +80%
   *
   * XP Boost item doubles the entire result.
   */
  _buildMultiplier(difficulty, assists) {
    const diffMult   = DIFFICULTY_XP_MULT[difficulty] ?? 1.0;

    let assistBonus  = 0;
    for (const [key, bonus] of Object.entries(ASSIST_XP_BONUS)) {
      if (assists && assists[key] === false) {
        assistBonus += bonus;
      }
    }

    const boostMult  = this._save.player.checkXPBoost() ? 2 : 1;

    return +(diffMult * (1 + assistBonus) * boostMult).toFixed(4);
  }

  _currentAssists() {
    const s = this._save.settings;
    return {
      abs:      s.get('assist_abs',      true),
      tc:       s.get('assist_tc',       true),
      sc:       s.get('assist_sc',       true),
      steering: s.get('assist_steering', true),
      braking:  s.get('assist_braking',  true),
      manual:   s.get('transmission',   'automatic') === 'manual',
    };
  }

  /* ─────────────────────────── XP threshold table ────────────────────── */

  /**
   * Returns the XP required to advance from `level` to `level + 1`.
   * Uses the five-band table from the game design doc:
   *
   *  Levels  1– 20 →  5,000 XP
   *  Levels 21– 50 → 12,000 XP
   *  Levels 51–100 → 25,000 XP
   *  Levels 101–150 → 40,000 XP
   *  Levels 151–200 → 60,000 XP
   *  Levels 200+    → 80,000 XP (prestige, continues indefinitely)
   */
  _xpForLevel(level) {
    for (const band of LEVEL_THRESHOLDS) {
      if (level <= band.max) return band.xp;
    }
    return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1].xp;  // prestige band
  }

  /* ─────────────────────────── race XP helpers ────────────────────────── */

  /**
   * Calculate base finish XP.
   * 1st place gets the full amount; last place gets roughly 1/totalRacers.
   * Also scales slightly with race distance so longer races pay more.
   *
   * Design doc range: 500 – 3,000 XP for finishing.
   */
  _raceFinishXP(position, totalRacers, distanceKm) {
    const MIN_XP   = 500;
    const MAX_XP   = 3000;

    // Position factor: 1.0 for 1st, approaches 1/totalRacers for last
    const posFactor = 1 - ((position - 1) / Math.max(1, totalRacers - 1)) * (1 - 1 / totalRacers);

    // Distance factor: 1.0 at 3 km, caps at 1.5 at 10+ km
    const distFactor = Math.min(1.5, Math.max(0.5, distanceKm / 3));

    return Math.round(
      MIN_XP + (MAX_XP - MIN_XP) * posFactor * distFactor
    );
  }

  /* ─────────────────────────── CR milestone table ────────────────────── */

  /**
   * Returns the CR bonus for a 5-level milestone.
   * Scales from 5,000 at level 5 to 20,000 at higher milestones.
   * Beyond level 100 it stays at 20,000.
   */
  _milestoneCR(level) {
    for (const band of MILESTONE_CR) {
      if (level <= band.maxLevel) return band.cr;
    }
    return MILESTONE_CR[MILESTONE_CR.length - 1].cr;
  }

  /* ─────────────────────────── utilities ──────────────────────────────── */

  /** Returns today's UTC date as 'YYYY-MM-DD'. */
  _utcDateString(dayOffset = 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  }

  _ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  _emit(event, data) {
    (this._listeners.get(event) ?? []).forEach(cb => {
      try { cb(data); } catch (e) {
        console.error(`[ProgressionManager] ${event} listener threw:`, e);
      }
    });
  }
}

/** Sources that get a small XP toast notification. */
const NOTABLE_SOURCES = [
  'race_win', 'race_pb', 'landmark', 'speed_trap_gold',
  'accolade', 'daily_login', 'first_event',
];
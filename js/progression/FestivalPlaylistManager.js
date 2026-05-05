/**
 * FestivalPlaylistManager.js
 * Part 9 — Progression & Rewards
 *
 * Manages the Festival Playlist system:
 *  - Real-time calendar: weekly reset (Monday 00:00 UTC), 4-week season cycle
 *  - Weekly challenge generation — 7 challenges per week, seeded by week number
 *    so they are deterministic across sessions but vary each week
 *  - Per-challenge completion tracking with reward dispatch
 *  - Seasonal unlock track: 4 tiers at 5 / 10 / 20 / all events
 *  - Season Champion exclusive car grant on Tier 4 completion
 *  - Missed-season lock on the exclusive car (scarcity)
 *  - Season theming metadata (lighting key, weather bias) for the world renderer
 *  - Persists all state through SaveManager
 *
 * Dependencies: saveManager, progressionManager, accoladeManager, notificationSystem
 */

// ---------------------------------------------------------------------------
// Season definitions
// ---------------------------------------------------------------------------

export const SEASON = {
  SUMMER: 'summer',
  AUTUMN: 'autumn',
  WINTER: 'winter',
  SPRING: 'spring',
};

const SEASON_ORDER = [SEASON.SUMMER, SEASON.AUTUMN, SEASON.WINTER, SEASON.SPRING];

/** Visual / world-renderer metadata per season */
export const SEASON_THEME = {
  [SEASON.SUMMER]: {
    label:        'Summer',
    emoji:        '☀️',
    lightingKey:  'golden_hour',
    weatherBias:  { clear: 0.70, overcast: 0.20, rain: 0.10 },
    ambientHex:   '#FFF3C0',
    fogDensity:   0.0002,
    leafParticles: false,
    snowOnHighGround: false,
  },
  [SEASON.AUTUMN]: {
    label:        'Autumn',
    emoji:        '🍂',
    lightingKey:  'amber_overcast',
    weatherBias:  { clear: 0.35, overcast: 0.45, rain: 0.20 },
    ambientHex:   '#E8A060',
    fogDensity:   0.0006,
    leafParticles: true,
    snowOnHighGround: false,
  },
  [SEASON.WINTER]: {
    label:        'Winter',
    emoji:        '❄️',
    lightingKey:  'blue_grey_dusk',
    weatherBias:  { clear: 0.25, overcast: 0.40, rain: 0.35 },
    ambientHex:   '#B0C8E0',
    fogDensity:   0.0012,
    leafParticles: false,
    snowOnHighGround: true,
  },
  [SEASON.SPRING]: {
    label:        'Spring',
    emoji:        '🌸',
    lightingKey:  'soft_green_morning',
    weatherBias:  { clear: 0.60, overcast: 0.30, rain: 0.10 },
    ambientHex:   '#D4EFC0',
    fogDensity:   0.0003,
    leafParticles: false,
    snowOnHighGround: false,
  },
};

// ---------------------------------------------------------------------------
// Seasonal unlock track tiers
// ---------------------------------------------------------------------------

const SEASON_TIERS = [
  {
    tier: 1,
    eventsRequired: 5,
    reward: { type: 'credits', value: 50_000 },
    label: 'Tier 1',
  },
  {
    tier: 2,
    eventsRequired: 10,
    reward: { type: 'cosmetic_set', value: 'seasonal_livery_set' },
    label: 'Tier 2',
  },
  {
    tier: 3,
    eventsRequired: 20,
    reward: { type: 'clothing', value: 'seasonal_exclusive_jacket' },
    label: 'Tier 3',
  },
  {
    tier: 4,
    eventsRequired: null,   // all events — computed per season
    reward: { type: 'car', value: null },   // carId filled from season definition
    label: 'Season Champion',
  },
];

// ---------------------------------------------------------------------------
// Season catalogue
// 4-week seasons repeat in a 16-week cycle.
// seasonIndex = Math.floor(weeksSinceEpoch / 4) % 4
// Each season defines:
//   id, name (display), car reward for Tier 4, unique events (5 per season),
//   championship (3-race series).
// Weekly challenges are generated procedurally from CHALLENGE_POOL below.
// ---------------------------------------------------------------------------

const SEASON_CATALOGUE = [
  {
    seasonIndex: 0,
    season: SEASON.SUMMER,
    name: 'Horizon Summer',
    description: 'The festival hits its peak — golden skies and wide-open roads.',
    tier4Car: { id: 'mclaren_f1',      displayName: 'McLaren F1',        class: 'S2' },
    uniqueEvents: [
      { id: 'summer_beach_sprint',     name: 'Beach Sprint',             type: 'sprint',   class: 'A',  district: 'Marina' },
      { id: 'summer_highway_blast',    name: 'Highway Blast',            type: 'sprint',   class: 'S1', district: 'Highway' },
      { id: 'summer_drift_showdown',   name: 'Sunset Drift Showdown',    type: 'drift',    class: 'B',  district: 'Industrial' },
      { id: 'summer_canyon_circuit',   name: 'Canyon Circuit',           type: 'circuit',  class: 'A',  district: 'Hillside' },
      { id: 'summer_drag_king',        name: 'Drag King — Summer Open',  type: 'drag',     class: 'open', district: 'Downtown' },
    ],
    championship: {
      id: 'summer_championship',
      name: 'Summer Championship',
      races: ['summer_r1_circuit', 'summer_r2_sprint', 'summer_r3_circuit'],
      class: 'A',
      reward: { credits: 80_000, xp: 5_000 },
    },
  },

  {
    seasonIndex: 1,
    season: SEASON.AUTUMN,
    name: 'Horizon Autumn',
    description: 'Amber light filters through the leaves. Every corner hides a new race.',
    tier4Car: { id: 'porsche_911_gt2rs', displayName: 'Porsche 911 GT2 RS', class: 'S1' },
    uniqueEvents: [
      { id: 'autumn_hillside_run',     name: 'Hillside Descent',         type: 'sprint',   class: 'B',  district: 'Hillside' },
      { id: 'autumn_industrial_tour',  name: 'Industrial Tour',          type: 'circuit',  class: 'A',  district: 'Industrial' },
      { id: 'autumn_night_sprint',     name: 'Night Commuter Sprint',    type: 'sprint',   class: 'C',  district: 'Downtown' },
      { id: 'autumn_drift_valley',     name: 'Valley Drift Battle',      type: 'drift',    class: 'A',  district: 'Hillside' },
      { id: 'autumn_open_circuit',     name: 'Open Class Autumn Grand',  type: 'circuit',  class: 'open', district: 'Suburbs' },
    ],
    championship: {
      id: 'autumn_championship',
      name: 'Autumn Championship',
      races: ['autumn_r1_sprint', 'autumn_r2_circuit', 'autumn_r3_sprint'],
      class: 'B',
      reward: { credits: 70_000, xp: 4_500 },
    },
  },

  {
    seasonIndex: 2,
    season: SEASON.WINTER,
    name: 'Horizon Winter',
    description: 'Rain-slicked streets and low light. Only the brave race in winter.',
    tier4Car: { id: 'bugatti_chiron',    displayName: 'Bugatti Chiron',     class: 'S2' },
    uniqueEvents: [
      { id: 'winter_downtown_rain',    name: 'Rain-Slicked Sprint',      type: 'sprint',   class: 'A',  district: 'Downtown' },
      { id: 'winter_harbor_circuit',   name: 'Harbor Night Circuit',     type: 'circuit',  class: 'S1', district: 'Marina' },
      { id: 'winter_drag_challenge',   name: 'Winter Drag Challenge',    type: 'drag',     class: 'B',  district: 'Industrial' },
      { id: 'winter_hillside_ice',     name: 'Hillside Ice Run',         type: 'sprint',   class: 'C',  district: 'Hillside' },
      { id: 'winter_showcase',         name: 'Winter Showcase Event',    type: 'showcase', class: 'S2', district: 'Highway' },
    ],
    championship: {
      id: 'winter_championship',
      name: 'Winter Championship',
      races: ['winter_r1_circuit', 'winter_r2_sprint', 'winter_r3_circuit'],
      class: 'S1',
      reward: { credits: 100_000, xp: 6_000 },
    },
  },

  {
    seasonIndex: 3,
    season: SEASON.SPRING,
    name: 'Horizon Spring',
    description: 'Fresh air, clear skies, and the roads are yours. The city is alive.',
    tier4Car: { id: 'koenigsegg_jesko', displayName: 'Koenigsegg Jesko', class: 'S2' },
    uniqueEvents: [
      { id: 'spring_festival_sprint',  name: 'Festival Sprint',          type: 'sprint',   class: 'D',  district: 'Suburbs' },
      { id: 'spring_open_circuit',     name: 'Spring Open Grand Prix',   type: 'circuit',  class: 'open', district: 'Downtown' },
      { id: 'spring_drift_cups',       name: 'Spring Drift Cup',         type: 'drift',    class: 'B',  district: 'Industrial' },
      { id: 'spring_highway_run',      name: 'Highway Time Attack',      type: 'sprint',   class: 'S1', district: 'Highway' },
      { id: 'spring_night_showcase',   name: 'Lights-Out Showcase',      type: 'showcase', class: 'A',  district: 'Marina' },
    ],
    championship: {
      id: 'spring_championship',
      name: 'Spring Championship',
      races: ['spring_r1_circuit', 'spring_r2_sprint', 'spring_r3_circuit'],
      class: 'A',
      reward: { credits: 80_000, xp: 5_000 },
    },
  },
];

// ---------------------------------------------------------------------------
// Weekly challenge pool
// Seeded procedurally — we use week number as a deterministic seed so the
// same week always generates the same 7 challenges, but they vary week-to-week.
// ---------------------------------------------------------------------------

const CHALLENGE_POOL = [
  // Racing
  { id: 'win_circuit_b',    text: 'Win 3 Circuit Races in B-class or above',    type: 'racing',      target: 3,  eventType: 'circuit_win_b_or_above' },
  { id: 'win_sprint_a',     text: 'Win 2 Sprint Races in A-class',              type: 'racing',      target: 2,  eventType: 'sprint_win_a_class' },
  { id: 'win_drag',         text: 'Win a Drag Race',                            type: 'racing',      target: 1,  eventType: 'drag_win' },
  { id: 'win_pro',          text: 'Win a race on Pro difficulty or higher',     type: 'racing',      target: 1,  eventType: 'pro_race_win' },
  { id: 'clean_race',       text: 'Complete a race without using Rewind',       type: 'racing',      target: 1,  eventType: 'clean_race_no_rewind' },
  { id: 'podium_5',         text: 'Finish in the top 3 in 5 races',            type: 'racing',      target: 5,  eventType: 'podium_finish' },
  { id: 'win_champ_event',  text: 'Win any Championship event',                type: 'racing',      target: 1,  eventType: 'championship_event_win' },
  // Exploration
  { id: 'boards_5',         text: 'Collect 5 Bonus Boards in Industrial District', type: 'exploration', target: 5,  eventType: 'board_collected_industrial' },
  { id: 'boards_any_3',     text: 'Collect 3 Bonus Boards anywhere',           type: 'exploration', target: 3,  eventType: 'board_collected' },
  { id: 'landmark_visit',   text: 'Discover or revisit 2 Landmarks',           type: 'exploration', target: 2,  eventType: 'landmark_visited' },
  { id: 'district_drive',   text: 'Drive through all 7 Districts in one session', type: 'exploration', target: 7,  eventType: 'district_entered' },
  { id: 'night_drive',      text: 'Drive 10km during the night cycle',         type: 'exploration', target: 10, eventType: 'night_km_driven' },
  // Speed / skill
  { id: 'reach_250',        text: 'Reach 250 km/h anywhere in the city',       type: 'skill',       target: 1,  eventType: 'speed_250_kmh' },
  { id: 'reach_300',        text: 'Reach 300 km/h on the Highway Ring',        type: 'skill',       target: 1,  eventType: 'speed_300_kmh_highway' },
  { id: 'speed_trap_gold',  text: 'Earn Gold at any Speed Trap',               type: 'skill',       target: 1,  eventType: 'speed_trap_gold' },
  { id: 'speed_traps_3',    text: 'Earn Gold at 3 different Speed Traps',      type: 'skill',       target: 3,  eventType: 'speed_trap_gold' },
  // Drift
  { id: 'drift_silver',     text: 'Achieve a Silver score in any Drift Zone',  type: 'drift',       target: 1,  eventType: 'drift_zone_silver' },
  { id: 'drift_platinum',   text: 'Achieve a Platinum score in any Drift Zone', type: 'drift',      target: 1,  eventType: 'drift_zone_platinum' },
  { id: 'drift_km',         text: 'Accumulate 2km of drift distance',          type: 'drift',       target: 2,  eventType: 'total_drift_km' },
  // Distance
  { id: 'drive_20km',       text: 'Drive 20km on the Highway Ring',            type: 'distance',    target: 20, eventType: 'highway_km_driven' },
  { id: 'drive_total_30',   text: 'Drive a total of 30km in free roam',        type: 'distance',    target: 30, eventType: 'total_km_driven' },
  // No-assist challenge
  { id: 'no_rewind_sprint', text: 'Complete the Harbor Sprint without Rewind', type: 'challenge',   target: 1,  eventType: 'harbor_sprint_no_rewind' },
];

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

/** Monday 00:00 UTC of the week containing `date`. */
function getWeekStart(date = new Date()) {
  const d   = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diff = (day === 0) ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/** ISO week number (1-based) since a fixed epoch (2024-01-01 Monday). */
const EPOCH_MS = Date.UTC(2024, 0, 1); // 2024-01-01

function getWeekNumber(date = new Date()) {
  const weekStart = getWeekStart(date);
  return Math.floor((weekStart.getTime() - EPOCH_MS) / (7 * 24 * 60 * 60 * 1000));
}

/** Season index (0–3) from week number. Changes every 4 weeks. */
function getSeasonIndex(weekNumber) {
  return Math.floor(weekNumber / 4) % 4;
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Returns a function that yields 0–1 floats deterministically from a seed.
 */
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `count` unique challenges from the pool, seeded by weekNumber.
 * Same weekNumber always yields the same challenges.
 */
function generateWeeklyChallenges(weekNumber, count = 7) {
  const rng  = seededRng(weekNumber * 0xDEADBEEF);
  const pool = [...CHALLENGE_POOL];
  const picks = [];

  while (picks.length < count && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length);
    picks.push({ ...pool[idx], weekNumber });
    pool.splice(idx, 1);
  }

  return picks;
}

// ---------------------------------------------------------------------------
// FestivalPlaylistManager
// ---------------------------------------------------------------------------

export class FestivalPlaylistManager extends EventTarget {
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

    // Snapshot current time so the whole session uses a consistent "now"
    this._now         = new Date();
    this._weekNumber  = getWeekNumber(this._now);
    this._seasonIndex = getSeasonIndex(this._weekNumber);
    this._seasonDef   = SEASON_CATALOGUE[this._seasonIndex];

    this._state = this._loadState();
    this._maybeResetWeek();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _loadState() {
    const saved = this._save.get('playlist', 'fpm_state') ?? {};
    return {
      // Weekly challenge progress: { [weekNumber]: { [challengeId]: number } }
      weeklyProgress:   saved.weeklyProgress   ?? {},
      // Weekly reward claimed: { [weekNumber]: { partial: bool, full: bool } }
      weeklyRewards:    saved.weeklyRewards    ?? {},
      // Seasonal progress: { [seasonKey]: { eventsCompleted: number, tiersUnlocked: number[], carClaimed: bool } }
      seasonalProgress: saved.seasonalProgress ?? {},
      // Seasons where the Tier 4 car was missed (locked out)
      missedSeasons:    saved.missedSeasons    ?? [],
    };
  }

  _persist() {
    this._save.set('playlist', 'fpm_state', this._state);
  }

  /** Season key used as a stable identifier in save data. */
  _seasonKey(weekNumber = this._weekNumber) {
    const idx = getSeasonIndex(weekNumber);
    const cycle = Math.floor(weekNumber / 4);
    return `${SEASON_CATALOGUE[idx].season}_cycle${cycle}`;
  }

  _seasonProgress(seasonKey = this._seasonKey()) {
    if (!this._state.seasonalProgress[seasonKey]) {
      this._state.seasonalProgress[seasonKey] = {
        eventsCompleted: 0,
        tiersUnlocked:   [],
        carClaimed:      false,
      };
    }
    return this._state.seasonalProgress[seasonKey];
  }

  /**
   * If the saved week number doesn't match the current week, reset weekly progress
   * and lock out any unclaimed Tier 4 cars from the previous season.
   */
  _maybeResetWeek() {
    const lastWeek = this._save.get('playlist', 'lastWeek') ?? -1;
    if (lastWeek === this._weekNumber) return;

    // If the season changed, mark previous season car as missed if not claimed
    const prevSeasonIdx = getSeasonIndex(lastWeek);
    const curSeasonIdx  = this._seasonIndex;
    if (lastWeek >= 0 && prevSeasonIdx !== curSeasonIdx) {
      const prevKey  = this._seasonKey(lastWeek);
      const prevProg = this._state.seasonalProgress[prevKey];
      if (prevProg && !prevProg.carClaimed) {
        if (!this._state.missedSeasons.includes(prevKey)) {
          this._state.missedSeasons.push(prevKey);
          console.log(`[FestivalPlaylist] Season ${prevKey} car was missed (not claimed).`);
        }
      }
    }

    this._save.set('playlist', 'lastWeek', this._weekNumber);
    this._persist();

    this.dispatchEvent(new CustomEvent('week_reset', {
      detail: { weekNumber: this._weekNumber, seasonIndex: this._seasonIndex },
    }));
  }

  // ── Public: calendar queries ──────────────────────────────────────────────

  /** Current season definition object. */
  get currentSeason()      { return this._seasonDef; }

  /** Current season theme (lighting, weather, etc.) for the world renderer. */
  get currentSeasonTheme() { return SEASON_THEME[this._seasonDef.season]; }

  /** Current week number (absolute, since epoch). */
  get currentWeekNumber()  { return this._weekNumber; }

  /** UTC timestamp when the current week resets. */
  get weekResetTime() {
    const start = getWeekStart(this._now);
    return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  /** How many ms until the weekly reset. */
  get msUntilWeekReset() {
    return this.weekResetTime.getTime() - this._now.getTime();
  }

  // ── Public: weekly challenges ─────────────────────────────────────────────

  /**
   * The 7 challenges for the current week.
   * @returns {Array<{ id, text, type, target, eventType, weekNumber, progress, completed }>}
   */
  getWeeklyChallenges() {
    const challenges = generateWeeklyChallenges(this._weekNumber);
    const prog       = this._state.weeklyProgress[this._weekNumber] ?? {};
    return challenges.map(ch => ({
      ...ch,
      progress:  prog[ch.id] ?? 0,
      completed: (prog[ch.id] ?? 0) >= ch.target,
    }));
  }

  /**
   * How many weekly challenges are currently complete.
   */
  get weeklyCompletedCount() {
    return this.getWeeklyChallenges().filter(c => c.completed).length;
  }

  /**
   * Report progress on a weekly challenge event type.
   * Called by game systems the same way AccoladeManager.report() is called.
   *
   * @param {string} eventType  - matches a challenge's eventType
   * @param {number} [value=1]  - amount to add (or new value for max-tracked)
   */
  reportChallenge(eventType, value = 1) {
    const challenges = generateWeeklyChallenges(this._weekNumber);
    if (!this._state.weeklyProgress[this._weekNumber]) {
      this._state.weeklyProgress[this._weekNumber] = {};
    }
    const weekProg = this._state.weeklyProgress[this._weekNumber];
    let anyCompleted = false;

    for (const ch of challenges) {
      if (ch.eventType !== eventType) continue;
      const before = weekProg[ch.id] ?? 0;
      if (before >= ch.target) continue;     // already complete, skip
      weekProg[ch.id] = Math.min(before + value, ch.target);
      if (weekProg[ch.id] >= ch.target) {
        anyCompleted = true;
        this._onChallengeComplete(ch);
      }
    }

    if (anyCompleted) this._checkWeeklyRewards();
    this._persist();
  }

  /** Called when an individual challenge reaches its target. */
  _onChallengeComplete(challenge) {
    this._notify?.push({
      text: `📋 Challenge Complete — ${challenge.text}`,
      colour: '#69F0AE',
      size: 'medium',
      duration: 4_500,
    });

    // Each completed challenge counts as one Playlist event for the seasonal track
    this._onPlaylistEventCompleted();

    this.dispatchEvent(new CustomEvent('challenge_complete', { detail: { challenge } }));
    console.log(`[FestivalPlaylist] Weekly challenge complete: ${challenge.id}`);
  }

  /**
   * Check and grant weekly rewards (partial at 4+ complete, full at all 7).
   */
  _checkWeeklyRewards() {
    const rewards = this._state.weeklyRewards[this._weekNumber] ?? { partial: false, full: false };
    this._state.weeklyRewards[this._weekNumber] = rewards;
    const completed = this.weeklyCompletedCount;

    // Partial reward: 4+ challenges → 25,000 CR + 1 Wheelspin
    if (completed >= 4 && !rewards.partial) {
      rewards.partial = true;
      this._save.inventory?.addCredits(25_000);
      this._save.inventory?.addWheelspin(1);
      this._progression?.addXP(2_000, 'weekly_reward');
      this._notify?.push({
        text: '🎡 Weekly Reward — 25,000 CR + 1× Wheelspin!',
        colour: '#FFD700',
        size: 'large',
        duration: 6_000,
      });
      this.dispatchEvent(new CustomEvent('weekly_reward', {
        detail: { type: 'partial', credits: 25_000, wheelspin: 1 },
      }));
    }

    // Full reward: all 7 → Super Wheelspin
    if (completed >= 7 && !rewards.full) {
      rewards.full = true;
      this._save.inventory?.addSuperWheelspin(1);
      this._progression?.addXP(3_000, 'weekly_full_reward');
      this._accolades?.report('playlist_event_completed', 1);
      this._notify?.push({
        text: '🌟 All Weekly Challenges Done — 1× Super Wheelspin!',
        colour: '#FF6B00',
        size: 'large',
        duration: 7_000,
      });
      this.dispatchEvent(new CustomEvent('weekly_reward', {
        detail: { type: 'full', superWheelspin: 1 },
      }));
    }
  }

  // ── Public: seasonal track ────────────────────────────────────────────────

  /**
   * Called internally whenever a Playlist event is completed (challenge, unique
   * event, or championship event). Increments the seasonal counter and checks tiers.
   */
  _onPlaylistEventCompleted() {
    const key  = this._seasonKey();
    const prog = this._seasonProgress(key);
    prog.eventsCompleted++;

    // Report to AccoladeManager
    this._accolades?.report('playlist_event_completed', 1);

    // Check tier unlocks
    const totalEvents = this._getTotalSeasonEvents();
    for (const tierDef of SEASON_TIERS) {
      const required = tierDef.tier === 4 ? totalEvents : tierDef.eventsRequired;
      if (prog.eventsCompleted >= required && !prog.tiersUnlocked.includes(tierDef.tier)) {
        this._unlockSeasonTier(tierDef, prog, key);
      }
    }

    this._persist();

    this.dispatchEvent(new CustomEvent('seasonal_progress', {
      detail: { eventsCompleted: prog.eventsCompleted, seasonKey: key },
    }));
  }

  /** Total number of completable events in the current season. */
  _getTotalSeasonEvents() {
    // 7 weekly challenges + 5 unique events + 3 championship races = 15
    // (simplified: 7 + 5 + 1 championship counted as one unit = 13)
    return 7 + this._seasonDef.uniqueEvents.length + 1;
  }

  /** Unlock a seasonal tier and dispatch its reward. */
  _unlockSeasonTier(tierDef, prog, seasonKey) {
    prog.tiersUnlocked.push(tierDef.tier);
    const { type, value } = tierDef.reward;

    switch (type) {
      case 'credits':
        this._save.inventory?.addCredits(value);
        this._notify?.push({
          text: `🏅 Season ${tierDef.label} — ${value.toLocaleString()} CR!`,
          colour: '#FFD700', size: 'large', duration: 6_000,
        });
        break;

      case 'cosmetic_set':
        this._save.inventory?.addCosmetic(value);
        this._notify?.push({
          text: `🎨 Season ${tierDef.label} — Exclusive Livery Set unlocked!`,
          colour: '#E040FB', size: 'large', duration: 6_000,
        });
        break;

      case 'clothing':
        this._save.inventory?.addCosmetic(value);
        this._notify?.push({
          text: `👗 Season ${tierDef.label} — Exclusive Jacket unlocked!`,
          colour: '#E040FB', size: 'large', duration: 6_000,
        });
        break;

      case 'car': {
        const carDef = this._seasonDef.tier4Car;
        this._save.inventory?.addCar(carDef.id);
        prog.carClaimed = true;
        this._progression?.addXP(10_000, 'season_champion');
        this._accolades?.report('season_cycle_completed', 1);
        this._notify?.push({
          text: `🏆 SEASON CHAMPION — ${carDef.displayName} added to your garage!`,
          colour: '#FF6B00', size: 'large', duration: 10_000,
        });
        this.dispatchEvent(new CustomEvent('season_car_earned', {
          detail: { carId: carDef.id, displayName: carDef.displayName, seasonKey },
        }));
        break;
      }
    }

    this.dispatchEvent(new CustomEvent('season_tier_unlocked', {
      detail: { tier: tierDef.tier, reward: tierDef.reward, seasonKey },
    }));

    console.log(`[FestivalPlaylist] Season tier ${tierDef.tier} unlocked (${seasonKey})`);
  }

  /**
   * Mark a unique seasonal event or championship event as completed.
   * Call from RaceManager when the player finishes a seasonal event.
   *
   * @param {string} eventId - matches an id in seasonDef.uniqueEvents or championship
   */
  completeSeasonalEvent(eventId) {
    const key  = this._seasonKey();
    const prog = this._seasonProgress(key);

    const isUnique = this._seasonDef.uniqueEvents.some(e => e.id === eventId);
    const isChamp  = this._seasonDef.championship.id === eventId
                  || this._seasonDef.championship.races.includes(eventId);

    if (!isUnique && !isChamp) return;   // not a current-season event

    this._onPlaylistEventCompleted();

    if (isChamp && eventId === this._seasonDef.championship.id) {
      // Full championship complete — bonus reward
      const { credits, xp } = this._seasonDef.championship.reward;
      this._save.inventory?.addCredits(credits);
      this._progression?.addXP(xp, 'championship');
      this._notify?.push({
        text: `🏆 ${this._seasonDef.championship.name} — ${credits.toLocaleString()} CR!`,
        colour: '#FFD700', size: 'large', duration: 7_000,
      });
    }
  }

  // ── Public: state queries for UI ──────────────────────────────────────────

  /**
   * Full state snapshot for the Festival Playlist screen.
   */
  getPlaylistState() {
    const key       = this._seasonKey();
    const prog      = this._seasonProgress(key);
    const totalEvts = this._getTotalSeasonEvents();
    const tiers     = SEASON_TIERS.map(t => ({
      ...t,
      eventsRequired: t.tier === 4 ? totalEvts : t.eventsRequired,
      unlocked: prog.tiersUnlocked.includes(t.tier),
    }));

    return {
      season:          this._seasonDef,
      seasonTheme:     this.currentSeasonTheme,
      weekNumber:      this._weekNumber,
      weekResetTime:   this.weekResetTime,
      msUntilReset:    this.msUntilWeekReset,
      weeklyChallenges: this.getWeeklyChallenges(),
      weeklyCompleted:  this.weeklyCompletedCount,
      weeklyRewards:   this._state.weeklyRewards[this._weekNumber] ?? { partial: false, full: false },
      uniqueEvents:    this._seasonDef.uniqueEvents,
      championship:    this._seasonDef.championship,
      seasonProgress:  prog,
      totalEvents:     totalEvts,
      tiers,
      tier4Car:        this._seasonDef.tier4Car,
      pct:             Math.min(prog.eventsCompleted / totalEvts, 1),
    };
  }

  /**
   * Whether the player missed the Tier 4 car for a given season key.
   * @param {string} seasonKey
   */
  isMissedSeason(seasonKey) {
    return this._state.missedSeasons.includes(seasonKey);
  }

  /**
   * History of all seasons the player participated in.
   * Used by the Profile screen.
   */
  getSeasonHistory() {
    return Object.entries(this._state.seasonalProgress).map(([key, prog]) => ({
      seasonKey:       key,
      eventsCompleted: prog.eventsCompleted,
      tiersUnlocked:   prog.tiersUnlocked,
      carClaimed:      prog.carClaimed,
      missed:          this.isMissedSeason(key),
    }));
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance = null;

export function createFestivalPlaylistManager(deps) {
  if (_instance) return _instance;
  _instance = new FestivalPlaylistManager(deps);
  return _instance;
}

export { _instance as festivalPlaylistManager };

// Export for use by external systems that report challenge progress
export { CHALLENGE_POOL, SEASON_CATALOGUE, SEASON_TIERS };
export { getWeekNumber, getSeasonIndex, generateWeeklyChallenges };

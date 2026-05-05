/**
 * js/economy/festivalHub.js
 * Horizon City — Festival Hub.
 *
 * Responsibilities:
 *   • Daily login reward UI state management (delegates claim to economy.js)
 *   • Wheelspin token display and spin orchestration
 *   • Festival Playlist structure (weekly + seasonal challenges)
 *   • Playlist progress tracking and reward claiming
 *   • Global leaderboard (fastest lap times — seeded AI + player entries)
 *   • Community livery sharing (export / import code UI bridge)
 *   • Patch notes / game news
 */

import {
  claimDailyLogin,
  spinWheelspin,
  getWheelspinCount,
  DAILY_LOGIN_REWARDS,
  earn,
} from './Economy.js';
import { grantClothingItem }    from './ClothingShop.js';
import { grantLivery }          from './LiveryShop.js';
import { getBotLeaderboard }    from './raceHQ.js';
import { getCarById }           from '../car/carData.js';

// ── Storage keys ───────────────────────────────────────────────────────────────
const KEY_PLAYLIST_PROGRESS = 'hc_playlist_progress'; // { challengeId: boolean }
const KEY_PLAYLIST_REWARDS  = 'hc_playlist_rewards';  // Set of claimed reward ids
const KEY_SEASON            = 'hc_season';             // current season name
const KEY_LB_CACHE          = 'hc_lb_cache';           // cached leaderboard

// ── Season & Week definitions ──────────────────────────────────────────────────
export const SEASONS = [
  { id: 'spring', label: 'Spring', color: '#50D060', icon: '🌸' },
  { id: 'summer', label: 'Summer', color: '#F0C040', icon: '☀️'  },
  { id: 'autumn', label: 'Autumn', color: '#E07020', icon: '🍂'  },
  { id: 'winter', label: 'Winter', color: '#80C8F0', icon: '❄️'  },
];

export function getCurrentSeason() {
  const saved = localStorage.getItem(KEY_SEASON);
  if (saved) return SEASONS.find(s => s.id === saved) ?? SEASONS[0];
  // Derive from calendar month
  const month = new Date().getMonth(); // 0–11
  const idx   = Math.floor(month / 3);
  return SEASONS[idx];
}

// ── Playlist catalog ───────────────────────────────────────────────────────────
/**
 * Each challenge:
 *   id, season, week ('1'|'2'|'3'|'4'|'seasonal'),
 *   label, description,
 *   type: 'race_win'|'race_finish'|'drift_score'|'speed_trap'|'explore'|'custom'
 *   target: number  (wins needed, score to beat, km to drive, etc.)
 *   reward: { credits?, liveryId?, clothingId?, carId? }
 *   icon: string (emoji)
 */
export const PLAYLIST_CHALLENGES = [

  // ── Spring Challenges ──────────────────────────────────────────────────────

  // Week 1
  {
    id: 'spring_w1_win_circuit', season: 'spring', week: '1',
    label: 'Spring Circuit Victor',
    description: 'Win a circuit race in any class.',
    type: 'race_win', target: 1,
    reward: { credits: 15_000 },
    icon: '🏁',
  },
  {
    id: 'spring_w1_drift_bronze', season: 'spring', week: '1',
    label: 'Find Your Angle',
    description: 'Earn a Bronze medal in any Drift Zone.',
    type: 'drift_score', target: 1,
    reward: { credits: 10_000 },
    icon: '💨',
  },
  {
    id: 'spring_w1_harbor_sprint', season: 'spring', week: '1',
    label: 'Harbor Run',
    description: 'Finish the Harbor Sprint in any position.',
    type: 'race_finish', target: 1,
    reward: { credits: 8_000 },
    icon: '⚡',
  },
  // Week 2
  {
    id: 'spring_w2_five_races', season: 'spring', week: '2',
    label: 'Weekend Warrior',
    description: 'Complete 5 races of any type.',
    type: 'race_finish', target: 5,
    reward: { credits: 25_000 },
    icon: '🚗',
  },
  {
    id: 'spring_w2_drift_silver', season: 'spring', week: '2',
    label: 'Smoke Artist',
    description: 'Earn a Silver medal in any Drift Zone.',
    type: 'drift_score', target: 1,
    reward: { credits: 18_000 },
    icon: '🌫️',
  },
  {
    id: 'spring_w2_speed_250', season: 'spring', week: '2',
    label: 'Spring Speed',
    description: 'Hit 250 km/h at any Speed Trap.',
    type: 'speed_trap', target: 250,
    reward: { credits: 12_000 },
    icon: '📡',
  },
  // Week 3
  {
    id: 'spring_w3_win_three', season: 'spring', week: '3',
    label: 'Hat Trick',
    description: 'Win 3 races of any type this week.',
    type: 'race_win', target: 3,
    reward: { credits: 35_000 },
    icon: '🎩',
  },
  {
    id: 'spring_w3_cross_country', season: 'spring', week: '3',
    label: 'Off the Grid',
    description: 'Finish a Cross-Country event.',
    type: 'race_finish', target: 1,
    reward: { credits: 20_000 },
    icon: '🌲',
  },
  // Week 4
  {
    id: 'spring_w4_championship', season: 'spring', week: '4',
    label: 'Spring Champion',
    description: 'Win the Rookie Series Championship.',
    type: 'race_win', target: 1,
    reward: { credits: 50_000 },
    icon: '🏆',
  },
  {
    id: 'spring_w4_pb_circuit', season: 'spring', week: '4',
    label: 'Personal Best',
    description: 'Set a personal best on any circuit.',
    type: 'custom', target: 1,
    reward: { credits: 30_000 },
    icon: '⏱️',
  },
  // Seasonal
  {
    id: 'spring_seasonal_series', season: 'spring', week: 'seasonal',
    label: 'Spring Series Complete',
    description: 'Complete all four weekly playlist chapters in Spring.',
    type: 'custom', target: 4,
    reward: { credits: 100_000, liveryId: 'lv_season_spring' },
    icon: '🌸',
  },

  // ── Summer Challenges ──────────────────────────────────────────────────────

  {
    id: 'summer_w1_drag_win', season: 'summer', week: '1',
    label: 'Drag Debut',
    description: 'Win a Drag Race in any class.',
    type: 'race_win', target: 1,
    reward: { credits: 15_000 },
    icon: '🚦',
  },
  {
    id: 'summer_w1_explore', season: 'summer', week: '1',
    label: 'Summer Drive',
    description: 'Drive 50 km in free roam.',
    type: 'explore', target: 50,
    reward: { credits: 10_000 },
    icon: '🗺️',
  },
  {
    id: 'summer_w2_drift_gold', season: 'summer', week: '2',
    label: 'Style Points',
    description: 'Earn a Gold medal in any Drift Zone.',
    type: 'drift_score', target: 1,
    reward: { credits: 30_000 },
    icon: '🥇',
  },
  {
    id: 'summer_w2_five_districts', season: 'summer', week: '2',
    label: 'City Tour',
    description: 'Race in events across 5 different districts.',
    type: 'custom', target: 5,
    reward: { credits: 25_000 },
    icon: '🌆',
  },
  {
    id: 'summer_w3_speed_300', season: 'summer', week: '3',
    label: 'Speed Demon',
    description: 'Hit 300 km/h at any Speed Trap.',
    type: 'speed_trap', target: 300,
    reward: { credits: 20_000, liveryId: 'lv_speed_demon' },
    icon: '💥',
  },
  {
    id: 'summer_w4_open_champ', season: 'summer', week: '4',
    label: 'Horizon Open Finalist',
    description: 'Complete the Horizon Open Championship.',
    type: 'custom', target: 1,
    reward: { credits: 80_000 },
    icon: '🏆',
  },
  {
    id: 'summer_seasonal', season: 'summer', week: 'seasonal',
    label: 'Summer Showdown',
    description: 'Complete all Summer weekly chapters.',
    type: 'custom', target: 4,
    reward: { credits: 150_000 },
    icon: '☀️',
  },

  // ── Autumn Challenges ──────────────────────────────────────────────────────

  {
    id: 'autumn_w1_cc_win', season: 'autumn', week: '1',
    label: 'Cross-Country Conqueror',
    description: 'Win any Cross-Country event.',
    type: 'race_win', target: 1,
    reward: { credits: 20_000 },
    icon: '🍂',
  },
  {
    id: 'autumn_w2_ten_races', season: 'autumn', week: '2',
    label: 'Autumn Grind',
    description: 'Complete 10 races of any type.',
    type: 'race_finish', target: 10,
    reward: { credits: 40_000 },
    icon: '🔁',
  },
  {
    id: 'autumn_w3_drift_platinum', season: 'autumn', week: '3',
    label: 'Drift Master',
    description: 'Earn a Platinum medal in any Drift Zone.',
    type: 'drift_score', target: 1,
    reward: { credits: 50_000, clothingId: 'suit_chromatic_spin' },
    icon: '💎',
  },
  {
    id: 'autumn_w4_district_cup', season: 'autumn', week: '4',
    label: 'District Cup Finisher',
    description: 'Complete the District Cup Series Championship.',
    type: 'custom', target: 1,
    reward: { credits: 120_000 },
    icon: '🏅',
  },
  {
    id: 'autumn_seasonal', season: 'autumn', week: 'seasonal',
    label: 'Autumn Complete',
    description: 'Complete all Autumn weekly chapters.',
    type: 'custom', target: 4,
    reward: { credits: 200_000 },
    icon: '🍁',
  },

  // ── Winter Challenges ──────────────────────────────────────────────────────

  {
    id: 'winter_w1_night_run', season: 'winter', week: '1',
    label: 'Night Owl',
    description: 'Complete the Night Run Sprint.',
    type: 'race_finish', target: 1,
    reward: { credits: 25_000 },
    icon: '🌙',
  },
  {
    id: 'winter_w2_hillside', season: 'winter', week: '2',
    label: 'Winter Climb',
    description: 'Win the Hillside Climb sprint.',
    type: 'race_win', target: 1,
    reward: { credits: 30_000 },
    icon: '⛰️',
  },
  {
    id: 'winter_w3_cc_winter', season: 'winter', week: '3',
    label: 'Winter Trail Blazer',
    description: 'Win the Hillside Trail Blaze Cross-Country.',
    type: 'race_win', target: 1,
    reward: { credits: 40_000 },
    icon: '❄️',
  },
  {
    id: 'winter_w4_four_complete', season: 'winter', week: '4',
    label: 'Winter Veteran',
    description: 'Win races in all four seasonal playlists.',
    type: 'custom', target: 4,
    reward: { credits: 100_000 },
    icon: '🥈',
  },
  {
    id: 'winter_seasonal', season: 'winter', week: 'seasonal',
    label: 'Winter Series Complete',
    description: 'Complete all Winter weekly chapters.',
    type: 'custom', target: 4,
    reward: { credits: 250_000, liveryId: 'lv_season_winter' },
    icon: '🌨️',
  },

  // ── Meta / All-Season Challenges ───────────────────────────────────────────

  {
    id: 'meta_festival_champion', season: 'all', week: 'seasonal',
    label: 'Festival Champion',
    description: 'Win the Series Championship across all four seasons.',
    type: 'custom', target: 4,
    reward: { credits: 500_000, liveryId: 'lv_festival_champion' },
    icon: '👑',
  },
];

// ── Playlist progress ──────────────────────────────────────────────────────────

function _loadProgress() {
  try { return JSON.parse(localStorage.getItem(KEY_PLAYLIST_PROGRESS) || '{}'); }
  catch { return {}; }
}

function _saveProgress(obj) {
  localStorage.setItem(KEY_PLAYLIST_PROGRESS, JSON.stringify(obj));
}

function _loadClaimedRewards() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY_PLAYLIST_REWARDS) || '[]')); }
  catch { return new Set(); }
}

function _saveClaimedRewards(set) {
  localStorage.setItem(KEY_PLAYLIST_REWARDS, JSON.stringify([...set]));
}

export function getPlaylistProgress() {
  return _loadProgress();
}

/** Mark a challenge as completed (called by the game engine after relevant activities). */
export function completeChallenge(challengeId) {
  const progress = _loadProgress();
  if (!progress[challengeId]) {
    progress[challengeId] = true;
    _saveProgress(progress);
    return true;
  }
  return false; // already completed
}

export function isChallengeComplete(challengeId) {
  return !!_loadProgress()[challengeId];
}

export function hasClaimedReward(challengeId) {
  return _loadClaimedRewards().has(challengeId);
}

/**
 * Claim the reward for a completed challenge.
 * Grants credits, liveries, or clothing as appropriate.
 * @param {string} challengeId
 * @returns {{ success, reason?, reward? }}
 */
export function claimChallengeReward(challengeId) {
  const challenge = PLAYLIST_CHALLENGES.find(c => c.id === challengeId);
  if (!challenge)                       return { success: false, reason: 'NOT_FOUND' };
  if (!isChallengeComplete(challengeId)) return { success: false, reason: 'NOT_COMPLETED' };
  if (hasClaimedReward(challengeId))    return { success: false, reason: 'ALREADY_CLAIMED' };

  const { reward } = challenge;

  // Grant credits
  if (reward.credits) {
    earn(reward.credits, 'PLAYLIST_REWARD', `Playlist: ${challenge.label}`);
  }
  // Grant livery
  if (reward.liveryId) {
    grantLivery(reward.liveryId);
  }
  // Grant clothing
  if (reward.clothingId) {
    grantClothingItem(reward.clothingId);
  }

  const claimed = _loadClaimedRewards();
  claimed.add(challengeId);
  _saveClaimedRewards(claimed);

  return { success: true, reward };
}

/**
 * Get challenges for a specific season and optional week, decorated with player progress.
 */
export function getPlaylistView(seasonId, week = null) {
  const progress = _loadProgress();
  const claimed  = _loadClaimedRewards();

  return PLAYLIST_CHALLENGES
    .filter(c => c.season === seasonId || c.season === 'all')
    .filter(c => !week || c.week === week)
    .map(c => ({
      ...c,
      completed:   !!progress[c.id],
      claimed:     claimed.has(c.id),
      claimable:   !!progress[c.id] && !claimed.has(c.id),
    }));
}

/** How many challenges are complete vs total in a season/week group. */
export function getPlaylistStats(seasonId, week = null) {
  const challenges = getPlaylistView(seasonId, week);
  const total      = challenges.length;
  const complete   = challenges.filter(c => c.completed).length;
  const claimed    = challenges.filter(c => c.claimed).length;
  return { total, complete, claimed, percent: total > 0 ? Math.round((complete / total) * 100) : 0 };
}

// ── Daily Login ────────────────────────────────────────────────────────────────

/**
 * Attempt to claim the daily login reward.
 * Delegates to economy.js and returns enriched state for the UI.
 */
export function attemptDailyLogin() {
  return claimDailyLogin();
}

/**
 * Get the full 7-day streak UI state.
 * @returns {Array<{ day, reward, claimed, isToday }>}
 */
export function getDailyLoginState() {
  const streak     = parseInt(localStorage.getItem('hc_login_streak') || '0', 10);
  const lastTs     = parseInt(localStorage.getItem('hc_daily_last_ts') || '0', 10);
  const MS_DAY     = 86_400_000;
  const elapsed    = Date.now() - lastTs;
  const canClaim   = elapsed >= MS_DAY;

  return DAILY_LOGIN_REWARDS.map((reward, idx) => ({
    day:      reward.day,
    reward,
    claimed:  idx < streak && !canClaim,
    isToday:  idx === streak && canClaim,
    upcoming: idx > streak || (!canClaim && idx === streak),
  }));
}

// ── Wheelspin ──────────────────────────────────────────────────────────────────

/**
 * Spin the wheel and apply the prize.
 * Returns the prize object or null if no tokens.
 */
export function doWheelspin() {
  const prize = spinWheelspin();
  if (!prize) return null;

  if (prize.type === 'clothing') {
    grantClothingItem(prize.value);
  }
  // 'car' and 'credits' types are handled inside spinWheelspin / need game-level car grant

  return prize;
}

export function getWheelspinTokens() {
  return getWheelspinCount();
}

// ── Global Leaderboard ─────────────────────────────────────────────────────────

/**
 * Returns a merged leaderboard for a given event — bots + player entry.
 * Caches result per event for 60 seconds to avoid re-seeding thrash.
 */
export function getGlobalLeaderboard(eventId, count = 15) {
  return getBotLeaderboard(eventId, count);
}

/**
 * Return a summary of top scores across all drift zones for the Leaderboard Hub screen.
 */
export function getDriftLeaderboards() {
  const driftEventIds = ['drift_industrial', 'drift_hillside', 'drift_harbor'];
  return driftEventIds.map(id => ({
    eventId: id,
    entries: getBotLeaderboard(id, 10),
  }));
}

// ── Game News / Patch Notes ────────────────────────────────────────────────────

export const GAME_NEWS = [
  {
    id: 'news_001',
    title: 'Welcome to Horizon City!',
    date:  '2025-01-01',
    body:  'The festival is open. 40 cars, 6 districts, and the most ambitious open-world racing game built in a browser. Strap in.',
    tag:   'launch',
  },
  {
    id: 'news_002',
    title: 'Spring Playlist Now Live',
    date:  '2025-03-01',
    body:  'The Spring Festival Playlist has arrived. Complete weekly challenges across all districts to earn exclusive liveries and bonus credits.',
    tag:   'playlist',
  },
  {
    id: 'news_003',
    title: 'New Cars: Seiko Electra S & Nakamoto Arrowhead R',
    date:  '2025-04-15',
    body:  'Two new hypercars join the Autoshow this season. The all-electric Electra S and the hybrid Arrowhead R are both available from launch at S1 and S2 class.',
    tag:   'update',
  },
  {
    id: 'news_004',
    title: 'Community Livery Codes Now Supported',
    date:  '2025-05-01',
    body:  'You can now export your paint config as a share code from the Livery Shop and import codes from other players. Find community designs and share your own.',
    tag:   'feature',
  },
];

// ── Hub tile definitions (for the Festival Hub main menu) ──────────────────────

export const HUB_TILES = [
  {
    id:    'daily_login',
    title: 'Daily Reward',
    desc:  'Claim your daily login bonus. Build a streak for bigger rewards and wheelspin tokens.',
    icon:  '🎁',
    badge: null, // Set dynamically to 'Claim Now' if available
  },
  {
    id:    'wheelspin',
    title: 'Wheelspin',
    desc:  'Spin the wheel to win credits, clothing, or a free car. Earn tokens through daily logins and race wins.',
    icon:  '🎡',
    badge: null, // Set dynamically to token count
  },
  {
    id:    'playlist',
    title: 'Festival Playlist',
    desc:  'Weekly and seasonal challenges. Earn exclusive liveries, clothing, and massive credit payouts.',
    icon:  '📋',
    badge: null,
  },
  {
    id:    'leaderboard',
    title: 'Leaderboard',
    desc:  'View global fastest lap times across all circuits and drift zones.',
    icon:  '📊',
    badge: null,
  },
  {
    id:    'livery_share',
    title: 'Community Liveries',
    desc:  'Import a livery share code from another player or export yours to share.',
    icon:  '🎨',
    badge: null,
  },
  {
    id:    'news',
    title: 'Game News',
    desc:  'Latest updates, new cars, seasonal events and patch notes.',
    icon:  '📰',
    badge: 'New',
  },
];

/**
 * Returns Hub tiles decorated with dynamic badge state.
 */
export function getHubTiles() {
  const MS_DAY   = 86_400_000;
  const lastTs   = parseInt(localStorage.getItem('hc_daily_last_ts') || '0', 10);
  const canClaim = Date.now() - lastTs >= MS_DAY;
  const spins    = getWheelspinCount();

  return HUB_TILES.map(tile => {
    const out = { ...tile };
    if (tile.id === 'daily_login' && canClaim) out.badge = 'Claim Now';
    if (tile.id === 'wheelspin' && spins > 0)  out.badge = `${spins} Ready`;
    return out;
  });
}

// ── Hub location ───────────────────────────────────────────────────────────────

export const FESTIVAL_HUB_LOCATION = {
  id:          'festival_hub',
  label:       'Festival Hub',
  district:    'Downtown Core',
  description: 'The beating heart of Horizon City Festival. Music, lights, crowds, and the smell of high-octane fuel. Claim your daily reward, spin the wheel, and check in on seasonal challenges.',
};

// ── Reset ──────────────────────────────────────────────────────────────────────

export function resetFestivalHub() {
  localStorage.removeItem(KEY_PLAYLIST_PROGRESS);
  localStorage.removeItem(KEY_PLAYLIST_REWARDS);
  localStorage.removeItem(KEY_LB_CACHE);
}

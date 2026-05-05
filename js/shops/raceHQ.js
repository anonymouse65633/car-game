/**
 * js/economy/raceHQ.js
 * Horizon City — Race HQ & Event System.
 *
 * Responsibilities:
 *   • Complete race event catalog (circuit, sprint, drag, drift, speed trap, cross-country)
 *   • Browse / filter events by type, class, district, status
 *   • Sign up for events (enforces PR / class requirements, collects entry fees)
 *   • Personal best time tracking per event
 *   • AI leaderboard per event (static bot entries — seeded deterministically)
 *   • Championship bracket logic
 *   • Unclaimed reward queue
 *   • Race result processing & reward handoff to economy.js
 */

import { spend, canAfford, awardRacePayout, CHAMPIONSHIP_ENTRY_FEE } from './Economy.js';

// ── Storage keys ───────────────────────────────────────────────────────────────
const KEY_PB_PREFIX    = 'hc_pb_';       // + eventId → personal best time (ms)
const KEY_RESULTS      = 'hc_results';   // array of completed race result objects
const KEY_UNCLAIMED    = 'hc_unclaimed'; // array of unclaimed rewards

// ── Districts ──────────────────────────────────────────────────────────────────
export const DISTRICTS = [
  { id: 'downtown',    label: 'Downtown Core'       },
  { id: 'harbor',      label: 'Harbor District'     },
  { id: 'industrial',  label: 'Industrial Zone'     },
  { id: 'racing',      label: 'Racing District'     },
  { id: 'hillside',    label: 'Hillside Lookout'    },
  { id: 'suburbs',     label: 'Suburbs District'    },
];

// ── Race types ─────────────────────────────────────────────────────────────────
export const RACE_TYPES = [
  { id: 'circuit',      label: 'Circuit Race',        icon: '🏁', description: 'Closed laps around a circuit. Slipstream battles encouraged.' },
  { id: 'sprint',       label: 'Sprint Race',         icon: '⚡', description: 'Point-to-point. One shot, fastest to the finish line.' },
  { id: 'drag',         label: 'Drag Race',           icon: '🚦', description: 'Straight-line quarter mile. Launch, shift, win.' },
  { id: 'drift',        label: 'Drift Zone',          icon: '💨', description: 'Score points through sustained angle and style.' },
  { id: 'speed_trap',   label: 'Speed Trap',          icon: '📡', description: 'Pass through a sensor zone at maximum speed.' },
  { id: 'cross_country',label: 'Cross-Country',       icon: '🌲', description: 'Mixed surface. Any shortcut is fair game.' },
  { id: 'championship', label: 'Championship',        icon: '🏆', description: 'Multi-race series with an overall standings winner.' },
];

// ── Full event catalog ─────────────────────────────────────────────────────────
/**
 * Each event:
 *   id, type, label, district, description,
 *   allowedClasses: string[] | 'all'
 *   minPR, maxPR (optional class gate by PR)
 *   laps (circuit only), distanceKm (sprint/drag/cc)
 *   opponentCount, difficulty: 'easy'|'normal'|'hard'|'unbeatable'
 *   entryType: 'standard'|'champion'|'elite'
 *   entryFee: number
 *   championshipId?: string (if part of a multi-race series)
 *   thumbnailFile, bannerFile
 */
export const EVENTS = [

  // ── Circuit Races ──────────────────────────────────────────────────────────

  {
    id: 'circuit_grand_d', type: 'circuit',
    label: 'Grand Circuit — D Class',
    district: 'racing',
    description: 'Three laps around the 3.2 km Grand Circuit in the Racing District. The perfect place for new drivers to learn race craft.',
    allowedClasses: ['D'],
    minPR: 0, maxPR: 300,
    laps: 3, distanceKm: 9.6,
    opponentCount: 5, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'circuit_grand.jpg', bannerFile: 'circuit_grand_banner.jpg',
  },
  {
    id: 'circuit_grand_c', type: 'circuit',
    label: 'Grand Circuit — C Class',
    district: 'racing',
    description: 'The Grand Circuit in C class. Higher speeds, sharper battles at the complex chicane.',
    allowedClasses: ['C'],
    minPR: 300, maxPR: 450,
    laps: 3, distanceKm: 9.6,
    opponentCount: 5, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'circuit_grand.jpg', bannerFile: 'circuit_grand_banner.jpg',
  },
  {
    id: 'circuit_grand_b', type: 'circuit',
    label: 'Grand Circuit — B Class',
    district: 'racing',
    description: 'B class at the Grand Circuit. The slipstream battles on the main straight are intense.',
    allowedClasses: ['B'],
    minPR: 450, maxPR: 650,
    laps: 3, distanceKm: 9.6,
    opponentCount: 6, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'circuit_grand.jpg', bannerFile: 'circuit_grand_banner.jpg',
  },
  {
    id: 'circuit_grand_a', type: 'circuit',
    label: 'Grand Circuit — A Class',
    district: 'racing',
    description: 'A class power meets the demanding Grand Circuit. One mistake and three positions gone.',
    allowedClasses: ['A'],
    minPR: 650, maxPR: 800,
    laps: 3, distanceKm: 9.6,
    opponentCount: 6, difficulty: 'hard',
    entryType: 'champion', entryFee: CHAMPIONSHIP_ENTRY_FEE.champion,
    thumbnailFile: 'circuit_grand.jpg', bannerFile: 'circuit_grand_banner.jpg',
  },
  {
    id: 'circuit_grand_s1', type: 'circuit',
    label: 'Grand Circuit — S1 Class',
    district: 'racing',
    description: 'Hypercar territory at the Grand Circuit. Corner entry speeds are borderline terrifying.',
    allowedClasses: ['S1'],
    minPR: 800, maxPR: 930,
    laps: 3, distanceKm: 9.6,
    opponentCount: 5, difficulty: 'hard',
    entryType: 'champion', entryFee: CHAMPIONSHIP_ENTRY_FEE.champion,
    thumbnailFile: 'circuit_grand.jpg', bannerFile: 'circuit_grand_banner.jpg',
  },
  {
    id: 'circuit_grand_s2', type: 'circuit',
    label: 'Grand Circuit — S2 Invitational',
    district: 'racing',
    description: 'S2 machines on the Grand Circuit. The fastest laps you\'ll ever drive in Horizon City.',
    allowedClasses: ['S2'],
    minPR: 930,
    laps: 3, distanceKm: 9.6,
    opponentCount: 5, difficulty: 'unbeatable',
    entryType: 'elite', entryFee: CHAMPIONSHIP_ENTRY_FEE.elite,
    thumbnailFile: 'circuit_grand.jpg', bannerFile: 'circuit_grand_banner.jpg',
  },
  {
    id: 'circuit_downtown', type: 'circuit',
    label: 'Downtown Ring',
    district: 'downtown',
    description: 'A 2.1 km technical circuit weaving through the streets of Downtown Core. Four laps of tight, punishing corners.',
    allowedClasses: ['D','C','B'],
    minPR: 0, maxPR: 650,
    laps: 4, distanceKm: 8.4,
    opponentCount: 6, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'circuit_downtown.jpg', bannerFile: 'circuit_downtown_banner.jpg',
  },
  {
    id: 'circuit_waterfront', type: 'circuit',
    label: 'Waterfront Circuit',
    district: 'harbor',
    description: 'Three laps of the 2.8 km Waterfront Circuit. A long bridge section lets fast cars stretch their legs.',
    allowedClasses: ['C','B','A'],
    minPR: 300, maxPR: 800,
    laps: 3, distanceKm: 8.4,
    opponentCount: 5, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'circuit_waterfront.jpg', bannerFile: 'circuit_waterfront_banner.jpg',
  },

  // ── Sprint Races ───────────────────────────────────────────────────────────

  {
    id: 'sprint_harbor', type: 'sprint',
    label: 'Harbor Sprint',
    district: 'harbor',
    description: 'A 4.5 km blast from the Waterfront docks to the Racing District. Fast, wide, and mostly flat — top speed matters here.',
    allowedClasses: ['D','C','B','A','S1','S2'],
    minPR: 0,
    distanceKm: 4.5, opponentCount: 4, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'sprint_harbor.jpg', bannerFile: 'sprint_harbor_banner.jpg',
  },
  {
    id: 'sprint_hillside', type: 'sprint',
    label: 'Hillside Climb',
    district: 'hillside',
    description: 'A 3.8 km technical ascent from Downtown Core to Hillside Lookout. Elevation and hairpins reward suspension tuning.',
    allowedClasses: ['D','C','B','A','S1'],
    minPR: 0, maxPR: 930,
    distanceKm: 3.8, opponentCount: 4, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'sprint_hillside.jpg', bannerFile: 'sprint_hillside_banner.jpg',
  },
  {
    id: 'sprint_industrial', type: 'sprint',
    label: 'Industrial Dash',
    district: 'industrial',
    description: 'A 2.9 km straight shot through the Industrial Zone. Wide roads and minimal corners make this a drag-spec test.',
    allowedClasses: ['D','C'],
    minPR: 0, maxPR: 450,
    distanceKm: 2.9, opponentCount: 3, difficulty: 'easy',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'sprint_industrial.jpg', bannerFile: 'sprint_industrial_banner.jpg',
  },
  {
    id: 'sprint_city_cross', type: 'sprint',
    label: 'City Cross',
    district: 'downtown',
    description: 'A 5.1 km serpentine route from Downtown to Suburbs through back alleys. Tight and tactical — route choice can win it.',
    allowedClasses: ['D','C','B'],
    minPR: 0, maxPR: 650,
    distanceKm: 5.1, opponentCount: 5, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'sprint_city_cross.jpg', bannerFile: 'sprint_city_cross_banner.jpg',
  },
  {
    id: 'sprint_night_run', type: 'sprint',
    label: 'Night Run',
    district: 'downtown',
    description: 'A nocturnal point-to-point spanning the full width of the city under neon lights. All classes welcome.',
    allowedClasses: ['D','C','B','A','S1','S2'],
    minPR: 0,
    distanceKm: 7.2, opponentCount: 6, difficulty: 'hard',
    entryType: 'champion', entryFee: CHAMPIONSHIP_ENTRY_FEE.champion,
    thumbnailFile: 'sprint_night_run.jpg', bannerFile: 'sprint_night_run_banner.jpg',
  },

  // ── Drag Races ─────────────────────────────────────────────────────────────

  {
    id: 'drag_harbor_strip', type: 'drag',
    label: 'Harbor Strip — Quarter Mile',
    district: 'harbor',
    description: 'The Harbor\'s purpose-built quarter-mile drag strip. Launch control, perfect shifts, win.',
    allowedClasses: ['D','C','B','A','S1','S2'],
    minPR: 0,
    distanceKm: 0.402, opponentCount: 1, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'drag_harbor.jpg', bannerFile: 'drag_harbor_banner.jpg',
  },
  {
    id: 'drag_industrial_half', type: 'drag',
    label: 'Industrial Zone — Half Mile',
    district: 'industrial',
    description: 'The longer half-mile industrial drag. Top speed becomes the deciding factor beyond 400m.',
    allowedClasses: ['B','A','S1','S2'],
    minPR: 450,
    distanceKm: 0.805, opponentCount: 2, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'drag_industrial.jpg', bannerFile: 'drag_industrial_banner.jpg',
  },
  {
    id: 'drag_elite', type: 'drag',
    label: 'Elite Drag Invitational',
    district: 'racing',
    description: 'Three-car drag invitational for S1 and S2 machines. Side bets encouraged.',
    allowedClasses: ['S1','S2'],
    minPR: 800,
    distanceKm: 0.402, opponentCount: 2, difficulty: 'unbeatable',
    entryType: 'elite', entryFee: CHAMPIONSHIP_ENTRY_FEE.elite,
    thumbnailFile: 'drag_elite.jpg', bannerFile: 'drag_elite_banner.jpg',
  },

  // ── Drift Zones ────────────────────────────────────────────────────────────

  {
    id: 'drift_industrial', type: 'drift',
    label: 'Industrial Concrete Drift Zone',
    district: 'industrial',
    description: 'A vast industrial concrete area with marked clipping points. Beginner-friendly open layout.',
    allowedClasses: ['D','C','B','A','S1','S2'],
    minPR: 0,
    distanceKm: 0.8, opponentCount: 0, difficulty: 'easy',
    entryType: 'standard', entryFee: 0,
    scoreTargets: { bronze: 50_000, silver: 120_000, gold: 250_000, platinum: 500_000 },
    thumbnailFile: 'drift_industrial.jpg', bannerFile: 'drift_industrial_banner.jpg',
  },
  {
    id: 'drift_hillside', type: 'drift',
    label: 'Hillside Hairpin Drift',
    district: 'hillside',
    description: 'A classic mountain hairpin section designed for commitment and angle. Chain the corners for the multiplier.',
    allowedClasses: ['D','C','B','A','S1','S2'],
    minPR: 0,
    distanceKm: 0.5, opponentCount: 0, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    scoreTargets: { bronze: 80_000, silver: 200_000, gold: 420_000, platinum: 800_000 },
    thumbnailFile: 'drift_hillside.jpg', bannerFile: 'drift_hillside_banner.jpg',
  },
  {
    id: 'drift_harbor', type: 'drift',
    label: 'Harbor Promenade Drift',
    district: 'harbor',
    description: 'A long coastal promenade with a scenic backdrop and high clipping point bonuses.',
    allowedClasses: ['C','B','A','S1'],
    minPR: 300, maxPR: 930,
    distanceKm: 0.9, opponentCount: 0, difficulty: 'hard',
    entryType: 'standard', entryFee: 0,
    scoreTargets: { bronze: 150_000, silver: 350_000, gold: 700_000, platinum: 1_200_000 },
    thumbnailFile: 'drift_harbor.jpg', bannerFile: 'drift_harbor_banner.jpg',
  },

  // ── Speed Traps ────────────────────────────────────────────────────────────

  {
    id: 'speedtrap_harbor_bridge', type: 'speed_trap',
    label: 'Harbor Bridge Speed Trap',
    district: 'harbor',
    description: 'The long bridge straight. Pass the sensor at max speed — a top gear burst in anything quick.',
    allowedClasses: ['D','C','B','A','S1','S2'],
    minPR: 0,
    distanceKm: 0.3, opponentCount: 0, difficulty: 'easy',
    entryType: 'standard', entryFee: 0,
    speedTargets: { bronze: 180, silver: 220, gold: 260, platinum: 310 }, // km/h
    thumbnailFile: 'speedtrap_bridge.jpg', bannerFile: 'speedtrap_bridge_banner.jpg',
  },
  {
    id: 'speedtrap_industrial_straight', type: 'speed_trap',
    label: 'Industrial Straight Speed Trap',
    district: 'industrial',
    description: 'The longest uninterrupted straight in the city. S2 cars can approach 400 km/h.',
    allowedClasses: ['B','A','S1','S2'],
    minPR: 450,
    distanceKm: 0.5, opponentCount: 0, difficulty: 'hard',
    entryType: 'standard', entryFee: 0,
    speedTargets: { bronze: 240, silver: 290, gold: 330, platinum: 380 },
    thumbnailFile: 'speedtrap_industrial.jpg', bannerFile: 'speedtrap_industrial_banner.jpg',
  },

  // ── Cross-Country ──────────────────────────────────────────────────────────

  {
    id: 'cc_outer_loop', type: 'cross_country',
    label: 'Outer City Loop',
    district: 'suburbs',
    description: 'A mixed-surface loop around the edge of the city. Tarmac, gravel, and a muddy field section near the Suburbs.',
    allowedClasses: ['D','C','B','A'],
    minPR: 0, maxPR: 800,
    distanceKm: 12.4, opponentCount: 6, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'cc_outer.jpg', bannerFile: 'cc_outer_banner.jpg',
  },
  {
    id: 'cc_hillside_trail', type: 'cross_country',
    label: 'Hillside Trail Blaze',
    district: 'hillside',
    description: 'Off-road tracks through forest and open hillside. AWD and off-road tyres strongly recommended.',
    allowedClasses: ['D','C','B','A','S1'],
    minPR: 0, maxPR: 930,
    distanceKm: 8.6, opponentCount: 5, difficulty: 'normal',
    entryType: 'standard', entryFee: 0,
    thumbnailFile: 'cc_hillside.jpg', bannerFile: 'cc_hillside_banner.jpg',
  },
  {
    id: 'cc_city_mayhem', type: 'cross_country',
    label: 'City Mayhem',
    district: 'downtown',
    description: 'All-class open city cross-country. No rules on the route — fastest to the finish line wins.',
    allowedClasses: ['D','C','B','A','S1','S2'],
    minPR: 0,
    distanceKm: 15.0, opponentCount: 7, difficulty: 'hard',
    entryType: 'champion', entryFee: CHAMPIONSHIP_ENTRY_FEE.champion,
    thumbnailFile: 'cc_city.jpg', bannerFile: 'cc_city_banner.jpg',
  },

  // ── Championships ──────────────────────────────────────────────────────────

  {
    id: 'champ_rookie_series', type: 'championship',
    label: 'Rookie Series Championship',
    district: 'racing',
    description: 'A 3-race championship for D and C class. Win the series to unlock the C-Class Autoshow discount.',
    allowedClasses: ['D','C'],
    minPR: 0, maxPR: 450,
    opponentCount: 5, difficulty: 'normal',
    entryType: 'champion', entryFee: CHAMPIONSHIP_ENTRY_FEE.champion,
    rounds: ['circuit_downtown', 'sprint_industrial', 'circuit_grand_d'],
    championshipPayout: 50_000,
    thumbnailFile: 'champ_rookie.jpg', bannerFile: 'champ_rookie_banner.jpg',
  },
  {
    id: 'champ_horizon_open', type: 'championship',
    label: 'Horizon Open',
    district: 'racing',
    description: 'A prestige 4-race championship open to all classes. Points-based — consistency wins.',
    allowedClasses: ['D','C','B','A','S1','S2'],
    minPR: 0,
    opponentCount: 7, difficulty: 'hard',
    entryType: 'elite', entryFee: CHAMPIONSHIP_ENTRY_FEE.elite,
    rounds: ['circuit_grand_c', 'sprint_harbor', 'circuit_waterfront', 'sprint_night_run'],
    championshipPayout: 250_000,
    thumbnailFile: 'champ_open.jpg', bannerFile: 'champ_open_banner.jpg',
  },
  {
    id: 'champ_district_cup', type: 'championship',
    label: 'District Cup Series',
    district: 'racing',
    description: 'Five races spanning every district of Horizon City. The most comprehensive championship in the game.',
    allowedClasses: ['B','A','S1'],
    minPR: 450, maxPR: 930,
    opponentCount: 6, difficulty: 'hard',
    entryType: 'elite', entryFee: CHAMPIONSHIP_ENTRY_FEE.elite,
    rounds: ['circuit_downtown', 'sprint_hillside', 'cc_outer_loop', 'circuit_waterfront', 'circuit_grand_a'],
    championshipPayout: 500_000,
    thumbnailFile: 'champ_district.jpg', bannerFile: 'champ_district_banner.jpg',
  },
];

// ── Lookup helpers ─────────────────────────────────────────────────────────────

export function getEventById(id) {
  return EVENTS.find(e => e.id === id) ?? null;
}

export function getEventsByType(type) {
  return EVENTS.filter(e => e.type === type);
}

export function getEventsByDistrict(districtId) {
  return EVENTS.filter(e => e.district === districtId);
}

// ── Browse & filter ────────────────────────────────────────────────────────────

/**
 * @param {object} [filters]
 * @param {string}   [filters.type]       race type id
 * @param {string}   [filters.district]   district id
 * @param {string}   [filters.carClass]   only show events available to this class
 * @param {number}   [filters.playerPR]   filter by player PR against event min/max
 * @param {string}   [filters.entryType]  'standard'|'champion'|'elite'
 * @param {string}   [filters.search]
 */
export function browseEvents(filters = {}) {
  const { type, district, carClass, playerPR, entryType, search } = filters;
  const pbs = _loadAllPBs();

  let list = [...EVENTS];

  if (type)       list = list.filter(e => e.type === type);
  if (district)   list = list.filter(e => e.district === district);
  if (entryType)  list = list.filter(e => e.entryType === entryType);
  if (carClass) {
    list = list.filter(e =>
      e.allowedClasses === 'all' || e.allowedClasses.includes(carClass)
    );
  }
  if (playerPR != null) {
    list = list.filter(e => {
      if (e.minPR != null && playerPR < e.minPR) return false;
      if (e.maxPR != null && playerPR > e.maxPR) return false;
      return true;
    });
  }
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(e =>
      e.label.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );
  }

  const balance = parseInt(localStorage.getItem('hc_credits') || '0', 10);

  return list.map(ev => ({
    ...ev,
    personalBest: pbs[ev.id] ?? null,
    canAffordEntry: balance >= ev.entryFee,
    isLocked: carClass
      ? !(ev.allowedClasses === 'all' || ev.allowedClasses.includes(carClass))
      : false,
  }));
}

// ── Personal best times ────────────────────────────────────────────────────────

function _pbKey(eventId) { return `${KEY_PB_PREFIX}${eventId}`; }

export function getPersonalBest(eventId) {
  const raw = localStorage.getItem(_pbKey(eventId));
  return raw ? parseInt(raw, 10) : null;
}

function _loadAllPBs() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(KEY_PB_PREFIX)) {
      out[k.slice(KEY_PB_PREFIX.length)] = parseInt(localStorage.getItem(k), 10);
    }
  }
  return out;
}

export function submitPersonalBest(eventId, timeMs) {
  const current = getPersonalBest(eventId);
  if (current === null || timeMs < current) {
    localStorage.setItem(_pbKey(eventId), String(Math.floor(timeMs)));
    return { improved: true, previous: current, newBest: timeMs };
  }
  return { improved: false, previous: current, newBest: current };
}

export function formatTime(ms) {
  if (ms == null) return '—';
  const m  = Math.floor(ms / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// ── AI Bot Leaderboard ─────────────────────────────────────────────────────────

const BOT_NAMES = [
  'Damien Wolfe', 'Cassandra Park', 'Ryan Muto', 'Lena Voss', 'Omar Khalil',
  'Petra Novak', 'Sione Taufa', 'Hiroshi Kato', 'Maya Brennan', 'Tomas Rios',
  'Ayesha Patel', 'Callum Ross', 'Ingrid Holm', 'Kofi Asante', 'Sofia Vega',
];

/**
 * Generate a deterministic leaderboard for an event.
 * Seed is based on the event id hash so results are consistent between sessions.
 * @param {string} eventId
 * @param {number} [count=10]
 * @returns {Array<{ rank, name, time, timeMs }>}
 */
export function getBotLeaderboard(eventId, count = 10) {
  const event = getEventById(eventId);
  if (!event) return [];

  // Seeded pseudo-random from event id
  let seed = [...eventId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };

  // Base time: rough estimate from event distance & difficulty
  const baseSec = (event.distanceKm ?? 3) * 60 * _difficultyTimeMult(event.difficulty);
  const baseMs  = baseSec * 1000;

  const entries = [];
  for (let i = 0; i < count; i++) {
    const spread = 1 + (i / count) * 0.18; // top bot fastest, 18% spread across 10
    const jitter = 0.98 + rand() * 0.04;
    const timeMs = Math.floor(baseMs * spread * jitter);
    entries.push({
      rank:    i + 1,
      name:    BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)],
      timeMs,
      time:    formatTime(timeMs),
      isBot:   true,
    });
  }

  // Inject player PB if it exists
  const pb = getPersonalBest(eventId);
  if (pb != null) {
    entries.push({ rank: 0, name: 'You', timeMs: pb, time: formatTime(pb), isBot: false });
    entries.sort((a, b) => a.timeMs - b.timeMs);
    entries.forEach((e, idx) => { e.rank = idx + 1; });
  }

  return entries;
}

function _difficultyTimeMult(diff) {
  return { easy: 1.25, normal: 1.0, hard: 0.88, unbeatable: 0.80 }[diff] ?? 1.0;
}

// ── Sign-up & event entry ──────────────────────────────────────────────────────

/**
 * Sign up for an event.
 * Validates class, PR, and credits. Deducts entry fee.
 * Returns the event data ready to pass to the race engine.
 *
 * @param {string} eventId
 * @param {object} opts
 * @param {string} opts.carClass   Player's current car class
 * @param {number} opts.playerPR   Player's current PR
 * @returns {{ success, reason?, event?, entryFee? }}
 */
export function signUpForEvent(eventId, { carClass, playerPR }) {
  const event = getEventById(eventId);
  if (!event) return { success: false, reason: 'EVENT_NOT_FOUND' };

  // Class check
  if (event.allowedClasses !== 'all' && !event.allowedClasses.includes(carClass)) {
    return { success: false, reason: 'WRONG_CLASS' };
  }
  // PR floor
  if (event.minPR != null && playerPR < event.minPR) {
    return { success: false, reason: 'PR_TOO_LOW', minPR: event.minPR };
  }
  // PR ceiling
  if (event.maxPR != null && playerPR > event.maxPR) {
    return { success: false, reason: 'PR_TOO_HIGH', maxPR: event.maxPR };
  }
  // Entry fee
  if (event.entryFee > 0) {
    if (!canAfford(event.entryFee)) {
      return { success: false, reason: 'INSUFFICIENT_CREDITS', entryFee: event.entryFee };
    }
    const result = spend(event.entryFee, 'RACE_ENTRY_FEE', `Entry: ${event.label}`);
    if (!result.success) return { success: false, reason: 'SPEND_FAILED' };
  }

  return { success: true, event, entryFee: event.entryFee };
}

// ── Race result processing ─────────────────────────────────────────────────────

/**
 * Record a completed race result and queue the reward.
 * Call this after the race engine delivers its result.
 *
 * @param {object} result
 * @param {string} result.eventId
 * @param {number} result.position   1 = win
 * @param {number} result.timeMs
 * @param {string} result.carClass
 * @param {string} result.difficulty
 * @param {boolean} [result.championship]
 */
export function recordRaceResult(result) {
  const { eventId, position, timeMs, carClass, difficulty, championship = false } = result;

  // Save PB
  const pbResult = submitPersonalBest(eventId, timeMs);

  // Award credits
  const credits = awardRacePayout({ carClass, position, difficulty, championship });

  // Save result to history
  const history = _loadResults();
  history.unshift({
    eventId,
    position,
    timeMs,
    credits,
    pbResult,
    ts: Date.now(),
  });
  if (history.length > 100) history.length = 100;
  _saveResults(history);

  return { credits, pbResult };
}

function _loadResults() {
  try { return JSON.parse(localStorage.getItem(KEY_RESULTS) || '[]'); }
  catch { return []; }
}
function _saveResults(arr) { localStorage.setItem(KEY_RESULTS, JSON.stringify(arr)); }

export function getRecentResults(count = 20) {
  return _loadResults().slice(0, count);
}

// ── Unclaimed rewards ──────────────────────────────────────────────────────────

export function getUnclaimedRewards() {
  try { return JSON.parse(localStorage.getItem(KEY_UNCLAIMED) || '[]'); }
  catch { return []; }
}

export function clearUnclaimedRewards() {
  localStorage.removeItem(KEY_UNCLAIMED);
}

// ── Shop location ──────────────────────────────────────────────────────────────

export const RACE_HQ_LOCATION = {
  id:          'racing_hq',
  label:       'Race HQ',
  district:    'Racing District',
  description: 'The official race sign-up centre for Horizon City. Chequered flag banners, timing screens, and the smell of race fuel. Browse all events, check standings, and claim your winnings.',
};

// ── Reset ──────────────────────────────────────────────────────────────────────

export function resetRaceHQ() {
  // Clear all PBs
  const keysToDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(KEY_PB_PREFIX)) keysToDelete.push(k);
  }
  keysToDelete.forEach(k => localStorage.removeItem(k));
  localStorage.removeItem(KEY_RESULTS);
  localStorage.removeItem(KEY_UNCLAIMED);
}

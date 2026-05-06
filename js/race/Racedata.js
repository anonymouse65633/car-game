/**
 * js/race/raceData.js
 * Horizon City — Race Event Definitions.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PLAN REFERENCE: Part 7.2 (Race Types), Part 7.3 (Race Event Structure),
 *                 Part 7.8 (Race Results & Rewards), Part 7.10 (Race Discovery)
 *
 * PLAN NOTES — Six Race Types:
 *   1. Circuit    — Closed loop, 2–5 laps, 4–7 AI opponents, slipstream bonus
 *   2. Sprint     — Point-to-point, no laps, 3–5 AI, route choice forks
 *   3. Drag       — Quarter-mile (402m) or half-mile (805m), launch control,
 *                   shift timing, reaction time measured from green light
 *   4. Drift Zone — Solo scored challenge, no opponents, Bronze/Silver/Gold/Platinum
 *                   tiers; score = angle × speed × sustained time × chain bonus
 *   5. Speed Trap — Single sensor point, no opponents, ghost leaderboard,
 *                   always accessible in free roam (no setup required)
 *   6. Speed Zone — Average speed through a 200m–1.5km section
 *
 * PLAN NOTES — Event Structure Types:
 *   • One-Off      — Available any time, re-playable, instant reward
 *   • Championship — 3–5 races in series, points per race, entry fee 1,000 CR,
 *                    payout 5× to winner; unlocked after all one-offs in a district
 *   • Showcase     — Scripted set-piece (Phase 2, framework here in Phase 1)
 *   • Playlist     — Weekly rotating events; specific class / type restrictions
 *
 * PLAN NOTES — Credit Payout Formula (Part 7.8):
 *   Base × DifficultyMultiplier × (1 + AssistsOffBonus) × PositionModifier
 *   PositionModifier: 1st=1.0, 2nd=0.6, 3rd=0.35, 4th+=0.15
 *
 * PLAN NOTES — Race Discovery (Part 7.10):
 *   • Floating checkered flag icon at start location in world
 *   • Race Board billboards in each district list local events
 *   • Map (M key) shows all races; filter by type; favourite a race
 *   • Icons: white = never entered, gold trophy = personal best beaten
 *
 * PLAN NOTES — Phase 1 Routes:
 *   Circuits: Grand Circuit (Racing District, 3.2km, 3 laps),
 *             Downtown Ring (Downtown Core, 2.1km, 4 laps),
 *             Waterfront Circuit (Harbor, 2.8km, 3 laps)
 *   Sprints:  Harbor Sprint (4.5km, fast & straight),
 *             Hillside Climb (3.8km, technical elevation),
 *             Industrial Dash (2.9km, D/C class bias),
 *             City Cross (5.1km, tight & tactical)
 *   Drag:     Harbor Drag Strip (quarter + half mile),
 *             Industrial Straight (quarter mile)
 *   Drift:    Industrial Concrete, Hillside Hairpin, Harbor Promenade
 *   Speed Traps: 20 across the city, discovered via free roam
 *   Speed Zones: Highway Ring, Waterfront Boulevard, Hillside Switchback
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ── Race type constants ────────────────────────────────────────────────────────

/** @type {const} */
export const RACE_TYPE = {
  CIRCUIT:     'circuit',
  SPRINT:      'sprint',
  DRAG:        'drag',
  DRIFT:       'drift',
  SPEED_TRAP:  'speed_trap',
  SPEED_ZONE:  'speed_zone',
};

/** @type {const} */
export const EVENT_TYPE = {
  ONE_OFF:      'one_off',
  CHAMPIONSHIP: 'championship',
  SHOWCASE:     'showcase',    // Phase 2 — framework only
  PLAYLIST:     'playlist',
};

// ── Position payout modifiers ──────────────────────────────────────────────────

export const POSITION_MODIFIER = {
  1: 1.00,
  2: 0.60,
  3: 0.35,
  _default: 0.15,
};

/**
 * Calculate credit payout for a race result.
 * @param {number} basePayout
 * @param {number} position          Finishing position (1-indexed)
 * @param {number} difficultyMult    From DIFFICULTY table in raceManager.js
 * @param {number} assistsOffBonus   0.0–0.80 additive (from disabled assists)
 * @returns {number}
 */
export function calcRacePayout(basePayout, position, difficultyMult, assistsOffBonus) {
  const posMod = POSITION_MODIFIER[position] ?? POSITION_MODIFIER._default;
  return Math.floor(basePayout * difficultyMult * (1 + assistsOffBonus) * posMod);
}

// ── XP payout ─────────────────────────────────────────────────────────────────

/** Base XP per race finish (before multipliers). Scales with race length & class. */
export const BASE_XP = {
  [RACE_TYPE.CIRCUIT]:    { short: 800,  medium: 1400, long: 2200 },
  [RACE_TYPE.SPRINT]:     { short: 600,  medium: 1000, long: 1600 },
  [RACE_TYPE.DRAG]:       { short: 400,  medium: 600,  long: 600  },
  [RACE_TYPE.DRIFT]:      { short: 300,  medium: 500,  long: 800  },
  [RACE_TYPE.SPEED_TRAP]: { short: 200,  medium: 200,  long: 200  },
  [RACE_TYPE.SPEED_ZONE]: { short: 300,  medium: 400,  long: 500  },
};

export const XP_BONUS = {
  WIN:        500,
  PERSONAL_BEST: 300,
  CLEAN_RACE: 200,  // no rewinds used
  FIRST_WIN:  500,  // first time winning this specific race
};

// ── Circuit races ──────────────────────────────────────────────────────────────

/**
 * @typedef {object} RaceEvent
 * @property {string}   id
 * @property {string}   name
 * @property {string}   type         RACE_TYPE value
 * @property {string}   eventType    EVENT_TYPE value
 * @property {string}   district
 * @property {string}   description
 * @property {string[]} classFilter  e.g. ['D','C'] — empty = all classes
 * @property {number}   minPR
 * @property {number}   maxPR        0 = no cap
 * @property {number}   laps         Circuit only
 * @property {number}   distanceKm
 * @property {string}   lengthBand   'short'|'medium'|'long' — for XP lookup
 * @property {number}   basePayout   Credits for 1st on Experienced difficulty
 * @property {number}   aiCount
 * @property {object}   startPos     { x, y, z, rotY } world position
 * @property {string[]} waypointFile Path to waypoint JSON in assets/data/waypoints/
 * @property {boolean}  hasRouteFork Sprint only — player can choose diverging paths
 * @property {number}   entryFee     0 = free; championship events charge 1,000 CR
 * @property {string[]} prerequisites  Event IDs that must be completed first
 * @property {boolean}  isShowcase   Phase 2 content — present but not fully implemented
 */

export const RACES = [

  // ═══════════════════════════════════════════════════════════════════════════
  // CIRCUITS — closed loops, multi-lap
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'circuit_guanajuato_grand',
    name: 'Guanajuato Grand Circuit',
    type: RACE_TYPE.CIRCUIT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Guanajuato',
    description: 'A 4.2km loop through the colorful colonial streets of Guanajuato. Tight corners, elevation changes, and cobblestones make this a true driver\'s circuit.',
    classFilter: ['C', 'B'],
    minPR: 0, maxPR: 700,
    laps: 4, distanceKm: 4.2, lengthBand: 'long',
    basePayout: 28_000,
    aiCount: 6,
    startPos: { x: 1800, y: 82, z: -2300, rotY: 0 },
    waypointFile: 'assets/data/waypoints/circuit_guanajuato_grand.json',
  },
  {
    id: 'circuit_riviera_seaside',
    name: 'Riviera Seaside Circuit',
    type: RACE_TYPE.CIRCUIT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Riviera Maya',
    description: 'A 3.8km coastal loop with ocean views, long straights along the promenade, and a technical marina section.',
    classFilter: ['B', 'A'],
    minPR: 0, maxPR: 800,
    laps: 3, distanceKm: 3.8, lengthBand: 'medium',
    basePayout: 24_000,
    aiCount: 6,
    startPos: { x: 3400, y: 5, z: -1600, rotY: 1.57 },
    waypointFile: 'assets/data/waypoints/circuit_riviera_seaside.json',
  },
  {
    id: 'circuit_festival_arena',
    name: 'Festival Arena Circuit',
    type: RACE_TYPE.CIRCUIT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Festival Grounds',
    description: 'A 2.1km flat race circuit carved from the festival perimeter road. Wide, fast, and perfect for beginners.',
    classFilter: ['D', 'C'],
    minPR: 0, maxPR: 500,
    laps: 5, distanceKm: 2.1, lengthBand: 'short',
    basePayout: 14_000,
    aiCount: 7,
    startPos: { x: -1800, y: 20, z: 700, rotY: 0 },
    waypointFile: 'assets/data/waypoints/circuit_festival_arena.json',
  },
  {
    id: 'circuit_caldera_ring',
    name: 'Caldera Ring',
    type: RACE_TYPE.CIRCUIT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Gran Caldera',
    description: 'A brutal 6.5km loop up the volcano approach roads. 400m of elevation gain, volcanic gravel, and hairpin switchbacks. A class only.',
    classFilter: ['A', 'S1'],
    minPR: 700, maxPR: 0,
    laps: 2, distanceKm: 6.5, lengthBand: 'long',
    basePayout: 50_000,
    aiCount: 5,
    startPos: { x: 2200, y: 82, z: -2900, rotY: 0 },
    waypointFile: 'assets/data/waypoints/circuit_caldera_ring.json',
  },
  {
    id: 'circuit_baja_dirt',
    name: 'Baja Dirt Circuit',
    type: RACE_TYPE.CIRCUIT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Baja Desert',
    description: 'A 5.2km off-road loop around the Baja mesa. Loose dirt, long jumps, and blind crests — built for trucks and rally cars.',
    classFilter: ['B', 'A'],
    minPR: 0, maxPR: 0,
    laps: 3, distanceKm: 5.2, lengthBand: 'long',
    basePayout: 36_000,
    aiCount: 6,
    startPos: { x: -3000, y: 90, z: 1000, rotY: 3.14 },
    waypointFile: 'assets/data/waypoints/circuit_baja_dirt.json',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SPRINTS — point-to-point
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'sprint_festival_to_guanajuato',
    name: 'Festival to Guanajuato',
    type: RACE_TYPE.SPRINT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Festival Grounds',
    description: 'An 8.2km blast from the festival airstrip up into the colonial city of Guanajuato — crossing farmland and gaining 60m of elevation.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    laps: 1, distanceKm: 8.2, lengthBand: 'long',
    basePayout: 40_000,
    aiCount: 5,
    startPos:  { x: -1800, y: 20, z: 1000, rotY: 0 },
    finishPos: { x: 1800,  y: 82, z: -2000 },
    waypointFile: 'assets/data/waypoints/sprint_festival_to_guanajuato.json',
  },
  {
    id: 'sprint_caldera_descent',
    name: 'Caldera Summit Descent',
    type: RACE_TYPE.SPRINT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Gran Caldera',
    description: 'A terrifying 4.5km downhill sprint from the summit to the caldera base. 800m of altitude lost. No brakes allowed.',
    classFilter: ['A', 'S1', 'S2'],
    minPR: 700, maxPR: 0,
    laps: 1, distanceKm: 4.5, lengthBand: 'medium',
    basePayout: 45_000,
    aiCount: 4,
    startPos:  { x: 3500, y: 800, z: -4000, rotY: 3.14 },
    finishPos: { x: 2200, y: 82,  z: -2900 },
    waypointFile: 'assets/data/waypoints/sprint_caldera_descent.json',
  },
  {
    id: 'sprint_riviera_coastal',
    name: 'Riviera Coastal Sprint',
    type: RACE_TYPE.SPRINT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Riviera Maya',
    description: 'A 6.8km coastal run from the northern Riviera down to the Riviera harbor. Flat, fast, and spectacular.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    laps: 1, distanceKm: 6.8, lengthBand: 'long',
    basePayout: 38_000,
    aiCount: 6,
    startPos:  { x: 4700, y: 5, z: -2200, rotY: 1.57 },
    finishPos: { x: 3800, y: 5, z:  -800 },
    waypointFile: 'assets/data/waypoints/sprint_riviera_coastal.json',
  },
  {
    id: 'sprint_cross_country_baja_jungle',
    name: 'Cross-Country: Baja to Jungle',
    type: RACE_TYPE.SPRINT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Baja Desert',
    description: 'The longest race on the map — 12km from the Baja desert straight across to the jungle. Multiple surface types, no single ideal line.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    laps: 1, distanceKm: 12.0, lengthBand: 'very_long',
    basePayout: 70_000,
    aiCount: 5,
    startPos:  { x: -3800, y: 120, z:  600, rotY: 1.57 },
    finishPos: { x:  1800, y:  30, z: 3200 },
    waypointFile: 'assets/data/waypoints/sprint_baja_to_jungle.json',
  },
  {
    id: 'sprint_dunas_dash',
    name: 'Dunas Desert Dash',
    type: RACE_TYPE.SPRINT,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Dunas Blancas',
    description: 'A 7.3km sand sprint across the white dunes. Off-road vehicles are strongly recommended.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    laps: 1, distanceKm: 7.3, lengthBand: 'long',
    basePayout: 42_000,
    aiCount: 6,
    startPos:  { x: -4600, y: 80, z: -3400, rotY: 1.57 },
    finishPos: { x: -1500, y: 50, z: -1400 },
    waypointFile: 'assets/data/waypoints/sprint_dunas_dash.json',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG RACES
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'drag_festival_quarter',
    name: 'Airstrip Quarter Mile',
    type: RACE_TYPE.DRAG,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Festival Grounds',
    description: 'The classic 402m drag race on the festival airstrip. One of the fastest surfaces on the map.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    laps: 1, distanceKm: 0.402, lengthBand: 'drag',
    basePayout: 15_000,
    aiCount: 1,
    startPos: { x: -2600, y: 20, z: 1000, rotY: 1.57 },
    waypointFile: null,
  },
  {
    id: 'drag_festival_half',
    name: 'Airstrip Half Mile',
    type: RACE_TYPE.DRAG,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Festival Grounds',
    description: 'The 805m drag on the full airstrip length. Where hypercars meet their destiny.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    laps: 1, distanceKm: 0.805, lengthBand: 'drag',
    basePayout: 20_000,
    aiCount: 1,
    startPos: { x: -2800, y: 20, z: 1000, rotY: 1.57 },
    waypointFile: null,
  },
  {
    id: 'drag_riviera_beach',
    name: 'Riviera Beach Drag',
    type: RACE_TYPE.DRAG,
    eventType: EVENT_TYPE.ONE_OFF,
    district: 'Riviera Maya',
    description: 'A 402m drag on the Riviera beachfront road. Sea breeze, warm tarmac, top-down vibes.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    laps: 1, distanceKm: 0.402, lengthBand: 'drag',
    basePayout: 15_000,
    aiCount: 1,
    startPos: { x: 3800, y: 5, z: 200, rotY: 0 },
    waypointFile: null,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAMPIONSHIPS — 3-race series per district
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'champ_guanajuato',
    name: 'Guanajuato Championship',
    type: RACE_TYPE.CIRCUIT,
    eventType: EVENT_TYPE.CHAMPIONSHIP,
    district: 'Guanajuato',
    description: 'Three races through Guanajuato. Win all three to become champion of the colonial city.',
    classFilter: ['C', 'B'],
    minPR: 0, maxPR: 700,
    entryFee: 1_000,
    payoutTable: { 1: 25_000, 2: 15_000, 3: 8_000 },
    races: ['circuit_guanajuato_grand', 'sprint_festival_to_guanajuato', 'circuit_festival_arena'],
    laps: 0, distanceKm: 0, lengthBand: 'championship',
    basePayout: 0, aiCount: 6,
    startPos: { x: 1800, y: 82, z: -2300, rotY: 0 },
    waypointFile: null,
  },
  {
    id: 'champ_caldera',
    name: 'Caldera Championship',
    type: RACE_TYPE.CIRCUIT,
    eventType: EVENT_TYPE.CHAMPIONSHIP,
    district: 'Gran Caldera',
    description: 'The ultimate test. Three races on and around the volcano for A and S1 class cars.',
    classFilter: ['A', 'S1'],
    minPR: 700, maxPR: 0,
    entryFee: 1_000,
    payoutTable: { 1: 60_000, 2: 36_000, 3: 20_000 },
    races: ['sprint_caldera_descent', 'circuit_caldera_ring', 'sprint_riviera_coastal'],
    laps: 0, distanceKm: 0, lengthBand: 'championship',
    basePayout: 0, aiCount: 5,
    startPos: { x: 3500, y: 800, z: -4000, rotY: 3.14 },
    waypointFile: null,
  },
  {
    id: 'champ_festival',
    name: 'Festival Championship',
    type: RACE_TYPE.CIRCUIT,
    eventType: EVENT_TYPE.CHAMPIONSHIP,
    district: 'Festival Grounds',
    description: 'Three festival events — any class, any car. The most accessible championship on the map.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    entryFee: 1_000,
    payoutTable: { 1: 30_000, 2: 18_000, 3: 10_000 },
    races: ['circuit_festival_arena', 'drag_festival_half', 'drag_riviera_beach'],
    laps: 0, distanceKm: 0, lengthBand: 'championship',
    basePayout: 0, aiCount: 6,
    startPos: { x: -1800, y: 20, z: 700, rotY: 0 },
    waypointFile: null,
  },
  {
    id: 'champ_desert',
    name: 'Desert Championship',
    type: RACE_TYPE.SPRINT,
    eventType: EVENT_TYPE.CHAMPIONSHIP,
    district: 'Baja Desert',
    description: 'Baja to Jungle, Dunas Dash, and the Baja Dirt Circuit. Off-road focused, full-throttle chaos.',
    classFilter: [],
    minPR: 0, maxPR: 0,
    entryFee: 1_000,
    payoutTable: { 1: 55_000, 2: 33_000, 3: 18_000 },
    races: ['sprint_cross_country_baja_jungle', 'sprint_dunas_dash', 'circuit_baja_dirt'],
    laps: 0, distanceKm: 0, lengthBand: 'championship',
    basePayout: 0, aiCount: 6,
    startPos: { x: -3800, y: 120, z: 600, rotY: 1.57 },
    waypointFile: null,
  },
];


// ── Lookup helpers ─────────────────────────────────────────────────────────────

/** @param {string} id */
export function getRaceById(id) {
  return RACES.find(r => r.id === id) ?? null;
}

/** @param {string} type  RACE_TYPE value */
export function getRacesByType(type) {
  return RACES.filter(r => r.type === type);
}

/** @param {string} district */
export function getRacesByDistrict(district) {
  return RACES.filter(r => r.district === district);
}

/** @param {string} eventType  EVENT_TYPE value */
export function getRacesByEventType(eventType) {
  return RACES.filter(r => r.eventType === eventType);
}

/**
 * Filter races for a given car class and PR.
 * @param {string} carClass  e.g. 'B'
 * @param {number} carPR
 * @returns {Array}
 */
export function getEligibleRaces(carClass, carPR) {
  return RACES.filter(race => {
    if (race.isShowcase) return false; // Phase 2
    const classOk = race.classFilter.length === 0 || race.classFilter.includes(carClass);
    const minOk   = race.minPR === 0 || carPR >= race.minPR;
    const maxOk   = race.maxPR === 0 || carPR <= race.maxPR;
    return classOk && minOk && maxOk;
  });
}

/**
 * All non-showcase, non-championship races — the backbone of the race list.
 */
export function getAllOneOffRaces() {
  return RACES.filter(r => r.eventType === EVENT_TYPE.ONE_OFF && !r.isShowcase);
}

// ── Drag race timing slip helper ───────────────────────────────────────────────

/**
 * Formats a drag race result into a timing slip object (mimics a real drag slip).
 * @param {{ reactionMs, sixtyFtMs, thirdMileMs, quarterMileMs, topSpeedKmh }} raw
 * @returns {{ reaction, sixtyFt, thirdMile, quarterMile, topSpeed }}
 */
export function buildDragTimingSlip({ reactionMs, sixtyFtMs, thirdMileMs, quarterMileMs, topSpeedKmh }) {
  const fmt = ms => {
    const s = (ms / 1000).toFixed(3);
    return s;
  };
  return {
    reaction:    fmt(reactionMs),
    sixtyFt:     fmt(sixtyFtMs),
    thirdMile:   fmt(thirdMileMs),
    quarterMile: fmt(quarterMileMs),
    topSpeed:    `${topSpeedKmh.toFixed(1)} km/h`,
  };
}

// ── Drift scoring helper ───────────────────────────────────────────────────────

/**
 * Calculate drift score for a single frame (called every physics step).
 * @param {{ angleDeg, speedKmh, isWallTouch, clipPointHit, chainActive }} state
 * @param {number} deltaS  Delta time in seconds
 * @returns {{ frameScore, chainBonus, resetChain }}
 */
export function calcDriftFrameScore({ angleDeg, speedKmh, isWallTouch, clipPointHit, chainActive }, deltaS) {
  if (isWallTouch) return { frameScore: 0, chainBonus: 0, resetChain: true };
  if (angleDeg < 20) return { frameScore: 0, chainBonus: 0, resetChain: false };

  const angleMultiplier = Math.min(3.0, 1 + ((angleDeg - 20) / 30));
  const speedMultiplier = Math.min(2.0, speedKmh / 80);
  const basePerSec      = 1_000;
  const frameScore      = Math.floor(basePerSec * angleMultiplier * speedMultiplier * deltaS);
  const clipBonus       = clipPointHit ? 500 : 0;

  return { frameScore: frameScore + clipBonus, chainBonus: 0, resetChain: false };
}

/**
 * Determine drift tier achieved.
 * @param {number} totalScore
 * @param {object} targets  { bronze, silver, gold, platinum }
 * @returns {'none'|'bronze'|'silver'|'gold'|'platinum'}
 */
export function getDriftTier(totalScore, targets) {
  if (totalScore >= targets.platinum) return 'platinum';
  if (totalScore >= targets.gold)     return 'gold';
  if (totalScore >= targets.silver)   return 'silver';
  if (totalScore >= targets.bronze)   return 'bronze';
  return 'none';
}

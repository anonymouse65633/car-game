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

  // ── CIRCUIT ────────────────────────────────────────────────────────────────

  {
    id:           'circuit_grand',
    name:         'Grand Circuit',
    type:         RACE_TYPE.CIRCUIT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Racing District',
    description:  'The crown jewel of Horizon City racing. A 3.2km loop through the purpose-built Grand Circuit with elevation changes, a long back straight, and a sweeping final complex.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         3,
    distanceKm:   3.2,
    lengthBand:   'medium',
    basePayout:   20_000,
    aiCount:      6,
    startPos:     { x: 480, y: 0.2, z: -620, rotY: 0 },
    waypointFile: 'assets/data/waypoints/circuit_grand.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
  },

  {
    id:           'circuit_downtown_ring',
    name:         'Downtown Ring',
    type:         RACE_TYPE.CIRCUIT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Downtown Core',
    description:  'A tight technical circuit threading through the city blocks of Downtown Core. Four laps of narrow streets, sharp 90-degree corners, and zero margin for error.',
    classFilter:  ['D', 'C', 'B'],
    minPR:        0,
    maxPR:        600,
    laps:         4,
    distanceKm:   2.1,
    lengthBand:   'medium',
    basePayout:   15_000,
    aiCount:      5,
    startPos:     { x: -80, y: 0.2, z: 120, rotY: Math.PI * 0.5 },
    waypointFile: 'assets/data/waypoints/circuit_downtown_ring.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
  },

  {
    id:           'circuit_waterfront',
    name:         'Waterfront Circuit',
    type:         RACE_TYPE.CIRCUIT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Waterfront & Harbor',
    description:  'Three laps of the harbor promenade and the Grand Bridge. A mix of high-speed seafront blasts and the technical bridge section — watch the crosswind.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         3,
    distanceKm:   2.8,
    lengthBand:   'medium',
    basePayout:   18_000,
    aiCount:      6,
    startPos:     { x: 320, y: 0.2, z: 80, rotY: Math.PI },
    waypointFile: 'assets/data/waypoints/circuit_waterfront.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
  },

  // ── SPRINT ─────────────────────────────────────────────────────────────────

  {
    id:           'sprint_harbor',
    name:         'Harbor Sprint',
    type:         RACE_TYPE.SPRINT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Waterfront & Harbor',
    description:  'A 4.5km blast from the docks to the Racing District. Wide roads, long straights, and one sweeping harbor curve. Built for fast cars — top speed wins here.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         1,
    distanceKm:   4.5,
    lengthBand:   'long',
    basePayout:   22_000,
    aiCount:      5,
    startPos:     { x: 260, y: 0.2, z: 400, rotY: -Math.PI * 0.3 },
    waypointFile: 'assets/data/waypoints/sprint_harbor.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
  },

  {
    id:           'sprint_hillside_climb',
    name:         'Hillside Climb',
    type:         RACE_TYPE.SPRINT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Suburbs & Hillside',
    description:  'From downtown up to the Hillside Lookout — 3.8km of winding elevation gain. Slow in, fast out — AWD cars have a clear advantage, but a well-tuned RWD can shock everyone.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         1,
    distanceKm:   3.8,
    lengthBand:   'medium',
    basePayout:   19_000,
    aiCount:      4,
    startPos:     { x: -200, y: 0.2, z: -80, rotY: Math.PI * 0.8 },
    waypointFile: 'assets/data/waypoints/sprint_hillside_climb.json',
    hasRouteFork: true,   // Upper / Lower route choice at the mid-point switchback
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
  },

  {
    id:           'sprint_industrial_dash',
    name:         'Industrial Dash',
    type:         RACE_TYPE.SPRINT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Industrial Zone',
    description:  'The shortest sprint — 2.9km of straight shots through the warehouse yards and rail crossings. Small cars, big surprises. D and C class feel right at home here.',
    classFilter:  ['D', 'C'],
    minPR:        0,
    maxPR:        450,
    laps:         1,
    distanceKm:   2.9,
    lengthBand:   'short',
    basePayout:   10_000,
    aiCount:      4,
    startPos:     { x: -520, y: 0.2, z: 60, rotY: 0 },
    waypointFile: 'assets/data/waypoints/sprint_industrial_dash.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
  },

  {
    id:           'sprint_city_cross',
    name:         'City Cross',
    type:         RACE_TYPE.SPRINT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Downtown Core',
    description:  'The longest sprint in the game — 5.1km from downtown to the suburbs through service alleys and back streets. Know the route, know the shortcuts. Three fork choices. Chaos is likely.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         1,
    distanceKm:   5.1,
    lengthBand:   'long',
    basePayout:   28_000,
    aiCount:      5,
    startPos:     { x: -60, y: 0.2, z: 180, rotY: Math.PI * 1.5 },
    waypointFile: 'assets/data/waypoints/sprint_city_cross.json',
    hasRouteFork: true,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
  },

  // ── DRAG ───────────────────────────────────────────────────────────────────

  {
    id:           'drag_harbor_quarter',
    name:         'Harbor Quarter Mile',
    type:         RACE_TYPE.DRAG,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Waterfront & Harbor',
    description:  'The classic quarter-mile (402m) on the Harbor Drag Strip. Launch control, shift timing, and reaction speed decide everything. Post-race timing slip shows it all.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         1,
    distanceKm:   0.402,
    lengthBand:   'short',
    basePayout:   8_000,
    aiCount:      2,
    startPos:     { x: 290, y: 0.2, z: 510, rotY: Math.PI },
    waypointFile: 'assets/data/waypoints/drag_harbor.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
    dragDistance: 402,  // metres
  },

  {
    id:           'drag_harbor_half',
    name:         'Harbor Half Mile',
    type:         RACE_TYPE.DRAG,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Waterfront & Harbor',
    description:  'Half a mile (805m) on the same drag strip. Top speed matters here — a perfect launch carries you further, but a car with no top-end will be caught.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         1,
    distanceKm:   0.805,
    lengthBand:   'short',
    basePayout:   12_000,
    aiCount:      3,
    startPos:     { x: 290, y: 0.2, z: 510, rotY: Math.PI },
    waypointFile: 'assets/data/waypoints/drag_harbor.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: ['drag_harbor_quarter'],
    isShowcase:   false,
    dragDistance: 805,
  },

  {
    id:           'drag_industrial',
    name:         'Industrial Straight',
    type:         RACE_TYPE.DRAG,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Industrial Zone',
    description:  'A raw, unpolished quarter mile on a closed industrial road. No grandstands, no lights — just a starter flag and the smell of burning rubber.',
    classFilter:  ['D', 'C', 'B'],
    minPR:        0,
    maxPR:        600,
    laps:         1,
    distanceKm:   0.402,
    lengthBand:   'short',
    basePayout:   7_000,
    aiCount:      2,
    startPos:     { x: -610, y: 0.2, z: 180, rotY: 0 },
    waypointFile: 'assets/data/waypoints/drag_industrial.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
    dragDistance: 402,
  },

  // ── DRIFT ZONES ────────────────────────────────────────────────────────────

  {
    id:           'drift_industrial_concrete',
    name:         'Industrial Drift Arena',
    type:         RACE_TYPE.DRIFT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Industrial Zone',
    description:  'A vast concrete apron behind the warehouses — the biggest drift zone in the city. Link the sweeping corners to build your chain. There is room to be ambitious.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         1,
    distanceKm:   0,
    lengthBand:   'long',
    basePayout:   5_000,
    aiCount:      0,
    startPos:     { x: -480, y: 0.2, z: 280, rotY: Math.PI * 0.5 },
    waypointFile: 'assets/data/waypoints/drift_industrial.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
    driftTargets: { bronze: 50_000, silver: 120_000, gold: 220_000, platinum: 380_000 },
    driftClipPoints: 6,
    durationSec:  60,
  },

  {
    id:           'drift_hillside_hairpin',
    name:         'Hillside Hairpin Drift',
    type:         RACE_TYPE.DRIFT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Suburbs & Hillside',
    description:  'Three tight hairpins on the hillside road. Not much room — but the angles are steep and the scenery is spectacular. Commit early and trust the rear.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         1,
    distanceKm:   0,
    lengthBand:   'medium',
    basePayout:   4_000,
    aiCount:      0,
    startPos:     { x: -310, y: 38, z: -200, rotY: Math.PI * 1.2 },
    waypointFile: 'assets/data/waypoints/drift_hillside.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
    driftTargets: { bronze: 30_000, silver: 70_000, gold: 130_000, platinum: 220_000 },
    driftClipPoints: 3,
    durationSec:  45,
  },

  {
    id:           'drift_harbor_promenade',
    name:         'Harbor Promenade Drift',
    type:         RACE_TYPE.DRIFT,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Waterfront & Harbor',
    description:  'The sea wall chicane on the harbor promenade. Two linked corners with the ocean on one side and the dock wall on the other. No room to straighten.',
    classFilter:  [],
    minPR:        0,
    maxPR:        0,
    laps:         1,
    distanceKm:   0,
    lengthBand:   'short',
    basePayout:   3_500,
    aiCount:      0,
    startPos:     { x: 200, y: 0.2, z: 360, rotY: Math.PI * 0.1 },
    waypointFile: 'assets/data/waypoints/drift_harbor.json',
    hasRouteFork: false,
    entryFee:     0,
    prerequisites: [],
    isShowcase:   false,
    driftTargets: { bronze: 20_000, silver: 50_000, gold: 100_000, platinum: 180_000 },
    driftClipPoints: 2,
    durationSec:  40,
  },

  // ── SPEED TRAPS (20 total — sample of 6 here, remainder procedurally seeded) ─

  {
    id:          'trap_highway_n1',
    name:        'Highway North Trap 1',
    type:        RACE_TYPE.SPEED_TRAP,
    eventType:   EVENT_TYPE.ONE_OFF,
    district:    'Outskirts & Highway Ring',
    description: 'A speed camera on the north stretch of the Highway Ring. 500m run-up available — ideal for S-class cars.',
    classFilter: [],
    minPR: 0, maxPR: 0, laps: 1, distanceKm: 0, lengthBand: 'short',
    basePayout: 2_000, aiCount: 0,
    startPos:    { x: 0, y: 0.2, z: -900, rotY: 0 },
    waypointFile: null,
    hasRouteFork: false, entryFee: 0, prerequisites: [], isShowcase: false,
    trapTargets: { bronze: 180, silver: 220, gold: 270, platinum: 320 }, // km/h
    sensorPos:   { x: 0, y: 0.2, z: -1000 },
  },

  {
    id:          'trap_waterfront_s1',
    name:        'Waterfront South Trap',
    type:        RACE_TYPE.SPEED_TRAP,
    eventType:   EVENT_TYPE.ONE_OFF,
    district:    'Waterfront & Harbor',
    description: 'On the straight seafront boulevard. Lower top-speed target but accessible early — great first speed trap for new players.',
    classFilter: [], minPR: 0, maxPR: 0, laps: 1, distanceKm: 0, lengthBand: 'short',
    basePayout: 1_500, aiCount: 0,
    startPos:    { x: 350, y: 0.2, z: 200, rotY: Math.PI },
    waypointFile: null,
    hasRouteFork: false, entryFee: 0, prerequisites: [], isShowcase: false,
    trapTargets: { bronze: 140, silver: 180, gold: 220, platinum: 260 },
    sensorPos:   { x: 350, y: 0.2, z: 100 },
  },

  // ── SPEED ZONES ────────────────────────────────────────────────────────────

  {
    id:           'zone_highway_ring',
    name:         'Highway Ring Speed Zone',
    type:         RACE_TYPE.SPEED_ZONE,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Outskirts & Highway Ring',
    description:  'A 1.2km average-speed zone on the outer highway. Maintain 250+ km/h throughout the sweeping bends to crack the platinum record. One bad corner and the average is gone.',
    classFilter:  [],
    minPR:        0, maxPR: 0, laps: 1,
    distanceKm:   1.2, lengthBand: 'long',
    basePayout:   6_000, aiCount: 0,
    startPos:     { x: 400, y: 0.2, z: -800, rotY: Math.PI * 0.4 },
    waypointFile: 'assets/data/waypoints/zone_highway.json',
    hasRouteFork: false, entryFee: 0, prerequisites: [], isShowcase: false,
    zoneTargets:  { bronze: 180, silver: 210, gold: 240, platinum: 270 }, // avg km/h
    zoneEndPos:   { x: 600, y: 0.2, z: -600 },
  },

  {
    id:           'zone_waterfront_blvd',
    name:         'Waterfront Boulevard Zone',
    type:         RACE_TYPE.SPEED_ZONE,
    eventType:    EVENT_TYPE.ONE_OFF,
    district:     'Waterfront & Harbor',
    description:  'The seafront boulevard from the marina to the bridge. Flat and wide — but the chicane at the end will punish anyone who doesn\'t plan their entry.',
    classFilter:  [],
    minPR:        0, maxPR: 0, laps: 1,
    distanceKm:   0.8, lengthBand: 'medium',
    basePayout:   4_000, aiCount: 0,
    startPos:     { x: 420, y: 0.2, z: 300, rotY: Math.PI },
    waypointFile: 'assets/data/waypoints/zone_waterfront.json',
    hasRouteFork: false, entryFee: 0, prerequisites: [], isShowcase: false,
    zoneTargets:  { bronze: 140, silver: 170, gold: 200, platinum: 230 },
    zoneEndPos:   { x: 360, y: 0.2, z: 120 },
  },

  // ── CHAMPIONSHIPS ──────────────────────────────────────────────────────────

  {
    id:           'champ_racing_district',
    name:         'Racing District Championship',
    type:         RACE_TYPE.CIRCUIT,
    eventType:    EVENT_TYPE.CHAMPIONSHIP,
    district:     'Racing District',
    description:  'Win the Racing District title — three rounds across the Grand Circuit and two sprint stages. Points decide the champion. 1,000 CR entry; winner takes 5,000 CR.',
    classFilter:  [],
    minPR:        350,
    maxPR:        0,
    laps:         3,
    distanceKm:   3.2,
    lengthBand:   'medium',
    basePayout:   5_000,  // per-race component; championship winner gets entry×5
    aiCount:      6,
    startPos:     { x: 480, y: 0.2, z: -620, rotY: 0 },
    waypointFile: 'assets/data/waypoints/circuit_grand.json',
    hasRouteFork: false,
    entryFee:     1_000,
    prerequisites: ['circuit_grand', 'sprint_harbor'],
    isShowcase:   false,
    championshipRounds: ['circuit_grand', 'sprint_harbor', 'circuit_waterfront'],
    // Points: 1st=10, 2nd=7, 3rd=5, 4th=3, 5th+=1
    pointsTable: [10, 7, 5, 3, 1],
  },

  // ── SHOWCASE EVENTS (Phase 2 — framework only) ─────────────────────────────

  {
    id:           'showcase_grand_bridge',
    name:         'The Grand Bridge Sprint',
    type:         RACE_TYPE.SPRINT,
    eventType:    EVENT_TYPE.SHOWCASE,
    district:     'Waterfront & Harbor',
    description:  'Race a speedboat along the waterfront while you drive the Grand Bridge. The boat is fast — and the bridge has a nasty chicane halfway across.',
    classFilter:  [],
    minPR:        0, maxPR: 0, laps: 1,
    distanceKm:   2.2, lengthBand: 'medium',
    basePayout:   40_000, aiCount: 1,
    startPos:     { x: 180, y: 0.2, z: 380, rotY: Math.PI * 0.9 },
    waypointFile: 'assets/data/waypoints/showcase_grand_bridge.json',
    hasRouteFork: false, entryFee: 0,
    prerequisites: ['circuit_waterfront', 'sprint_harbor'],
    isShowcase:   true,
    loanedCarId:  null,  // null = use player's car; string = loan specific car
  },

  {
    id:           'showcase_hillside_legends',
    name:         'Hillside Legends',
    type:         RACE_TYPE.SPRINT,
    eventType:    EVENT_TYPE.SHOWCASE,
    district:     'Suburbs & Hillside',
    description:  'A rain-soaked downhill sprint against three legendary classic cars. They look slow. They aren\'t.',
    classFilter:  [],
    minPR:        0, maxPR: 0, laps: 1,
    distanceKm:   3.8, lengthBand: 'medium',
    basePayout:   50_000, aiCount: 3,
    startPos:     { x: -280, y: 72, z: -320, rotY: Math.PI * 0.6 },
    waypointFile: 'assets/data/waypoints/sprint_hillside_climb.json',
    hasRouteFork: false, entryFee: 0,
    prerequisites: ['sprint_hillside_climb'],
    isShowcase:   true,
    loanedCarId:  null,
    forcedWeather: 'rain',
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

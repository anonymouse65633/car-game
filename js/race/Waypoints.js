/**
 * js/race/waypoints.js
 * Horizon City — Race Route Waypoint Graphs & Racing Line.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PLAN REFERENCE: Part 7.6.2 (AI Navigation Layer), Part 7.5 (In-Race Systems),
 *                 Part 7.10 (Race Discovery in the World)
 *
 * PLAN NOTES — Waypoint Graph Design:
 *   • Every race route is pre-baked into a series of waypoints
 *     (3D points spaced ~10m apart along the ideal racing line)
 *   • Racing line: curated waypoints representing the optimal path —
 *     cutting apexes, late braking, early exit
 *   • Each waypoint carries a target speed value; AI accelerates toward it
 *     and brakes as needed — derived from curvature of upcoming waypoints
 *   • Lower-difficulty AI deviate from the ideal line more often
 *   • Higher-difficulty AI follow it closely
 *   • Route forks (Sprint races) are represented as branching waypoint chains
 *
 * PLAN NOTES — Player Guidance (Part 7.5):
 *   • Large coloured chevron arrows floating in 3D space on the road ahead
 *   • Colour: Blue (route arrow), Red (wrong way warning)
 *   • Arrows fade out at high speed (toggle lock with Arrow-fade key)
 *   • Ghost breadcrumb line on minimap shows optimal race route
 *   • Out-of-bounds: leave marked area → 5-second countdown → reset to last checkpoint
 *
 * PLAN NOTES — Checkpoint System:
 *   • Checkpoints are a subset of waypoints (every 10th–15th, at key corners)
 *   • Crossing a checkpoint in the wrong order = out-of-bounds penalty
 *   • Last valid checkpoint is stored for rewind/reset placement
 *
 * PLAN NOTES — Route Fork System (Sprint races):
 *   • At a fork, the waypoint branches into two chains (A and B)
 *   • Player's car heading determines which branch they take (no input required)
 *   • AI opponents split randomly weighted by difficulty (harder = better fork choice)
 *   • Both branches merge back to the same post-fork waypoint
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

// ── Waypoint shape ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} Waypoint
 * @property {number}   id
 * @property {THREE.Vector3} pos          World position
 * @property {number}   targetSpeedKmh    Ideal speed at this point for AI
 * @property {boolean}  isCheckpoint      True for the subset used as reset points
 * @property {boolean}  isForkPoint       Sprint fork begins here
 * @property {boolean}  isMergePoint      Fork branches rejoin here
 * @property {string}   forkBranch        'A' | 'B' | null
 * @property {number[]} nextIds           IDs of successor waypoints (1 for normal, 2 at forks)
 */

// ── Route cache (loaded JSON → parsed Waypoint arrays) ────────────────────────
const _routeCache = new Map(); // raceId → Waypoint[]

// ── Load route from JSON asset ─────────────────────────────────────────────────

/**
 * Load and parse a waypoint JSON file for a race.
 * Called once per race start — result is cached for the session.
 * @param {string} raceId
 * @param {string} filePath    e.g. 'assets/data/waypoints/circuit_grand.json'
 * @returns {Promise<Waypoint[]>}
 */
export async function loadRoute(raceId, filePath) {
  if (_routeCache.has(raceId)) return _routeCache.get(raceId);
  if (!filePath) return [];

  try {
    const res  = await fetch(filePath);
    const json = await res.json();
    const wps  = _parseWaypointJSON(json);
    _routeCache.set(raceId, wps);
    return wps;
  } catch (err) {
    console.warn(`[Waypoints] Failed to load route "${raceId}":`, err);
    return [];
  }
}

/**
 * Retrieve a cached route (must call loadRoute first).
 * @param {string} raceId
 * @returns {Waypoint[]}
 */
export function getRoute(raceId) {
  return _routeCache.get(raceId) ?? [];
}

/**
 * Clear route cache (called between races / on reset).
 */
export function clearRouteCache() {
  _routeCache.clear();
}

// ── JSON parser ────────────────────────────────────────────────────────────────

/**
 * Expected JSON shape:
 * {
 *   "waypoints": [
 *     { "id": 0, "x": 10, "y": 0.2, "z": -20, "speed": 120, "checkpoint": true,
 *       "fork": false, "merge": false, "branch": null, "next": [1] },
 *     ...
 *   ]
 * }
 */
function _parseWaypointJSON(json) {
  return (json.waypoints ?? []).map(w => ({
    id:              w.id,
    pos:             new THREE.Vector3(w.x, w.y, w.z),
    targetSpeedKmh:  w.speed ?? 100,
    isCheckpoint:    w.checkpoint ?? false,
    isForkPoint:     w.fork ?? false,
    isMergePoint:    w.merge ?? false,
    forkBranch:      w.branch ?? null,
    nextIds:         w.next ?? [],
  }));
}

// ── Waypoint navigation helpers ────────────────────────────────────────────────

/**
 * Get the waypoint object by ID from a route.
 * @param {Waypoint[]} route
 * @param {number} id
 * @returns {Waypoint|null}
 */
export function getWaypointById(route, id) {
  return route.find(w => w.id === id) ?? null;
}

/**
 * Get checkpoints only (subset used for reset + lap validation).
 * @param {Waypoint[]} route
 * @returns {Waypoint[]}
 */
export function getCheckpoints(route) {
  return route.filter(w => w.isCheckpoint);
}

/**
 * Find the index of the nearest waypoint to a world position.
 * Used to initialise AI position on route and to determine current checkpoint.
 * @param {Waypoint[]} route
 * @param {THREE.Vector3} pos
 * @returns {number}  Index into route array
 */
export function nearestWaypointIndex(route, pos) {
  let bestIdx  = 0;
  let bestDist = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = pos.distanceToSquared(route[i].pos);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Get the next waypoint(s) from a given waypoint.
 * Returns two waypoints at a fork, one otherwise.
 * @param {Waypoint[]} route
 * @param {Waypoint} current
 * @returns {Waypoint[]}
 */
export function getNextWaypoints(route, current) {
  return current.nextIds
    .map(id => getWaypointById(route, id))
    .filter(Boolean);
}

/**
 * Look-ahead curvature estimate — used by AI to set target braking speed.
 * Returns the angle (radians) between the current forward direction and the
 * direction to the waypoint N steps ahead.
 *
 * @param {Waypoint[]} route
 * @param {number}     currentIdx
 * @param {number}     lookAheadSteps  Default 5 (~50m ahead)
 * @returns {number}  Curvature angle in radians (0 = straight, π = U-turn)
 */
export function lookAheadCurvature(route, currentIdx, lookAheadSteps = 5) {
  const a = route[currentIdx];
  const b = route[Math.min(currentIdx + lookAheadSteps, route.length - 1)];
  if (!a || !b) return 0;

  // Direction from current to current+1
  const next = route[Math.min(currentIdx + 1, route.length - 1)];
  const dirNow   = new THREE.Vector3().subVectors(next.pos, a.pos).normalize();
  const dirAhead = new THREE.Vector3().subVectors(b.pos, a.pos).normalize();

  return Math.acos(Math.max(-1, Math.min(1, dirNow.dot(dirAhead))));
}

// ── Lap detection ──────────────────────────────────────────────────────────────

/**
 * State object for tracking a single car's progress through the race.
 * @returns {LapTracker}
 */
export function createLapTracker(totalLaps) {
  return {
    currentLap:          1,
    totalLaps,
    lastCheckpointId:    -1,    // ID of last valid checkpoint crossed
    checkpointsThisLap:  new Set(),
    finished:            false,
    lapTimes:            [],     // ms per completed lap
    lapStartTs:          Date.now(),
  };
}

/**
 * Register crossing a waypoint for a car.
 * Handles checkpoint validation, lap counting, and finish detection.
 *
 * @param {object} tracker       LapTracker from createLapTracker
 * @param {Waypoint} waypoint
 * @param {Waypoint[]} route
 * @returns {{ lapCompleted: boolean, raceFinished: boolean, wrongWay: boolean }}
 */
export function registerWaypointCross(tracker, waypoint, route) {
  if (tracker.finished) return { lapCompleted: false, raceFinished: false, wrongWay: false };

  // Wrong-way detection: new checkpoint ID should be > last (roughly)
  const wrongWay = waypoint.isCheckpoint &&
    tracker.lastCheckpointId !== -1 &&
    waypoint.id < tracker.lastCheckpointId - 3;

  if (waypoint.isCheckpoint && !wrongWay) {
    tracker.checkpointsThisLap.add(waypoint.id);
    tracker.lastCheckpointId = waypoint.id;
  }

  // Lap complete: returned to waypoint 0 and all checkpoints crossed
  const allCheckpoints = getCheckpoints(route);
  const allCrossed     = allCheckpoints.every(cp => tracker.checkpointsThisLap.has(cp.id));

  let lapCompleted  = false;
  let raceFinished  = false;

  if (waypoint.id === 0 && allCrossed && tracker.currentLap >= 1) {
    const now = Date.now();
    tracker.lapTimes.push(now - tracker.lapStartTs);
    tracker.lapStartTs = now;
    tracker.checkpointsThisLap.clear();
    tracker.lastCheckpointId = -1;
    lapCompleted = true;

    if (tracker.currentLap >= tracker.totalLaps) {
      tracker.finished  = true;
      raceFinished = true;
    } else {
      tracker.currentLap++;
    }
  }

  return { lapCompleted, raceFinished, wrongWay };
}

/**
 * Best lap time from a LapTracker.
 * @param {object} tracker
 * @returns {number|null} ms
 */
export function getBestLapTime(tracker) {
  if (!tracker.lapTimes.length) return null;
  return Math.min(...tracker.lapTimes);
}

// ── Route fork resolution ──────────────────────────────────────────────────────

/**
 * Choose which fork branch an AI car takes at a fork point.
 * Better AI is more likely to pick the faster branch.
 *
 * @param {Waypoint[]} nextOptions  The two fork waypoints
 * @param {number}     skillLevel  0.0 (Tourist) to 1.0 (Unbeatable)
 * @returns {Waypoint}
 */
export function resolveForkForAI(nextOptions, skillLevel) {
  if (nextOptions.length <= 1) return nextOptions[0];
  // Branch 'A' is always the faster/shorter route by convention in the waypoint JSON
  const branchA = nextOptions.find(w => w.forkBranch === 'A') ?? nextOptions[0];
  const branchB = nextOptions.find(w => w.forkBranch === 'B') ?? nextOptions[1];
  // Higher skill = higher chance of picking A (faster branch)
  return Math.random() < (0.4 + skillLevel * 0.55) ? branchA : branchB;
}

/**
 * Choose which fork branch the player takes based on their heading.
 * @param {Waypoint[]} nextOptions
 * @param {THREE.Vector3} playerForward  Normalised forward direction
 * @returns {Waypoint}
 */
export function resolveForkForPlayer(nextOptions, playerForward) {
  if (nextOptions.length <= 1) return nextOptions[0];
  // Pick the waypoint whose direction best matches the player's heading
  return nextOptions.reduce((best, wp) => {
    const dir = wp.pos.clone().sub(nextOptions[0].pos).normalize();
    return dir.dot(playerForward) > best.dot.dot(playerForward)
      ? { wp, dot: dir }
      : best;
  }, { wp: nextOptions[0], dot: new THREE.Vector3() }).wp;
}

// ── 3D waypoint arrow helpers (world-space HUD) ────────────────────────────────

const ARROW_COLOR_ROUTE = 0x2299ff;
const ARROW_COLOR_WRONG = 0xff2222;

/**
 * Create a Three.js mesh for a floating route arrow.
 * Called once per race — arrows are repositioned each frame.
 * @returns {THREE.Mesh}
 */
export function createWaypointArrow() {
  const geo = new THREE.ConeGeometry(1.2, 3.5, 4);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: ARROW_COLOR_ROUTE, transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'waypoint_arrow';
  return mesh;
}

/**
 * Position and orient a waypoint arrow toward a target waypoint.
 * @param {THREE.Mesh}    arrow
 * @param {THREE.Vector3} playerPos
 * @param {Waypoint}      targetWaypoint
 * @param {boolean}       wrongWay
 * @param {number}        speedKmh   Arrows fade above 160 km/h
 */
export function updateWaypointArrow(arrow, playerPos, targetWaypoint, wrongWay, speedKmh) {
  const dir = targetWaypoint.pos.clone().sub(playerPos).normalize();
  arrow.position.copy(playerPos).add(dir.clone().multiplyScalar(12)).setY(playerPos.y + 2.5);
  arrow.lookAt(targetWaypoint.pos.clone().setY(arrow.position.y));
  arrow.material.color.setHex(wrongWay ? ARROW_COLOR_WRONG : ARROW_COLOR_ROUTE);

  // Fade at high speed (plan: arrows fade above ~160 km/h)
  arrow.material.opacity = speedKmh > 160
    ? Math.max(0, 0.85 - (speedKmh - 160) / 100)
    : 0.85;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INLINE WAYPOINT TABLES — FH5 Mexico Recreation
//
// Used as fallback when JSON files are not yet available.
// Each array entry: { id, pos: THREE.Vector3, targetSpeedKmh, isCheckpoint }
// ═══════════════════════════════════════════════════════════════════════════════

const _w = (id, x, y, z, spd, chk = false) => ({
  id, pos: new THREE.Vector3(x, y, z), targetSpeedKmh: spd, isCheckpoint: chk,
  isForkPoint: false, isMergePoint: false, forkBranch: null, nextIds: [],
});

export const INLINE_WAYPOINTS = Object.freeze({

  // ── Guanajuato Grand Circuit ─────────────────────────────────────────────
  circuit_guanajuato_grand: [
    _w(0,  1800, 82,-2300, 120, true),
    _w(1,  2000, 85,-2100, 100),
    _w(2,  2200, 90,-1900,  90),
    _w(3,  2300, 95,-1700,  80),
    _w(4,  2100, 92,-1600,  85, true),
    _w(5,  1800, 85,-1500, 100),
    _w(6,  1500, 82,-1700,  90),
    _w(7,  1400, 82,-2000,  85),
    _w(8,  1500, 82,-2300,  90, true),
    _w(9,  1700, 82,-2500,  80),
    _w(10, 2000, 85,-2700,  75),
    _w(11, 2400,100,-2800,  70, true),
    _w(12, 2700,108,-2600,  65),
    _w(13, 2800,110,-2300,  70),
    _w(14, 2600, 95,-2100,  80),
    _w(15, 2300, 92,-2000,  90),
  ],

  // ── Riviera Seaside Circuit ───────────────────────────────────────────────
  circuit_riviera_seaside: [
    _w(0,  3400,  5,-1600, 200, true),
    _w(1,  3800,  5,-1400, 220),
    _w(2,  4200,  5,-1200, 230),
    _w(3,  4600,  5, -900, 240, true),
    _w(4,  4800,  5, -600, 260),
    _w(5,  4800,  5, -300, 260),
    _w(6,  4700,  5,    0, 220, true),
    _w(7,  4400,  5,  200, 180),
    _w(8,  4000,  5,  100, 160),
    _w(9,  3600,  5, -100, 180, true),
    _w(10, 3200,  5, -400, 200),
    _w(11, 3000,  5, -800, 180),
    _w(12, 3000,  5,-1200, 180, true),
    _w(13, 3200,  5,-1400, 190),
  ],

  // ── Festival Arena Circuit ────────────────────────────────────────────────
  circuit_festival_arena: [
    _w(0, -1800, 20,  700, 150, true),
    _w(1, -1400, 20,  700, 160),
    _w(2, -1000, 20,  800, 140, true),
    _w(3,  -400, 20,  800, 160),
    _w(4,  -400, 20, 1400, 140, true),
    _w(5, -1000, 20, 1600, 150),
    _w(6, -1800, 20, 1600, 160, true),
    _w(7, -2600, 20, 1500, 140),
    _w(8, -2800, 20, 1200, 120, true),
    _w(9, -2800, 20,  700, 150),
  ],

  // ── Caldera Summit Descent ────────────────────────────────────────────────
  sprint_caldera_descent: [
    _w(0,  3500, 800,-4000,  80, true),
    _w(1,  3400, 700,-3900,  90),
    _w(2,  3200, 600,-3700, 100),
    _w(3,  3000, 500,-3500, 110, true),
    _w(4,  2800, 400,-3300, 120),
    _w(5,  2600, 300,-3100, 130),
    _w(6,  2400, 200,-2900, 140, true),
    _w(7,  2200, 130,-2800, 150),
    _w(8,  2000,  90,-2700, 160),
  ],

  // ── Festival to Guanajuato ────────────────────────────────────────────────
  sprint_festival_to_guanajuato: [
    _w(0, -1800, 20, 1000, 160, true),
    _w(1, -1200, 20,  800, 180),
    _w(2,  -600, 20,  600, 170, true),
    _w(3,     0, 22,  400, 160),
    _w(4,   400, 22,  200, 150),
    _w(5,   600, 22, -100, 140, true),
    _w(6,   800, 30, -400, 130),
    _w(7,  1000, 50, -800, 120),
    _w(8,  1200, 65,-1200, 110, true),
    _w(9,  1400, 72,-1600, 100),
    _w(10, 1600, 80,-2000,  90),
  ],

  // ── Airstrip Drag Quarter Mile ─────────────────────────────────────────────
  drag_festival_quarter: [
    _w(0, -2600, 20, 1000,   0, true),
    _w(1, -2200, 20, 1000, 380, true),
  ],

  // ── Airstrip Half Mile ────────────────────────────────────────────────────
  drag_festival_half: [
    _w(0, -2800, 20, 1000,   0, true),
    _w(1, -2000, 20, 1000, 400, true),
  ],

  // ── Riviera Beach Drag ─────────────────────────────────────────────────────
  drag_riviera_beach: [
    _w(0, 3800, 5, 200,   0, true),
    _w(1, 4200, 5, 200, 330, true),
  ],

  // ── Riviera Coastal Sprint ────────────────────────────────────────────────
  sprint_riviera_coastal: [
    _w(0, 4700,  5,-2200, 180, true),
    _w(1, 4800,  5,-1800, 220),
    _w(2, 4800,  5,-1400, 240, true),
    _w(3, 4700,  5,-1000, 240),
    _w(4, 4500,  5, -700, 220, true),
    _w(5, 4200,  5, -400, 210),
    _w(6, 4000,  5, -100, 200, true),
    _w(7, 3800,  5,  -800, 180),
  ],

  // ── Cross-Country Baja to Jungle ──────────────────────────────────────────
  sprint_cross_country_baja_jungle: [
    _w(0, -3800,120,  600, 140, true),
    _w(1, -3200, 90,  400, 130),
    _w(2, -2600, 70,  200, 120, true),
    _w(3, -2000, 50,    0, 110),
    _w(4, -1400, 40, -200, 120, true),
    _w(5,  -800, 35,  200, 120),
    _w(6,  -200, 30,  600, 130, true),
    _w(7,   400, 28, 1200, 120),
    _w(8,   800, 26, 1800, 100, true),
    _w(9,  1200, 28, 2400,  90),
    _w(10, 1500, 29, 3000,  80, true),
    _w(11, 1800, 30, 3200,  70),
  ],

  // ── Dunas Desert Dash ────────────────────────────────────────────────────
  sprint_dunas_dash: [
    _w(0, -4600, 80,-3400, 100, true),
    _w(1, -4200, 80,-3200, 110),
    _w(2, -3800, 80,-3000, 100, true),
    _w(3, -3400, 80,-2800,  90),
    _w(4, -3000, 70,-2600,  90, true),
    _w(5, -2600, 65,-2400,  95),
    _w(6, -2200, 60,-2000,  95, true),
    _w(7, -1800, 55,-1800, 100),
    _w(8, -1500, 50,-1400, 100, true),
  ],

});

/**
 * Get inline waypoints for a race if its JSON file hasn't loaded yet.
 * @param {string} raceId
 * @returns {Waypoint[]|null}
 */
export function getInlineWaypoints(raceId) {
  return INLINE_WAYPOINTS[raceId] ?? null;
}

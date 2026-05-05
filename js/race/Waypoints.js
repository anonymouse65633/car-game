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

/**
 * npc.js — Ambient Traffic & Pedestrian NPCs
 * Part 1 / World layer
 *
 * Responsibilities:
 *  - TRAFFIC_PATHS:    pre-defined closed road loops per district (waypoint arrays)
 *  - PED_PATHS:        sidewalk patrol segments for on-foot districts
 *  - Traffic car pool: up to MAX_TRAFFIC BoxMesh cars following spline paths
 *  - Pedestrian pool:  up to MAX_PEDS capsule meshes walking patrol loops
 *  - Density scaling:  reads environment.getTrafficDensity() each tick
 *  - Player avoidance: traffic cars brake when < BRAKE_DIST of player
 *  - Race suppression: all NPC traffic despawns during an active race
 *  - LOD:              skip per-frame transform updates for NPCs > LOD_DIST away
 *
 * Exports:
 *  initNPCs(scene, world)     — create pools, register LATE-phase tick
 *  tickNPCs(dt, playerPos)    — advance paths, update transforms, density cull
 *  setRaceActive(bool)        — suppress/restore traffic during races
 *  getNPCCount()              — { traffic, peds } for debug HUD
 */

import * as THREE from 'three';
import { GROUPS }             from '../engine/renderer.js';
import { getTrafficDensity }  from './environment.js';
import { getDistrictAt }      from './city.js';

// ─── Tuning Constants ─────────────────────────────────────────────────────────

const MAX_TRAFFIC       = 40;    // hard pool ceiling
const MAX_PEDS          = 30;    // hard pool ceiling
const TRAFFIC_SPEED_MIN = 8;     // m/s  (~29 km/h)
const TRAFFIC_SPEED_MAX = 18;    // m/s  (~65 km/h)
const PED_SPEED_MIN     = 0.8;   // m/s  (slow stroll)
const PED_SPEED_MAX     = 1.6;   // m/s  (brisk walk)
const BRAKE_DIST        = 18;    // m  — brake start distance from player
const STOP_DIST         = 7;     // m  — full stop distance from player
const LOD_DIST          = 250;   // m  — skip fine updates beyond this
const SPAWN_DIST_MIN    = 60;    // m  — don't spawn right in front of player
const SPAWN_DIST_MAX    = 200;   // m  — don't spawn at far horizon
const DESPAWN_DIST      = 260;   // m  — cull when too far

// ─── Traffic Road Loops ───────────────────────────────────────────────────────
// Each path is a closed array of Vector3 waypoints.
// Cars interpolate along them; on reaching the last waypoint they wrap to [0].

const _v3 = (x, z) => new THREE.Vector3(x, 0.4, z);

export const TRAFFIC_PATHS = Object.freeze([
  // ── Downtown inner ring ──────────────────────────────────────────────────
  {
    id:    'dt_ring',
    label: 'Downtown Ring',
    district: 'downtown',
    speed: 10,
    waypoints: [
      _v3(-300,  300), _v3( 300,  300), _v3( 400,    0),
      _v3( 300, -300), _v3(-300, -300), _v3(-400,    0),
    ],
  },
  // ── Downtown outer ring ──────────────────────────────────────────────────
  {
    id:    'dt_outer',
    label: 'Downtown Outer',
    district: 'downtown',
    speed: 13,
    waypoints: [
      _v3(-450,  450), _v3(   0,  480), _v3( 450,  450),
      _v3( 480,    0), _v3( 450, -450), _v3(   0, -480),
      _v3(-450, -450), _v3(-480,    0),
    ],
  },
  // ── Downtown cross boulevard ─────────────────────────────────────────────
  {
    id:    'dt_cross',
    label: 'Downtown Cross',
    district: 'downtown',
    speed: 11,
    waypoints: [
      _v3(-480,   0), _v3(-200,   0), _v3(   0,   0),
      _v3( 200,   0), _v3( 480,   0), _v3( 200,   0),
      _v3(   0,   0), _v3(-200,   0),
    ],
  },

  // ── Waterfront promenade ──────────────────────────────────────────────────
  {
    id:    'wf_promenade',
    label: 'Waterfront Promenade',
    district: 'waterfront',
    speed: 14,
    waypoints: [
      _v3( 600, -400), _v3( 900, -300), _v3(1200, -200),
      _v3(1500, -100), _v3(1800,    0), _v3(1900,  200),
      _v3(1800,  400), _v3(1500,  300), _v3(1200,  200),
      _v3( 900,  100), _v3( 600,    0), _v3( 700, -200),
    ],
  },
  // ── Waterfront harbor loop ────────────────────────────────────────────────
  {
    id:    'wf_harbor',
    label: 'Harbor Loop',
    district: 'waterfront',
    speed: 16,
    waypoints: [
      _v3( 800, -500), _v3(1300, -450), _v3(1800, -350),
      _v3(1900,  -50), _v3(1700,  450), _v3(1200,  400),
      _v3( 700,  300), _v3( 600,   50),
    ],
  },

  // ── Industrial throughway ─────────────────────────────────────────────────
  {
    id:    'in_throughway',
    label: 'Industrial Throughway',
    district: 'industrial',
    speed: 12,
    waypoints: [
      _v3(-600,  800), _v3(-900,  700), _v3(-1200,  600),
      _v3(-1500,  400), _v3(-1800,  200), _v3(-1900, -100),
      _v3(-1700, -300), _v3(-1300, -200), _v3(-900,  -100),
      _v3(-600,  200),
    ],
  },
  // ── Industrial yard loop ──────────────────────────────────────────────────
  {
    id:    'in_yard',
    label: 'Industrial Yard',
    district: 'industrial',
    speed: 9,
    waypoints: [
      _v3(-800,  300), _v3(-1100,  500), _v3(-1400,  400),
      _v3(-1600,  200), _v3(-1600, -100), _v3(-1300, -200),
      _v3(-1000, -100), _v3( -800,   50),
    ],
  },

  // ── Suburbs winding route ─────────────────────────────────────────────────
  {
    id:    'sb_winds',
    label: 'Suburbs Winding',
    district: 'suburbs',
    speed: 10,
    waypoints: [
      _v3( 200,  700), _v3( 350,  900), _v3( 500, 1100),
      _v3( 650, 1300), _v3( 700, 1500), _v3( 600, 1700),
      _v3( 400, 1800), _v3( 250, 1600), _v3( 200, 1400),
      _v3( 300, 1200), _v3( 200, 1000), _v3( 150,  800),
    ],
  },
  // ── Suburbs main street ───────────────────────────────────────────────────
  {
    id:    'sb_main',
    label: 'Suburbs Main Street',
    district: 'suburbs',
    speed: 11,
    waypoints: [
      _v3( 100,  700), _v3( 400,  700), _v3( 700,  700),
      _v3( 900,  900), _v3( 900, 1200), _v3( 700, 1500),
      _v3( 500, 1700), _v3( 300, 1700), _v3( 100, 1500),
      _v3( 100, 1200), _v3( 100,  900),
    ],
  },

  // ── Racing district service road ──────────────────────────────────────────
  {
    id:    'rd_service',
    label: 'Racing District Service Road',
    district: 'racing',
    speed: 15,
    waypoints: [
      _v3( 700,  700), _v3(1000,  700), _v3(1300,  700),
      _v3(1600,  900), _v3(1800, 1200), _v3(1700, 1600),
      _v3(1400, 1800), _v3(1000, 1900), _v3( 700, 1700),
      _v3( 700, 1400), _v3( 700, 1100),
    ],
  },

  // ── Outskirts highway north ───────────────────────────────────────────────
  {
    id:    'ok_highway_n',
    label: 'Outskirts Highway North',
    district: 'outskirts',
    speed: 18,
    waypoints: [
      _v3(-1800, -800),  _v3(-1000, -1000), _v3(   0, -1100),
      _v3( 1000, -1000), _v3( 1800,  -800), _v3( 1800, -1200),
      _v3( 1000, -1400), _v3(    0, -1600), _v3(-1000, -1400),
      _v3(-1800, -1200),
    ],
  },
  // ── Outskirts ring road ───────────────────────────────────────────────────
  {
    id:    'ok_ring',
    label: 'Outskirts Ring Road',
    district: 'outskirts',
    speed: 17,
    waypoints: [
      _v3(-1900, -1900), _v3(    0, -1950), _v3( 1900, -1900),
      _v3( 1950, -1000), _v3( 1950,     0), _v3( 1900,  1900),
      _v3(    0,  1950), _v3(-1900,  1900), _v3(-1950,  -100),
    ],
  },
]);

// ─── Pedestrian Patrol Paths ──────────────────────────────────────────────────
// Peds walk an A→B→A patrol. segment is [posA, posB].

const _pv = (x, z) => new THREE.Vector3(x, 0.1, z);

export const PED_PATHS = Object.freeze([
  // Downtown sidewalks
  { id: 'ped_dt_01', segment: [_pv(-100, -120), _pv( 100, -120)] },
  { id: 'ped_dt_02', segment: [_pv( 200,  -60), _pv( 200,  180)] },
  { id: 'ped_dt_03', segment: [_pv(-200, -200), _pv(-200,  200)] },
  { id: 'ped_dt_04', segment: [_pv( -50,  300), _pv( 250,  300)] },
  { id: 'ped_dt_05', segment: [_pv( 300, -100), _pv( 450, -100)] },
  { id: 'ped_dt_06', segment: [_pv(-400,  100), _pv(-150,  100)] },
  { id: 'ped_dt_07', segment: [_pv(  80, -350), _pv( 300, -350)] },
  { id: 'ped_dt_08', segment: [_pv(-300,  400), _pv(-100,  400)] },
  // Waterfront harbour walk
  { id: 'ped_wf_01', segment: [_pv( 650, -180), _pv(1100, -180)] },
  { id: 'ped_wf_02', segment: [_pv(1200,  200), _pv(1700,  200)] },
  { id: 'ped_wf_03', segment: [_pv( 800,  350), _pv(1400,  350)] },
  // Festival Plaza cluster
  { id: 'ped_fp_01', segment: [_pv( -80,  -80), _pv(  80,  -80)] },
  { id: 'ped_fp_02', segment: [_pv( -60, -160), _pv(  60, -160)] },
  { id: 'ped_fp_03', segment: [_pv(-120,    0), _pv( 120,    0)] },
  // Suburbs pavement
  { id: 'ped_sb_01', segment: [_pv( 150,  750), _pv( 450,  750)] },
  { id: 'ped_sb_02', segment: [_pv( 300, 1000), _pv( 600, 1000)] },
]);

// ─── Car Archetypes (procedural meshes until GLBs are ready) ─────────────────

const _CAR_ARCHETYPES = [
  { name: 'sedan',   w: 1.8, h: 0.7, d: 4.2, color: 0x445566 },
  { name: 'hatch',   w: 1.7, h: 0.75, d: 3.8, color: 0x884422 },
  { name: 'suv',     w: 2.0, h: 0.9, d: 4.6, color: 0x334433 },
  { name: 'van',     w: 2.0, h: 1.2, d: 4.8, color: 0x777777 },
  { name: 'coupe',   w: 1.8, h: 0.65, d: 4.4, color: 0x222244 },
  { name: 'truck',   w: 2.1, h: 1.0, d: 5.2, color: 0x553322 },
];

const _PED_COLORS = [0xffccaa, 0xc68642, 0xffdab9, 0x8d5524, 0xf1c27d, 0xe0ac69];
const _CLOTH_COLORS = [0x2255aa, 0xaa2222, 0x22aa44, 0x888800, 0x442288, 0x998866];

// ─── Materials ────────────────────────────────────────────────────────────────

function _carMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 });
}
const _wheelMat  = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const _glassMat  = new THREE.MeshStandardMaterial({ color: 0x88aacc, transparent: true, opacity: 0.45 });
const _lightMat  = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0xffffcc), emissiveIntensity: 0.0 });
const _brakeMat  = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: new THREE.Color(0xff2200), emissiveIntensity: 0.0 });

// Geometries (shared)
const _wheelGeo  = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 10);
const _pedBodyGeo= new THREE.CapsuleGeometry(0.2, 0.9, 4, 8);
const _pedHeadGeo= new THREE.SphereGeometry(0.18, 8, 6);
const _lightGeo  = new THREE.BoxGeometry(0.3, 0.1, 0.05);

// ─── Internal State ───────────────────────────────────────────────────────────

/** @type {TrafficCar[]} */
const _trafficPool = [];
/** @type {Pedestrian[]} */
const _pedPool     = [];

let _raceActive  = false;
let _ready       = false;

// Scratch vectors
const _tmp = new THREE.Vector3();
const _fwd = new THREE.Vector3();

// ─── Traffic Car class ────────────────────────────────────────────────────────

class TrafficCar {
  constructor(pathDef) {
    this.pathDef      = null;
    this.waypointIdx  = 0;
    this.progress     = 0;   // 0–1 between current and next waypoint
    this.speed        = TRAFFIC_SPEED_MIN;
    this.baseSpeed    = TRAFFIC_SPEED_MIN;
    this.active       = false;

    // Build mesh
    const arch  = _CAR_ARCHETYPES[Math.floor(Math.random() * _CAR_ARCHETYPES.length)];
    const body  = new THREE.Mesh(
      new THREE.BoxGeometry(arch.w, arch.h, arch.d),
      _carMat(arch.color),
    );
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(arch.w - 0.1, arch.h * 0.4, arch.d * 0.55),
      _glassMat,
    );
    glass.position.set(0, arch.h * 0.55, -arch.d * 0.05);

    // Headlights
    const hl = new THREE.Mesh(_lightGeo, _lightMat.clone());
    const hr = new THREE.Mesh(_lightGeo, _lightMat.clone());
    hl.position.set(-arch.w * 0.35, 0, -arch.d * 0.5);
    hr.position.set( arch.w * 0.35, 0, -arch.d * 0.5);

    // Brake lights
    const bl = new THREE.Mesh(_lightGeo, _brakeMat.clone());
    const br = new THREE.Mesh(_lightGeo, _brakeMat.clone());
    bl.position.set(-arch.w * 0.35, 0,  arch.d * 0.5);
    br.position.set( arch.w * 0.35, 0,  arch.d * 0.5);

    // Wheels
    const wfl = new THREE.Mesh(_wheelGeo, _wheelMat);
    const wfr = new THREE.Mesh(_wheelGeo, _wheelMat);
    const wrl = new THREE.Mesh(_wheelGeo, _wheelMat);
    const wrr = new THREE.Mesh(_wheelGeo, _wheelMat);
    const wy  = -arch.h * 0.35;
    const wx  =  arch.w * 0.55;
    const wfz = -arch.d * 0.32;
    const wrz =  arch.d * 0.32;
    wfl.position.set(-wx, wy, wfz);
    wfr.position.set( wx, wy, wfz);
    wrl.position.set(-wx, wy, wrz);
    wrr.position.set( wx, wy, wrz);
    [wfl, wfr, wrl, wrr].forEach(w => w.rotation.z = Math.PI * 0.5);

    this.group = new THREE.Group();
    this.group.add(body, glass, hl, hr, bl, br, wfl, wfr, wrl, wrr);
    this.group.visible = false;
    GROUPS.world.add(this.group);

    this._body  = body;
    this._hl    = [hl, hr];
    this._bl    = [bl, br];
    this._wheels = [wfl, wfr, wrl, wrr];
    this._arch  = arch;
    this._isBraking = false;
    this._wheelRot  = 0;
  }

  /** Spawn this car on a path, offset by a fractional start position */
  spawn(pathDef, startFraction = 0) {
    this.pathDef     = pathDef;
    this.waypointIdx = 0;
    this.progress    = startFraction;
    this.baseSpeed   = pathDef.speed + (Math.random() - 0.5) * 3;
    this.speed       = this.baseSpeed;
    this.active      = true;
    this.group.visible = true;
    // Place immediately
    this._applyTransform();
  }

  despawn() {
    this.active          = false;
    this.group.visible   = false;
    this.pathDef         = null;
  }

  /**
   * Advance along path.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {number} distToPlayer
   */
  tick(dt, playerPos, distToPlayer) {
    if (!this.active || !this.pathDef) return;

    // Skip expensive updates beyond LOD distance
    const lod = distToPlayer > LOD_DIST;

    // Player avoidance — brake when close
    const braking = distToPlayer < BRAKE_DIST;
    const targetSpeed = distToPlayer < STOP_DIST
      ? 0
      : braking
        ? this.baseSpeed * Math.max(0, (distToPlayer - STOP_DIST) / (BRAKE_DIST - STOP_DIST))
        : this.baseSpeed;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 4);

    // Advance progress along segment
    const wps  = this.pathDef.waypoints;
    const next = (this.waypointIdx + 1) % wps.length;
    const segLen = wps[this.waypointIdx].distanceTo(wps[next]);
    this.progress += (this.speed * dt) / Math.max(segLen, 0.01);

    if (this.progress >= 1) {
      this.progress    -= 1;
      this.waypointIdx  = next;
    }

    if (!lod) {
      this._applyTransform();
      this._updateLights(braking);

      // Wheel spin
      this._wheelRot += (this.speed / 0.28) * dt;
      this._wheels.forEach(w => { w.rotation.x = this._wheelRot; });
    }
  }

  _applyTransform() {
    const wps   = this.pathDef.waypoints;
    const cur   = wps[this.waypointIdx];
    const nxt   = wps[(this.waypointIdx + 1) % wps.length];

    this.group.position.lerpVectors(cur, nxt, this.progress);

    _fwd.subVectors(nxt, cur).normalize();
    if (_fwd.lengthSq() > 0.001) {
      this.group.rotation.y = Math.atan2(_fwd.x, _fwd.z);
    }
  }

  _updateLights(braking) {
    const intensity = braking ? 1.2 : 0;
    this._bl.forEach(l => { l.material.emissiveIntensity = intensity; });
    if (this._isBraking !== braking) {
      this._isBraking = braking;
    }
  }

  setHeadlights(on) {
    const i = on ? 1.5 : 0;
    this._hl.forEach(l => { l.material.emissiveIntensity = i; });
  }
}

// ─── Pedestrian class ─────────────────────────────────────────────────────────

class Pedestrian {
  constructor() {
    this.pathDef  = null;
    this.dir      = 1;    //  1 = A→B, -1 = B→A
    this.t        = 0;    // 0–1 along segment
    this.speed    = PED_SPEED_MIN;
    this.active   = false;
    this._phase   = Math.random() * Math.PI * 2; // walk cycle phase

    // Mesh: capsule body + sphere head
    const skinColor  = _PED_COLORS [Math.floor(Math.random() * _PED_COLORS.length)];
    const clothColor = _CLOTH_COLORS[Math.floor(Math.random() * _CLOTH_COLORS.length)];

    const bodyMesh = new THREE.Mesh(
      _pedBodyGeo,
      new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.8 }),
    );
    const headMesh = new THREE.Mesh(
      _pedHeadGeo,
      new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 }),
    );
    headMesh.position.y = 0.85;

    this.group = new THREE.Group();
    this.group.add(bodyMesh, headMesh);
    this.group.visible = false;
    GROUPS.world.add(this.group);

    this._bodyMesh = bodyMesh;
  }

  spawn(pathDef) {
    this.pathDef = pathDef;
    this.dir     = Math.random() > 0.5 ? 1 : -1;
    this.t       = Math.random();
    this.speed   = PED_SPEED_MIN + Math.random() * (PED_SPEED_MAX - PED_SPEED_MIN);
    this.active  = true;
    this.group.visible = true;
    this._applyTransform();
  }

  despawn() {
    this.active = false;
    this.group.visible = false;
    this.pathDef = null;
  }

  tick(dt, distToPlayer) {
    if (!this.active || !this.pathDef) return;

    if (distToPlayer > LOD_DIST) return;

    const [a, b] = this.pathDef.segment;
    this.t += (this.speed * dt * this.dir) / Math.max(a.distanceTo(b), 0.01);

    if (this.t >= 1) { this.t = 1; this.dir = -1; }
    if (this.t <= 0) { this.t = 0; this.dir =  1; }

    this._applyTransform();

    // Bob up and down for walk cycle illusion
    this._phase += dt * 4;
    this.group.position.y = Math.abs(Math.sin(this._phase)) * 0.06;
  }

  _applyTransform() {
    const [a, b] = this.pathDef.segment;
    this.group.position.lerpVectors(a, b, this.t);
    this.group.position.y += 0.55;

    _fwd.subVectors(b, a).normalize().multiplyScalar(this.dir);
    if (_fwd.lengthSq() > 0.001) {
      this.group.rotation.y = Math.atan2(_fwd.x, _fwd.z);
    }
  }
}

// ─── Spawn Helpers ────────────────────────────────────────────────────────────

/**
 * Find an inactive car in pool or return null.
 */
function _getFreeTrafficCar() {
  return _trafficPool.find(c => !c.active) ?? null;
}
function _getFreePed() {
  return _pedPool.find(p => !p.active) ?? null;
}

/**
 * Pick a path whose midpoint is within spawn range of player.
 */
function _pickTrafficPath(playerPos) {
  // Filter paths that have at least one waypoint in spawn band
  const candidates = TRAFFIC_PATHS.filter(path => {
    for (const wp of path.waypoints) {
      const dx = wp.x - playerPos.x;
      const dz = wp.z - playerPos.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d >= SPAWN_DIST_MIN && d <= SPAWN_DIST_MAX) return true;
    }
    return false;
  });
  if (!candidates.length) return TRAFFIC_PATHS[Math.floor(Math.random() * TRAFFIC_PATHS.length)];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function _pickPedPath(playerPos) {
  const candidates = PED_PATHS.filter(path => {
    const mid = new THREE.Vector3().lerpVectors(path.segment[0], path.segment[1], 0.5);
    const d = mid.distanceTo(playerPos);
    return d >= SPAWN_DIST_MIN * 0.5 && d <= SPAWN_DIST_MAX;
  });
  if (!candidates.length) return PED_PATHS[Math.floor(Math.random() * PED_PATHS.length)];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ─── Initialise ───────────────────────────────────────────────────────────────

/**
 * @param {THREE.Scene} scene  (unused — we add directly to GROUPS.world)
 * @param {object}      world  — Rapier world (reserved for future KCC peds)
 */
export function initNPCs(scene, world) {
  // Pre-allocate traffic pool
  for (let i = 0; i < MAX_TRAFFIC; i++) {
    _trafficPool.push(new TrafficCar(TRAFFIC_PATHS[0]));
  }
  // Pre-allocate ped pool
  for (let i = 0; i < MAX_PEDS; i++) {
    _pedPool.push(new Pedestrian());
  }

  _ready = true;
  console.log(`[npc] initNPCs() — pool: ${MAX_TRAFFIC} traffic, ${MAX_PEDS} peds`);
}

// ─── Per-Frame Tick ───────────────────────────────────────────────────────────

let _spawnTimer = 0;
const SPAWN_INTERVAL = 1.5; // seconds between spawn attempts

/**
 * @param {number}        dt
 * @param {THREE.Vector3} playerPos
 */
export function tickNPCs(dt, playerPos) {
  if (!_ready) return;

  // Get target counts from environment density (0–1)
  let density = 1;
  try { density = getTrafficDensity(); } catch (_) {}

  const targetTraffic = _raceActive ? 0 : Math.round(density * MAX_TRAFFIC);
  const targetPeds    = _raceActive ? 0 : Math.round(density * MAX_PEDS);

  // ── Despawn out-of-range ──────────────────────────────────────────────────
  for (const car of _trafficPool) {
    if (!car.active) continue;
    if (!car.pathDef) { car.despawn(); continue; }
    // Check nearest waypoint
    let nearestDist = Infinity;
    for (const wp of car.pathDef.waypoints) {
      const d = playerPos.distanceTo(wp);
      if (d < nearestDist) nearestDist = d;
    }
    if (nearestDist > DESPAWN_DIST) car.despawn();
  }
  for (const ped of _pedPool) {
    if (!ped.active) continue;
    if (!ped.pathDef) { ped.despawn(); continue; }
    const mid = new THREE.Vector3().lerpVectors(ped.pathDef.segment[0], ped.pathDef.segment[1], 0.5);
    if (mid.distanceTo(playerPos) > DESPAWN_DIST) ped.despawn();
  }

  // ── Spawn to target ───────────────────────────────────────────────────────
  _spawnTimer += dt;
  if (_spawnTimer >= SPAWN_INTERVAL) {
    _spawnTimer = 0;

    const activeTraffic = _trafficPool.filter(c => c.active).length;
    if (activeTraffic < targetTraffic) {
      const car  = _getFreeTrafficCar();
      const path = _pickTrafficPath(playerPos);
      if (car && path) {
        car.spawn(path, Math.random());
      }
    }

    const activePeds = _pedPool.filter(p => p.active).length;
    if (activePeds < targetPeds) {
      const ped  = _getFreePed();
      const path = _pickPedPath(playerPos);
      if (ped && path) {
        ped.spawn(path);
      }
    }
  }

  // ── Tick active units ─────────────────────────────────────────────────────
  for (const car of _trafficPool) {
    if (!car.active) continue;
    const dist = playerPos.distanceTo(car.group.position);
    car.tick(dt, playerPos, dist);
  }
  for (const ped of _pedPool) {
    if (!ped.active) continue;
    const dist = playerPos.distanceTo(ped.group.position);
    ped.tick(dt, dist);
  }
}

// ─── Headlight Sync (called by environment) ───────────────────────────────────

/**
 * Called by environment.js when isNight() changes to flick headlights.
 * @param {boolean} on
 */
export function setNPCHeadlights(on) {
  for (const car of _trafficPool) {
    if (car.active) car.setHeadlights(on);
  }
}

// ─── Race Suppression ─────────────────────────────────────────────────────────

/**
 * Suppress all traffic during a race (no collisions with AI cars).
 * @param {boolean} active
 */
export function setRaceActive(active) {
  _raceActive = active;
  if (active) {
    for (const car of _trafficPool) car.despawn();
    for (const ped of _pedPool)     ped.despawn();
  }
}

// ─── Debug Info ───────────────────────────────────────────────────────────────

export function getNPCCount() {
  return {
    traffic: _trafficPool.filter(c => c.active).length,
    peds:    _pedPool.filter(p => p.active).length,
    trafficMax: MAX_TRAFFIC,
    pedMax:     MAX_PEDS,
  };
}

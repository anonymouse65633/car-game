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

// Scale NPC pool to graphics preset — lower = fewer physics/draw objects
const _NPC_PRESET   = (() => { try { return localStorage.getItem('graphicsPreset') ?? 'low'; } catch { return 'low'; } })();
const _TRAFFIC_MAP  = { low: 5, medium: 15, high: 25, ultra: 40, extreme: 40 };
const _PEDS_MAP     = { low: 0, medium: 8,  high: 15, ultra: 30, extreme: 30 };
const MAX_TRAFFIC   = _TRAFFIC_MAP[_NPC_PRESET] ?? 5;
const MAX_PEDS      = _PEDS_MAP[_NPC_PRESET]    ?? 0;
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
  // ── Guanajuato city center tight loop ─────────────────────────────────────
  {
    id: 'gua_plaza_loop', label: 'Guanajuato Plaza Loop', district: 'guanajuato', speed: 10,
    waypoints: [
      _v3(1600,-2400), _v3(1900,-2300), _v3(2100,-2000), _v3(2200,-1700),
      _v3(2000,-1500), _v3(1700,-1600), _v3(1500,-1900), _v3(1400,-2200),
    ],
  },
  // ── Guanajuato upper hillside circuit ─────────────────────────────────────
  {
    id: 'gua_hillside', label: 'Guanajuato Hillside', district: 'guanajuato', speed: 9,
    waypoints: [
      _v3(2400,-2800), _v3(2700,-2600), _v3(2800,-2200), _v3(2600,-1800),
      _v3(2200,-1900), _v3(2000,-2300),
    ],
  },
  // ── Guanajuato main boulevard ──────────────────────────────────────────────
  {
    id: 'downtown_gua', label: 'Guanajuato Boulevard', district: 'guanajuato', speed: 13,
    waypoints: [
      _v3( 700,-1200), _v3(1100,-1300), _v3(1500,-1400), _v3(1900,-1500),
      _v3(2300,-1600), _v3(2600,-1800), _v3(2700,-2000), _v3(2400,-2200),
    ],
  },
  // ── Riviera north coastal road ─────────────────────────────────────────────
  {
    id: 'riviera_coast_n', label: 'Riviera Coast North', district: 'riviera', speed: 18,
    waypoints: [
      _v3(2800,-2200), _v3(3200,-2100), _v3(3600,-1900), _v3(4000,-1700),
      _v3(4400,-1500), _v3(4700,-1200), _v3(4800, -900), _v3(4700, -600),
    ],
  },
  // ── Riviera south coastal road ─────────────────────────────────────────────
  {
    id: 'riviera_coast_s', label: 'Riviera Coast South', district: 'riviera', speed: 16,
    waypoints: [
      _v3(4700, -300), _v3(4500,  -50), _v3(4200,  150), _v3(3800,  300),
      _v3(3400,  350), _v3(3000,  250), _v3(2700,   50), _v3(2600, -200),
    ],
  },
  // ── Riviera harbor dockside ────────────────────────────────────────────────
  {
    id: 'harbor_dock', label: 'Riviera Harbor Dock', district: 'riviera', speed: 12,
    waypoints: [
      _v3(3600,  -600), _v3(3900,  -500), _v3(4100,  -300),
      _v3(4000,  -100), _v3(3700,  -200), _v3(3500,  -400),
    ],
  },
  // ── Caldera volcano approach switchbacks ───────────────────────────────────
  {
    id: 'caldera_approach', label: 'Caldera Approach', district: 'caldera', speed: 11,
    waypoints: [
      _v3(2000,-2800), _v3(2300,-3000), _v3(2600,-3300), _v3(2900,-3600),
      _v3(3100,-3900), _v3(3300,-4100), _v3(3400,-3900), _v3(3200,-3600),
      _v3(2900,-3300), _v3(2600,-3000),
    ],
  },
  // ── Caldera summit crater road ─────────────────────────────────────────────
  {
    id: 'caldera_summit', label: 'Caldera Summit Road', district: 'caldera', speed: 8,
    waypoints: [
      _v3(3300,-3800), _v3(3600,-3700), _v3(3800,-3900),
      _v3(3700,-4200), _v3(3400,-4300), _v3(3200,-4100),
    ],
  },
  // ── Festival grounds perimeter road ───────────────────────────────────────
  {
    id: 'festival_ring', label: 'Festival Ring Road', district: 'festival', speed: 15,
    waypoints: [
      _v3(-2800, 700), _v3(-2200, 700), _v3(-1600, 800),
      _v3(-1000, 700), _v3( -400, 800), _v3( -400,1400),
      _v3(-1000,1600), _v3(-1800,1600), _v3(-2600,1500),
      _v3(-2800,1200),
    ],
  },
  // ── Airstrip straight + return ─────────────────────────────────────────────
  {
    id: 'festival_airstrip', label: 'Festival Airstrip', district: 'festival', speed: 22,
    waypoints: [
      _v3(-2400,1000), _v3(-1800,1000),
      _v3(-1200,1000), _v3( -600,1000),
    ],
  },
  // ── Baja north-south highway ───────────────────────────────────────────────
  {
    id: 'baja_highway_ns', label: 'Baja Highway N-S', district: 'baja', speed: 20,
    waypoints: [
      _v3(-3000, -800), _v3(-3200, -400), _v3(-3400,  0),
      _v3(-3500,  400), _v3(-3400, 800), _v3(-3200, 1200),
      _v3(-3000, 1600), _v3(-2800, 1900),
    ],
  },
  // ── Baja mesa top loop ─────────────────────────────────────────────────────
  {
    id: 'baja_mesa_loop', label: 'Baja Mesa Loop', district: 'baja', speed: 14,
    waypoints: [
      _v3(-4200,  200), _v3(-4500,  400), _v3(-4600,  700),
      _v3(-4400, 1000), _v3(-4100,  800), _v3(-3900,  500),
    ],
  },
  // ── Canyon floor road ──────────────────────────────────────────────────────
  {
    id: 'canyon_road', label: 'Canyon Road', district: 'baja', speed: 13,
    waypoints: [
      _v3(-1200,-1400), _v3(-1400,-1200), _v3(-1600,-1000),
      _v3(-1400, -800), _v3(-1200, -700), _v3(-1000, -900),
    ],
  },
  // ── Dunas sand road ────────────────────────────────────────────────────────
  {
    id: 'dunas_track', label: 'Dunas Sand Track', district: 'dunas', speed: 11,
    waypoints: [
      _v3(-4000,-3200), _v3(-3600,-3000), _v3(-3200,-2800),
      _v3(-2800,-2600), _v3(-2400,-2800), _v3(-2200,-3200),
      _v3(-2600,-3600), _v3(-3200,-3800),
    ],
  },
  // ── Farmland country crossroads ────────────────────────────────────────────
  {
    id: 'farmland_lanes', label: 'Farmland Lanes', district: 'farmland', speed: 10,
    waypoints: [
      _v3( 200, -600), _v3( 600, -600), _v3(1000, -400),
      _v3(1400, -200), _v3(1600,  200), _v3(1400,  600),
      _v3(1000,  800), _v3( 600,  600),
    ],
  },
  // ── Jungle muddy trail ─────────────────────────────────────────────────────
  {
    id: 'jungle_trail', label: 'La Selva Jungle Trail', district: 'jungle', speed: 9,
    waypoints: [
      _v3( 800, 1400), _v3(1200, 1600), _v3(1600, 1900),
      _v3(2000, 2200), _v3(2300, 2600), _v3(2100, 3000),
      _v3(1700, 3200), _v3(1300, 2900),
    ],
  },
  // ── Eastern highway ring segment ───────────────────────────────────────────
  {
    id: 'highway_east', label: 'Highway East', district: 'highway', speed: 24,
    waypoints: [
      _v3(4800,-4800), _v3(4800,-4000), _v3(4800,-3000),
      _v3(4800,-2000), _v3(4800,-1000), _v3(4800,    0),
      _v3(4800, 1000), _v3(4800, 2000), _v3(4800, 3000),
      _v3(4800, 4000),
    ],
  },
  // ── Western highway ring segment ───────────────────────────────────────────
  {
    id: 'highway_west', label: 'Highway West', district: 'highway', speed: 24,
    waypoints: [
      _v3(-4800, 4000), _v3(-4800, 3000), _v3(-4800, 2000),
      _v3(-4800, 1000), _v3(-4800,    0), _v3(-4800,-1000),
      _v3(-4800,-2000), _v3(-4800,-3000), _v3(-4800,-4000),
      _v3(-4800,-4800),
    ],
  },
  // ── Northern highway ring segment ──────────────────────────────────────────
  {
    id: 'highway_north', label: 'Highway North', district: 'highway', speed: 24,
    waypoints: [
      _v3(-4800,-4800), _v3(-3000,-4800), _v3(-1000,-4800),
      _v3( 1000,-4800), _v3( 3000,-4800), _v3( 4800,-4800),
    ],
  },
  // ── Southern highway ring segment ──────────────────────────────────────────
  {
    id: 'highway_south', label: 'Highway South', district: 'highway', speed: 24,
    waypoints: [
      _v3( 4800, 4800), _v3( 3000, 4800), _v3( 1000, 4800),
      _v3(-1000, 4800), _v3(-3000, 4800), _v3(-4800, 4800),
    ],
  },
]);



// ─── Pedestrian Patrol Paths ──────────────────────────────────────────────────
// Peds walk an A→B→A patrol. segment is [posA, posB].

const _pv = (x, z) => new THREE.Vector3(x, 0.1, z);

export const PED_PATHS = Object.freeze([
  // ── Guanajuato market stalls ──────────────────────────────────────────────
  { id: 'ped_gua_01', segment: [_pv(1700,-2100), _pv(1900,-2100)] },
  { id: 'ped_gua_02', segment: [_pv(2000,-1800), _pv(2000,-2000)] },
  { id: 'ped_gua_03', segment: [_pv(1600,-1900), _pv(1800,-1700)] },
  // ── Riviera promenade ─────────────────────────────────────────────────────
  { id: 'ped_riv_01', segment: [_pv(3200, -800), _pv(3600, -800)] },
  { id: 'ped_riv_02', segment: [_pv(4000,-1000), _pv(4400,-1000)] },
  // ── Festival grounds crowds ────────────────────────────────────────────────
  { id: 'ped_fes_01', segment: [_pv(-1600,1400), _pv(-1200,1400)] },
  { id: 'ped_fes_02', segment: [_pv(-2000,1200), _pv(-2000,1600)] },
  { id: 'ped_fes_03', segment: [_pv(-1400,1000), _pv(-1800,1200)] },
  // ── Farmland locals ────────────────────────────────────────────────────────
  { id: 'ped_frm_01', segment: [_pv(  800, -300), _pv(1100, -300)] },
  { id: 'ped_frm_02', segment: [_pv( 1200,  400), _pv( 800,  400)] },
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
  // Expose pool for DayNightSystem (Part 17) NPC SpotLight assignment
  window.__npcTrafficPool = _trafficPool;
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

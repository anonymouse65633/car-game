/**
 * suspension.js — 4-Wheel Raycast Suspension
 * Part 2 / Car layer
 *
 * Responsibilities:
 *  - Fire a downward Rapier raycast from each wheel mount point each physics step
 *  - Compute spring + damper force from hit distance vs. rest length
 *  - Apply force to Rapier rigid body at each wheel contact point
 *  - Apply anti-roll bar torque between axle pairs
 *  - Track per-wheel state: compression, contact, surface type, grip coefficient
 *  - Expose wheel world positions for Three.js mesh sync and tyre-smoke FX
 *  - Support full per-axle tuning from the Tuning System (Part 4)
 *
 * Exports:
 *  SuspensionSystem                          — class, one instance per car
 *  SuspensionSystem.DEFAULT_TUNING           — static baseline tune values
 *  createSuspensionSystem(carDef, world)     — factory helper
 *
 * Dependencies:
 *  physics.js  — Rapier world reference + utility wrappers
 *  city.js     — getRoadSurface(x, z) → { grip, type }
 *  environment.js — getGripMultiplier() → number (weather)
 */

import { getRoadSurface }   from '../world/city.js';
import { getGripMultiplier } from '../world/environment.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Rapier raycast origin offset above the wheel attachment point (avoids self-hit). */
const RAY_ORIGIN_OFFSET = 0.15;   // m

/** Maximum raycast length — defines total suspension travel range. */
const RAY_MAX_LENGTH    = 0.80;   // m

/** Physics sub-steps safety clamp for force magnitude. */
const MAX_SPRING_FORCE  = 80_000; // N per wheel
const MAX_DAMPER_FORCE  = 20_000; // N per wheel

/** Fraction of body weight each axle carries at rest. Front gets slightly more. */
const FRONT_WEIGHT_BIAS = 0.52;

/** Wheel index constants for readability. */
export const WHL = Object.freeze({ FL: 0, FR: 1, RL: 2, RR: 3 });

// ─── Surface Grip Table ───────────────────────────────────────────────────────

export const SURFACE_GRIP = Object.freeze({
  tarmac:   1.00,
  wet:      0.72,
  gravel:   0.65,
  dirt:     0.60,
  grass:    0.50,
  sand:     0.45,
  concrete: 0.90,
  cobble:   0.80,
  ice:      0.25,
  default:  1.00,
});

// ─── Tyre Compound Grip Modifiers ─────────────────────────────────────────────

export const TYRE_COMPOUND_GRIP = Object.freeze({
  stock:    { long: 0.85, lat: 0.80 },
  sport:    { long: 0.95, lat: 0.92 },
  race:     { long: 1.10, lat: 1.10 },
  offroad:  { long: 0.80, lat: 0.70 },
  drag:     { long: 1.20, lat: 0.65 },
  drift:    { long: 0.85, lat: 0.55 },
  semi_slick:{ long: 1.05, lat: 1.08 },
});

// ─── Default Tuning ───────────────────────────────────────────────────────────

/**
 * All tuning values live here. Passed in from the Tuning System.
 * Units: N/m for spring, N·s/m for damper, m for geometry.
 */
export const DEFAULT_TUNING = Object.freeze({
  // Spring rates (N/m) — front / rear
  springRateFront:    28_000,
  springRateRear:     24_000,

  // Rest (natural) length (m) — how long the spring sits at equilibrium
  restLengthFront:    0.38,
  restLengthRear:     0.40,

  // Maximum suspension travel (m) from rest
  maxTravelFront:     0.22,
  maxTravelRear:      0.25,

  // Ride height offset (m) — tunable via Ride Height slider
  rideHeightFront:    0.00,
  rideHeightRear:     0.00,

  // Damper bump (compression) coefficient (N·s/m) — front / rear
  bumpFront:          2_200,
  bumpRear:           2_000,

  // Damper rebound (extension) coefficient (N·s/m) — front / rear
  reboundFront:       2_800,
  reboundRear:        2_600,

  // Anti-roll bar stiffness (N·m / m of axle differential)
  antiRollFront:      8_000,
  antiRollRear:       5_000,

  // Camber angle (degrees, negative = top leaning inward)
  camberFront:       -1.0,
  camberRear:        -0.5,

  // Toe angle (degrees, positive = toe-in)
  toeFront:           0.0,
  toeRear:            0.1,

  // Caster angle (degrees, front only — positive = wheel leans back at top)
  casterFront:        5.0,

  // Tyre compound
  tyreCompound:      'sport',

  // Tyre width scalar (1.0 = stock, >1 = wider — affects lateral grip only)
  tyreWidth:          1.0,

  // Brake bias (0 = full front, 1 = full rear, 0.35 = default)
  brakeBias:          0.35,
});

// ─── Per-Wheel State ──────────────────────────────────────────────────────────

class WheelState {
  constructor() {
    this.compression    = 0;    // m — positive = compressed
    this.prevCompression= 0;    // for damper velocity
    this.inContact      = false;
    this.surfaceType    = 'default';
    this.surfaceGrip    = 1.0;
    this.normalForce    = 0;    // N — used by driving.js for traction limit
    this.contactPoint   = { x: 0, y: 0, z: 0 };  // world space hit point
    this.contactNormal  = { x: 0, y: 1, z: 0 };
    this.springForce    = 0;    // N (debug)
    this.damperForce    = 0;    // N (debug)
    this.totalGrip      = 1.0;  // combined grip for this wheel (long/lat averaged)
    this.tempFactor     = 1.0;  // tyre temperature grip factor (0.7–1.0)
    this._tempEnergy    = 0;    // rolling accumulator for tyre heat model
  }
}

// ─── SuspensionSystem ─────────────────────────────────────────────────────────

export class SuspensionSystem {

  /**
   * @param {object} carDef   — from carData.js, includes suspensionGeometry
   * @param {object} rapierWorld — Rapier physics world
   */
  constructor(carDef, rapierWorld) {
    this._world  = rapierWorld;
    this._carDef = carDef;

    /** Tuning snapshot — replaced by tuningSystem.applyTune() */
    this.tuning  = { ...DEFAULT_TUNING, ...(carDef.defaultTuning ?? {}) };

    /** Four WheelState objects indexed by WHL.FL/FR/RL/RR */
    this.wheels  = [
      new WheelState(), // FL
      new WheelState(), // FR
      new WheelState(), // RL
      new WheelState(), // RR
    ];

    /**
     * Wheel attachment points in LOCAL body space (m from body origin).
     * Derived from carDef.suspensionGeometry or sensible defaults.
     */
    const geo = carDef.suspensionGeometry ?? {};
    const hw  = (geo.halfWidth  ?? 0.75);  // half-track width
    const wbF = (geo.wheelbaseF ?? 1.30);  // front axle offset from centre
    const wbR = (geo.wheelbaseR ?? 1.30);  // rear axle offset from centre
    const hgt = (geo.mountHeight?? 0.20);  // mount height above body centre

    this._mountLocal = [
      { x: -hw, y: hgt, z: -wbF },  // FL
      { x:  hw, y: hgt, z: -wbF },  // FR
      { x: -hw, y: hgt, z:  wbR },  // RL
      { x:  hw, y: hgt, z:  wbR },  // RR
    ];

    /** Cached world-space positions for Three.js mesh sync */
    this.wheelWorldPos = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ];

    /** Rapier RigidBody — injected after car body is created */
    this._rigidBody  = null;

    /** Rapier query filter to exclude the car's own colliders */
    this._queryFilter = null;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  static get DEFAULT_TUNING() { return DEFAULT_TUNING; }

  /**
   * Inject the Rapier rigid body once the car is created.
   * @param {object} body        — Rapier RigidBody
   * @param {object} queryFilter — Rapier QueryFilter excluding car colliders
   */
  setBody(body, queryFilter) {
    this._rigidBody  = body;
    this._queryFilter = queryFilter;
  }

  /**
   * Replace tuning at runtime (called by TuningSystem).
   * Only whitelisted keys are accepted to prevent injection.
   * @param {object} partial — partial tuning override
   */
  applyTuning(partial) {
    const allowed = new Set(Object.keys(DEFAULT_TUNING));
    for (const [k, v] of Object.entries(partial)) {
      if (allowed.has(k)) this.tuning[k] = v;
    }
  }

  // ── Main Physics Step ──────────────────────────────────────────────────────

  /**
   * Call once per Rapier physics step (60 Hz).
   * Fires raycasts, computes and applies spring+damper+anti-roll forces.
   * @param {number} dt  — fixed physics step (seconds, typically 1/60)
   */
  step(dt) {
    if (!this._rigidBody) return;

    const body     = this._rigidBody;
    const tuning   = this.tuning;
    const weatherGrip = _safeGetWeatherGrip();
    const compound = TYRE_COMPOUND_GRIP[tuning.tyreCompound] ?? TYRE_COMPOUND_GRIP.sport;

    // Body transform
    const bodyPos   = body.translation();
    const bodyRot   = body.rotation();   // quaternion {x,y,z,w}
    const bodyVel   = body.linvel();

    // ── Raycast all 4 wheels ──────────────────────────────────────────────
    for (let i = 0; i < 4; i++) {
      const mount     = this._mountLocal[i];
      const isFront   = i < 2;
      const restLen   = isFront ? tuning.restLengthFront  : tuning.restLengthRear;
      const maxTravel = isFront ? tuning.maxTravelFront   : tuning.maxTravelRear;
      const rideOff   = isFront ? tuning.rideHeightFront  : tuning.rideHeightRear;

      // Rotate mount point by body quaternion
      const wmx = _rotateX(mount, bodyRot);
      const wmy = _rotateY(mount, bodyRot);
      const wmz = _rotateZ(mount, bodyRot);

      // World-space ray origin (slightly above mount to avoid tunnelling)
      const ox = bodyPos.x + wmx;
      const oy = bodyPos.y + wmy + RAY_ORIGIN_OFFSET;
      const oz = bodyPos.z + wmz;

      // Ray direction — body-down vector
      const downX = _rotateX({ x: 0, y: -1, z: 0 }, bodyRot);
      const downY = _rotateY({ x: 0, y: -1, z: 0 }, bodyRot);
      const downZ = _rotateZ({ x: 0, y: -1, z: 0 }, bodyRot);

      const rayLen = restLen + maxTravel + rideOff + RAY_ORIGIN_OFFSET;

      const hit = _castRay(
        this._world,
        ox, oy, oz,
        downX, downY, downZ,
        rayLen,
        this._queryFilter,
      );

      const ws = this.wheels[i];
      ws.prevCompression = ws.compression;

      if (hit) {
        const hitDist     = hit.toi - RAY_ORIGIN_OFFSET; // distance from mount
        const targetLen   = restLen + rideOff;
        ws.compression    = Math.max(0, Math.min(maxTravel, targetLen - hitDist));
        ws.inContact      = true;
        ws.contactPoint.x = ox + downX * hit.toi;
        ws.contactPoint.y = oy + downY * hit.toi;
        ws.contactPoint.z = oz + downZ * hit.toi;
        ws.contactNormal  = hit.normal ?? { x: 0, y: 1, z: 0 };

        // Surface lookup
        const surf = _safeGetSurface(ws.contactPoint.x, ws.contactPoint.z);
        ws.surfaceType = surf.type;
        ws.surfaceGrip = (SURFACE_GRIP[surf.type] ?? 1.0) * weatherGrip;
      } else {
        ws.compression = 0;
        ws.inContact   = false;
        ws.surfaceType = 'air';
        ws.surfaceGrip = 0;
      }

      // Wheel world position (bottom of travel, for mesh sync)
      const whl_y = oy - (ws.inContact ? (restLen + rideOff - ws.compression) : rayLen);
      this.wheelWorldPos[i].x = ox;
      this.wheelWorldPos[i].y = whl_y;
      this.wheelWorldPos[i].z = oz;

      // ── Tyre temperature model ──────────────────────────────────────────
      if (ws.inContact) {
        // Load = proportional to compression
        ws._tempEnergy += ws.compression * dt * 0.5;
        ws._tempEnergy  = Math.min(ws._tempEnergy, 30); // cap
      } else {
        ws._tempEnergy -= dt * 2; // cool down
        ws._tempEnergy  = Math.max(ws._tempEnergy, 0);
      }
      // 0–30 energy maps to 0.70–1.0 temp factor (cold starts with reduced grip)
      ws.tempFactor = 0.70 + (ws._tempEnergy / 30) * 0.30;

      // Combined grip
      const widthBonus = 1 + (tuning.tyreWidth - 1) * 0.12; // width→lateral
      ws.totalGrip = ws.surfaceGrip * compound.long * ws.tempFactor * widthBonus;
    }

    // ── Compute spring + damper forces ────────────────────────────────────
    for (let i = 0; i < 4; i++) {
      const ws      = this.wheels[i];
      const isFront = i < 2;
      const kS      = isFront ? tuning.springRateFront  : tuning.springRateRear;
      const kBump   = isFront ? tuning.bumpFront        : tuning.bumpRear;
      const kRebound= isFront ? tuning.reboundFront     : tuning.reboundRear;

      if (!ws.inContact) {
        ws.springForce = 0;
        ws.damperForce = 0;
        ws.normalForce = 0;
        continue;
      }

      // Spring: F = k × compression
      const spring = Math.min(kS * ws.compression, MAX_SPRING_FORCE);

      // Damper: velocity from compression change
      const compVel = (ws.compression - ws.prevCompression) / dt;
      const dCoeff  = compVel > 0 ? kBump : kRebound;
      const damper  = Math.max(-MAX_DAMPER_FORCE,
                        Math.min(MAX_DAMPER_FORCE, dCoeff * compVel));

      ws.springForce = spring;
      ws.damperForce = damper;
      ws.normalForce = Math.max(0, spring + damper);

      // Apply force at contact point in world-up direction
      // (simplified: apply in body-up direction for stability)
      const upX = _rotateX({ x: 0, y: 1, z: 0 }, bodyRot);
      const upY = _rotateY({ x: 0, y: 1, z: 0 }, bodyRot);
      const upZ = _rotateZ({ x: 0, y: 1, z: 0 }, bodyRot);
      const f   = ws.normalForce;

      body.addForceAtPoint(
        { x: upX * f, y: upY * f, z: upZ * f },
        ws.contactPoint,
        true,
      );
    }

    // ── Anti-roll bars ────────────────────────────────────────────────────
    _applyAntiRoll(body, this.wheels[WHL.FL], this.wheels[WHL.FR], tuning.antiRollFront, bodyRot);
    _applyAntiRoll(body, this.wheels[WHL.RL], this.wheels[WHL.RR], tuning.antiRollRear,  bodyRot);
  }

  // ── Per-Frame Visual Sync (called in THREE.js render loop) ────────────────

  /**
   * Returns the world-space position and compression ratio for a given wheel,
   * for use by car.js to position wheel meshes.
   *
   * @param  {number} index  — WHL.FL / FR / RL / RR
   * @returns {{ pos: {x,y,z}, compression: number, inContact: boolean }}
   */
  getWheelVisual(index) {
    const ws = this.wheels[index];
    return {
      pos:         this.wheelWorldPos[index],
      compression: ws.compression,
      inContact:   ws.inContact,
      normalForce: ws.normalForce,
    };
  }

  // ── Traction Query (used by driving.js) ───────────────────────────────────

  /**
   * Returns total available lateral grip for a given axle.
   * Averaged across both wheels, accounts for surface + weather + compound + temp.
   *
   * @param  {'front'|'rear'} axle
   * @returns {number} — combined lateral grip multiplier
   */
  getAxleLateralGrip(axle) {
    const compound = TYRE_COMPOUND_GRIP[this.tuning.tyreCompound] ?? TYRE_COMPOUND_GRIP.sport;
    const widthBonus = 1 + (this.tuning.tyreWidth - 1) * 0.18;
    if (axle === 'front') {
      const fl = this.wheels[WHL.FL];
      const fr = this.wheels[WHL.FR];
      return 0.5 * (
        (fl.surfaceGrip * compound.lat * fl.tempFactor * widthBonus) +
        (fr.surfaceGrip * compound.lat * fr.tempFactor * widthBonus)
      );
    }
    const rl = this.wheels[WHL.RL];
    const rr = this.wheels[WHL.RR];
    return 0.5 * (
      (rl.surfaceGrip * compound.lat * rl.tempFactor * widthBonus) +
      (rr.surfaceGrip * compound.lat * rr.tempFactor * widthBonus)
    );
  }

  /**
   * Returns total available longitudinal (drive/brake) grip for a given axle.
   * @param  {'front'|'rear'} axle
   * @returns {number}
   */
  getAxleLongitudinalGrip(axle) {
    const compound = TYRE_COMPOUND_GRIP[this.tuning.tyreCompound] ?? TYRE_COMPOUND_GRIP.sport;
    if (axle === 'front') {
      const fl = this.wheels[WHL.FL];
      const fr = this.wheels[WHL.FR];
      return 0.5 * (
        (fl.surfaceGrip * compound.long * fl.tempFactor) +
        (fr.surfaceGrip * compound.long * fr.tempFactor)
      );
    }
    const rl = this.wheels[WHL.RL];
    const rr = this.wheels[WHL.RR];
    return 0.5 * (
      (rl.surfaceGrip * compound.long * rl.tempFactor) +
      (rr.surfaceGrip * compound.long * rr.tempFactor)
    );
  }

  /**
   * How many wheels are currently in contact with the ground.
   * @returns {number} 0–4
   */
  getGroundedWheels() {
    return this.wheels.filter(w => w.inContact).length;
  }

  /**
   * Is any wheel touching the ground? (car is airborne if false)
   * @returns {boolean}
   */
  isGrounded() {
    return this.wheels.some(w => w.inContact);
  }

  /**
   * Debug snapshot — used by HUDManager debug overlay.
   */
  getDebugState() {
    return this.wheels.map((w, i) => ({
      label:       ['FL','FR','RL','RR'][i],
      compression: w.compression.toFixed(3),
      normalForce: Math.round(w.normalForce),
      grip:        w.totalGrip.toFixed(2),
      surface:     w.surfaceType,
      temp:        w.tempFactor.toFixed(2),
      inContact:   w.inContact,
    }));
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a SuspensionSystem for a given car definition and Rapier world.
 * Call setBody() on the result once the Rapier body is created.
 *
 * @param  {object} carDef   — car definition from carData.js
 * @param  {object} world    — Rapier physics world
 * @returns {SuspensionSystem}
 */
export function createSuspensionSystem(carDef, world) {
  return new SuspensionSystem(carDef, world);
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Anti-roll bar: applies a corrective torque to resist axle roll.
 * If the left wheel is more compressed than the right, push right down.
 */
function _applyAntiRoll(body, wLeft, wRight, stiffness, bodyRot) {
  if (!wLeft.inContact && !wRight.inContact) return;

  const diff  = wLeft.compression - wRight.compression;
  const force = diff * stiffness;

  // Roll axis is the body's Z-axis (forward). Apply as ±Y force at wheel contact.
  const fwdX = _rotateX({ x: 0, y: 0, z: 1 }, bodyRot);
  const fwdY = _rotateY({ x: 0, y: 0, z: 1 }, bodyRot);
  const fwdZ = _rotateZ({ x: 0, y: 0, z: 1 }, bodyRot);

  // Push left wheel down, right wheel up (or vice versa)
  if (wLeft.inContact) {
    body.addForceAtPoint(
      { x: -fwdX * force * 0.5, y: -fwdY * force * 0.5, z: -fwdZ * force * 0.5 },
      wLeft.contactPoint,
      true,
    );
  }
  if (wRight.inContact) {
    body.addForceAtPoint(
      { x:  fwdX * force * 0.5, y:  fwdY * force * 0.5, z:  fwdZ * force * 0.5 },
      wRight.contactPoint,
      true,
    );
  }
}

/**
 * Safe wrapper for city.getRoadSurface — returns default if not ready.
 */
function _safeGetSurface(x, z) {
  try {
    return getRoadSurface(x, z) ?? { type: 'tarmac', grip: 1.0 };
  } catch (_) {
    return { type: 'tarmac', grip: 1.0 };
  }
}

/**
 * Safe wrapper for environment.getGripMultiplier — returns 1 if not ready.
 */
function _safeGetWeatherGrip() {
  try {
    return getGripMultiplier() ?? 1.0;
  } catch (_) {
    return 1.0;
  }
}

// ─── Quaternion rotation helpers (avoids THREE dependency in physics layer) ───

/** Rotate a local vector {x,y,z} by a quaternion {x,y,z,w}. Returns X component. */
function _rotateX(v, q) {
  const { x: vx, y: vy, z: vz } = v;
  const { x: qx, y: qy, z: qz, w: qw } = q;
  return vx * (1 - 2*(qy*qy + qz*qz))
       + vy * 2*(qx*qy - qz*qw)
       + vz * 2*(qx*qz + qy*qw);
}
function _rotateY(v, q) {
  const { x: vx, y: vy, z: vz } = v;
  const { x: qx, y: qy, z: qz, w: qw } = q;
  return vx * 2*(qx*qy + qz*qw)
       + vy * (1 - 2*(qx*qx + qz*qz))
       + vz * 2*(qy*qz - qx*qw);
}
function _rotateZ(v, q) {
  const { x: vx, y: vy, z: vz } = v;
  const { x: qx, y: qy, z: qz, w: qw } = q;
  return vx * 2*(qx*qz - qy*qw)
       + vy * 2*(qy*qz + qx*qw)
       + vz * (1 - 2*(qx*qx + qy*qy));
}

/**
 * Thin wrapper over Rapier's castRay.
 * Returns { toi, normal } or null.
 *
 * @param {object} world
 * @param {number} ox,oy,oz   — ray origin
 * @param {number} dx,dy,dz   — ray direction (need NOT be normalised)
 * @param {number} maxLen
 * @param {object} filter     — Rapier QueryFilter
 */
function _castRay(world, ox, oy, oz, dx, dy, dz, maxLen, filter) {
  if (!world?.castRay) return null;
  try {
    // Rapier castRay signature: (ray, maxToi, solid, filter)
    const ray = { origin: { x: ox, y: oy, z: oz },
                  dir:    { x: dx, y: dy, z: dz } };
    const hit = world.castRay(ray, maxLen, true, filter);
    if (!hit) return null;

    // castRayAndGetNormal is available in Rapier ≥ 0.11
    const hitN = world.castRayAndGetNormal?.(ray, maxLen, true, filter);
    return {
      toi:    hit.toi,
      normal: hitN ? hitN.normal : null,
    };
  } catch (_) {
    return null;
  }
}

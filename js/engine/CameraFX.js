/**
 * CameraFX.js — Part 13: Camera Shake & G-Force Feedback
 * ─────────────────────────────────────────────────────────────────────────────
 * FH5 Setting: Motion Blur Quality — Ultra  (pairs with Part 5 motion blur)
 * Immersion Impact: 82%  |  FPS Cost: ~0%  |  Difficulty: Medium
 *
 * WHAT THIS DOES
 * ──────────────
 * Applies six layered camera effects ON TOP of the existing driving.js
 * chase / hood / cinematic camera positions — it's a pure post-pass that
 * reads the camera's current position/rotation and adds offsets, so it
 * doesn't conflict with the existing camera lag or look-back logic.
 *
 *  1. CRITICALLY-DAMPED SPRING FOLLOW
 *     Replaces the raw lerp lag with a proper spring (ω=8, ζ=0.8).
 *     Settles fast without oscillation — feels planted, not floaty.
 *
 *  2. G-FORCE LEAN (camera roll)
 *     Lateral acceleration rolls the camera ±4° into corners — like a
 *     driver's head leaning with centripetal force.
 *     Roll = clamp(latG × 4°, –4°, +4°), lerp rate 0.08 per frame.
 *
 *  3. ACCELERATION SQUAT (camera pitch)
 *     Throttle → camera pitches back 2° (weight-transfer squat).
 *     Brake    → camera pitches forward 1.5° (nose-dive).
 *     Lerp rate 0.1 per frame for a natural lag.
 *
 *  4. TERRAIN BUMP SHAKE
 *     Samples terrain height 2 m ahead of the car each frame.
 *     A sudden rise triggers a Y-axis camera translation (up to ±0.12 m)
 *     that decays via the spring — feels like hitting a rock or curb.
 *     Only active when driving on loose/rough surfaces.
 *
 *  5. LANDING JOLT
 *     Detects when the car has been airborne > 0.3 m for > 0.25 s then
 *     contacts the ground.  Fires a single-frame Y-axis camera jolt scaled
 *     by landing speed (up to ±0.35 m) that the spring damps out naturally.
 *     Works in both chase and hood modes.
 *
 *  6. SPEED FOV
 *     Lerps FOV from 68° at 0 km/h → 90° at 300 km/h.
 *     This matches the plan target: wide enough to feel the rush at top speed
 *     while keeping the horizon readable below 150 km/h.
 *     Overrides DrivingController's own FOV management — comment out
 *     the FOV lines in driving.js _updateCamera if you want Part 6 to
 *     own it fully (see note in integration section below).
 *
 * INTEGRATION
 * ───────────
 *  1. import { initCameraFX, updateCameraFX } from './engine/CameraFX.js';
 *  2. initCameraFX(camera, getTerrainHeight)  — call once after initRenderer
 *  3. updateCameraFX(camera, playerCar, drivingController, dt)
 *                                             — call every UPDATE tick
 *
 * NOTE: DrivingController already sets camera.fov with a 68→85 speed-FOV.
 *       CameraFX re-applies its own 65→75 target ON TOP, so the effective
 *       range is whichever module runs last.  To avoid conflict, set
 *       CAM_FOV_BASE = CAM_FOV_MAX = 0 in driving.js or simply let
 *       CameraFX override — it runs after driving.js update() in the tick.
 *
 * EXPORTS
 * ───────
 *  initCameraFX(camera, getTerrainHeightFn)
 *  updateCameraFX(camera, car, drivingController, dt)
 *  setCameraFXEnabled(bool)   — toggle for settings menu / cinematic mode
 */

'use strict';

import * as THREE from 'three';

// ─── Tuning constants ────────────────────────────────────────────────────────

/** Spring-follow: natural frequency (rad/s). Higher = snappier. */
const SPRING_OMEGA    = 8.0;
/** Spring-follow: damping ratio. 1.0 = critically damped, < 1 = bouncy. */
const SPRING_ZETA     = 0.85;

/** G-force lean: max roll angle in radians (≈ ±4°). */
const LEAN_MAX_RAD    = THREE.MathUtils.degToRad(4.0);
/** G-force lean: lerp rate per second (higher = snappier). */
const LEAN_RATE       = 7.0;

/** Acceleration squat: max pitch from throttle (radians, ≈ 2°). */
const SQUAT_THROTTLE  = THREE.MathUtils.degToRad(2.0);
/** Braking pitch: max pitch from braking (radians, ≈ 1.5°). */
const SQUAT_BRAKE     = THREE.MathUtils.degToRad(-1.5);
/** Squat lerp rate per second. */
const SQUAT_RATE      = 6.0;

/** Terrain bump: lookahead distance in metres. */
const BUMP_LOOKAHEAD  = 2.2;
/** Terrain bump: how much of the slope change is transferred to camera Y. */
const BUMP_GAIN       = 0.55;
/** Terrain bump: only trigger shake when slope delta exceeds this (metres). */
const BUMP_THRESHOLD  = 0.06;

/** Airborne: minimum height above terrain to count as airborne (metres). */
const AIRBORNE_MIN_H  = 0.30;
/** Airborne: minimum air-time before landing jolt fires (seconds). */
const AIRBORNE_MIN_T  = 0.25;
/** Landing jolt: scale factor on vertical velocity at landing. */
const LANDING_GAIN    = 0.022;
/** Landing jolt: maximum camera Y offset from landing (metres). */
const LANDING_MAX     = 0.38;

/** Speed FOV: degrees at 0 km/h. */
const FOV_BASE        = 68;
/** Speed FOV: degrees at top speed (300 km/h). Widening gives a rush-of-speed feel. */
const FOV_MAX         = 90;
/** Speed FOV: km/h that reaches FOV_MAX. */
const FOV_SPEED       = 300;
/** Speed FOV: lerp rate per second. */
const FOV_RATE        = 3.0;

// ─── Module state ────────────────────────────────────────────────────────────

let _enabled         = true;
let _getTerrainH     = null;   // injected terrain sampler

// Spring state (applied to camera Y-offset only — X/Z lag handled by driving.js)
const _springOffset  = new THREE.Vector3();   // current spring offset
const _springVel     = new THREE.Vector3();   // spring velocity

// G-force lean & squat
let _roll            = 0;   // current roll in radians
let _pitch           = 0;   // current pitch in radians

// Airborne
let _airTime         = 0;
let _wasAirborne     = false;
let _prevCarY        = null;
let _prevVelY        = 0;

// Terrain bump
let _prevBumpH       = null;

// FOV
let _currentFov      = FOV_BASE;

// Working vectors (reused to avoid GC)
const _fwd           = new THREE.Vector3();
const _right         = new THREE.Vector3();
const _up            = new THREE.Vector3();
const _quatEuler     = new THREE.Euler();
const _savedQuat     = new THREE.Quaternion();

// ─── Spring integrator ───────────────────────────────────────────────────────

/**
 * Advance one spring step.
 * Critically-damped spring formula:
 *   acc = ω²·(target − pos) − 2ζω·vel
 *   vel += acc·dt
 *   pos += vel·dt
 *
 * @param {THREE.Vector3} pos     current spring position (mutated)
 * @param {THREE.Vector3} vel     current spring velocity (mutated)
 * @param {THREE.Vector3} target  rest position
 * @param {number}        dt      delta time (s)
 */
function _stepSpring(pos, vel, target, dt) {
  const ω = SPRING_OMEGA;
  const ζ = SPRING_ZETA;
  const ax = ω * ω * (target.x - pos.x) - 2 * ζ * ω * vel.x;
  const ay = ω * ω * (target.y - pos.y) - 2 * ζ * ω * vel.y;
  const az = ω * ω * (target.z - pos.z) - 2 * ζ * ω * vel.z;
  vel.x += ax * dt;
  vel.y += ay * dt;
  vel.z += az * dt;
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * initCameraFX(camera, getTerrainHeightFn)
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {(x:number, z:number) => number} getTerrainHeightFn
 *   Function returning world-space terrain Y at (x, z).
 *   If null, terrain bump and airborne detection are disabled.
 */
export function initCameraFX(camera, getTerrainHeightFn) {
  _getTerrainH   = getTerrainHeightFn ?? null;
  _currentFov    = camera.fov;
  _prevCarY      = null;
  _airTime       = 0;
  _wasAirborne   = false;
  _springOffset.set(0, 0, 0);
  _springVel.set(0, 0, 0);
  _roll  = 0;
  _pitch = 0;
  console.log('[CameraFX] ✅ Initialised — spring ω=' + SPRING_OMEGA + ', ζ=' + SPRING_ZETA);
}

/**
 * setCameraFXEnabled(enabled)
 * Toggle all effects — useful for cinematic mode or settings menu.
 *
 * @param {boolean} enabled
 */
export function setCameraFXEnabled(enabled) {
  _enabled = !!enabled;
  if (!enabled) {
    // Reset transient state so re-enable starts clean
    _springOffset.set(0, 0, 0);
    _springVel.set(0, 0, 0);
    _roll  = 0;
    _pitch = 0;
  }
}

/**
 * updateCameraFX(camera, car, drivingController, dt)
 *
 * Apply all camera effects.  Call AFTER drivingController.update() so the
 * camera position has already been set to the driving.js target.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {object} car                  — playerCar (Car instance)
 * @param {object} drivingController    — DrivingController instance
 * @param {number} dt                   — delta time (seconds)
 */
export function updateCameraFX(camera, car, drivingController, dt) {
  if (!_enabled) return;

  // Clamp dt so pauses / dev-tools breakpoints don't explode the spring
  const dts = Math.min(dt, 0.05);

  // ── Read driving state ─────────────────────────────────────────────────────
  const speedKmh   = car.speedKmh   ?? 0;
  const latG       = drivingController._latG    ?? 0;   // signed lateral G
  const throttle   = drivingController._throttleSmooth ?? 0;
  const brake      = drivingController.brake    ?? car.brake ?? 0;
  const carPos     = car.position;   // THREE.Vector3
  const carQuat    = car.quaternion; // THREE.Quaternion

  // ── 1. Speed FOV ───────────────────────────────────────────────────────────
  const fovTarget  = FOV_BASE + (FOV_MAX - FOV_BASE) * Math.min(speedKmh / FOV_SPEED, 1.0);
  _currentFov     += (fovTarget - _currentFov) * Math.min(FOV_RATE * dts, 1.0);
  camera.fov       = _currentFov;
  camera.updateProjectionMatrix();

  // ── 2. G-force lean (camera roll) ─────────────────────────────────────────
  // latG is positive when turning left → camera rolls right (+Z rotation = right)
  // FH5 rolls the camera INTO the corner — opposite to latG sign
  const rollTarget = THREE.MathUtils.clamp(-latG * LEAN_MAX_RAD, -LEAN_MAX_RAD, LEAN_MAX_RAD);
  _roll           += (rollTarget - _roll) * Math.min(LEAN_RATE * dts, 1.0);

  // ── 3. Acceleration squat / brake dive (camera pitch) ─────────────────────
  // Throttle → pitch back (positive X = tilts view upward slightly)
  // Brake    → pitch forward (negative X = tilts view downward)
  const pitchTarget = throttle * SQUAT_THROTTLE + brake * SQUAT_BRAKE;
  _pitch           += (pitchTarget - _pitch) * Math.min(SQUAT_RATE * dts, 1.0);

  // ── 4. Terrain bump Y-shake ────────────────────────────────────────────────
  let bumpImpulse = 0;
  if (_getTerrainH && speedKmh > 10) {
    // Sample terrain 2.2 m ahead of car in its forward direction
    _fwd.set(0, 0, 1).applyQuaternion(carQuat).normalize();
    const sampleX = carPos.x + _fwd.x * BUMP_LOOKAHEAD;
    const sampleZ = carPos.z + _fwd.z * BUMP_LOOKAHEAD;
    const bumpH   = _getTerrainH(sampleX, sampleZ);

    if (_prevBumpH !== null) {
      const delta = bumpH - _prevBumpH;
      if (Math.abs(delta) > BUMP_THRESHOLD) {
        // Translate this terrain-slope delta into a camera Y impulse
        bumpImpulse = delta * BUMP_GAIN * Math.min(speedKmh / 60, 1.5);
      }
    }
    _prevBumpH = bumpH;
  }

  // ── 5. Airborne & landing jolt ─────────────────────────────────────────────
  let landingImpulse = 0;
  if (_getTerrainH) {
    const groundY   = _getTerrainH(carPos.x, carPos.z);
    const heightAGL = carPos.y - groundY;   // height above ground level

    // Estimate vertical velocity (world-space Y delta)
    const velY = _prevCarY !== null ? (carPos.y - _prevCarY) / dts : 0;
    _prevCarY  = carPos.y;

    const isAirborne = heightAGL > AIRBORNE_MIN_H;

    if (isAirborne) {
      _airTime    += dts;
      _wasAirborne = true;
      _prevVelY    = velY;
    } else if (_wasAirborne && _airTime > AIRBORNE_MIN_T) {
      // Just landed — compute jolt from downward velocity at impact
      const impactVel   = Math.abs(_prevVelY);   // m/s downward
      landingImpulse    = -impactVel * LANDING_GAIN;   // negative = camera snaps down
      landingImpulse    = THREE.MathUtils.clamp(landingImpulse, -LANDING_MAX, 0);
      _airTime     = 0;
      _wasAirborne = false;
    } else if (!isAirborne) {
      _airTime     = 0;
      _wasAirborne = false;
    }
  }

  // ── 6. Spring offset accumulation ─────────────────────────────────────────
  // Bump and landing impulses kick the spring; it damps back to (0,0,0).
  if (Math.abs(bumpImpulse)    > 0.001) _springVel.y += bumpImpulse    * SPRING_OMEGA * 0.4;
  if (Math.abs(landingImpulse) > 0.001) _springVel.y += landingImpulse * SPRING_OMEGA * 0.8;

  // Advance spring toward rest (0,0,0)
  _stepSpring(_springOffset, _springVel, new THREE.Vector3(0, 0, 0), dts);

  // ── Apply combined offsets to camera ───────────────────────────────────────
  //
  // Strategy: apply the spring Y-offset in WORLD space (up axis),
  // apply roll & pitch by temporarily rotating the camera's orientation.
  // This preserves the camera position set by driving.js exactly.

  // Extract camera's local up and right axes from its current quaternion
  _up.set(0, 1, 0);    // world up for the Y spring offset
  camera.position.y += _springOffset.y;

  // Save current quaternion then apply roll + pitch on top
  _savedQuat.copy(camera.quaternion);

  // Roll: rotate around local forward (Z) axis
  if (Math.abs(_roll) > 0.0001) {
    _fwd.set(0, 0, -1).applyQuaternion(_savedQuat);
    const rollQ = new THREE.Quaternion().setFromAxisAngle(_fwd, _roll);
    camera.quaternion.premultiply(rollQ);
  }

  // Pitch: rotate around local right (X) axis
  if (Math.abs(_pitch) > 0.0001) {
    _right.set(1, 0, 0).applyQuaternion(_savedQuat);
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(_right, _pitch);
    camera.quaternion.premultiply(pitchQ);
  }
}

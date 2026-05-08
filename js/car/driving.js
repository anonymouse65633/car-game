/**
 * driving.js — Player Driving Controller
 * Part 2 / Car layer
 *
 * Responsibilities:
 *  - Reads inputState (from input.js) each physics tick
 *  - Translates throttle / brake / steer / handbrake into Rapier forces & torques
 *  - Lateral traction: tyre slip angle → sideways friction impulse per axle
 *  - Longitudinal traction: drive force from Transmission capped by grip
 *  - ABS: prevents wheel lock — modulates brake force when sliding
 *  - Stability Control (ESC): brakes individual wheels to fight severe yaw
 *  - Countersteer assist: adds corrective torque when rear slides
 *  - Steering assist: smooths steer angle, reduces speed-sensitivity
 *  - Handbrake: kills rear lateral grip instantly for drifting
 *  - Flip recovery: upright impulse if car rolls upside-down
 *  - Camera: chase / hood / cinematic modes with lag & speed-FOV
 *  - Manual shift: forwards E/Q keypresses to Transmission
 *  - Rewind: holds R to replay buffer from Car
 *  - Emits audio cues: rpm, squeal, scrape, impact, surface
 *
 * Exports:
 *  DrivingController                  — class
 *  createDrivingController(car, opts) — factory
 *
 * Dependencies:
 *  Three.js
 *  car.js   → Car (passed in)
 *  input.js → inputState (passed in each tick)
 *
 * No direct Rapier import — forces applied via car._body API.
 */

'use strict';

import * as THREE from 'three';

// ─── Tunable physics constants ────────────────────────────────────────────────

/** Maximum front-wheel steer angle at low speed (radians). */
const MAX_STEER_ANGLE   = 0.52;   // ~30°
/** Steer angle at 200 km/h (speed-sensitive reduction). */
const MIN_STEER_ANGLE   = 0.14;   // ~8°
/** Speed (m/s) at which steer reaches its minimum. */
const STEER_SPEED_FULL  = 55;
/** Input smoothing rate — higher = faster response. */
const STEER_SMOOTH_RATE = 8.0;
/** With steer assist on, additional smoothing multiplier. */
const ASSIST_SMOOTH_MULT = 0.55;

/** Lateral grip force scale (N per m/s of slip). */
const LATERAL_STIFFNESS_FRONT = 38000;
const LATERAL_STIFFNESS_REAR  = 34000;
/** Maximum lateral slip velocity before tyre saturates (m/s). */
const SLIP_SAT_FRONT    = 5.5;
const SLIP_SAT_REAR     = 4.5;

/** Handbrake rear-grip scalar (0 = instant lock, 0.3 = partial). */
const HANDBRAKE_REAR_GRIP = 0.08;
/** Countersteer assist torque gain. */
const COUNTER_TORQUE    = 4800;
/** ESC yaw-rate error threshold before stability fires (rad/s). */
const ESC_YAW_THRESH    = 0.55;
/** ESC brake torque per wheel when correcting (N·m equivalent). */
const ESC_BRAKE_FORCE   = 3200;

/** Flip detection: pitch below this dot product triggers recovery impulse. */
const FLIP_UP_DOT       = -0.4;
/** Upright recovery impulse (N). */
const FLIP_IMPULSE      = 9000;

// ─── Camera constants ─────────────────────────────────────────────────────────

const CAM_CHASE_DIST    = 7.5;   // metres behind car
const CAM_CHASE_HEIGHT  = 2.8;   // metres above car
const CAM_LAG           = 0.08;  // position lerp factor (lower = more lag)
const CAM_ROT_LAG       = 0.12;  // rotation lerp factor
const CAM_FOV_BASE      = 68;    // degrees at 0 km/h
const CAM_FOV_MAX       = 85;    // degrees at top speed
const CAM_FOV_SPEED     = 200;   // km/h that reaches max FOV
const CAM_HOOD_OFFSET   = new THREE.Vector3(0, 0.55, 1.1); // local to car
const CAM_LOOKBACK_DIST = 10;    // chase distance when looking back

const CAM_MODE_CHASE     = 'chase';
const CAM_MODE_HOOD      = 'hood';
const CAM_MODE_CINEMATIC = 'cinematic';

// ─── Audio event names ────────────────────────────────────────────────────────

const SFX_SQUEAL  = 'tyre_squeal';
const SFX_SCRAPE  = 'scrape';
const SFX_IMPACT  = 'impact';
const SFX_GRAVEL  = 'gravel';
const SFX_HORN    = 'horn';

// ─── Helper math ──────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t)    { return a + (b - a) * t; }
function sign(v)           { return v < 0 ? -1 : v > 0 ? 1 : 0; }

/**
 * Compute a normalised slip-based lateral force using a simplified Pacejka-ish
 * brush model: linear up to saturation, then constant.
 *
 * @param {number} slipVel   — lateral velocity at axle contact patch (m/s)
 * @param {number} stiffness — tyre cornering stiffness (N / (m/s))
 * @param {number} satVel    — saturation velocity (m/s)
 * @param {number} grip      — 0–1 grip multiplier from suspension
 * @param {number} load      — normal force (N) — scales peak force
 * @returns {number}         — lateral force (N), signed
 */
function lateralForce(slipVel, stiffness, satVel, grip, load) {
  const sat  = Math.max(0.1, satVel * grip);
  const raw  = stiffness * grip * slipVel;
  const peak = load * grip * 1.1; // friction circle limit
  return clamp(raw, -peak, peak) * Math.min(1, sat / Math.max(sat, Math.abs(slipVel)));
}

// ─── DrivingController ────────────────────────────────────────────────────────

export class DrivingController {

  /**
   * @param {Car}    car     — Car instance (from car.js)
   * @param {object} opts
   *   camera      {THREE.PerspectiveCamera}
   *   audioManager {object}  — { play(name, vol), setParam(name, val) }
   *   scene       {THREE.Scene}   — for cinematic camera rig
   */
  constructor(car, opts = {}) {
    this.car    = car;
    this._cam   = opts.camera       ?? null;
    this._audio = opts.audioManager ?? null;
    this._scene = opts.scene        ?? null;

    // ── Input smoothing state ──────────────────────────────────────────────
    /** Smoothed steer input −1…+1 */
    this._steerSmooth  = 0;
    /** Smoothed throttle 0…1 */
    this._throttleSmooth = 0;
    /** Previous raw steer for rate limiting */
    this._steerPrev    = 0;

    // ── Assist state ───────────────────────────────────────────────────────
    /** Estimated yaw rate from last two frames (rad/s) */
    this._yawRate       = 0;
    this._headingPrev   = 0;
    /** Target yaw rate (from steering angle + speed) */
    this._yawRateTarget = 0;
    /** ABS active flag */
    this._absActive     = false;
    /** ESC active flag */
    this._escActive     = false;
    /** Last known lateral G (for countersteer) */
    this._latG          = 0;

    // ── Camera state ───────────────────────────────────────────────────────
    this._camMode       = CAM_MODE_CHASE;
    this._camPos        = new THREE.Vector3();
    this._camTarget     = new THREE.Vector3();
    this._camQuat       = new THREE.Quaternion();
    this._camFov        = CAM_FOV_BASE;
    this._cinematicAngle = 0;  // rotating angle for cinematic
    this._lookingBack   = false;

    // ── Rewind state ───────────────────────────────────────────────────────
    this._rewindHeld    = false;
    this._rewindArmed   = false;

    // ── Audio state ────────────────────────────────────────────────────────
    this._squealActive  = false;
    this._scrapeActive  = false;
    this._lastSurface   = 'tarmac';
    this._hornPlaying   = false;

    // ── Misc ───────────────────────────────────────────────────────────────
    /** Surface type detected this frame (from suspension contact normal) */
    this.surfaceType    = 'tarmac';
    /** Accumulated impact energy for feedback (cleared each frame) */
    this._impactEnergy  = 0;
    /** Flip recovery cooldown (s) */
    this._flipCooldown  = 0;

    // ── Camera initial position behind car ────────────────────────────────
    if (this._cam) {
      this._cam.fov = CAM_FOV_BASE;
      this._cam.updateProjectionMatrix();
    }
  }

  // ─── Main per-frame entry point ───────────────────────────────────────────

  /**
   * Call once per physics step from loop.js.
   *
   * @param {number} dt          — seconds since last step
   * @param {object} rawInput    — from input.js getInput()
   *   { throttle, brake, steerAxis, handbrake,
   *     shiftUp, shiftDown, rewind,
   *     cameraToggle, lookBack, horn, exitCar, map, pause }
   * @param {RAPIER.World} world — physics world for raycasts
   */
  update(dt, rawInput, world) {
    const car  = this.car;
    const body = car._body;
    if (!body) return;

    // ── 1. Process input ──────────────────────────────────────────────────
    const input = this._processInput(dt, rawInput);

    // ── 2. Manual shift ───────────────────────────────────────────────────
    if (!car.assists.autoShift) {
      if (input.shiftUp)   car.transmission.shiftUp();
      if (input.shiftDown) car.transmission.shiftDown();
    }

    // ── 3. Rewind ─────────────────────────────────────────────────────────
    this._handleRewind(dt, input.rewind);
    if (car._rewindMode) {
      this._updateCamera(dt, rawInput);
      return; // skip physics during rewind
    }

    // ── 4. Surface detection ──────────────────────────────────────────────
    this._detectSurface(world);

    // ── 5. Per-axle lateral grip forces ──────────────────────────────────
    this._applyLateralForces(dt, input, body);

    // ── 6. Drive forces (from Transmission) ──────────────────────────────
    this._applyDriveForces(dt, input, body);

    // ── 7. Braking ────────────────────────────────────────────────────────
    this._applyBraking(dt, input, body);

    // ── 8. Steering torque ────────────────────────────────────────────────
    this._applySteeringTorque(dt, input, body);

    // ── 9. Stability control & countersteer ──────────────────────────────
    this._applyESC(dt, input, body);
    this._applyCountersteer(dt, input, body);

    // ── 10. Flip recovery ─────────────────────────────────────────────────
    this._applyFlipRecovery(dt, body);

    // ── 11. Forward to Car.update (mesh sync, suspension, transmission) ──
    car.update(dt, {
      throttle:    input.throttle,
      brake:       input.brake,
      steer:       this._steerSmooth,
      handbrake:   input.handbrake,
      surfaceType: this.surfaceType,
    }, world);

    // ── 12. Camera ────────────────────────────────────────────────────────
    this._updateCamera(dt, rawInput);

    // ── 13. Audio ─────────────────────────────────────────────────────────
    this._updateAudio(dt, input);

    // ── 14. Yaw rate estimate ─────────────────────────────────────────────
    this._yawRate   = (car.heading - this._headingPrev) / dt;
    this._headingPrev = car.heading;
  }

  // ─── Input Processing ─────────────────────────────────────────────────────

  /**
   * Smooth and clamp raw inputs, apply speed-sensitive steer reduction.
   * @param {number} dt
   * @param {object} raw
   * @returns {object} processed input
   */
  _processInput(dt, raw) {
    const car    = this.car;
    const assists = car.assists;

    // Steer: smooth + assist multiplier
    const smoothRate = STEER_SMOOTH_RATE * (assists.steeringAssist ? ASSIST_SMOOTH_MULT : 1.0);
    // inputState uses `steer` (not `steerAxis`) — read both for compatibility
    const rawSteer   = clamp(raw.steer ?? raw.steerAxis ?? 0, -1, 1);
    this._steerSmooth = lerp(this._steerSmooth, rawSteer, clamp(smoothRate * dt, 0, 1));

    // Speed-sensitive steer angle (less angle at high speed)
    const speedFrac = clamp(car.speedKmh / CAM_FOV_SPEED, 0, 1);
    const maxAngle  = lerp(MAX_STEER_ANGLE, MIN_STEER_ANGLE, speedFrac * speedFrac);
    const steerRad  = this._steerSmooth * maxAngle;

    // Throttle smoothing (lighter — keep responsiveness)
    const tSmooth = 6.0;
    this._throttleSmooth = lerp(
      this._throttleSmooth,
      clamp(raw.throttle ?? 0, 0, 1),
      clamp(tSmooth * dt, 0, 1),
    );

    return {
      throttle:   this._throttleSmooth,
      brake:      clamp(raw.brake ?? 0, 0, 1),
      steerRaw:   rawSteer,
      steerRad,              // wheel angle in radians
      handbrake:  !!raw.handbrake,
      shiftUp:    !!raw.shiftUp,
      shiftDown:  !!raw.shiftDown,
      rewind:     !!raw.rewind,
      horn:       !!raw.horn,
      exitCar:    !!raw.exitCar,
      lookBack:   !!raw.lookBack,
    };
  }

  // ─── Lateral Forces ───────────────────────────────────────────────────────

  /**
   * Compute and apply side-slip correcting impulses at front and rear axles.
   * This is the core of the tyre friction model.
   */
  _applyLateralForces(dt, input, body) {
    const car = this.car;
    if (car.isAirborne) return;

    const vel   = car.velocity;                  // world-space velocity
    const fwd   = this._carForward();            // world-space forward
    const right = this._carRight();              // world-space right
    const mass  = car.def.baseWeight ?? 1400;
    const speed = car.speedKmh;

    // Skip lateral forces at very low speed (avoids jitter)
    if (speed < 1.0) return;

    // ── Grip from suspension ──────────────────────────────────────────────
    const gripF = car.suspension?.getAxleLateralGrip?.('front') ?? 1.0;
    const gripR = car.suspension?.getAxleLateralGrip?.('rear')  ?? 1.0;

    // Handbrake kills rear grip
    const rearGripMult = input.handbrake ? HANDBRAKE_REAR_GRIP : 1.0;

    // ── Lateral velocity at each axle (decompose world vel onto right axis) ─
    const latVel = vel.dot(right);

    // Front axle: lateral vel + steering contribution
    //   The steered wheel's "desired" direction differs from car heading.
    const steerAngle  = input.steerRad;
    const frontSlipV  = latVel - Math.sin(steerAngle) * Math.abs(car.speedMs);

    // Rear axle: pure lateral slip
    const rearSlipV   = latVel;

    // ── Normal loads (static weight distribution) ─────────────────────────
    const grav        = mass * 9.81;
    const frontBias   = 0.48;  // 48 % front
    const loadF       = grav * frontBias;
    const loadR       = grav * (1 - frontBias);

    // ── Lateral forces ─────────────────────────────────────────────────────
    const Ff = lateralForce(frontSlipV, LATERAL_STIFFNESS_FRONT, SLIP_SAT_FRONT, gripF, loadF);
    const Fr = lateralForce(rearSlipV,  LATERAL_STIFFNESS_REAR,  SLIP_SAT_REAR,  gripR * rearGripMult, loadR);

    // ── Apply as impulses opposite to slip direction ───────────────────────
    //   We apply at body CoM for simplicity; yaw moment comes from offset below.
    const totalF = -(Ff + Fr);
    body.applyImpulse(
      { x: right.x * totalF * dt, y: 0, z: right.z * totalF * dt },
      true,
    );

    // ── Yaw moment from front vs rear force difference ─────────────────────
    //   Front force acts at wheelbase/2 ahead, rear force at wheelbase/2 behind.
    const wb      = (car.def.bodyLength ?? 4.4) * 0.45; // half-wheelbase
    const yawImp  = (Ff * wb - Fr * wb) * dt * 0.4;
    body.applyTorqueImpulse({ x: 0, y: -yawImp, z: 0 }, true);

    // Track lateral G for countersteer
    this._latG = (Ff + Fr) / (mass * 9.81);

    // ── Squeal detection ─────────────────────────────────────────────────
    const slipMag = Math.abs(frontSlipV) + Math.abs(rearSlipV);
    this._squealActive = slipMag > 2.5 && speed > 10;
  }

  // ─── Drive Forces ─────────────────────────────────────────────────────────

  _applyDriveForces(dt, input, body) {
    const car = this.car;
    if (car.isAirborne) return;

    const txOut = car._lastTxOut;
    if (!txOut) return;

    const fwd   = this._carForward();
    const speed = car.speedMs;

    // ── Reverse engagement ────────────────────────────────────────────────
    // If brake pressed while nearly still, engage reverse
    if (input.brake > 0.1 && Math.abs(speed) < 0.8 && car.transmission.gear >= 1) {
      car.transmission.engageReverse();
    }
    // If throttle pressed in reverse going forward — don't let it
    if (car.transmission.gear === -1 && speed > 0.5) {
      // Neutral until stopped
      car.transmission.engageNeutral();
    }

    // ── Apply front and rear drive impulses ──────────────────────────────
    const grip  = car.suspension
      ? (car.suspension.getAxleLongitudinalGrip?.('front') ?? 1.0) * 0.5
      + (car.suspension.getAxleLongitudinalGrip?.('rear')  ?? 1.0) * 0.5
      : 1.0;

    const maxForce = (car.def.baseWeight ?? 1400) * 9.81 * grip;
    const force    = clamp(txOut.driveForce, -maxForce, maxForce);

    body.applyImpulse(
      { x: fwd.x * force * dt, y: 0, z: fwd.z * force * dt },
      true,
    );

    // Engine brake
    if (txOut.engineBrake > 0 && !input.handbrake) {
      const dir    = speed > 0 ? -1 : 1;
      const ebForce = Math.min(txOut.engineBrake, 1800);
      body.applyImpulse(
        { x: fwd.x * dir * ebForce * dt, y: 0, z: fwd.z * dir * ebForce * dt },
        true,
      );
    }
  }

  // ─── Braking ──────────────────────────────────────────────────────────────

  _applyBraking(dt, input, body) {
    const car   = this.car;
    const speed = car.speedMs;
    if (Math.abs(speed) < 0.05 && input.brake > 0) return; // fully stopped

    const mass     = car.def.baseWeight ?? 1400;
    const fwd      = this._carForward();
    const brakeBias= 0.65; // front bias
    const maxBrakeF = mass * 9.81 * 0.9; // peak decel ≈ 0.9 g total

    let brakeMag = input.brake * maxBrakeF;

    // ── ABS ───────────────────────────────────────────────────────────────
    if (car.assists.abs) {
      // Detect wheel lock: if speed is high but brake is heavy, reduce
      const lockRisk = input.brake > 0.6 && Math.abs(speed) * 3.6 > 20;
      if (lockRisk) {
        const gripL = car.suspension?.getAxleLongitudinalGrip?.('front') ?? 1.0;
        // ABS pulses brake at 20 Hz — model as linear reduction
        brakeMag *= clamp(0.4 + gripL * 0.6, 0.4, 1.0);
        this._absActive = true;
        car.absActive   = true;
      } else {
        this._absActive = false;
        car.absActive   = false;
      }
    }

    // Apply impulse opposing motion
    const dir = speed > 0 ? -1 : 1;
    body.applyImpulse(
      { x: fwd.x * dir * brakeMag * dt, y: 0, z: fwd.z * dir * brakeMag * dt },
      true,
    );
  }

  // ─── Steering Torque ──────────────────────────────────────────────────────

  /**
   * Apply a yaw torque so the car turns according to steer input.
   * This supplements the tyre lateral forces — gives snappy response at low speed.
   */
  _applySteeringTorque(dt, input, body) {
    const car   = this.car;
    const speed = car.speedKmh;
    if (speed < 2) return;

    // Torque magnitude falls off at high speed (tyres do the work there)
    const speedScale = clamp(1 - speed / 120, 0.05, 1.0);
    const mass       = car.def.baseWeight ?? 1400;
    const torque     = input.steerRad * mass * 4.5 * speedScale;

    body.applyTorqueImpulse({ x: 0, y: -torque * dt, z: 0 }, true);
  }

  // ─── Stability Control (ESC) ──────────────────────────────────────────────

  _applyESC(dt, input, body) {
    const car = this.car;
    if (!car.assists.stabilityCtrl) return;
    if (car.isAirborne) return;
    // Don't interfere while handbrake is held (drifting)
    if (input.handbrake) return;

    const speed = car.speedKmh;
    if (speed < 15) return;

    // Target yaw rate from Ackermann geometry
    const wb          = car.def.bodyLength ?? 4.4;
    const targetYaw   = (car.speedMs * Math.tan(input.steerRad)) / wb;
    const yawError    = this._yawRate - targetYaw;

    if (Math.abs(yawError) < ESC_YAW_THRESH) {
      this._escActive = false;
      car.tcActive    = false;
      return;
    }

    this._escActive = true;

    // Apply corrective yaw torque opposing the error
    const correction = -sign(yawError) * ESC_BRAKE_FORCE;
    body.applyTorqueImpulse({ x: 0, y: correction * dt, z: 0 }, true);

    // Also reduce throttle
    this._throttleSmooth *= 0.75;
  }

  // ─── Countersteer Assist ──────────────────────────────────────────────────

  _applyCountersteer(dt, input, body) {
    const car = this.car;
    if (!car.assists.counterSteer) return;
    if (car.isAirborne) return;

    const speed = car.speedKmh;
    if (speed < 20) return;

    // Detect oversteer: rear slides more than front
    const rearGrip  = car.suspension?.getAxleLateralGrip?.('rear') ?? 1.0;
    const oversteer = (1 - rearGrip) * Math.abs(this._latG);

    if (oversteer < 0.15) return;

    // Corrective yaw torque opposing the slide
    const corrDir = -sign(this._yawRate);
    const torque  = corrDir * COUNTER_TORQUE * oversteer * clamp(speed / 60, 0, 1);
    body.applyTorqueImpulse({ x: 0, y: torque * dt, z: 0 }, true);
  }

  // ─── Flip Recovery ────────────────────────────────────────────────────────

  _applyFlipRecovery(dt, body) {
    if (this._flipCooldown > 0) {
      this._flipCooldown -= dt;
      return;
    }

    // Car's world-up dot global-up
    const up     = new THREE.Vector3(0, 1, 0);
    const carUp  = new THREE.Vector3(0, 1, 0).applyQuaternion(this.car.quaternion);
    const dot    = carUp.dot(up);

    if (dot < FLIP_UP_DOT) {
      // Car is flipped — apply upright impulse at roof
      body.applyImpulse({ x: 0, y: FLIP_IMPULSE, z: 0 }, true);
      body.applyTorqueImpulse({ x: FLIP_IMPULSE * 0.3, y: 0, z: 0 }, true);
      this._flipCooldown = 2.5; // prevent repeated firing
    }
  }

  // ─── Surface Detection ────────────────────────────────────────────────────

  _detectSurface(world) {
    // Read surface from suspension contact normals if available
    const susp = this.car.suspension;
    if (!susp) return;

    // SuspensionSystem exposes surface type per wheel via getWheelVisual(i)
    const w0 = susp.getWheelVisual?.(2); // rear-left as representative
    this.surfaceType = w0?.surfaceType ?? 'tarmac';
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

  _updateCamera(dt, rawInput) {
    if (!this._cam) return;

    // Toggle camera mode
    if (rawInput.cameraToggle && !this._camTogglePrev) {
      this._cycleCamera();
    }
    this._camTogglePrev = rawInput.cameraToggle;

    this._lookingBack = !!rawInput.lookBack;

    switch (this._camMode) {
      case CAM_MODE_CHASE:     this._updateChaseCamera(dt);     break;
      case CAM_MODE_HOOD:      this._updateHoodCamera(dt);      break;
      case CAM_MODE_CINEMATIC: this._updateCinematicCamera(dt); break;
    }

    // Speed FOV
    const targetFov = lerp(CAM_FOV_BASE, CAM_FOV_MAX,
      clamp(this.car.speedKmh / CAM_FOV_SPEED, 0, 1));
    this._camFov = lerp(this._camFov, targetFov, 4 * dt);
    this._cam.fov = this._camFov;
    this._cam.updateProjectionMatrix();
  }

  _cycleCamera() {
    const modes = [CAM_MODE_CHASE, CAM_MODE_HOOD, CAM_MODE_CINEMATIC];
    const idx   = modes.indexOf(this._camMode);
    this._camMode = modes[(idx + 1) % modes.length];
  }

  _updateChaseCamera(dt) {
    const cam  = this._cam;
    const car  = this.car;
    const pos  = car.position;

    // Look-back reverses camera side
    const distMult = this._lookingBack ? -1 : 1;
    const dist     = this._lookingBack ? CAM_LOOKBACK_DIST : CAM_CHASE_DIST;

    // Desired camera position: behind and above car
    const fwd    = this._carForward().multiplyScalar(-distMult * dist);
    const target = pos.clone().add(new THREE.Vector3(0, CAM_CHASE_HEIGHT, 0)).add(fwd);

    // Lag
    if (this._camPos.lengthSq() === 0) this._camPos.copy(target);
    this._camPos.lerp(target, clamp(CAM_LAG * 60 * dt, 0.01, 1));

    cam.position.copy(this._camPos);

    // Look at point slightly ahead of car
    const lookAt = pos.clone().add(this._carForward().multiplyScalar(distMult * 3));
    lookAt.y += 0.5;

    if (this._camTarget.lengthSq() === 0) this._camTarget.copy(lookAt);
    this._camTarget.lerp(lookAt, clamp(CAM_ROT_LAG * 60 * dt, 0.01, 1));

    cam.lookAt(this._camTarget);

    // Camera shake on impact
    if (this._impactEnergy > 500) {
      const shake = Math.min(this._impactEnergy / 20000, 0.3);
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.y += (Math.random() - 0.5) * shake;
    }
    this._impactEnergy = 0;
  }

  _updateHoodCamera(dt) {
    const cam = this._cam;
    const car = this.car;

    // Hood mount point in world space
    const localOffset = CAM_HOOD_OFFSET.clone();
    localOffset.applyQuaternion(car.quaternion);
    const worldPos = car.position.clone().add(localOffset);

    cam.position.copy(worldPos);

    // Look forward along car's nose
    const lookAt = worldPos.clone().add(
      this._carForward().multiplyScalar(20),
    );
    cam.lookAt(lookAt);
  }

  _updateCinematicCamera(dt) {
    const cam   = this._cam;
    const car   = this.car;
    const pos   = car.position;

    this._cinematicAngle += dt * 0.3;
    const r   = 12;
    const cx  = pos.x + Math.cos(this._cinematicAngle) * r;
    const cz  = pos.z + Math.sin(this._cinematicAngle) * r;
    const cy  = pos.y + 4;

    cam.position.set(cx, cy, cz);
    cam.lookAt(pos.x, pos.y + 0.5, pos.z);
  }

  // ─── Rewind ───────────────────────────────────────────────────────────────

  _handleRewind(dt, rewindPressed) {
    const car = this.car;

    if (rewindPressed && !this._rewindHeld) {
      // Start rewind
      car.startRewind();
      this._rewindHeld  = true;
      this._rewindArmed = true;
    } else if (!rewindPressed && this._rewindHeld) {
      // Release — stop rewind and restore physics
      if (car._rewindMode) car.stopRewind();
      this._rewindHeld  = false;
      this._rewindArmed = false;
    }
  }

  // ─── Audio ────────────────────────────────────────────────────────────────

  _updateAudio(dt, input) {
    if (!this._audio) return;

    const car  = this.car;
    const tx   = car._lastTxOut ?? {};

    // Engine RPM → pitch param
    this._audio.setParam?.('engine_rpm',   tx.rpmNorm ?? 0);
    this._audio.setParam?.('engine_load',  input.throttle);
    this._audio.setParam?.('engine_boost', tx.boostLevel ?? 0);

    // Tyre squeal
    if (this._squealActive && !this._squealWas) {
      this._audio.play?.(SFX_SQUEAL, 0.6);
    } else if (!this._squealActive && this._squealWas) {
      this._audio.stop?.(SFX_SQUEAL);
    }
    this._squealWas = this._squealActive;

    // Gravel surface
    const onGravel = this.surfaceType !== 'tarmac' && car.speedKmh > 5;
    if (onGravel !== this._gravelWas) {
      onGravel
        ? this._audio.play?.(SFX_GRAVEL, 0.4)
        : this._audio.stop?.(SFX_GRAVEL);
      this._gravelWas = onGravel;
    }

    // Horn
    if (input.horn && !this._hornWas) {
      this._audio.play?.(SFX_HORN, 0.8);
    }
    this._hornWas = input.horn;
  }

  /** Called externally by collision callbacks (from physics.js). */
  onImpact(relativeSpeed) {
    this._impactEnergy = relativeSpeed * relativeSpeed * (this.car.def.baseWeight ?? 1400) * 0.5;
    if (this._audio && relativeSpeed > 3) {
      const vol = clamp(relativeSpeed / 30, 0.1, 1.0);
      this._audio.play?.(SFX_IMPACT, vol);
    }
  }

  // ─── Utility vectors ──────────────────────────────────────────────────────

  _carForward() {
    const q = this.car.quaternion;
    return new THREE.Vector3(
      2 * (q.x * q.z + q.w * q.y),
      2 * (q.y * q.z - q.w * q.x),
      1 - 2 * (q.x * q.x + q.y * q.y),
    ).normalize();
  }

  _carRight() {
    const q = this.car.quaternion;
    return new THREE.Vector3(
      1 - 2 * (q.y * q.y + q.z * q.z),
      2 * (q.x * q.y + q.w * q.z),
      2 * (q.x * q.z - q.w * q.y),
    ).normalize();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Switch camera mode directly. */
  setCameraMode(mode) {
    if ([CAM_MODE_CHASE, CAM_MODE_HOOD, CAM_MODE_CINEMATIC].includes(mode)) {
      this._camMode = mode;
    }
  }

  /** Current camera mode string. */
  getCameraMode() { return this._camMode; }

  /** True if stability control fired this frame. */
  get escActive()  { return this._escActive; }

  /** True if ABS fired this frame. */
  get absActive()  { return this._absActive; }

  /**
   * Debug state snapshot for HUD / dev overlay.
   */
  getDebugState() {
    return {
      steerSmooth:    this._steerSmooth.toFixed(3),
      yawRate:        this._yawRate.toFixed(3),
      latG:           this._latG.toFixed(3),
      escActive:      this._escActive,
      absActive:      this._absActive,
      surface:        this.surfaceType,
      cameraMode:     this._camMode,
      squeal:         this._squealActive,
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * @param {Car}    car
 * @param {object} opts  — { camera, audioManager, scene }
 * @returns {DrivingController}
 */
export function createDrivingController(car, opts = {}) {
  return new DrivingController(car, opts);
}

/**
 * transmission.js — Engine, Gearbox & Drivetrain
 * Part 2 / Car layer
 *
 * Responsibilities:
 *  - Engine torque curve (low/mid/high RPM characteristics per engine type)
 *  - Turbo model: lag accumulator, boost pressure, peak-RPM surge
 *  - Supercharger model: instant linear boost throughout RPM band
 *  - 6-speed gearbox: gear ratios + final drive, tunable per car
 *  - Auto-shift: upshift at 85% redline, downshift at 25% RPM band
 *  - Manual shift: shiftUp() / shiftDown() with clutch-kick timing
 *  - RPM limiter: hard cut at redline, soft bounce model
 *  - Drivetrain torque split: FWD / RWD / AWD with diff lock factor
 *  - Differential: open / street LSD / race LSD / drift lock models
 *  - Reverse gear with limited RPM
 *  - Output: drive force (N) per axle for driving.js
 *
 * Exports:
 *  Transmission                        — class, one instance per car
 *  createTransmission(carDef)          — factory helper
 *  ENGINE_PRESETS                      — named torque curve presets
 *  GEARBOX_PRESETS                     — stock/street/sport/race ratio sets
 *
 * Dependencies:
 *  None — pure math, no Three.js or Rapier.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const RPM_IDLE      = 800;
const RPM_STALL     = 400;
const RPM_REV_LIMIT = 200;    // RPM above which limiter fires hard cut (ms bounce)
const LIMITER_CUT_MS= 80;     // hard cut duration in milliseconds
const SHIFT_TIME_MS = 120;    // auto-shift time gap (prevents instant re-shift)
const MANUAL_CLUTCH_MS = 60;  // simulated clutch engagement time for manual shifts

// Turbo
const TURBO_SPOOL_RATE  = 1.8;  // boost units per second under full throttle
const TURBO_DECAY_RATE  = 2.5;  // boost units per second off throttle
const TURBO_LAG_RPM     = 2800; // RPM below which turbo doesn't spool
const TURBO_FULL_RPM    = 4500; // RPM at which turbo reaches max boost

// Supercharger
const SC_BOOST_RAMP_RPM = 1500; // SC starts adding boost above this RPM

// Drivetrain torque split presets
const DRIVETRAIN_SPLIT = Object.freeze({
  FWD: { front: 1.00, rear: 0.00 },
  RWD: { front: 0.00, rear: 1.00 },
  AWD: { front: 0.42, rear: 0.58 }, // slight rear bias like most AWD sports cars
});

// ─── Engine Presets ───────────────────────────────────────────────────────────

/**
 * Each preset defines a torque curve as an array of [rpm, torqueNm] knots.
 * Values are linearly interpolated between knots.
 * Presets cover the main engine character archetypes from Part 2.
 */
export const ENGINE_PRESETS = Object.freeze({

  // Inline 4 — city car, hot hatch
  i4_na: {
    label:    'Inline-4 NA',
    idleRpm:  900,
    redline:  7200,
    maxPower: 130,  // kW (reference only)
    curve: [
      [  800,  80], [ 1500, 110], [ 2500, 155], [ 3500, 175],
      [ 4500, 185], [ 5500, 178], [ 6500, 160], [ 7200, 130],
    ],
  },

  // Turbocharged Inline-4 — hot hatch / sports
  i4_turbo: {
    label:    'Inline-4 Turbo',
    idleRpm:  850,
    redline:  6800,
    maxPower: 210,
    curve: [
      [  800,  90], [ 1500, 130], [ 2200, 190], [ 3000, 290],
      [ 4000, 330], [ 5000, 320], [ 6000, 295], [ 6800, 250],
    ],
  },

  // V6 NA — daily sports, muscle lite
  v6_na: {
    label:    'V6 NA',
    idleRpm:  750,
    redline:  7000,
    maxPower: 220,
    curve: [
      [  750, 120], [ 1500, 175], [ 2500, 230], [ 3500, 265],
      [ 4500, 285], [ 5500, 275], [ 6500, 245], [ 7000, 205],
    ],
  },

  // V6 Twin-Turbo — sports car, GT
  v6_tt: {
    label:    'V6 Twin-Turbo',
    idleRpm:  750,
    redline:  6500,
    maxPower: 370,
    curve: [
      [  750, 140], [ 1500, 200], [ 2200, 330], [ 3000, 450],
      [ 4000, 480], [ 5000, 460], [ 6000, 400], [ 6500, 340],
    ],
  },

  // V8 NA — American muscle, classic
  v8_na: {
    label:    'V8 NA',
    idleRpm:  700,
    redline:  6500,
    maxPower: 310,
    curve: [
      [  700, 200], [ 1500, 320], [ 2500, 420], [ 3500, 490],
      [ 4500, 510], [ 5500, 480], [ 6000, 430], [ 6500, 370],
    ],
  },

  // V8 Supercharged — muscle, drag monster
  v8_sc: {
    label:    'V8 Supercharged',
    idleRpm:  700,
    redline:  6800,
    maxPower: 520,
    curve: [
      [  700, 250], [ 1500, 400], [ 2500, 550], [ 3500, 640],
      [ 4500, 680], [ 5500, 650], [ 6300, 590], [ 6800, 510],
    ],
  },

  // V10 NA — supercar, high-revving
  v10_na: {
    label:    'V10 NA',
    idleRpm:  800,
    redline:  8800,
    maxPower: 540,
    curve: [
      [  800, 180], [ 2000, 310], [ 3500, 430], [ 5000, 540],
      [ 6500, 580], [ 7500, 570], [ 8000, 530], [ 8800, 460],
    ],
  },

  // V12 NA — grand tourer, classic hypercar
  v12_na: {
    label:    'V12 NA',
    idleRpm:  700,
    redline:  8200,
    maxPower: 620,
    curve: [
      [  700, 300], [ 2000, 450], [ 3500, 580], [ 5000, 650],
      [ 6500, 680], [ 7500, 650], [ 8000, 600], [ 8200, 540],
    ],
  },

  // Inline-4 Electric-like (instant torque) — rally, hot hatch EV
  electric: {
    label:    'Electric Motor',
    idleRpm:  0,
    redline:  20000,
    maxPower: 450,
    curve: [
      [    0, 650], [ 2000, 650], [ 6000, 600], [10000, 480],
      [14000, 330], [18000, 200], [20000, 140],
    ],
  },

  // Flat-4 Turbo — rally / offroad
  flat4_turbo: {
    label:    'Flat-4 Turbo',
    idleRpm:  900,
    redline:  7000,
    maxPower: 280,
    curve: [
      [  900, 100], [ 1500, 160], [ 2500, 270], [ 3500, 350],
      [ 4500, 370], [ 5500, 340], [ 6500, 285], [ 7000, 240],
    ],
  },
});

// ─── Gearbox Presets ──────────────────────────────────────────────────────────

/**
 * Gear ratio arrays [1st … 6th] plus finalDrive.
 * Higher ratio = more torque multiplication, lower top speed per gear.
 */
export const GEARBOX_PRESETS = Object.freeze({
  stock: {
    label:  'Stock Gearbox',
    ratios: [3.82, 2.36, 1.68, 1.30, 1.00, 0.84],
    finalDrive: 3.73,
    shiftTimeMs: 180,
  },
  street: {
    label:  'Street Gearbox',
    ratios: [3.50, 2.18, 1.56, 1.18, 0.95, 0.80],
    finalDrive: 3.55,
    shiftTimeMs: 160,
  },
  sport: {
    label:  'Sport Gearbox',
    ratios: [3.20, 2.00, 1.48, 1.12, 0.92, 0.78],
    finalDrive: 3.42,
    shiftTimeMs: 130,
  },
  race: {
    label:  'Race Gearbox',
    ratios: [2.90, 1.95, 1.50, 1.22, 1.00, 0.85],
    finalDrive: 3.90,
    shiftTimeMs: 90,
  },
  drag: {
    label:  'Drag Gearbox',
    ratios: [2.66, 1.78, 1.30, 1.00, 0.82, 0.68],
    finalDrive: 4.30,
    shiftTimeMs: 70,
  },
});

// Reverse gear ratio (single value, all presets)
const REVERSE_RATIO = 3.20;

// ─── Transmission class ───────────────────────────────────────────────────────

export class Transmission {

  /**
   * @param {object} carDef — from carData.js
   *   Required fields:
   *     enginePreset   {string}  — key of ENGINE_PRESETS
   *     gearboxPreset  {string}  — key of GEARBOX_PRESETS
   *     drivetrain     {string}  — 'FWD' | 'RWD' | 'AWD'
   *     wheelRadius    {number}  — metres (default 0.32)
   *     mass           {number}  — kg (for inertia model)
   *   Optional:
   *     aspiration     {string}  — 'na' | 'turbo' | 'supercharger' | 'twin_turbo'
   *     turboBoost     {number}  — max boost multiplier (default 1.0)
   *     scBoost        {number}  — supercharger boost multiplier (default 1.0)
   *     diffType       {string}  — 'open' | 'street' | 'race' | 'drift'
   *     diffAccelLock  {number}  — 0–1 LSD lock on accel (default 0.25)
   *     diffDecelLock  {number}  — 0–1 LSD lock on decel (default 0.10)
   */
  constructor(carDef) {
    // ── Engine ──────────────────────────────────────────────────────────────
    const eng = ENGINE_PRESETS[carDef.enginePreset] ?? ENGINE_PRESETS.i4_na;
    this._curve    = eng.curve;
    this._idleRpm  = eng.idleRpm;
    this.redline   = eng.redline;

    // ── Gearbox ─────────────────────────────────────────────────────────────
    const gbx = GEARBOX_PRESETS[carDef.gearboxPreset ?? 'stock'];
    this._ratios      = [...gbx.ratios];
    this._finalDrive  = gbx.finalDrive;
    this._shiftTimeMs = gbx.shiftTimeMs;
    this.numGears     = this._ratios.length;

    // ── Live state ───────────────────────────────────────────────────────────
    /** Current gear: -1 = reverse, 0 = neutral, 1–6 = forward */
    this.gear         = 1;
    /** Current engine RPM */
    this.rpm          = this._idleRpm;
    /** Turbo boost level 0–1 */
    this.boostLevel   = 0;
    /** Whether the rev limiter is currently cutting */
    this.limiterActive= false;

    this._limiterTimer= 0;  // ms remaining in hard cut
    this._shiftTimer  = 0;  // ms cooldown after a shift
    this._clutchTimer = 0;  // ms of clutch engagement for manual shifts
    this._inClutch    = false;

    // ── Aspiration ──────────────────────────────────────────────────────────
    this._aspiration  = carDef.aspiration ?? 'na';
    this._turboBoost  = carDef.turboBoost ?? 1.0;   // max boost multiplier
    this._scBoost     = carDef.scBoost    ?? 1.0;

    // ── Drivetrain ──────────────────────────────────────────────────────────
    this._drivetrain  = carDef.drivetrain ?? 'RWD';
    this._split       = { ...(DRIVETRAIN_SPLIT[this._drivetrain] ?? DRIVETRAIN_SPLIT.RWD) };

    // ── Differential ────────────────────────────────────────────────────────
    this._diffType        = carDef.diffType      ?? 'street';
    this._diffAccelLock   = carDef.diffAccelLock ?? 0.25;
    this._diffDecelLock   = carDef.diffDecelLock ?? 0.10;

    // ── Physics ─────────────────────────────────────────────────────────────
    this._wheelRadius   = carDef.wheelRadius ?? 0.32;  // m
    this._mass          = carDef.mass        ?? 1400;  // kg
    // Effective engine inertia (makes RPM feel responsive but not instant)
    this._engineInertia = 0.25 + (this._mass / 12000); // kg·m²

    // ── Tunable gear ratios (applied from Tuning System) ────────────────────
    this._customRatios    = null; // null = use preset
    this._customFinal     = null;

    // ── Transmission efficiency ──────────────────────────────────────────────
    this._efficiency = 0.92; // drivetrain loss factor (8% loss by default)
  }

  // ─── Tuning API ─────────────────────────────────────────────────────────────

  /**
   * Apply gear ratio overrides from the Tuning System.
   * @param {number[]} ratios    — array of 6 floats
   * @param {number}   finalDrive
   */
  applyGearTuning(ratios, finalDrive) {
    if (Array.isArray(ratios) && ratios.length === this.numGears) {
      this._customRatios = [...ratios];
    }
    if (typeof finalDrive === 'number' && finalDrive > 0) {
      this._customFinal = finalDrive;
    }
  }

  /** Switch gearbox upgrade tier (street/sport/race/drag). */
  setGearboxPreset(key) {
    const gbx = GEARBOX_PRESETS[key];
    if (!gbx) return;
    this._ratios      = [...gbx.ratios];
    this._finalDrive  = gbx.finalDrive;
    this._shiftTimeMs = gbx.shiftTimeMs;
    this._customRatios = null;
    this._customFinal  = null;
  }

  /** Convert drivetrain type (AWD kit etc.) */
  setDrivetrain(type) {
    if (!DRIVETRAIN_SPLIT[type]) return;
    this._drivetrain = type;
    this._split      = { ...DRIVETRAIN_SPLIT[type] };
  }

  setDiff(type, accelLock, decelLock) {
    this._diffType      = type;
    if (accelLock != null) this._diffAccelLock = Math.max(0, Math.min(1, accelLock));
    if (decelLock != null) this._diffDecelLock = Math.max(0, Math.min(1, decelLock));
  }

  setBoostPressure(turbo, sc) {
    if (turbo != null) this._turboBoost = Math.max(1.0, turbo);
    if (sc    != null) this._scBoost    = Math.max(1.0, sc);
  }

  // ─── Main Update ────────────────────────────────────────────────────────────

  /**
   * Advance transmission state one physics step.
   *
   * @param {number} dt           — fixed step (seconds)
   * @param {number} throttle     — 0–1 throttle input
   * @param {number} brake        — 0–1 brake input
   * @param {number} speedMs      — current vehicle speed in m/s (scalar, always ≥0)
   * @param {boolean} isManual    — manual shift mode?
   * @param {boolean} handbrake   — handbrake engaged?
   *
   * @returns {TransmissionOutput}
   */
  update(dt, throttle, brake, speedMs, isManual = false, handbrake = false) {
    const dtMs = dt * 1000;

    // ── Limiter countdown ──────────────────────────────────────────────────
    if (this._limiterTimer > 0) {
      this._limiterTimer -= dtMs;
      if (this._limiterTimer <= 0) {
        this._limiterTimer  = 0;
        this.limiterActive  = false;
      }
    }

    // ── Shift cooldown ─────────────────────────────────────────────────────
    if (this._shiftTimer > 0) this._shiftTimer = Math.max(0, this._shiftTimer - dtMs);

    // ── Clutch (manual) ────────────────────────────────────────────────────
    if (this._clutchTimer > 0) {
      this._clutchTimer -= dtMs;
      if (this._clutchTimer <= 0) {
        this._clutchTimer = 0;
        this._inClutch    = false;
      }
    }
    const clutchFactor = this._inClutch
      ? Math.max(0, this._clutchTimer / MANUAL_CLUTCH_MS)
      : 1.0;

    // ── Auto-shift ────────────────────────────────────────────────────────
    if (!isManual && this.gear > 0 && this._shiftTimer <= 0) {
      this._autoShift(speedMs, throttle);
    }

    // ── Compute wheel RPM from speed ──────────────────────────────────────
    const ratio     = this._getEffectiveRatio();
    const wheelRpm  = (speedMs / (2 * Math.PI * this._wheelRadius)) * 60;
    const engineRpmFromSpeed = wheelRpm * Math.abs(ratio);

    // ── RPM model ─────────────────────────────────────────────────────────
    let targetRpm;
    if (this.gear === 0) {
      // Neutral — RPM follows throttle freely
      targetRpm = this._idleRpm + throttle * (this.redline * 0.7 - this._idleRpm);
    } else if (Math.abs(speedMs) < 0.5 && this.gear > 0) {
      // Standing start — blip RPM with throttle
      targetRpm = this._idleRpm + throttle * (this.redline * 0.4 - this._idleRpm);
    } else {
      targetRpm = Math.max(this._idleRpm, engineRpmFromSpeed);
    }

    // Smooth RPM towards target (engine inertia)
    const rpmDelta = (targetRpm - this.rpm) / this._engineInertia;
    this.rpm += rpmDelta * dt * 8;
    this.rpm  = Math.max(RPM_STALL, this.rpm);

    // ── Rev limiter ───────────────────────────────────────────────────────
    const limitRpm = this.redline + RPM_REV_LIMIT;
    if (this.rpm >= limitRpm && !this.limiterActive) {
      this.limiterActive  = true;
      this._limiterTimer  = LIMITER_CUT_MS;
      this.rpm            = this.redline; // snap back
    }
    const throttleEff = this.limiterActive ? 0 : throttle * clutchFactor;

    // ── Aspiration / boost ────────────────────────────────────────────────
    const boostMult = this._computeBoost(throttleEff, dt);

    // ── Engine torque from curve ──────────────────────────────────────────
    const rawTorque  = this._sampleCurve(this.rpm);
    const grossTorque = rawTorque * boostMult * throttleEff;

    // ── Wheel torque ──────────────────────────────────────────────────────
    const wheelTorque = grossTorque * Math.abs(ratio) * this._efficiency;

    // ── Drive force at wheels (N) ─────────────────────────────────────────
    // F = torque / wheel_radius
    const driveForce = (this.gear === 0) ? 0
                     : wheelTorque / this._wheelRadius;

    // ── Split to axles via drivetrain ─────────────────────────────────────
    const isAccel   = driveForce > 0;
    const lockFactor = isAccel ? this._diffAccelLock : this._diffDecelLock;
    const { frontForce, rearForce } = this._splitTorque(driveForce, lockFactor);

    // ── Engine braking (off-throttle deceleration) ────────────────────────
    const engineBrake = this.gear !== 0
      ? this._computeEngineBrake(throttleEff, speedMs, ratio)
      : 0;

    // ── Reverse logic ─────────────────────────────────────────────────────
    const dirMult = this.gear === -1 ? -1 : 1;

    return {
      rpm:          this.rpm,
      gear:         this.gear,
      boostLevel:   this.boostLevel,
      grossTorque:  grossTorque,
      driveForce:   driveForce * dirMult,
      frontForce:   frontForce * dirMult,
      rearForce:    rearForce  * dirMult,
      engineBrake:  engineBrake,
      limiterActive:this.limiterActive,
      clutchSlip:   1 - clutchFactor,
      // Used by audio.js
      rpmNorm:      Math.min(1, this.rpm / this.redline),
      throttleEff,
    };
  }

  // ─── Manual Shift API ────────────────────────────────────────────────────────

  /** Shift up one gear. Returns true if shift occurred. */
  shiftUp() {
    if (this._shiftTimer > 0) return false;
    if (this.gear === -1) {
      this.gear = 0;
    } else if (this.gear < this.numGears) {
      this.gear++;
    } else {
      return false;
    }
    this._triggerShift();
    return true;
  }

  /** Shift down one gear. Returns true if shift occurred. */
  shiftDown() {
    if (this._shiftTimer > 0) return false;
    if (this.gear === 1) {
      return false; // don't auto-engage reverse from 1st
    } else if (this.gear === 0) {
      this.gear = -1;
    } else if (this.gear > 1) {
      this.gear--;
    }
    this._triggerShift();
    return true;
  }

  /** Engage reverse directly (e.g. when player presses brake from standstill). */
  engageReverse() {
    if (this.gear !== 0 && this.gear !== 1) return;
    this.gear = -1;
    this._triggerShift();
  }

  /** Engage neutral. */
  engageNeutral() {
    this.gear = 0;
    this._triggerShift();
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /** Gear label string for HUD display. */
  getGearLabel() {
    if (this.gear === -1) return 'R';
    if (this.gear ===  0) return 'N';
    return String(this.gear);
  }

  /** RPM as 0–1 fraction of redline. */
  getRpmNorm() {
    return Math.min(1, Math.max(0, this.rpm / this.redline));
  }

  /** Boost pressure as 0–1. */
  getBoostNorm() {
    return this.boostLevel;
  }

  /** Theoretical top speed in km/h for current gear ratios. */
  getTopSpeed() {
    const ratio = this._ratios[this.numGears - 1] * this._getFinalDrive();
    const wheelRpm = this.redline / ratio;
    const speedMs  = (wheelRpm / 60) * 2 * Math.PI * this._wheelRadius;
    return speedMs * 3.6;
  }

  /**
   * Predict speed (km/h) at redline for a given gear (1-indexed).
   * @param  {number} gearNum
   * @returns {number}
   */
  getGearTopSpeed(gearNum) {
    const idx = Math.max(0, Math.min(this.numGears - 1, gearNum - 1));
    const ratio = (this._customRatios?.[idx] ?? this._ratios[idx]) * this._getFinalDrive();
    const wheelRpm = this.redline / ratio;
    return ((wheelRpm / 60) * 2 * Math.PI * this._wheelRadius) * 3.6;
  }

  /** Debug snapshot for HUD overlay. */
  getDebugState() {
    return {
      gear:          this.getGearLabel(),
      rpm:           Math.round(this.rpm),
      redline:       this.redline,
      rpmNorm:       this.getRpmNorm().toFixed(2),
      boost:         this.boostLevel.toFixed(2),
      limiter:       this.limiterActive,
      drivetrain:    this._drivetrain,
      diff:          this._diffType,
      aspiration:    this._aspiration,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _getEffectiveRatio() {
    if (this.gear === -1) return -REVERSE_RATIO * this._getFinalDrive();
    if (this.gear === 0)  return 0;
    const idx = this.gear - 1;
    return (this._customRatios?.[idx] ?? this._ratios[idx]) * this._getFinalDrive();
  }

  _getFinalDrive() {
    return this._customFinal ?? this._finalDrive;
  }

  _autoShift(speedMs, throttle) {
    if (speedMs < 0.3) return;
    const upThreshold   = this.redline * 0.85;
    const downThreshold = this.redline * 0.25;

    if (this.rpm > upThreshold && this.gear < this.numGears) {
      this.gear++;
      this._triggerShift();
    } else if (this.rpm < downThreshold && this.gear > 1) {
      // Only downshift if it won't over-rev
      const nextRatio = this._ratios[this.gear - 2] * this._getFinalDrive();
      const wheelRpm  = (speedMs / (2 * Math.PI * this._wheelRadius)) * 60;
      const nextRpm   = wheelRpm * nextRatio;
      if (nextRpm < this.redline * 0.90) {
        this.gear--;
        this._triggerShift();
      }
    }

    // Auto reverse from standstill
    if (speedMs < 0.3 && this.gear === 1 && throttle === 0) {
      // Stay in 1st — driving.js handles reverse input
    }
  }

  _triggerShift() {
    this._shiftTimer  = this._shiftTimeMs;
    this._inClutch    = true;
    this._clutchTimer = MANUAL_CLUTCH_MS;
  }

  /**
   * Sample the torque curve at a given RPM via linear interpolation.
   * @param  {number} rpm
   * @returns {number} torque in N·m
   */
  _sampleCurve(rpm) {
    const curve = this._curve;
    if (rpm <= curve[0][0])                  return curve[0][1];
    if (rpm >= curve[curve.length - 1][0])   return curve[curve.length - 1][1];

    for (let i = 0; i < curve.length - 1; i++) {
      const [r0, t0] = curve[i];
      const [r1, t1] = curve[i + 1];
      if (rpm >= r0 && rpm <= r1) {
        const t = (rpm - r0) / (r1 - r0);
        return t0 + (t1 - t0) * t;
      }
    }
    return curve[curve.length - 1][1];
  }

  /**
   * Compute boost multiplier for turbo / supercharger aspiration.
   * Updates this.boostLevel as a side effect.
   * @returns {number} torque multiplier (1.0 = no boost)
   */
  _computeBoost(throttle, dt) {
    const asp = this._aspiration;

    if (asp === 'na') {
      this.boostLevel = 0;
      return 1.0;
    }

    if (asp === 'turbo' || asp === 'twin_turbo') {
      const twinMult = asp === 'twin_turbo' ? 1.35 : 1.0;
      // Spool only above lag RPM, proportional to RPM and throttle
      const rpmFactor   = Math.max(0,
        Math.min(1, (this.rpm - TURBO_LAG_RPM) / (TURBO_FULL_RPM - TURBO_LAG_RPM)));
      const spoolTarget = rpmFactor * throttle;
      const spoolRate   = throttle > 0.05 ? TURBO_SPOOL_RATE : -TURBO_DECAY_RATE;
      this.boostLevel   = Math.max(0, Math.min(1,
        this.boostLevel + spoolRate * dt * (spoolTarget - this.boostLevel + 0.01)));
      return 1.0 + this.boostLevel * (this._turboBoost - 1.0) * twinMult;
    }

    if (asp === 'supercharger') {
      // Instant boost, proportional to RPM above threshold
      const rpmFactor   = Math.max(0,
        Math.min(1, (this.rpm - SC_BOOST_RAMP_RPM) / (this.redline - SC_BOOST_RAMP_RPM)));
      this.boostLevel   = rpmFactor * throttle;
      return 1.0 + this.boostLevel * (this._scBoost - 1.0);
    }

    return 1.0;
  }

  /**
   * Compute engine braking force (resists motion off-throttle).
   * Returns force magnitude in N (always positive — driving.js applies direction).
   */
  _computeEngineBrake(throttle, speedMs, ratio) {
    if (Math.abs(speedMs) < 0.2) return 0;
    if (throttle > 0.08) return 0;

    // Higher gear ratio = more engine braking
    const baseBrake = 400 + Math.abs(ratio) * 120;
    // Fade off as throttle is applied
    return baseBrake * (1 - throttle / 0.08);
  }

  /**
   * Split total drive force to front / rear axles.
   * LSD lock reduces the disparity when one axle spins.
   */
  _splitTorque(totalForce, lockFactor) {
    const frontRatio = this._split.front;
    const rearRatio  = this._split.rear;

    // Base split
    let frontForce = totalForce * frontRatio;
    let rearForce  = totalForce * rearRatio;

    // Diff type modifiers
    if (this._diffType === 'drift') {
      // Drift diff locks rear hard on throttle
      rearForce  = totalForce * 1.0;
      frontForce = 0;
    } else if (this._diffType === 'race' || this._diffType === 'street') {
      // LSD: blend towards equal split under lock
      const equalForce = totalForce * 0.5;
      frontForce = frontForce + (equalForce - frontForce) * lockFactor * frontRatio * 2;
      rearForce  = rearForce  + (equalForce - rearForce)  * lockFactor * rearRatio  * 2;
    }

    return { frontForce, rearForce };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a Transmission for a car definition.
 * @param  {object} carDef
 * @returns {Transmission}
 */
export function createTransmission(carDef) {
  return new Transmission(carDef);
}

/**
 * @typedef {object} TransmissionOutput
 * @property {number}  rpm            — current engine RPM
 * @property {number}  gear           — current gear (-1/0/1–6)
 * @property {number}  boostLevel     — 0–1 turbo/SC boost
 * @property {number}  grossTorque    — N·m at engine output shaft
 * @property {number}  driveForce     — total drive force at all wheels (N)
 * @property {number}  frontForce     — front axle drive force (N)
 * @property {number}  rearForce      — rear axle drive force (N)
 * @property {number}  engineBrake    — engine braking force magnitude (N)
 * @property {boolean} limiterActive  — is rev limiter currently cutting?
 * @property {number}  clutchSlip     — 0=engaged, 1=fully slipping
 * @property {number}  rpmNorm        — 0–1 RPM fraction of redline (for audio)
 * @property {number}  throttleEff    — effective throttle after limiter/clutch
 */
/**
 * car.js — Car Class
 * Part 2 / Car layer
 *
 * Responsibilities:
 *  - Owns the Rapier rigid body (compound collider: chassis box + 4 wheel spheres)
 *  - Owns the Three.js mesh group (body, wheels, lights, shadow catcher)
 *  - Holds live driving state: speed, heading, gear, rpm, grounded, airborne
 *  - Computes Performance Rating (PR) from base stats + equipped parts
 *  - Applies visual customization: paint colour, body kit swaps, wheel meshes
 *  - Manages light state: headlights, brake lights, reverse light, blinkers
 *  - Tracks dirty-state / dirt overlay as car leaves tarmac
 *  - Provides rewind buffer: stores last 10 s of state snapshots at 10 Hz
 *  - Exposes simple API consumed by driving.js, npc.js, and the HUD
 *
 * Exports:
 *  Car                          — class, one instance per vehicle in scene
 *  createCar(carDef, opts)      — factory: builds body + mesh, returns Car
 *  CAR_CLASS_THRESHOLDS         — PR → class letter map
 *  computePR(carDef, parts)     — pure function for shop preview
 *
 * Dependencies:
 *  Three.js   (scene graph, materials, lights)
 *  Rapier     (rigid body, collider, forces)
 *  suspension.js → SuspensionSystem
 *  transmission.js → Transmission, createTransmission
 *  carData.js  (imported by caller — passed in as carDef)
 */

'use strict';

import * as THREE from 'three';
import { SuspensionSystem }         from './suspension.js';
import { Transmission, createTransmission } from './Transmission.js';

// ─── PR / Class System ────────────────────────────────────────────────────────

export const CAR_CLASS_THRESHOLDS = Object.freeze([
  { cls: 'D',  min:   0, max: 299 },
  { cls: 'C',  min: 300, max: 449 },
  { cls: 'B',  min: 450, max: 599 },
  { cls: 'A',  min: 600, max: 699 },
  { cls: 'S1', min: 700, max: 799 },
  { cls: 'S2', min: 800, max: 999 },
]);

/**
 * Pure PR formula — used in shops for live preview without a Car instance.
 * Mirrors the live Car.pr getter but is side-effect free.
 *
 * @param {object} carDef — base car definition from carData.js
 * @param {object} parts  — map of partSlot → partDef from partsShop
 * @returns {number}
 */
export function computePR(carDef, parts = {}) {
  let power   = carDef.basePower   ?? 100;  // kW
  let weight  = carDef.baseWeight  ?? 1400; // kg
  let grip    = carDef.baseGrip    ?? 50;   // 0–100 arbitrary
  let aero    = carDef.baseAero    ?? 0;    // downforce score 0–100
  let brakes  = carDef.baseBrakes  ?? 50;

  for (const part of Object.values(parts)) {
    if (!part) continue;
    power   += part.powerBonus   ?? 0;
    weight  += part.weightDelta  ?? 0;
    grip    += part.gripBonus    ?? 0;
    aero    += part.aeroBonus    ?? 0;
    brakes  += part.brakeBonus   ?? 0;
  }

  // Simplified Forza-style PR formula
  const powerScore   = Math.min(100, (power  / 700) * 100);
  const weightScore  = Math.min(100, Math.max(0, (2000 - weight) / 18));
  const gripScore    = Math.min(100, grip);
  const aeroScore    = Math.min(100, aero);
  const brakeScore   = Math.min(100, brakes);

  const raw = powerScore * 4.0
            + weightScore * 2.0
            + gripScore   * 1.5
            + aeroScore   * 1.5
            + brakeScore  * 1.0;

  return Math.round(Math.min(999, Math.max(100, raw)));
}

/** Map PR number to class letter. */
export function prToClass(pr) {
  for (const band of CAR_CLASS_THRESHOLDS) {
    if (pr >= band.min && pr <= band.max) return band.cls;
  }
  return 'S2';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REWIND_HZ      = 10;               // snapshots per second
const REWIND_SECS    = 10;              // maximum rewind duration
const REWIND_FRAMES  = REWIND_HZ * REWIND_SECS; // 100 frames
const REWIND_INTERVAL = 1 / REWIND_HZ;  // seconds between captures

// Default chassis half-extents (metres)
const CHASSIS_HX = 1.00;
const CHASSIS_HY = 0.28;
const CHASSIS_HZ = 2.20;

// Wheel positions relative to chassis centre (x, y, z)
const WHEEL_OFFSETS = Object.freeze([
  { x: -0.95, y: -0.28, z:  1.35, label: 'FL' },
  { x:  0.95, y: -0.28, z:  1.35, label: 'FR' },
  { x: -0.95, y: -0.28, z: -1.35, label: 'RL' },
  { x:  0.95, y: -0.28, z: -1.35, label: 'RR' },
]);

const GRAVITY   = 9.81;
const AIR_DRAG  = 0.35;  // coefficient applied per frame at speed

// Light emissive intensities
const LIGHT_BRAKE_ON   = 3.0;
const LIGHT_BRAKE_OFF  = 0.0;
const LIGHT_HEAD_ON    = 2.5;
const LIGHT_HEAD_OFF   = 0.0;
const LIGHT_REVERSE_ON = 1.5;

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function makeChassisGeometry(carDef) {
  const w = (carDef.bodyWidth  ?? CHASSIS_HX * 2);
  const h = (carDef.bodyHeight ?? CHASSIS_HY * 2);
  const l = (carDef.bodyLength ?? CHASSIS_HZ * 2);
  return new THREE.BoxGeometry(w, h, l);
}

function makeWheelMesh(radius, width, color = 0x111111) {
  const geo = new THREE.CylinderGeometry(radius, radius, width, 20);
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    metalness: 0.2,
  });
  return new THREE.Mesh(geo, mat);
}

function makeLightMesh(color, intensity, posLocal) {
  const geo  = new THREE.SphereGeometry(0.05, 6, 6);
  const mat  = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(posLocal.x, posLocal.y, posLocal.z);
  return mesh;
}

// ─── Car class ────────────────────────────────────────────────────────────────

export class Car {

  /**
   * Do not call directly — use createCar() factory.
   *
   * @param {object} carDef  — carData.js definition
   * @param {object} opts
   *   rapierWorld  {RAPIER.World}
   *   scene        {THREE.Scene}
   *   spawnPos     {THREE.Vector3}
   *   spawnQuat    {THREE.Quaternion}
   *   isPlayer     {boolean}
   */
  constructor(carDef, opts = {}) {
    this.def      = carDef;
    this.id       = carDef.id ?? `car_${Math.random().toString(36).slice(2, 7)}`;
    this.isPlayer = opts.isPlayer ?? false;

    // ── Physics references ────────────────────────────────────────────────
    this._world   = opts.rapierWorld ?? null;
    this._body    = null;   // Rapier RigidBody — set in _initPhysics()

    // ── Three.js mesh group ───────────────────────────────────────────────
    this.mesh     = new THREE.Group();
    this.mesh.name = `car_${this.id}`;
    this._bodyMesh    = null;
    this._wheelMeshes = [];    // [FL, FR, RL, RR]
    this._brakeLights  = [];
    this._headLights   = [];
    this._reverseLight = null;

    // ── Sub-systems ───────────────────────────────────────────────────────
    this.suspension   = null; // SuspensionSystem — created after physics body
    this.transmission = null; // Transmission

    // ── Customization state ───────────────────────────────────────────────
    this.paintColor   = carDef.defaultColor ?? 0xcc2222;
    this.paintType    = carDef.defaultPaint ?? 'metallic'; // solid/metallic/matte/chrome
    this.parts        = {};   // partSlot → partDef (from partsShop)
    this.bodyKit      = {     // active body kit piece names
      frontBumper: 'stock',
      rearBumper:  'stock',
      sideSkirts:  'stock',
      hood:        'stock',
      wing:        'stock',
      widebody:    false,
    };
    this.wheelConfig  = {
      rimDesign:    'stock',
      rimColor:     0x888888,
      diameter:     18,
      compound:     carDef.defaultTyreCompound ?? 'street',
    };
    this.windowTint   = 0;  // 0=clear … 4=mirror

    // ── Live driving state ────────────────────────────────────────────────
    /** Speed in m/s (signed: negative = reversing) */
    this.speedMs      = 0;
    /** Speed in km/h (always positive for HUD) */
    this.speedKmh     = 0;
    /** World heading in radians */
    this.heading      = 0;
    /** true when all 4 wheels are off the ground */
    this.isAirborne   = false;
    /** Number of grounded wheels (0–4) */
    this.groundedWheels = 4;
    /** Lateral G-force (approx, for camera lean) */
    this.lateralG     = 0;
    /** Throttle 0–1 (last frame) */
    this.throttle     = 0;
    /** Brake 0–1 (last frame) */
    this.brake        = 0;
    /** Handbrake engaged */
    this.handbrake    = false;
    /** Steering -1 (full left) … +1 (full right) */
    this.steerAngle   = 0;
    /** Traction control firing this frame */
    this.tcActive     = false;
    /** ABS firing this frame */
    this.absActive    = false;

    // ── Assist settings (from SettingsMenu) ───────────────────────────────
    this.assists = {
      tcs:            true,  // traction control
      abs:            true,  // anti-lock brakes
      stabilityCtrl:  true,  // stability control
      steeringAssist: true,  // input smoothing
      counterSteer:   true,  // auto counter-steer
      autoShift:      true,  // automatic gearbox
    };

    // ── Light state ───────────────────────────────────────────────────────
    this._lightsOn    = false;
    this._blinkerL    = false;
    this._blinkerR    = false;
    this._blinkerTime = 0;

    // ── Dirt overlay ──────────────────────────────────────────────────────
    /** 0 = clean, 1 = fully dirty */
    this.dirtLevel    = 0;

    // ── Rewind buffer ─────────────────────────────────────────────────────
    this._rewindBuffer   = [];
    this._rewindTimer    = 0;
    this._rewindMode     = false;
    this._rewindPlayhead = 0;

    // ── PR cache ──────────────────────────────────────────────────────────
    this._prDirty = true;
    this._prCache = 0;

    // ── Initialise ────────────────────────────────────────────────────────
    this._initPhysics(opts);
    this._initMesh(opts.scene);
    this._initSubSystems();
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  /** Current Performance Rating (recalculated on demand). */
  get pr() {
    if (this._prDirty) {
      this._prCache = computePR(this.def, this.parts);
      this._prDirty = false;
    }
    return this._prCache;
  }

  /** Class letter for current PR. */
  get carClass() { return prToClass(this.pr); }

  /** World position as THREE.Vector3. */
  get position() {
    if (!this._body) return new THREE.Vector3();
    const t = this._body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** World rotation as THREE.Quaternion. */
  get quaternion() {
    if (!this._body) return new THREE.Quaternion();
    const r = this._body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  /** Linear velocity vector (m/s). */
  get velocity() {
    if (!this._body) return new THREE.Vector3();
    const v = this._body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  // ─── Physics Init ─────────────────────────────────────────────────────────

  _initPhysics(opts) {
    if (!this._world) return; // headless / test mode

    const RAPIER = this._world.constructor._rapier ?? globalThis.RAPIER;
    if (!RAPIER) return;

    const spawn = opts.spawnPos  ?? new THREE.Vector3(0, 1.5, 0);
    const quat  = opts.spawnQuat ?? new THREE.Quaternion();

    // Rigid body descriptor — dynamic
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(0.05)
      .setAngularDamping(0.8);

    this._body = this._world.createRigidBody(bodyDesc);

    // Set mass / inertia
    const mass = this.def.baseWeight ?? 1400;
    this._body.setAdditionalMass(mass, true);

    // Chassis collider (box)
    const chassisDesc = RAPIER.ColliderDesc
      .cuboid(CHASSIS_HX, CHASSIS_HY, CHASSIS_HZ)
      .setTranslation(0, 0.05, 0)   // offset CoM slightly up
      .setFriction(0.4)
      .setRestitution(0.1)
      .setDensity(0);               // mass set via body, not density

    this._world.createCollider(chassisDesc, this._body);

    // Store RAPIER ref for suspension
    this._RAPIER = RAPIER;
  }

  // ─── Mesh Init ────────────────────────────────────────────────────────────

  _initMesh(scene) {
    // ── Body mesh ─────────────────────────────────────────────────────────
    const bodyGeo = makeChassisGeometry(this.def);
    const bodyMat = new THREE.MeshStandardMaterial({
      color:     this.paintColor,
      roughness: this._paintRoughness(),
      metalness: this._paintMetalness(),
    });
    this._bodyMat  = bodyMat;
    this._bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this._bodyMesh.castShadow    = true;
    this._bodyMesh.receiveShadow = false;
    this._bodyMesh.name = 'carBody';
    this.mesh.add(this._bodyMesh);

    // ── Windshield glass ──────────────────────────────────────────────────
    const screenGeo = new THREE.BoxGeometry(
      (this.def.bodyWidth ?? 2.0) * 0.9,
      (this.def.bodyHeight ?? 0.56) * 0.45,
      0.04,
    );
    const screenMat = new THREE.MeshStandardMaterial({
      color:       0x88ccff,
      roughness:   0.05,
      metalness:   0.0,
      transparent: true,
      opacity:     0.35,
    });
    this._windshield = new THREE.Mesh(screenGeo, screenMat);
    this._windshield.position.set(0, (this.def.bodyHeight ?? 0.56) * 0.4, (this.def.bodyLength ?? 4.4) * 0.28);
    this._windshield.rotation.x = -0.25;
    this.mesh.add(this._windshield);

    // ── Wheels ────────────────────────────────────────────────────────────
    const wheelRadius = this.def.wheelRadius ?? 0.32;
    const wheelWidth  = this.def.wheelWidth  ?? 0.24;

    WHEEL_OFFSETS.forEach((off, i) => {
      const w = makeWheelMesh(wheelRadius, wheelWidth, this.wheelConfig.rimColor);
      w.name = `wheel_${off.label}`;
      w.position.set(off.x, off.y, off.z);
      this._wheelMeshes.push(w);
      this.mesh.add(w);
    });

    // ── Brake lights ──────────────────────────────────────────────────────
    const bkZ  = -(this.def.bodyLength ?? 4.4) * 0.5 - 0.02;
    const bkY  = 0.05;
    [-0.7, 0.7].forEach(bkX => {
      const bl = makeLightMesh(0xff1111, LIGHT_BRAKE_OFF, { x: bkX, y: bkY, z: bkZ });
      bl.name = 'brakeLight';
      this._brakeLights.push(bl);
      this.mesh.add(bl);
    });

    // ── Headlights ────────────────────────────────────────────────────────
    const hdZ = (this.def.bodyLength ?? 4.4) * 0.5 + 0.02;
    const hdY = 0.05;
    [-0.65, 0.65].forEach(hdX => {
      const hl = makeLightMesh(0xfff8e0, LIGHT_HEAD_OFF, { x: hdX, y: hdY, z: hdZ });
      hl.name = 'headLight';
      this._headLights.push(hl);
      this.mesh.add(hl);
    });

    // THREE.js spotlight for headlights (player car only)
    if (this.isPlayer) {
      this._spotL = this._makeHeadSpot(-0.65);
      this._spotR = this._makeHeadSpot( 0.65);
      this.mesh.add(this._spotL);
      this.mesh.add(this._spotL.target);
      this.mesh.add(this._spotR);
      this.mesh.add(this._spotR.target);
    }

    // ── Reverse light ─────────────────────────────────────────────────────
    this._reverseLight = makeLightMesh(0xffffff, LIGHT_REVERSE_ON * 0, { x: 0, y: 0.05, z: bkZ });
    this._reverseLight.name = 'reverseLight';
    this.mesh.add(this._reverseLight);

    // ── Shadow catcher ────────────────────────────────────────────────────
    const shadowGeo = new THREE.CircleGeometry(1.6, 16);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false,
    });
    this._shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
    this._shadowCatcher.rotation.x = -Math.PI / 2;
    this._shadowCatcher.position.y = -(CHASSIS_HY + 0.01);
    this._shadowCatcher.name = 'shadowCatcher';
    this.mesh.add(this._shadowCatcher);

    if (scene) scene.add(this.mesh);
  }

  _makeHeadSpot(offsetX) {
    const spot = new THREE.SpotLight(0xfff8e0, 3.5, 35, Math.PI / 9, 0.3, 1.5);
    spot.castShadow  = false; // perf
    const hdZ        = (this.def.bodyLength ?? 4.4) * 0.5;
    spot.position.set(offsetX, 0.15, hdZ);
    spot.target.position.set(offsetX * 0.5, -0.6, hdZ + 10);
    return spot;
  }

  // ─── Sub-system Init ──────────────────────────────────────────────────────

  _initSubSystems() {
    // Transmission
    this.transmission = createTransmission(this.def);

    // Suspension (needs physics body)
    if (this._body && this._RAPIER) {
      this.suspension = new SuspensionSystem(this.def, this._body, this._RAPIER);
    }
  }

  // ─── Main Update ─────────────────────────────────────────────────────────

  /**
   * Called once per physics step by driving.js (player) or npc.js (traffic).
   *
   * @param {number} dt           — seconds
   * @param {object} inputState   — { throttle, brake, steer, handbrake, ... }
   * @param {RAPIER.World} world  — physics world
   */
  update(dt, inputState, world) {
    if (this._rewindMode) {
      this._stepRewind();
      return;
    }

    // ── Capture input ─────────────────────────────────────────────────────
    const throttle  = inputState?.throttle  ?? 0;
    const brake     = inputState?.brake     ?? 0;
    const steer     = inputState?.steer     ?? 0;
    const handbrake = inputState?.handbrake ?? false;
    const isManual  = !(this.assists.autoShift);

    this.throttle   = throttle;
    this.brake      = brake;
    this.steerAngle = steer;
    this.handbrake  = handbrake;

    // ── Velocity & speed ─────────────────────────────────────────────────
    const vel = this.velocity;
    const fwd = this._forwardVector();
    // Signed speed: positive = forward
    this.speedMs  = vel.dot(fwd);
    this.speedKmh = Math.abs(this.speedMs) * 3.6;

    // ── Suspension ────────────────────────────────────────────────────────
    if (this.suspension) {
      this.suspension.update(dt, world ?? this._world);
      this.groundedWheels = this.suspension.getGroundedWheels().length;
      this.isAirborne     = this.groundedWheels === 0;
    }

    // ── Transmission ─────────────────────────────────────────────────────
    const txOut = this.transmission.update(
      dt,
      this._tcsThrottle(throttle),
      brake,
      Math.abs(this.speedMs),
      isManual,
      handbrake,
    );
    this._lastTxOut = txOut;

    // ── Aerodynamic drag (applied directly to body) ───────────────────────
    if (this._body) {
      const dragMag = AIR_DRAG * this.speedMs * this.speedMs;
      const dragVec = vel.clone().normalize().multiplyScalar(-dragMag * dt);
      this._body.applyImpulse({ x: dragVec.x, y: 0, z: dragVec.z }, true);
    }

    // ── Mesh sync ─────────────────────────────────────────────────────────
    this._syncMesh();
    this._spinWheels(dt);
    this._updateLights(txOut);

    // ── Dirt accumulation ─────────────────────────────────────────────────
    this._updateDirt(dt, inputState?.surfaceType ?? 'tarmac');

    // ── Blinkers ─────────────────────────────────────────────────────────
    this._stepBlinkers(dt);

    // ── Rewind capture ────────────────────────────────────────────────────
    this._captureRewind(dt);
  }

  // ─── Mesh Sync ────────────────────────────────────────────────────────────

  _syncMesh() {
    if (!this._body) return;

    const t = this._body.translation();
    const r = this._body.rotation();

    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    // Heading from forward vector
    this.heading = Math.atan2(
      2 * (r.w * r.y + r.x * r.z),
      1 - 2 * (r.y * r.y + r.z * r.z),
    );

    // Shadow catcher follows ground (lower when grounded)
    const shadowY = this.isAirborne ? -(CHASSIS_HY + 0.3) : -(CHASSIS_HY + 0.01);
    this._shadowCatcher.position.y = shadowY;
    this._shadowCatcher.material.opacity = this.isAirborne ? 0.15 : 0.35;
  }

  _spinWheels(dt) {
    const spin = this.speedMs / (this.def.wheelRadius ?? 0.32) * dt;
    this._wheelMeshes.forEach(w => {
      w.rotation.x += spin;
    });

    // Sync wheel positions from suspension if available
    if (this.suspension) {
      WHEEL_OFFSETS.forEach((off, i) => {
        const vis = this.suspension.getWheelVisual(i);
        if (vis) {
          this._wheelMeshes[i].position.y = vis.localY ?? off.y;
        }
      });
    }
  }

  // ─── Lights ───────────────────────────────────────────────────────────────

  _updateLights(txOut) {
    // Brake lights
    const brakingHard = (this.brake > 0.05 || this.handbrake);
    const brakeInt    = brakingHard ? LIGHT_BRAKE_ON : LIGHT_BRAKE_OFF;
    this._brakeLights.forEach(bl => {
      bl.material.emissiveIntensity = brakeInt;
    });

    // Reverse light
    if (this._reverseLight) {
      this._reverseLight.material.emissiveIntensity =
        (txOut?.gear === -1) ? LIGHT_REVERSE_ON : 0;
    }

    // Head lights (controlled by setLights)
    const headInt = this._lightsOn ? LIGHT_HEAD_ON : LIGHT_HEAD_OFF;
    this._headLights.forEach(hl => {
      hl.material.emissiveIntensity = headInt;
    });

    if (this._spotL) this._spotL.intensity = this._lightsOn ? 3.5 : 0;
    if (this._spotR) this._spotR.intensity = this._lightsOn ? 3.5 : 0;
  }

  setLights(on) {
    this._lightsOn = on;
  }

  setBlinker(side, on) {
    if (side === 'left')  this._blinkerL = on;
    if (side === 'right') this._blinkerR = on;
    if (side === 'hazard') { this._blinkerL = on; this._blinkerR = on; }
    this._blinkerTime = 0;
  }

  _stepBlinkers(dt) {
    if (!this._blinkerL && !this._blinkerR) return;
    this._blinkerTime += dt;
    const on = (this._blinkerTime % 0.6) < 0.3;
    // Flash bake lights as makeshift blinker (real blinker meshes added per-model)
    if (this._blinkerL) {
      this._brakeLights[0].material.emissiveIntensity = on ? 2.5 : LIGHT_BRAKE_OFF;
    }
    if (this._blinkerR) {
      this._brakeLights[1].material.emissiveIntensity = on ? 2.5 : LIGHT_BRAKE_OFF;
    }
  }

  // ─── Paint & Visual Customization ─────────────────────────────────────────

  /**
   * Apply a new paint colour and type.
   * @param {number} hexColor
   * @param {string} type  — 'solid' | 'metallic' | 'matte' | 'chrome' | 'satin'
   */
  setPaint(hexColor, type = 'metallic') {
    this.paintColor = hexColor;
    this.paintType  = type;
    if (this._bodyMat) {
      this._bodyMat.color.setHex(hexColor);
      this._bodyMat.roughness = this._paintRoughness();
      this._bodyMat.metalness = this._paintMetalness();
      this._bodyMat.needsUpdate = true;
    }
  }

  _paintRoughness() {
    switch (this.paintType) {
      case 'matte':   return 0.95;
      case 'satin':   return 0.60;
      case 'chrome':  return 0.05;
      case 'solid':   return 0.40;
      case 'metallic':
      default:        return 0.25;
    }
  }

  _paintMetalness() {
    switch (this.paintType) {
      case 'chrome':  return 1.0;
      case 'metallic':return 0.7;
      case 'matte':   return 0.0;
      case 'satin':   return 0.2;
      case 'solid':
      default:        return 0.1;
    }
  }

  /** Set rim color. */
  setRimColor(hexColor) {
    this.wheelConfig.rimColor = hexColor;
    this._wheelMeshes.forEach(w => {
      w.material.color.setHex(hexColor);
    });
  }

  /** Window tint level 0–4. */
  setWindowTint(level) {
    this.windowTint = Math.max(0, Math.min(4, level));
    const opacity = [0.35, 0.5, 0.65, 0.80, 0.95][this.windowTint];
    if (this._windshield) {
      this._windshield.material.opacity = opacity;
    }
  }

  // ─── Parts & PR ───────────────────────────────────────────────────────────

  /**
   * Equip a performance part.
   * @param {string} slot   — e.g. 'engine', 'tires', 'suspension'
   * @param {object} partDef — from partsShop (null to remove)
   */
  equipPart(slot, partDef) {
    if (partDef === null) {
      delete this.parts[slot];
    } else {
      this.parts[slot] = partDef;
    }
    this._prDirty = true;

    // Forward tyre compound to suspension & transmission if relevant
    if (slot === 'tires' && partDef?.compound) {
      this.suspension?.applyTuning({ tyreCompound: partDef.compound });
      this.def.wheelRadius = partDef.wheelRadius ?? this.def.wheelRadius;
    }
    if (slot === 'gearbox' && partDef?.preset) {
      this.transmission.setGearboxPreset(partDef.preset);
    }
    if (slot === 'engine' && partDef?.aspiration) {
      // Aspiraton changes require a new Transmission — rebuild it
      const newDef = { ...this.def, aspiration: partDef.aspiration,
        turboBoost: partDef.turboBoost ?? 1.0,
        scBoost:    partDef.scBoost    ?? 1.0 };
      this.transmission = createTransmission(newDef);
    }
    if (slot === 'drivetrain' && partDef?.type) {
      this.transmission.setDrivetrain(partDef.type);
    }
  }

  /**
   * Apply tuning parameters (from Tuning System, Part 4).
   * @param {object} tuning — partial tuning map
   */
  applyTuning(tuning) {
    this.suspension?.applyTuning(tuning);
    if (tuning.gearRatios != null || tuning.finalDrive != null) {
      this.transmission.applyGearTuning(tuning.gearRatios, tuning.finalDrive);
    }
    if (tuning.diffType != null) {
      this.transmission.setDiff(tuning.diffType, tuning.diffAccelLock, tuning.diffDecelLock);
    }
    if (tuning.turboBoost != null || tuning.scBoost != null) {
      this.transmission.setBoostPressure(tuning.turboBoost, tuning.scBoost);
    }
    // TC / ABS assists
    for (const k of ['tcs', 'abs', 'stabilityCtrl', 'steeringAssist', 'counterSteer', 'autoShift']) {
      if (tuning[k] != null) this.assists[k] = tuning[k];
    }
  }

  // ─── Traction Control ─────────────────────────────────────────────────────

  /**
   * Reduce throttle when driven wheels lose grip (simple TC model).
   * Reads suspension's longitudinal grip from the driven axle.
   */
  _tcsThrottle(rawThrottle) {
    if (!this.assists.tcs || !this.suspension) return rawThrottle;

    const dt     = this._drivetrain ?? this.def.drivetrain ?? 'RWD';
    const axle   = (dt === 'FWD') ? 'front' : 'rear';
    const grip   = this.suspension.getAxleLongitudinalGrip?.(axle) ?? 1.0;

    if (grip < 0.6) {
      this.tcActive = true;
      // Scale throttle proportional to available grip
      return rawThrottle * (0.4 + grip * 0.6);
    }
    this.tcActive = false;
    return rawThrottle;
  }

  // ─── Dirt Model ───────────────────────────────────────────────────────────

  _updateDirt(dt, surfaceType) {
    const dirtRate  = { gravel: 0.04, dirt: 0.06, mud: 0.10, tarmac: 0, sand: 0.05 };
    const cleanRate = 0.002; // tarmac slowly cleans the car

    const rate = dirtRate[surfaceType] ?? 0;
    this.dirtLevel = Math.max(0, Math.min(1,
      this.dirtLevel + (rate - cleanRate) * dt,
    ));

    if (this._bodyMat) {
      // Blend towards 0.9 roughness as dirty
      this._bodyMat.roughness = this._paintRoughness() + this.dirtLevel * 0.5;
      this._bodyMat.needsUpdate = true;
    }
  }

  // ─── Rewind System ────────────────────────────────────────────────────────

  _captureRewind(dt) {
    this._rewindTimer += dt;
    if (this._rewindTimer < REWIND_INTERVAL) return;
    this._rewindTimer = 0;

    if (!this._body) return;

    const t = this._body.translation();
    const r = this._body.rotation();
    const v = this._body.linvel();
    const w = this._body.angvel();

    this._rewindBuffer.push({
      tx: t.x, ty: t.y, tz: t.z,
      rx: r.x, ry: r.y, rz: r.z, rw: r.w,
      vx: v.x, vy: v.y, vz: v.z,
      wx: w.x, wy: w.y, wz: w.z,
      gear: this.transmission.gear,
      rpm:  this.transmission.rpm,
    });

    if (this._rewindBuffer.length > REWIND_FRAMES) {
      this._rewindBuffer.shift();
    }
  }

  /** Begin playing back rewind. */
  startRewind() {
    if (this._rewindBuffer.length < 2) return;
    this._rewindMode     = true;
    this._rewindPlayhead = this._rewindBuffer.length - 1;
    if (this._body) this._body.setBodyType(0 /* Static */, true); // freeze physics
  }

  /** End rewind and restore physics. */
  stopRewind() {
    this._rewindMode = false;
    if (!this._body) return;
    this._body.setBodyType(1 /* Dynamic */, true);

    // Apply the state at playhead
    const s = this._rewindBuffer[Math.round(this._rewindPlayhead)];
    if (!s) return;
    this._body.setTranslation({ x: s.tx, y: s.ty, z: s.tz }, true);
    this._body.setRotation({ x: s.rx, y: s.ry, z: s.rz, w: s.rw }, true);
    this._body.setLinvel({ x: s.vx, y: s.vy, z: s.vz }, true);
    this._body.setAngvel({ x: s.wx, y: s.wy, z: s.wz }, true);
    this.transmission.rpm  = s.rpm;
    this.transmission.gear = s.gear;

    // Trim buffer to restore point
    this._rewindBuffer.length = Math.ceil(this._rewindPlayhead) + 1;
  }

  _stepRewind() {
    this._rewindPlayhead = Math.max(0, this._rewindPlayhead - (REWIND_HZ / 60));
    const idx = Math.round(this._rewindPlayhead);
    const s   = this._rewindBuffer[idx];
    if (!s || !this._body) return;

    // Move mesh only — body is static during rewind
    this.mesh.position.set(s.tx, s.ty, s.tz);
    this.mesh.quaternion.set(s.rx, s.ry, s.rz, s.rw);

    if (this._rewindPlayhead <= 0) this.stopRewind();
  }

  // ─── Debug / HUD export ──────────────────────────────────────────────────

  /**
   * Snapshot consumed by DrivingHUD and DebugOverlay.
   * @returns {object}
   */
  getHUDState() {
    const tx = this._lastTxOut ?? {};
    return {
      speedKmh:    Math.round(this.speedKmh),
      gear:        this.transmission.getGearLabel(),
      rpm:         Math.round(this.transmission.rpm),
      rpmNorm:     this.transmission.getRpmNorm(),
      boost:       this.transmission.getBoostNorm(),
      limiter:     this.transmission.limiterActive,
      throttle:    this.throttle,
      brake:       this.brake,
      steer:       this.steerAngle,
      handbrake:   this.handbrake,
      tcActive:    this.tcActive,
      absActive:   this.absActive,
      isAirborne:  this.isAirborne,
      groundedWheels: this.groundedWheels,
      dirtLevel:   this.dirtLevel,
      pr:          this.pr,
      carClass:    this.carClass,
      drivetrain:  this.def.drivetrain ?? 'RWD',
      heading:     this.heading,
    };
  }

  getDebugState() {
    return {
      ...this.getHUDState(),
      position:     this.position,
      velocity:     this.velocity,
      transmission: this.transmission.getDebugState(),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** World-space forward vector (points towards car's nose). */
  _forwardVector() {
    const q = this.quaternion;
    // Rotate world Z-axis by car quaternion
    return new THREE.Vector3(
      2 * (q.x * q.z + q.w * q.y),
      2 * (q.y * q.z - q.w * q.x),
      1 - 2 * (q.x * q.x + q.y * q.y),
    ).normalize();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Remove the car from the scene and destroy the physics body.
   * Always call this before discarding a Car reference.
   */
  dispose(scene, world) {
    if (scene) scene.remove(this.mesh);
    if (world && this._body) {
      world.removeRigidBody(this._body);
      this._body = null;
    }
    // Dispose Three.js geometries / materials
    this.mesh.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    this._rewindBuffer.length = 0;
  }

  /**
   * Serialise the car's customization and parts for localStorage.
   * @returns {object}
   */
  toSaveData() {
    return {
      id:         this.id,
      defId:      this.def.id,
      paintColor: this.paintColor,
      paintType:  this.paintType,
      windowTint: this.windowTint,
      bodyKit:    { ...this.bodyKit },
      wheelConfig:{ ...this.wheelConfig },
      parts:      { ...this.parts },
      dirtLevel:  this.dirtLevel,
    };
  }

  /**
   * Restore customization from saved data (call after createCar).
   * @param {object} saved — result of toSaveData()
   */
  fromSaveData(saved) {
    this.setPaint(saved.paintColor ?? this.paintColor, saved.paintType ?? 'metallic');
    this.setWindowTint(saved.windowTint ?? 0);
    this.bodyKit    = { ...this.bodyKit, ...(saved.bodyKit    ?? {}) };
    this.wheelConfig= { ...this.wheelConfig, ...(saved.wheelConfig ?? {}) };
    this.dirtLevel  = saved.dirtLevel ?? 0;
    this.setRimColor(this.wheelConfig.rimColor);
    for (const [slot, part] of Object.entries(saved.parts ?? {})) {
      this.equipPart(slot, part);
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build a fully initialised Car and add it to the scene.
 *
 * @param {object} carDef       — from carData.js
 * @param {object} [opts]
 *   rapierWorld  {RAPIER.World}
 *   scene        {THREE.Scene}
 *   spawnPos     {THREE.Vector3}
 *   spawnQuat    {THREE.Quaternion}
 *   isPlayer     {boolean}
 *   savedData    {object}  — optional saved customization
 *
 * @returns {Car}
 */
export function createCar(carDef, opts = {}) {
  const car = new Car(carDef, opts);
  if (opts.savedData) car.fromSaveData(opts.savedData);
  return car;
}

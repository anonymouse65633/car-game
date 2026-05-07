/**
 * physics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Rapier.js WASM physics engine — world init, fixed-timestep stepping,
 * rigid body registry, collider helpers, and suspension raycast API.
 *
 * Usage:
 *   import { initPhysics, stepPhysics, createBody, removeBody, castRay, RAPIER, world }
 *     from './physics.js';
 *   await initPhysics();   // call once from main.js, after initRenderer()
 *
 * Resolved by importmap in index.html:
 *   "@dimforge/rapier3d-compat" →
 *     https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/rapier.es.min.js
 *
 * Part 10.5 — Physics Architecture (design doc reference)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import RAPIER from '@dimforge/rapier3d-compat';

// ─── EXPORTED SINGLETONS ─────────────────────────────────────────────────────

/** The Rapier module itself — needed by suspension.js and car.js for type access. */
export { RAPIER };

/** The live Rapier physics world. Available after initPhysics() resolves. */
export let world = null;

// ─── INTERNAL STATE ──────────────────────────────────────────────────────────

/**
 * Central body registry.
 * Maps a string handle → { body, colliders[], mesh?, onContact? }
 * Lets any system look up or remove a body by the handle it was given at creation.
 *
 * @type {Map<string, BodyRecord>}
 *
 * @typedef {object} BodyRecord
 * @property {import('@dimforge/rapier3d-compat').RigidBody} body
 * @property {import('@dimforge/rapier3d-compat').Collider[]} colliders
 * @property {THREE.Object3D|null} mesh      - Three.js mesh to sync each frame
 * @property {Function|null}       onContact - called when this body collides
 */
const _registry = new Map();

/** Auto-incrementing handle counter */
let _nextHandle = 1;

// ─── Preset-aware physics constants ──────────────────────────────────────────
// On Low: use a 30 Hz timestep (half frequency) and cap to 1 step per frame.
// This breaks the "death spiral" where a slow frame triggers 5 physics steps,
// making the next frame even slower, repeating forever.
const _PHYS_PRESET = (() => { try { return localStorage.getItem('graphicsPreset') ?? 'low'; } catch { return 'low'; } })();
const _IS_LOW_PHYS = (_PHYS_PRESET === 'low');

/**
 * Fixed physics timestep in seconds.
 * Low: 1/30 Hz — steps half as often, saving ~10 ms on slow Macs.
 * All other presets: 1/60 Hz (standard).
 */
const FIXED_DT = _IS_LOW_PHYS ? 1 / 30 : 1 / 60;

/** Accumulator for the fixed-timestep integration in stepPhysics(). */
let _accumulator = 0;

/**
 * Maximum physics steps per frame.
 * Low: 1 — prevents the death spiral entirely. Physics slows at low fps
 *           but the frame budget is protected.
 * Others: 5 — standard catch-up allowance.
 */
const MAX_STEPS_PER_FRAME = _IS_LOW_PHYS ? 1 : 5;

// ─── INIT ─────────────────────────────────────────────────────────────────────

/**
 * Initialise Rapier WASM and create the physics world.
 * Must be awaited before any body creation or stepping.
 *
 * @returns {Promise<void>}
 */
export async function initPhysics() {
  // Rapier requires its WASM binary to be fetched and compiled before use
  await RAPIER.init();

  // Gravity: 9.81 m/s² downward on Y axis
  // Car suspension counteracts this with spring forces — see suspension.js
  const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
  world = new RAPIER.World(gravity);

  // Register a collision event handler for contact callbacks
  world.contactPairEvents = true;

  console.log('[physics] ✅ Rapier initialised — gravity', gravity.y, 'm/s²');
}

// ─── STEP ─────────────────────────────────────────────────────────────────────

/**
 * Advance the physics simulation.
 * Call this once per animation frame BEFORE rendering, passing the real
 * elapsed time since the last frame (in seconds, already capped by loop.js).
 *
 * Uses a fixed-timestep accumulator so physics runs at exactly 60 Hz
 * regardless of actual frame rate, preventing speed variation.
 *
 * After each step, all registered mesh refs are synced to their body transforms.
 *
 * @param {number} dt  Real elapsed time since last frame (seconds, max ~0.1)
 */
export function stepPhysics(dt) {
  if (!world) return;

  // On low preset, clamp dt to 50ms so a 200ms lag spike doesn't dump
  // 200ms into the accumulator and trigger cascading catch-up steps.
  const safeDt = _IS_LOW_PHYS ? Math.min(dt, 0.05) : dt;
  _accumulator += safeDt;

  let steps = 0;
  while (_accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    world.step();
    _accumulator -= FIXED_DT;
    steps++;
  }

  // Sync Three.js meshes to physics body transforms
  _syncMeshes();
}

/** Copy Rapier body position/rotation to the linked Three.js mesh. */
function _syncMeshes() {
  for (const record of _registry.values()) {
    if (!record.mesh || !record.body.isValid()) continue;

    const pos = record.body.translation();
    const rot = record.body.rotation();

    record.mesh.position.set(pos.x, pos.y, pos.z);
    record.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }
}

// ─── BODY FACTORY ─────────────────────────────────────────────────────────────

/**
 * Create a Rapier rigid body + one or more colliders, register it, and
 * return a handle string the caller uses to reference or remove it later.
 *
 * @param {BodyOptions} opts
 * @returns {string} handle
 *
 * @typedef {object} BodyOptions
 * @property {'dynamic'|'fixed'|'kinematic'}  type        - Body type
 * @property {{ x:number, y:number, z:number }} position  - Initial world position
 * @property {{ x:number, y:number, z:number, w:number }} [rotation] - Initial quaternion
 * @property {ColliderDef[]}  colliders   - One or more collider shapes to attach
 * @property {THREE.Object3D} [mesh]      - Three.js object to sync each frame
 * @property {Function}       [onContact] - Collision callback (bodyHandle, otherHandle)
 * @property {number}  [linearDamping]    - Default 0.05 (cars use 0.2)
 * @property {number}  [angularDamping]   - Default 0.1
 * @property {boolean} [canSleep]         - Default true
 * @property {boolean} [startSleeping]    - Force sleeping on creation (parked cars)
 * @property {number}  [gravityScale]     - Default 1.0 (set 0 for floating objects)
 * @property {number}  [ccdEnabled]       - Continuous collision detection
 *
 * @typedef {object} ColliderDef
 * @property {'cuboid'|'capsule'|'ball'|'trimesh'|'cylinder'} shape
 * @property {number[]} args           - Shape-specific dimensions (see below)
 * @property {number}   [friction]     - Default 0.7
 * @property {number}   [restitution]  - Default 0.1
 * @property {number}   [density]      - Default 1.0
 * @property {boolean}  [sensor]       - Sensor (trigger) — no physical response
 * @property {{ x,y,z }} [offset]      - Local position offset from body origin
 * @property {number[]} [vertices]     - Trimesh vertices Float32Array
 * @property {number[]} [indices]      - Trimesh indices Uint32Array
 */
export function createBody(opts) {
  if (!world) throw new Error('[physics] createBody called before initPhysics()');

  const handle = `body_${_nextHandle++}`;

  // ── Rigid body descriptor ─────────────────────────────────────────────────
  let bodyDesc;
  switch (opts.type) {
    case 'fixed':
      bodyDesc = RAPIER.RigidBodyDesc.fixed();
      break;
    case 'kinematic':
      bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
      break;
    case 'dynamic':
    default:
      bodyDesc = RAPIER.RigidBodyDesc.dynamic();
      bodyDesc.setLinearDamping(opts.linearDamping  ?? 0.05);
      bodyDesc.setAngularDamping(opts.angularDamping ?? 0.10);
      bodyDesc.setCanSleep(opts.canSleep ?? true);
      bodyDesc.setCcdEnabled(opts.ccdEnabled ?? false);
      if (opts.gravityScale !== undefined) {
        bodyDesc.setGravityScale(opts.gravityScale);
      }
      break;
  }

  // Position
  const p = opts.position ?? { x: 0, y: 0, z: 0 };
  bodyDesc.setTranslation(p.x, p.y, p.z);

  // Rotation (quaternion)
  if (opts.rotation) {
    const r = opts.rotation;
    bodyDesc.setRotation({ x: r.x, y: r.y, z: r.z, w: r.w });
  }

  const body = world.createRigidBody(bodyDesc);

  if (opts.startSleeping) body.sleep();

  // ── Colliders ─────────────────────────────────────────────────────────────
  const createdColliders = [];
  for (const def of (opts.colliders ?? [])) {
    const collider = _buildCollider(body, def);
    if (collider) createdColliders.push(collider);
  }

  // ── Register ──────────────────────────────────────────────────────────────
  _registry.set(handle, {
    body,
    colliders: createdColliders,
    mesh:      opts.mesh      ?? null,
    onContact: opts.onContact ?? null,
  });

  return handle;
}

/** Build and attach a single collider to a body. */
function _buildCollider(body, def) {
  let colliderDesc;

  switch (def.shape) {
    case 'cuboid': {
      // args: [halfX, halfY, halfZ]
      const [hx, hy, hz] = def.args;
      colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
      break;
    }
    case 'capsule': {
      // args: [halfHeight, radius]  (capsule stands on Y axis)
      const [halfH, radius] = def.args;
      colliderDesc = RAPIER.ColliderDesc.capsule(halfH, radius);
      break;
    }
    case 'ball': {
      // args: [radius]
      colliderDesc = RAPIER.ColliderDesc.ball(def.args[0]);
      break;
    }
    case 'cylinder': {
      // args: [halfHeight, radius]
      const [halfH, radius] = def.args;
      colliderDesc = RAPIER.ColliderDesc.cylinder(halfH, radius);
      break;
    }
    case 'trimesh': {
      // args unused — uses def.vertices (Float32Array) and def.indices (Uint32Array)
      if (!def.vertices || !def.indices) {
        console.warn('[physics] trimesh collider missing vertices/indices');
        return null;
      }
      colliderDesc = RAPIER.ColliderDesc.trimesh(
        new Float32Array(def.vertices),
        new Uint32Array(def.indices)
      );
      break;
    }
    default:
      console.warn('[physics] unknown collider shape:', def.shape);
      return null;
  }

  // Common properties
  colliderDesc.setFriction(def.friction    ?? 0.7);
  colliderDesc.setRestitution(def.restitution ?? 0.1);
  colliderDesc.setDensity(def.density ?? 1.0);
  colliderDesc.setSensor(def.sensor  ?? false);

  // Local offset relative to body origin
  if (def.offset) {
    colliderDesc.setTranslation(def.offset.x, def.offset.y, def.offset.z);
  }

  return world.createCollider(colliderDesc, body);
}

// ─── BODY REMOVAL ─────────────────────────────────────────────────────────────

/**
 * Remove a body and all its colliders from the world and the registry.
 *
 * @param {string} handle
 */
export function removeBody(handle) {
  const record = _registry.get(handle);
  if (!record) {
    console.warn('[physics] removeBody: handle not found:', handle);
    return;
  }

  if (record.body.isValid()) {
    world.removeRigidBody(record.body);
  }

  _registry.delete(handle);
}

// ─── BODY LOOKUP ─────────────────────────────────────────────────────────────

/**
 * Get the raw Rapier RigidBody for a handle.
 * Used by suspension.js and driving.js to apply forces.
 *
 * @param {string} handle
 * @returns {import('@dimforge/rapier3d-compat').RigidBody|null}
 */
export function getBody(handle) {
  return _registry.get(handle)?.body ?? null;
}

/**
 * Update the Three.js mesh linked to a body handle.
 * Called by car.js when the visual mesh is loaded asynchronously after the body.
 *
 * @param {string}            handle
 * @param {THREE.Object3D}    mesh
 */
export function setBodyMesh(handle, mesh) {
  const record = _registry.get(handle);
  if (record) record.mesh = mesh;
}

// ─── RAYCAST ─────────────────────────────────────────────────────────────────

/**
 * Fire a single ray into the physics world and return hit information.
 * Used heavily by suspension.js (one call per wheel per frame × all cars).
 *
 * @param {object} origin      - { x, y, z } ray start point
 * @param {object} direction   - { x, y, z } unit vector (will be normalised internally)
 * @param {number} maxDistance - Maximum ray length in metres
 * @param {boolean} [solid]    - If true, ray starting inside a collider still hits it
 * @param {string}  [excludeHandle] - Registry handle whose colliders are skipped
 *                                    (so a car doesn't collide with its own body)
 * @returns {RayHit|null}
 *
 * @typedef {object} RayHit
 * @property {number} distance          - Distance along ray to hit point (metres)
 * @property {{ x,y,z }} point          - World-space hit point
 * @property {{ x,y,z }} normal         - Surface normal at hit point
 * @property {import('@dimforge/rapier3d-compat').Collider} collider
 */
export function castRay(origin, direction, maxDistance, solid = true, excludeHandle = null) {
  if (!world) return null;

  const ray = new RAPIER.Ray(origin, direction);

  // Build exclude list — the car's own colliders
  let excludeCollider = null;
  if (excludeHandle) {
    const record = _registry.get(excludeHandle);
    if (record?.colliders.length) excludeCollider = record.colliders[0];
  }

  const hit = world.castRay(
    ray,
    maxDistance,
    solid,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,        // groups filter (null = all)
    excludeCollider   // specific collider to exclude
  );

  if (!hit) return null;

  const hitPoint = ray.pointAt(hit.timeOfImpact);
  const hitCollider = hit.collider;

  // Surface normal via an extra narrow-phase query
  // (castRayAndGetNormal is available in Rapier ≥ 0.11)
  const hitWithNormal = world.castRayAndGetNormal(
    ray,
    maxDistance,
    solid,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    excludeCollider
  );

  const normal = hitWithNormal
    ? hitWithNormal.normal
    : { x: 0, y: 1, z: 0 }; // fallback: treat as flat ground

  return {
    distance: hit.timeOfImpact,
    point:    { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
    normal:   { x: normal.x,  y: normal.y,  z: normal.z },
    collider: hitCollider,
  };
}

// ─── COLLISION EVENT DISPATCH ────────────────────────────────────────────────

/**
 * Poll Rapier's contact pair events and fire onContact callbacks.
 * Call this once per physics step — loop.js or stepPhysics() can call it.
 *
 * Rapier exposes a drain-based event queue; we drain it here and map collider
 * handles back to registry entries to fire the user callbacks.
 */
export function drainContactEvents() {
  if (!world) return;

  world.contactPairsWith(undefined, (h1, h2, started) => {
    // Find registry records that own these colliders and call their callbacks
    for (const [handle, record] of _registry) {
      if (!record.onContact) continue;
      const owns = record.colliders.some(
        c => c.handle === h1 || c.handle === h2
      );
      if (owns) {
        // Determine the other handle
        const otherHandle = _handleForCollider(h1 === record.colliders[0]?.handle ? h2 : h1);
        record.onContact(handle, otherHandle, started);
      }
    }
  });
}

/** Reverse-lookup: collider raw handle → registry string handle */
function _handleForCollider(rawHandle) {
  for (const [handle, record] of _registry) {
    if (record.colliders.some(c => c.handle === rawHandle)) return handle;
  }
  return null;
}

// ─── PRESET BODY CREATORS ────────────────────────────────────────────────────
// Convenience wrappers used by specific systems — avoids repetitive opts objects.

/**
 * Create a car rigid body.
 * Cars use a slightly tall cuboid collider with high linear & angular damping.
 * Friction is low so the suspension/tire forces do all the work.
 *
 * @param {{ x,y,z }} position   - Spawn position
 * @param {THREE.Object3D} mesh  - Visual mesh to sync
 * @param {object} [overrides]   - Merge with defaults
 * @returns {string} handle
 */
export function createCarBody(position, mesh, overrides = {}) {
  return createBody({
    type:           'dynamic',
    position,
    mesh,
    linearDamping:  0.2,
    angularDamping: 0.5,
    ccdEnabled:     true,   // prevents tunnelling at high speed
    canSleep:       false,  // cars should never sleep during a race
    colliders: [{
      shape:       'cuboid',
      args:        [1.0, 0.4, 2.2], // half-extents: ~2m wide, 0.8m tall, 4.4m long
      friction:    0.1,             // very low — tires provide grip, not the chassis
      restitution: 0.05,
      density:     120,             // ~1,500 kg total (reasonable road car)
      offset:      { x: 0, y: 0.4, z: 0 }, // raise centre of collider off road
    }],
    ...overrides,
  });
}

/**
 * Create a player avatar rigid body.
 * Uses a capsule collider (standard for character controllers).
 *
 * @param {{ x,y,z }} position
 * @param {THREE.Object3D} mesh
 * @returns {string} handle
 */
export function createAvatarBody(position, mesh) {
  return createBody({
    type:           'dynamic',
    position,
    mesh,
    linearDamping:  4.0,   // high damping — movement is applied as forces, not velocity
    angularDamping: 100.0, // lock rotation — avatar should never tip over
    gravityScale:   2.0,   // snappier landing feel
    colliders: [{
      shape:       'capsule',
      args:        [0.55, 0.3], // half-height 0.55m, radius 0.3m → ~1.7m tall
      friction:    0.0,         // movement.js applies forces directly
      restitution: 0.0,
    }],
  });
}

/**
 * Create a static building / road collider.
 * Fixed bodies have no mass and never move.
 *
 * @param {{ x,y,z }} position
 * @param {ColliderDef} colliderDef
 * @returns {string} handle
 */
export function createStaticBody(position, colliderDef) {
  return createBody({
    type:      'fixed',
    position,
    colliders: [colliderDef],
  });
}

// ─── WORLD QUERY HELPERS ──────────────────────────────────────────────────────

/**
 * Test whether a world-space point is currently inside any collider.
 * Used by on_foot_mechanics to check if avatar is grounded.
 *
 * @param {{ x,y,z }} point
 * @returns {boolean}
 */
export function isPointInsideCollider(point) {
  if (!world) return false;
  const proj = world.projectPoint(point, true /* solid */);
  return proj !== null && proj.isInside;
}

/**
 * Return all body handles within a sphere.
 * Used by prop destruction (bins, bollards) to find nearby breakables on impact.
 *
 * @param {{ x,y,z }} centre
 * @param {number}    radius
 * @returns {string[]} array of registry handles
 */
export function getBodiesInRadius(centre, radius) {
  if (!world) return [];
  const found = [];

  world.intersectionsWithShape(
    centre,
    { x: 0, y: 0, z: 0, w: 1 }, // identity rotation
    new RAPIER.Ball(radius),
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    (collider) => {
      const handle = _handleForCollider(collider.handle);
      if (handle) found.push(handle);
      return true; // keep searching
    }
  );

  return found;
}

// ─── DEBUG ───────────────────────────────────────────────────────────────────

/**
 * Dump current registry to console — useful during development.
 */
export function debugRegistry() {
  console.group('[physics] Body registry — ' + _registry.size + ' bodies');
  for (const [handle, rec] of _registry) {
    const pos = rec.body.translation();
    console.log(
      handle,
      `| type: ${rec.body.bodyType()}`,
      `| pos: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`,
      `| mesh: ${rec.mesh?.name ?? 'none'}`,
      `| colliders: ${rec.colliders.length}`
    );
  }
  console.groupEnd();
}

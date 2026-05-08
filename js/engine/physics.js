/**
 * physics.js — Custom Rigid-Body Physics (No Rapier / No WASM)
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in replacement for the Rapier-based physics.js.
 * Provides the identical exported API so every other file compiles unchanged.
 *
 * Key decisions:
 *  - Zero CDN dependencies: no WASM fetch, no CDN fail, works offline
 *  - RigidBody API mirrors Rapier exactly (translation, rotation, linvel,
 *    angvel, applyImpulse, applyTorqueImpulse, setLinvel, setAngvel,
 *    setTranslation, setRotation, setAdditionalMass, setBodyType, sleep, isValid)
 *  - world.castRay / world.castRayAndGetNormal use terrain height lookup
 *    (register the height function with setTerrainHeightProvider)
 *  - Fixed-timestep accumulator identical to the Rapier version
 *  - RAPIER stub exported so any file that does `globalThis.RAPIER` still works
 *
 * Part 2 — Physics + car movement
 */

'use strict';

// ─── Terrain Height Provider ──────────────────────────────────────────────────

let _terrainHeightFn = (_x, _z) => 0;

/**
 * Register the terrain height function.
 * terrain.js calls this once its heightmap is ready.
 * @param {function(number, number): number} fn  — (x, z) → world-Y height
 */
export function setTerrainHeightProvider(fn) {
  _terrainHeightFn = fn;
}

// ─── Custom RigidBody ─────────────────────────────────────────────────────────

class RigidBody {
  constructor(desc) {
    this._type   = desc._type  ?? 'dynamic';
    this._pos    = { x: desc._pos.x, y: desc._pos.y, z: desc._pos.z };
    this._rot    = { x: desc._rot.x, y: desc._rot.y, z: desc._rot.z, w: desc._rot.w };
    this._vel    = { x: 0, y: 0, z: 0 };
    this._angvel = { x: 0, y: 0, z: 0 };
    this._mass   = desc._mass ?? 1400;
    // Box inertia defaults (recalculated by setAdditionalMass)
    this._inertia = { x: 2320, y: 2720, z: 480 };
    this._linDamp = desc._linDamp  ?? 0.05;
    this._angDamp = desc._angDamp  ?? 0.10;
    this._gravSc  = desc._gravSc   ?? 1.0;
    this._fAcc   = { x: 0, y: 0, z: 0 };
    this._tAcc   = { x: 0, y: 0, z: 0 };
    this._valid   = true;
    this._sleeping = false;
  }

  translation() { return { x: this._pos.x,    y: this._pos.y,    z: this._pos.z };    }
  rotation()    { return { x: this._rot.x,    y: this._rot.y,    z: this._rot.z,    w: this._rot.w }; }
  linvel()      { return { x: this._vel.x,    y: this._vel.y,    z: this._vel.z };    }
  angvel()      { return { x: this._angvel.x, y: this._angvel.y, z: this._angvel.z }; }
  isValid()     { return this._valid; }
  bodyType()    { return this._type; }

  applyImpulse(imp, _w) {
    if (this._type !== 'dynamic') return;
    const invM = 1 / this._mass;
    this._vel.x += imp.x * invM;
    this._vel.y += imp.y * invM;
    this._vel.z += imp.z * invM;
    this._sleeping = false;
  }

  applyTorqueImpulse(t, _w) {
    if (this._type !== 'dynamic') return;
    this._angvel.x += t.x / this._inertia.x;
    this._angvel.y += t.y / this._inertia.y;
    this._angvel.z += t.z / this._inertia.z;
    this._sleeping = false;
  }

  applyForce(f, _w) {
    if (this._type !== 'dynamic') return;
    this._fAcc.x += f.x; this._fAcc.y += f.y; this._fAcc.z += f.z;
  }

  applyTorque(t, _w) {
    if (this._type !== 'dynamic') return;
    this._tAcc.x += t.x; this._tAcc.y += t.y; this._tAcc.z += t.z;
  }

  setLinvel(v, _w)      { this._vel.x    = v.x; this._vel.y    = v.y; this._vel.z    = v.z; }
  setAngvel(v, _w)      { this._angvel.x = v.x; this._angvel.y = v.y; this._angvel.z = v.z; }
  setTranslation(v, _w) { this._pos.x    = v.x; this._pos.y    = v.y; this._pos.z    = v.z; }
  setRotation(q, _w)    { this._rot.x    = q.x; this._rot.y    = q.y; this._rot.z    = q.z; this._rot.w = q.w; }

  setAdditionalMass(m, _w) {
    this._mass = m;
    const hx = 1.0, hy = 0.28, hz = 2.2;
    this._inertia = {
      x: m / 12 * (4 * hy * hy + 4 * hz * hz),
      y: m / 12 * (4 * hx * hx + 4 * hz * hz),
      z: m / 12 * (4 * hx * hx + 4 * hy * hy),
    };
  }

  setBodyType(type, _w) {
    this._type = ['fixed', 'dynamic', 'kinematic'][type] ?? 'dynamic';
  }

  sleep()   { this._sleeping = true; }
  wakeUp()  { this._sleeping = false; }

  _step(dt) {
    if (this._type !== 'dynamic' || this._sleeping) return;
    const invM = 1 / this._mass;

    // Gravity
    this._vel.y -= 9.81 * this._gravSc * dt;

    // Accumulated forces
    this._vel.x += this._fAcc.x * invM * dt;
    this._vel.y += this._fAcc.y * invM * dt;
    this._vel.z += this._fAcc.z * invM * dt;
    this._fAcc.x = this._fAcc.y = this._fAcc.z = 0;

    // Accumulated torques
    this._angvel.x += this._tAcc.x / this._inertia.x * dt;
    this._angvel.y += this._tAcc.y / this._inertia.y * dt;
    this._angvel.z += this._tAcc.z / this._inertia.z * dt;
    this._tAcc.x = this._tAcc.y = this._tAcc.z = 0;

    // Damping (normalised to 60 Hz baseline so it's frame-rate-independent)
    const ldF = Math.pow(Math.max(0, 1 - this._linDamp), dt * 60);
    this._vel.x *= ldF; this._vel.y *= ldF; this._vel.z *= ldF;

    const adF = Math.pow(Math.max(0, 1 - this._angDamp), dt * 60);
    this._angvel.x *= adF; this._angvel.y *= adF; this._angvel.z *= adF;

    // Integrate position
    this._pos.x += this._vel.x * dt;
    this._pos.y += this._vel.y * dt;
    this._pos.z += this._vel.z * dt;

    // Integrate rotation (axis-angle → quaternion delta)
    const ax = this._angvel.x, ay = this._angvel.y, az = this._angvel.z;
    const omLen = Math.sqrt(ax * ax + ay * ay + az * az);
    if (omLen > 1e-6) {
      const half = omLen * dt * 0.5;
      const s    = Math.sin(half) / omLen;
      const dqx  = ax * s, dqy = ay * s, dqz = az * s, dqw = Math.cos(half);
      const { x: qx, y: qy, z: qz, w: qw } = this._rot;
      this._rot.x = dqw * qx + dqx * qw + dqy * qz - dqz * qy;
      this._rot.y = dqw * qy - dqx * qz + dqy * qw + dqz * qx;
      this._rot.z = dqw * qz + dqx * qy - dqy * qx + dqz * qw;
      this._rot.w = dqw * qw - dqx * qx - dqy * qy - dqz * qz;
      const rLen = Math.sqrt(
        this._rot.x * this._rot.x + this._rot.y * this._rot.y +
        this._rot.z * this._rot.z + this._rot.w * this._rot.w
      );
      if (rLen > 1e-8) {
        this._rot.x /= rLen; this._rot.y /= rLen;
        this._rot.z /= rLen; this._rot.w /= rLen;
      }
    }

    // Ground clamp — car can never fall below terrain + clearance
    const groundY = _terrainHeightFn(this._pos.x, this._pos.z);
    if (!isNaN(groundY) && this._pos.y < groundY + 0.28) {
      this._pos.y = groundY + 0.28;
      if (this._vel.y < 0) this._vel.y *= -0.04; // very soft bounce
    }
  }
}

// ─── Descriptor builders (fluent Rapier-compatible API) ───────────────────────

export class RigidBodyDesc {
  constructor(type) {
    this._type    = type;
    this._pos     = { x: 0, y: 0, z: 0 };
    this._rot     = { x: 0, y: 0, z: 0, w: 1 };
    this._linDamp = 0.05;
    this._angDamp = 0.10;
    this._gravSc  = 1.0;
    this._mass    = 1400;
  }
  static dynamic()                { return new RigidBodyDesc('dynamic'); }
  static fixed()                  { return new RigidBodyDesc('fixed'); }
  static kinematicPositionBased() { return new RigidBodyDesc('kinematic'); }

  setTranslation(x, y, z)  { this._pos    = { x, y, z };  return this; }
  setRotation(q)            { this._rot    = { ...q };      return this; }
  setLinearDamping(v)       { this._linDamp = v;             return this; }
  setAngularDamping(v)      { this._angDamp = v;             return this; }
  setGravityScale(v)        { this._gravSc  = v;             return this; }
  setAdditionalMass(m)      { this._mass    = m;             return this; }
  setCanSleep()             { return this; }
  setCcdEnabled()           { return this; }
}

export class ColliderDesc {
  constructor(shape, args) {
    this._shape       = shape;
    this._args        = args;
    this._offset      = { x: 0, y: 0, z: 0 };
    this._friction    = 0.7;
    this._restitution = 0.1;
    this._density     = 1.0;
    this._sensor      = false;
  }
  static cuboid(hx, hy, hz)       { return new ColliderDesc('cuboid',   [hx, hy, hz]); }
  static capsule(halfH, r)        { return new ColliderDesc('capsule',  [halfH, r]); }
  static ball(r)                  { return new ColliderDesc('ball',     [r]); }
  static cylinder(halfH, r)       { return new ColliderDesc('cylinder', [halfH, r]); }
  static trimesh(verts, indices)  {
    const d = new ColliderDesc('trimesh', []);
    d._vertices = verts; d._indices = indices;
    return d;
  }

  setTranslation(x, y, z) { this._offset      = { x, y, z }; return this; }
  setFriction(v)           { this._friction    = v;            return this; }
  setRestitution(v)        { this._restitution = v;            return this; }
  setDensity(v)            { this._density     = v;            return this; }
  setSensor(v)             { this._sensor      = v;            return this; }
}

// ─── Physics World ────────────────────────────────────────────────────────────

class PhysicsWorld {
  constructor() {
    this._bodies = new Set();
  }

  createRigidBody(desc) {
    const body = new RigidBody(desc);
    this._bodies.add(body);
    return body;
  }

  createCollider(_desc, _body) {
    // Returns a stub collider — no geometry needed for terrain-based raycasts
    return { handle: Math.random() };
  }

  removeRigidBody(body) {
    body._valid = false;
    this._bodies.delete(body);
  }

  step() {
    for (const body of this._bodies) body._step(FIXED_DT);
  }

  /** Terrain-based downward raycast. */
  castRay(ray, maxLen, _solid, _filter) {
    const { origin: o, dir: d } = ray;
    if (!d || d.y >= -0.001) return null;

    const groundY = _terrainHeightFn(o.x, o.z);
    if (isNaN(groundY)) return null;

    const toi = (o.y - groundY) / (-d.y);
    if (toi < 0 || toi > maxLen) return null;
    return { toi, collider: { handle: -1 } };
  }

  castRayAndGetNormal(ray, maxLen, solid, filter) {
    const hit = this.castRay(ray, maxLen, solid, filter);
    if (!hit) return null;

    const { origin: o } = ray;
    const EPS = 0.5;
    const h00 = _terrainHeightFn(o.x - EPS, o.z) || 0;
    const h10 = _terrainHeightFn(o.x + EPS, o.z) || 0;
    const h01 = _terrainHeightFn(o.x, o.z - EPS) || 0;
    const h11 = _terrainHeightFn(o.x, o.z + EPS) || 0;
    const nx  = -(h10 - h00) / (2 * EPS);
    const nz  = -(h11 - h01) / (2 * EPS);
    const len = Math.sqrt(nx * nx + 1 + nz * nz);
    return { ...hit, normal: { x: nx / len, y: 1 / len, z: nz / len } };
  }

  // Stubs
  projectPoint()           { return null; }
  intersectionsWithShape() {}
  contactPairsWith()       {}
}

// ─── RAPIER stub export ────────────────────────────────────────────────────────

export const RAPIER = {
  init:               () => Promise.resolve(),
  Vector3:            class { constructor(x,y,z){ this.x=x;this.y=y;this.z=z; } },
  RigidBodyDesc,
  ColliderDesc,
  QueryFilterFlags:   { EXCLUDE_SENSORS: 0 },
  Ball:               class { constructor(r){ this.r=r; } },
  Ray: class {
    constructor(origin, dir) { this.origin = origin; this.dir = dir; }
    pointAt(t) {
      return {
        x: this.origin.x + this.dir.x * t,
        y: this.origin.y + this.dir.y * t,
        z: this.origin.z + this.dir.z * t,
      };
    }
  },
  World: PhysicsWorld,
};

// ─── Singletons ───────────────────────────────────────────────────────────────

export let world = null;

const _PHYS_PRESET        = (() => { try { return localStorage.getItem('graphicsPreset') ?? 'medium'; } catch { return 'medium'; } })();
const _IS_LOW_PHYS        = _PHYS_PRESET === 'low';
const FIXED_DT            = _IS_LOW_PHYS ? 1 / 30 : 1 / 60;
const MAX_STEPS_PER_FRAME = _IS_LOW_PHYS ? 1 : 5;
let   _accumulator        = 0;

const _registry  = new Map();
let   _nextHandle = 1;

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initPhysics() {
  world = new PhysicsWorld();
  // Expose RAPIER stub globally — car.js's _initPhysics reads globalThis.RAPIER
  globalThis.RAPIER = RAPIER;
  console.log('[physics] ✅ Custom physics init — no WASM, no CDN dependency');
}

// ─── Step ─────────────────────────────────────────────────────────────────────

export function stepPhysics(dt) {
  if (!world) return;
  const safeDt = _IS_LOW_PHYS ? Math.min(dt, 0.05) : dt;
  _accumulator += safeDt;
  let steps = 0;
  while (_accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    world.step();
    _accumulator -= FIXED_DT;
    steps++;
  }
  _syncMeshes();
}

function _syncMeshes() {
  for (const record of _registry.values()) {
    if (!record.mesh || !record.body.isValid()) continue;
    const pos = record.body.translation();
    const rot = record.body.rotation();
    record.mesh.position.set(pos.x, pos.y, pos.z);
    record.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }
}

// ─── Body factory ─────────────────────────────────────────────────────────────

export function createBody(opts) {
  if (!world) throw new Error('[physics] createBody called before initPhysics()');

  const handle = `body_${_nextHandle++}`;

  const desc = opts.type === 'fixed'     ? RigidBodyDesc.fixed()
             : opts.type === 'kinematic' ? RigidBodyDesc.kinematicPositionBased()
             : RigidBodyDesc.dynamic();

  const p = opts.position ?? { x: 0, y: 0, z: 0 };
  desc.setTranslation(p.x, p.y, p.z);
  if (opts.rotation)       desc.setRotation(opts.rotation);
  if (opts.linearDamping  != null) desc.setLinearDamping(opts.linearDamping);
  if (opts.angularDamping != null) desc.setAngularDamping(opts.angularDamping);
  if (opts.gravityScale   != null) desc.setGravityScale(opts.gravityScale);

  const body = world.createRigidBody(desc);

  for (const def of (opts.colliders ?? [])) {
    let cd;
    switch (def.shape) {
      case 'cuboid':   cd = ColliderDesc.cuboid(...def.args); break;
      case 'capsule':  cd = ColliderDesc.capsule(...def.args); break;
      case 'ball':     cd = ColliderDesc.ball(def.args[0]); break;
      case 'cylinder': cd = ColliderDesc.cylinder(...def.args); break;
      case 'trimesh':  cd = ColliderDesc.trimesh(def.vertices, def.indices); break;
      default: continue;
    }
    if (def.friction    != null) cd.setFriction(def.friction);
    if (def.restitution != null) cd.setRestitution(def.restitution);
    if (def.density     != null) cd.setDensity(def.density);
    if (def.sensor      != null) cd.setSensor(def.sensor);
    if (def.offset)              cd.setTranslation(def.offset.x, def.offset.y, def.offset.z);
    world.createCollider(cd, body);
  }

  if (opts.startSleeping) body.sleep();

  _registry.set(handle, {
    body,
    colliders: [],
    mesh:      opts.mesh      ?? null,
    onContact: opts.onContact ?? null,
  });

  return handle;
}

export function removeBody(handle) {
  const record = _registry.get(handle);
  if (!record) return;
  if (record.body.isValid()) world.removeRigidBody(record.body);
  _registry.delete(handle);
}

export function getBody(handle) {
  return _registry.get(handle)?.body ?? null;
}

export function setBodyMesh(handle, mesh) {
  const record = _registry.get(handle);
  if (record) record.mesh = mesh;
}

// ─── Raycast ──────────────────────────────────────────────────────────────────

export function castRay(origin, direction, maxDistance, solid = true) {
  if (!world) return null;
  const ray = new RAPIER.Ray(origin, direction);
  const hit = world.castRay(ray, maxDistance, solid);
  if (!hit) return null;
  const hn  = world.castRayAndGetNormal(ray, maxDistance, solid);
  return {
    distance: hit.toi,
    point: {
      x: origin.x + direction.x * hit.toi,
      y: origin.y + direction.y * hit.toi,
      z: origin.z + direction.z * hit.toi,
    },
    normal:   hn?.normal ?? { x: 0, y: 1, z: 0 },
    collider: hit.collider,
  };
}

// ─── Preset body creators ─────────────────────────────────────────────────────

export function createCarBody(position, mesh, overrides = {}) {
  return createBody({
    type: 'dynamic', position, mesh,
    linearDamping: 0.2, angularDamping: 0.5,
    colliders: [{
      shape: 'cuboid', args: [1.0, 0.4, 2.2],
      friction: 0.1, restitution: 0.05, density: 120,
      offset: { x: 0, y: 0.4, z: 0 },
    }],
    ...overrides,
  });
}

export function createAvatarBody(position, mesh) {
  return createBody({
    type: 'dynamic', position, mesh,
    linearDamping: 4.0, angularDamping: 100.0, gravityScale: 2.0,
    colliders: [{ shape: 'capsule', args: [0.55, 0.3], friction: 0.0, restitution: 0.0 }],
  });
}

export function createStaticBody(position, colliderDef) {
  return createBody({ type: 'fixed', position, colliders: [colliderDef] });
}

// ─── Stubs for unused query helpers ──────────────────────────────────────────

export function drainContactEvents()       { /* no-op */ }
export function isPointInsideCollider()    { return false; }
export function getBodiesInRadius()        { return []; }

export function debugRegistry() {
  console.group('[physics] Body registry — ' + _registry.size + ' bodies');
  for (const [handle, rec] of _registry) {
    const pos = rec.body.translation();
    console.log(handle, `pos:(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`);
  }
  console.groupEnd();
}

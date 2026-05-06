/**
 * js/fx/ParticleFX.js  —  Part 8: Dirt & Dust Particle System
 * =============================================================
 * GPU particle system: 80,000 particles (20,000 per tyre).
 *
 * Features:
 *  - Biome-tinted particles: sand / volcanic ash / mud / wet sand
 *  - Two layers per wheel: heavy gravel (gravity 9.8) + light dust (gravity 0.5)
 *  - Wheelspin burst: massive spray when wheel RPM >> ground speed
 *  - Only spawns on loose surfaces (dunas, caldera, baja, farmland, riviera, jungle)
 *  - Tarmac/cobblestone/festival surfaces: no particles
 *  - Procedural canvas dirt-sprite texture (no asset required)
 *  - Perspective-correct point sizes via custom ShaderMaterial
 *  - Soft fade-out by life fraction; size grows as particles age (expansion)
 *
 * Public API
 * ----------
 *  initParticleFX(scene)              → handle
 *  updateParticleFX(handle, car, driveState, dt)
 *    car        — { position, quaternion, speedKmh, _wheelMeshes }
 *    driveState — { throttle, brake, surfaceType }   (from DrivingController)
 *  setParticleQuality(handle, 'low'|'medium'|'high'|'ultra')
 *  disposeParticleFX(handle)
 */

import * as THREE from 'three';
import { getBiome } from '../world/terrain.js';

// ─── Pool sizing ─────────────────────────────────────────────────────────────
const POOL_PER_TYRE  = 20_000;
const TYRE_COUNT     = 4;
const N              = POOL_PER_TYRE * TYRE_COUNT;   // 80 000 total

// ─── Biome surface classification ─────────────────────────────────────────────
const LOOSE_BIOMES = new Set(['dunas', 'caldera', 'baja', 'farmland', 'riviera', 'jungle']);

// Biome → { dust: hex, gravel: hex, wet: bool }
const BIOME_COLOURS = {
  dunas:      { dust: 0xf5deb3, gravel: 0xe8c87a, wet: false },  // warm wheat sand
  caldera:    { dust: 0x3d1a00, gravel: 0x1a0800, wet: false },  // volcanic dark
  baja:       { dust: 0xc2956a, gravel: 0x9b6b42, wet: false },  // cracked earth
  farmland:   { dust: 0x4a3020, gravel: 0x3a2215, wet: true  },  // dark mud
  riviera:    { dust: 0xddd0a0, gravel: 0xb8a870, wet: true  },  // wet beach sand
  jungle:     { dust: 0x3d2b1a, gravel: 0x2d1e10, wet: true  },  // jungle mud
};

// ─── Particle physics constants ───────────────────────────────────────────────
const GRAVITY_HEAVY  = 9.8;    // gravel / clumps
const GRAVITY_LIGHT  = 0.5;    // fine dust plume
const LIFE_MIN       = 0.8;
const LIFE_MAX       = 2.0;
const LIFE_DUST_MIN  = 1.2;
const LIFE_DUST_MAX  = 2.8;    // dust lingers longer

// ─── Quality presets (spawn count multiplier) ────────────────────────────────
const QUALITY_SCALE = { low: 0.025, medium: 0.125, high: 0.375, ultra: 0.75, extreme: 1.0 };

// ─── Wheel offsets (mirror car.js WHEEL_OFFSETS) ─────────────────────────────
const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];

// ─── Vertex shader ────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute float aSize;
  attribute float aLifeFrac;   // life / maxLife  (0 = dead, 1 = just born)
  attribute vec3  aColor;

  varying float vAlpha;
  varying vec3  vColor;

  void main() {
    vAlpha = aLifeFrac;
    vColor = aColor;

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);

    // Perspective scaling: size in world-meters → pixels
    // aSize is in metres; 300 is an empirical pixel-at-1m calibration
    gl_PointSize = max(1.0, aSize * 300.0 / -mvPos.z);

    gl_Position = projectionMatrix * mvPos;
  }
`;

// ─── Fragment shader ──────────────────────────────────────────────────────────
const FRAG = /* glsl */`
  uniform sampler2D uSprite;

  varying float vAlpha;
  varying vec3  vColor;

  void main() {
    if (vAlpha <= 0.0) discard;

    vec4 tex = texture2D(uSprite, gl_PointCoord);
    if (tex.a < 0.01) discard;

    // Slight colour darkening as particle ages (gets dirty / shadowed)
    vec3 col = vColor * mix(1.0, 0.55, 1.0 - vAlpha);
    gl_FragColor = vec4(col, tex.a * vAlpha * 0.88);
  }
`;

// ─── Procedural sprite (soft pebble / dust disc) ─────────────────────────────
function makeDirtSprite() {
  const SIZE = 64;
  const c    = document.createElement('canvas');
  c.width    = SIZE;
  c.height   = SIZE;
  const ctx  = c.getContext('2d');
  const cx   = SIZE / 2;

  // Soft radial gradient: white centre → transparent edge
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0,    'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.70)');
  g.addColorStop(0.80, 'rgba(255,255,255,0.20)');
  g.addColorStop(1,    'rgba(255,255,255,0.00)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const tex     = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// ─── Helper: unpack hex colour → [r,g,b] 0..1 ────────────────────────────────
function hexToRGB(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >>  8) & 0xff) / 255,
    ( hex        & 0xff) / 255,
  ];
}

// ─── Temporary objects (avoid per-frame allocations) ─────────────────────────
const _tmpVec3   = new THREE.Vector3();
const _carVel    = new THREE.Vector3();

// ─── Main factory ─────────────────────────────────────────────────────────────
/**
 * @param {THREE.Scene} scene
 * @returns {object} handle — pass to updateParticleFX / disposeParticleFX
 */
export function initParticleFX(scene) {
  // ── CPU-side arrays ──────────────────────────────────────────────────────
  const posArr      = new Float32Array(N * 3);
  const velArr      = new Float32Array(N * 3);     // CPU only
  const lifeArr     = new Float32Array(N);         // remaining seconds
  const maxLifeArr  = new Float32Array(N);         // spawn lifetime
  const gravArr     = new Float32Array(N);         // per-particle gravity
  // GPU attribute arrays
  const colorArr    = new Float32Array(N * 3);
  const sizeArr     = new Float32Array(N);
  const lifeFracArr = new Float32Array(N);         // pushed to GPU each frame

  // ── BufferGeometry ───────────────────────────────────────────────────────
  const geo = new THREE.BufferGeometry();
  const posAttr      = new THREE.BufferAttribute(posArr,      3);
  const colorAttr    = new THREE.BufferAttribute(colorArr,    3);
  const sizeAttr     = new THREE.BufferAttribute(sizeArr,     1);
  const lifeFracAttr = new THREE.BufferAttribute(lifeFracArr, 1);

  posAttr.usage      = THREE.DynamicDrawUsage;
  colorAttr.usage    = THREE.DynamicDrawUsage;
  sizeAttr.usage     = THREE.DynamicDrawUsage;
  lifeFracAttr.usage = THREE.DynamicDrawUsage;

  geo.setAttribute('position',  posAttr);
  geo.setAttribute('aColor',    colorAttr);
  geo.setAttribute('aSize',     sizeAttr);
  geo.setAttribute('aLifeFrac', lifeFracAttr);

  // ── ShaderMaterial ───────────────────────────────────────────────────────
  const sprite = makeDirtSprite();

  const mat = new THREE.ShaderMaterial({
    uniforms:       { uSprite: { value: sprite } },
    vertexShader:   VERT,
    fragmentShader: FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.NormalBlending,
    vertexColors:   false,   // using custom attributes instead
  });

  // ── Points mesh ──────────────────────────────────────────────────────────
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;  // always render; particles can be anywhere
  points.name = 'DirtParticleFX';
  scene.add(points);

  // ── Free-list (ring buffer head pointer) ─────────────────────────────────
  let   writeHead     = 0;   // next slot to attempt to reclaim
  let   qualityMul    = 1.0;

  // ── Previous car position (for velocity estimation) ──────────────────────
  const _prevCarPos = new THREE.Vector3();
  let   _prevPosSet = false;

  // ── Spawn helper ─────────────────────────────────────────────────────────
  function spawnParticle(
    wx, wy, wz,          // world-space spawn position
    cvx, cvy, cvz,       // car velocity (world-space, m/s)
    r, g, b,             // colour
    isHeavy,             // true = gravel, false = dust
  ) {
    // Find a dead slot (scan forward from head)
    let slot = -1;
    for (let attempt = 0; attempt < N; attempt++) {
      const idx = (writeHead + attempt) % N;
      if (lifeArr[idx] <= 0) { slot = idx; writeHead = (idx + 1) % N; break; }
    }
    if (slot < 0) return;  // pool exhausted — skip

    const i3 = slot * 3;

    // Position: contact patch + tiny random offset in XZ plane
    posArr[i3    ] = wx + (Math.random() - 0.5) * 0.30;
    posArr[i3 + 1] = wy;
    posArr[i3 + 2] = wz + (Math.random() - 0.5) * 0.30;

    // Velocity: upward + car-velocity fraction (backward spray) + spread
    const upward   = isHeavy
      ? 2.0 + Math.random() * 2.5   // 2–4.5 m/s up
      : 1.5 + Math.random() * 4.0;  // 1.5–5.5 m/s up (dust billows more)

    velArr[i3    ] = cvx * 0.15 + (Math.random() - 0.5) * 1.5;
    velArr[i3 + 1] = upward;
    velArr[i3 + 2] = cvz * 0.15 + (Math.random() - 0.5) * 1.5;

    // Lifetime
    const minL = isHeavy ? LIFE_MIN  : LIFE_DUST_MIN;
    const maxL = isHeavy ? LIFE_MAX  : LIFE_DUST_MAX;
    const life = minL + Math.random() * (maxL - minL);
    lifeArr[slot]    = life;
    maxLifeArr[slot] = life;

    // Physics
    gravArr[slot] = isHeavy ? GRAVITY_HEAVY : GRAVITY_LIGHT;

    // Visual
    // Size: gravel 0.04–0.12 m, dust 0.06–0.22 m (expands as it disperses)
    sizeArr[slot] = isHeavy
      ? 0.04 + Math.random() * 0.08
      : 0.06 + Math.random() * 0.16;

    colorArr[i3    ] = r;
    colorArr[i3 + 1] = g;
    colorArr[i3 + 2] = b;

    lifeFracArr[slot] = 1.0;
  }

  // ── Spawn burst per wheel ──────────────────────────────────────────────
  function spawnBurst(
    count, wx, wy, wz,
    cvx, cvy, cvz,
    dustRGB, gravelRGB,
    heavyFrac,          // 0..1 — proportion of heavy/gravel particles
  ) {
    const n = Math.round(count * qualityMul);
    for (let i = 0; i < n; i++) {
      const isHeavy = Math.random() < heavyFrac;
      const col     = isHeavy ? gravelRGB : dustRGB;
      spawnParticle(wx, wy, wz, cvx, cvy, cvz, col[0], col[1], col[2], isHeavy);
    }
  }

  // ── Per-frame update ───────────────────────────────────────────────────────
  function update(car, driveState, dt) {
    if (!car || !car.mesh) return;

    const pos       = car.position;           // THREE.Vector3
    const speedKmh  = car.speedKmh ?? 0;
    const speedMs   = speedKmh / 3.6;
    const throttle  = driveState?.throttle   ?? 0;
    const brake     = driveState?.brake      ?? 0;
    const surfType  = driveState?.surfaceType ?? 'tarmac';

    // ── Estimate car velocity from position delta ─────────────────────────
    if (!_prevPosSet) { _prevCarPos.copy(pos); _prevPosSet = true; }
    if (dt > 0) {
      _carVel.set(
        (pos.x - _prevCarPos.x) / dt,
        (pos.y - _prevCarPos.y) / dt,
        (pos.z - _prevCarPos.z) / dt,
      );
    }
    _prevCarPos.copy(pos);

    // ── Determine biome & whether loose surface ────────────────────────────
    const biome      = getBiome(pos.x, pos.z);
    const isLoose    = LOOSE_BIOMES.has(biome);

    // ── Compute spawn counts ───────────────────────────────────────────────
    let gravelCount = 0;
    let dustCount   = 0;

    if (isLoose) {
      // Wheelspin: strong throttle at low speed → big burst
      const spinRatio = (speedMs > 0.1) ? throttle / (speedMs * 0.12 + 0.1) : throttle * 8;
      const spin      = Math.min(spinRatio, 1.0);

      // Base emission proportional to speed + spin
      const baseRate  = (speedMs * 0.8 + spin * 12) * dt;

      gravelCount = Math.round(baseRate * 6  + spin * 18);
      dustCount   = Math.round(baseRate * 14 + spin * 40);

      // Braking on loose surface also kicks up grit
      if (brake > 0.3) {
        gravelCount += Math.round(brake * 8);
        dustCount   += Math.round(brake * 20);
      }
    }

    // ── Get biome colours ──────────────────────────────────────────────────
    const bCol      = BIOME_COLOURS[biome] ?? BIOME_COLOURS.baja;
    const dustRGB   = hexToRGB(bCol.dust);
    const gravelRGB = hexToRGB(bCol.gravel);
    const heavyFrac = 0.35;   // 35% heavy gravel, 65% light dust

    // ── Spawn per-wheel ────────────────────────────────────────────────────
    if ((gravelCount > 0 || dustCount > 0) && car._wheelMeshes) {
      car._wheelMeshes.forEach((wheelGroup) => {
        wheelGroup.getWorldPosition(_tmpVec3);
        const wx = _tmpVec3.x;
        const wy = _tmpVec3.y;      // ground level (bottom of wheel)
        const wz = _tmpVec3.z;

        const cvx = _carVel.x;
        const cvy = _carVel.y;
        const cvz = _carVel.z;

        const total = gravelCount + dustCount;
        spawnBurst(total, wx, wy, wz, cvx, cvy, cvz, dustRGB, gravelRGB, heavyFrac);
      });
    }

    // ── Integrate all alive particles ──────────────────────────────────────
    let anyAlive = false;
    for (let i = 0; i < N; i++) {
      if (lifeArr[i] <= 0) continue;
      anyAlive = true;

      lifeArr[i] -= dt;

      if (lifeArr[i] <= 0) {
        lifeArr[i]    = 0;
        lifeFracArr[i] = 0;
        // Park dead particle far below ground so it's invisible
        posArr[i * 3 + 1] = -999;
        continue;
      }

      const i3 = i * 3;

      // Euler integrate position
      posArr[i3    ] += velArr[i3    ] * dt;
      posArr[i3 + 1] += velArr[i3 + 1] * dt;
      posArr[i3 + 2] += velArr[i3 + 2] * dt;

      // Gravity on Y
      velArr[i3 + 1] -= gravArr[i] * dt;

      // Clamp to ground (y >= terrain — use simple flat clamp for now)
      if (posArr[i3 + 1] < 0) {
        posArr[i3 + 1] = 0;
        velArr[i3 + 1] = 0;
        // Dampen horizontal on ground contact
        velArr[i3    ] *= 0.4;
        velArr[i3 + 2] *= 0.4;
      }

      // Life fraction for alpha (1 = just born → 0 = dead)
      lifeFracArr[i] = lifeArr[i] / maxLifeArr[i];

      // Size expansion for dust: grows to 1.5× by half-life
      if (gravArr[i] < 1.0) {  // is dust
        const age = 1.0 - lifeFracArr[i];
        sizeArr[i] *= 1.0 + age * 0.004;  // subtle growth each frame
      }
    }

    // ── Push dirty buffers to GPU ─────────────────────────────────────────
    posAttr.needsUpdate      = true;
    lifeFracAttr.needsUpdate = true;
    sizeAttr.needsUpdate     = true;
    // colorAttr only changes on spawn, not every frame — skip unless spawning
    if (gravelCount > 0 || dustCount > 0) {
      colorAttr.needsUpdate = true;
    }

    // Tight bounding sphere so frustum cull doesn't kill it prematurely
    geo.computeBoundingSphere();
  }

  // ── Quality setter ────────────────────────────────────────────────────────
  function setQuality(preset) {
    qualityMul = QUALITY_SCALE[preset] ?? 1.0;
  }

  // ── Dispose ───────────────────────────────────────────────────────────────
  function dispose() {
    scene.remove(points);
    geo.dispose();
    mat.dispose();
    sprite.dispose();
  }

  return { update, setQuality, dispose, points };
}

/**
 * Convenience wrapper — call once per UPDATE tick.
 *
 * @param {object}  handle      — returned by initParticleFX
 * @param {object}  car         — playerCar instance
 * @param {object}  driveState  — { throttle, brake, surfaceType }
 * @param {number}  dt          — delta time in seconds
 */
export function updateParticleFX(handle, car, driveState, dt) {
  if (handle?.update) handle.update(car, driveState, dt);
}

/**
 * Change render quality at runtime.
 * @param {object} handle
 * @param {'low'|'medium'|'high'|'ultra'} preset
 */
export function setParticleQuality(handle, preset) {
  if (handle?.setQuality) handle.setQuality(preset);
}

/** Free GPU resources. */
export function disposeParticleFX(handle) {
  if (handle?.dispose) handle.dispose();
}

/**
 * SkySystem.js  —  Part 4: HDR Sky & Atmosphere
 * ─────────────────────────────────────────────────────────────────────────────
 * Physically-based Preetham sky dome, real-time PMREM environment bake,
 * procedural animated cloud layers, and a smooth day/night lerp system.
 *
 * FH5 settings targeted:
 *   Shader Quality       — Ultra
 *   Environment Texture  — Extreme (PMREM baked at 256 px, re-baked on tod change)
 *
 * Exports:
 *   initSkySystem(scene, renderer, camera)  — call once after initRenderer()
 *   updateSky(dt, gameHour)                 — call each LATE tick
 *   getSunDirection()                       — THREE.Vector3, used by Water/CSM
 *   forceTimeOfDay(hour)                    — jump to hour without lerp (cutscenes)
 *
 * Integration:
 *   1. Call initSkySystem() in main.js after initRenderer()
 *   2. Replace renderer.js setTimeOfDay() with a call to updateSky() in
 *      environment.js's tick(), passing getHour()
 *   3. Pass getSunDirection() to CSM (Part 6) and Water (Part 16)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { Sky }            from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ─── Module-level singletons ──────────────────────────────────────────────────

/** @type {Sky} */
let _sky = null;

/** @type {THREE.PMREMGenerator} */
let _pmrem = null;

/** @type {THREE.WebGLRenderer} */
let _renderer = null;

/** @type {THREE.Scene} */
let _scene = null;

/** @type {THREE.Camera}  (only needed for cloud billboard facing) */
let _camera = null;

/** Current sun direction (unit vector, world space). */
const _sunDir = new THREE.Vector3();

/** Baked env-map texture — updated whenever sky changes significantly. */
let _envTex = null;

/** Timer to throttle PMREM re-bakes (expensive — once per ~2 s is enough). */
let _pmremTimer = 0;
const PMREM_REBAKE_INTERVAL = 2.0; // seconds

// ─── Sky parameter keyframes (keyed by in-game hour 0–23) ────────────────────
//
// Each keyframe describes the Preetham uniforms + fog for that hour.
// We bilinear-lerp between the two surrounding keyframes every frame.

const SKY_KF = [
  // hour  turbidity  rayleigh   mie      mieG    exposure  fogNear  fogFar  fogHex
  {  h:  0, turb: 8.0, ray: 0.4,  mie: 0.003, mieG: 0.75, expo: 0.25, fn: 150,  ff: 600,  fog: 0x050a1a },
  {  h:  4, turb: 5.0, ray: 0.8,  mie: 0.004, mieG: 0.78, expo: 0.35, fn: 200,  ff: 700,  fog: 0x1a1228 },
  {  h:  6, turb: 3.5, ray: 2.8,  mie: 0.009, mieG: 0.84, expo: 0.70, fn: 250,  ff: 800,  fog: 0xc45c28 },
  {  h:  8, turb: 3.2, ray: 1.8,  mie: 0.007, mieG: 0.83, expo: 0.92, fn: 300,  ff: 950,  fog: 0xd4956a },
  { h: 12, turb: 3.8, ray: 1.5,  mie: 0.007, mieG: 0.82, expo: 1.00, fn: 300,  ff: 1200, fog: 0xd4956a },
  { h: 15, turb: 4.0, ray: 1.6,  mie: 0.008, mieG: 0.82, expo: 0.97, fn: 300,  ff: 1100, fog: 0xc8845c },
  { h: 18, turb: 5.0, ray: 2.2,  mie: 0.010, mieG: 0.84, expo: 0.75, fn: 200,  ff: 800,  fog: 0xb04820 },
  { h: 20, turb: 6.5, ray: 0.8,  mie: 0.005, mieG: 0.78, expo: 0.45, fn: 150,  ff: 600,  fog: 0x3a1a0a },
  { h: 24, turb: 8.0, ray: 0.4,  mie: 0.003, mieG: 0.75, expo: 0.25, fn: 150,  ff: 600,  fog: 0x050a1a },
];

// ─── Cloud configuration ──────────────────────────────────────────────────────

const CLOUD_LAYERS = [
  // Altitude above sea level, scroll speed (m/s), opacity, scale (m), tint
  { y: 1800, speed: 4,  opacity: 0.55, scale: 14000, tint: 0xffffff },
  { y: 2600, speed: 7,  opacity: 0.35, scale: 18000, tint: 0xf0f4ff },
  { y: 3400, speed: 11, opacity: 0.20, scale: 24000, tint: 0xe8eeff },
];

/** @type {Array<{mesh: THREE.Mesh, speed: number, canvas: HTMLCanvasElement}>} */
const _cloudMeshes = [];

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the sky system.  Must be called once, after initRenderer().
 *
 * @param {THREE.Scene}          scene
 * @param {THREE.WebGLRenderer}  renderer
 * @param {THREE.Camera}         camera
 */
export function initSkySystem(scene, renderer, camera) {
  _scene    = scene;
  _renderer = renderer;
  _camera   = camera;

  _pmrem = new THREE.PMREMGenerator(_renderer);
  _pmrem.compileEquirectangularShader();

  try {
    _buildSky();
    _buildClouds();
    _bakePMREM();
    // Set initial sky to FH5 afternoon default (15:00, Mexico feel)
    forceTimeOfDay(15);
    console.log('[SkySystem] ✅ Part 4 — HDR sky, PMREM env, 3-layer clouds ready');
  } catch (err) {
    // Fallback: warm amber FH5 sky if Sky addon fails (CDN issues, etc.)
    console.warn('[SkySystem] Sky addon failed, using fallback amber sky:', err.message);
    _scene.background = new THREE.Color(0xd4956a);
    _scene.fog = new THREE.Fog(0xd4956a, 300, 1200);
  }
}

// ─── Sky dome ─────────────────────────────────────────────────────────────────

function _buildSky() {
  _sky = new Sky();
  _sky.scale.setScalar(500_000);
  _sky.name = 'SkyDome';
  // Frustum culling OFF — sky follows the camera so Three.js would cull it.
  _sky.frustumCulled = false;
  _scene.add(_sky);

  // Keep a sky-blue fallback background — NEVER null.
  // If the Sky shader fails to compile or tonemapping overexposes it,
  // this colour shows instead of white-canvas bleedthrough.
  _scene.background = new THREE.Color(0x87ceeb);

  const su = _sky.material.uniforms;
  su.turbidity.value        = 3.5;
  su.rayleigh.value         = 1.4;
  su.mieCoefficient.value   = 0.007;
  su.mieDirectionalG.value  = 0.82;

  // FH5 Mexico: sun at 35° elevation, azimuth 210° (SSW = warm afternoon light)
  _setSunFromAzEl(210, 35);
}

/**
 * Position sun from azimuth (°, clockwise from north) and elevation (°).
 * Updates both the Sky uniform and the exported _sunDir vector.
 *
 * @param {number} azimuthDeg
 * @param {number} elevationDeg
 */
function _setSunFromAzEl(azimuthDeg, elevationDeg) {
  const phi   = THREE.MathUtils.degToRad(90 - elevationDeg);   // polar (0=zenith)
  const theta = THREE.MathUtils.degToRad(azimuthDeg);           // azimuth

  _sunDir.setFromSphericalCoords(1, phi, theta);
  _sky.material.uniforms.sunPosition.value.copy(_sunDir);
}

// ─── Cloud layers ─────────────────────────────────────────────────────────────

function _buildClouds() {
  CLOUD_LAYERS.forEach((cfg, i) => {
    // Procedural cloud texture on a canvas
    const tex = _makeCloudTexture(512, i);

    const mat = new THREE.MeshBasicMaterial({
      map:         tex,
      transparent: true,
      opacity:     cfg.opacity,
      depthWrite:  false,
      side:        THREE.FrontSide,
      blending:    THREE.NormalBlending,
      color:       new THREE.Color(cfg.tint),
    });

    const geo  = new THREE.PlaneGeometry(cfg.scale, cfg.scale);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = cfg.y;
    mesh.name = `CloudLayer_${i}`;
    mesh.renderOrder = -1; // render behind everything else

    _scene.add(mesh);
    _cloudMeshes.push({ mesh, speed: cfg.speed, canvas: tex.image });
  });
}

/**
 * Generate a soft procedural cloud texture.
 * Uses multiple blurred ellipses to mimic cumulus shapes.
 *
 * @param {number} size   Canvas dimension (px)
 * @param {number} seed   Varies cloud pattern per layer
 * @returns {THREE.CanvasTexture}
 */
function _makeCloudTexture(size, seed) {
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);

  // Seeded pseudo-random
  let rng = seed * 9301 + 49297;
  const rand = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };

  // Draw 28 soft cloud puffs
  const puffs = 28;
  for (let p = 0; p < puffs; p++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const rx = 40 + rand() * 90;
    const ry = 20 + rand() * 45;
    const angle = rand() * Math.PI;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    grad.addColorStop(0,   `rgba(255,255,255,${0.35 + rand() * 0.3})`);
    grad.addColorStop(0.5, `rgba(255,255,255,${0.12 + rand() * 0.12})`);
    grad.addColorStop(1,   'rgba(255,255,255,0)');

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.scale(1, ry / rx);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ─── PMREM bake ───────────────────────────────────────────────────────────────

/**
 * Re-bake the sky into a PMREM cube map and set it as scene.environment.
 * This makes ALL PBR materials automatically reflect the real sky.
 * Expensive — throttled to once every PMREM_REBAKE_INTERVAL seconds.
 */
function _bakePMREM() {
  if (_envTex) _envTex.dispose();

  // Render sky into a cube map via PMREMGenerator
  _envTex = _pmrem.fromScene(_sky, 0.04).texture;

  _scene.environment    = _envTex;
  _scene.environmentIntensity = 1.0;

  _pmremTimer = 0;
}

// ─── Keyframe interpolation ───────────────────────────────────────────────────

/** Linearly interpolate a named numeric field across keyframe array. */
function _lerpKF(field, hour) {
  // wrap hour to [0,24)
  const h = ((hour % 24) + 24) % 24;
  let lo = SKY_KF[SKY_KF.length - 2];
  let hi = SKY_KF[SKY_KF.length - 1];
  for (let i = 0; i < SKY_KF.length - 1; i++) {
    if (h >= SKY_KF[i].h && h < SKY_KF[i + 1].h) {
      lo = SKY_KF[i];
      hi = SKY_KF[i + 1];
      break;
    }
  }
  const span = hi.h - lo.h;
  const t    = span > 0 ? (h - lo.h) / span : 0;
  return lo[field] * (1 - t) + hi[field] * t;
}

/** Interpolate a hex colour field across keyframes. */
function _lerpKFColor(field, hour, target = new THREE.Color()) {
  const h = ((hour % 24) + 24) % 24;
  let lo = SKY_KF[SKY_KF.length - 2];
  let hi = SKY_KF[SKY_KF.length - 1];
  for (let i = 0; i < SKY_KF.length - 1; i++) {
    if (h >= SKY_KF[i].h && h < SKY_KF[i + 1].h) {
      lo = SKY_KF[i];
      hi = SKY_KF[i + 1];
      break;
    }
  }
  const span = hi.h - lo.h;
  const t    = span > 0 ? (h - lo.h) / span : 0;
  target.setHex(lo[field]).lerp(new THREE.Color(hi[field]), t);
  return target;
}

// ─── Sun arc ──────────────────────────────────────────────────────────────────

/**
 * Convert a game hour (0–24) to sun azimuth + elevation degrees.
 *
 * Orbit model:
 *  - Hour 6  → sunrise, elevation ~0°, azimuth 70° (NNE, Mexico latitude)
 *  - Hour 12 → solar noon, elevation 68°, azimuth 180° (due south)
 *  - Hour 18 → sunset, elevation ~0°, azimuth 290° (WNW)
 *  - Night   → sun below horizon (elevation negative — sky stays dark)
 *
 * @param {number} hour
 * @returns {{ az: number, el: number }}
 */
function _sunAzEl(hour) {
  // Normalise to solar-angle fraction (0=midnight, 0.5=noon)
  const frac = hour / 24;
  // Elevation: sine curve, peak at noon ~68°, negative at night
  const el = Math.sin(frac * Math.PI * 2 - Math.PI * 0.5) * 68;
  // Azimuth: linearly sweeps from east (70°) at sunrise to west (290°) at sunset
  const sunriseFrac = 6 / 24;
  const sunsetFrac  = 18 / 24;
  let az;
  if (frac >= sunriseFrac && frac <= sunsetFrac) {
    const dayT = (frac - sunriseFrac) / (sunsetFrac - sunriseFrac);
    az = 70 + dayT * 220;  // 70° → 290°
  } else {
    // Night: continue sweeping underground
    const nightFrac = frac < sunriseFrac
      ? (frac + 1 - sunsetFrac) / (1 - sunsetFrac + sunriseFrac)
      : (frac - sunsetFrac) / (1 - sunsetFrac + sunriseFrac);
    az = 290 + nightFrac * (70 + 360 - 290);
    az = ((az % 360) + 360) % 360;
  }
  return { az, el };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** @type {number} Current smooth game hour (driven by updateSky). */
let _currentHour = 15;
/** @type {number} Target hour (set by forceTimeOfDay or driven by environment.js). */
let _targetHour  = 15;

/**
 * Main per-frame update.  Call from environment.js tick(), passing getHour().
 *
 * @param {number} dt        Delta time in seconds
 * @param {number} gameHour  Current game hour (0–24)
 */
export function updateSky(dt, gameHour) {
  _targetHour = gameHour;

  // Smooth the displayed hour to avoid jarring jumps (lerp speed: 1 hr / 4 s real)
  const maxStep = dt * 6;
  let diff = _targetHour - _currentHour;
  // Handle wrap-around near midnight
  if (diff > 12)  diff -= 24;
  if (diff < -12) diff += 24;
  _currentHour += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
  _currentHour = ((_currentHour % 24) + 24) % 24;

  const h = _currentHour;

  // ── Sky dome follows camera + scales to fit any far plane ─────────────────
  if (_sky && _camera) {
    _sky.position.copy(_camera.position);
    // Scale sky to 90 % of the camera far plane so it is always within the
    // depth range regardless of preset.  Clamped to 500 000 max (Preetham
    // shader precision starts degrading beyond that).
    const skyR = Math.min(500_000, _camera.far * 0.9);
    _sky.scale.setScalar(skyR);
  }

  // ── Sky dome uniforms ───────────────────────────────────────────────────────
  const su = _sky.material.uniforms;
  su.turbidity.value       = _lerpKF('turb', h);
  su.rayleigh.value        = _lerpKF('ray',  h);
  su.mieCoefficient.value  = _lerpKF('mie',  h);
  su.mieDirectionalG.value = _lerpKF('mieG', h);

  // ── Sun position ────────────────────────────────────────────────────────────
  const { az, el } = _sunAzEl(h);
  _setSunFromAzEl(az, el);

  // ── Renderer tone mapping exposure ─────────────────────────────────────────
  const targetExpo = _lerpKF('expo', h);
  _renderer.toneMappingExposure = THREE.MathUtils.lerp(
    _renderer.toneMappingExposure, targetExpo, dt * 1.5
  );

  // ── Fog ────────────────────────────────────────────────────────────────────
  if (_scene.fog) {
    _lerpKFColor('fog', h, _scene.fog.color);
    _scene.fog.near = THREE.MathUtils.lerp(_scene.fog.near, _lerpKF('fn', h), dt * 0.8);
    _scene.fog.far  = THREE.MathUtils.lerp(_scene.fog.far,  _lerpKF('ff', h), dt * 0.8);
  }

  // ── PMREM re-bake (throttled) ───────────────────────────────────────────────
  _pmremTimer += dt;
  if (_pmremTimer >= PMREM_REBAKE_INTERVAL) {
    _bakePMREM();
  }

  // ── Clouds ─────────────────────────────────────────────────────────────────
  _updateClouds(dt, h);
}

/**
 * Jump instantly to a given game hour, bypassing the smooth lerp.
 * Useful for cutscenes or the first frame.
 *
 * @param {number} hour  0–24
 */
export function forceTimeOfDay(hour) {
  _currentHour = ((hour % 24) + 24) % 24;
  _targetHour  = _currentHour;
  updateSky(0.016, _currentHour);
  _bakePMREM(); // force immediate bake
}

/**
 * Return the current normalised sun direction (unit vector, world space).
 * Consumed by:
 *   - CSM (Part 6) lightDirection
 *   - Water (Part 16) sunDirection uniform
 *   - ShadowMap camera positioning
 *
 * @returns {THREE.Vector3}
 */
export function getSunDirection() {
  return _sunDir.clone();
}

/**
 * Return the current in-game hour (0–24, smooth).
 * @returns {number}
 */
export function getSkyHour() {
  return _currentHour;
}

// ─── Cloud animation ──────────────────────────────────────────────────────────

/**
 * Scroll cloud UV offsets and tint clouds for time of day.
 *
 * @param {number} dt
 * @param {number} hour
 */
function _updateClouds(dt, hour) {
  // Cloud tint shifts: golden at dawn/dusk, white at noon, dark purple at night
  const nightFactor = Math.max(0, 1 - Math.abs(Math.sin(
    THREE.MathUtils.degToRad((hour / 24) * 360 - 90)
  )) * 2);

  const dawnFactor = hour > 4 && hour < 9
    ? Math.sin(THREE.MathUtils.degToRad((hour - 4) / 5 * 180)) : 0;
  const duskFactor = hour > 16 && hour < 21
    ? Math.sin(THREE.MathUtils.degToRad((hour - 16) / 5 * 180)) : 0;
  const goldenFactor = Math.max(dawnFactor, duskFactor);

  const cloudColor = new THREE.Color(1, 1, 1)
    .lerp(new THREE.Color(0.9, 0.65, 0.4), goldenFactor * 0.7)
    .lerp(new THREE.Color(0.2, 0.18, 0.30), nightFactor * 0.8);

  _cloudMeshes.forEach(({ mesh, speed }, i) => {
    // Scroll texture UV offset for wind effect
    const mat = mesh.material;
    if (mat.map) {
      mat.map.offset.x += (speed / CLOUD_LAYERS[i].scale) * dt;
      // Slight cross-wind on alternate layers
      mat.map.offset.y += ((i % 2 === 0 ? 0.3 : -0.2) * speed / CLOUD_LAYERS[i].scale) * dt;
    }

    // Tint clouds with time-of-day colour
    mat.color.copy(cloudColor);

    // Cloud opacity: slightly lower at night (they're less visible), higher at dusk
    const baseOpacity  = CLOUD_LAYERS[i].opacity;
    mat.opacity = THREE.MathUtils.clamp(
      baseOpacity * (0.3 + (1 - nightFactor) * 0.7) + goldenFactor * 0.15,
      0.0, 0.9
    );

    // Keep cloud planes centred on camera (infinite sky trick)
    if (_camera) {
      mesh.position.x = _camera.position.x;
      mesh.position.z = _camera.position.z;
    }
  });
}

// ─── Star field (night sky) ───────────────────────────────────────────────────

let _stars = null;

/**
 * Build a static star field (2 000 points) visible only at night.
 * Called lazily on first night transition.
 */
export function ensureStars() {
  if (_stars) return;

  const N   = 2000;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);

  for (let i = 0; i < N; i++) {
    // Random point on upper hemisphere (y > 0)
    const phi   = Math.acos(1 - Math.random() * 0.98); // mostly above horizon
    const theta = Math.random() * Math.PI * 2;
    const r     = 490_000;
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    // Subtle colour variation: blue-white to warm-white
    const warm = Math.random();
    col[i * 3]     = 0.85 + warm * 0.15;
    col[i * 3 + 1] = 0.88 + warm * 0.10;
    col[i * 3 + 2] = 1.0;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size:         800,
    sizeAttenuation: true,
    vertexColors: true,
    transparent:  true,
    opacity:      0.0,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
  });

  _stars = new THREE.Points(geo, mat);
  _stars.name = 'StarField';
  _stars.renderOrder = -2;
  _scene.add(_stars);
}

/**
 * Drive star visibility from the current sky hour.
 * Call from updateSky() or from environment.js after ensureStars().
 *
 * @param {number} hour  0–24 (smooth hour from SkySystem)
 */
export function updateStars(hour) {
  if (!_stars) return;
  // Stars visible when sun below horizon: hours 0–5, 20–24
  const el = _sunAzEl(hour).el;
  const nightFactor = THREE.MathUtils.clamp((-el) / 20, 0, 1); // fades in as sun drops below -0°
  _stars.material.opacity = nightFactor * 0.90;

  // Keep stars centred on camera
  if (_camera) {
    _stars.position.copy(_camera.position);
  }
}

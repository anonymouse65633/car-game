/**
 * js/fx/WaterFX.js  —  Part 9: Water & Mud Splash
 * =================================================
 * Extends the particle suite with water-specific effects:
 *
 *  1. Spray rooster tail   — continuous spray behind each tyre at > 60 km/h
 *                            on wet biomes (riviera, farmland, jungle)
 *  2. Puddle splash burst  — 300 droplet sprites when entering a wet surface
 *                            at speed (one-shot, cooldown 1.2 s per tyre)
 *  3. Bow wave             — two animated PlaneGeometry meshes at the front
 *                            tyres when crossing riviera / low-lying terrain
 *  4. Mud screen splats    — 2-D canvas overlay blobs that stick to the screen
 *                            when driving fast on farmland / jungle; fade over
 *                            ~4 seconds
 *  5. Rain ripples         — animated RingGeometry decals at tyre contact
 *                            patches that expand and fade while it is raining
 *
 * NOTE: The rain *streak* particle system (falling drops) is already handled
 *       by environment.js (_tickRain). This module does NOT duplicate that;
 *       it only adds the *ground-level* water interaction effects.
 *
 * Public API
 * ----------
 *  initWaterFX(scene, renderer)                          → handle
 *  updateWaterFX(handle, car, driveState, weather, dt)
 *    car        — { position, quaternion, speedKmh, _wheelMeshes }
 *    driveState — { throttle, brake, surfaceType }
 *    weather    — { isRain, blend }  (from environment.getWeather())
 *  disposeWaterFX(handle)
 */

import * as THREE   from 'three';
import { getBiome } from '../world/terrain.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const SPRAY_POOL      = 12_000;   // rooster tail + puddle splash shared pool
const SPRAY_SPEED_MIN = 60 / 3.6; // 60 km/h in m/s
const SPLASH_COUNT    = 280;      // particles per tyre splash burst
const SPLASH_COOLDOWN = 1.2;      // seconds between splashes per tyre
const RIPPLE_MAX      = 20;       // max simultaneous ring ripples
const BOW_WAVE_COUNT  = 2;        // front-left + front-right
const MUD_SPLAT_MAX   = 14;       // max live screen splats

const WET_BIOMES = new Set(['riviera', 'farmland', 'jungle']);
const RIVER_BIOMES = new Set(['riviera']);

// Wheel index helpers
const FL = 0, FR = 1;             // front-left, front-right indices

// ─── Sprite generators ────────────────────────────────────────────────────────

/** Soft circular droplet — white, transparent edge. */
function makeDropletSprite() {
  const S = 64;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S/2,S/2, 0, S/2,S/2, S/2);
  g.addColorStop(0,   'rgba(200,230,255,1.0)');
  g.addColorStop(0.5, 'rgba(180,210,255,0.6)');
  g.addColorStop(1,   'rgba(160,200,255,0.0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

/** Faint translucent streak — for fast-moving spray particles. */
function makeSpraySprite() {
  const W = 8, H = 48;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0,0, 0,H);
  g.addColorStop(0,   'rgba(200,230,255,0.0)');
  g.addColorStop(0.3, 'rgba(210,235,255,0.8)');
  g.addColorStop(0.7, 'rgba(200,230,255,0.8)');
  g.addColorStop(1,   'rgba(200,230,255,0.0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

// ─── Shader (shared for both spray + droplets) ────────────────────────────────
const VERT = /* glsl */`
  attribute float aSize;
  attribute float aLifeFrac;
  varying float vAlpha;
  void main() {
    vAlpha = aLifeFrac;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * 260.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uSprite;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec4 t = texture2D(uSprite, gl_PointCoord);
    if (t.a < 0.01) discard;
    gl_FragColor = vec4(t.rgb, t.a * vAlpha * 0.82);
  }
`;

// ─── Particle pool factory ────────────────────────────────────────────────────
function makePool(n, sprite, scene) {
  const posArr  = new Float32Array(n * 3);
  const velArr  = new Float32Array(n * 3);
  const lifeArr = new Float32Array(n);
  const maxArr  = new Float32Array(n);
  const gravArr = new Float32Array(n);
  const szArr   = new Float32Array(n);
  const lfArr   = new Float32Array(n);   // lifeFrac → GPU

  const geo = new THREE.BufferGeometry();
  const pA  = new THREE.BufferAttribute(posArr, 3); pA.usage = THREE.DynamicDrawUsage;
  const lA  = new THREE.BufferAttribute(lfArr,  1); lA.usage = THREE.DynamicDrawUsage;
  const sA  = new THREE.BufferAttribute(szArr,  1); sA.usage = THREE.DynamicDrawUsage;
  geo.setAttribute('position',  pA);
  geo.setAttribute('aLifeFrac', lA);
  geo.setAttribute('aSize',     sA);

  const mat = new THREE.ShaderMaterial({
    uniforms:       { uSprite: { value: sprite } },
    vertexShader:   VERT,
    fragmentShader: FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.NormalBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);

  // Park all at −999
  for (let i = 0; i < n; i++) posArr[i * 3 + 1] = -999;

  let head = 0;

  function spawn(wx, wy, wz, vx, vy, vz, size, life, grav) {
    // Find dead slot
    for (let t = 0; t < n; t++) {
      const idx = (head + t) % n;
      if (lifeArr[idx] <= 0) {
        head = (idx + 1) % n;
        const i3 = idx * 3;
        posArr[i3]   = wx; posArr[i3+1] = wy; posArr[i3+2] = wz;
        velArr[i3]   = vx; velArr[i3+1] = vy; velArr[i3+2] = vz;
        lifeArr[idx] = life;
        maxArr[idx]  = life;
        gravArr[idx] = grav;
        szArr[idx]   = size;
        lfArr[idx]   = 1.0;
        return;
      }
    }
  }

  function tick(dt) {
    for (let i = 0; i < n; i++) {
      if (lifeArr[i] <= 0) continue;
      lifeArr[i] -= dt;
      if (lifeArr[i] <= 0) {
        lifeArr[i]     = 0;
        lfArr[i]       = 0;
        posArr[i*3+1]  = -999;
        continue;
      }
      const i3 = i * 3;
      posArr[i3]   += velArr[i3]   * dt;
      posArr[i3+1] += velArr[i3+1] * dt;
      posArr[i3+2] += velArr[i3+2] * dt;
      velArr[i3+1] -= gravArr[i] * dt;
      if (posArr[i3+1] < 0) { posArr[i3+1] = 0; velArr[i3+1] = 0; velArr[i3] *= 0.35; velArr[i3+2] *= 0.35; }
      lfArr[i] = lifeArr[i] / maxArr[i];
    }
    pA.needsUpdate = true;
    lA.needsUpdate = true;
    sA.needsUpdate = true;
  }

  function dispose() {
    scene.remove(pts);
    geo.dispose();
    mat.dispose();
    sprite.dispose();
  }

  return { spawn, tick, dispose };
}

// ─── Bow-wave mesh factory ────────────────────────────────────────────────────
const BOW_VERT = /* glsl */`
  uniform float uTime;
  uniform float uSpeed;  // 0..1 normalised
  varying vec2 vUV;
  void main() {
    vUV = uv;
    vec3 p = position;
    // Ripple perpendicular to travel direction
    float wave = sin(p.x * 3.0 + uTime * 8.0) * 0.04 * uSpeed
               + sin(p.x * 7.5 + uTime * 14.0) * 0.015 * uSpeed;
    p.y += wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const BOW_FRAG = /* glsl */`
  uniform float uAlpha;
  varying vec2 vUV;
  void main() {
    // Fan-shaped fade: bright at tip (vUV.y=1), transparent at base
    float fade = vUV.y * (1.0 - abs(vUV.x - 0.5) * 1.8);
    fade = clamp(fade, 0.0, 1.0);
    vec3 col = vec3(0.78, 0.90, 1.00);
    gl_FragColor = vec4(col, fade * uAlpha * 0.55);
  }
`;

function makeBowWave(scene) {
  const geo = new THREE.PlaneGeometry(0.9, 1.6, 6, 8);
  // Rotate to lie flat (plane is initially in XY; we want XZ)
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:  { value: 0 },
      uSpeed: { value: 0 },
      uAlpha: { value: 0 },
    },
    vertexShader:   BOW_VERT,
    fragmentShader: BOW_FRAG,
    transparent:    true,
    depthWrite:     false,
    side:           THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, mat };
}

// ─── Ripple ring pool ─────────────────────────────────────────────────────────
function makeRipplePool(scene) {
  const rings = [];
  for (let i = 0; i < RIPPLE_MAX; i++) {
    const geo = new THREE.RingGeometry(0.01, 0.06, 18);
    // Tilt flat on XZ
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color:       0xaaccff,
      transparent: true,
      opacity:     0.0,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, mat, geo, life: 0, maxLife: 0.8 });
  }

  let rHead = 0;

  function spawnRipple(wx, wy, wz) {
    for (let t = 0; t < RIPPLE_MAX; t++) {
      const r = rings[(rHead + t) % RIPPLE_MAX];
      if (r.life <= 0) {
        rHead = (rHead + t + 1) % RIPPLE_MAX;
        r.mesh.position.set(wx, wy + 0.02, wz);
        r.mesh.scale.set(1, 1, 1);
        r.life    = r.maxLife;
        r.mat.opacity = 0.6;
        r.mesh.visible = true;
        return;
      }
    }
  }

  function tick(dt) {
    for (const r of rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.life = 0; r.mesh.visible = false; r.mat.opacity = 0; continue; }
      const frac = 1.0 - r.life / r.maxLife; // 0→1
      const s    = 1.0 + frac * 3.5;
      r.mesh.scale.set(s, s, s);
      r.mat.opacity = (1.0 - frac) * 0.55;
    }
  }

  function dispose() {
    for (const r of rings) { scene.remove(r.mesh); r.geo.dispose(); r.mat.dispose(); }
  }

  return { spawnRipple, tick, dispose };
}

// ─── Mud-screen splat overlay ─────────────────────────────────────────────────
function makeMudOverlay() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    'position:fixed', 'inset:0', 'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:15',
  ].join(';');
  canvas.id = 'mud-splat-overlay';
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  // Each splat: { x, y, r, alpha, decay }
  const splats = [];

  function _resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  _resize();
  window.addEventListener('resize', _resize);

  function addSplat() {
    if (splats.length >= MUD_SPLAT_MAX) return;
    const W = canvas.width, H = canvas.height;
    // Splats skew toward the lower half of the screen (windscreen perspective)
    splats.push({
      x:     W * (0.1 + Math.random() * 0.8),
      y:     H * (0.35 + Math.random() * 0.55),
      r:     18 + Math.random() * 38,
      alpha: 0.55 + Math.random() * 0.30,
      decay: 0.06 + Math.random() * 0.04,  // alpha/sec
      hue:   Math.random() < 0.5 ? '#3d2b1a' : '#4a3020',
    });
  }

  function tick(dt) {
    // Decay & cull
    for (let i = splats.length - 1; i >= 0; i--) {
      splats[i].alpha -= splats[i].decay * dt;
      if (splats[i].alpha <= 0) splats.splice(i, 1);
    }

    // Redraw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of splats) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      // Irregular ellipse via bezier
      ctx.beginPath();
      const rx = s.r * (0.7 + Math.random() * 0.08);
      const ry = s.r * (0.5 + Math.random() * 0.06);
      ctx.ellipse(s.x, s.y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = s.hue;
      ctx.fill();
      ctx.restore();
    }
  }

  function dispose() {
    window.removeEventListener('resize', _resize);
    canvas.remove();
  }

  return { addSplat, tick, dispose };
}

// ─── Temporary vectors ────────────────────────────────────────────────────────
const _wpos  = new THREE.Vector3();
const _cvel  = new THREE.Vector3();
const _prev  = new THREE.Vector3();
let   _prevSet = false;

// ═══════════════════════════════════════════════════════════════════════════════
//   PUBLIC FACTORY
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * @param {THREE.Scene}    scene
 * @param {THREE.WebGLRenderer} _renderer  (reserved — may be used later for RTs)
 * @returns {object} handle
 */
export function initWaterFX(scene, _renderer) {

  const dropletSprite = makeDropletSprite();
  const spraySprite   = makeSpraySprite();

  // Shared pool for both spray trails and puddle splashes
  const dropPool  = makePool(SPRAY_POOL, dropletSprite, scene);

  // Bow waves — one per front tyre
  const bowWaves  = [makeBowWave(scene), makeBowWave(scene)];

  // Ripple ring pool (active when raining)
  const ripples   = makeRipplePool(scene);

  // Mud screen overlay
  const mudOverlay = makeMudOverlay();

  // Per-tyre splash cooldown timers
  const splashCooldown = [0, 0, 0, 0];

  // Per-tyre spray timers (for rate limiting)
  const sprayTimer = [0, 0, 0, 0];
  const SPRAY_INTERVAL = 0.016; // ~60 Hz max spawn rate per tyre

  // Ripple timer (rate limit ripple spawning)
  let rippleTimer = 0;

  // Mud splat rate-limit
  let mudTimer = 0;

  let _time = 0;

  // ─── Per-frame update ───────────────────────────────────────────────────────
  function update(car, driveState, weather, dt) {
    if (!car || !car.mesh) return;

    _time += dt;

    const pos      = car.position;
    const speedMs  = (car.speedKmh ?? 0) / 3.6;
    const biome    = getBiome(pos.x, pos.z);
    const isWet    = WET_BIOMES.has(biome);
    const isRiver  = RIVER_BIOMES.has(biome);
    const isRain   = weather?.isRain ?? false;
    const rainMix  = weather?.blend  ?? 0;

    // Estimate car velocity
    if (!_prevSet) { _prev.copy(pos); _prevSet = true; }
    if (dt > 0) {
      _cvel.set(
        (pos.x - _prev.x) / dt,
        (pos.y - _prev.y) / dt,
        (pos.z - _prev.z) / dt,
      );
    }
    _prev.copy(pos);

    const cvx = _cvel.x, cvz = _cvel.z;

    // ── 1. Spray rooster tail ──────────────────────────────────────────────
    const doSpray = isWet && speedMs > SPRAY_SPEED_MIN;

    if (car._wheelMeshes && doSpray) {
      const speedFrac = Math.min(1, (speedMs - SPRAY_SPEED_MIN) / 20);

      car._wheelMeshes.forEach((wm, i) => {
        sprayTimer[i] -= dt;
        if (sprayTimer[i] > 0) return;
        sprayTimer[i] = SPRAY_INTERVAL;

        wm.getWorldPosition(_wpos);
        const wx = _wpos.x, wy = _wpos.y, wz = _wpos.z;

        // Emit 2–6 spray droplets per tyre per interval
        const count = Math.round(2 + speedFrac * 4);
        for (let k = 0; k < count; k++) {
          // Spray fans backward from the tyre, slightly outward
          const side  = (i % 2 === 0) ? -1 : 1;   // FL/RL left, FR/RR right
          const angle = Math.PI + (Math.random() - 0.5) * 0.7;
          const spd   = speedMs * 0.28 + Math.random() * 2;
          const vx    = Math.cos(angle) * spd + (Math.random() - 0.5) * 1.5
                      + cvx * 0.10 + side * 0.5;
          const vy    = 2.0 + Math.random() * 3.5;
          const vz    = Math.sin(angle) * spd + (Math.random() - 0.5) * 1.5
                      + cvz * 0.10;
          dropPool.spawn(wx, wy, wz, vx, vy, vz,
            0.05 + Math.random() * 0.07,   // size
            0.35 + Math.random() * 0.35,   // lifetime
            5.5 + Math.random() * 2,       // gravity
          );
        }
      });
    }

    // ── 2. Puddle splash burst ─────────────────────────────────────────────
    if (car._wheelMeshes && isWet && speedMs > 8) {
      car._wheelMeshes.forEach((wm, i) => {
        splashCooldown[i] -= dt;
        if (splashCooldown[i] > 0) return;

        // Trigger a burst on wet entry (once per SPLASH_COOLDOWN seconds)
        const burstCount = Math.round(SPLASH_COUNT * Math.min(1, speedMs / 15));
        wm.getWorldPosition(_wpos);
        const wx = _wpos.x, wy = _wpos.y, wz = _wpos.z;

        for (let k = 0; k < burstCount; k++) {
          // Hemisphere burst — mostly outward and upward
          const theta = Math.random() * Math.PI * 2;
          const phi   = Math.random() * Math.PI * 0.55; // upper hemisphere
          const spd   = 2.0 + Math.random() * 5.0;
          const vx    = Math.cos(theta) * Math.sin(phi) * spd + cvx * 0.1;
          const vy    = Math.cos(phi) * spd * 0.8 + 1.0;
          const vz    = Math.sin(theta) * Math.sin(phi) * spd + cvz * 0.1;
          dropPool.spawn(wx, wy, wz, vx, vy, vz,
            0.03 + Math.random() * 0.06,   // size
            0.25 + Math.random() * 0.50,   // lifetime
            6.5 + Math.random() * 2.5,     // gravity
          );
        }

        splashCooldown[i] = SPLASH_COOLDOWN;
      });
    }

    // ── 3. Bow waves (front tyres in riviera / rain puddles) ──────────────
    const showBow = (isRiver || (isRain && rainMix > 0.4)) && speedMs > 5;

    bowWaves.forEach((bw, wi) => {
      const tyreIdx = wi === 0 ? FL : FR;
      bw.mat.uniforms.uTime.value  = _time;
      bw.mat.uniforms.uSpeed.value = Math.min(1, speedMs / 25);

      const targetAlpha = showBow ? Math.min(1, speedMs / 18) : 0;
      const curAlpha    = bw.mat.uniforms.uAlpha.value;
      bw.mat.uniforms.uAlpha.value = curAlpha + (targetAlpha - curAlpha) * Math.min(1, dt * 4);
      bw.mesh.visible = bw.mat.uniforms.uAlpha.value > 0.01;

      if (bw.mesh.visible && car._wheelMeshes?.[tyreIdx]) {
        car._wheelMeshes[tyreIdx].getWorldPosition(_wpos);
        // Place fan just ahead of the front tyre in world space
        const heading = Math.atan2(cvx, cvz);
        bw.mesh.position.set(_wpos.x, _wpos.y + 0.04, _wpos.z);
        bw.mesh.rotation.y = heading;
      }
    });

    // ── 4. Mud screen splats ───────────────────────────────────────────────
    const mudBiome = biome === 'farmland' || biome === 'jungle';
    if (mudBiome && speedMs > 11) {
      mudTimer -= dt;
      if (mudTimer <= 0) {
        mudOverlay.addSplat();
        mudTimer = 0.35 + Math.random() * 0.5;  // ~1.5–3 splats/sec at speed
      }
    }
    mudOverlay.tick(dt);

    // ── 5. Rain ripples (at tyre contact patches while raining) ───────────
    if (isRain && speedMs > 2 && car._wheelMeshes) {
      rippleTimer -= dt;
      if (rippleTimer <= 0) {
        // Spawn ripple at a random tyre
        const wi = Math.floor(Math.random() * 4);
        car._wheelMeshes[wi].getWorldPosition(_wpos);
        ripples.spawnRipple(_wpos.x, _wpos.y, _wpos.z);
        rippleTimer = 0.10 + Math.random() * 0.12; // ~6–10 ripples/sec total
      }
    }
    ripples.tick(dt);

    // ── Integrate spray/droplet pool ──────────────────────────────────────
    dropPool.tick(dt);
  }

  // ── Dispose ─────────────────────────────────────────────────────────────
  function dispose() {
    dropPool.dispose();
    bowWaves.forEach(b => { scene.remove(b.mesh); b.mat.dispose(); });
    ripples.dispose();
    mudOverlay.dispose();
  }

  return { update, dispose };
}

/**
 * Convenience wrapper — call once per UPDATE tick.
 * @param {object} handle  — from initWaterFX
 * @param {object} car
 * @param {object} driveState  — { throttle, brake, surfaceType }
 * @param {object} weather     — { isRain, blend }
 * @param {number} dt
 */
export function updateWaterFX(handle, car, driveState, weather, dt) {
  if (handle?.update) handle.update(car, driveState, weather, dt);
}

/** Free all GPU + DOM resources. */
export function disposeWaterFX(handle) {
  if (handle?.dispose) handle.dispose();
}

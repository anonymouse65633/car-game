/**
 * js/fx/SmokeFX.js  —  Part 10: Tyre Smoke, Brake Sparks & Exhaust
 * ==================================================================
 * Four distinct sub-systems, all LOD-gated to 80 m from the camera:
 *
 *  1. Tyre smoke      — billowing white/grey clouds when |slip| is high
 *                       (lateral cornering squeal OR longitudinal burnout).
 *                       Clouds expand as they rise (growRate 1.2× per second).
 *                       Smoke darkens/yellows with sustained heat.
 *
 *  2. Brake sparks    — metallic yellow-orange sparks when calliper temp
 *                       exceeds 400 °C (read from mat.userData.brakeTemp set
 *                       by CarPaintSystem.updateBrakeThermal). Additive blend,
 *                       tiny (0.02–0.05 m), high gravity, 0.06–0.14 s life.
 *
 *  3. Exhaust puffs   — small dark-grey smoke from the two exhaust tips
 *                       (rear of car, low). Spawn rate scales with RPM;
 *                       size scales with throttle (heavy load = more soot).
 *
 *  4. Backfire flash  — bright orange particle burst at exhaust tips on
 *                       turbo/supercharged upshift (gear increases + RPM drop).
 *                       1–2 frame lifetime, very bright, additive blend.
 *
 * Public API
 * ----------
 *  initSmokeFX(scene, camera)                          → handle
 *  updateSmokeFX(handle, car, drivingController, dt)
 *  disposeSmokeFX(handle)
 */

import * as THREE from 'three';

// ─── Pool sizes ────────────────────────────────────────────────────────────────
const SMOKE_POOL  = 6_000;
const SPARK_POOL  = 2_000;
const EXHAUST_POOL = 1_200;

// ─── LOD gate ──────────────────────────────────────────────────────────────────
const LOD_DIST_SQ = 80 * 80;   // 80 m squared

// ─── Smoke constants ───────────────────────────────────────────────────────────
const SMOKE_GROW_RATE = 1.20;   // size multiplier per second while alive
const SMOKE_LIFE_MIN  = 1.4;
const SMOKE_LIFE_MAX  = 2.6;

// ─── Exhaust tip offsets (local-space relative to car mesh origin) ─────────────
// Placed just behind the rear bumper, low on the body.
// We compute world pos by transforming through car.mesh.matrixWorld.
const EXHAUST_OFFSETS = [
  { x: -0.38, y: -0.22, z: -1.15 },  // driver side
  { x:  0.38, y: -0.22, z: -1.15 },  // passenger side
];

// ─── Shaders ───────────────────────────────────────────────────────────────────

// Shared vertex shader (smoke + exhaust)
const SMOKE_VERT = /* glsl */`
  attribute float aSize;
  attribute float aLifeFrac;
  attribute float aAlphaScale;  // base opacity multiplier (smoke vs exhaust)
  varying  float vAlpha;
  void main() {
    vAlpha = aLifeFrac * aAlphaScale;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * 280.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
  }
`;

const SMOKE_FRAG = /* glsl */`
  uniform sampler2D uSprite;
  uniform vec3      uColor;
  varying float     vAlpha;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec4 t = texture2D(uSprite, gl_PointCoord);
    if (t.a < 0.01) discard;
    gl_FragColor = vec4(uColor * t.rgb, t.a * vAlpha);
  }
`;

// Spark shader — additive blend, ignores sprite alpha for core brightness
const SPARK_VERT = /* glsl */`
  attribute float aSize;
  attribute float aLifeFrac;
  varying  float vAlpha;
  void main() {
    vAlpha = aLifeFrac;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * 200.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
  }
`;

const SPARK_FRAG = /* glsl */`
  uniform sampler2D uSprite;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    // Bright hot core → dim cool edge
    float core = 1.0 - smoothstep(0.0, 0.5, d);
    vec3 hotColor  = vec3(1.0,  0.95, 0.6);   // yellow-white
    vec3 coolColor = vec3(1.0,  0.35, 0.0);   // deep orange
    vec3 col = mix(coolColor, hotColor, core * core);
    gl_FragColor = vec4(col * core, vAlpha * core * 0.9);
  }
`;

// ─── Sprite texture factories ──────────────────────────────────────────────────

function makeSoftCircle() {
  const S = 64;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S/2,S/2,0, S/2,S/2,S/2);
  g.addColorStop(0,   'rgba(255,255,255,0.95)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.15)');
  g.addColorStop(1,   'rgba(255,255,255,0.00)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

// ─── Pool builder ──────────────────────────────────────────────────────────────

function makePool(n, mat, scene) {
  const posArr  = new Float32Array(n * 3);
  const velArr  = new Float32Array(n * 3);
  const lifeArr = new Float32Array(n);
  const maxArr  = new Float32Array(n);
  const gravArr = new Float32Array(n);
  const szArr   = new Float32Array(n);
  const lfArr   = new Float32Array(n);
  const asArr   = new Float32Array(n);

  const geo = new THREE.BufferGeometry();
  const pA  = new THREE.BufferAttribute(posArr, 3); pA.usage = THREE.DynamicDrawUsage;
  const lA  = new THREE.BufferAttribute(lfArr,  1); lA.usage = THREE.DynamicDrawUsage;
  const sA  = new THREE.BufferAttribute(szArr,  1); sA.usage = THREE.DynamicDrawUsage;
  const aA  = new THREE.BufferAttribute(asArr,  1); aA.usage = THREE.DynamicDrawUsage;

  geo.setAttribute('position',   pA);
  geo.setAttribute('aLifeFrac',  lA);
  geo.setAttribute('aSize',      sA);
  geo.setAttribute('aAlphaScale', aA);

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);

  for (let i = 0; i < n; i++) posArr[i * 3 + 1] = -9999;

  let head = 0;

  function spawn(wx, wy, wz, vx, vy, vz, size, life, grav, alphaScale) {
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
        asArr[idx]   = alphaScale ?? 1.0;
        lfArr[idx]   = 1.0;
        return;
      }
    }
  }

  function tick(dt, growRate) {
    for (let i = 0; i < n; i++) {
      if (lifeArr[i] <= 0) continue;
      lifeArr[i] -= dt;
      if (lifeArr[i] <= 0) {
        lifeArr[i] = 0; lfArr[i] = 0; posArr[i*3+1] = -9999; continue;
      }
      const i3 = i * 3;
      posArr[i3]   += velArr[i3]   * dt;
      posArr[i3+1] += velArr[i3+1] * dt;
      posArr[i3+2] += velArr[i3+2] * dt;
      velArr[i3+1] -= gravArr[i] * dt;
      if (posArr[i3+1] < -0.5) { posArr[i3+1] = -0.5; velArr[i3+1] = 0; }
      lfArr[i] = lifeArr[i] / maxArr[i];
      if (growRate > 0) szArr[i] *= (1.0 + growRate * dt);
    }
    pA.needsUpdate = true;
    lA.needsUpdate = true;
    sA.needsUpdate = true;
  }

  function dispose() {
    scene.remove(pts);
    geo.dispose();
    mat.dispose();
  }

  return { spawn, tick, dispose, pts };
}

// ─── Temporary objects ─────────────────────────────────────────────────────────
const _tmpV  = new THREE.Vector3();
const _exW   = new THREE.Vector3();  // exhaust world pos

// ═══════════════════════════════════════════════════════════════════════════════
//   PUBLIC FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {THREE.Scene}  scene
 * @param {THREE.Camera} camera
 * @returns {object} handle
 */
export function initSmokeFX(scene, camera) {

  const sprite = makeSoftCircle();

  // ── Tyre smoke pool ─────────────────────────────────────────────────────
  const smokeMat = new THREE.ShaderMaterial({
    uniforms:       { uSprite: { value: sprite }, uColor: { value: new THREE.Color(0.86, 0.86, 0.86) } },
    vertexShader:   SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.NormalBlending,
  });
  const smokePool = makePool(SMOKE_POOL, smokeMat, scene);

  // ── Brake spark pool ────────────────────────────────────────────────────
  const sparkMat = new THREE.ShaderMaterial({
    uniforms:       { uSprite: { value: sprite } },
    vertexShader:   SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });
  // spark pool doesn't use aAlphaScale but pool builder always adds it
  const sparkPool = makePool(SPARK_POOL, sparkMat, scene);
  sparkPool.pts.layers.enable(1);  // bloom layer — sparks should glint

  // ── Exhaust puff pool ────────────────────────────────────────────────────
  const exhaustMat = new THREE.ShaderMaterial({
    uniforms:       { uSprite: { value: sprite }, uColor: { value: new THREE.Color(0.28, 0.26, 0.24) } },
    vertexShader:   SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.NormalBlending,
  });
  const exhaustPool = makePool(EXHAUST_POOL, exhaustMat, scene);

  // ── Backfire flash pool (re-uses exhaust pool, orange) ───────────────────
  const backfireMat = new THREE.ShaderMaterial({
    uniforms:       { uSprite: { value: sprite }, uColor: { value: new THREE.Color(1.0, 0.42, 0.0) } },
    vertexShader:   SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });
  const backfirePool = makePool(400, backfireMat, scene);
  backfirePool.pts.layers.enable(1);

  // ── Per-tyre smoke timers ────────────────────────────────────────────────
  const smokeTimers = [0, 0, 0, 0];
  const SMOKE_INTERVAL = 0.030;   // max 33 Hz per tyre

  // ── Per-tyre spark accumulator ───────────────────────────────────────────
  const sparkTimers = [0, 0, 0, 0];
  const SPARK_INTERVAL = 0.012;

  // ── Exhaust spawn timer ──────────────────────────────────────────────────
  let exhaustTimer = 0;

  // ── Gear-change backfire detection ──────────────────────────────────────
  let _prevGear = 1;
  let _prevRpm  = 0;
  // Heat build-up per tyre for smoke darkening
  const tyreHeat = [0, 0, 0, 0];

  // ── Smoke colour temp ────────────────────────────────────────────────────
  const _smokeCol = new THREE.Color();

  // ─── Local helper: exhaust world position ────────────────────────────────
  function getExhaustWorldPos(car, offsetIdx) {
    const off = EXHAUST_OFFSETS[offsetIdx];
    _exW.set(off.x, off.y, off.z);
    // Scale offset by car body length factor if def available
    const lenFac = ((car.def?.bodyLength ?? 4.4) / 4.4);
    _exW.z *= lenFac;
    _exW.applyMatrix4(car.mesh.matrixWorld);
    return _exW;
  }

  // ─── Main update ──────────────────────────────────────────────────────────
  function update(car, drivingController, dt) {
    if (!car || !car.mesh) return;

    const pos      = car.position;
    const speedKmh = car.speedKmh ?? 0;
    const speedMs  = speedKmh / 3.6;

    // LOD gate — only spawn within 80 m of camera
    const camPos   = camera.position;
    const distSq   = (pos.x - camPos.x)**2 + (pos.y - camPos.y)**2 + (pos.z - camPos.z)**2;
    const inRange  = distSq <= LOD_DIST_SQ;

    const throttle  = drivingController._throttleSmooth ?? 0;
    const brake     = drivingController.car?.brake ?? 0;
    const squeal    = drivingController._squealActive ?? false;
    const rpm       = car.transmission?.rpm ?? 1000;
    const redline   = car.transmission?.redline ?? 7000;
    const gear      = car.transmission?.gear ?? 1;
    const aspiration = car.transmission?._aspiration ?? 'na';

    // ── Compute slip magnitude for smoke triggers ────────────────────────
    // Lateral slip: squeal active
    const lateralSlip = squeal ? 1.0 : 0;
    // Longitudinal slip (burnout/wheelspin): high throttle at low speed
    const spinRatio   = speedMs > 0.5 ? throttle / (speedMs * 0.08 + 0.1) : throttle * 10;
    const longSlip    = Math.min(1.0, Math.max(0, spinRatio - 0.5));

    const totalSlip   = Math.min(1.0, lateralSlip * 0.7 + longSlip);

    // ── Tyre smoke ────────────────────────────────────────────────────────
    if (inRange && totalSlip > 0.05 && car._wheelMeshes) {
      car._wheelMeshes.forEach((wm, i) => {
        smokeTimers[i] -= dt;
        if (smokeTimers[i] > 0) return;
        smokeTimers[i] = SMOKE_INTERVAL / Math.max(0.1, totalSlip);

        // Build up tyre heat (affects smoke colour)
        tyreHeat[i] = Math.min(1, tyreHeat[i] + totalSlip * dt * 0.4);

        wm.getWorldPosition(_tmpV);

        const count = Math.round(1 + totalSlip * 3);
        for (let k = 0; k < count; k++) {
          // Smoke rises slowly, drifts with slight random spread
          const vx = (Math.random() - 0.5) * 0.6;
          const vy = 0.8 + Math.random() * 1.2;
          const vz = (Math.random() - 0.5) * 0.6;

          // Size: larger for hard burnout
          const baseSize = 0.25 + totalSlip * 0.35 + Math.random() * 0.15;
          const life     = SMOKE_LIFE_MIN + Math.random() * (SMOKE_LIFE_MAX - SMOKE_LIFE_MIN);

          // Colour: white → grey → yellow-grey with heat
          const heat  = tyreHeat[i];
          const r     = 0.86 - heat * 0.12;
          const g     = 0.86 - heat * 0.18;
          const b     = 0.86 - heat * 0.28;
          smokeMat.uniforms.uColor.value.setRGB(r, g, b);

          smokePool.spawn(
            _tmpV.x + (Math.random() - 0.5) * 0.2,
            _tmpV.y + 0.05,
            _tmpV.z + (Math.random() - 0.5) * 0.2,
            vx, vy, vz,
            baseSize,
            life,
            0.25,   // very low gravity — smoke floats
            0.32 + totalSlip * 0.15,  // alpha scale
          );
        }
      });
    } else {
      // Cool tyres down when not slipping
      for (let i = 0; i < 4; i++) tyreHeat[i] = Math.max(0, tyreHeat[i] - dt * 0.15);
    }

    // ── Brake sparks ──────────────────────────────────────────────────────
    if (inRange && car._calliperMats && car._wheelMeshes) {
      car._calliperMats.forEach((mat, i) => {
        const temp = mat?.userData?.brakeTemp ?? 0;
        if (temp < 400) return;

        sparkTimers[i] -= dt;
        if (sparkTimers[i] > 0) return;
        sparkTimers[i] = SPARK_INTERVAL;

        // More sparks at higher temp
        const intensity = Math.min(1, (temp - 400) / 400);
        const count     = Math.round(1 + intensity * 5);

        car._wheelMeshes[i].getWorldPosition(_tmpV);

        for (let k = 0; k < count; k++) {
          // Sparks shoot outward and forward in a cone
          const angle  = Math.random() * Math.PI * 2;
          const spread = 2.0 + intensity * 4.0;
          const vx     = Math.cos(angle) * spread * 0.5 + (Math.random() - 0.5) * 1.5;
          const vy     = 0.5 + Math.random() * 1.5;
          const vz     = Math.sin(angle) * spread * 0.5 + (Math.random() - 0.5) * 1.5;

          sparkPool.spawn(
            _tmpV.x, _tmpV.y, _tmpV.z,
            vx, vy, vz,
            0.02 + Math.random() * 0.03,  // tiny size
            0.06 + Math.random() * 0.08,  // very short life
            12 + Math.random() * 4,        // heavy gravity — falls fast
            1.0,
          );
        }
      });
    }

    // ── Exhaust puffs ─────────────────────────────────────────────────────
    if (inRange && rpm > 0) {
      const rpmNorm    = Math.min(1, rpm / redline);
      const baseRate   = 0.06 + rpmNorm * 0.08;   // 0.06–0.14 s interval
      exhaustTimer -= dt;

      if (exhaustTimer <= 0) {
        exhaustTimer = baseRate;

        // Size & opacity scale with load (throttle × RPM)
        const load    = throttle * rpmNorm;
        const puffSz  = 0.06 + load * 0.12;
        const puffAlpha = 0.12 + load * 0.18;

        EXHAUST_OFFSETS.forEach((_, ei) => {
          const ep = getExhaustWorldPos(car, ei);

          exhaustPool.spawn(
            ep.x, ep.y, ep.z,
            (Math.random() - 0.5) * 0.3,
            0.3 + Math.random() * 0.5,
            (Math.random() - 0.5) * 0.3,
            puffSz,
            0.6 + Math.random() * 0.8,
            0.15,   // exhaust rises slowly
            puffAlpha,
          );
        });
      }
    }

    // ── Backfire flash ────────────────────────────────────────────────────
    // Detect upshift: gear increases AND RPM drops (turbo/supercharged only)
    const isForcedInduction = aspiration === 'turbo' || aspiration === 'twin_turbo'
                           || aspiration === 'supercharger';
    const gearJustIncreased = gear > _prevGear && _prevGear > 0;
    const rpmDropped        = rpm < _prevRpm - 400;

    if (inRange && isForcedInduction && gearJustIncreased && rpmDropped) {
      // Burst of 20–35 bright orange particles from both exhaust tips
      const burstCount = 20 + Math.round(Math.random() * 15);
      EXHAUST_OFFSETS.forEach((_, ei) => {
        const ep = getExhaustWorldPos(car, ei);
        for (let k = 0; k < burstCount; k++) {
          backfirePool.spawn(
            ep.x + (Math.random() - 0.5) * 0.1,
            ep.y + (Math.random() - 0.5) * 0.1,
            ep.z + (Math.random() - 0.5) * 0.1,
            (Math.random() - 0.5) * 1.2,           // vx
            0.5 + Math.random() * 1.0,              // vy
            -0.5 - Math.random() * 2.0,             // vz — shoots backward
            0.08 + Math.random() * 0.14,            // size
            0.05 + Math.random() * 0.08,            // very short life (~2 frames)
            1.5,                                    // falls quickly
            0.8 + Math.random() * 0.2,
          );
        }
      });
    }

    _prevGear = gear;
    _prevRpm  = rpm;

    // ── Integrate all pools ───────────────────────────────────────────────
    smokePool.tick(dt, SMOKE_GROW_RATE);
    sparkPool.tick(dt, 0);
    exhaustPool.tick(dt, 0.4);   // exhaust puffs expand slightly
    backfirePool.tick(dt, 0);
  }

  // ── Dispose ──────────────────────────────────────────────────────────────
  function dispose() {
    smokePool.dispose();
    sparkPool.dispose();
    exhaustPool.dispose();
    backfirePool.dispose();
    sprite.dispose();
  }

  return { update, dispose };
}

/**
 * Call once per UPDATE tick.
 * @param {object} handle           — from initSmokeFX
 * @param {object} car              — playerCar
 * @param {object} drivingController
 * @param {number} dt
 */
export function updateSmokeFX(handle, car, drivingController, dt) {
  if (handle?.update) handle.update(car, drivingController, dt);
}

/** Free all GPU resources. */
export function disposeSmokeFX(handle) {
  if (handle?.dispose) handle.dispose();
}

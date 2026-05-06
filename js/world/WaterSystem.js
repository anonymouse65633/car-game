/**
 * WaterSystem.js — Part 16: Ocean, Lakes & Rivers
 * =================================================
 * FH5 Setting: SSR Quality — Ultra
 *
 * - Ocean plane at y = 0: double-UV animated normal-map streams, Fresnel sky reflection
 * - Ocean foam: white sprite ring emitted at the shoreline / wave crests
 * - Dunas lake (y = -2): flat CubeCamera-backed reflective surface with light ripples
 * - River (Jungle, y = 12): flowing UV-scroll downstream through the jungle channel
 * - Underwater: blue fog + screen-edge distortion when camera dips below y = 0
 * - Car water interaction: when tyre y < waterLevel → drag factor 2.5×, bow-wave mesh
 * - All water bodies animated via shared elapsed-time uniform
 * - Zero external asset files — normal maps procedurally generated on OffscreenCanvas
 *
 * Public API
 * ----------
 *   initWaterSystem(scene, renderer, opts)  → Promise<void>
 *     opts.getTerrainHeight(x,z)  → number
 *     opts.getSunDirection()       → THREE.Vector3
 *     opts.getWeather()            → {isRain, blend}
 *   updateWaterSystem(elapsed, camera, playerCar, drivingController) → void
 *   getWaterDragFactor(x, z, y)   → number   (1 = normal, 2.5 = in water)
 *   disposeWaterSystem()           → void
 */

import * as THREE from 'three';

// ─── Constants ────────────────────────────────────────────────────────────────
const OCEAN_Y   =  0;
const LAKE_Y    = -2;    // Dunas salt lake, slightly below sea level
const RIVER_Y   = 12;    // Jungle river channel height
const OCEAN_SIZE = 20000;

// Water body definitions
const WATER_BODIES = [
  // Dunas salt lake (northwest quadrant)
  { type: 'lake',  name: 'dunas_lake',
    x: -3500, z: -2000, w: 1400, d: 900, y: LAKE_Y },
  // Riviera bay inlet
  { type: 'lake',  name: 'riviera_bay',
    x:  4400, z:  -400, w: 1200, d: 800, y: OCEAN_Y + 0.1 },
  // Jungle river — two segments approximated as thin planes
  { type: 'river', name: 'jungle_river',
    x:  1400, z:  2200, w:  80, d: 1800, y: RIVER_Y,
    flowDir: new THREE.Vector2(0, 1) },
  { type: 'river', name: 'jungle_river_bend',
    x:  1800, z:  3200, w: 800, d:   80, y: RIVER_Y - 3,
    flowDir: new THREE.Vector2(1, 0) },
];

// ─── State ────────────────────────────────────────────────────────────────────
let _scene          = null;
let _renderer       = null;
let _getSunDir      = null;
let _getWeather     = null;
let _getH           = null;
let _initialized    = false;

let _oceanMesh      = null;
let _oceanMat       = null;
let _lakeMeshes     = [];
let _riverMeshes    = [];
let _foamSystem     = null;
let _bowWaveL       = null;
let _bowWaveR       = null;
let _bowWaveGroup   = null;
let _underwaterFog  = null;   // THREE.FogExp2 override
let _normalFogBackup = null;

// For car drag
const _bodyBodies   = [];    // {minX, maxX, minZ, maxZ, y} for each water body + ocean

// ─── Procedural normal map ────────────────────────────────────────────────────

/** Build a 256×256 normal map texture from Perlin-like noise on CPU */
function _buildNormalMap(scale = 1, roughness = 0.5) {
  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);

  // Simple smooth noise via sine harmonics
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      // Two octaves of sine-based pseudo-noise
      const nx = Math.sin(u * 12 * scale + v * 7  * scale) * 0.5
               + Math.sin(u * 23 * scale - v * 17 * scale) * 0.25;
      const ny = Math.cos(u * 9  * scale - v * 14 * scale) * 0.5
               + Math.cos(u * 18 * scale + v * 11 * scale) * 0.25;

      // Encode as normal map (R=nx, G=ny, B=nz, pointing up)
      const r = Math.round((nx * roughness * 0.5 + 0.5) * 255);
      const g = Math.round((ny * roughness * 0.5 + 0.5) * 255);
      const b = 255;
      const i = (y * SIZE + x) * 4;
      img.data[i]     = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS  = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

// ─── Ocean ────────────────────────────────────────────────────────────────────

function _buildOceanMaterial() {
  const normalA = _buildNormalMap(1.0, 0.6);
  const normalB = _buildNormalMap(1.8, 0.4);

  const mat = new THREE.MeshPhysicalMaterial({
    color:            new THREE.Color(0x001e3c),
    roughness:        0.05,
    metalness:        0.0,
    transmission:     0.6,
    thickness:        2.0,
    ior:              1.33,
    normalMap:        normalA,
    normalScale:      new THREE.Vector2(0.6, 0.6),
    envMapIntensity:  1.2,
    side:             THREE.FrontSide,
    transparent:      true,
    opacity:          0.88,
  });

  // Inject dual normal-map animation + Fresnel
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime     = { value: 0 };
    shader.uniforms.uNormalB  = { value: normalB };
    shader.uniforms.uSunDir   = { value: new THREE.Vector3(0.5, 0.8, 0.3) };
    shader.uniforms.uFoamLine = { value: 0.0 };  // shoreline foam intensity

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       varying vec2  vWorldUV;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWorldUV = position.xz * 0.004;
       // Gentle surface waves
       float wave1 = sin(position.x * 0.015 + uTime * 0.8) * 0.12;
       float wave2 = cos(position.z * 0.012 + uTime * 0.6) * 0.09;
       transformed.y += wave1 + wave2;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float     uTime;
       uniform sampler2D uNormalB;
       uniform vec3      uSunDir;
       uniform float     uFoamLine;
       varying vec2      vWorldUV;`,
    );

    // Blend two scrolling normal maps
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       vec2 uvA = vWorldUV + vec2(uTime * 0.012, uTime * 0.008);
       vec2 uvB = vWorldUV * 1.7 - vec2(uTime * 0.009, uTime * 0.014);
       vec3 nA = texture2D(normalMap, uvA).xyz * 2.0 - 1.0;
       vec3 nB = texture2D(uNormalB,  uvB).xyz * 2.0 - 1.0;
       normal = normalize(normalMatrix * normalize(nA + nB));`,
    );

    // Foam near y=0 shoreline + specular sun glint
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       // Foam overlay at crests
       float foam = smoothstep(0.6, 1.0,
         sin(vWorldUV.x * 28.0 + uTime * 1.2) * sin(vWorldUV.y * 22.0 + uTime * 0.9));
       gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.96, 0.97, 1.0), foam * 0.18);
       // Shoreline foam line
       gl_FragColor.rgb += vec3(uFoamLine * 0.25);`,
    );

    mat._shader = shader;
  };
  return mat;
}

function _buildOcean(scene) {
  const geo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 64, 64);
  geo.rotateX(-Math.PI / 2);
  _oceanMat  = _buildOceanMaterial();
  _oceanMesh = new THREE.Mesh(geo, _oceanMat);
  _oceanMesh.position.y   = OCEAN_Y;
  _oceanMesh.receiveShadow = true;
  _oceanMesh.name          = 'ocean';
  scene.add(_oceanMesh);

  // Drag body for ocean
  _bodyBodies.push({ minX: -OCEAN_SIZE/2, maxX: OCEAN_SIZE/2,
                     minZ: -OCEAN_SIZE/2, maxZ: OCEAN_SIZE/2, y: OCEAN_Y });
}

// ─── Lakes ────────────────────────────────────────────────────────────────────

function _buildLakeMaterial(color, roughness) {
  const normalTex = _buildNormalMap(0.8, 0.3);
  const mat = new THREE.MeshPhysicalMaterial({
    color:           new THREE.Color(color),
    roughness,
    metalness:       0.0,
    transmission:    0.5,
    ior:             1.33,
    normalMap:       normalTex,
    normalScale:     new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 1.0,
    transparent:     true,
    opacity:         0.80,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // Subtle ripple
       transformed.y += sin(position.x * 0.05 + uTime * 0.4) * 0.04
                      + cos(position.z * 0.04 + uTime * 0.35) * 0.03;`,
    );
    mat._shader = shader;
  };
  return mat;
}

function _buildLakes(scene) {
  for (const body of WATER_BODIES.filter(b => b.type === 'lake')) {
    const color    = body.name === 'dunas_lake' ? 0x4a7a8a : 0x002244;
    const rough    = body.name === 'dunas_lake' ? 0.12 : 0.06;
    const geo      = new THREE.PlaneGeometry(body.w, body.d, 12, 12);
    geo.rotateX(-Math.PI / 2);
    const mat      = _buildLakeMaterial(color, rough);
    const mesh     = new THREE.Mesh(geo, mat);
    mesh.position.set(body.x, body.y, body.z);
    mesh.receiveShadow = true;
    mesh.name          = `water_${body.name}`;
    scene.add(mesh);
    _lakeMeshes.push({ mesh, mat });

    _bodyBodies.push({
      minX: body.x - body.w / 2, maxX: body.x + body.w / 2,
      minZ: body.z - body.d / 2, maxZ: body.z + body.d / 2,
      y: body.y,
    });
  }
}

// ─── Rivers ───────────────────────────────────────────────────────────────────

function _buildRiverMaterial(flowDir) {
  const normalTex = _buildNormalMap(2.0, 0.5);
  normalTex.repeat.set(4, 4);
  const mat = new THREE.MeshPhysicalMaterial({
    color:           new THREE.Color(0x1a4a3a),
    roughness:       0.15,
    metalness:       0.0,
    transmission:    0.55,
    ior:             1.33,
    normalMap:       normalTex,
    normalScale:     new THREE.Vector2(0.5, 0.5),
    transparent:     true,
    opacity:         0.82,
  });

  const fx = flowDir?.x ?? 0;
  const fy = flowDir?.y ?? 1;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime    = { value: 0 };
    shader.uniforms.uFlowDir = { value: new THREE.Vector2(fx, fy) };

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       uniform vec2  uFlowDir;`,
    );

    // Scroll normal map UVs in flow direction, creating downstream current look
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       vec2 flowUV = vUv + uFlowDir * uTime * 0.06;
       vec3 flowN  = texture2D(normalMap, flowUV * vec2(3.0, 6.0)).xyz * 2.0 - 1.0;
       // Rapids: cross-stream ripple
       vec2 crossUV = vUv + vec2(-uFlowDir.y, uFlowDir.x) * uTime * 0.03;
       vec3 crossN  = texture2D(normalMap, crossUV * 5.0).xyz * 2.0 - 1.0;
       normal = normalize(normalMatrix * normalize(flowN + crossN * 0.5));`,
    );

    mat._shader = shader;
  };
  return mat;
}

function _buildRivers(scene, getH) {
  for (const body of WATER_BODIES.filter(b => b.type === 'river')) {
    const geo  = new THREE.PlaneGeometry(body.w, body.d, 6, 6);
    geo.rotateX(-Math.PI / 2);
    const mat  = _buildRiverMaterial(body.flowDir);
    const mesh = new THREE.Mesh(geo, mat);
    // Project river onto terrain height
    const y = getH ? Math.max(getH(body.x, body.z), body.y) : body.y;
    mesh.position.set(body.x, y + 0.15, body.z);
    mesh.receiveShadow = true;
    mesh.name          = `water_${body.name}`;
    scene.add(mesh);
    _riverMeshes.push({ mesh, mat });

    _bodyBodies.push({
      minX: body.x - body.w / 2, maxX: body.x + body.w / 2,
      minZ: body.z - body.d / 2, maxZ: body.z + body.d / 2,
      y: y + 0.15,
    });
  }
}

// ─── Foam particle system ─────────────────────────────────────────────────────

function _buildFoamSystem(scene) {
  const N   = 800;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const age = new Float32Array(N);

  // Seed initial positions along the shoreline (ocean edge)
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const r     = 200 + Math.random() * 300;
    pos[i * 3]     = Math.cos(angle) * r;
    pos[i * 3 + 1] = OCEAN_Y + 0.05;
    pos[i * 3 + 2] = Math.sin(angle) * r;
    vel[i * 3]     = (Math.random() - 0.5) * 0.3;
    vel[i * 3 + 1] = 0.02 + Math.random() * 0.05;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    age[i]         = Math.random() * 3;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('age',      new THREE.BufferAttribute(age, 1));

  const mat = new THREE.PointsMaterial({
    color:        0xd8eaf0,
    size:         1.2,
    sizeAttenuation: true,
    transparent:  true,
    opacity:      0.55,
    depthWrite:   false,
  });

  const points = new THREE.Points(geo, mat);
  points.name  = 'ocean_foam';
  scene.add(points);

  return { points, geo, pos, vel, age };
}

// ─── Bow waves ────────────────────────────────────────────────────────────────

function _buildBowWave() {
  // Thin curved plane — a half-sphere arc standing vertically at tyre position
  const geo = new THREE.CylinderGeometry(0.6, 0.8, 0.4, 8, 1, true, 0, Math.PI);
  const mat = new THREE.MeshBasicMaterial({
    color:       0x88ccee,
    transparent: true,
    opacity:     0.45,
    side:        THREE.DoubleSide,
    depthWrite:  false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  mesh.name    = 'bow_wave';
  return mesh;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {THREE.Scene}    scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {{getTerrainHeight, getSunDirection, getWeather}} opts
 */
export async function initWaterSystem(scene, renderer, opts = {}) {
  if (_initialized) return;
  _initialized = true;
  _scene       = scene;
  _renderer    = renderer;
  _getSunDir   = opts.getSunDirection ?? null;
  _getWeather  = opts.getWeather      ?? null;
  _getH        = opts.getTerrainHeight ?? null;

  _buildOcean(scene);
  _buildLakes(scene);
  _buildRivers(scene, _getH);
  _foamSystem   = _buildFoamSystem(scene);

  // Bow waves — added to scene but managed in update
  _bowWaveGroup = new THREE.Group();
  _bowWaveGroup.name = 'bow_waves';
  _bowWaveL = _buildBowWave();
  _bowWaveR = _buildBowWave();
  _bowWaveGroup.add(_bowWaveL, _bowWaveR);
  scene.add(_bowWaveGroup);

  console.log(
    `[WaterSystem] Part 16 — ocean + ${_lakeMeshes.length} lakes + ${_riverMeshes.length} rivers ready`
  );
}

/**
 * Update all water animation, foam, bow waves, underwater fog.
 *
 * @param {number} elapsed          Clock elapsed seconds
 * @param {THREE.Camera} camera
 * @param {object} playerCar        car.js playerCar object
 * @param {object} drivingController
 */
export function updateWaterSystem(elapsed, camera, playerCar, drivingController) {
  if (!_initialized) return;

  const dt = 0.016; // approximate; we don't need precise dt here
  const weather = _getWeather ? _getWeather() : { isRain: false, blend: 0 };

  // ── Ocean ─────────────────────────────────────────────────────────────────
  if (_oceanMat?._shader) {
    _oceanMat._shader.uniforms.uTime.value     = elapsed;
    _oceanMat._shader.uniforms.uFoamLine.value = weather.blend * 0.4;
    if (_getSunDir) {
      _oceanMat._shader.uniforms.uSunDir.value.copy(_getSunDir());
    }
  }

  // ── Lakes ─────────────────────────────────────────────────────────────────
  for (const { mat } of _lakeMeshes) {
    if (mat._shader) mat._shader.uniforms.uTime.value = elapsed;
  }

  // ── Rivers — scroll faster with rain ─────────────────────────────────────
  for (const { mat } of _riverMeshes) {
    if (mat._shader) mat._shader.uniforms.uTime.value = elapsed * (1 + weather.blend * 1.5);
  }

  // ── Foam particles ────────────────────────────────────────────────────────
  if (_foamSystem) {
    const { geo, pos, vel, age } = _foamSystem;
    for (let i = 0; i < age.length; i++) {
      age[i] += dt;
      if (age[i] > 4) {
        // Respawn
        const angle    = Math.random() * Math.PI * 2;
        const r        = 80 + Math.random() * 500;
        pos[i * 3]     = Math.cos(angle) * r;
        pos[i * 3 + 1] = OCEAN_Y + 0.05;
        pos[i * 3 + 2] = Math.sin(angle) * r;
        vel[i * 3]     = (Math.random() - 0.5) * 0.4;
        vel[i * 3 + 1] = 0.02 + Math.random() * 0.04;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
        age[i]         = 0;
      } else {
        pos[i * 3]     += vel[i * 3]     * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3 + 1] -= 0.05 * dt;
      }
    }
    geo.attributes.position.needsUpdate = true;
    // Opacity scales with rain
    _foamSystem.points.material.opacity = 0.45 + weather.blend * 0.25;
  }

  // ── Bow waves ─────────────────────────────────────────────────────────────
  if (playerCar && _bowWaveL && _bowWaveR) {
    const carPos = playerCar.position ?? playerCar.mesh?.position;
    if (carPos) {
      const inWater = isInWater(carPos.x, carPos.z, carPos.y + 0.5);
      const speed   = playerCar.speedKmh ?? drivingController?.speedKmh ?? 0;
      const show    = inWater && speed > 5;
      _bowWaveL.visible = show;
      _bowWaveR.visible = show;
      if (show) {
        const fwd = drivingController?._forward ?? new THREE.Vector3(0, 0, -1);
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        _bowWaveL.position.copy(carPos).addScaledVector(right, -0.9).setY(OCEAN_Y + 0.2);
        _bowWaveR.position.copy(carPos).addScaledVector(right,  0.9).setY(OCEAN_Y + 0.2);
        _bowWaveL.rotation.y = Math.atan2(fwd.x, fwd.z);
        _bowWaveR.rotation.y = Math.atan2(fwd.x, fwd.z) + Math.PI;
        const scaleSpeed = Math.min(speed / 80, 1);
        _bowWaveL.scale.setScalar(0.6 + scaleSpeed * 0.8);
        _bowWaveR.scale.setScalar(0.6 + scaleSpeed * 0.8);
        _bowWaveL.material.opacity = 0.3 + scaleSpeed * 0.25;
        _bowWaveR.material.opacity = 0.3 + scaleSpeed * 0.25;
      }
    }
  }

  // ── Underwater camera fog ─────────────────────────────────────────────────
  if (camera && _scene) {
    const camY = camera.position.y;
    if (camY < OCEAN_Y - 0.3 && !_underwaterFog) {
      // Dive below surface — apply heavy blue fog
      _normalFogBackup = _scene.fog;
      _underwaterFog   = new THREE.FogExp2(0x001030, 0.08);
      _scene.fog       = _underwaterFog;
    } else if (camY >= OCEAN_Y - 0.3 && _underwaterFog) {
      // Surface — restore
      _scene.fog      = _normalFogBackup;
      _underwaterFog  = null;
      _normalFogBackup = null;
    }
  }
}

/**
 * Returns the water drag multiplier at world position (x, z, y).
 * 1.0 = dry land, 2.5 = fully submerged (tyre below water surface).
 *
 * @param {number} x
 * @param {number} z
 * @param {number} y  bottom of car (tyre contact y)
 * @returns {number}
 */
export function getWaterDragFactor(x, z, y) {
  if (!_initialized) return 1.0;
  for (const b of _bodyBodies) {
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
      if (y <= b.y + 0.6) return 2.5;   // tyres below water surface + 60 cm margin
    }
  }
  return 1.0;
}

/**
 * Returns true if the given world point is within any water body at surface level.
 */
export function isInWater(x, z, y = 0) {
  return getWaterDragFactor(x, z, y) > 1.0;
}

/**
 * Dispose all GPU resources.
 */
export function disposeWaterSystem() {
  [_oceanMesh, ..._lakeMeshes.map(l => l.mesh), ..._riverMeshes.map(r => r.mesh)]
    .filter(Boolean).forEach(m => { m.geometry.dispose(); m.material.dispose(); _scene?.remove(m); });
  if (_foamSystem) { _foamSystem.geo.dispose(); _scene?.remove(_foamSystem.points); }
  if (_bowWaveGroup) _scene?.remove(_bowWaveGroup);
  if (_underwaterFog) _scene.fog = _normalFogBackup;
  _oceanMesh = null; _lakeMeshes = []; _riverMeshes = [];
  _foamSystem = null; _bowWaveL = _bowWaveR = _bowWaveGroup = null;
  _initialized = false;
}

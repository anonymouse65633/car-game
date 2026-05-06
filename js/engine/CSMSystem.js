/**
 * CSMSystem.js — Part 6: Cascaded Shadow Maps + Dynamic Lights
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements:
 *  • 3-cascade CSM  (30 m / 100 m / 400 m) — sharp shadows under the car,
 *    progressively softer at distance
 *  • Street-lamp point lights — 32 clustered lights in Guanajuato & Riviera
 *  • Lava glow — orange PointLights embedded in Caldera rock faces (r=15 m)
 *  • Player headlights — two SpotLights with a correctly framed shadow camera
 *
 * Usage (from main.js):
 *   import {
 *     initCSM, updateCSM, setupMaterialForCSM,
 *     spawnStreetLamps, spawnLavaGlow,
 *     createCarHeadlights, updateHeadlights,
 *   } from './engine/CSMSystem.js';
 *
 *   // After initRenderer() and initCity():
 *   await initCSM(scene, camera, renderer);
 *   spawnStreetLamps(scene);
 *   spawnLavaGlow(scene);
 *   // After createCar():
 *   const headlights = createCarHeadlights(scene, playerCar.mesh);
 *   // Each frame (UPDATE phase):
 *   updateCSM();
 *   updateHeadlights(headlights, playerCar);
 *
 * Three.js r160 note:
 *   CSM lives at 'three/addons/csm/CSM.js'. If the CDN doesn't expose it,
 *   we fall back to a single-light approximation automatically.
 *
 * Part 6 / Technical Architecture (design doc §6)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { scene as _sceneRef, SUN, camera as _camRef } from './renderer.js';

// ─── CSM singleton ────────────────────────────────────────────────────────────

let _csm            = null;   // CSM instance (or null if fallback)
let _csmScene       = null;
let _csmCamera      = null;
let _csmFallback    = false;  // true when using single-light fallback
let _sunDirection   = new THREE.Vector3(-0.45, -0.82, -0.35).normalize();

// Materials that need csm.setupMaterial() called on them
const _csmMaterials = new Set();

// ─── Cascade configuration ───────────────────────────────────────────────────

const CASCADE_BREAKS = [30, 100, 400];   // metres
const CSM_MAP_SIZE   = 2048;             // px per cascade
const CSM_CASCADES   = 3;
const CSM_MODE       = 'practical';      // even split, good for open world

// ─── Public: Init ─────────────────────────────────────────────────────────────

/**
 * Initialise the CSM system.
 * Must be called after initRenderer() so SUN and camera exist.
 *
 * @param {THREE.Scene}          scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.WebGLRenderer}  renderer
 * @returns {Promise<void>}
 */
export async function initCSM(scene, camera, renderer) {
  _csmScene  = scene;
  _csmCamera = camera;

  // Disable the legacy single-shadow on SUN — CSM creates its own lights
  if (SUN) {
    SUN.castShadow = false;
  }

  try {
    const { CSM } = await import('three/addons/csm/CSM.js');

    _csm = new CSM({
      maxFar:        CASCADE_BREAKS[CASCADE_BREAKS.length - 1],
      cascades:      CSM_CASCADES,
      mode:          CSM_MODE,
      parent:        scene,
      shadowMapSize: CSM_MAP_SIZE,
      lightDirection: _sunDirection.clone().negate(), // CSM wants "light direction"
      camera:        camera,
      fade:          true,   // soft cascade transitions
    });

    // Set per-cascade shadow bias and resolution
    _csm.lights.forEach((light, i) => {
      light.shadow.mapSize.set(CSM_MAP_SIZE, CSM_MAP_SIZE);
      light.shadow.bias           = -0.0005;
      light.shadow.normalBias     =  0.002;
      light.shadow.camera.near    =  0.5;
      // cascade far planes come from CSM itself; we tighten them via cascades
      light.intensity             =  i === 0 ? 2.0 : 0.0; // only first light illuminates
      light.color                 = SUN ? SUN.color.clone() : new THREE.Color(0xfff8e7);
    });

    console.log('[CSMSystem] ✅ CSM initialised — 3 cascades at',
      CASCADE_BREAKS.join('m / ') + 'm');

  } catch (err) {
    console.warn('[CSMSystem] CSM addon unavailable, using fallback shadows:', err.message);
    _csmFallback = true;

    // Fallback: re-enable SUN shadow with a tight frustum
    if (SUN) {
      SUN.castShadow               = true;
      SUN.shadow.mapSize.set(4096, 4096);
      SUN.shadow.camera.near       = 0.5;
      SUN.shadow.camera.far        = 450;
      SUN.shadow.camera.left       = -120;
      SUN.shadow.camera.right      =  120;
      SUN.shadow.camera.top        =  120;
      SUN.shadow.camera.bottom     = -120;
      SUN.shadow.bias              = -0.001;
      SUN.shadow.normalBias        =  0.002;
    }
  }
}

// ─── Public: Per-frame update ─────────────────────────────────────────────────

/**
 * Update CSM each frame — must be called in the UPDATE tick phase.
 * Also repositions shadow frustum to follow player camera (fallback mode).
 */
export function updateCSM() {
  if (_csmFallback) {
    // Move fallback SUN shadow frustum to stay under the camera
    if (SUN && _csmCamera) {
      SUN.shadow.camera.position.copy(_csmCamera.position).add(SUN.position.clone().normalize().multiplyScalar(300));
      SUN.shadow.camera.updateProjectionMatrix();
    }
    return;
  }

  if (_csm) {
    _csm.update();
  }
}

// ─── Public: Material registration ───────────────────────────────────────────

/**
 * Register a material so CSM can inject the required shadow-map uniforms.
 * Call this whenever you create a material that should receive shadows:
 *
 *   import { setupMaterialForCSM } from './engine/CSMSystem.js';
 *   const mat = new THREE.MeshStandardMaterial({ ... });
 *   setupMaterialForCSM(mat);
 *
 * Safe to call before or after initCSM() — queued until CSM is ready.
 *
 * @param {THREE.Material} material
 */
export function setupMaterialForCSM(material) {
  _csmMaterials.add(material);
  if (_csm && !_csmFallback) {
    _csm.setupMaterial(material);
  }
}

/**
 * Update the CSM sun direction (call from SkySystem when sun moves).
 * @param {THREE.Vector3} direction  — normalised world-space vector pointing TOWARD the sun
 */
export function setCsmSunDirection(direction) {
  _sunDirection.copy(direction).negate().normalize();
  if (_csm) {
    _csm.lightDirection.copy(_sunDirection);
  }
}

// ─── Street Lamps ─────────────────────────────────────────────────────────────

/**
 * Spawn 32 clustered PointLights in Guanajuato and Riviera Maya districts.
 * Lights are grouped under a single Object3D so they can be culled together.
 *
 * @param {THREE.Scene} scene
 * @returns {THREE.Group}  — the lamp group (for later night-mode toggling)
 */
export function spawnStreetLamps(scene) {
  const group = new THREE.Group();
  group.name  = 'StreetLamps';

  // Guanajuato: colonial streets, warm sodium-orange
  const guanajuatoLamps = _generateLampGrid({
    x1: 600,   z1: -2800,
    x2: 2800,  z2: -1100,
    count: 18,
    color:     0xffb347,   // sodium orange
    intensity: 120,
    distance:  60,
    height:    7,
  });

  // Riviera Maya: coastal resort, cool white/blue
  const rivieraLamps = _generateLampGrid({
    x1: -2800, z1: 500,
    x2: -600,  z2: 2800,
    count: 14,
    color:     0xd0e8ff,   // cool coastal white
    intensity: 90,
    distance:  50,
    height:    6,
  });

  guanajuatoLamps.forEach(l => group.add(l));
  rivieraLamps.forEach(l => group.add(l));

  scene.add(group);
  console.log('[CSMSystem] Street lamps spawned:', group.children.length, 'lights');
  return group;
}

/**
 * Procedurally distribute PointLights across a rectangular grid area.
 * Uses a jittered grid so lamps don't look perfectly algorithmic.
 * @private
 */
function _generateLampGrid({ x1, z1, x2, z2, count, color, intensity, distance, height }) {
  const lights = [];
  const cols   = Math.ceil(Math.sqrt(count * ((x2 - x1) / (z2 - z1))));
  const rows   = Math.ceil(count / cols);
  const dx     = (x2 - x1) / cols;
  const dz     = (z2 - z1) / rows;

  for (let r = 0; r < rows && lights.length < count; r++) {
    for (let c = 0; c < cols && lights.length < count; c++) {
      const jx = (Math.random() - 0.5) * dx * 0.4;
      const jz = (Math.random() - 0.5) * dz * 0.4;
      const px  = x1 + (c + 0.5) * dx + jx;
      const pz  = z1 + (r + 0.5) * dz + jz;

      const light         = new THREE.PointLight(color, intensity, distance, 2);
      light.position.set(px, height, pz);
      light.castShadow    = false;   // too many to cast shadows — baked AO handles near contact
      light.name          = `StreetLamp_${lights.length}`;

      // Tiny emissive sphere to visualise the lamp head
      const bulbGeo = new THREE.SphereGeometry(0.25, 6, 4);
      const bulbMat = new THREE.MeshBasicMaterial({ color });
      const bulb    = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.layers.enable(1); // bloom layer
      light.add(bulb);

      lights.push(light);
    }
  }
  return lights;
}

/**
 * Toggle street-lamp visibility/intensity — call from environment.js when
 * crossing the isNight() threshold.
 *
 * @param {THREE.Group} lampGroup   — returned by spawnStreetLamps()
 * @param {boolean}     nightMode
 */
export function setLampsNightMode(lampGroup, nightMode) {
  if (!lampGroup) return;
  lampGroup.children.forEach(child => {
    if (child.isLight) {
      child.intensity = nightMode ? child.userData.baseIntensity ?? child.intensity : 0;
    }
  });
}

// Store base intensities so we can restore them
export function finaliseLampIntensities(lampGroup) {
  if (!lampGroup) return;
  lampGroup.children.forEach(child => {
    if (child.isLight) child.userData.baseIntensity = child.intensity;
  });
}

// ─── Lava Glow ────────────────────────────────────────────────────────────────

/**
 * Spawn emissive PointLights in the Caldera district to simulate lava glow.
 * 12 lights distributed around the caldera rim and lava flow channels.
 * No shadow casting — intensity 8, radius 15 m (design doc §6).
 *
 * @param {THREE.Scene} scene
 * @returns {THREE.Group}
 */
export function spawnLavaGlow(scene) {
  const group = new THREE.Group();
  group.name  = 'LavaGlow';

  // Caldera bounds: x: -500 → 500, z: -500 → 500 (centre of map volcanic area)
  const lavaPositions = [
    // Caldera rim lights
    [   0, 4,    0 ],
    [ 120, 3,   80 ],
    [ -90, 5,  110 ],
    [  80, 2, -120 ],
    [-140, 4,  -60 ],
    [  50, 6,   30 ],  // highest flow point
    // Lava river channels (flowing south-east)
    [ 200, 2,  150 ],
    [ 280, 1,  220 ],
    [ 350, 1,  290 ],
    [-200, 3, -150 ],
    [-280, 2, -200 ],
    [  10, 4, -200 ],
  ];

  lavaPositions.forEach(([x, y, z], i) => {
    // Colour varies between vivid orange and yellow-white
    const t     = Math.random();
    const color = new THREE.Color().lerpColors(
      new THREE.Color(0xff3300),   // deep lava red-orange
      new THREE.Color(0xff9900),   // yellow-orange
      t
    );

    const light = new THREE.PointLight(color, 8, 15, 2);
    light.position.set(x, y, z);
    light.castShadow = false;
    light.name       = `LavaGlow_${i}`;

    // Pulse animation data
    light.userData.phase     = Math.random() * Math.PI * 2;
    light.userData.baseIntensity = 8;
    light.userData.pulseAmp  = 2 + Math.random() * 3;

    // Tiny emissive sphere for the glow source
    const geo = new THREE.SphereGeometry(0.5 + Math.random() * 0.5, 5, 3);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6600) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.layers.enable(1);  // bloom layer
    light.add(mesh);

    group.add(light);
  });

  scene.add(group);
  console.log('[CSMSystem] Lava glow spawned:', group.children.length, 'lights');
  return group;
}

/**
 * Animate lava glow pulse — call from the UPDATE tick each frame.
 * @param {THREE.Group} lavaGroup
 * @param {number}      time   — elapsed time in seconds
 */
export function updateLavaGlow(lavaGroup, time) {
  if (!lavaGroup) return;
  lavaGroup.children.forEach(child => {
    if (!child.isLight) return;
    const { phase, baseIntensity, pulseAmp } = child.userData;
    // Dual-frequency flicker: slow rumble + fast pop
    const flicker =
      Math.sin(time * 1.7 + phase) * 0.6 +
      Math.sin(time * 7.3 + phase * 2.1) * 0.3 +
      Math.sin(time * 19.1 + phase) * 0.1;
    child.intensity = Math.max(0, baseIntensity + flicker * pulseAmp);
  });
}

// ─── Car Headlights ───────────────────────────────────────────────────────────

/** Headlight rig returned by createCarHeadlights(). */
let _headlightGroup = null;

/**
 * Create a twin-SpotLight headlight rig and attach it to the car group.
 * The SpotLight shadow camera is correctly framed to a 30 m cone so
 * shadows don't bleed or go stale.
 *
 * @param {THREE.Scene}  scene
 * @param {THREE.Object3D} carMesh  — the car's root Object3D
 * @returns {{ group: THREE.Group, left: THREE.SpotLight, right: THREE.SpotLight }}
 */
export function createCarHeadlights(scene, carMesh) {
  const group = new THREE.Group();
  group.name  = 'CarHeadlights';

  const makeSpot = (side) => {
    const spot = new THREE.SpotLight(
      0xfff8e0,    // warm white
      0,           // off at start — environment.js enables at night
      60,          // distance metres
      Math.PI / 8, // cone angle (22.5°) — tight beam
      0.3,         // penumbra
      1.5          // decay
    );

    spot.position.set(side * 0.65, 0.55, 1.95);  // front bumper corners
    spot.castShadow = true;

    const s = spot.shadow;
    s.mapSize.set(512, 512);     // cheaper than main CSM
    s.camera.near = 0.3;
    s.camera.far  = 35;          // tight — prevents shadow bleed far ahead
    s.camera.fov  = 28;
    s.bias        = -0.003;

    spot.layers.enable(1);  // bloom layer — headlight corona

    // Aim target slightly downward and forward
    const target = new THREE.Object3D();
    target.position.set(side * 0.5, -0.4, 20);
    group.add(target);
    spot.target = target;

    return spot;
  };

  const leftSpot  = makeSpot(-1);
  const rightSpot = makeSpot( 1);

  group.add(leftSpot, rightSpot);

  // Add to car mesh so they follow the car automatically
  if (carMesh) {
    carMesh.add(group);
  } else {
    scene.add(group);
  }

  _headlightGroup = { group, left: leftSpot, right: rightSpot };
  return _headlightGroup;

}

/**
 * Update headlight intensity and angle each frame.
 * Call in the UPDATE phase after drivingController.update().
 *
 * @param {{ left: THREE.SpotLight, right: THREE.SpotLight }} headlights
 * @param {{ isNight: boolean, speedKmh: number }} car
 */
export function updateHeadlights(headlights, car) {
  if (!headlights) return;

  const night = car?.isNight ?? false;
  const speed = car?.speedKmh ?? 0;

  // Headlights on at night or in heavy rain
  const targetIntensity = night ? 120 : 0;

  // Smooth fade in/out
  const fadeRate = 0.05;
  headlights.left.intensity  += (targetIntensity - headlights.left.intensity)  * fadeRate;
  headlights.right.intensity += (targetIntensity - headlights.right.intensity) * fadeRate;

  // At high speed, widen the cone slightly (aggressive look)
  const speedT   = Math.min(1, speed / 250);
  const coneAngle = THREE.MathUtils.lerp(Math.PI / 8, Math.PI / 6, speedT);
  headlights.left.angle  = coneAngle;
  headlights.right.angle = coneAngle;
}

// ─── Shadow material flushing ─────────────────────────────────────────────────

/**
 * Flush all queued materials into CSM after async init completes.
 * Called internally — not needed externally.
 * @private
 */
function _flushMaterialQueue() {
  if (_csm && _csmMaterials.size > 0) {
    _csmMaterials.forEach(mat => _csm.setupMaterial(mat));
    console.log(`[CSMSystem] Flushed ${_csmMaterials.size} materials into CSM.`);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { _sunDirection as CSM_SUN_DIRECTION };

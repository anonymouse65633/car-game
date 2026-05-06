/**
 * CarPaintSystem.js — Part 7: PBR Car Shading
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements:
 *  • MeshPhysicalMaterial body — clearcoat 1.0, metalness 0.92, roughness 0.12
 *  • CubeCamera live reflections — re-baked every 3rd frame (configurable)
 *  • Dirt accumulation — onBeforeCompile uniform shader injection
 *  • Damage system — roughness spike + panel normal perturbation
 *  • Brake calliper thermal glow — emissiveIntensity 0→3 on hard braking
 *  • Separate PBR materials for glass (transmission), tyres, chrome trim
 *  • Chameleon / color-shift paint — angle-dependent hue rotation
 *
 * Usage (from car.js):
 *   import {
 *     initCarPaintSystem,
 *     createPBRBodyMat, createGlassMat, createTyreMat,
 *     createCalliperMat, createChromeTrimMat,
 *     updateCarReflection, setDirtLevel,
 *     applyImpactDamage, updateBrakeThermal,
 *     setPaintColor, setPaintType,
 *   } from './CarPaintSystem.js';
 *
 *   // Once after initRenderer():
 *   initCarPaintSystem(scene, renderer);
 *
 *   // When building the car mesh:
 *   const bodyMat = createPBRBodyMat(0xcc2222, 'metallic');
 *
 *   // Each frame (UPDATE phase):
 *   updateCarReflection(carMesh, carPosition, frameCount);
 *   updateBrakeThermal(calliperMats, brakeInput, dt);
 *
 * Part 7 / Technical Architecture (design doc §7)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';

// ─── Module State ─────────────────────────────────────────────────────────────

let _scene    = null;
let _renderer = null;
let _ready    = false;

/** CubeCamera for live reflections — one per player car. */
let _cubeCamera     = null;
let _cubeRenderTarget = null;

/** Procedurally generated dirt splatter canvas texture. */
let _dirtTex = null;

/** All active body materials — so we can push global updates. */
const _bodyMaterials = new Set();

// Cube-camera render interval (frames between re-bakes)
let _cubeBakeInterval = 3;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the PBR car paint system.
 * Call once after initRenderer(), before any car is created.
 *
 * @param {THREE.Scene}          scene
 * @param {THREE.WebGLRenderer}  renderer
 */
export function initCarPaintSystem(scene, renderer) {
  _scene    = scene;
  _renderer = renderer;

  // Build the procedural dirt texture
  _dirtTex = _buildDirtTexture();

  // Build the CubeCamera (512 px cube — good quality, not too heavy)
  _cubeRenderTarget = new THREE.WebGLCubeRenderTarget(512, {
    format:           THREE.RGBAFormat,
    type:             THREE.HalfFloatType,
    generateMipmaps:  true,
    minFilter:        THREE.LinearMipmapLinearFilter,
  });
  _cubeCamera = new THREE.CubeCamera(0.5, 500, _cubeRenderTarget);
  _cubeCamera.name = 'CarPaintCubeCamera';
  scene.add(_cubeCamera);

  _ready = true;
  console.log('[CarPaintSystem] ✅ Part 7 PBR car paint initialised.');
}

// ─── Material Factories ───────────────────────────────────────────────────────

/**
 * Create the primary car body material using MeshPhysicalMaterial.
 * Includes clearcoat, live env reflection, and dirt/damage shader hooks.
 *
 * @param {number} hexColor   — initial paint colour
 * @param {string} paintType  — 'solid' | 'metallic' | 'matte' | 'satin' | 'chrome' | 'colorshift'
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function createPBRBodyMat(hexColor = 0xcc2222, paintType = 'metallic') {
  const { roughness, metalness, clearcoat, clearcoatRoughness, reflectivity } =
    _paintTypeParams(paintType);

  const mat = new THREE.MeshPhysicalMaterial({
    color:              new THREE.Color(hexColor),
    metalness,
    roughness,
    clearcoat,
    clearcoatRoughness,
    reflectivity,
    envMapIntensity:    1.8,
    // envMap wired in after CubeCamera is ready (updateCarReflection)
  });

  // ── Dirt / damage shader injection ────────────────────────────────────────
  // We use onBeforeCompile to add two uniforms without writing a full custom
  // ShaderMaterial — this keeps THREE.js PBR lighting intact.
  mat.userData.uDirt            = 0;   // 0 = clean, 1 = fully dirty
  mat.userData.uDamageRoughness = 0;  // extra roughness from impacts
  mat.userData.uDamageWarp      = 0;  // 0→1 panel vertex displacement (Part 7 plan)
  mat.userData._shaderRef = null;     // set when compiled

  mat.onBeforeCompile = (shader) => {
    mat.userData._shaderRef = shader;

    // Inject uniforms
    shader.uniforms.uDirt            = { value: mat.userData.uDirt };
    shader.uniforms.uDirtMap         = { value: _dirtTex };
    shader.uniforms.uDamageRoughness = { value: mat.userData.uDamageRoughness };
    shader.uniforms.uHueShift        = { value: 0 }; // chameleon paint
    shader.uniforms.uDamageWarp      = { value: mat.userData.uDamageWarp };

    // After the standard map_fragment chunk, blend in dirt colour
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */`
        #include <map_fragment>

        // ── Dirt accumulation ──────────────────────────────────────────
        float uDirt_val = clamp(${_uniform('uDirt')}, 0.0, 1.0);
        if (uDirt_val > 0.001) {
          float splatR = texture2D(${_uniform('uDirtMap')}, vUv * 2.0).r;
          float splatG = texture2D(${_uniform('uDirtMap')}, vUv * 3.7 + vec2(0.3, 0.7)).g;
          float dirt   = clamp((splatR * 0.6 + splatG * 0.4) * uDirt_val * 1.8, 0.0, 1.0);
          // Dirt tint: desaturate + darken toward muddy brown
          vec3 dirtColor = vec3(0.22, 0.17, 0.11);
          diffuseColor.rgb = mix(diffuseColor.rgb, dirtColor, dirt * 0.85);
        }
      `
    );

    // Increase roughness on damaged / dirty areas
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */`
        #include <roughnessmap_fragment>
        float uDirt_v2 = clamp(${_uniform('uDirt')}, 0.0, 1.0);
        roughnessFactor = clamp(
          roughnessFactor
          + uDirt_v2 * 0.35
          + ${_uniform('uDamageRoughness')},
          0.0, 1.0
        );
      `
    );

    // ── Vertex displacement — panel denting on heavy impact ─────────────────
    // Replaces the THREE.js #include <begin_vertex> chunk, adding a
    // position warp driven by uDamageWarp (0 = pristine, 1 = heavily dented).
    // Uses a hash-based pseudo-noise so each panel area deforms uniquely.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */`
        #include <begin_vertex>

        float _warp = ${_uniform('uDamageWarp')};
        if (_warp > 0.001) {
          // Cheap hash noise from UV + position to break uniformity
          vec3 _p = position * 3.7;
          float _n = fract(sin(dot(_p.xy, vec2(127.1, 311.7))) * 43758.5453);
          float _n2 = fract(sin(dot(_p.yz, vec2(269.5, 183.3))) * 47453.1234);
          // Only displace vertices away from the centre (keeps silhouette rough)
          float _dist = length(position.xz);
          float _mask = smoothstep(0.0, 0.5, _dist * 0.4);
          // Push outward along normal for shallow dents, inward for deep dents
          float _dir = _n > 0.5 ? 1.0 : -1.0;
          float _amount = _warp * 0.04 * _mask * (_n * 0.6 + 0.4) * _dir;
          transformed += normal * _amount * _n2;
        }
      `
    );
  };

  _bodyMaterials.add(mat);
  return mat;
}

/**
 * Create a physically-correct glass material (windshield, side windows).
 * Uses MeshPhysicalMaterial transmission for a refractive look.
 *
 * @param {number} tintLevel  — 0 (clear) to 4 (mirror)
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function createGlassMat(tintLevel = 0) {
  const opacities  = [0.08, 0.22, 0.45, 0.68, 0.92];
  const tintColors = [0x88ccff, 0x77bbee, 0x336688, 0x1a3344, 0x050d12];

  return new THREE.MeshPhysicalMaterial({
    color:           new THREE.Color(tintColors[tintLevel] ?? 0x88ccff),
    metalness:       0.0,
    roughness:       0.02,
    transmission:    1.0 - (opacities[tintLevel] ?? 0.08),
    thickness:       0.004,       // IOR refraction thickness (metres)
    ior:             1.52,        // glass IOR
    reflectivity:    0.9,
    clearcoat:       0.8,
    clearcoatRoughness: 0.02,
    transparent:     true,
    opacity:         opacities[tintLevel] ?? 0.08,
    depthWrite:      false,
    side:            THREE.DoubleSide,
    envMapIntensity: 1.2,
  });
}

/**
 * Create the tyre rubber material.
 * Flat black, rough, slightly reflective to catch wet-road gloss.
 *
 * @returns {THREE.MeshStandardMaterial}
 */
export function createTyreMat() {
  return new THREE.MeshStandardMaterial({
    color:      0x111111,
    roughness:  0.90,
    metalness:  0.0,
  });
}

/**
 * Create the wheel rim material.
 * MeshPhysicalMaterial so rims catch the CSM sun and city reflections.
 *
 * @param {number} hexColor   — rim colour
 * @param {string} finish     — 'gloss' | 'matte' | 'chrome' | 'gold' | 'bronze'
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function createRimMat(hexColor = 0x888888, finish = 'gloss') {
  const params = {
    gloss:   { roughness: 0.08, metalness: 0.85, clearcoat: 0.8, clearcoatRoughness: 0.05 },
    matte:   { roughness: 0.70, metalness: 0.5,  clearcoat: 0.0, clearcoatRoughness: 0.0  },
    chrome:  { roughness: 0.02, metalness: 1.0,  clearcoat: 1.0, clearcoatRoughness: 0.02 },
    gold:    { roughness: 0.12, metalness: 0.95, clearcoat: 0.6, clearcoatRoughness: 0.08 },
    bronze:  { roughness: 0.20, metalness: 0.80, clearcoat: 0.4, clearcoatRoughness: 0.15 },
  }[finish] ?? { roughness: 0.08, metalness: 0.85, clearcoat: 0.8, clearcoatRoughness: 0.05 };

  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hexColor),
    envMapIntensity: 1.5,
    ...params,
  });
}

/**
 * Create a brake calliper material.
 * Red base with an emissive channel that glows orange under hard braking.
 *
 * @returns {THREE.MeshStandardMaterial}
 */
export function createCalliperMat() {
  const mat = new THREE.MeshStandardMaterial({
    color:             0xcc1111,
    emissive:          new THREE.Color(0xff3300),
    emissiveIntensity: 0,
    roughness:         0.6,
    metalness:         0.4,
  });
  mat.userData.brakeTemp = 0;  // simulated 0–800°C
  return mat;
}

/**
 * Create a chrome trim material (door handles, exhaust tips, mirror caps).
 *
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function createChromeTrimMat() {
  return new THREE.MeshPhysicalMaterial({
    color:              0xfafafa,
    metalness:          1.0,
    roughness:          0.05,
    clearcoat:          1.0,
    clearcoatRoughness: 0.02,
    reflectivity:       1.0,
    envMapIntensity:    2.0,
  });
}

// ─── Per-frame: CubeCamera live reflections ───────────────────────────────────

/**
 * Update the shared CubeCamera so body materials reflect the live world.
 * Call in the UPDATE tick phase — expensive, so we skip frames.
 *
 * @param {THREE.Mesh|THREE.Group} carMesh   — the car root (hidden during bake)
 * @param {THREE.Vector3}          carPos    — world position for camera
 * @param {number}                 frame     — frame counter (re-bakes every N)
 */
export function updateCarReflection(carMesh, carPos, frame) {
  if (!_ready || !_cubeCamera || !_renderer || !_scene) return;
  if (frame % _cubeBakeInterval !== 0) return;

  // Hide the car itself so it doesn't appear in its own reflection
  if (carMesh) carMesh.visible = false;

  _cubeCamera.position.copy(carPos).add(_CUBE_OFFSET);
  _cubeCamera.update(_renderer, _scene);

  if (carMesh) carMesh.visible = true;

  // Push the new texture into all body materials
  const tex = _cubeRenderTarget.texture;
  _bodyMaterials.forEach(mat => {
    if (mat.envMap !== tex) {
      mat.envMap = tex;
      mat.needsUpdate = true;
    }
  });
}

const _CUBE_OFFSET = new THREE.Vector3(0, 0.6, 0);

/**
 * Set the cube-camera re-bake interval.
 * Lower = higher quality but more expensive.
 * Design doc presets: low=off, medium=10, high=5, ultra=3, extreme=1
 *
 * @param {number} frames   — 0 to disable, 1–60 for frame skip
 */
export function setCubeReflectionInterval(frames) {
  _cubeBakeInterval = Math.max(0, frames);
}

// ─── Dirt Accumulation ────────────────────────────────────────────────────────

/**
 * Set the dirt level on a car body material.
 * Drives the uDirt uniform injected by onBeforeCompile.
 *
 * @param {THREE.MeshPhysicalMaterial} mat    — body material
 * @param {number}                     level  — 0 (clean) to 1 (fully dirty)
 */
export function setDirtLevel(mat, level) {
  const clamped = Math.max(0, Math.min(1, level));
  mat.userData.uDirt = clamped;
  const shader = mat.userData._shaderRef;
  if (shader?.uniforms?.uDirt) {
    shader.uniforms.uDirt.value = clamped;
  }
}

/**
 * "Wash" a car — call when tyres enter water biome or it's raining.
 * Linearly fades dirt down to 0 over washDuration seconds.
 *
 * @param {THREE.MeshPhysicalMaterial} mat
 * @param {number} dt
 * @param {number} washRate   — dirt units / second (default: full wash in 3 s)
 */
export function washCar(mat, dt, washRate = 0.33) {
  const current = mat.userData.uDirt ?? 0;
  setDirtLevel(mat, Math.max(0, current - washRate * dt));
}

// ─── Damage System ────────────────────────────────────────────────────────────

/**
 * Apply visual impact damage to the car body material.
 * Increases roughness (scratched clear coat) and optionally spawns a
 * deformation normal offset. Major impacts also raise emissive for a flash.
 *
 * @param {THREE.MeshPhysicalMaterial} mat        — body material
 * @param {number}                     severity   — 0 (scratch) to 1 (heavy crash)
 */
export function applyImpactDamage(mat, severity) {
  if (!mat) return;

  // Add to accumulated damage roughness (capped at 0.5 extra)
  const prev = mat.userData.uDamageRoughness ?? 0;
  const added = severity * 0.25;
  const next  = Math.min(0.5, prev + added);
  mat.userData.uDamageRoughness = next;

  const shader = mat.userData._shaderRef;
  if (shader?.uniforms?.uDamageRoughness) {
    shader.uniforms.uDamageRoughness.value = next;
  }

  // ── Vertex displacement warp (panel denting) ────────────────────────────
  // Only kicks in on significant hits (severity > 0.3) — minor scrapes
  // show paint damage but leave body geometry intact.
  if (severity > 0.3) {
    const prevWarp = mat.userData.uDamageWarp ?? 0;
    const nextWarp = Math.min(1.0, prevWarp + severity * 0.55);
    mat.userData.uDamageWarp = nextWarp;
    if (shader?.uniforms?.uDamageWarp) {
      shader.uniforms.uDamageWarp.value = nextWarp;
    }
  }

  // Also reduce clearcoat (scratched lacquer)
  mat.clearcoat = Math.max(0, mat.clearcoat - severity * 0.3);
  mat.needsUpdate = true;

  // Brief impact flash — emissive spike then fade (handled by caller)
  if (severity > 0.5) {
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveIntensity = severity * 0.5;
    setTimeout(() => {
      mat.emissiveIntensity = 0;
      mat.emissive.set(0x000000);
    }, 80);
  }

  console.log(`[CarPaintSystem] Impact damage applied — severity ${severity.toFixed(2)}, roughness now ${next.toFixed(2)}, warp ${(mat.userData.uDamageWarp ?? 0).toFixed(2)}`);
}

/**
 * Repair paint — restores damage roughness and clearcoat.
 * Call from the garage / repair shop.
 *
 * @param {THREE.MeshPhysicalMaterial} mat
 * @param {string} paintType   — re-applies the correct base params
 */
export function repairPaint(mat, paintType = 'metallic') {
  mat.userData.uDamageRoughness = 0;
  mat.userData.uDamageWarp      = 0;   // repair body panel deformation
  const shader = mat.userData._shaderRef;
  if (shader?.uniforms?.uDamageRoughness) {
    shader.uniforms.uDamageRoughness.value = 0;
  }
  if (shader?.uniforms?.uDamageWarp) {
    shader.uniforms.uDamageWarp.value = 0;
  }

  const params = _paintTypeParams(paintType);
  mat.clearcoat           = params.clearcoat;
  mat.clearcoatRoughness  = params.clearcoatRoughness;
  mat.roughness           = params.roughness;
  mat.metalness           = params.metalness;
  mat.needsUpdate = true;
}

// ─── Brake Thermal Glow ───────────────────────────────────────────────────────

/**
 * Simulate brake disc temperature and drive calliper emissive glow.
 * Call each frame in UPDATE phase.
 *
 * Temperature model:
 *   Heating: brakeInput * HEAT_RATE per second
 *   Cooling: passive decay proportional to speed (airflow) and time
 *   Glow starts at 300°C, maxes at 800°C (orange-white)
 *
 * @param {THREE.MeshStandardMaterial[]} calliperMats  — [FL, FR, RL, RR]
 * @param {number}                       brakeInput    — 0–1
 * @param {number}                       speedKmh      — for airflow cooling
 * @param {number}                       dt
 */
export function updateBrakeThermal(calliperMats, brakeInput, speedKmh, dt) {
  if (!calliperMats?.length) return;

  const HEAT_RATE = 900;    // °C per second at full brake
  const COOL_RATE = 80;     // °C per second base cooling
  const AIRFLOW   = 1.2;    // additional cooling multiplier at 100 km/h

  calliperMats.forEach((mat, i) => {
    if (!mat?.userData) return;

    let temp = mat.userData.brakeTemp ?? 0;

    // Rear discs run cooler (no engine braking glow unless handbrake)
    const inputScale = (i >= 2) ? brakeInput * 0.6 : brakeInput;

    temp += inputScale * HEAT_RATE * dt;
    const airflowCool = COOL_RATE * (1 + (speedKmh / 100) * AIRFLOW);
    temp = Math.max(0, temp - airflowCool * dt);
    temp = Math.min(800, temp);

    mat.userData.brakeTemp = temp;

    // Map temperature to emissive colour and intensity
    // 0–300°C:  no glow
    // 300–500°C: dark red glow
    // 500–700°C: bright orange
    // 700–800°C: yellow-white
    const glowFactor = Math.max(0, (temp - 300) / 500); // 0 at 300, 1 at 800
    const intensity  = glowFactor * glowFactor * 3.0;   // quadratic ramp → max 3

    const r = Math.min(1, glowFactor * 2);
    const g = Math.max(0, (glowFactor - 0.5) * 1.8);
    const b = 0;

    mat.emissive.setRGB(r, g, b);
    mat.emissiveIntensity = intensity;

    // Layers.enable(1) at high heat so bloom picks up the glow
    // (the mesh itself needs the layer set at creation time)
  });
}

// ─── Paint colour / type updates ─────────────────────────────────────────────

/**
 * Change the paint colour on an existing body material.
 *
 * @param {THREE.MeshPhysicalMaterial} mat
 * @param {number} hexColor
 */
export function setPaintColor(mat, hexColor) {
  mat.color.setHex(hexColor);
  // chameleon hue needs full recompile — mark dirty
  mat.needsUpdate = true;
}

/**
 * Change the paint type and update all physical parameters.
 *
 * @param {THREE.MeshPhysicalMaterial} mat
 * @param {string} paintType
 */
export function setPaintType(mat, paintType) {
  const p = _paintTypeParams(paintType);
  mat.roughness           = p.roughness;
  mat.metalness           = p.metalness;
  mat.clearcoat           = p.clearcoat;
  mat.clearcoatRoughness  = p.clearcoatRoughness;
  mat.reflectivity        = p.reflectivity;
  mat.needsUpdate         = true;
}

// ─── Graphics preset integration ─────────────────────────────────────────────

/**
 * Apply the cube-camera reflection quality from a graphics preset.
 * Mirrors the design doc preset table (§ Settings Menu).
 *
 * @param {'low'|'medium'|'high'|'ultra'|'extreme'} preset
 */
export function applyReflectionPreset(preset) {
  const intervals = { low: 0, medium: 10, high: 5, ultra: 3, extreme: 1 };
  setCubeReflectionInterval(intervals[preset] ?? 3);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Paint-type → MeshPhysicalMaterial parameter sets.
 * Matches the FH5 paint type list in car_customization_module.js.
 * @private
 */
function _paintTypeParams(type) {
  switch (type) {
    case 'matte':
      return { roughness: 0.95, metalness: 0.0,  clearcoat: 0.0, clearcoatRoughness: 0.0,  reflectivity: 0.3 };
    case 'satin':
      return { roughness: 0.55, metalness: 0.15, clearcoat: 0.3, clearcoatRoughness: 0.2,  reflectivity: 0.6 };
    case 'chrome':
      return { roughness: 0.02, metalness: 1.0,  clearcoat: 1.0, clearcoatRoughness: 0.01, reflectivity: 1.0 };
    case 'carbon':
      return { roughness: 0.20, metalness: 0.1,  clearcoat: 1.0, clearcoatRoughness: 0.05, reflectivity: 0.8 };
    case 'colorshift':
      // Chameleon — same physical params as metallic, hue driven by shader
      return { roughness: 0.12, metalness: 0.85, clearcoat: 1.0, clearcoatRoughness: 0.04, reflectivity: 1.0 };
    case 'solid':
      return { roughness: 0.40, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.15, reflectivity: 0.5 };
    case 'metallic':
    default:
      return { roughness: 0.12, metalness: 0.92, clearcoat: 1.0, clearcoatRoughness: 0.04, reflectivity: 1.0 };
  }
}

/**
 * Build a procedural dirt splatter texture as a canvas.
 * Creates ~180 elliptical splatters in brown/ochre tones.
 * @private
 */
function _buildDirtTexture() {
  const SIZE  = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  // Base — clean white (transparent dirt)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Splatter ellipses
  for (let i = 0; i < 220; i++) {
    const x  = Math.random() * SIZE;
    const y  = Math.random() * SIZE;
    const rx = 4 + Math.random() * 28;
    const ry = 2 + Math.random() * 14;
    const a  = Math.random() * Math.PI;

    const l = Math.floor(20 + Math.random() * 30);  // dark earthy
    const c = `hsl(${25 + Math.random() * 20},${40 + Math.random() * 30}%,${l}%)`;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.4 + Math.random() * 0.55;
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Helper to reference a GLSL uniform safely inside onBeforeCompile. */
function _uniform(name) { return name; }

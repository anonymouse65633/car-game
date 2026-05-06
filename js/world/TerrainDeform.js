/**
 * TerrainDeform.js — Deformable Terrain (Part 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements persistent tyre-track ruts on dirt/sand surfaces using a
 * GPU ping-pong render-target pipeline.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *  Each frame a 512×512 "deformation map" render target is updated:
 *    1. The previous frame's deform RT is faded by ×0.998   (~30 s to disappear)
 *    2. White circles are stamped at each tyre contact position (world→UV)
 *    3. The result is stored in the active RT and swapped with the ping-pong
 *  The terrain material samples this RT in its vertex shader and displaces
 *  vertices downward by up to DEFORM_DEPTH metres where the map is bright.
 *
 * ── Biome gating ─────────────────────────────────────────────────────────────
 *  Deformation is ONLY applied on deformable surfaces (dirt, sand, farmland,
 *  jungle).  Cobblestone (guanajuato), tarmac (highway, festival) and lava
 *  (caldera) are excluded — tyre-circle stamping is suppressed for those biomes.
 *  The exclusion is implemented CPU-side; no GPU mask texture is required.
 *
 * ── Integration ──────────────────────────────────────────────────────────────
 *  1. Call initTerrainDeform(renderer) once after initRenderer().
 *  2. Call patchTerrainMaterial(material) on every terrain chunk material
 *     immediately after the chunk mesh is created (in city.js).
 *  3. Call updateDeform(dt, car, aiCars) every LATE tick from loop.js.
 *  4. (Optional) Call registerDirtBurstCallback(fn) to hook into Part 8
 *     particle FX — fn is called with (worldX, worldZ, biome) per active tyre.
 *
 * ── Exports ──────────────────────────────────────────────────────────────────
 *  initTerrainDeform(renderer)
 *  patchTerrainMaterial(material)
 *  updateDeform(dt, car, aiCars)
 *  registerDirtBurstCallback(fn)
 *  isDeformableSurface(biome)
 *  getDeformTexture()           → THREE.Texture  (for debugging / custom mats)
 *  setDeformResolution(res)     → resize RT (128 | 256 | 512 | 1024)
 *  dispose()
 */

'use strict';

import * as THREE from 'three';
import { WORLD_MIN_X, WORLD_MIN_Z, WORLD_W, WORLD_D } from './terrain.js';
import { getBiome } from './terrain.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Deform render-target resolution.  Must be a power of two.
 *  Can be changed at runtime via setDeformResolution(). */
let RT_SIZE = 512;

/** Vertical displacement applied at full deform value (metres downward). */
const DEFORM_DEPTH = 0.08;   // 8 cm rut depth

/** Tyre footprint radius in world metres (used to compute UV radius). */
const TYRE_RADIUS_M = 0.40;

/** Per-frame fade factor.  0.998 → tracks visible for ~30 s at 60 fps. */
const FADE_FACTOR = 0.998;

/** Maximum number of AI cars whose tracks are rendered (uniform array size). */
const MAX_AI_CARS = 8;

/** Biomes where deformation is ACTIVE. */
const DEFORMABLE_BIOMES = new Set(['dunas', 'baja', 'farmland', 'jungle']);

// ─── Module state ─────────────────────────────────────────────────────────────

/** @type {THREE.WebGLRenderer} */
let _renderer = null;

/** Ping-pong render targets. */
let _rtA = null;
let _rtB = null;

/** Full-screen triangle mesh used to run the deform update shader. */
let _quad = null;

/** @type {THREE.ShaderMaterial} — updates the deform map each frame. */
let _updateMat = null;

/** @type {THREE.Scene} — minimal scene containing just the quad. */
let _quadScene = null;

/** @type {THREE.OrthographicCamera} — NDC ortho cam for the quad pass. */
let _quadCam = null;

/** Accumulated list of tyre world positions to stamp this frame.
 *  Array of { x, z } pairs (world metres).  Cleared each frame after upload. */
let _pendingStamps = [];

/** Optional callback → (wx, wz, biome) called per active tyre per frame. */
let _dirtBurstCallback = null;

/** Set of patched materials — avoids double-patching. */
const _patchedMaterials = new Set();

/** Whether the system has been initialised. */
let _ready = false;

// ─── Public: init ─────────────────────────────────────────────────────────────

/**
 * Initialise the deform pipeline.
 * Must be called once after initRenderer(), before the first game tick.
 *
 * @param {THREE.WebGLRenderer} renderer
 */
export function initTerrainDeform(renderer) {
  _renderer = renderer;
  _buildRenderTargets();
  _buildQuadPipeline();
  _ready = true;
  console.log('[TerrainDeform] ✅ Initialised — RT size:', RT_SIZE);
}

// ─── Public: per-frame update ─────────────────────────────────────────────────

/**
 * Update the deformation map for this frame.
 * Call this in the LATE game-loop phase, after car physics have been stepped,
 * so suspension contactPoint values are current.
 *
 * @param {number}   dt      Frame delta-time in seconds
 * @param {object}   car     Player Car instance (from car.js)
 * @param {object[]} [aiCars=[]]  Array of AI Car instances
 */
export function updateDeform(dt, car, aiCars = []) {
  if (!_ready) return;

  _pendingStamps.length = 0;

  // ── Collect player tyre stamps ─────────────────────────────────────────────
  _collectCarStamps(car);

  // ── Collect AI tyre stamps ─────────────────────────────────────────────────
  const limit = Math.min(aiCars.length, MAX_AI_CARS);
  for (let i = 0; i < limit; i++) {
    _collectCarStamps(aiCars[i]);
  }

  // ── Run GPU deform update pass ─────────────────────────────────────────────
  _runDeformPass();
}

// ─── Public: material patching ────────────────────────────────────────────────

/**
 * Inject deformation sampling into a terrain chunk MeshStandardMaterial
 * (or MeshPhongMaterial / MeshLambertMaterial).
 *
 * Must be called BEFORE the material is first used in a render call.
 * Safe to call on the same material multiple times — subsequent calls are no-ops.
 *
 * The injected vertex shader code:
 *   - Converts each vertex's world XZ to a deform-map UV
 *   - Samples the red channel of uDeformMap
 *   - Displaces the vertex downward by up to DEFORM_DEPTH metres
 *
 * @param {THREE.Material} material  Any Three.js material with onBeforeCompile support
 */
export function patchTerrainMaterial(material) {
  if (_patchedMaterials.has(material)) return;
  _patchedMaterials.add(material);

  // Store the texture reference now; will be current because _rtA is the
  // active read target by the time the shader runs.
  material.userData.deformMap = _rtA?.texture ?? null;

  material.onBeforeCompile = (shader) => {
    // ── Uniforms ────────────────────────────────────────────────────────────
    shader.uniforms.uDeformMap    = { value: _rtA?.texture ?? null };
    shader.uniforms.uDeformDepth  = { value: DEFORM_DEPTH };
    shader.uniforms.uWorldMin     = { value: new THREE.Vector2(WORLD_MIN_X, WORLD_MIN_Z) };
    shader.uniforms.uWorldSize    = { value: new THREE.Vector2(WORLD_W, WORLD_D) };

    // Keep a live reference so we can update it when RT is swapped
    material.userData._deformShaderRef = shader;

    // ── Vertex preamble — declare uniform + helper ──────────────────────────
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `
        #include <common>

        uniform sampler2D uDeformMap;
        uniform float     uDeformDepth;
        uniform vec2      uWorldMin;
        uniform vec2      uWorldSize;

        float sampleDeform(vec3 worldPos) {
          vec2 uv = (worldPos.xz - uWorldMin) / uWorldSize;
          uv = clamp(uv, 0.0, 1.0);
          return texture2D(uDeformMap, uv).r;
        }
      `
    );

    // ── Vertex body — apply displacement after world transform ──────────────
    // We hook just before the final gl_Position assignment so that the world
    // position is available in `transformed` (Three.js convention).
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
        // Compute world position for this vertex (model → world)
        vec4 _worldPos4 = modelMatrix * vec4(transformed, 1.0);
        vec3 _worldPos  = _worldPos4.xyz;

        // Sample deformation map and push vertex down
        float _deform = sampleDeform(_worldPos);
        transformed.y -= _deform * uDeformDepth;

        // Standard projection (recalculated after displacement)
        #include <project_vertex>
      `
    );
  };

  // Mark material as needing shader recompile
  material.needsUpdate = true;
}

// ─── Public: helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when the given biome should receive tyre-track deformation.
 * Used by the caller to gate deformation FX (e.g. particle spawning in Part 8).
 *
 * @param {string} biome
 * @returns {boolean}
 */
export function isDeformableSurface(biome) {
  return DEFORMABLE_BIOMES.has(biome);
}

/**
 * Returns the current deformation map texture (read target).
 * Useful for debug visualisation or custom material setups.
 *
 * @returns {THREE.Texture|null}
 */
export function getDeformTexture() {
  return _rtA?.texture ?? null;
}

/**
 * Register a callback to be invoked once per active tyre per frame,
 * whenever that tyre is on a deformable surface.
 * Used by Part 8 (ParticleFX) to spawn dirt burst particles.
 *
 * @param {Function|null} fn  Called with (worldX: number, worldZ: number, biome: string)
 */
export function registerDirtBurstCallback(fn) {
  _dirtBurstCallback = fn;
}

/**
 * Resize the deformation render targets at runtime.
 * Useful for quality presets (Low→High).
 *
 * @param {128|256|512|1024} resolution
 */
export function setDeformResolution(resolution) {
  if (!_ready) { RT_SIZE = resolution; return; }
  RT_SIZE = resolution;
  _rtA.dispose();
  _rtB.dispose();
  _buildRenderTargets();
  // Re-link the update shader's uDeformPrev source
  if (_updateMat) {
    _updateMat.uniforms.uDeformPrev.value = _rtA.texture;
  }
  // Re-link all patched terrain materials
  for (const mat of _patchedMaterials) {
    const ref = mat.userData._deformShaderRef;
    if (ref) ref.uniforms.uDeformMap.value = _rtA.texture;
  }
  console.log('[TerrainDeform] RT resized to', resolution);
}

/**
 * Free all GPU resources.  Call on scene teardown / hot-reload.
 */
export function dispose() {
  _rtA?.dispose();
  _rtB?.dispose();
  _updateMat?.dispose();
  _quad?.geometry.dispose();
  _patchedMaterials.clear();
  _ready = false;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build (or rebuild) the two ping-pong WebGLRenderTargets.
 * Uses FloatType so accumulated deform values aren't clamped to [0,1].
 */
function _buildRenderTargets() {
  const opts = {
    minFilter:    THREE.LinearFilter,
    magFilter:    THREE.LinearFilter,
    format:       THREE.RGBAFormat,
    type:         THREE.HalfFloatType, // Float32 unavailable on some mobile GPU; Half is fine
    depthBuffer:  false,
    stencilBuffer: false,
  };
  _rtA = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, opts);
  _rtB = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, opts);
  _rtA.texture.name = 'DeformMapA';
  _rtB.texture.name = 'DeformMapB';
}

/**
 * Build the full-screen-quad scene, camera and shader material used to
 * update the deformation map each frame.
 *
 * The shader does two things in a single pass:
 *  1. Fades the previous frame's deform map by FADE_FACTOR
 *  2. Stamps a soft white circle for each tyre position in uStamps[]
 */
function _buildQuadPipeline() {
  // ── Orthographic camera covers the full NDC quad [-1,1]×[-1,1] ─────────────
  _quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ── Full-screen triangle (three verts cover the whole screen) ───────────────
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,   3, -1, 0,   -1,  3, 0,
  ], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,   2, 0,   0, 2,
  ], 2));

  // ── Stamp uniform arrays — up to 4 player + 4×8 AI = 36 positions ──────────
  // We encode as flat vec4 array: .xy = UV position, .z = radius (UV), .w = unused
  const MAX_STAMPS = 4 + MAX_AI_CARS * 4;   // player tyres + AI tyres
  const stampData  = new Float32Array(MAX_STAMPS * 4);   // vec4 per stamp

  _updateMat = new THREE.ShaderMaterial({
    uniforms: {
      uDeformPrev:  { value: _rtA.texture },
      uFade:        { value: FADE_FACTOR },
      uStamps:      { value: stampData },         // flat Float32Array
      uStampCount:  { value: 0 },
      uStampRadius: { value: TYRE_RADIUS_M / Math.max(WORLD_W, WORLD_D) }, // UV radius
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDeformPrev;
      uniform float     uFade;
      uniform float     uStamps[${MAX_STAMPS * 4}]; // packed vec4s
      uniform int       uStampCount;
      uniform float     uStampRadius;
      varying vec2      vUv;

      float softCircle(vec2 uv, vec2 centre, float radius) {
        float d = length(uv - centre);
        // Smooth step: full intensity inside radius, falls off over 30% extra
        return 1.0 - smoothstep(radius * 0.7, radius * 1.3, d);
      }

      void main() {
        // 1. Fade previous deformation
        float prev = texture2D(uDeformPrev, vUv).r * uFade;

        // 2. Add contribution from each tyre stamp
        float stamp = 0.0;
        for (int i = 0; i < ${MAX_STAMPS}; i++) {
          if (i >= uStampCount) break;
          int  base  = i * 4;
          vec2 sUV   = vec2(uStamps[base], uStamps[base + 1]);
          float sRad = uStamps[base + 2];
          if (sRad <= 0.0) continue;
          stamp = max(stamp, softCircle(vUv, sUV, sRad));
        }

        float value = min(1.0, prev + stamp);
        gl_FragColor = vec4(value, 0.0, 0.0, 1.0);
      }
    `,
    depthTest:  false,
    depthWrite: false,
  });

  _quad = new THREE.Mesh(geo, _updateMat);
  _quad.frustumCulled = false;

  _quadScene = new THREE.Scene();
  _quadScene.add(_quad);
}

/**
 * Collect tyre world positions from a Car instance and add deformable ones
 * to _pendingStamps.  Also fires the dirt burst callback for Part 8.
 *
 * @param {object} car  Car instance with .suspension and .position
 */
function _collectCarStamps(car) {
  if (!car) return;

  const susp = car.suspension;
  if (!susp) return;

  // Walk all four wheel indices
  const wheelStates = susp.wheels;
  if (!wheelStates) return;

  for (let i = 0; i < 4; i++) {
    const ws = wheelStates[i];
    if (!ws || !ws.inContact) continue;  // airborne or uninitialised

    const cp = ws.contactPoint;
    if (!cp) continue;

    const wx = cp.x;
    const wz = cp.z;

    // Biome check — deform only on dirt/sand surfaces
    const biome = getBiome(wx, wz);
    if (!isDeformableSurface(biome)) continue;

    // Normalise world position to UV
    const u = (wx - WORLD_MIN_X) / WORLD_W;
    const v = (wz - WORLD_MIN_Z) / WORLD_D;

    // UV-space tyre footprint radius (elliptical — wider track than long)
    const ruv = TYRE_RADIUS_M / Math.max(WORLD_W, WORLD_D);

    _pendingStamps.push({ u, v, r: ruv });

    // Part 8 hook — notify particle system
    if (_dirtBurstCallback) {
      _dirtBurstCallback(wx, wz, biome);
    }
  }
}

/**
 * Execute the deformation update shader pass using the current _pendingStamps,
 * then swap the ping-pong targets so the new result is the read target.
 */
function _runDeformPass() {
  const mat = _updateMat;
  if (!mat) return;

  // ── Upload stamp positions ─────────────────────────────────────────────────
  const stamps    = mat.uniforms.uStamps.value;
  const maxStamps = stamps.length / 4;
  const count     = Math.min(_pendingStamps.length, maxStamps);

  for (let i = 0; i < count; i++) {
    const { u, v, r } = _pendingStamps[i];
    stamps[i * 4]     = u;
    stamps[i * 4 + 1] = v;
    stamps[i * 4 + 2] = r;
    stamps[i * 4 + 3] = 0;
  }
  mat.uniforms.uStampCount.value   = count;
  mat.uniforms.uDeformPrev.value   = _rtA.texture;  // read from A

  // ── Render into B ──────────────────────────────────────────────────────────
  const prevRT = _renderer.getRenderTarget();
  _renderer.setRenderTarget(_rtB);
  _renderer.render(_quadScene, _quadCam);
  _renderer.setRenderTarget(prevRT);   // restore whatever was active before

  // ── Swap A ↔ B ─────────────────────────────────────────────────────────────
  const tmp = _rtA;
  _rtA = _rtB;
  _rtB = tmp;

  // ── Propagate new read-target texture to all patched terrain materials ──────
  // This is a texture-handle swap — no recompile needed.
  for (const material of _patchedMaterials) {
    const ref = material.userData._deformShaderRef;
    if (ref?.uniforms?.uDeformMap) {
      ref.uniforms.uDeformMap.value = _rtA.texture;
    }
  }
}

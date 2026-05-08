/**
 * MotionBlur.js  —  Part 6: Standalone Speed Motion Blur
 * ─────────────────────────────────────────────────────────────────────────────
 * A self-contained motion blur post-processing pass that works with OR without
 * the full PostFX stack. PostFX.js already includes an embedded MotionBlurShader;
 * this module is the canonical standalone version the plan calls for.
 *
 * Algorithm:
 *   Radial blur (8 samples) emanating from screen centre, strength scaled by
 *   car speed.  Ramps from 0 at ≤80 km/h to max at 300 km/h.
 *   A soft directional component along the lateral G-vector adds extra smear
 *   on hard cornering — makes fast slides feel physical.
 *
 * Integration modes:
 *   A) Standalone (no PostFX):
 *      initMotionBlur(renderer, scene, camera);
 *      // in loop LATE: renderMotionBlur();
 *      // in loop UPDATE: updateMotionBlur(dt, { speedKph, lateralG });
 *
 *   B) PostFX composer slot (recommended):
 *      const pass = getMotionBlurPass();
 *      composer.insertPass(pass, insertIndex);   // before OutputPass
 *      // updateMotionBlur still drives the uniforms each frame
 *
 * Exports:
 *   initMotionBlur(renderer, scene, camera)   — set up RenderTarget + composer
 *   updateMotionBlur(dt, opts)                — drive uniforms each frame
 *   renderMotionBlur()                        — standalone render call
 *   getMotionBlurPass()                       — ShaderPass ref (PostFX mode)
 *   setMotionBlurEnabled(bool)                — global on/off toggle
 *   disposeMotionBlur()                       — cleanup
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE         from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';

// ─── Tuning ───────────────────────────────────────────────────────────────────

/** Speed at which blur starts (km/h). Below this: no blur. */
const BLUR_START_KPH  = 80;

/** Speed at which blur reaches maximum strength (km/h). */
const BLUR_MAX_KPH    = 300;

/** Maximum blur strength scalar (0–1). Higher = more aggressive smear. */
const BLUR_MAX_STR    = 0.92;

/** Number of radial samples per pixel. More = smoother but costs fillrate. */
const BLUR_SAMPLES    = 8;

/** How much lateral G-force steers the blur direction (0 = pure radial). */
const LATERAL_MIX     = 0.35;

/** Smooth-in rate per second when speed increases (prevents jarring pop-in). */
const BLEND_RATE_UP   = 5.0;

/** Smooth-out rate per second when speed drops (slightly slower = inertia feel). */
const BLEND_RATE_DOWN = 3.5;

// ─── Shader ───────────────────────────────────────────────────────────────────

/**
 * MotionBlurShader
 *
 * Uniform contract:
 *   tDiffuse   — scene texture (auto-bound by ShaderPass)
 *   uStrength  — 0.0 → 1.0 blur intensity
 *   uCenter    — screen-space blur origin (default: 0.5, 0.5 = dead centre)
 *   uVelDir    — normalised screen-space velocity direction (x/y)
 */
export const MotionBlurShader = {
  name: 'MotionBlurShader',

  uniforms: {
    tDiffuse:  { value: null },
    uStrength: { value: 0.0 },
    uCenter:   { value: new THREE.Vector2(0.5, 0.5) },
    uVelDir:   { value: new THREE.Vector2(0.0, 0.0) },
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float     uStrength;
    uniform vec2      uCenter;
    uniform vec2      uVelDir;
    varying vec2 vUv;

    const int SAMPLES = ${BLUR_SAMPLES};

    void main() {
      // Early-out when effectively off — saves shader cost on most frames
      if (uStrength < 0.002) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // Radial direction from this pixel outward from screen centre
      vec2 radialDir = vUv - uCenter;

      // Blend radial with velocity direction for speed-drift feel
      vec2 blurDir = mix(radialDir, uVelDir * 0.5, ${LATERAL_MIX})
                     * uStrength * 0.016;

      vec4  colour      = vec4(0.0);
      float totalWeight = 0.0;

      for (int i = 0; i < SAMPLES; i++) {
        float t      = float(i) / float(SAMPLES - 1);    // 0 → 1
        // Bell-curve weighting: centre sample heaviest, edges lighter
        float weight = 1.0 - abs(t - 0.5) * 1.9;
        weight       = max(weight, 0.04);

        vec2 offset   = blurDir * (t - 0.5);
        vec2 sampleUv = clamp(vUv + offset, vec2(0.0), vec2(1.0));
        colour        += texture2D(tDiffuse, sampleUv) * weight;
        totalWeight   += weight;
      }

      gl_FragColor = colour / totalWeight;
    }
  `,
};

// ─── Module state ─────────────────────────────────────────────────────────────

let _renderer    = null;
let _scene       = null;
let _camera      = null;
let _composer    = null;      // standalone EffectComposer (Mode A only)
let _pass        = null;      // ShaderPass — shared between both modes
let _enabled     = true;
let _currentStr  = 0.0;       // smoothed strength (avoids per-frame shader recompile)

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialise motion blur.
 *
 * In PostFX mode (B): call this then getMotionBlurPass() to insert into
 * the existing composer. The standalone composer is NOT built.
 *
 * In standalone mode (A): set buildComposer=true and call renderMotionBlur()
 * each frame instead of your own renderer.render().
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene}         scene
 * @param {THREE.Camera}        camera
 * @param {boolean}             [buildComposer=false]  true = standalone mode
 */
export function initMotionBlur(renderer, scene, camera, buildComposer = false) {
  _renderer = renderer;
  _scene    = scene;
  _camera   = camera;

  // Build the pass — used in both modes
  _pass = new ShaderPass(MotionBlurShader);
  _pass.uniforms.uStrength.value = 0.0;
  _pass.enabled = _enabled;

  if (buildComposer) {
    // Standalone: full composer with RenderPass + MotionBlur + OutputPass
    _composer = new EffectComposer(renderer);
    _composer.addPass(new RenderPass(scene, camera));
    _composer.addPass(_pass);
    _composer.addPass(new OutputPass());
  }

  console.log('[MotionBlur] initialised —', buildComposer ? 'standalone' : 'PostFX-slot mode');
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

/**
 * Drive motion blur uniforms each frame.
 * Call from loop UPDATE or LATE phase AFTER car physics are resolved.
 *
 * @param {number} dt    Delta time in seconds
 * @param {object} opts
 * @param {number}  [opts.speedKph=0]    Car speed in km/h
 * @param {number}  [opts.lateralG=0]    Signed lateral G-force (−=left turn, +=right)
 */
export function updateMotionBlur(dt, opts = {}) {
  if (!_pass) return;

  _pass.enabled = _enabled;
  if (!_enabled) {
    _pass.uniforms.uStrength.value = 0.0;
    _currentStr = 0.0;
    return;
  }

  const { speedKph = 0, lateralG = 0 } = opts;

  // Speed → raw target strength (quadratic ease-in for a progressive feel)
  const rawFactor = THREE.MathUtils.clamp(
    (speedKph - BLUR_START_KPH) / (BLUR_MAX_KPH - BLUR_START_KPH), 0, 1,
  );
  const targetStr = rawFactor * rawFactor * BLUR_MAX_STR;

  // Smooth strength transitions (asymmetric: faster in, slower out)
  const rate      = targetStr > _currentStr ? BLEND_RATE_UP : BLEND_RATE_DOWN;
  _currentStr     = THREE.MathUtils.lerp(_currentStr, targetStr, Math.min(rate * dt, 1.0));
  _pass.uniforms.uStrength.value = _currentStr;

  // Velocity direction: lateral G pushes the blur vector sideways
  // lateralG positive = turning right → blur shifts right (+x in screen space)
  const velX = lateralG * 0.28;
  const velY = -rawFactor * 0.12;    // slight downward component at speed (forward rush)
  _pass.uniforms.uVelDir.value.set(velX, velY);
}

// ─── Standalone render ────────────────────────────────────────────────────────

/**
 * Render one frame through the standalone composer.
 * Only valid if initMotionBlur was called with buildComposer=true.
 * Call this INSTEAD of renderer.render() in your loop.
 */
export function renderMotionBlur() {
  if (_composer) {
    _composer.render();
  } else if (_renderer && _scene && _camera) {
    // Graceful fallback: direct render (no blur when pass isn't in a composer)
    _renderer.render(_scene, _camera);
  }
}

// ─── Getters ──────────────────────────────────────────────────────────────────

/**
 * The ShaderPass instance — insert this into an existing EffectComposer
 * before the OutputPass for PostFX integration (Mode B).
 *
 * Example:
 *   const { passes } = getPasses();   // from PostFX.js
 *   // MotionBlur.js pass replaces PostFX's inline one:
 *   // composer.insertPass(getMotionBlurPass(), indexBeforeOutput);
 *
 * @returns {ShaderPass}
 */
export function getMotionBlurPass() { return _pass; }

/**
 * Current smoothed blur strength (0–1).
 * Useful for driving other effects (e.g. chromatic aberration) proportionally.
 */
export function getMotionBlurStrength() { return _currentStr; }

// ─── Toggle ───────────────────────────────────────────────────────────────────

/**
 * Enable or disable motion blur globally.
 * Call from graphics settings menu.
 *
 * @param {boolean} enabled
 */
export function setMotionBlurEnabled(enabled) {
  _enabled = !!enabled;
  if (_pass) {
    _pass.enabled = _enabled;
    if (!_enabled) {
      _pass.uniforms.uStrength.value = 0.0;
      _currentStr = 0.0;
    }
  }
}

// ─── Resize ───────────────────────────────────────────────────────────────────

/**
 * Update composer size on window resize.
 * Only needed in standalone mode (buildComposer=true).
 *
 * @param {number} w
 * @param {number} h
 */
export function resizeMotionBlur(w, h) {
  if (_composer) _composer.setSize(w, h);
}

// ─── Dispose ──────────────────────────────────────────────────────────────────

export function disposeMotionBlur() {
  if (_composer) {
    _composer.dispose();
    _composer = null;
  }
  _pass    = null;
  _renderer = _scene = _camera = null;
  _currentStr = 0.0;
}

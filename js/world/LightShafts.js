/**
 * LightShafts.js — Part 6: Volumetric God Rays (Screen-Space Sun Shafts)
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the classic screen-space sun-shaft technique:
 *
 *   1. Threshold pass  — extract bright pixels (sky + direct sun area)
 *   2. Radial blur     — blur outward from the sun's screen-space position,
 *                        creating diverging light shafts
 *   3. Additive blend  — merge shafts onto the HDR scene before tone-mapping
 *
 * This is a single-composer ShaderPass that slots into the PostFX pipeline
 * between the SSAO pass and the motion-blur pass (Part 5 pipeline).
 *
 * Usage (from main.js, after initPostFX()):
 *
 *   import { initLightShafts, updateLightShafts } from './world/LightShafts.js';
 *   // Pass the PostFX composer (returned by initPostFX or accessible via getComposer())
 *   initLightShafts(renderer, scene, camera, postFXComposer);
 *   // Each UPDATE frame, after environment.tick():
 *   updateLightShafts(getSunDirection());   // THREE.Vector3 from SkySystem
 *
 * Design doc §6 requirements:
 *  - Jungle canopy god rays in Caldera / Oasis / Festival biomes
 *  - Rays strongest at dawn (hour 5–8) and dusk (hour 17–20)
 *  - Rays suppressed at night and midday (too flat)
 *  - Player can toggle in Settings menu via setGodRaysEnabled(bool)
 *
 * Part 6 / Technical Architecture (design doc §6)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { ShaderPass }  from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader }  from 'three/addons/shaders/CopyShader.js';

// ─── God Ray Shader ───────────────────────────────────────────────────────────

/**
 * Radial-blur sun-shaft shader.
 *
 * Algorithm:
 *   For each fragment, march NUM_SAMPLES steps from the fragment toward
 *   the sun's screen-space position, sampling the scene's bright pixel
 *   buffer at each step and accumulating weighted colour.
 *   The weight decays linearly from 1 at the fragment to 0 at the sun.
 *   Result is added to the scene colour (additive blend done in the shader).
 */
const GodRayShader = {

  name: 'GodRayShader',

  uniforms: {
    tDiffuse:     { value: null },          // scene colour (from previous pass)
    sunScreenPos: { value: new THREE.Vector2(0.5, 0.6) }, // NDC [0,1]
    intensity:    { value: 0.6 },           // overall shaft intensity
    density:      { value: 0.96 },          // march step scale (0.9–1.0)
    weight:       { value: 0.4 },           // per-sample luminance weight
    decay:        { value: 0.95 },          // exponential decay per step
    exposure:     { value: 0.18 },          // final multiply
    threshold:    { value: 0.6 },           // brightness cutoff for shaft source
    numSamples:   { value: 80 },            // number of march steps (int)
    sunVisible:   { value: 1.0 },           // 0 = sun below horizon
    tintColor:    { value: new THREE.Color(1.0, 0.85, 0.6) }, // warm dawn tint
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
    uniform vec2      sunScreenPos;
    uniform float     intensity;
    uniform float     density;
    uniform float     weight;
    uniform float     decay;
    uniform float     exposure;
    uniform float     threshold;
    uniform int       numSamples;
    uniform float     sunVisible;
    uniform vec3      tintColor;

    varying vec2 vUv;

    // Luminance helper
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    void main() {
      vec4 sceneColor = texture2D(tDiffuse, vUv);

      // Early out when god rays are fully suppressed
      if (intensity < 0.01 || sunVisible < 0.01) {
        gl_FragColor = sceneColor;
        return;
      }

      // Direction from current pixel toward the sun's screen position
      vec2 texCoord  = vUv;
      vec2 deltaTexCoord = texCoord - sunScreenPos;
      deltaTexCoord *= (1.0 / float(numSamples)) * density;

      float illuminationDecay = 1.0;
      vec3  shaftColor = vec3(0.0);

      // March from pixel back toward sun, accumulating bright pixels
      for (int i = 0; i < 80; i++) {
        if (i >= numSamples) break;
        texCoord -= deltaTexCoord;

        // Clamp to screen — shafts don't wrap around edges
        vec2 clamped = clamp(texCoord, vec2(0.001), vec2(0.999));

        vec4 s = texture2D(tDiffuse, clamped);
        float bright = max(0.0, luma(s.rgb) - threshold);

        shaftColor += s.rgb * bright * illuminationDecay * weight;
        illuminationDecay *= decay;
      }

      // Tint and exposure
      shaftColor *= tintColor * exposure * intensity * sunVisible;

      // Additive blend onto scene
      gl_FragColor = vec4(sceneColor.rgb + shaftColor, sceneColor.a);
    }
  `,
};

// ─── State ────────────────────────────────────────────────────────────────────

let _pass          = null;   // ShaderPass
let _camera        = null;
let _enabled       = true;
let _elapsedTime   = 0;

// Reused projection vector
const _ndcVec = new THREE.Vector3();

// ─── Public: Init ─────────────────────────────────────────────────────────────

/**
 * Create and insert the God Ray pass into the PostFX effect composer.
 *
 * @param {THREE.WebGLRenderer}   renderer
 * @param {THREE.Scene}           scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {EffectComposer}        composer   — the main PostFX composer
 */
export function initLightShafts(renderer, scene, camera, composer) {
  if (!composer) {
    console.warn('[LightShafts] No composer provided — god rays skipped.');
    return;
  }

  _camera = camera;

  _pass = new ShaderPass(GodRayShader);
  _pass.renderToScreen = false;
  _pass.enabled = _enabled;

  // Insert BEFORE the final OutputPass — find its index
  // PostFX composer passes: [RenderPass, SSAO, TAA, BloomMix, SSR, MotionBlur, CameraFX, OutputPass]
  // We insert just before OutputPass (last pass)
  const passes = composer.passes;
  const outputIdx = passes.length > 1 ? passes.length - 1 : passes.length;
  composer.passes.splice(outputIdx, 0, _pass);

  console.log('[LightShafts] ✅ God ray pass inserted at composer index', outputIdx);
}

// ─── Public: Per-frame update ─────────────────────────────────────────────────

/**
 * Update god ray uniforms.
 * Call each frame in the LATE tick (after environment.tick() so hour is current).
 *
 * @param {THREE.Vector3} sunWorldDir   — unit vector pointing TOWARD the sun (from SkySystem)
 * @param {number}        hour          — current in-game hour (0–24)
 * @param {number}        dt            — delta time in seconds
 */
export function updateLightShafts(sunWorldDir, hour, dt) {
  if (!_pass || !_camera) return;

  _elapsedTime += dt;

  // Project the sun world position onto the screen
  // We project a point far in the sun direction from the camera
  const sunWorldPos = _camera.position.clone()
    .addScaledVector(sunWorldDir, 5000);

  _ndcVec.copy(sunWorldPos).project(_camera);

  // NDC [-1,1] → UV [0,1]
  const sunU = (_ndcVec.x + 1) * 0.5;
  const sunV = (_ndcVec.y + 1) * 0.5;

  // Determine if sun is in front of camera (z < 1 in NDC)
  const sunVisible = (_ndcVec.z < 1.0 && sunU > -0.2 && sunU < 1.2 && sunV > -0.2 && sunV < 1.2)
    ? 1.0 : 0.0;

  _pass.uniforms.sunScreenPos.value.set(sunU, sunV);
  _pass.uniforms.sunVisible.value = sunVisible;

  // God ray intensity varies by time of day:
  //  • Dawn  (5–8)   → strong warm golden rays
  //  • Noon  (11–14) → weak (sun too high, shafts too thin)
  //  • Dusk  (17–20) → strong warm rays
  //  • Night (21–4)  → off
  let baseIntensity = 0;
  let tintR = 1.0, tintG = 0.85, tintB = 0.6;

  if (hour >= 5 && hour < 8) {
    // Dawn: ramp in
    const t = (hour - 5) / 3;
    baseIntensity = _smoothstep(t) * 0.75;
    tintR = 1.0; tintG = 0.7; tintB = 0.4;
  } else if (hour >= 8 && hour < 11) {
    // Late morning: fade out
    const t = (hour - 8) / 3;
    baseIntensity = _lerp(0.75, 0.1, _smoothstep(t));
  } else if (hour >= 11 && hour < 15) {
    // Midday: minimal
    baseIntensity = 0.05;
    tintR = 1.0; tintG = 0.95; tintB = 0.85;
  } else if (hour >= 15 && hour < 17) {
    // Afternoon build-up
    const t = (hour - 15) / 2;
    baseIntensity = _lerp(0.05, 0.5, _smoothstep(t));
  } else if (hour >= 17 && hour < 20) {
    // Golden hour / dusk — peak
    const t = (hour - 17) / 3;
    baseIntensity = _lerp(0.5, 0.9, Math.sin(t * Math.PI));
    tintR = 1.0; tintG = 0.6; tintB = 0.3;
  } else if (hour >= 20 && hour < 21) {
    // Twilight fade-out
    const t = (hour - 20);
    baseIntensity = _lerp(0.4, 0, _smoothstep(t));
  }

  // Subtle atmospheric shimmer (heat haze / dust)
  const shimmer = 1 + Math.sin(_elapsedTime * 2.1) * 0.04
                    + Math.sin(_elapsedTime * 5.7) * 0.01;

  _pass.uniforms.intensity.value   = Math.max(0, baseIntensity * shimmer);
  _pass.uniforms.tintColor.value.set(tintR, tintG, tintB);

  // Density and weight: keep shafts visible but not overwhelming
  _pass.uniforms.density.value     = 0.94 + Math.sin(_elapsedTime * 0.7) * 0.01;
  _pass.uniforms.threshold.value   = 0.55;
}

// ─── Public: Settings ─────────────────────────────────────────────────────────

/**
 * Toggle god rays on/off (Settings menu).
 * @param {boolean} enabled
 */
export function setGodRaysEnabled(enabled) {
  _enabled = enabled;
  if (_pass) _pass.enabled = enabled;
  console.log('[LightShafts] God rays', enabled ? 'enabled' : 'disabled');
}

/** Returns the current enabled state. */
export function getGodRaysEnabled() { return _enabled; }

// ─── Math helpers ─────────────────────────────────────────────────────────────

function _lerp(a, b, t)     { return a + (b - a) * t; }
function _smoothstep(t)     { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

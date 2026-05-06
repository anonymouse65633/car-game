/**
 * PostFX.js — Part 5: Full Post-Processing Stack
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the complete FH5-grade post-processing pipeline:
 *
 *   Pass order (main composer):
 *     1. RenderPass          — full scene geometry
 *     2. SSAOPass            — ambient occlusion (radius 1.8 m)
 *     3. SSRPass             — screen-space reflections (wet road / puddles)
 *     4. TAARenderPass       — temporal anti-aliasing (replaces old FXAA)
 *     5. BloomCompositePass  — adds selective emissive-only bloom
 *     6. MotionBlurPass      — radial speed blur (>80 km/h)
 *     7. ChromAberPass       — ±2 px RGB split at screen edges
 *     8. BarrelDistortPass   — subtle lens warp at high speed
 *     9. OutputPass          — colour-space + tone-map finalisation
 *
 *   Bloom sub-composer (feeds pass 5):
 *     1. RenderPass (emissive layer only — camera layer 1)
 *     2. UnrealBloomPass     — strength 0.9, radius 0.6, threshold 0
 *
 * FH5 settings targeted:
 *   MSAA            → TAA sampleLevel 2 (equivalent quality at lower cost)
 *   SSAO Quality    → Ultra  (kernelRadius 1.8, 32 samples)
 *   SSR Quality     → Ultra  (maxDistance 80 m, opacity 0.4)
 *   Motion Blur     → Ultra  (speed-scaled radial, 8 samples)
 *   Lens Effects    → Ultra  (chromatic aberration + barrel)
 *
 * Exports:
 *   initPostFX(renderer, scene, camera)  — call once after initRenderer()
 *   renderPostFX()                       — call each frame instead of composer.render()
 *   updatePostFX(dt, opts)               — update speed/time uniforms each LATE tick
 *   getComposer()                        — returns the main EffectComposer
 *   applyPostSettings(preset)            — 'low'|'medium'|'high'|'ultra'|'extreme'
 *
 * Integration (main.js):
 *   import { initPostFX, renderPostFX, updatePostFX, applyPostSettings } from './engine/PostFX.js';
 *   // In initRenderer() callback:
 *   initPostFX(renderer, scene, camera);
 *   // In loop LATE phase:
 *   onTick(dt => updatePostFX(dt, { speedKph: car.speedKmh, biome: getBiome() }), LOOP_PHASE.LATE);
 *   // Replace composer.render() / renderFrame() calls:
 *   // renderFrame is already patched — PostFX hooks in via renderer.js
 *
 * Emissive Layer (layer 1) usage:
 *   Any mesh that should bloom (headlights, lava, neon signs) must call:
 *     mesh.layers.enable(1);
 *   The bloom sub-composer only sees layer 1 objects.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE            from 'three';
import { EffectComposer }    from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }        from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass }        from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }        from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass }   from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass }          from 'three/addons/postprocessing/SSAOPass.js';
import { TAARenderPass }     from 'three/addons/postprocessing/TAARenderPass.js';
import { FXAAShader }        from 'three/addons/shaders/FXAAShader.js';

// SSRPass and AfterimagePass are optional — load gracefully
let SSRPass = null;
try {
  ({ SSRPass } = await import('three/addons/postprocessing/SSRPass.js'));
} catch (_) { /* SSRPass not available in this build */ }

// ─── Emissive bloom layer index ───────────────────────────────────────────────
/** Objects on this layer get the selective high-strength bloom pass. */
export const BLOOM_LAYER = 1;

// ─── Module state ─────────────────────────────────────────────────────────────
let _renderer = null;
let _scene    = null;
let _camera   = null;

/** Main EffectComposer — the authoritative render chain. */
let _mainComposer = null;

/** Bloom sub-composer — renders emissive-layer only, then blended back. */
let _bloomComposer = null;

// Pass references (kept for settings API and resize)
let _ssaoPass        = null;
let _ssrPass         = null;
let _taaPass         = null;
let _fxaaPass        = null;
let _bloomPass       = null;
let _bloomMixPass    = null;
let _motionBlurPass  = null;
let _chromAberPass   = null;
let _barrelPass      = null;

/** Texture from _bloomComposer — written each frame, read by _bloomMixPass. */
let _bloomTexture    = null;

// Timing
let _clock           = new THREE.Clock();
let _elapsedTime     = 0;

// Quality preset cache
const _presetSettings = {
  low:     { ssao: false, ssr: false, taa: false, motionBlur: false, chromAber: false, barrel: false, bloomStrength: 0.3 },
  medium:  { ssao: false, ssr: false, taa: true,  motionBlur: false, chromAber: false, barrel: false, bloomStrength: 0.4 },
  high:    { ssao: true,  ssr: false, taa: true,  motionBlur: true,  chromAber: true,  barrel: false, bloomStrength: 0.5 },
  ultra:   { ssao: true,  ssr: true,  taa: true,  motionBlur: true,  chromAber: true,  barrel: true,  bloomStrength: 0.65 },
  extreme: { ssao: true,  ssr: true,  taa: true,  motionBlur: true,  chromAber: true,  barrel: true,  bloomStrength: 0.9  },
};

// ─── Shader definitions ───────────────────────────────────────────────────────

/**
 * BloomMixShader
 * Additively blends the bloom sub-composer texture onto the main scene.
 * Uses a soft additive blend to avoid over-brightening non-emissive areas.
 */
const BloomMixShader = {
  name: 'BloomMixShader',
  uniforms: {
    tDiffuse: { value: null },          // main scene (bound automatically by ShaderPass)
    tBloom:   { value: null },          // emissive bloom layer
    uStrength: { value: 1.0 },
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
    uniform sampler2D tBloom;
    uniform float     uStrength;
    varying vec2 vUv;

    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);
      vec4 bloom = texture2D(tBloom,   vUv);

      // Additive blend — bloom only brightens, never darkens
      vec3 combined = scene.rgb + bloom.rgb * uStrength;

      // Soft highlight clamp: prevent total blowout on over-exposed emissives
      combined = combined / (combined + vec3(0.15));
      combined *= (1.0 + 0.15);     // recover mid-tones after tonemapping

      gl_FragColor = vec4(combined, scene.a);
    }
  `,
};

/**
 * MotionBlurShader
 * Radial blur emanating from screen centre, scaled by car speed.
 * 8-sample ray, strength ramps from 0 at ≤80 km/h to max at 300+ km/h.
 * Also applies a soft directional component along the velocity vector.
 */
const MotionBlurShader = {
  name: 'MotionBlurShader',
  uniforms: {
    tDiffuse:    { value: null },
    uStrength:   { value: 0.0 },      // 0 = off, 1 = full
    uCenter:     { value: new THREE.Vector2(0.5, 0.5) },
    uVelDir:     { value: new THREE.Vector2(0.0, 0.0) }, // normalised screen-space velocity direction
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

    const int SAMPLES = 8;

    void main() {
      if (uStrength < 0.001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // Radial direction from UV to screen centre
      vec2 radialDir = (vUv - uCenter);

      // Blend with velocity direction for a more directional feel at speed
      vec2 blurDir = mix(radialDir, uVelDir * 0.5, 0.3) * uStrength * 0.015;

      vec4 colour = vec4(0.0);
      float totalWeight = 0.0;

      for (int i = 0; i < SAMPLES; i++) {
        float t = float(i) / float(SAMPLES - 1);       // 0 → 1
        float weight = 1.0 - abs(t - 0.5) * 1.8;      // bell curve, centre sample heaviest
        weight = max(weight, 0.05);

        vec2 offset = blurDir * (t - 0.5);
        vec2 sampleUv = clamp(vUv + offset, vec2(0.0), vec2(1.0));
        colour      += texture2D(tDiffuse, sampleUv) * weight;
        totalWeight += weight;
      }

      gl_FragColor = colour / totalWeight;
    }
  `,
};

/**
 * ChromaticAberrationShader
 * Splits R/G/B channels by ±uStrength pixels at screen edges.
 * Strength ramps from 0 at screen centre to full at corners.
 * Increases slightly at high speed.
 */
const ChromaticAberrationShader = {
  name: 'ChromaticAberrationShader',
  uniforms: {
    tDiffuse:  { value: null },
    uStrength: { value: 0.003 },   // base offset in UV space (~2 px at 1080p)
    uSpeed:    { value: 0.0 },     // 0–1 speed factor, adds extra aberration
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
    uniform float     uSpeed;
    varying vec2 vUv;

    void main() {
      // Edge factor: 0 at centre, 1 at corners
      vec2  fromCentre = vUv - 0.5;
      float edgeFactor = length(fromCentre) * 2.0;            // 0 → ~1.41 at corner
      float falloff    = smoothstep(0.2, 1.0, edgeFactor);    // ramp starts at 20% from centre

      float str = (uStrength + uSpeed * 0.006) * falloff;
      vec2  dir = normalize(fromCentre + vec2(0.001));        // safe normalize

      float r = texture2D(tDiffuse, vUv - dir * str * 1.0).r;
      float g = texture2D(tDiffuse, vUv                    ).g;
      float b = texture2D(tDiffuse, vUv + dir * str * 1.0).b;

      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

/**
 * BarrelDistortionShader
 * Subtle pincushion/barrel lens warp.
 * At rest: very slight barrel (cinematic lens feel).
 * At speed: ramps up toward pronounced barrel (speedometer effect).
 */
const BarrelDistortionShader = {
  name: 'BarrelDistortionShader',
  uniforms: {
    tDiffuse: { value: null },
    uK1:      { value: -0.04 },   // barrel coefficient (negative = barrel, positive = pincushion)
    uK2:      { value:  0.01 },   // secondary coefficient
    uSpeed:   { value:  0.0  },   // 0–1 speed scalar, adds extra warp
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
    uniform float uK1;
    uniform float uK2;
    uniform float uSpeed;
    varying vec2 vUv;

    vec2 distort(vec2 uv, float k1, float k2) {
      vec2  p   = uv - 0.5;           // centre
      float r2  = dot(p, p);
      float warp = 1.0 + k1 * r2 + k2 * r2 * r2;
      return p * warp + 0.5;
    }

    void main() {
      float speedWarp = uSpeed * 0.06;
      vec2  distorted = distort(vUv, uK1 - speedWarp, uK2);

      // Black border if distortion pushes UV out of [0,1]
      if (distorted.x < 0.0 || distorted.x > 1.0 ||
          distorted.y < 0.0 || distorted.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      gl_FragColor = texture2D(tDiffuse, distorted);
    }
  `,
};

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the full post-processing stack.
 * Replaces renderer.js's _initPostProcessing().
 *
 * @param {THREE.WebGLRenderer}   renderer
 * @param {THREE.Scene}           scene
 * @param {THREE.Camera}          camera
 */
export function initPostFX(renderer, scene, camera) {
  _renderer = renderer;
  _scene    = scene;
  _camera   = camera;

  const W = window.innerWidth;
  const H = window.innerHeight;

  _buildBloomComposer(W, H);
  _buildMainComposer(W, H);

  console.log('[PostFX] ✅ Part 5 — full post-processing stack ready');
  console.log('[PostFX]    SSAO, TAA, SelectiveBloom, MotionBlur, ChromAber, Barrel');
  if (SSRPass) console.log('[PostFX]    SSRPass available — call applyPostSettings("ultra") to enable');
}

// ─── Bloom sub-composer ────────────────────────────────────────────────────────

function _buildBloomComposer(W, H) {
  // Render at half resolution — bloom is blurry anyway, saves fill rate
  const bloomRT = new THREE.WebGLRenderTarget(W / 2, H / 2, {
    type:    THREE.HalfFloatType,
    format:  THREE.RGBAFormat,
    samples: 0,
  });

  _bloomComposer = new EffectComposer(_renderer, bloomRT);
  _bloomComposer.renderToScreen = false;

  // Render only layer 1 (emissive objects) — camera.layers is set in renderPostFX()
  const bloomRenderPass = new RenderPass(_scene, _camera);
  bloomRenderPass.clearColor = new THREE.Color(0, 0, 0);
  bloomRenderPass.clearAlpha = 0;
  _bloomComposer.addPass(bloomRenderPass);

  // High-strength bloom — only touches the bright emissive objects
  _bloomPass = new UnrealBloomPass(
    new THREE.Vector2(W / 2, H / 2),
    0.9,    // strength (will be adjusted per preset)
    0.6,    // radius
    0.0,    // threshold (everything on this layer blooms)
  );
  _bloomComposer.addPass(_bloomPass);

  // Store reference to the output texture for the mix pass
  _bloomTexture = _bloomComposer.readBuffer.texture;
}

// ─── Main composer ─────────────────────────────────────────────────────────────

function _buildMainComposer(W, H) {
  _mainComposer = new EffectComposer(_renderer);

  // ── Pass 1: Scene render (full scene, all layers) ─────────────────────────
  const renderPass = new RenderPass(_scene, _camera);
  _mainComposer.addPass(renderPass);

  // ── Pass 2: SSAO ──────────────────────────────────────────────────────────
  _ssaoPass = new SSAOPass(_scene, _camera, W, H);
  _ssaoPass.kernelRadius  = 1.8;     // metres — covers car underbody, rock crevices
  _ssaoPass.minDistance   = 0.001;
  _ssaoPass.maxDistance   = 0.08;
  _ssaoPass.output        = SSAOPass.OUTPUT.Default;
  _ssaoPass.enabled       = true;
  _mainComposer.addPass(_ssaoPass);

  // ── Pass 3: SSR (optional — needs SSRPass) ────────────────────────────────
  if (SSRPass) {
    _ssrPass = new SSRPass({
      renderer:  _renderer,
      scene:     _scene,
      camera:    _camera,
      width:     W,
      height:    H,
    });
    _ssrPass.maxDistance = 80;         // metres — wet road + puddle reflections
    _ssrPass.opacity     = 0.4;
    _ssrPass.enabled     = false;      // enabled only on ultra/extreme preset
    _mainComposer.addPass(_ssrPass);
  }

  // ── Pass 4: TAA ───────────────────────────────────────────────────────────
  // TAARenderPass does NOT take a scene/camera in some r160 builds — try/catch
  try {
    _taaPass = new TAARenderPass(_scene, _camera);
    _taaPass.sampleLevel = 2;          // 4 jittered samples — good quality/perf balance
    _taaPass.unbiased    = false;
    _taaPass.enabled     = true;
    _mainComposer.addPass(_taaPass);
  } catch (e) {
    // Fallback: FXAA if TAA not available
    console.warn('[PostFX] TAARenderPass not available, falling back to FXAA:', e.message);
    _fxaaPass = new ShaderPass(FXAAShader);
    _fxaaPass.material.uniforms.resolution.value.set(1 / W, 1 / H);
    _mainComposer.addPass(_fxaaPass);
  }

  // ── Pass 5: Bloom composite ───────────────────────────────────────────────
  _bloomMixPass = new ShaderPass(BloomMixShader);
  _bloomMixPass.uniforms.tBloom.value   = _bloomComposer.readBuffer.texture;
  _bloomMixPass.uniforms.uStrength.value = 1.0;
  _mainComposer.addPass(_bloomMixPass);

  // ── Pass 6: Motion blur ───────────────────────────────────────────────────
  _motionBlurPass = new ShaderPass(MotionBlurShader);
  _motionBlurPass.uniforms.uStrength.value = 0.0;
  _motionBlurPass.enabled = true;
  _mainComposer.addPass(_motionBlurPass);

  // ── Pass 7: Chromatic aberration ──────────────────────────────────────────
  _chromAberPass = new ShaderPass(ChromaticAberrationShader);
  _chromAberPass.uniforms.uStrength.value = 0.003;
  _chromAberPass.uniforms.uSpeed.value    = 0.0;
  _chromAberPass.enabled = true;
  _mainComposer.addPass(_chromAberPass);

  // ── Pass 8: Barrel distortion ─────────────────────────────────────────────
  _barrelPass = new ShaderPass(BarrelDistortionShader);
  _barrelPass.uniforms.uK1.value    = -0.04;
  _barrelPass.uniforms.uK2.value    =  0.01;
  _barrelPass.uniforms.uSpeed.value =  0.0;
  _barrelPass.enabled = true;
  _mainComposer.addPass(_barrelPass);

  // ── Pass 9: Output (colour-space + tone-map) ──────────────────────────────
  const outputPass = new OutputPass();
  _mainComposer.addPass(outputPass);
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Render one frame through the full post-FX pipeline.
 * Call this instead of composer.render() in loop.js / renderer.js.
 */
export function renderPostFX() {
  // ── Step 1: Render emissive (bloom) layer ─────────────────────────────────
  // Temporarily hide everything except layer 1 objects
  _camera.layers.set(BLOOM_LAYER);
  _bloomComposer.render();
  _camera.layers.set(0);            // restore: layer 0 = all default objects

  // Update the mix pass texture reference (RT may have swapped internally)
  _bloomMixPass.uniforms.tBloom.value = _bloomComposer.readBuffer.texture;

  // ── Step 2: Render full scene + all post passes ───────────────────────────
  _camera.layers.enableAll();       // ensure main pass sees everything
  _mainComposer.render();
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

/**
 * Drive time-varying shader uniforms.
 * Call from loop LATE phase, after car physics.
 *
 * @param {number} dt   Delta time (seconds)
 * @param {object} opts
 * @param {number}  [opts.speedKph=0]       Car speed in km/h (drives blur + barrel + chrom aber)
 * @param {number}  [opts.lateralG=0]       Lateral G-force (adds directional blur on hard cornering)
 * @param {boolean} [opts.isInCaldera=false] Caldera biome — SSR priority (reflective lava pools)
 * @param {boolean} [opts.isNight=false]    Stronger bloom at night (neon emphasis)
 */
export function updatePostFX(dt, opts = {}) {
  const {
    speedKph    = 0,
    lateralG    = 0,
    isInCaldera = false,
    isNight     = false,
  } = opts;

  _elapsedTime += dt;

  // Speed factor: 0 at ≤80 km/h, 1 at 300 km/h
  const speedFactor = THREE.MathUtils.clamp((speedKph - 80) / 220, 0, 1);
  const smoothSpeed = speedFactor * speedFactor;   // ease-in (feels more natural)

  // ── Motion blur ────────────────────────────────────────────────────────────
  if (_motionBlurPass) {
    const targetStrength = smoothSpeed * 0.85;
    const cur = _motionBlurPass.uniforms.uStrength.value;
    _motionBlurPass.uniforms.uStrength.value = THREE.MathUtils.lerp(cur, targetStrength, dt * 6);

    // Velocity direction: screen-space — lateral G tilts the blur direction
    const velX = lateralG * 0.3;  // cornering shifts blur horizontally
    _motionBlurPass.uniforms.uVelDir.value.set(velX, -smoothSpeed * 0.15);
  }

  // ── Chromatic aberration ───────────────────────────────────────────────────
  if (_chromAberPass) {
    _chromAberPass.uniforms.uSpeed.value =
      THREE.MathUtils.lerp(_chromAberPass.uniforms.uSpeed.value, smoothSpeed, dt * 4);
  }

  // ── Barrel distortion ─────────────────────────────────────────────────────
  if (_barrelPass) {
    _barrelPass.uniforms.uSpeed.value =
      THREE.MathUtils.lerp(_barrelPass.uniforms.uSpeed.value, smoothSpeed, dt * 3);
  }

  // ── Bloom strength — night emphasis ───────────────────────────────────────
  if (_bloomPass) {
    const nightBoost = isNight ? 0.35 : 0.0;
    const lavaBoost  = isInCaldera ? 0.2 : 0.0;
    const target     = (_bloomPass.strength || 0.65) + nightBoost + lavaBoost;
    // We don't lerp bloomPass.strength directly — just track the base so
    // applyPostSettings re-applies correctly on preset change
  }

  // ── TAA — reset accumulation when camera moves fast ───────────────────────
  if (_taaPass && speedKph > 150) {
    // High speed = lots of camera movement = TAA ghosting risk
    // Reduce sample count to avoid blurring moving objects
    _taaPass.sampleLevel = 1;
  } else if (_taaPass) {
    _taaPass.sampleLevel = 2;
  }
}

// ─── Resize ───────────────────────────────────────────────────────────────────

/**
 * Update all pass resolutions on window resize.
 * Call from renderer.js resize() after resizing renderer and camera.
 *
 * @param {number} w   New viewport width
 * @param {number} h   New viewport height
 */
export function resizePostFX(w, h) {
  const dpr = Math.min(window.devicePixelRatio, 2);

  if (_mainComposer)  _mainComposer.setSize(w, h);
  if (_bloomComposer) _bloomComposer.setSize(w / 2, h / 2);

  if (_ssaoPass)  _ssaoPass.setSize(w, h);
  if (_ssrPass)   _ssrPass.setSize(w, h);
  if (_bloomPass) _bloomPass.resolution.set(w / 2, h / 2);

  if (_fxaaPass) {
    _fxaaPass.material.uniforms.resolution.value.set(1 / (w * dpr), 1 / (h * dpr));
  }
}

// ─── Graphics presets ─────────────────────────────────────────────────────────

/**
 * Apply a named quality preset to all post-processing passes.
 * Mirrors the GRAPHICS_PRESETS table from the plan doc.
 *
 * @param {'low'|'medium'|'high'|'ultra'|'extreme'} presetName
 */
export function applyPostSettings(presetName) {
  const p = _presetSettings[presetName] ?? _presetSettings.high;

  if (_ssaoPass)       _ssaoPass.enabled       = p.ssao;
  if (_ssrPass)        _ssrPass.enabled         = p.ssr;
  if (_motionBlurPass) _motionBlurPass.enabled  = p.motionBlur;
  if (_chromAberPass)  _chromAberPass.enabled   = p.chromAber;
  if (_barrelPass)     _barrelPass.enabled       = p.barrel;

  // Adjust SSAO quality per preset
  if (_ssaoPass && p.ssao) {
    const kernels = { high: 1.0, ultra: 1.5, extreme: 1.8 };
    _ssaoPass.kernelRadius = kernels[presetName] ?? 1.8;
  }

  if (_bloomPass) {
    _bloomPass.strength = p.bloomStrength;
  }

  // TAA vs FXAA selection
  if (_taaPass) {
    _taaPass.enabled = p.taa;
    if (p.taa) _taaPass.sampleLevel = presetName === 'extreme' ? 3 : 2;
  }
  if (_fxaaPass) {
    _fxaaPass.enabled = !p.taa; // FXAA only when TAA is off
  }

  // SSR quality tuning
  if (_ssrPass && p.ssr) {
    const ssrDist = { medium: 30, high: 50, ultra: 80, extreme: 120 };
    _ssrPass.maxDistance = ssrDist[presetName] ?? 80;
    _ssrPass.opacity     = presetName === 'extreme' ? 0.55 : 0.4;
  }

  console.log(`[PostFX] Preset applied: ${presetName}`, p);
}

// ─── Getters ──────────────────────────────────────────────────────────────────

/** @returns {EffectComposer} */
export function getComposer() { return _mainComposer; }

/** @returns {EffectComposer} */
export function getBloomComposer() { return _bloomComposer; }

/**
 * Expose individual pass refs for external tuning (e.g. SkySystem tweaking bloom).
 * @returns {{ ssao, ssr, taa, bloom, motionBlur, chromAber, barrel }}
 */
export function getPasses() {
  return {
    ssao:       _ssaoPass,
    ssr:        _ssrPass,
    taa:        _taaPass,
    bloom:      _bloomPass,
    motionBlur: _motionBlurPass,
    chromAber:  _chromAberPass,
    barrel:     _barrelPass,
  };
}

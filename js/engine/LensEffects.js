/**
 * LensEffects.js  —  Part 18: Screen-Space Lens & Camera Effects
 * ─────────────────────────────────────────────────────────────────────────────
 * Six layered effects that complete the FH5 cinematic camera look:
 *
 *   1. Lens dirt      — procedural smudge/scratch texture overlaid on the
 *                        bloom pass; headlights smear across dirty glass.
 *   2. Heat haze      — ShaderPass UV distortion, fades in/out when the car
 *                        enters/leaves the Caldera biome (volcanic heat shimmer).
 *   3. Film grain     — GLSL procedural noise at 8 % opacity, re-seeded at
 *                        24 fps (same rate as 35mm film grain).
 *   4. Vignette       — radial screen-edge darkening; stronger at night.
 *   5. Speed lines    — 2-D <canvas> overlay (not 3-D geometry) drawing
 *                        radial streak bursts above 200 km/h.
 *   6. Headlight flare — 2-D canvas overlay: 3 ghost circles + anamorphic
 *                        horizontal streak, visible at night only.
 *
 * The four ShaderPasses are spliced into the existing PostFX composer chain
 * directly BEFORE the final OutputPass so tone-mapping sees clean input.
 * The two canvas overlays are separate DOM elements and need no composer slot.
 *
 * FH5 Setting: Lens Effects → Ultra
 *
 * Exports:
 *   initLensEffects(composer, rendererDomElement)
 *     — call once, AFTER initPostFX()
 *   updateLensEffects(dt, opts)
 *     — call each LATE tick with { speedKph, isNight, biome, carPos }
 *   disposeLensEffects()
 *     — remove DOM elements and dispose GPU resources
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE    from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ─── Module state ──────────────────────────────────────────────────────────────

let _composer       = null;
let _dirtPass       = null;
let _hazePass       = null;
let _grainPass      = null;
let _vignettePass   = null;

/** 2-D canvas elements (DOM overlays). */
let _speedCanvas    = null;
let _speedCtx       = null;
let _flareCanvas    = null;
let _flareCtx       = null;

let _elapsedTime    = 0;
let _grainFrameTime = 0;
let _grainSeed      = 0;

let _ready          = false;

// ─── GLSL shader definitions ───────────────────────────────────────────────────

// Shared vertex shader (all full-screen passes use this).
const FULLSCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── Lens-dirt shader ──────────────────────────────────────────────────────────
//
// Overlays a procedural dirt/smudge pattern on bright areas of the image.
// uDirtStrength ramps up when headlights are on (isNight) so light sources
// bleed across the scratches realistically.
//
const LensDirtShader = {
  uniforms: {
    tDiffuse:      { value: null },
    uDirtStrength: { value: 0.0 },
    uTime:         { value: 0.0 },
  },
  vertexShader:   FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uDirtStrength;
    uniform float uTime;
    varying vec2 vUv;

    // ── Procedural dirt pattern ───────────────────────────────────────────
    // Two layers of hash-based noise at different scales to simulate
    // camera-lens grime: fine scratches + larger smear blobs.
    float hash(vec2 p) {
      p = fract(p * vec2(234.34, 435.345));
      p += dot(p, p + 34.23);
      return fract(p.x * p.y);
    }

    float fbm(vec2 uv) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * hash(uv);
        uv  = uv * 2.1 + vec2(1.7, 9.2);
        a  *= 0.5;
      }
      return v;
    }

    // Elongated scratch noise (anisotropic — wider in X than Y)
    float scratchNoise(vec2 uv) {
      vec2 sc = uv * vec2(80.0, 4.0);
      return smoothstep(0.94, 1.0, hash(sc));
    }

    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);

      // Sample dirt at two scales
      float blob    = fbm(vUv * vec2(3.1, 2.8) + 0.1);
      float scratch = scratchNoise(vUv + vec2(uTime * 0.0001, 0.0));

      float dirt = clamp(blob * 0.6 + scratch * 0.4, 0.0, 1.0);

      // Luminance of scene — dirt is most visible on bright sources
      float lum = dot(scene.rgb, vec3(0.2126, 0.7152, 0.0722));
      float overlay = dirt * lum * uDirtStrength * 0.55;

      gl_FragColor = vec4(scene.rgb + overlay, scene.a);
    }
  `,
};

// ── Heat haze shader ──────────────────────────────────────────────────────────
//
// UV-space sinusoidal distortion that simulates hot-air shimmer over
// the Caldera's volcanic surfaces.  Two independent oscillators running
// at slightly different frequencies give a naturalistic flicker.
//
const HeatHazeShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uTime:      { value: 0.0 },
    uStrength:  { value: 0.0 },   // 0 = off, 1 = full Caldera shimmer
  },
  vertexShader:   FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      if (uStrength < 0.001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 uv = vUv;
      // Primary horizontal shimmer — longer wavelength
      uv.x += sin(uv.y * 38.0 + uTime * 2.1) * 0.0014 * uStrength;
      // Secondary vertical micro-flutter — shorter wavelength, different phase
      uv.y += cos(uv.x * 31.0 + uTime * 1.6) * 0.0009 * uStrength;
      // Slight chromatic split on the haze — red channel shifts more
      float r = texture2D(tDiffuse, uv + vec2(0.0009, 0.0) * uStrength).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - vec2(0.0006, 0.0) * uStrength).b;

      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

// ── Film grain shader ─────────────────────────────────────────────────────────
//
// GLSL hash-based noise re-seeded at 24 fps to simulate film grain.
// Opacity is fixed at 8 % which matches the FH5 "Lens Effects Ultra" look.
//
const FilmGrainShader = {
  uniforms: {
    tDiffuse:  { value: null },
    uSeed:     { value: 0.0 },
    uOpacity:  { value: 0.08 },   // 8 % baseline
  },
  vertexShader:   FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSeed;
    uniform float uOpacity;
    varying vec2 vUv;

    float rand(vec2 co, float seed) {
      return fract(sin(dot(co + seed, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);
      float noise = rand(vUv, uSeed) * 2.0 - 1.0;   // -1 to 1
      gl_FragColor = vec4(scene.rgb + noise * uOpacity, scene.a);
    }
  `,
};

// ── Vignette shader ───────────────────────────────────────────────────────────
//
// Smooth radial darkening toward screen edges.  uStrength is modulated
// by the time-of-day so nights feel more enclosed and cinematic.
//
const VignetteShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uStrength:  { value: 0.40 },  // 0 = off, 1 = fully black edges
    uSoftness:  { value: 0.60 },  // falloff curve (higher = sharper)
  },
  vertexShader:   FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uSoftness;
    varying vec2 vUv;

    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);
      // Distance from centre, corrected for aspect
      vec2 d  = vUv - 0.5;
      d.x    *= 1.2;   // slight X stretch so corners darken more
      float r = length(d) * 2.0;
      // Smooth vignette curve
      float vig = 1.0 - smoothstep(uSoftness, 1.0, r) * uStrength;
      gl_FragColor = vec4(scene.rgb * vig, scene.a);
    }
  `,
};

// ─── Initialisation ────────────────────────────────────────────────────────────

/**
 * Splice the four ShaderPasses into the PostFX composer's pass chain,
 * directly before the OutputPass.  Then create the two 2-D canvas overlays.
 *
 * @param {import('three/addons/postprocessing/EffectComposer.js').EffectComposer} composer
 * @param {HTMLElement} rendererDom   — renderer.domElement (for canvas sizing)
 */
export function initLensEffects(composer, rendererDom) {
  _composer = composer;

  // ── Build shader passes ───────────────────────────────────────────────────
  _dirtPass     = new ShaderPass(LensDirtShader);
  _hazePass     = new ShaderPass(HeatHazeShader);
  _grainPass    = new ShaderPass(FilmGrainShader);
  _vignettePass = new ShaderPass(VignetteShader);

  // ── Splice before OutputPass ───────────────────────────────────────────────
  // EffectComposer stores passes in .passes[].  Find the OutputPass index and
  // insert our passes just before it so tone-mapping is the final step.
  const passes = composer.passes;
  let outputIdx = passes.findIndex(p => p.constructor?.name === 'OutputPass');
  if (outputIdx === -1) outputIdx = passes.length; // fallback: append

  // Insert in reverse order (each insert shifts subsequent ones)
  const newPasses = [_dirtPass, _hazePass, _grainPass, _vignettePass];
  for (let i = newPasses.length - 1; i >= 0; i--) {
    passes.splice(outputIdx, 0, newPasses[i]);
  }

  // Ensure renderToScreen is only true on the final pass
  passes.forEach((p, idx) => {
    if (p.renderToScreen !== undefined) {
      p.renderToScreen = idx === passes.length - 1;
    }
  });

  // ── 2-D canvas overlays ────────────────────────────────────────────────────
  _buildSpeedLinesCanvas(rendererDom);
  _buildHeadlightFlareCanvas(rendererDom);

  _ready = true;
  console.log('[LensEffects] init — 4 ShaderPasses spliced + 2 canvas overlays.');
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

/**
 * Update all lens effect uniforms.
 * Call from the LATE tick in main.js, alongside updatePostFX().
 *
 * @param {number} dt    — Delta time (seconds)
 * @param {object} opts
 * @param {number}  [opts.speedKph=0]       — Car speed km/h
 * @param {boolean} [opts.isNight=false]    — Night flag from environment.isNight()
 * @param {string}  [opts.biome='']         — Current biome string from getBiome()
 * @param {object}  [opts.playerPos]        — {x,z} for biome check (passed from car)
 */
export function updateLensEffects(dt, opts = {}) {
  if (!_ready) return;

  const {
    speedKph  = 0,
    isNight   = false,
    biome     = '',
  } = opts;

  _elapsedTime += dt;

  // ── Lens dirt: brighter at night (headlight glare on glass) ──────────────
  if (_dirtPass) {
    _dirtPass.uniforms.uTime.value = _elapsedTime;
    const targetDirt = isNight ? 0.65 : 0.15;
    _dirtPass.uniforms.uDirtStrength.value = THREE.MathUtils.lerp(
      _dirtPass.uniforms.uDirtStrength.value, targetDirt, dt * 1.5,
    );
  }

  // ── Heat haze: fade in/out based on Caldera biome ─────────────────────────
  if (_hazePass) {
    _hazePass.uniforms.uTime.value = _elapsedTime;
    const inCaldera = biome === 'caldera';
    _hazePass.uniforms.uStrength.value = THREE.MathUtils.lerp(
      _hazePass.uniforms.uStrength.value, inCaldera ? 1.0 : 0.0, dt * 0.4,
    );
  }

  // ── Film grain: re-seed at 24 fps ─────────────────────────────────────────
  if (_grainPass) {
    _grainFrameTime += dt;
    if (_grainFrameTime >= 1 / 24) {
      _grainFrameTime = 0;
      _grainSeed = Math.random() * 1000;
      _grainPass.uniforms.uSeed.value = _grainSeed;
    }
    // Slightly more grain at night (film-noir feel)
    const targetOpacity = isNight ? 0.12 : 0.07;
    _grainPass.uniforms.uOpacity.value = THREE.MathUtils.lerp(
      _grainPass.uniforms.uOpacity.value, targetOpacity, dt * 2,
    );
  }

  // ── Vignette: stronger at night, also at high speed ───────────────────────
  if (_vignettePass) {
    const speedBoost = THREE.MathUtils.clamp((speedKph - 150) / 150, 0, 0.3);
    const nightBoost = isNight ? 0.25 : 0.0;
    const target     = 0.35 + nightBoost + speedBoost;
    _vignettePass.uniforms.uStrength.value = THREE.MathUtils.lerp(
      _vignettePass.uniforms.uStrength.value, target, dt * 2,
    );
  }

  // ── 2-D canvas overlays ───────────────────────────────────────────────────
  _updateSpeedLines(dt, speedKph);
  _updateHeadlightFlare(dt, isNight, speedKph);
}

// ─── Speed-lines canvas ────────────────────────────────────────────────────────

function _buildSpeedLinesCanvas(parent) {
  _speedCanvas = document.createElement('canvas');
  _speedCanvas.style.cssText = [
    'position:absolute', 'top:0', 'left:0',
    'width:100%', 'height:100%',
    'pointer-events:none',
    'opacity:0',
    'z-index:5',
  ].join(';');
  _speedCtx = _speedCanvas.getContext('2d');
  parent.parentElement?.appendChild(_speedCanvas) ?? document.body.appendChild(_speedCanvas);
  _resizeCanvas(_speedCanvas);
}

let _speedLineOpacity = 0;

function _updateSpeedLines(dt, speedKph) {
  if (!_speedCtx) return;

  // Target opacity: 0 below 200, ramps to 0.65 at 350 km/h
  const targetOpacity = THREE.MathUtils.clamp((speedKph - 200) / 150, 0, 0.65);
  _speedLineOpacity = THREE.MathUtils.lerp(_speedLineOpacity, targetOpacity, dt * 4);

  if (_speedLineOpacity < 0.01) {
    _speedCanvas.style.opacity = '0';
    return;
  }

  const W = _speedCanvas.width;
  const H = _speedCanvas.height;
  const cx = W / 2;
  const cy = H / 2;

  _speedCtx.clearRect(0, 0, W, H);

  // 60 radial streaks emanating from screen centre
  const COUNT = 60;
  for (let i = 0; i < COUNT; i++) {
    const angle      = (i / COUNT) * Math.PI * 2 + _elapsedTime * 0.8;
    const innerR     = 0.12 + Math.random() * 0.10; // fraction of half-diagonal
    const outerR     = 0.55 + Math.random() * 0.35;
    const halfDiag   = Math.hypot(cx, cy);
    const x1 = cx + Math.cos(angle) * halfDiag * innerR;
    const y1 = cy + Math.sin(angle) * halfDiag * innerR;
    const x2 = cx + Math.cos(angle) * halfDiag * outerR;
    const y2 = cy + Math.sin(angle) * halfDiag * outerR;

    const grad = _speedCtx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, `rgba(255,255,255,${_speedLineOpacity * 0.6})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');

    _speedCtx.beginPath();
    _speedCtx.moveTo(x1, y1);
    _speedCtx.lineTo(x2, y2);
    _speedCtx.lineWidth = 0.8 + Math.random() * 1.2;
    _speedCtx.strokeStyle = grad;
    _speedCtx.stroke();
  }

  _speedCanvas.style.opacity = String(_speedLineOpacity);
}

// ─── Headlight-flare canvas ────────────────────────────────────────────────────

function _buildHeadlightFlareCanvas(parent) {
  _flareCanvas = document.createElement('canvas');
  _flareCanvas.style.cssText = [
    'position:absolute', 'top:0', 'left:0',
    'width:100%', 'height:100%',
    'pointer-events:none',
    'opacity:0',
    'z-index:6',
  ].join(';');
  _flareCtx = _flareCanvas.getContext('2d');
  parent.parentElement?.appendChild(_flareCanvas) ?? document.body.appendChild(_flareCanvas);
  _resizeCanvas(_flareCanvas);
}

let _flareOpacity = 0;

function _updateHeadlightFlare(dt, isNight, speedKph) {
  if (!_flareCtx) return;

  // Flare visible at night; fades in/out smoothly
  const targetOpacity = isNight ? 0.55 : 0.0;
  _flareOpacity = THREE.MathUtils.lerp(_flareOpacity, targetOpacity, dt * 1.2);

  if (_flareOpacity < 0.01) {
    _flareCanvas.style.opacity = '0';
    return;
  }

  const W  = _flareCanvas.width;
  const H  = _flareCanvas.height;
  const cx = W / 2;
  const cy = H / 2;

  _flareCtx.clearRect(0, 0, W, H);

  // ── Anamorphic horizontal streak ──────────────────────────────────────────
  // Mimics the blue horizontal lens flare streak seen through an anamorphic lens.
  const streakHeight = H * 0.002;
  const streakGrad = _flareCtx.createLinearGradient(0, cy, W, cy);
  streakGrad.addColorStop(0.00, 'rgba(180,210,255,0)');
  streakGrad.addColorStop(0.30, `rgba(160,200,255,${_flareOpacity * 0.18})`);
  streakGrad.addColorStop(0.50, `rgba(220,235,255,${_flareOpacity * 0.55})`);
  streakGrad.addColorStop(0.70, `rgba(160,200,255,${_flareOpacity * 0.18})`);
  streakGrad.addColorStop(1.00, 'rgba(180,210,255,0)');
  _flareCtx.fillStyle = streakGrad;
  _flareCtx.fillRect(0, cy - streakHeight, W, streakHeight * 2);

  // ── 3 ghost circles scattered along the flare axis ──────────────────────
  // Classic multi-element lens internal reflection pattern.
  const ghosts = [
    { rx: 0.32, ry: 0.50, r: W * 0.06, a: 0.08 },
    { rx: 0.58, ry: 0.50, r: W * 0.04, a: 0.12 },
    { rx: 0.74, ry: 0.48, r: W * 0.025, a: 0.18 },
  ];

  for (const g of ghosts) {
    const gx = W * g.rx;
    const gy = H * g.ry;
    const grd = _flareCtx.createRadialGradient(gx, gy, 0, gx, gy, g.r);
    grd.addColorStop(0,    `rgba(210,225,255,${_flareOpacity * g.a * 1.4})`);
    grd.addColorStop(0.40, `rgba(180,200,255,${_flareOpacity * g.a * 0.8})`);
    grd.addColorStop(0.80, `rgba(140,170,255,${_flareOpacity * g.a * 0.3})`);
    grd.addColorStop(1.00, 'rgba(100,140,255,0)');
    _flareCtx.beginPath();
    _flareCtx.arc(gx, gy, g.r, 0, Math.PI * 2);
    _flareCtx.fillStyle = grd;
    _flareCtx.fill();
  }

  // ── Soft central glow (player's own headlights from behind camera) ────────
  const glowR = Math.min(W, H) * 0.12;
  const glow  = _flareCtx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  glow.addColorStop(0,    `rgba(255,252,230,${_flareOpacity * 0.22})`);
  glow.addColorStop(0.50, `rgba(230,240,255,${_flareOpacity * 0.08})`);
  glow.addColorStop(1.00, 'rgba(200,220,255,0)');
  _flareCtx.beginPath();
  _flareCtx.arc(cx, cy, glowR, 0, Math.PI * 2);
  _flareCtx.fillStyle = glow;
  _flareCtx.fill();

  _flareCanvas.style.opacity = String(_flareOpacity);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _resizeCanvas(canvas) {
  const obs = new ResizeObserver(entries => {
    for (const e of entries) {
      const { width, height } = e.contentRect;
      canvas.width  = Math.round(width);
      canvas.height = Math.round(height);
    }
  });
  const target = canvas.parentElement ?? document.body;
  obs.observe(target);
  // Initial size
  canvas.width  = target.clientWidth  || window.innerWidth;
  canvas.height = target.clientHeight || window.innerHeight;
}

// ─── Dispose ──────────────────────────────────────────────────────────────────

/**
 * Remove DOM elements and dispose GPU resources.
 * Called on scene teardown / hot-reload.
 */
export function disposeLensEffects() {
  _speedCanvas?.remove();
  _flareCanvas?.remove();

  // Remove ShaderPasses from composer (optional — composer itself may be disposed)
  if (_composer) {
    [_dirtPass, _hazePass, _grainPass, _vignettePass].forEach(p => {
      if (!p) return;
      const idx = _composer.passes.indexOf(p);
      if (idx !== -1) _composer.passes.splice(idx, 1);
      p.material?.dispose();
    });
  }

  _dirtPass = _hazePass = _grainPass = _vignettePass = null;
  _speedCanvas = _speedCtx = _flareCanvas = _flareCtx = null;
  _composer = null;
  _ready = false;
}

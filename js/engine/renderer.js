/**
 * renderer.js  —  Part 1 Rebuild
 * ─────────────────────────────────────────────────────────────────────────────
 * Three.js WebGLRenderer, scene graph, camera, and lighting.
 *
 * Design decisions vs the old file
 * ──────────────────────────────────
 * OLD: _initPostProcessing() created a built-in EffectComposer with bloom +
 *      FXAA passes.  PostFX.js (Part 6) ALSO creates its own EffectComposer.
 *      Two composers → two render calls per frame → double-renders, Z-fighting,
 *      and a blank sky whenever one path errored silently.
 *
 * NEW: No built-in composer.  renderFrame() defaults to a plain
 *      renderer.render(scene, camera) call.  PostFX.js hooks in via
 *      hookPostFX() and takes over renderFrame() entirely — zero double-render.
 *
 * Everything else is preserved:
 *   • GROUPS hierarchy (world / player / ai / ui)
 *   • SUN + AMBIENT exports for environment.js / DayNightSystem.js
 *   • pmremGenerator for SkySystem / CarPaintSystem
 *   • applyGraphicsSettings() API for SettingsMenu
 *   • setTimeOfDay() fallback (used before SkySystem hooks in)
 *   • Full preset-aware pixel ratio, shadows, tone mapping
 *
 * Import map (index.html):
 *   "three"         → https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js
 *   "three/addons/" → https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

import * as THREE from 'three';

// ─── PostFX hook (Part 6 opt-in) ─────────────────────────────────────────────
// Stays null until PostFX.js calls hookPostFX() after initPostFX().
// renderFrame() checks this every call — zero overhead when not hooked.

let _postFXRender = null; // () => void
let _postFXResize = null; // (w: number, h: number) => void

/**
 * Connect the Part 6 PostFX pipeline so it takes over renderFrame().
 * Call from main.js immediately after initPostFX():
 *
 *   import { initPostFX, renderPostFX, resizePostFX } from './engine/PostFX.js';
 *   initPostFX(renderer, scene, camera);
 *   hookPostFX(renderPostFX, resizePostFX);
 *
 * @param {() => void}            renderFn  PostFX.renderPostFX
 * @param {(w:number,h:number)=>void} resizeFn  PostFX.resizePostFX
 */
export function hookPostFX(renderFn, resizeFn) {
  _postFXRender = renderFn;
  _postFXResize = resizeFn;
  console.log('[renderer] PostFX pipeline hooked — composer takes over renderFrame().');
}

// ─── SkySystem hook (Part 3 opt-in) ──────────────────────────────────────────
// setTimeOfDay() forwards to SkySystem once it registers via setSkySystemHook().
// Before that it uses the built-in sun-arc fallback so the world is never black.

let _skyUpdateHook = null; // (dt: number, hour: number) => void

/**
 * Register the SkySystem's update function.
 * Call from main.js after initSkySystem().
 *
 * @param {(dt: number, hour: number) => void} fn
 */
export function setSkySystemHook(fn) { _skyUpdateHook = fn; }

// ─── Exported singletons ──────────────────────────────────────────────────────
// All null before initRenderer() returns.  Safe to import anywhere — just
// check for null in systems that might run before the renderer is ready.

/** @type {THREE.WebGLRenderer|null} */
export let renderer = null;

/** @type {THREE.Scene|null} */
export let scene = null;

/** @type {THREE.PerspectiveCamera|null} */
export let camera = null;

/**
 * composer is always null in this file.
 * Exported so PostFX.js and other callers that do `import { composer }` don't
 * break — they should use the composer PostFX.js creates internally.
 * @type {null}
 */
export const composer = null;

/**
 * PMREMGenerator — one per app, created in initRenderer().
 * Consumed by SkySystem (env maps) and CarPaintSystem (reflections).
 * @type {THREE.PMREMGenerator|null}
 */
export let pmremGenerator = null;

/**
 * Scene group hierarchy.
 * Every system mounts its meshes into the appropriate group rather than
 * scene.add() directly, keeping the graph organised and the Three.js
 * inspector readable.
 *
 * @type {{ world: THREE.Group, player: THREE.Group, ai: THREE.Group, ui: THREE.Group }}
 */
export const GROUPS = {
  world:  null, // terrain, roads, buildings, vegetation, NPCs
  player: null, // player car mesh + avatar
  ai:     null, // AI car meshes (created per race, disposed after)
  ui:     null, // world-space UI: waypoint arrows, board prompts
};

/**
 * Directional sun light.
 * environment.js and DayNightSystem.js reposition this on the day arc.
 * @type {THREE.DirectionalLight|null}
 */
export let SUN = null;

/**
 * Ambient fill light.
 * Colour temperature shifts with time of day.
 * @type {THREE.AmbientLight|null}
 */
export let AMBIENT = null;

// ─── Internal state ───────────────────────────────────────────────────────────

/** @type {HTMLCanvasElement|null} */
let _canvas = null;

// Read preset once at module evaluation — all sub-inits share the same value.
// Safe to call before initRenderer() because it only reads localStorage.
const _preset = (() => {
  try { return localStorage.getItem('graphicsPreset') ?? 'low'; } catch { return 'low'; }
})();

const _isLow  = _preset === 'low';
const _isMed  = _preset === 'medium';
const _isHigh = _preset === 'high' || _preset === 'ultra' || _preset === 'extreme';

// ─── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the entire rendering stack.
 * Must be called once, before the game loop starts, from main.js boot().
 *
 * Sequence: canvas → WebGLRenderer → Scene → Camera → Lighting
 * Post-processing is NOT set up here — it's PostFX.js's job (hookPostFX).
 */
export function initRenderer() {
  _canvas = _getOrCreateCanvas();

  _initWebGLRenderer(_canvas);
  _initScene();
  _initCamera();
  _initLighting();

  window.addEventListener('resize', resize);
  resize(); // apply correct size immediately (canvas may start at 300×150)

  console.log(
    `[renderer] ✅ THREE r${THREE.REVISION} | preset=${_preset} | `
    + `far=${CAM_FAR.toLocaleString()} | logDepth=true`
  );
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

function _getOrCreateCanvas() {
  let c = document.getElementById('game-canvas');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'game-canvas';
    document.body.appendChild(c);
    console.warn('[renderer] #game-canvas not found in HTML — created dynamically.');
  }
  return c;
}

// ─── WebGLRenderer ───────────────────────────────────────────────────────────

function _initWebGLRenderer(canvas) {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias:              false,  // PostFX FXAA handles AA; native MSAA is expensive
    powerPreference:        'high-performance',
    stencil:                false,  // not used → saves VRAM
    depth:                  true,
    // logarithmicDepthBuffer keeps Z-precision across the enormous range between
    // camera near (0.5 m) and far (1 500 000 m, sky dome radius).
    // Without this the sky clips through the ground on low preset, and
    // transparent road markings Z-fight at long distances on any preset.
    logarithmicDepthBuffer: true,
  });

  // ── Pixel ratio ────────────────────────────────────────────────────────────
  // low=0.5 (quarter fill-rate on Retina), medium=1.0 (native 1×), high+=2.0.
  // Capped at the device's actual DPR so we never supersample.
  const _prMap = { low: 0.5, medium: 1.0, high: 1.5, ultra: 2.0, extreme: 2.0 };
  renderer.setPixelRatio(Math.min(_prMap[_preset] ?? 0.75, window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // ── Shadows ────────────────────────────────────────────────────────────────
  if (_isLow) {
    renderer.shadowMap.enabled = false;
  } else if (_isMed) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.BasicShadowMap;
  } else {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  // LinearToneMapping on low-end saves a per-pixel GPU op; ACES elsewhere
  renderer.toneMapping         = _isLow ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // ── PMREMGenerator ─────────────────────────────────────────────────────────
  // Created once here and exported.  SkySystem and CarPaintSystem use this
  // shared instance — creating a second PMREMGenerator wastes memory and
  // causes redundant shader compilations.
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
}

// ─── Scene ────────────────────────────────────────────────────────────────────

// Fog tuned for the 4×4 km Mexico map — warm dust haze on low, longer draw on high.
// FH5 Mexico afternoon palette: 0xd4956a (amber dust).
const _FOG_COLOUR = 0xd4956a;
const _fogNear    = _isLow ?  200 : _isMed ?  400 :  600;
const _fogFar     = _isLow ?  800 : _isMed ? 1200 : 2000;

function _initScene() {
  scene = new THREE.Scene();

  scene.fog        = new THREE.Fog(_FOG_COLOUR, _fogNear, _fogFar);
  // Sky-blue fallback so the canvas is never white during SkySystem startup.
  // SkySystem will set scene.background to its env map once it's ready.
  scene.background = new THREE.Color(0x87ceeb);

  // ── Group hierarchy ────────────────────────────────────────────────────────
  GROUPS.world  = new THREE.Group(); GROUPS.world.name  = 'WorldGroup';
  GROUPS.player = new THREE.Group(); GROUPS.player.name = 'PlayerGroup';
  GROUPS.ai     = new THREE.Group(); GROUPS.ai.name     = 'AIGroup';
  GROUPS.ui     = new THREE.Group(); GROUPS.ui.name     = 'UIGroup';

  scene.add(GROUPS.world, GROUPS.player, GROUPS.ai, GROUPS.ui);
}

// ─── Camera ───────────────────────────────────────────────────────────────────

const CAM_FOV  = 65;   // degrees — driving.js ramps this up with speed
const CAM_NEAR = 0.5;  // metres — close enough for interior shots

/**
 * Far plane must exceed the sky dome radius (500 000 m) on ALL presets.
 * Previous value was 200 on low preset, which depth-clipped the entire sky.
 * logarithmicDepthBuffer keeps Z-precision usable across this 3 000 000:1 range.
 */
const CAM_FAR  = 1_500_000;

function _initCamera() {
  camera = new THREE.PerspectiveCamera(
    CAM_FOV,
    window.innerWidth / window.innerHeight,
    CAM_NEAR,
    CAM_FAR,
  );

  // Resting position — driving.js takes over on the first update tick.
  camera.position.set(0, 5, -12);
  camera.lookAt(0, 1, 0);
}

// ─── Lighting ─────────────────────────────────────────────────────────────────

function _initLighting() {
  // ── Ambient fill ───────────────────────────────────────────────────────────
  // Warm Mexican afternoon white balance.  Intensity + colour updated by
  // DayNightSystem.js / setTimeOfDay() each frame.
  AMBIENT = new THREE.AmbientLight(0xfff4e0, 0.6);
  AMBIENT.name = 'AmbientLight';
  scene.add(AMBIENT);

  // ── Directional sun ────────────────────────────────────────────────────────
  SUN          = new THREE.DirectionalLight(0xfff8e7, 2.5);
  SUN.name     = 'SunLight';
  SUN.position.set(200, 400, 150); // high afternoon angle — overridden by DayNight

  // Shadow camera: tight frustum around the player, not the whole scene.
  // driving.js repositions SUN.shadow.camera.target each frame.
  SUN.castShadow = !_isLow; // skip shadow map entirely on low

  if (SUN.castShadow) {
    const smSize = _isMed ? 512 : 2048;
    const s      = SUN.shadow;
    s.mapSize.set(smSize, smSize);
    s.camera.near   =   1;
    s.camera.far    = 800;
    s.camera.left   = -80;
    s.camera.right  =  80;
    s.camera.top    =  80;
    s.camera.bottom = -80;
    s.bias          = -0.001; // prevents shadow acne on flat tarmac
  }

  scene.add(SUN);
  scene.add(SUN.target); // target must be in the scene for castShadow to work

  // ── Hemisphere (sky / ground bounce) ──────────────────────────────────────
  // Provides a cheap gradient fill: soft blue from above, warm ochre from below.
  // Makes shaded faces look like they're sitting in an outdoor environment
  // even on low preset where the full sky dome may be simplest.
  const hemi = new THREE.HemisphereLight(
    0xb0cce8, // sky colour — cool blue
    0x7a6a50, // ground bounce — warm brown (Mexican soil)
    0.8
  );
  hemi.name = 'HemisphereLight';
  scene.add(hemi);
}

// ─── Resize ───────────────────────────────────────────────────────────────────

/**
 * Handle window resize and fullscreen toggles.
 * Called automatically on 'resize' events and once during initRenderer().
 * Also call manually from SettingsMenu when toggling fullscreen.
 */
export function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Re-read preset in case the player changed it in Settings mid-session.
  const currentPreset = (() => {
    try { return localStorage.getItem('graphicsPreset') ?? 'low'; } catch { return 'low'; }
  })();
  const _prMap = { low: 0.5, medium: 1.0, high: 1.5, ultra: 2.0, extreme: 2.0 };
  const dpr    = Math.min(_prMap[currentPreset] ?? 0.5, window.devicePixelRatio);

  if (camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  if (renderer) {
    renderer.setSize(w, h);
    renderer.setPixelRatio(dpr);
  }

  // PostFX handles its own internal pass resizing once hooked.
  if (_postFXResize) _postFXResize(w, h);
}

// ─── Graphics settings API ────────────────────────────────────────────────────

/**
 * Apply graphics quality changes at runtime (from SettingsMenu).
 * All parameters are optional — only supplied ones are applied.
 *
 * @param {object}  opts
 * @param {number}  [opts.pixelRatio]            1 | 1.5 | 2
 * @param {boolean} [opts.shadows]
 * @param {number}  [opts.shadowMapSize]          512 | 1024 | 2048
 * @param {number}  [opts.toneMappingExposure]    0.5 – 2.0
 * @param {'linear'|'aces'} [opts.toneMapping]
 */
export function applyGraphicsSettings(opts = {}) {
  if (!renderer) return;

  if (opts.pixelRatio !== undefined) {
    renderer.setPixelRatio(Math.min(opts.pixelRatio, window.devicePixelRatio));
    resize();
  }

  if (opts.shadows !== undefined) {
    renderer.shadowMap.enabled = opts.shadows;
    // Force shadow map re-bake on all shadow-casting lights
    scene?.traverse(obj => {
      if (obj.isMesh) obj.material.needsUpdate = true;
    });
  }

  if (opts.shadowMapSize !== undefined && SUN?.castShadow) {
    SUN.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
    SUN.shadow.map?.dispose();
    SUN.shadow.map = null; // triggers re-bake next frame
  }

  if (opts.toneMappingExposure !== undefined) {
    renderer.toneMappingExposure = opts.toneMappingExposure;
  }

  if (opts.toneMapping !== undefined) {
    renderer.toneMapping = opts.toneMapping === 'aces'
      ? THREE.ACESFilmicToneMapping
      : THREE.LinearToneMapping;
  }
}

// ─── Day / Night helper ───────────────────────────────────────────────────────

/**
 * Update sun position and scene colours for time of day.
 * Called by environment.js each frame with a normalised day fraction.
 *
 * If SkySystem has registered via setSkySystemHook(), this delegates to it.
 * Otherwise the built-in sun-arc fallback runs so the world is never black
 * during early boot (before SkySystem initialises).
 *
 * @param {number} t  Normalised day fraction: 0.0 = midnight, 0.5 = noon, 1.0 = midnight
 */
export function setTimeOfDay(t) {
  // Delegate to physically-based sky once available.
  // SkySystem expects hour in [0, 24]; t is [0, 1].
  if (_skyUpdateHook) {
    _skyUpdateHook(0.016, t * 24);
    return;
  }

  // ── Built-in fallback (used before Part 3 SkySystem registers) ────────────
  if (!SUN || !AMBIENT || !scene) return;

  const angle      = t * Math.PI * 2 - Math.PI * 0.5;
  const dayFrac    = Math.max(0, Math.sin(angle)); // 0=night, 1=noon
  const radius     = 400;

  SUN.position.set(
    Math.cos(angle) * radius * 0.6,
    Math.sin(angle) * radius,
    Math.sin(angle * 0.7) * radius * 0.4
  );
  SUN.intensity = 2.5 * dayFrac;

  // ── Sun colour: night → dawn → noon → dusk → night ──────────────────────
  const _night = new THREE.Color(0x0a0a2a);
  const _dawn  = new THREE.Color(0xff9060);
  const _noon  = new THREE.Color(0xfff8e7);
  const _dusk  = new THREE.Color(0xff7040);

  let sunCol;
  if      (dayFrac < 0.15) sunCol = _night.clone().lerp(_dawn,  dayFrac / 0.15);
  else if (dayFrac < 0.35) sunCol = _dawn.clone().lerp(_noon,   (dayFrac - 0.15) / 0.20);
  else if (dayFrac < 0.75) sunCol = _noon.clone();
  else if (dayFrac < 0.90) sunCol = _noon.clone().lerp(_dusk,   (dayFrac - 0.75) / 0.15);
  else                     sunCol = _dusk.clone().lerp(_night,  (dayFrac - 0.90) / 0.10);

  SUN.color.copy(sunCol);

  // Ambient follows brightness
  AMBIENT.intensity = 0.15 + dayFrac * 0.45;

  // Sky background + fog shift to match
  const _skyDay   = new THREE.Color(0xc8d8e8);
  const _skyNight = new THREE.Color(0x080818);
  const skyCol    = _skyDay.lerp(_skyNight, 1 - dayFrac);

  if (scene.background?.isColor) scene.background.copy(skyCol);
  if (scene.fog) scene.fog.color.copy(skyCol);
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Render one frame.
 * Called by loop.js _builtinRender at the end of each tick (RENDER phase).
 *
 * Routing:
 *   PostFX hooked  →  delegate to PostFX composer (bloom, FXAA, vignette, etc.)
 *   No PostFX      →  plain renderer.render(scene, camera)
 *
 * The old file had a third path: the legacy built-in composer.  That has been
 * removed.  There is now exactly ONE render call per frame in all cases.
 *
 * @param {number} [_alpha]  Physics interpolation factor (0–1) — passed through
 *                           from loop.js, consumed by future motion-blur pass.
 */
export function renderFrame(_alpha = 0) {
  if (!renderer || !scene || !camera) return;

  if (_postFXRender) {
    // Part 6 PostFX pipeline handles everything including the scene render pass.
    _postFXRender();
    return;
  }

  // Fallback: direct renderer call — clean, zero overhead, correct output.
  renderer.render(scene, camera);
}

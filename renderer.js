/**
 * renderer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Three.js WebGLRenderer, scene graph, camera, lighting, and post-processing.
 * This is the first system initialised — everything else mounts into GROUPS.
 *
 * Usage:
 *   import { initRenderer, scene, camera, renderer, composer, GROUPS, SUN } from './renderer.js';
 *   await initRenderer();          // call once from main.js before anything else
 *
 * Resolved by importmap in index.html:
 *   "three"            → https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js
 *   "three/addons/"    → https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/
 *
 * Part 10 — Technical Architecture (design doc reference)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }       from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader }       from 'three/addons/shaders/FXAAShader.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js';

// ─── EXPORTED SINGLETONS ─────────────────────────────────────────────────────
// Populated by initRenderer(). Import these anywhere after init is awaited.

export let scene    = null;
export let camera   = null;
export let renderer = null;
export let composer = null;

/**
 * Scene group hierarchy — all systems mount their meshes here rather than
 * directly onto the scene root, keeping the graph organised and debuggable.
 *
 * @type {{ world: THREE.Group, player: THREE.Group, ai: THREE.Group, ui: THREE.Group }}
 */
export const GROUPS = {
  world:  null, // city chunks, road, environment, NPCs
  player: null, // player car + avatar
  ai:     null, // AI car meshes (spawned per race)
  ui:     null, // world-space UI: waypoint arrows, board icons, prompts
};

/**
 * The directional sun light — exported so environment.js can reposition it
 * on the day/night cycle.
 * @type {THREE.DirectionalLight}
 */
export let SUN = null;

/**
 * Ambient light — exported so environment.js can shift colour temperature.
 * @type {THREE.AmbientLight}
 */
export let AMBIENT = null;

// ─── INTERNAL STATE ──────────────────────────────────────────────────────────

/** @type {HTMLCanvasElement} */
let _canvas = null;

/** @type {UnrealBloomPass} */
let _bloomPass = null;

/** @type {ShaderPass} */
let _fxaaPass = null;

// Post-processing settings (can be updated via applyGraphicsSettings())
const _ppSettings = {
  bloom:        true,
  bloomStrength: 0.35,
  bloomRadius:   0.5,
  bloomThreshold: 0.75,
  fxaa:         true,
};

// ─── INIT ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the entire rendering stack.
 * Must be called once before the game loop starts.
 *
 * @returns {Promise<void>}
 */
export async function initRenderer() {
  _canvas = _getOrCreateCanvas();

  _initRenderer(_canvas);
  _initScene();
  _initCamera();
  _initLighting();
  _initPostProcessing();

  window.addEventListener('resize', resize);
  resize(); // set correct size immediately

  console.log('[renderer] ✅ Initialised — THREE r' + THREE.REVISION);
}

// ─── CANVAS ──────────────────────────────────────────────────────────────────

function _getOrCreateCanvas() {
  let canvas = document.getElementById('hc-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'hc-canvas';
    // Styling applied by main.css — this just ensures it exists
    document.body.appendChild(canvas);
  }
  return canvas;
}

// ─── RENDERER ────────────────────────────────────────────────────────────────

function _initRenderer(canvas) {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,       // FXAA handles AA in post; native AA is expensive
    powerPreference: 'high-performance',
    stencil: false,         // not needed — saves some VRAM
    depth: true,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap at 2x
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

  // Use physically correct lighting model (matches the car paint shader)
  renderer.useLegacyLights = false;

  // sRGB output — colours look correct without manual gamma correction
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping      = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
}

// ─── SCENE ───────────────────────────────────────────────────────────────────

function _initScene() {
  scene = new THREE.Scene();

  // Fog: light haze that hides chunk pop-in at the LOD edge (~300m)
  scene.fog = new THREE.Fog(
    0xc8d8e8,  // cool blue-grey — matches daytime sky
    250,       // fog start distance (m)
    500        // fog end distance (matches LOD billboard transition)
  );

  // Background matches fog colour so the horizon blends
  scene.background = new THREE.Color(0xc8d8e8);

  // Build group hierarchy
  GROUPS.world  = new THREE.Group(); GROUPS.world.name  = 'WorldGroup';
  GROUPS.player = new THREE.Group(); GROUPS.player.name = 'PlayerGroup';
  GROUPS.ai     = new THREE.Group(); GROUPS.ai.name     = 'AIGroup';
  GROUPS.ui     = new THREE.Group(); GROUPS.ui.name     = 'UIGroup';

  scene.add(GROUPS.world, GROUPS.player, GROUPS.ai, GROUPS.ui);
}

// ─── CAMERA ──────────────────────────────────────────────────────────────────

/**
 * Third-person chase camera defaults.
 * driving.js updates camera position every frame — these are just initial values.
 */
const CAM_FOV    = 65;    // degrees — wider than default gives a sense of speed
const CAM_NEAR   = 0.5;   // metres
const CAM_FAR    = 600;   // metres — just beyond the billboard LOD edge

function _initCamera() {
  camera = new THREE.PerspectiveCamera(
    CAM_FOV,
    window.innerWidth / window.innerHeight,
    CAM_NEAR,
    CAM_FAR
  );

  // Default resting position — driving.js takes over immediately
  camera.position.set(0, 5, -12);
  camera.lookAt(0, 1, 0);
}

// ─── LIGHTING ────────────────────────────────────────────────────────────────

function _initLighting() {
  // ── Ambient (fill) ─────────────────────────────────────────────────────────
  // Colour temperature shifts with day/night cycle via environment.js
  AMBIENT = new THREE.AmbientLight(0xfff4e0, 0.6); // warm daylight default
  scene.add(AMBIENT);

  // ── Sun / directional ──────────────────────────────────────────────────────
  SUN = new THREE.DirectionalLight(0xfff8e7, 2.5);
  SUN.position.set(200, 400, 150); // high-angle afternoon sun default
  SUN.castShadow = true;

  // Shadow map — covers the area immediately around the player
  const s = SUN.shadow;
  s.mapSize.width  = 2048;
  s.mapSize.height = 2048;
  s.camera.near    = 1;
  s.camera.far     = 600;
  s.camera.left    = -80;
  s.camera.right   =  80;
  s.camera.top     =  80;
  s.camera.bottom  = -80;
  s.bias           = -0.001; // prevents shadow acne on the road

  // Shadow camera follows the player — driving.js repositions SUN.shadow.camera
  scene.add(SUN);
  scene.add(SUN.target); // target defaults to (0,0,0); updated per frame

  // ── Hemisphere (sky/ground fill) ───────────────────────────────────────────
  // Soft sky-colour fill from above, warm ground bounce from below
  const hemi = new THREE.HemisphereLight(
    0xb0cce8,  // sky colour
    0x7a6a50,  // ground bounce
    0.8
  );
  hemi.name = 'HemisphereLight';
  scene.add(hemi);
}

// ─── POST-PROCESSING ─────────────────────────────────────────────────────────

function _initPostProcessing() {
  composer = new EffectComposer(renderer);

  // Pass 1 — standard scene render
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Pass 2 — Bloom (neon signs, headlights, speed zones at night)
  _bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    _ppSettings.bloomStrength,   // strength
    _ppSettings.bloomRadius,     // radius
    _ppSettings.bloomThreshold   // threshold
  );
  _bloomPass.enabled = _ppSettings.bloom;
  composer.addPass(_bloomPass);

  // Pass 3 — FXAA (fast anti-aliasing)
  _fxaaPass = new ShaderPass(FXAAShader);
  _fxaaPass.enabled = _ppSettings.fxaa;
  composer.addPass(_fxaaPass);

  // Pass 4 — Output (colour space conversion, tone mapping finalisation)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);
}

// ─── RESIZE ──────────────────────────────────────────────────────────────────

/**
 * Called on window resize and once at init.
 * Also called by the settings menu when toggling fullscreen.
 */
export function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio, 2);

  if (camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  if (renderer) {
    renderer.setSize(w, h);
    renderer.setPixelRatio(dpr);
  }

  if (composer) {
    composer.setSize(w, h);
  }

  // FXAA needs pixel size uniform updated on resize
  if (_fxaaPass) {
    _fxaaPass.material.uniforms['resolution'].value.set(
      1 / (w * dpr),
      1 / (h * dpr)
    );
  }

  if (_bloomPass) {
    _bloomPass.resolution.set(w, h);
  }
}

// ─── GRAPHICS SETTINGS API ───────────────────────────────────────────────────

/**
 * Apply graphics quality settings from SettingsMenu.
 * Called whenever the player changes a graphics option.
 *
 * @param {object} opts
 * @param {boolean} [opts.bloom]
 * @param {number}  [opts.bloomStrength]   0.0 – 1.0
 * @param {boolean} [opts.fxaa]
 * @param {number}  [opts.shadowMapSize]   512 | 1024 | 2048
 * @param {number}  [opts.pixelRatio]      1 | 1.5 | 2
 * @param {number}  [opts.toneMappingExposure]
 */
export function applyGraphicsSettings(opts = {}) {
  if (opts.bloom !== undefined && _bloomPass) {
    _bloomPass.enabled = opts.bloom;
  }
  if (opts.bloomStrength !== undefined && _bloomPass) {
    _bloomPass.strength = opts.bloomStrength;
  }
  if (opts.fxaa !== undefined && _fxaaPass) {
    _fxaaPass.enabled = opts.fxaa;
  }
  if (opts.shadowMapSize !== undefined && SUN) {
    SUN.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
    SUN.shadow.map?.dispose();
    SUN.shadow.map = null; // force re-bake
  }
  if (opts.pixelRatio !== undefined && renderer) {
    renderer.setPixelRatio(Math.min(opts.pixelRatio, window.devicePixelRatio));
    resize();
  }
  if (opts.toneMappingExposure !== undefined && renderer) {
    renderer.toneMappingExposure = opts.toneMappingExposure;
  }
}

// ─── DAY / NIGHT HELPERS ─────────────────────────────────────────────────────

/**
 * Update scene lighting for time of day.
 * Called by environment.js every frame with normalised time (0=midnight, 0.5=noon).
 *
 * @param {number} t  0.0 – 1.0 (fraction of a full day)
 */
export function setTimeOfDay(t) {
  // Map t to angle (0=midnight at bottom, 0.5=noon at top)
  const angle = (t * Math.PI * 2) - Math.PI * 0.5;
  const radius = 400;

  SUN.position.set(
    Math.cos(angle) * radius * 0.6,
    Math.sin(angle) * radius,
    Math.sin(angle * 0.7) * radius * 0.4
  );

  // Intensity: 0 at night, full at noon
  const dayFraction = Math.max(0, Math.sin(angle));
  SUN.intensity = 2.5 * dayFraction;

  // Colour: warm dawn/dusk, white noon, dark blue night
  const nightCol  = new THREE.Color(0x0a0a2a);
  const dawnCol   = new THREE.Color(0xff9060);
  const noonCol   = new THREE.Color(0xfff8e7);
  const duskCol   = new THREE.Color(0xff7040);

  let sunCol;
  if (dayFraction < 0.15) {
    sunCol = nightCol.lerp(dawnCol, dayFraction / 0.15);
  } else if (dayFraction < 0.35) {
    sunCol = dawnCol.clone().lerp(noonCol, (dayFraction - 0.15) / 0.2);
  } else if (dayFraction < 0.75) {
    sunCol = noonCol.clone();
  } else if (dayFraction < 0.9) {
    sunCol = noonCol.clone().lerp(duskCol, (dayFraction - 0.75) / 0.15);
  } else {
    sunCol = duskCol.clone().lerp(nightCol, (dayFraction - 0.9) / 0.1);
  }
  SUN.color.copy(sunCol);

  // Sky / ambient — darker at night
  const ambientIntensity = 0.15 + dayFraction * 0.45;
  AMBIENT.intensity = ambientIntensity;
  scene.background?.set(
    dayFraction > 0.05
      ? new THREE.Color(0xc8d8e8).lerp(new THREE.Color(0x080818), 1 - dayFraction)
      : new THREE.Color(0x080818)
  );
  scene.fog.color.copy(scene.background);

  // Bloom slightly stronger at night (neon emphasis)
  if (_bloomPass) {
    _bloomPass.strength = _ppSettings.bloomStrength + (1 - dayFraction) * 0.4;
  }
}

// ─── RENDER CALL ─────────────────────────────────────────────────────────────

/**
 * Render one frame. Called by loop.js at the end of each tick.
 * Uses EffectComposer so all post-processing passes run automatically.
 */
export function renderFrame() {
  composer.render();
}

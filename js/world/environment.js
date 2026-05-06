/**
 * environment.js — World Environment
 * Part 1 / World layer
 *
 * Responsibilities:
 *  - 24-hour day/night cycle compressed to ~20 real minutes
 *  - Sun/moon arc driven by time-of-day, fed into renderer.setTimeOfDay()
 *  - Sky colour & fog interpolation across 6 time keyframes
 *  - Weather state machine: CLEAR → OVERCAST → RAIN (with smooth transitions)
 *  - Rain particle system (Three.js Points, GPU-friendly)
 *  - Puddle / wet-road material blend fed to city.js road mesh
 *  - Headlight activation signal for car.js (night flag)
 *  - NPC traffic density scalar by time of day
 *  - audio.js ambient bed switching (rain loop, city hum)
 *  - Grip multiplier broadcast for suspension.js (rain reduces grip)
 *
 * Exports:
 *  initEnvironment(scene)      — call once after initRenderer()
 *  tick(dt)                    — call each UPDATE-phase tick; drives the whole system
 *  setWeather(type)            — 'clear' | 'overcast' | 'rain'
 *  getWeather()                — returns current WeatherState object
 *  getTimeOfDay()              — returns normalised t in [0,1] (0=midnight, 0.5=noon)
 *  getHour()                   — returns float hour 0–24
 *  isNight()                   — true when headlights should be on
 *  getGripMultiplier()         — wet-road grip factor (1.0 clear, 0.65 rain)
 *  getTrafficDensity()         — 0–1 scalar for npc.js
 *  WEATHER                     — enum of weather type strings
 *  TIME_SCALE                  — exported so Settings menu can expose a slider
 */

import * as THREE           from 'three';
import { scene, GROUPS }    from '../engine/renderer.js';
import { setTimeOfDay }     from '../engine/renderer.js';
import { audioManager }     from '../engine/audio.js';

// Part 4 — SkySystem (HDR sky dome, clouds, PMREM).  Import lazily so the
// game still runs if SkySystem.js hasn't been added yet.
let _skyUpdate  = null;
let _skyStars   = null;
let _skyEnsure  = null;

/**
 * Wire in the SkySystem once it has been initialised in main.js.
 * Call this from main.js after initSkySystem():
 *
 *   import { updateSky, updateStars, ensureStars } from './world/SkySystem.js';
 *   environment.connectSkySystem(updateSky, updateStars, ensureStars);
 *
 * @param {function} updateFn   SkySystem.updateSky
 * @param {function} starsFn    SkySystem.updateStars
 * @param {function} ensureFn   SkySystem.ensureStars
 */
export function connectSkySystem(updateFn, starsFn, ensureFn) {
  _skyUpdate = updateFn;
  _skyStars  = starsFn;
  _skyEnsure = ensureFn;
  console.log('[environment] SkySystem connected (Part 4).');
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** How many real seconds equal one in-game hour.  20 min day = 50 s/hr. */
export let TIME_SCALE = 50; // seconds of real time per in-game hour

/** Weather type enum. */
export const WEATHER = Object.freeze({
  CLEAR:    'clear',
  OVERCAST: 'overcast',
  RAIN:     'rain',
});

/** How long (real seconds) a weather transition takes. */
const WEATHER_TRANSITION_DURATION = 12;

/** Rain particle count — tuned for mid-range laptop GPU. */
const RAIN_PARTICLE_COUNT = 6000;

/** Rain fall volume (metres each side of camera). */
const RAIN_BOX_HALF = 80;

/** Rain fall speed (m/s). */
const RAIN_SPEED = 28;

// ─── Sky / Lighting Keyframes ─────────────────────────────────────────────────

/**
 * Six keyframes evenly spaced across the 24-hour cycle.
 * t = normalised time [0,1] where 0 & 1 = midnight, 0.5 = noon.
 *
 * Each keyframe drives:
 *  skyTop / skyHorizon  — fog + background colour
 *  sunColor             — directional light colour
 *  ambientColor         — ambient light colour
 *  ambientIntensity     — ambient light strength
 *  sunIntensity         — directional light strength
 *  fogNear / fogFar     — THREE.Fog distances
 *  bloomStrength        — EffectComposer bloom intensity
 */
const SKY_KEYFRAMES = [
  // t=0.000  midnight
  {
    t: 0.000,
    skyTop:         new THREE.Color(0x020614),
    skyHorizon:     new THREE.Color(0x0d1a2e),
    sunColor:       new THREE.Color(0x1a2a4a),
    ambientColor:   new THREE.Color(0x0a1020),
    ambientIntensity: 0.08,
    sunIntensity:   0.05,
    fogNear:        120,
    fogFar:         420,
    bloomStrength:  0.80,  // Neon signs pop at night
  },
  // t=0.167  dawn (4 AM)
  {
    t: 0.167,
    skyTop:         new THREE.Color(0x0d1a3a),
    skyHorizon:     new THREE.Color(0x3b1f0a),
    sunColor:       new THREE.Color(0xff6b35),
    ambientColor:   new THREE.Color(0x1a1020),
    ambientIntensity: 0.15,
    sunIntensity:   0.35,
    fogNear:        150,
    fogFar:         500,
    bloomStrength:  0.55,
  },
  // t=0.250  morning (6 AM)
  {
    t: 0.250,
    skyTop:         new THREE.Color(0x87ceeb),
    skyHorizon:     new THREE.Color(0xffbb88),
    sunColor:       new THREE.Color(0xffe4b5),
    ambientColor:   new THREE.Color(0xaaaacc),
    ambientIntensity: 0.45,
    sunIntensity:   0.80,
    fogNear:        200,
    fogFar:         700,
    bloomStrength:  0.25,
  },
  // t=0.500  noon
  {
    t: 0.500,
    skyTop:         new THREE.Color(0x1a6eb5),
    skyHorizon:     new THREE.Color(0x87ceeb),
    sunColor:       new THREE.Color(0xfff5e0),
    ambientColor:   new THREE.Color(0xc8d8f0),
    ambientIntensity: 0.60,
    sunIntensity:   1.20,
    fogNear:        300,
    fogFar:         900,
    bloomStrength:  0.15,
  },
  // t=0.750  golden hour / dusk (6 PM)
  {
    t: 0.750,
    skyTop:         new THREE.Color(0x1a1a3a),
    skyHorizon:     new THREE.Color(0xff6020),
    sunColor:       new THREE.Color(0xff9040),
    ambientColor:   new THREE.Color(0x804020),
    ambientIntensity: 0.35,
    sunIntensity:   0.60,
    fogNear:        150,
    fogFar:         550,
    bloomStrength:  0.50,
  },
  // t=0.875  night (9 PM)
  {
    t: 0.875,
    skyTop:         new THREE.Color(0x020510),
    skyHorizon:     new THREE.Color(0x0a1025),
    sunColor:       new THREE.Color(0x102040),
    ambientColor:   new THREE.Color(0x080818),
    ambientIntensity: 0.10,
    sunIntensity:   0.08,
    fogNear:        100,
    fogFar:         380,
    bloomStrength:  0.90,
  },
];

// ─── Weather State Descriptors ────────────────────────────────────────────────

const WEATHER_DEFS = Object.freeze({
  [WEATHER.CLEAR]: {
    fogDensityMult:  1.00,
    ambientMult:     1.00,
    bloomMult:       1.00,
    gripMult:        1.00,
    rainOpacity:     0.00,
    trafficMult:     1.00,
    ambientAudio:    'city_hum',
  },
  [WEATHER.OVERCAST]: {
    fogDensityMult:  0.65, // Fog closer
    ambientMult:     0.70,
    bloomMult:       1.20,
    gripMult:        0.88,
    rainOpacity:     0.00,
    trafficMult:     0.85,
    ambientAudio:    'city_hum_overcast',
  },
  [WEATHER.RAIN]: {
    fogDensityMult:  0.45,
    ambientMult:     0.50,
    bloomMult:       1.40,
    gripMult:        0.65,
    rainOpacity:     1.00,
    trafficMult:     0.60,
    ambientAudio:    'rain_loop',
  },
});

// ─── State ────────────────────────────────────────────────────────────────────

/** Normalised time of day [0,1]. 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk. */
let _tod        = 0.30; // Start at morning
let _hour       = _tod * 24;

/** Current weather type. */
let _weatherCurrent = WEATHER.CLEAR;
let _weatherTarget  = WEATHER.CLEAR;

/** Transition progress [0,1]; 1 = fully transitioned to target. */
let _weatherBlend   = 1.0;

/** Rain particle system refs. */
let _rainPoints     = null;
let _rainPositions  = null;
let _rainVelocities = null;

/** Camera reference — updated by tick so rain follows the camera. */
let _cameraRef      = null;

/** Whether environment has been initialised. */
let _ready          = false;

// Blended sky values written each frame (reused objects to avoid GC)
const _blendedSkyTop         = new THREE.Color();
const _blendedSkyHorizon     = new THREE.Color();
const _blendedSunColor       = new THREE.Color();
const _blendedAmbientColor   = new THREE.Color();

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Set up the environment system.
 * Must be called after initRenderer() so scene + renderer refs exist.
 *
 * @param {THREE.Camera} camera — Pass the game camera so rain can follow it
 */
export function initEnvironment(camera) {
  _cameraRef = camera;
  _buildRainSystem();
  _ready = true;
  console.log('[environment] initEnvironment() complete.');
}

// ─── Per-Frame Tick ───────────────────────────────────────────────────────────

/**
 * Drive the entire environment system.
 * Register on LOOP_PHASE.UPDATE in main.js:
 *   onTick(dt => environment.tick(dt), LOOP_PHASE.UPDATE);
 *
 * @param {number} dt — Scaled delta seconds from loop.js
 */
export function tick(dt) {
  if (!_ready) return;

  // ── Advance time of day ──────────────────────────────────────────────────
  _tod  = (_tod + dt / (TIME_SCALE * 24)) % 1.0;
  _hour = _tod * 24;

  // ── Interpolate sky keyframes ────────────────────────────────────────────
  const sky = _sampleSkyKeyframes(_tod);

  // ── Weather blend ────────────────────────────────────────────────────────
  if (_weatherBlend < 1.0) {
    _weatherBlend = Math.min(1.0, _weatherBlend + dt / WEATHER_TRANSITION_DURATION);
  }

  const wFrom = WEATHER_DEFS[_weatherCurrent];
  const wTo   = WEATHER_DEFS[_weatherTarget];
  const wb    = _weatherBlend;

  const fogMult      = _lerp(wFrom.fogDensityMult, wTo.fogDensityMult, wb);
  const ambientMult  = _lerp(wFrom.ambientMult,    wTo.ambientMult,    wb);
  const bloomMult    = _lerp(wFrom.bloomMult,       wTo.bloomMult,      wb);
  const rainOpacity  = _lerp(wFrom.rainOpacity,     wTo.rainOpacity,    wb);

  // Finish transition
  if (_weatherBlend >= 1.0 && _weatherCurrent !== _weatherTarget) {
    _weatherCurrent = _weatherTarget;
    _updateAmbientAudio();
  }

  // ── Part 4: SkySystem — HDR sky dome, clouds, PMREM ────────────────────────
  if (_skyUpdate) {
    _skyUpdate(dt, _hour);
  }
  if (_skyEnsure) {
    _skyEnsure();
  }
  if (_skyStars) {
    _skyStars(_hour);
  }

  // ── Push to renderer ─────────────────────────────────────────────────────
  setTimeOfDay({
    t:                _tod,
    skyTop:           sky.skyTop,
    skyHorizon:       sky.skyHorizon,
    sunColor:         sky.sunColor,
    ambientColor:     _blendedAmbientColor.copy(sky.ambientColor).multiplyScalar(ambientMult),
    ambientIntensity: sky.ambientIntensity * ambientMult,
    sunIntensity:     sky.sunIntensity,
    fogNear:          sky.fogNear  * fogMult,
    fogFar:           sky.fogFar   * fogMult,
    bloomStrength:    sky.bloomStrength * bloomMult,
  });

  // ── Rain particles ───────────────────────────────────────────────────────
  _tickRain(dt, rainOpacity);
}

// ─── Weather Control ──────────────────────────────────────────────────────────

/**
 * Smoothly transition to a new weather state.
 *
 * @param {string} type — One of WEATHER.CLEAR | WEATHER.OVERCAST | WEATHER.RAIN
 */
export function setWeather(type) {
  if (!WEATHER_DEFS[type]) {
    console.warn(`[environment] Unknown weather type: "${type}"`);
    return;
  }
  if (type === _weatherTarget) return;

  _weatherCurrent = _weatherTarget; // Start from wherever we currently are
  _weatherTarget  = type;
  _weatherBlend   = 0.0;

  console.log(`[environment] Weather transitioning → ${type}`);
}

// ─── Public Queries ───────────────────────────────────────────────────────────

/** Returns normalised time [0,1]. */
export function getTimeOfDay()  { return _tod; }

/** Returns float hour 0–24. */
export function getHour()       { return _hour; }

/** True when headlights should activate on cars. */
export function isNight()       { return _tod > 0.80 || _tod < 0.22; }

/**
 * Wet-road grip multiplier.  1.0 = dry, 0.65 = heavy rain.
 * suspension.js multiplies its tyre grip by this each frame.
 */
export function getGripMultiplier() {
  const wFrom = WEATHER_DEFS[_weatherCurrent];
  const wTo   = WEATHER_DEFS[_weatherTarget];
  return _lerp(wFrom.gripMult, wTo.gripMult, _weatherBlend);
}

/**
 * Traffic density scalar 0–1 for npc.js.
 * Peaks at rush hour (8–9 AM, 5–6 PM), low at 2–5 AM, reduced in rain.
 */
export function getTrafficDensity() {
  const h  = _hour;
  let base = 0.5;
  if (h >= 7.5 && h < 9.5)   base = 1.0;   // Morning rush
  else if (h >= 17 && h < 19) base = 0.95;  // Evening rush
  else if (h >= 12 && h < 14) base = 0.70;  // Lunch
  else if (h >= 2  && h < 5)  base = 0.15;  // Dead of night
  else if (h >= 22)            base = 0.35;  // Late night

  const wTo = WEATHER_DEFS[_weatherTarget];
  return base * _lerp(WEATHER_DEFS[_weatherCurrent].trafficMult, wTo.trafficMult, _weatherBlend);
}

/** Returns a snapshot of the current weather state for HUD / minimap use. */
export function getWeather() {
  return {
    current:  _weatherCurrent,
    target:   _weatherTarget,
    blend:    _weatherBlend,
    isRain:   _weatherTarget === WEATHER.RAIN || _weatherCurrent === WEATHER.RAIN,
  };
}

/** Adjust the day length in real-seconds-per-hour (Settings menu slider). */
export function setTimeScale(secondsPerHour) {
  TIME_SCALE = Math.max(5, secondsPerHour);
}

/** Jump to a specific hour (0–24) — e.g. loading a save that stores the time. */
export function setHour(h) {
  _tod  = ((h % 24) / 24 + 1) % 1;
  _hour = _tod * 24;
}

// ─── Rain Particle System ────────────────────────────────────────────────────

function _buildRainSystem() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(RAIN_PARTICLE_COUNT * 3);
  const vel = new Float32Array(RAIN_PARTICLE_COUNT);   // fall speed per drop

  for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
    pos[i * 3 + 0] = (Math.random() - 0.5) * RAIN_BOX_HALF * 2;
    pos[i * 3 + 1] = Math.random() * RAIN_BOX_HALF * 2;
    pos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX_HALF * 2;
    vel[i]         = RAIN_SPEED * (0.8 + Math.random() * 0.4);
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color:       0xaaccff,
    size:        0.12,
    transparent: true,
    opacity:     0.0,
    depthWrite:  false,
    sizeAttenuation: true,
  });

  _rainPoints     = new THREE.Points(geo, mat);
  _rainPoints.name = 'rain_particles';
  _rainPoints.frustumCulled = false; // Always render — it moves with camera
  _rainPositions  = pos;
  _rainVelocities = vel;

  GROUPS.world.add(_rainPoints);
}

function _tickRain(dt, targetOpacity) {
  if (!_rainPoints) return;

  // Fade opacity
  const mat = _rainPoints.material;
  mat.opacity = _lerp(mat.opacity, targetOpacity, Math.min(1, dt * 2));

  if (mat.opacity < 0.01) {
    _rainPoints.visible = false;
    return;
  }
  _rainPoints.visible = true;

  // Anchor to camera position so the box of rain always surrounds the player
  if (_cameraRef) {
    _rainPoints.position.copy(_cameraRef.position);
    _rainPoints.position.y = 0; // World-space Y anchor — drops fall in world space
  }

  const pos = _rainPositions;
  const camY = _cameraRef ? _cameraRef.position.y : 0;
  const minY = camY - 5;
  const maxY = camY + RAIN_BOX_HALF * 2;

  // Advance each drop
  for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
    pos[i * 3 + 1] -= _rainVelocities[i] * dt;

    // Wrap to top of the rain box when drop passes below camera
    if (pos[i * 3 + 1] < minY) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * RAIN_BOX_HALF * 2;
      pos[i * 3 + 1] = maxY;
      pos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX_HALF * 2;
    }
  }

  _rainPoints.geometry.attributes.position.needsUpdate = true;
}

// ─── Audio Ambient Bed Switching ─────────────────────────────────────────────

function _updateAmbientAudio() {
  const tag = WEATHER_DEFS[_weatherCurrent]?.ambientAudio;
  if (tag && audioManager?.playAmbient) {
    audioManager.playAmbient(tag);
  }
}

// ─── Sky Keyframe Interpolation ───────────────────────────────────────────────

/**
 * Sample the 6-keyframe sky gradient at an arbitrary normalised time t.
 * Wraps correctly at midnight (t=0/1 boundary).
 *
 * @param {number} t — Normalised time [0,1]
 * @returns {{ skyTop, skyHorizon, sunColor, ambientColor, ambientIntensity,
 *             sunIntensity, fogNear, fogFar, bloomStrength }}
 */
function _sampleSkyKeyframes(t) {
  // Find surrounding keyframe pair
  let kA = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
  let kB = SKY_KEYFRAMES[0];

  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    if (t >= SKY_KEYFRAMES[i].t && t < SKY_KEYFRAMES[i + 1].t) {
      kA = SKY_KEYFRAMES[i];
      kB = SKY_KEYFRAMES[i + 1];
      break;
    }
  }

  // Normalise blend factor within this segment
  const segLen = (kB.t - kA.t + 1.0) % 1.0 || 1.0;
  const alpha  = ((t - kA.t + 1.0) % 1.0) / segLen;
  const a      = _smoothstep(alpha);

  return {
    skyTop:           _blendedSkyTop.lerpColors(kA.skyTop, kB.skyTop, a),
    skyHorizon:       _blendedSkyHorizon.lerpColors(kA.skyHorizon, kB.skyHorizon, a),
    sunColor:         _blendedSunColor.lerpColors(kA.sunColor, kB.sunColor, a),
    ambientColor:     _blendedAmbientColor.lerpColors(kA.ambientColor, kB.ambientColor, a),
    ambientIntensity: _lerp(kA.ambientIntensity, kB.ambientIntensity, a),
    sunIntensity:     _lerp(kA.sunIntensity,      kB.sunIntensity,     a),
    fogNear:          _lerp(kA.fogNear,            kB.fogNear,          a),
    fogFar:           _lerp(kA.fogFar,             kB.fogFar,           a),
    bloomStrength:    _lerp(kA.bloomStrength,      kB.bloomStrength,    a),
  };
}

// ─── Math Helpers ─────────────────────────────────────────────────────────────

function _lerp(a, b, t)       { return a + (b - a) * t; }
function _smoothstep(t)       { return t * t * (3 - 2 * t); }

/**
 * audio.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised audio manager built on Howler.js.
 * Handles engine RPM loops, UI sound sprites, music crossfading,
 * and world/ambient sounds — all through a single `audioManager` export.
 *
 * Usage:
 *   import { initAudio, audioManager } from './audio.js';
 *   await initAudio();
 *
 *   audioManager.playEngine(rpm, throttle);   // call every frame from driving.js
 *   audioManager.playUI('click');             // one-shot UI sounds
 *   audioManager.playMusic('festival');       // crossfade to a music track
 *
 * Howler.js loaded via importmap:
 *   "howler" → "https://esm.sh/howler"
 *
 * Asset paths (relative to index.html, in assets/audio/):
 *   engines/   — engine loop files (one per category: inline4, v6, v8, electric)
 *   music/     — background music tracks
 *   ui/        — UI sound sprite sheet
 *   world/     — tire squeal, gravel, impact, horn, ambient city
 *
 * Part 2.8 — Audio Feedback (design doc reference)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Howl, Howler } from 'howler';

// ─── VOLUME CHANNELS ─────────────────────────────────────────────────────────
// Separate volume channels let players balance audio in Settings.

const _vol = {
  master: 1.0,
  music:  0.55,
  sfx:    0.85,
  engine: 0.80,
  ambient: 0.40,
};

// ─── ENGINE SOUND PROFILES ───────────────────────────────────────────────────
/**
 * Each car category uses a different engine loop file.
 * The loop is pitched in real-time via Howler's `rate()` API.
 *
 * RPM range → playback rate mapping:
 *   idleRPM  → rate 0.5  (low idle rumble)
 *   redline  → rate 2.0  (screaming redline)
 *
 * The curve is intentionally non-linear — mid-range RPM sounds more dramatic.
 */
const ENGINE_PROFILES = Object.freeze({
  inline4: {
    src:     ['assets/audio/engines/inline4_loop.ogg', 'assets/audio/engines/inline4_loop.mp3'],
    idleRPM: 800,
    redline:  7500,
  },
  inline6: {
    src:     ['assets/audio/engines/inline6_loop.ogg', 'assets/audio/engines/inline6_loop.mp3'],
    idleRPM: 700,
    redline:  7000,
  },
  v6: {
    src:     ['assets/audio/engines/v6_loop.ogg', 'assets/audio/engines/v6_loop.mp3'],
    idleRPM: 750,
    redline:  7200,
  },
  v8: {
    src:     ['assets/audio/engines/v8_loop.ogg', 'assets/audio/engines/v8_loop.mp3'],
    idleRPM: 650,
    redline:  6500,
  },
  v10: {
    src:     ['assets/audio/engines/v10_loop.ogg', 'assets/audio/engines/v10_loop.mp3'],
    idleRPM: 700,
    redline:  8500,
  },
  v12: {
    src:     ['assets/audio/engines/v12_loop.ogg', 'assets/audio/engines/v12_loop.mp3'],
    idleRPM: 600,
    redline:  8000,
  },
  electric: {
    src:     ['assets/audio/engines/electric_loop.ogg', 'assets/audio/engines/electric_loop.mp3'],
    idleRPM: 0,
    redline:  20000,
  },
});

// ─── UI SOUND SPRITE ─────────────────────────────────────────────────────────
/**
 * All UI sounds packed into one sprite file for instant playback (no loading
 * delay on first use). Sprite offsets are in milliseconds.
 *
 * Audio file: assets/audio/ui/ui_sprites.ogg + .mp3
 * Sprite layout — each entry: [startMs, durationMs]
 */
const UI_SPRITE_MAP = Object.freeze({
  click:         [0,     120],
  hover:         [200,    80],
  confirm:       [400,   350],
  back:          [850,   200],
  error:         [1150,  300],
  notification:  [1550,  400],
  levelUp:       [2050, 1800],
  wheelspinTick: [3950,   60],
  wheelspinLand: [4100,  600],
  creditTick:    [4800,   40],
  boardCollect:  [4950,  500],
  raceStart:     [5550, 1200],
  raceFinish:    [6850, 2000],
  newRecord:     [8950, 1500],
  countdownBeep: [10550,  300],
  countdownGo:   [10950,  700],
  purchase:      [11750,  400],
  tabSwitch:     [12250,  100],
  menuOpen:      [12450,  250],
  menuClose:     [12800,  200],
  horn:          [13100,  800],
  rewind:        [14000,  600],
});

// ─── MUSIC TRACKS ────────────────────────────────────────────────────────────
/**
 * Named music contexts — each maps to one or more track files.
 * The manager picks randomly within a context and crossfades on switch.
 */
const MUSIC_TRACKS = Object.freeze({
  menu:      ['assets/audio/music/menu_theme.ogg',     'assets/audio/music/menu_theme.mp3'],
  festival:  ['assets/audio/music/festival_01.ogg',    'assets/audio/music/festival_01.mp3'],
  driving:   ['assets/audio/music/driving_01.ogg',     'assets/audio/music/driving_01.mp3',
               'assets/audio/music/driving_02.ogg',    'assets/audio/music/driving_02.mp3'],
  race:      ['assets/audio/music/race_01.ogg',        'assets/audio/music/race_01.mp3',
               'assets/audio/music/race_02.ogg',       'assets/audio/music/race_02.mp3'],
  results:   ['assets/audio/music/results.ogg',        'assets/audio/music/results.mp3'],
  wheelspin: ['assets/audio/music/wheelspin_sting.ogg','assets/audio/music/wheelspin_sting.mp3'],
  levelUp:   ['assets/audio/music/levelup_sting.ogg',  'assets/audio/music/levelup_sting.mp3'],
  none:      null,
});

// ─── WORLD SOUND DEFINITIONS ─────────────────────────────────────────────────
const WORLD_SOUNDS = Object.freeze({
  tireSqueal: {
    src: ['assets/audio/world/tire_squeal.ogg', 'assets/audio/world/tire_squeal.mp3'],
    loop: true, volume: 0,
  },
  gravel: {
    src: ['assets/audio/world/gravel_loop.ogg', 'assets/audio/world/gravel_loop.mp3'],
    loop: true, volume: 0,
  },
  impactLight: {
    src: ['assets/audio/world/impact_light.ogg', 'assets/audio/world/impact_light.mp3'],
    loop: false,
  },
  impactHeavy: {
    src: ['assets/audio/world/impact_heavy.ogg', 'assets/audio/world/impact_heavy.mp3'],
    loop: false,
  },
  turboWhine: {
    src: ['assets/audio/world/turbo_whine.ogg', 'assets/audio/world/turbo_whine.mp3'],
    loop: true, volume: 0,
  },
  ambientCity: {
    src: ['assets/audio/world/city_ambient.ogg', 'assets/audio/world/city_ambient.mp3'],
    loop: true,
  },
  footstep: {
    src: ['assets/audio/world/footstep.ogg', 'assets/audio/world/footstep.mp3'],
    loop: false,
  },
});

// ─── INTERNAL STATE ──────────────────────────────────────────────────────────

/** @type {Howl|null} Active engine loop */
let _engineHowl   = null;
let _engineSoundId = null;
let _activeProfile = null;

/** @type {Howl|null} UI sprite sheet */
let _uiHowl = null;

/** @type {{ current: Howl|null, next: Howl|null }} Music crossfade state */
const _music = { current: null, next: null, context: null };

/** @type {Map<string, Howl>} Loaded world sounds */
const _worldHowls = new Map();

/** Whether the audio context has been unlocked by a user gesture */
let _unlocked = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────

/**
 * Initialise the audio system and preload the UI sprite sheet.
 * Engine loops and music load on-demand to keep startup time fast.
 *
 * @returns {Promise<void>}
 */
export async function initAudio() {
  // Apply master volume
  Howler.volume(_vol.master);

  // Preload UI sprite — it's small and needed immediately
  await _loadUISprite();

  // Preload world ambient — plays as soon as game world is ready
  _loadWorldSounds();

  // Unlock audio context on first user gesture (browser autoplay policy)
  document.addEventListener('pointerdown', _unlockAudio, { once: true });
  document.addEventListener('keydown',     _unlockAudio, { once: true });

  console.log('[audio] ✅ Initialised — Howler v' + Howler.version ?? '2.x');
}

function _unlockAudio() {
  if (_unlocked) return;
  _unlocked = true;
  // Howler.ctx?.resume() handles Web Audio context unlock automatically,
  // but we also resume manually for older browsers
  Howler.ctx?.resume?.();
}

// ─── UI SPRITE LOADER ────────────────────────────────────────────────────────

function _loadUISprite() {
  return new Promise((resolve) => {
    _uiHowl = new Howl({
      src:    ['assets/audio/ui/ui_sprites.ogg', 'assets/audio/ui/ui_sprites.mp3'],
      sprite: UI_SPRITE_MAP,
      volume: _vol.sfx,
      preload: true,
      onload:  resolve,
      onloaderror: (_, err) => {
        console.warn('[audio] UI sprite failed to load:', err);
        resolve(); // non-fatal — game runs without sound
      },
    });
  });
}

// ─── WORLD SOUND LOADER ──────────────────────────────────────────────────────

function _loadWorldSounds() {
  for (const [name, def] of Object.entries(WORLD_SOUNDS)) {
    const howl = new Howl({
      src:    def.src,
      loop:   def.loop ?? false,
      volume: (def.volume ?? 1.0) * _vol.sfx * _vol.ambient,
      preload: true,
      onloaderror: () => console.warn('[audio] World sound failed:', name),
    });
    _worldHowls.set(name, howl);
  }
}

// ─── ENGINE AUDIO ─────────────────────────────────────────────────────────────

/**
 * Load and start the engine loop for a given car engine category.
 * Call this when the player gets into a car.
 *
 * @param {'inline4'|'v6'|'v8'|'v10'|'v12'|'electric'} category
 */
export function loadEngineSound(category) {
  const profile = ENGINE_PROFILES[category] ?? ENGINE_PROFILES.inline4;
  if (_activeProfile === category) return; // already loaded

  // Stop and unload previous engine
  _engineHowl?.stop();
  _engineHowl?.unload();

  _activeProfile = category;

  _engineHowl = new Howl({
    src:    profile.src,
    loop:   true,
    volume: _vol.engine,
    rate:   0.5, // start at idle rate
    preload: true,
    onload: () => {
      _engineSoundId = _engineHowl.play();
    },
    onloaderror: (_, err) => {
      console.warn('[audio] Engine sound failed to load:', category, err);
    },
  });
}

/**
 * Update engine pitch and volume based on current RPM and throttle input.
 * Call this every frame from driving.js.
 *
 * @param {number} rpm       Current engine RPM (e.g. 800 – 8000)
 * @param {number} throttle  0–1 throttle input (used to duck volume when off-throttle)
 */
export function playEngine(rpm, throttle = 1) {
  if (!_engineHowl || _engineSoundId === null) return;
  if (!_engineHowl.playing(_engineSoundId)) {
    _engineSoundId = _engineHowl.play();
  }

  const profile = ENGINE_PROFILES[_activeProfile] ?? ENGINE_PROFILES.inline4;
  const rate = _rpmToRate(rpm, profile.idleRPM, profile.redline);

  // Volume: full at throttle, ducked slightly at coast
  const vol = (_vol.engine * (0.6 + throttle * 0.4)) * _vol.master;

  _engineHowl.rate(rate,   _engineSoundId);
  _engineHowl.volume(vol,  _engineSoundId);
}

/**
 * Map RPM to a Howler playback rate using a mild exponential curve.
 * Linear sounds flat — the curve makes mid-range feel punchier.
 *
 * @param {number} rpm
 * @param {number} idleRPM
 * @param {number} redline
 * @returns {number} rate 0.4–2.0
 */
function _rpmToRate(rpm, idleRPM, redline) {
  const clamped = Math.max(idleRPM, Math.min(redline, rpm));
  const t = (clamped - idleRPM) / (redline - idleRPM); // 0–1
  // Exponential curve: eases in at idle, snappy at redline
  const curved = Math.pow(t, 0.75);
  return 0.4 + curved * 1.6; // maps to 0.4–2.0
}

/**
 * Stop the engine sound (player exits car).
 * Fades out over 300ms to avoid a hard cut.
 */
export function stopEngine() {
  if (!_engineHowl || _engineSoundId === null) return;
  _engineHowl.fade(_engineHowl.volume(_engineSoundId), 0, 300, _engineSoundId);
  setTimeout(() => {
    _engineHowl?.stop(_engineSoundId);
    _engineSoundId = null;
  }, 310);
}

// ─── TURBO WHINE ─────────────────────────────────────────────────────────────

/**
 * Update turbo/supercharger whine volume.
 * Call from driving.js — turbo has its own layered loop over the engine.
 *
 * @param {number} boost  0–1 boost pressure (from turbo model in transmission.js)
 */
export function setTurboWhine(boost) {
  const howl = _worldHowls.get('turboWhine');
  if (!howl) return;
  const targetVol = boost * 0.6 * _vol.sfx;
  if (boost > 0.05 && !howl.playing()) howl.play();
  howl.volume(targetVol);
}

// ─── TIRE / SURFACE SOUNDS ───────────────────────────────────────────────────

/**
 * Update tire squeal volume based on lateral slip angle.
 * Call every frame from driving.js.
 *
 * @param {number} slipNorm  0–1 normalised slip (0=no squeal, 1=full screech)
 */
export function setTireSqueal(slipNorm) {
  const howl = _worldHowls.get('tireSqueal');
  if (!howl) return;
  const vol = Math.max(0, slipNorm - 0.1) * _vol.sfx;
  if (vol > 0.01 && !howl.playing()) howl.play();
  howl.volume(vol * _vol.master);
  if (vol < 0.01 && howl.playing()) howl.stop();
}

/**
 * Update gravel/dirt surface sound.
 * @param {number} intensity  0–1 (0 = on tarmac, 1 = deep offroad)
 */
export function setGravelSound(intensity) {
  const howl = _worldHowls.get('gravel');
  if (!howl) return;
  const vol = intensity * 0.7 * _vol.sfx;
  if (vol > 0.01 && !howl.playing()) howl.play();
  howl.volume(vol * _vol.master);
  if (vol < 0.01 && howl.playing()) howl.stop();
}

// ─── COLLISION SOUNDS ────────────────────────────────────────────────────────

/**
 * Play an impact sound scaled by collision severity.
 * @param {number} severity  0–1 (0.0–0.3 = light scrape, 0.3+ = heavy impact)
 */
export function playImpact(severity) {
  const name = severity > 0.3 ? 'impactHeavy' : 'impactLight';
  const howl = _worldHowls.get(name);
  if (!howl) return;
  const vol = (0.4 + severity * 0.6) * _vol.sfx * _vol.master;
  howl.volume(vol);
  howl.play();
}

// ─── FOOTSTEPS ───────────────────────────────────────────────────────────────

/** Play a single footstep (call on each footfall event from movement.js) */
export function playFootstep() {
  const howl = _worldHowls.get('footstep');
  if (!howl) return;
  howl.volume(0.35 * _vol.sfx * _vol.master);
  howl.play();
}

// ─── AMBIENT CITY ─────────────────────────────────────────────────────────────

/**
 * Start the ambient city sound loop.
 * Called by city.js once the world is loaded.
 */
export function startAmbient() {
  const howl = _worldHowls.get('ambientCity');
  if (howl && !howl.playing()) {
    howl.volume(_vol.ambient * _vol.master);
    howl.play();
  }
}

export function stopAmbient() {
  const howl = _worldHowls.get('ambientCity');
  howl?.fade(howl.volume(), 0, 500);
  setTimeout(() => howl?.stop(), 510);
}

// ─── UI SOUNDS ────────────────────────────────────────────────────────────────

/**
 * Play a named UI sound from the sprite sheet.
 * Non-blocking — returns immediately.
 *
 * @param {keyof typeof UI_SPRITE_MAP} name
 * @param {number} [volumeOverride]  0–1, uses sfx channel if omitted
 */
export function playUI(name, volumeOverride) {
  if (!_uiHowl) return;
  if (!UI_SPRITE_MAP[name]) {
    console.warn('[audio] Unknown UI sound:', name);
    return;
  }
  const id = _uiHowl.play(name);
  const vol = (volumeOverride ?? 1.0) * _vol.sfx * _vol.master;
  _uiHowl.volume(vol, id);
}

// ─── MUSIC ────────────────────────────────────────────────────────────────────

/**
 * Switch to a named music context with a crossfade.
 * Calling with the same context that's already playing does nothing.
 *
 * @param {keyof typeof MUSIC_TRACKS} context  e.g. 'driving', 'race', 'menu'
 * @param {number} [fadeMs]  Crossfade duration in ms (default 1500)
 */
export function playMusic(context, fadeMs = 1500) {
  if (context === _music.context) return;
  if (!MUSIC_TRACKS[context] && context !== 'none') {
    console.warn('[audio] Unknown music context:', context);
    return;
  }

  _music.context = context;

  // Fade out current track
  if (_music.current && _music.current.playing()) {
    const outHowl = _music.current;
    outHowl.fade(outHowl.volume(), 0, fadeMs);
    setTimeout(() => { outHowl.stop(); outHowl.unload(); }, fadeMs + 100);
  }

  if (context === 'none' || !MUSIC_TRACKS[context]) {
    _music.current = null;
    return;
  }

  // Pick tracks for this context (pair ogg+mp3)
  const tracks = MUSIC_TRACKS[context];
  const src = _pickTrackSrc(tracks);

  const targetVol = _vol.music * _vol.master;

  const newHowl = new Howl({
    src,
    loop:   !['wheelspin', 'levelUp', 'results'].includes(context),
    volume: 0, // start silent — fade in
    onloaderror: () => console.warn('[audio] Music failed to load:', context),
    onend: () => {
      // For one-shot stings (wheelspin, levelUp), return to previous context
      if (['wheelspin', 'levelUp'].includes(context)) {
        playMusic('driving');
      }
    },
  });

  _music.current = newHowl;
  const id = newHowl.play();
  newHowl.fade(0, targetVol, fadeMs, id);
}

/**
 * Pick the right src pair ([ogg, mp3]) from a flat track array.
 * MUSIC_TRACKS stores flat [ogg1, mp3_1, ogg2, mp3_2, ...] arrays.
 * When multiple tracks exist, picks a random pair.
 */
function _pickTrackSrc(flatArray) {
  // Pair up: [ogg, mp3] per track
  const pairs = [];
  for (let i = 0; i < flatArray.length; i += 2) {
    pairs.push([flatArray[i], flatArray[i + 1]]);
  }
  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  return pair;
}

/**
 * Temporarily duck music volume (e.g. during announcer speech or cutscene).
 * @param {number} targetVol  0–1
 * @param {number} fadeMs
 */
export function duckMusic(targetVol = 0.2, fadeMs = 300) {
  if (!_music.current) return;
  _music.current.fade(_music.current.volume(), targetVol * _vol.music * _vol.master, fadeMs);
}

/**
 * Restore music volume after duck.
 * @param {number} fadeMs
 */
export function unduckMusic(fadeMs = 500) {
  if (!_music.current) return;
  _music.current.fade(
    _music.current.volume(),
    _vol.music * _vol.master,
    fadeMs
  );
}

// ─── VOLUME CONTROLS ─────────────────────────────────────────────────────────

/**
 * Set master volume. All channels are relative to this.
 * @param {number} v  0–1
 */
export function setMasterVol(v) {
  _vol.master = Math.max(0, Math.min(1, v));
  Howler.volume(_vol.master);
}

/** @param {number} v  0–1 */
export function setMusicVol(v) {
  _vol.music = Math.max(0, Math.min(1, v));
  if (_music.current) _music.current.volume(_vol.music * _vol.master);
}

/** @param {number} v  0–1 */
export function setSFXVol(v) {
  _vol.sfx = Math.max(0, Math.min(1, v));
  if (_uiHowl) _uiHowl.volume(_vol.sfx);
}

/** @param {number} v  0–1 */
export function setEngineVol(v) {
  _vol.engine = Math.max(0, Math.min(1, v));
}

/** @param {number} v  0–1 */
export function setAmbientVol(v) {
  _vol.ambient = Math.max(0, Math.min(1, v));
  const ambHowl = _worldHowls.get('ambientCity');
  if (ambHowl) ambHowl.volume(_vol.ambient * _vol.master);
}

/** Toggle global mute without losing volume settings. */
export function toggleMute() {
  Howler.mute(!Howler._muted);
}

/**
 * Return current volume levels (for SettingsMenu to read on open).
 * @returns {{ master:number, music:number, sfx:number, engine:number, ambient:number }}
 */
export function getVolumeLevels() {
  return { ..._vol };
}

// ─── CONVENIENCE OBJECT ──────────────────────────────────────────────────────
/**
 * `audioManager` — a single named export grouping all audio methods.
 * Import and destructure, or use as audioManager.playUI('click') etc.
 */
export const audioManager = Object.freeze({
  // Init
  init: initAudio,

  // Engine
  loadEngineSound,
  playEngine,
  stopEngine,
  setTurboWhine,

  // Tires / surface
  setTireSqueal,
  setGravelSound,

  // World
  playImpact,
  playFootstep,
  startAmbient,
  stopAmbient,

  // UI
  playUI,

  // Music
  playMusic,
  duckMusic,
  unduckMusic,

  // Volume
  setMasterVol,
  setMusicVol,
  setSFXVol,
  setEngineVol,
  setAmbientVol,
  toggleMute,
  getVolumeLevels,
});

/**
 * SurfaceAudio.js — Part 12: Surface Audio
 * ─────────────────────────────────────────────────────────────────────────────
 * FH5 Setting: (audio system — orthogonal to graphics)
 * Visual/Immersion Impact: 80%  |  FPS Cost: 0%  |  Difficulty: Easy
 *
 * WHAT THIS DOES
 * ──────────────
 *  - Six distinct surface loops: tarmac road roar, cobblestone rhythmic
 *    clatter, sand hiss, dirt/gravel crunch, volcanic heavy thud, mud slop.
 *  - Smooth crossfade between surfaces (250 ms fade-out → 250 ms fade-in)
 *    using Howler's `fade()` — no abrupt cuts when crossing biome borders.
 *  - Speed-reactive volume: silent at standstill, full at 80 km/h.
 *  - Stereo tyre panning: left-tyre pair pans slightly left (–0.3),
 *    right-tyre pair pans slightly right (+0.3). Combines into a wide,
 *    immersive soundstage when both sides play together.
 *  - Random gravel-ping one-shots on baja / caldera / volcanic surfaces —
 *    stones pinging off the bodywork at 0.4–1.5 s random intervals, scaled
 *    by speed.
 *  - Wet tarmac layer: a faint water-spray loop crossfades on top of the
 *    tarmac loop when the surface is wet_tarmac or when rain > 40%.
 *  - All loops are procedurally generated via OfflineAudioContext when no
 *    real asset files are present — the system is fully self-contained.
 *    Drop real OGG files into assets/audio/world/ and they will be used
 *    automatically on next page load.
 *
 * SURFACE TYPE MAP (matches driving.js → drivingController.surfaceType)
 * ──────────────────────────────────────────────────────────────────────
 *  'smooth_tarmac'  → tarmac road roar
 *  'tarmac'         → alias for smooth_tarmac
 *  'wet_tarmac'     → tarmac + wet spray layer
 *  'cobblestone'    → rhythmic cobble clatter
 *  'sand'           → soft sand hiss  (dunas biome)
 *  'dirt'           → loose gravel crunch
 *  'gravel'         → alias for dirt
 *  'volcanic_dirt'  → heavy volcanic thud  (caldera biome)
 *  'mud'            → thick wet mud slop  (farmland/jungle)
 *  'wet_grass'      → damp grass swish  (farmland)
 *  'grass'          → alias for wet_grass
 *
 * INTEGRATION
 * ───────────
 *  1. initSurfaceAudio()               — call once after audio context exists
 *  2. updateSurfaceAudio(opts, dt)     — call every UPDATE tick from main.js
 *
 *     opts: {
 *       surfaceType: string,   // from drivingController.surfaceType
 *       speedKmh:   number,   // from playerCar.speedKmh
 *       steerNorm:  number,   // –1…+1 (from inputState.steer) — for pan
 *       isRain:     boolean,  // from getWeather().isRain
 *       rainBlend:  number,   // 0–1  (from getWeather().blend)
 *     }
 *
 * EXPORTS
 * ───────
 *  initSurfaceAudio()
 *  updateSurfaceAudio(opts, dt)
 */

'use strict';

import { Howl, Howler } from 'howler';

// ─── Surface definitions ─────────────────────────────────────────────────────

/**
 * SURFACE_SOUNDS maps every surface type name to an audio descriptor.
 * `src`    — preferred asset files (OGG first, MP3 fallback).
 *             If the browser cannot load any src, the system falls back
 *             to the procedural synthesised buffer.
 * `gain`   — base volume at full speed (80 km/h+).
 * `loop`   — always true for surface loops.
 * `proc`   — procedural synth descriptor used when assets are absent.
 */
const SURFACE_SOUNDS = Object.freeze({
  smooth_tarmac: {
    src:  ['assets/audio/world/tarmac_loop.ogg', 'assets/audio/world/tarmac_loop.mp3'],
    gain: 1.0,
    proc: { type: 'tarmac' },
  },
  cobblestone: {
    src:  ['assets/audio/world/cobble_loop.ogg', 'assets/audio/world/cobble_loop.mp3'],
    gain: 0.9,
    proc: { type: 'cobble' },
  },
  sand: {
    src:  ['assets/audio/world/sand_loop.ogg', 'assets/audio/world/sand_loop.mp3'],
    gain: 0.7,
    proc: { type: 'sand' },
  },
  dirt: {
    src:  ['assets/audio/world/gravel_loop.ogg', 'assets/audio/world/gravel_loop.mp3'],
    gain: 1.0,
    proc: { type: 'gravel' },
  },
  volcanic_dirt: {
    src:  ['assets/audio/world/volcanic_loop.ogg', 'assets/audio/world/volcanic_loop.mp3'],
    gain: 1.1,
    proc: { type: 'volcanic' },
  },
  mud: {
    src:  ['assets/audio/world/mud_loop.ogg', 'assets/audio/world/mud_loop.mp3'],
    gain: 0.85,
    proc: { type: 'mud' },
  },
  wet_grass: {
    src:  ['assets/audio/world/grass_loop.ogg', 'assets/audio/world/grass_loop.mp3'],
    gain: 0.6,
    proc: { type: 'grass' },
  },
  // Wet tarmac spray overlay (layered on top of tarmac loop)
  wet_spray: {
    src:  ['assets/audio/world/wet_spray_loop.ogg', 'assets/audio/world/wet_spray_loop.mp3'],
    gain: 0.55,
    proc: { type: 'spray' },
  },
});

/** Surface type aliases → canonical name */
const SURFACE_ALIAS = Object.freeze({
  tarmac:     'smooth_tarmac',
  gravel:     'dirt',
  grass:      'wet_grass',
  wet_tarmac: 'smooth_tarmac',   // base loop stays tarmac; wet_spray layer activates separately
  baja:       'dirt',
  farm:       'wet_grass',
});

/** Surfaces that trigger random gravel-ping one-shots */
const PING_SURFACES = new Set(['dirt', 'volcanic_dirt', 'sand', 'cobblestone']);

// ─── State ───────────────────────────────────────────────────────────────────

let _ready = false;

/** Currently playing Howl + its Howler sound ID for the main surface loop */
let _activeHowl = null;
let _activeId   = null;
let _activeName = null;

/** Wet spray overlay */
let _sprayHowl = null;
let _sprayId   = null;

/** Map of canonical surface name → { howl, id } lazy-loaded instances */
const _howls = new Map();

/** Gravel ping one-shots */
let _pingHowl      = null;
let _pingTimer     = 0;
let _pingInterval  = 0.8;   // seconds until next ping (randomised)

/** Smooth volume target — updated each frame, applied lazily */
let _volumeTarget = 0;

// ─── Procedural audio synthesis ──────────────────────────────────────────────

/**
 * Generate a loopable AudioBuffer for a surface type using OfflineAudioContext.
 * Returns a Promise<AudioBuffer> (2 seconds, stereo, 44.1 kHz).
 */
async function _synthesise(procDesc) {
  const SR  = 44100;
  const DUR = 2.0;        // loop duration (seconds)
  const ctx = new OfflineAudioContext(2, SR * DUR, SR);

  const buf    = ctx.createBuffer(2, SR * DUR, SR);
  const left   = buf.getChannelData(0);
  const right  = buf.getChannelData(1);

  switch (procDesc.type) {

    case 'tarmac': {
      // Low-frequency road roar — bandpass-filtered white noise at ~200 Hz
      for (let i = 0; i < left.length; i++) {
        const n = (Math.random() * 2 - 1) * 0.12;
        left[i]  = n;
        right[i] = (Math.random() * 2 - 1) * 0.12;
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      const bp   = ctx.createBiquadFilter();
      bp.type            = 'bandpass';
      bp.frequency.value = 220;
      bp.Q.value         = 0.6;
      const lp = ctx.createBiquadFilter();
      lp.type            = 'lowpass';
      lp.frequency.value = 500;
      src.connect(bp); bp.connect(lp); lp.connect(ctx.destination);
      src.start(0);
      break;
    }

    case 'cobble': {
      // Rhythmic thumping — impulse every ~80 ms with pitch variance
      const stride = Math.round(SR * 0.082);
      for (let i = 0; i < left.length; i += stride) {
        const amp    = 0.25 + Math.random() * 0.18;
        const decay  = 0.008 + Math.random() * 0.006;
        for (let s = 0; s < Math.min(stride, left.length - i); s++) {
          const t = s / SR;
          const v = amp * Math.exp(-t / decay) * (Math.random() * 2 - 1);
          left[i + s]  += v;
          right[i + s] += v * (0.85 + Math.random() * 0.3);
        }
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      const hp   = ctx.createBiquadFilter();
      hp.type            = 'highpass';
      hp.frequency.value = 120;
      src.connect(hp); hp.connect(ctx.destination);
      src.start(0);
      break;
    }

    case 'sand': {
      // High-frequency hiss — highpass-filtered noise
      for (let i = 0; i < left.length; i++) {
        left[i]  = (Math.random() * 2 - 1) * 0.08;
        right[i] = (Math.random() * 2 - 1) * 0.08;
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      const hp   = ctx.createBiquadFilter();
      hp.type            = 'highpass';
      hp.frequency.value = 2800;
      hp.Q.value         = 0.5;
      src.connect(hp); hp.connect(ctx.destination);
      src.start(0);
      break;
    }

    case 'gravel': {
      // Dense loose crunch — broadband noise with mid-frequency peak
      for (let i = 0; i < left.length; i++) {
        left[i]  = (Math.random() * 2 - 1) * 0.22;
        right[i] = (Math.random() * 2 - 1) * 0.22;
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      const bp   = ctx.createBiquadFilter();
      bp.type            = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value         = 0.4;
      src.connect(bp); bp.connect(ctx.destination);
      src.start(0);
      break;
    }

    case 'volcanic': {
      // Heavy low thud with gritty crunch — layered low+mid noise
      for (let i = 0; i < left.length; i++) {
        left[i]  = (Math.random() * 2 - 1) * 0.28;
        right[i] = (Math.random() * 2 - 1) * 0.28;
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      const lp   = ctx.createBiquadFilter();
      lp.type            = 'lowpass';
      lp.frequency.value = 380;
      const gain = ctx.createGain();
      gain.gain.value    = 1.4;
      src.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
      src.start(0);
      break;
    }

    case 'mud': {
      // Wet sloshing — low+mid bandpass noise with slight flutter
      for (let i = 0; i < left.length; i++) {
        const phase = Math.sin(i * 0.0003) * 0.3 + 0.7;
        left[i]  = (Math.random() * 2 - 1) * 0.2 * phase;
        right[i] = (Math.random() * 2 - 1) * 0.2 * phase;
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      const bp   = ctx.createBiquadFilter();
      bp.type            = 'bandpass';
      bp.frequency.value = 450;
      bp.Q.value         = 0.55;
      src.connect(bp); bp.connect(ctx.destination);
      src.start(0);
      break;
    }

    case 'grass': {
      // Light swishing — mid-high filtered noise, quiet
      for (let i = 0; i < left.length; i++) {
        left[i]  = (Math.random() * 2 - 1) * 0.1;
        right[i] = (Math.random() * 2 - 1) * 0.1;
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      const bp   = ctx.createBiquadFilter();
      bp.type            = 'bandpass';
      bp.frequency.value = 1600;
      bp.Q.value         = 0.5;
      src.connect(bp); bp.connect(ctx.destination);
      src.start(0);
      break;
    }

    case 'spray': {
      // Fine water spray — broadband high-pass, very quiet
      for (let i = 0; i < left.length; i++) {
        left[i]  = (Math.random() * 2 - 1) * 0.07;
        right[i] = (Math.random() * 2 - 1) * 0.07;
      }
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      const hp   = ctx.createBiquadFilter();
      hp.type            = 'highpass';
      hp.frequency.value = 3500;
      src.connect(hp); hp.connect(ctx.destination);
      src.start(0);
      break;
    }

    default: {
      // Fallback: plain bandpass noise
      for (let i = 0; i < left.length; i++) {
        left[i]  = (Math.random() * 2 - 1) * 0.15;
        right[i] = (Math.random() * 2 - 1) * 0.15;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    }
  }

  const rendered = await ctx.startRendering();
  return rendered;
}

/**
 * Build a data-URI blob URL from a rendered AudioBuffer so Howler can load it.
 * Encodes as 16-bit PCM WAV.
 */
function _bufferToUrl(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const length      = audioBuffer.length;
  const sampleRate  = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign  = numChannels * bytesPerSample;
  const byteRate    = sampleRate * blockAlign;
  const dataSize    = length * blockAlign;
  const bufSize     = 44 + dataSize;

  const arrayBuf = new ArrayBuffer(bufSize);
  const view     = new DataView(arrayBuf);

  // RIFF WAV header
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0,  'RIFF');
  view.setUint32(4,  36 + dataSize, true);
  str(8,  'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);           // chunk size
  view.setUint16(20, 1,  true);           // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);           // bits per sample
  str(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let s = 0; s < length; s++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[s]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  const blob = new Blob([arrayBuf], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Create (or reuse) a Howl for the given canonical surface name.
 * Tries real assets first; falls back to procedural synthesis.
 */
async function _getHowl(name) {
  if (_howls.has(name)) return _howls.get(name);

  const def = SURFACE_SOUNDS[name];
  if (!def) return null;

  return new Promise((resolve) => {
    const howl = new Howl({
      src:    def.src,
      loop:   true,
      volume: 0,    // starts silent — crossfade brings it in
      html5:  false,
      onloaderror: async () => {
        // Asset not found — synthesise procedurally
        try {
          const audioBuffer = await _synthesise(def.proc);
          const url = _bufferToUrl(audioBuffer);
          const fallback = new Howl({
            src:    [url],
            format: ['wav'],
            loop:   true,
            volume: 0,
            html5:  false,
            onload: () => resolve(fallback),
            onloaderror: () => {
              console.warn('[SurfaceAudio] Synthesis fallback also failed for:', name);
              resolve(null);
            },
          });
          _howls.set(name, fallback);
        } catch (err) {
          console.warn('[SurfaceAudio] Synthesis error for', name, err);
          resolve(null);
        }
      },
      onload: () => resolve(howl),
    });
    _howls.set(name, howl);
  });
}

/**
 * Build a one-shot ping Howl for gravel stones hitting bodywork.
 * Procedurally synthesises a short 60 ms impact transient.
 */
async function _buildPingHowl() {
  const SR  = 44100;
  const DUR = 0.06;
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * DUR), SR);
  const buf = ctx.createBuffer(1, Math.ceil(SR * DUR), SR);
  const ch  = buf.getChannelData(0);
  // Short broadband click decaying to silence
  for (let i = 0; i < ch.length; i++) {
    const t    = i / SR;
    ch[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.008) * 0.9;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1200;
  src.connect(hp);
  hp.connect(ctx.destination);
  src.start(0);

  const rendered = await ctx.startRendering();
  const url = _bufferToUrl(rendered);

  return new Howl({
    src:    [url],
    format: ['wav'],
    loop:   false,
    volume: 0.4,
    html5:  false,
    onloaderror: () => null,   // silent fail
  });
}

// ─── Crossfade helpers ───────────────────────────────────────────────────────

const FADE_MS = 250;   // half-crossfade duration in ms

/** Fade out the currently active surface loop and clear references. */
function _fadeOutActive() {
  if (!_activeHowl || _activeId === null) return;
  const h  = _activeHowl;
  const id = _activeId;
  h.fade(h.volume(id), 0, FADE_MS, id);
  setTimeout(() => {
    if (h.playing(id)) h.stop(id);
  }, FADE_MS + 50);
  _activeHowl = null;
  _activeId   = null;
  _activeName = null;
}

/** Fade in a new surface loop to the current target volume. */
function _fadeInHowl(howl, targetVol) {
  const id = howl.play();
  howl.volume(0, id);
  howl.fade(0, targetVol, FADE_MS, id);
  return id;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * initSurfaceAudio()
 *
 * Preloads the tarmac loop (most common surface) immediately.
 * Other surfaces load on first encounter to keep startup lean.
 * Call once after the audio context has been created (after audioManager.init()).
 */
export async function initSurfaceAudio() {
  if (_ready) return;
  _ready = true;

  // Preload tarmac and ping; everything else deferred
  await _getHowl('smooth_tarmac');
  _pingHowl = await _buildPingHowl();
  _pingInterval = 0.6 + Math.random() * 0.8;

  console.log('[SurfaceAudio] ✅ Initialised — tarmac loop + ping loaded');
}

/**
 * updateSurfaceAudio(opts, dt)
 *
 * Call every UPDATE tick from main.js after drivingController.update().
 *
 * @param {{
 *   surfaceType: string,
 *   speedKmh:   number,
 *   steerNorm:  number,
 *   isRain:     boolean,
 *   rainBlend:  number,
 * }} opts
 * @param {number} dt   Delta time in seconds
 */
export async function updateSurfaceAudio(opts, dt) {
  if (!_ready) return;

  const {
    surfaceType = 'tarmac',
    speedKmh    = 0,
    steerNorm   = 0,
    isRain      = false,
    rainBlend   = 0,
  } = opts;

  // ── Resolve canonical surface name ────────────────────────────────────────
  const canonical = SURFACE_ALIAS[surfaceType] ?? surfaceType;
  const def       = SURFACE_SOUNDS[canonical];
  if (!def) return;

  // ── Speed-based master volume ─────────────────────────────────────────────
  // Volume ramps from 0 at standstill to def.gain at 80 km/h, then holds.
  const speedFactor  = Math.min(speedKmh / 80, 1.0);
  const targetVol    = speedFactor * def.gain * (Howler.volume?.() ?? 1.0) * 0.8;

  // ── Surface crossfade ─────────────────────────────────────────────────────
  if (canonical !== _activeName) {
    // Start fading out old loop
    _fadeOutActive();

    // Load and fade in new loop
    const howl = await _getHowl(canonical);
    if (!howl) return;

    // 250 ms gap between fade-out start and fade-in start for a clean crossfade
    setTimeout(async () => {
      const id = _fadeInHowl(howl, targetVol);
      _activeHowl = howl;
      _activeId   = id;
      _activeName = canonical;
    }, FADE_MS);

    return;   // volume will be set correctly when fade-in fires
  }

  // ── Live volume update (speed changed, same surface) ──────────────────────
  if (_activeHowl && _activeId !== null) {
    // Smooth out volume changes frame-to-frame using a light lerp
    const current = _activeHowl.volume(_activeId);
    const next    = current + (targetVol - current) * Math.min(dt * 6, 1);
    _activeHowl.volume(next, _activeId);

    // ── Stereo tyre panning ──────────────────────────────────────────────
    // Pan subtly toward the direction the car is turning so L/R tyres
    // feel spatially distinct.  Howler's stereo() maps –1 (hard left) to
    // +1 (hard right).  We limit to ±0.35 so it doesn't feel unnatural.
    const pan = Math.max(-0.35, Math.min(0.35, steerNorm * 0.35));
    _activeHowl.stereo(pan, _activeId);
  }

  // ── Wet spray overlay ─────────────────────────────────────────────────────
  const wantSpray = (surfaceType === 'wet_tarmac') || (isRain && rainBlend > 0.4);
  const sprayVol  = wantSpray
    ? speedFactor * SURFACE_SOUNDS.wet_spray.gain * (rainBlend > 0 ? rainBlend : 1)
    : 0;

  if (sprayVol > 0.01) {
    if (!_sprayHowl) {
      const h = await _getHowl('wet_spray');
      if (h) {
        _sprayHowl = h;
        _sprayId   = h.play();
        h.volume(0, _sprayId);
      }
    }
    if (_sprayHowl && _sprayId !== null) {
      const cur  = _sprayHowl.volume(_sprayId);
      const next = cur + (sprayVol - cur) * Math.min(dt * 4, 1);
      _sprayHowl.volume(next, _sprayId);
      if (!_sprayHowl.playing(_sprayId)) {
        _sprayId = _sprayHowl.play();
        _sprayHowl.volume(sprayVol, _sprayId);
      }
    }
  } else if (_sprayHowl && _sprayId !== null) {
    const cur = _sprayHowl.volume(_sprayId);
    if (cur > 0.005) {
      const next = cur + (0 - cur) * Math.min(dt * 4, 1);
      _sprayHowl.volume(next, _sprayId);
    } else {
      _sprayHowl.stop(_sprayId);
      _sprayId = null;
    }
  }

  // ── Gravel pings (stones hitting bodywork) ────────────────────────────────
  if (PING_SURFACES.has(canonical) && speedKmh > 15 && _pingHowl) {
    _pingTimer -= dt;
    if (_pingTimer <= 0) {
      // Volume scales with speed; random pitch variation makes each ping unique
      const pingVol = Math.min(speedKmh / 120, 1) * (0.2 + Math.random() * 0.35);
      const id = _pingHowl.play();
      _pingHowl.volume(pingVol, id);
      // Random pitch: 0.8–1.4× — higher pitch = smaller stone
      _pingHowl.rate(0.8 + Math.random() * 0.6, id);
      // Random stereo position — stones can hit either side
      _pingHowl.stereo((Math.random() * 2 - 1) * 0.8, id);

      // Schedule next ping — faster at higher speeds, more stones at faster pace
      const baseInterval  = 1.5 - Math.min(speedKmh / 100, 0.9);  // 0.6–1.5 s
      _pingInterval = baseInterval * (0.4 + Math.random() * 0.8);
      _pingTimer    = _pingInterval;
    }
  } else {
    // Reset timer when off ping-surfaces so first ping isn't delayed
    if (!PING_SURFACES.has(canonical)) _pingTimer = 0;
  }
}

/**
 * stopSurfaceAudio()
 *
 * Cleanly fade out all surface loops — call on game pause or exit.
 */
export function stopSurfaceAudio() {
  _fadeOutActive();
  if (_sprayHowl && _sprayId !== null) {
    _sprayHowl.fade(_sprayHowl.volume(_sprayId), 0, FADE_MS, _sprayId);
    setTimeout(() => _sprayHowl?.stop(_sprayId), FADE_MS + 50);
    _sprayId = null;
  }
}

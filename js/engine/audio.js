/**
 * audio.js — Part 7 revision
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised audio manager built on Howler.js, with Web Audio API gain nodes
 * for real-time engine pitch control, continuous tyre-squeal volume scaled by
 * lateral slip, and a rain ambient layer that crossfades in with weather.
 *
 * ── PART 7 ADDITIONS ────────────────────────────────────────────────────────
 *  1. updateAudio(dt, opts)
 *       Single unified per-frame call from main.js. Drives:
 *         • Engine RPM pitch   (Howler rate + smoothed lerp)
 *         • Tyre squeal volume (continuous 0–1 from lateral slip magnitude)
 *         • Turbo whine        (from boost level)
 *         • Rain ambient loop  (crossfades in when rainBlend > 0)
 *
 *  2. Rain ambient layer
 *       Procedurally synthesised rain loop via OfflineAudioContext.
 *       No external asset required — fully self-contained.
 *       Crossfades from 0→full over ~3 s when rainBlend increases.
 *
 *  3. Smooth tyre squeal
 *       setTireSqueal() now accepts a continuous 0–1 value.
 *       updateAudio() derives squealNorm from (slipMag - 2.5) / 3.5.
 *       Pitch also scales with slip for a chirp-to-screech character arc.
 *
 *  4. Audio adapter for DrivingController
 *       getAudioAdapter() returns a duck-typed { play, stop, setParam }
 *       object that driving.js already calls via this._audio.
 *       Pass it to new DrivingController(car, { ..., audioManager: audioManager.getAudioAdapter() })
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Howl, Howler } from 'howler';

// ─── VOLUME CHANNELS ─────────────────────────────────────────────────────────

const _vol = {
  master:  1.0,
  music:   0.55,
  sfx:     0.85,
  engine:  0.80,
  ambient: 0.40,
};

// ─── ENGINE SOUND PROFILES ───────────────────────────────────────────────────

const ENGINE_PROFILES = Object.freeze({
  inline4: { src: ['assets/audio/engines/inline4_loop.ogg', 'assets/audio/engines/inline4_loop.mp3'], idleRPM: 800,  redline: 7500 },
  inline6: { src: ['assets/audio/engines/inline6_loop.ogg', 'assets/audio/engines/inline6_loop.mp3'], idleRPM: 700,  redline: 7000 },
  v6:      { src: ['assets/audio/engines/v6_loop.ogg',      'assets/audio/engines/v6_loop.mp3'],      idleRPM: 750,  redline: 7200 },
  v8:      { src: ['assets/audio/engines/v8_loop.ogg',      'assets/audio/engines/v8_loop.mp3'],      idleRPM: 650,  redline: 6500 },
  v10:     { src: ['assets/audio/engines/v10_loop.ogg',     'assets/audio/engines/v10_loop.mp3'],     idleRPM: 700,  redline: 8500 },
  v12:     { src: ['assets/audio/engines/v12_loop.ogg',     'assets/audio/engines/v12_loop.mp3'],     idleRPM: 600,  redline: 8000 },
  electric:{ src: ['assets/audio/engines/electric_loop.ogg','assets/audio/engines/electric_loop.mp3'],idleRPM: 0,    redline: 20000 },
});

// ─── UI SOUND SPRITE ─────────────────────────────────────────────────────────

const UI_SPRITE_MAP = Object.freeze({
  click:         [0,     120],  hover:         [200,    80],  confirm:       [400,   350],
  back:          [850,   200],  error:         [1150,  300],  notification:  [1550,  400],
  levelUp:       [2050, 1800],  wheelspinTick: [3950,   60],  wheelspinLand: [4100,  600],
  creditTick:    [4800,   40],  boardCollect:  [4950,  500],  raceStart:     [5550, 1200],
  raceFinish:    [6850, 2000],  newRecord:     [8950, 1500],  countdownBeep: [10550,  300],
  countdownGo:   [10950,  700], purchase:      [11750,  400], tabSwitch:     [12250,  100],
  menuOpen:      [12450,  250], menuClose:     [12800,  200], horn:          [13100,  800],
  rewind:        [14000,  600],
});

// ─── MUSIC TRACKS ────────────────────────────────────────────────────────────

const MUSIC_TRACKS = Object.freeze({
  menu:      ['assets/audio/music/menu_theme.ogg',      'assets/audio/music/menu_theme.mp3'],
  festival:  ['assets/audio/music/festival_01.ogg',     'assets/audio/music/festival_01.mp3'],
  driving:   ['assets/audio/music/driving_01.ogg',      'assets/audio/music/driving_01.mp3',
               'assets/audio/music/driving_02.ogg',     'assets/audio/music/driving_02.mp3'],
  race:      ['assets/audio/music/race_01.ogg',         'assets/audio/music/race_01.mp3',
               'assets/audio/music/race_02.ogg',        'assets/audio/music/race_02.mp3'],
  results:   ['assets/audio/music/results.ogg',         'assets/audio/music/results.mp3'],
  wheelspin: ['assets/audio/music/wheelspin_sting.ogg', 'assets/audio/music/wheelspin_sting.mp3'],
  levelUp:   ['assets/audio/music/levelup_sting.ogg',   'assets/audio/music/levelup_sting.mp3'],
  none:      null,
});

// ─── WORLD SOUND DEFINITIONS ─────────────────────────────────────────────────

const WORLD_SOUNDS = Object.freeze({
  tireSqueal:  { src: ['assets/audio/world/tire_squeal.ogg',  'assets/audio/world/tire_squeal.mp3'],  loop: true,  volume: 0 },
  gravel:      { src: ['assets/audio/world/gravel_loop.ogg',  'assets/audio/world/gravel_loop.mp3'],  loop: true,  volume: 0 },
  impactLight: { src: ['assets/audio/world/impact_light.ogg', 'assets/audio/world/impact_light.mp3'], loop: false },
  impactHeavy: { src: ['assets/audio/world/impact_heavy.ogg', 'assets/audio/world/impact_heavy.mp3'], loop: false },
  turboWhine:  { src: ['assets/audio/world/turbo_whine.ogg',  'assets/audio/world/turbo_whine.mp3'],  loop: true,  volume: 0 },
  ambientCity: { src: ['assets/audio/world/city_ambient.ogg', 'assets/audio/world/city_ambient.mp3'], loop: true },
  footstep:    { src: ['assets/audio/world/footstep.ogg',     'assets/audio/world/footstep.mp3'],     loop: false },
});

// ─── INTERNAL STATE ──────────────────────────────────────────────────────────

let _engineHowl         = null;
let _engineSoundId      = null;
let _activeProfile      = null;
let _engineRateSmoothed = 0.5;   // smoothed pitch rate, lerped each frame

let _uiHowl = null;

const _music     = { current: null, context: null };
const _worldHowls = new Map();

let _unlocked = false;

// ─── PART 7: RAIN STATE ──────────────────────────────────────────────────────

let _rainHowl     = null;
let _rainSoundId  = null;
let _rainVolNow   = 0;
let _rainBuilding = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────

export async function initAudio() {
  Howler.volume(_vol.master);
  await _loadUISprite();
  _loadWorldSounds();
  document.addEventListener('pointerdown', _unlockAudio, { once: true });
  document.addEventListener('keydown',     _unlockAudio, { once: true });
  console.log('[audio] Initialised');
}

function _unlockAudio() {
  if (_unlocked) return;
  _unlocked = true;
  Howler.ctx?.resume?.();
}

function _loadUISprite() {
  return new Promise((resolve) => {
    _uiHowl = new Howl({
      src: ['assets/audio/ui/ui_sprites.ogg', 'assets/audio/ui/ui_sprites.mp3'],
      sprite: UI_SPRITE_MAP, volume: _vol.sfx, preload: true,
      onload: resolve,
      onloaderror: (_, err) => { console.warn('[audio] UI sprite failed:', err); resolve(); },
    });
  });
}

function _loadWorldSounds() {
  for (const [name, def] of Object.entries(WORLD_SOUNDS)) {
    _worldHowls.set(name, new Howl({
      src: def.src, loop: def.loop ?? false,
      volume: (def.volume ?? 1.0) * _vol.sfx * _vol.ambient,
      preload: true,
      onloaderror: () => console.warn('[audio] World sound failed:', name),
    }));
  }
}

// ─── ENGINE ──────────────────────────────────────────────────────────────────

export function loadEngineSound(category) {
  const profile = ENGINE_PROFILES[category] ?? ENGINE_PROFILES.inline4;
  if (_activeProfile === category) return;
  _engineHowl?.stop(); _engineHowl?.unload();
  _activeProfile = category;
  _engineRateSmoothed = 0.5;
  _engineHowl = new Howl({
    src: profile.src, loop: true, volume: _vol.engine, rate: 0.5, preload: true,
    onload:       () => { _engineSoundId = _engineHowl.play(); },
    onloaderror: (_, err) => console.warn('[audio] Engine failed:', category, err),
  });
}

export function playEngine(rpm, throttle = 1, dt = 0.016) {
  if (!_engineHowl || _engineSoundId === null) return;
  if (!_engineHowl.playing(_engineSoundId)) _engineSoundId = _engineHowl.play();

  const profile    = ENGINE_PROFILES[_activeProfile] ?? ENGINE_PROFILES.inline4;
  const targetRate = _rpmToRate(rpm, profile.idleRPM, profile.redline);

  // Fast attack (punch on blip), slower release (smooth on lift)
  const lerpSpeed = targetRate > _engineRateSmoothed ? 12 : 6;
  _engineRateSmoothed += (targetRate - _engineRateSmoothed) * Math.min(dt * lerpSpeed, 1);

  _engineHowl.rate(_engineRateSmoothed, _engineSoundId);
  _engineHowl.volume(_vol.engine * (0.6 + throttle * 0.4) * _vol.master, _engineSoundId);
}

function _rpmToRate(rpm, idleRPM, redline) {
  const t = (Math.max(idleRPM, Math.min(redline, rpm)) - idleRPM) / (redline - idleRPM);
  return 0.4 + Math.pow(t, 0.75) * 1.6;   // 0.4–2.0, exponential curve
}

export function stopEngine() {
  if (!_engineHowl || _engineSoundId === null) return;
  _engineHowl.fade(_engineHowl.volume(_engineSoundId), 0, 300, _engineSoundId);
  setTimeout(() => { _engineHowl?.stop(_engineSoundId); _engineSoundId = null; }, 310);
}

// ─── TURBO ───────────────────────────────────────────────────────────────────

export function setTurboWhine(boost) {
  const howl = _worldHowls.get('turboWhine');
  if (!howl) return;
  const vol = boost * 0.6 * _vol.sfx;
  if (boost > 0.05 && !howl.playing()) howl.play();
  howl.volume(vol);
}

// ─── TYRE SQUEAL — PART 7: continuous + pitch scaling ────────────────────────

export function setTireSqueal(slipNorm) {
  const howl = _worldHowls.get('tireSqueal');
  if (!howl) return;
  // Dead-zone 0–0.1; ramp from 0.1 to 1.0
  const vol = Math.max(0, (slipNorm - 0.1) / 0.9) * _vol.sfx;
  if (vol > 0.01) {
    if (!howl.playing()) howl.play();
    howl.volume(vol * _vol.master);
    howl.rate(0.7 + slipNorm * 0.6);   // chirp at low slip, screech at high
  } else {
    if (howl.playing()) howl.stop();
  }
}

export function setGravelSound(intensity) {
  const howl = _worldHowls.get('gravel');
  if (!howl) return;
  const vol = intensity * 0.7 * _vol.sfx;
  if (vol > 0.01 && !howl.playing()) howl.play();
  howl.volume(vol * _vol.master);
  if (vol < 0.01 && howl.playing()) howl.stop();
}

// ─── PART 7: RAIN AMBIENT SYNTHESIS ─────────────────────────────────────────

async function _synthesiseRain() {
  const SR = 44100, DUR = 3.0;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * DUR), SR);

  // Broadband rain hiss
  const nBuf = ctx.createBuffer(2, Math.ceil(SR * DUR), SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = nBuf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const nSrc = ctx.createBufferSource(); nSrc.buffer = nBuf; nSrc.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.3;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800;
  const g  = ctx.createGain(); g.gain.value = 0.22;
  nSrc.connect(bp); bp.connect(hp); hp.connect(g); g.connect(ctx.destination);
  nSrc.start(0);

  // Drip transients
  const dStride = Math.ceil(SR * 0.16);
  const dBuf    = ctx.createBuffer(1, dStride, SR);
  const dCh     = dBuf.getChannelData(0);
  for (let i = 0; i < dCh.length; i++) {
    const t = i / SR, f = 1200 + Math.random() * 800;
    dCh[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.012) * 0.12;
  }
  const dSrc = ctx.createBufferSource(); dSrc.buffer = dBuf; dSrc.loop = true;
  const dg   = ctx.createGain(); dg.gain.value = 0.5;
  dSrc.connect(dg); dg.connect(ctx.destination); dSrc.start(0.04);

  const rendered = await ctx.startRendering();

  // Encode as 16-bit PCM WAV blob URL
  const numCh = rendered.numberOfChannels, len = rendered.length;
  const ab = new ArrayBuffer(44 + len * numCh * 2);
  const v  = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + len * numCh * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * numCh * 2, true); v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, len * numCh * 2, true);
  let off = 44;
  for (let s = 0; s < len; s++) for (let ch = 0; ch < numCh; ch++) {
    const smp = Math.max(-1, Math.min(1, rendered.getChannelData(ch)[s]));
    v.setInt16(off, smp < 0 ? smp * 0x8000 : smp * 0x7FFF, true); off += 2;
  }
  return URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
}

async function _ensureRainLoop() {
  if (_rainBuilding) return;
  _rainBuilding = true;
  try {
    const url = await _synthesiseRain();
    _rainHowl = new Howl({
      src: [url], format: ['wav'], loop: true, volume: 0, html5: false,
      onloaderror: () => { console.warn('[audio] Rain loop failed'); _rainBuilding = false; },
    });
    _rainSoundId = _rainHowl.play();
    _rainHowl.volume(0, _rainSoundId);
    console.log('[audio] Rain ambient ready');
  } catch (e) {
    console.warn('[audio] Rain synthesis error:', e);
    _rainBuilding = false;
  }
}

// ─── PART 7: UNIFIED PER-FRAME UPDATE ────────────────────────────────────────

/**
 * updateAudio(dt, opts) — single call per game tick from main.js.
 *
 * @param {number} dt   Frame delta in seconds
 * @param {{
 *   rpm?:       number,   raw engine RPM (800–8000)
 *   throttle?:  number,   0–1 throttle
 *   boost?:     number,   0–1 turbo boost
 *   slipMag?:   number,   raw slip m/s from driving.js (|frontSlipV|+|rearSlipV|)
 *   isRain?:    boolean,
 *   rainBlend?: number,   0–1 rain intensity from weather system
 * }} opts
 */
export function updateAudio(dt, opts = {}) {
  const {
    rpm       = 800,
    throttle  = 0,
    boost     = 0,
    slipMag   = 0,
    isRain    = false,
    rainBlend = 0,
  } = opts;

  // 1 — Engine pitch + volume
  playEngine(rpm, throttle, dt);

  // 2 — Turbo whine
  setTurboWhine(boost);

  // 3 — Tyre squeal: slipMag threshold 2.5 m/s, full at 6 m/s
  setTireSqueal(Math.max(0, Math.min(1, (slipMag - 2.5) / 3.5)));

  // 4 — Rain ambient crossfade
  const targetRainVol = (isRain && rainBlend > 0)
    ? rainBlend * 0.45 * _vol.ambient * _vol.master
    : 0;

  if (targetRainVol > 0.005 && !_rainBuilding && !_rainHowl) {
    _ensureRainLoop();
  }

  if (_rainHowl && _rainSoundId !== null) {
    const speed = targetRainVol > _rainVolNow ? 0.8 : 1.5;
    _rainVolNow += (targetRainVol - _rainVolNow) * Math.min(dt * speed, 1);
    if (!_rainHowl.playing(_rainSoundId) && _rainVolNow > 0.005) {
      _rainSoundId = _rainHowl.play();
      _rainHowl.volume(0, _rainSoundId);
    }
    _rainHowl.volume(Math.max(0, _rainVolNow), _rainSoundId);
    if (_rainVolNow < 0.005 && _rainHowl.playing(_rainSoundId)) {
      _rainHowl.stop(_rainSoundId);
      _rainSoundId = null;
      _rainVolNow  = 0;
    }
  }
}

// ─── PART 7: AUDIO ADAPTER FOR DRIVINGCONTROLLER ────────────────────────────

/**
 * Returns a duck-typed adapter that DrivingController can call via this._audio.
 * Pass this to new DrivingController(car, { ..., audioManager: audioManager.getAudioAdapter() })
 */
export function getAudioAdapter() {
  const state = { throttle: 0 };
  return {
    setParam(key, value) {
      if (key === 'engine_rpm') {
        const p = ENGINE_PROFILES[_activeProfile] ?? ENGINE_PROFILES.inline4;
        playEngine(p.idleRPM + value * (p.redline - p.idleRPM), state.throttle, 0.016);
      } else if (key === 'engine_load') {
        state.throttle = value;
      } else if (key === 'engine_boost') {
        setTurboWhine(value);
      }
    },
    play(name, vol = 1) {
      switch (name) {
        case 'tyre_squeal':  setTireSqueal(vol);     break;
        case 'impact':       playImpact(vol);         break;
        case 'gravel_loop':  setGravelSound(vol);     break;
        case 'horn':         playUI('horn');           break;
      }
    },
    stop(name) {
      if (name === 'tyre_squeal') setTireSqueal(0);
      if (name === 'gravel_loop') setGravelSound(0);
    },
  };
}

// ─── IMPACT / FOOTSTEP / AMBIENT ─────────────────────────────────────────────

export function playImpact(severity) {
  const howl = _worldHowls.get(severity > 0.3 ? 'impactHeavy' : 'impactLight');
  if (!howl) return;
  howl.volume((0.4 + severity * 0.6) * _vol.sfx * _vol.master);
  howl.play();
}

export function playFootstep() {
  const howl = _worldHowls.get('footstep');
  if (!howl) return;
  howl.volume(0.35 * _vol.sfx * _vol.master); howl.play();
}

export function startAmbient() {
  const howl = _worldHowls.get('ambientCity');
  if (howl && !howl.playing()) { howl.volume(_vol.ambient * _vol.master); howl.play(); }
}

export function stopAmbient() {
  const howl = _worldHowls.get('ambientCity');
  howl?.fade(howl.volume(), 0, 500);
  setTimeout(() => howl?.stop(), 510);
}

// ─── UI SOUNDS ────────────────────────────────────────────────────────────────

export function playUI(name, volumeOverride) {
  if (!_uiHowl || !UI_SPRITE_MAP[name]) { console.warn('[audio] Unknown UI:', name); return; }
  const id = _uiHowl.play(name);
  _uiHowl.volume((volumeOverride ?? 1.0) * _vol.sfx * _vol.master, id);
}

// ─── MUSIC ────────────────────────────────────────────────────────────────────

export function playMusic(context, fadeMs = 1500) {
  if (context === _music.context) return;
  if (!MUSIC_TRACKS[context] && context !== 'none') { console.warn('[audio] Unknown music:', context); return; }
  _music.context = context;
  if (_music.current?.playing()) {
    const old = _music.current;
    old.fade(old.volume(), 0, fadeMs);
    setTimeout(() => { old.stop(); old.unload(); }, fadeMs + 100);
  }
  if (context === 'none' || !MUSIC_TRACKS[context]) { _music.current = null; return; }
  const src = _pickTrackSrc(MUSIC_TRACKS[context]);
  const newH = new Howl({
    src, loop: !['wheelspin','levelUp','results'].includes(context), volume: 0,
    onloaderror: () => console.warn('[audio] Music failed:', context),
    onend: () => { if (['wheelspin','levelUp'].includes(context)) playMusic('driving'); },
  });
  _music.current = newH;
  newH.fade(0, _vol.music * _vol.master, fadeMs, newH.play());
}

function _pickTrackSrc(flat) {
  const pairs = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i+1]]);
  return pairs[Math.floor(Math.random() * pairs.length)];
}

export function duckMusic(v = 0.2, ms = 300) {
  if (_music.current) _music.current.fade(_music.current.volume(), v * _vol.music * _vol.master, ms);
}
export function unduckMusic(ms = 500) {
  if (_music.current) _music.current.fade(_music.current.volume(), _vol.music * _vol.master, ms);
}

// ─── VOLUME ───────────────────────────────────────────────────────────────────

export function setMasterVol(v) { _vol.master = Math.max(0, Math.min(1, v)); Howler.volume(_vol.master); }
export function setMusicVol(v)  { _vol.music  = Math.max(0, Math.min(1, v)); if (_music.current) _music.current.volume(_vol.music * _vol.master); }
export function setSFXVol(v)    { _vol.sfx    = Math.max(0, Math.min(1, v)); if (_uiHowl) _uiHowl.volume(_vol.sfx); }
export function setEngineVol(v) { _vol.engine = Math.max(0, Math.min(1, v)); }
export function setAmbientVol(v){ _vol.ambient = Math.max(0, Math.min(1, v)); const a = _worldHowls.get('ambientCity'); if (a) a.volume(_vol.ambient * _vol.master); }
export function toggleMute()    { Howler.mute(!Howler._muted); }
export function getVolumeLevels(){ return { ..._vol }; }

// ─── CONVENIENCE EXPORT ──────────────────────────────────────────────────────

export const audioManager = Object.freeze({
  init: initAudio,
  updateAudio, getAudioAdapter,
  loadEngineSound, playEngine, stopEngine, setTurboWhine,
  setTireSqueal, setGravelSound,
  playImpact, playFootstep, startAmbient, stopAmbient,
  playUI,
  playMusic, duckMusic, unduckMusic,
  setMasterVol, setMusicVol, setSFXVol, setEngineVol, setAmbientVol,
  toggleMute, getVolumeLevels,
});

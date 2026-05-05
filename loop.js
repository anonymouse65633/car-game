/**
 * loop.js — Main Game Loop
 * Part 10 / Engine layer
 *
 * Responsibilities:
 *  - requestAnimationFrame driver with capped delta (max 100 ms)
 *  - Fixed-timestep physics accumulator (60 Hz)
 *  - Ordered tick-subscriber list (EARLY → UPDATE → LATE → RENDER)
 *  - Per-frame performance telemetry (FPS, frame-time, physics steps)
 *  - Pause / resume / single-step support
 *  - Graceful shutdown (stopLoop cleans up the rAF handle)
 *
 * Exports:
 *  startLoop()           — kick off the rAF loop (call once after all systems init)
 *  stopLoop()            — cancel the loop cleanly
 *  pauseLoop()           — freeze time without cancelling rAF
 *  resumeLoop()          — unfreeze
 *  stepLoop()            — advance exactly one physics tick (debug / cutscene use)
 *  onTick(fn, phase?)    — subscribe; phase = 'early'|'update'|'late'|'render' (default 'update')
 *  offTick(fn)           — unsubscribe
 *  onceNextTick(fn)      — run fn exactly once on the next tick then auto-remove
 *  setTimeScale(t)       — slow-motion / fast-forward (0 = frozen, 1 = normal, 2 = 2× etc.)
 *  getStats()            — { fps, frameMs, physicsStepsLastFrame, totalTicks, totalTime }
 *  LOOP_PHASE            — enum of phase names for convenience
 */

import { stepPhysics }  from './physics.js';
import { renderFrame }  from './renderer.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Physics fixed timestep in seconds (60 Hz). */
const PHYSICS_DT = 1 / 60;

/** Maximum wall-clock delta we'll feed the accumulator each frame.
 *  Clamps spiral-of-death: if the tab was backgrounded for 5 s we don't
 *  simulate 300 physics steps on the next frame. */
const MAX_DELTA = 0.1; // 100 ms

/** Maximum physics steps allowed per visual frame even after clamping.
 *  Safety net: shouldn't fire under normal conditions given MAX_DELTA. */
const MAX_STEPS_PER_FRAME = 6;

/** Phase execution order — subscribers choose which phase they belong to. */
export const LOOP_PHASE = Object.freeze({
  EARLY:  'early',   // Input polling, camera pre-update, animation state machines
  UPDATE: 'update',  // Game logic, AI, managers
  LATE:   'late',    // Post-physics: car mesh sync, HUD reads, minimap
  RENDER: 'render',  // Three.js render call + UI flushes (last in chain)
});

const PHASE_ORDER = [
  LOOP_PHASE.EARLY,
  LOOP_PHASE.UPDATE,
  LOOP_PHASE.LATE,
  LOOP_PHASE.RENDER,
];

// ─── Internal State ──────────────────────────────────────────────────────────

/** Subscriber registry: Map<phase, Set<fn>> */
const _subscribers = new Map(
  PHASE_ORDER.map(p => [p, new Set()])
);

/** One-shot callbacks — fired once on the next tick then discarded. */
const _onceBag = new Set();

/** rAF handle — needed to cancel on stopLoop(). */
let _rafHandle = null;

/** Timestamp of the previous frame (ms, from performance.now via rAF). */
let _lastTime = null;

/** Physics accumulator (seconds). */
let _accumulator = 0;

/** Slow-motion / fast-forward scalar. */
let _timeScale = 1;

/** Whether the loop is paused (time frozen, rAF still ticking). */
let _paused = false;

/** Whether the loop is actively running. */
let _running = false;

/** Whether to advance exactly one physics step then re-pause. */
let _pendingSingleStep = false;

// ─── Performance Counters ────────────────────────────────────────────────────

let _totalTicks       = 0;   // Total visual frames rendered
let _totalTime        = 0;   // Total simulated time in seconds
let _fpsAccum         = 0;   // Accumulated frame count for rolling FPS
let _fpsTimer         = 0;   // Time accumulator for FPS window
let _currentFPS       = 0;   // Last computed FPS
let _lastFrameMs      = 0;   // Last frame wall-clock time in ms
let _lastPhysicsSteps = 0;   // Physics steps executed last frame

const FPS_WINDOW = 0.5;       // Compute FPS over 500 ms rolling window

// ─── Core Loop ───────────────────────────────────────────────────────────────

/**
 * The rAF callback.  Called by the browser every display refresh.
 * @param {DOMHighResTimeStamp} now — timestamp in ms from performance.timeOrigin
 */
function _tick(now) {
  // Always re-queue so the loop keeps running
  _rafHandle = requestAnimationFrame(_tick);

  // ── Delta calculation ────────────────────────────────────────────────────
  if (_lastTime === null) {
    // First frame: skip simulation, just record time
    _lastTime = now;
    return;
  }

  const rawDeltaMs = now - _lastTime;
  _lastTime = now;
  _lastFrameMs = rawDeltaMs;

  // Bail out of all simulation/tick work when paused
  // (unless a single-step was requested)
  if (_paused && !_pendingSingleStep) {
    // Still call RENDER phase so the canvas stays sharp (resize etc.)
    _runPhase(LOOP_PHASE.RENDER, 0, 0);
    return;
  }

  // Apply time scale and clamp
  const scaledDelta = Math.min(rawDeltaMs / 1000, MAX_DELTA) * _timeScale;

  // ── FPS rolling average ──────────────────────────────────────────────────
  _fpsAccum++;
  _fpsTimer += rawDeltaMs / 1000; // raw wall clock for FPS (not time-scaled)
  if (_fpsTimer >= FPS_WINDOW) {
    _currentFPS = Math.round(_fpsAccum / _fpsTimer);
    _fpsAccum   = 0;
    _fpsTimer   = 0;
  }

  // ── EARLY phase ─────────────────────────────────────────────────────────
  // Input polling happens here so the rest of the frame sees fresh state.
  _runPhase(LOOP_PHASE.EARLY, scaledDelta, _totalTime);

  // ── Fixed-timestep physics accumulator ──────────────────────────────────
  _accumulator += scaledDelta;

  let physicsSteps = 0;

  while (_accumulator >= PHYSICS_DT && physicsSteps < MAX_STEPS_PER_FRAME) {
    stepPhysics(PHYSICS_DT);
    _accumulator -= PHYSICS_DT;
    physicsSteps++;

    // Single-step mode: run exactly one tick then re-pause
    if (_pendingSingleStep) {
      _accumulator     = 0;
      _pendingSingleStep = false;
      _paused          = true;
      break;
    }
  }

  // Clamp leftover accumulator to avoid precision drift when MAX_STEPS_PER_FRAME
  // kicks in under heavy load.
  if (_accumulator > PHYSICS_DT * MAX_STEPS_PER_FRAME) {
    _accumulator = 0;
  }

  _lastPhysicsSteps = physicsSteps;

  // Interpolation alpha — how far between the last physics step and the next.
  // Pass to subscribers so they can lerp mesh positions for smooth rendering
  // even at sub-60 Hz display rates.
  const alpha = _accumulator / PHYSICS_DT;

  // ── UPDATE phase ────────────────────────────────────────────────────────
  _runPhase(LOOP_PHASE.UPDATE, scaledDelta, _totalTime, alpha);

  // ── LATE phase ──────────────────────────────────────────────────────────
  // After physics + update: sync Three.js meshes to Rapier transforms,
  // update HUD reads, minimap, camera follow.
  _runPhase(LOOP_PHASE.LATE, scaledDelta, _totalTime, alpha);

  // ── One-shot callbacks ───────────────────────────────────────────────────
  if (_onceBag.size > 0) {
    const snapshot = [..._onceBag];
    _onceBag.clear();
    for (const fn of snapshot) {
      try { fn(scaledDelta, _totalTime); } catch (e) { _warn('onceNextTick', e); }
    }
  }

  // ── RENDER phase ────────────────────────────────────────────────────────
  // Subscribers in this phase do any final DOM mutations, canvas overlays, etc.
  // renderFrame() is also called from here (registered internally at the end
  // of this file) so the Three.js draw call happens last.
  _runPhase(LOOP_PHASE.RENDER, scaledDelta, _totalTime, alpha);

  // ── Counters ────────────────────────────────────────────────────────────
  _totalTicks++;
  _totalTime += scaledDelta;
}

/**
 * Execute all subscribers in a given phase.
 * Each subscriber receives (dt, totalTime, alpha).
 * Errors are caught individually so a bad subscriber can't kill the loop.
 */
function _runPhase(phase, dt, totalTime, alpha = 0) {
  for (const fn of _subscribers.get(phase)) {
    try {
      fn(dt, totalTime, alpha);
    } catch (err) {
      _warn(`[loop] Error in ${phase} subscriber "${fn.name || 'anonymous'}":`, err);
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the game loop.
 * Call once after renderer, physics, input, and audio are all initialised.
 */
export function startLoop() {
  if (_running) {
    console.warn('[loop] startLoop() called but loop is already running.');
    return;
  }
  _running    = true;
  _paused     = false;
  _lastTime   = null;
  _accumulator = 0;
  _rafHandle  = requestAnimationFrame(_tick);
  console.log('[loop] Game loop started.');
}

/**
 * Permanently stop the loop and release the rAF handle.
 * Call on app teardown / HMR reload.
 */
export function stopLoop() {
  if (!_running) return;
  _running = false;
  if (_rafHandle !== null) {
    cancelAnimationFrame(_rafHandle);
    _rafHandle = null;
  }
  console.log('[loop] Game loop stopped.');
}

/**
 * Freeze simulation time.  The rAF callback keeps ticking (so resize,
 * debug overlays, and the RENDER phase still run) but delta is not
 * consumed and physics is not stepped.
 */
export function pauseLoop() {
  _paused = true;
}

/**
 * Resume after pauseLoop().
 * Resets _lastTime to prevent a giant spike on the first resumed frame.
 */
export function resumeLoop() {
  if (!_paused) return;
  _paused   = false;
  _lastTime = null; // Prevents delta spike
}

/**
 * Advance exactly one fixed physics tick while paused.
 * Useful for cutscene scrubbing or physics debugging.
 */
export function stepLoop() {
  if (!_running) {
    console.warn('[loop] stepLoop() called but loop is not running. Call startLoop() first.');
    return;
  }
  _paused            = true;
  _pendingSingleStep = true;
}

/**
 * Subscribe a function to the tick.
 *
 * @param {function} fn    — Called each frame with (dt, totalTime, alpha)
 *                           dt        = scaled delta seconds for this frame
 *                           totalTime = total simulated seconds since start
 *                           alpha     = physics interpolation factor [0–1]
 * @param {string}   phase — One of LOOP_PHASE.* (default: 'update')
 * @returns {function}     — The same fn, for chaining / easy offTick reference
 */
export function onTick(fn, phase = LOOP_PHASE.UPDATE) {
  if (!_subscribers.has(phase)) {
    console.warn(`[loop] Unknown phase "${phase}". Defaulting to 'update'.`);
    phase = LOOP_PHASE.UPDATE;
  }
  _subscribers.get(phase).add(fn);
  return fn;
}

/**
 * Unsubscribe a previously-registered tick function.
 * Searches all phases so the caller doesn't need to track which phase they used.
 *
 * @param {function} fn
 */
export function offTick(fn) {
  for (const set of _subscribers.values()) {
    set.delete(fn);
  }
}

/**
 * Register a one-shot callback that fires on the very next tick, then
 * auto-removes itself.  Useful for "do this after physics has settled" patterns.
 *
 * @param {function} fn — Called with (dt, totalTime)
 */
export function onceNextTick(fn) {
  _onceBag.add(fn);
}

/**
 * Set the simulation time scale.
 *  0   = frozen (physics runs at 0× speed; equivalent to pauseLoop but
 *         still drains the accumulator — use pauseLoop for a hard freeze)
 *  0.5 = slow motion
 *  1   = normal
 *  2   = 2× fast forward (stress-test / replay)
 *
 * @param {number} scale — Non-negative multiplier
 */
export function setTimeScale(scale) {
  if (typeof scale !== 'number' || scale < 0) {
    console.warn('[loop] setTimeScale() requires a non-negative number.');
    return;
  }
  _timeScale = scale;
}

/**
 * Retrieve a snapshot of current performance telemetry.
 *
 * @returns {{
 *   fps:                   number,
 *   frameMs:               number,
 *   physicsStepsLastFrame: number,
 *   totalTicks:            number,
 *   totalTime:             number,
 *   timeScale:             number,
 *   paused:                boolean,
 *   running:               boolean,
 * }}
 */
export function getStats() {
  return {
    fps:                   _currentFPS,
    frameMs:               _lastFrameMs,
    physicsStepsLastFrame: _lastPhysicsSteps,
    totalTicks:            _totalTicks,
    totalTime:             _totalTime,
    timeScale:             _timeScale,
    paused:                _paused,
    running:               _running,
  };
}

// ─── Built-in Render Subscriber ──────────────────────────────────────────────
// Register renderFrame as the last RENDER-phase subscriber so the Three.js
// draw call always happens after every other RENDER subscriber has flushed
// its DOM/canvas work.
// We use a named wrapper so offTick can remove it cleanly if needed.

function _builtinRender(dt, totalTime, alpha) {
  renderFrame(alpha);
}

onTick(_builtinRender, LOOP_PHASE.RENDER);

// ─── Visibility change handling ──────────────────────────────────────────────
// When the tab is hidden (Page Visibility API), reset _lastTime on return
// so we don't get a huge spike from background throttling.

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Reset timestamp — _tick will treat it as the first frame
    _lastTime = null;
  }
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function _warn(...args) {
  console.warn('[loop]', ...args);
}

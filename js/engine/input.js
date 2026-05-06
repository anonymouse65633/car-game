/**
 * input.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified input system — keyboard events + Gamepad API polling in one place.
 * Produces a single `inputState` object read by driving.js, movement.js,
 * and all menu systems each frame.
 *
 * Usage:
 *   import { initInput, getInput, inputState, onInputEvent } from './input.js';
 *   initInput();           // call once from main.js (synchronous)
 *
 *   // In game loop (loop.js calls this automatically):
 *   pollGamepad();         // update analog axes from connected gamepad
 *
 *   // In driving.js each frame:
 *   const inp = getInput();
 *   applyForces(car, inp.throttle, inp.brake, inp.steer);
 *
 * No external dependencies.
 *
 * Part 2.5 — Input & Controls (design doc reference)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── INPUT CONTEXTS ──────────────────────────────────────────────────────────
// The active context gates which parts of inputState are meaningful.
// Set by the game state machine in main.js / state.js.

export const INPUT_CONTEXT = Object.freeze({
  DRIVING:  'DRIVING',
  ON_FOOT:  'ON_FOOT',
  MENU:     'MENU',
  CUTSCENE: 'CUTSCENE', // all gameplay input suppressed
});

let _context = INPUT_CONTEXT.DRIVING;

/**
 * @param {string} ctx  One of INPUT_CONTEXT values
 */
export function setInputContext(ctx) {
  _context = ctx;
}

export function getInputContext() {
  return _context;
}

// ─── INPUT STATE ─────────────────────────────────────────────────────────────
/**
 * The canonical input state — updated every frame.
 * Consumers read this directly or via getInput().
 *
 * Axes are normalised to [-1, 1] or [0, 1].
 * Buttons are booleans (held) or rising-edge flags (justPressed).
 *
 * @type {InputState}
 *
 * @typedef {object} InputState
 *
 * — Driving axes —
 * @property {number} throttle      0–1   (W / right trigger)
 * @property {number} brake         0–1   (S / left trigger)
 * @property {number} steer         -1–1  (A–D / left stick X)
 * @property {boolean} handbrake          (Space / gamepad X)
 *
 * — Manual gearbox —
 * @property {boolean} shiftUp            (E / RB)
 * @property {boolean} shiftDown          (Q / LB)
 *
 * — On-foot movement —
 * @property {number} moveX         -1–1  (A–D / left stick X)
 * @property {number} moveZ         -1–1  (W–S / left stick Y)
 * @property {boolean} sprint             (Shift / left stick click)
 *
 * — Camera —
 * @property {boolean} lookBack           (C / right stick click)
 * @property {boolean} camToggle          (V / D-pad up)
 * @property {number}  camPitchDelta  -1–1 (right stick Y)
 * @property {number}  camYawDelta    -1–1 (right stick X)
 *
 * — Actions —
 * @property {boolean} interact           (F / A button)
 * @property {boolean} horn               (H / Y button)
 * @property {boolean} rewind             (R / back button)
 * @property {boolean} map                (M / D-pad down)
 * @property {boolean} pause              (Escape / Start)
 * @property {boolean} tabNext            (Tab / RB in menu)
 * @property {boolean} tabPrev            (Shift+Tab / LB in menu)
 * @property {boolean} confirm            (Enter / A button)
 * @property {boolean} back               (Escape / B button)
 *
 * — Menu navigation —
 * @property {number}  menuX        -1–1  (arrow left–right / D-pad / left stick)
 * @property {number}  menuY        -1–1  (arrow up–down   / D-pad / left stick)
 *
 * — Rising-edge flags (true for exactly one frame after press) —
 * @property {boolean} justPressedInteract
 * @property {boolean} justPressedPause
 * @property {boolean} justPressedHandbrake
 * @property {boolean} justPressedShiftUp
 * @property {boolean} justPressedShiftDown
 * @property {boolean} justPressedCamToggle
 * @property {boolean} justPressedMap
 * @property {boolean} justPressedConfirm
 * @property {boolean} justPressedBack
 * @property {boolean} justPressedTabNext
 * @property {boolean} justPressedTabPrev
 * @property {boolean} justPressedMenuUp
 * @property {boolean} justPressedMenuDown
 * @property {boolean} justPressedMenuLeft
 * @property {boolean} justPressedMenuRight
 *
 * — Meta —
 * @property {'keyboard'|'gamepad'} lastDevice
 * @property {boolean} gamepadConnected
 */
export const inputState = {
  // Driving
  throttle: 0, brake: 0, steer: 0, handbrake: false,
  shiftUp: false, shiftDown: false,

  // On-foot
  moveX: 0, moveZ: 0, sprint: false,

  // Camera
  lookBack: false, camToggle: false,
  camPitchDelta: 0, camYawDelta: 0,

  // Actions
  interact: false, horn: false, rewind: false,
  map: false, pause: false,
  tabNext: false, tabPrev: false,
  confirm: false, back: false,

  // Menu nav
  menuX: 0, menuY: 0,

  // Rising-edge
  justPressedInteract: false, justPressedPause: false,
  justPressedHandbrake: false,
  justPressedShiftUp: false, justPressedShiftDown: false,
  justPressedCamToggle: false, justPressedMap: false,
  justPressedConfirm: false, justPressedBack: false,
  justPressedTabNext: false, justPressedTabPrev: false,
  justPressedMenuUp: false, justPressedMenuDown: false,
  justPressedMenuLeft: false, justPressedMenuRight: false,

  // Meta
  lastDevice: 'keyboard',
  gamepadConnected: false,
};

// ─── KEYBOARD STATE ───────────────────────────────────────────────────────────
// Raw key held-down set — updated by keydown/keyup events.

/** @type {Set<string>} */
const _keys = new Set();

// Previous-frame key set for rising-edge detection
/** @type {Set<string>} */
const _prevKeys = new Set();

// ─── KEYBOARD BINDING MAP ─────────────────────────────────────────────────────
// Maps KeyboardEvent.code → logical action name.
// Multiple keys can bind to the same action (primary + arrow fallback).

const KB_MAP = {
  // Throttle / brake / steer
  'KeyW':       'throttle',    'ArrowUp':    'throttle',
  'KeyS':       'brake',       'ArrowDown':  'brake',
  'KeyA':       'steerLeft',   'ArrowLeft':  'steerLeft',
  'KeyD':       'steerRight',  'ArrowRight': 'steerRight',

  // Handbrake / gears
  'Space':      'handbrake',
  'KeyE':       'shiftUp',
  'KeyQ':       'shiftDown',

  // On-foot sprint (same WASD re-used — context gates which matters)
  'ShiftLeft':  'sprint',  'ShiftRight': 'sprint',

  // Actions
  'KeyF':       'interact',
  'KeyH':       'horn',
  'KeyR':       'rewind',
  'KeyC':       'lookBack',
  'KeyV':       'camToggle',
  'KeyM':       'map',
  'Escape':     'pause',

  // Menu
  'Enter':      'confirm',
  'NumpadEnter':'confirm',
  'Tab':        'tabNext',   // Shift+Tab handled separately → tabPrev

  // Menu nav (arrow keys double-up)
  // ArrowUp/Down/Left/Right already bound above; menu nav reads them via menuX/Y
};

// ─── GAMEPAD BINDING MAP ──────────────────────────────────────────────────────
// Standard Gamepad API button indices (Xbox layout — PS maps the same indices).

const GP_BUTTONS = {
  0:  'confirm',       // A  / Cross
  1:  'back',          // B  / Circle
  2:  'handbrake',     // X  / Square   (also interact on foot)
  3:  'horn',          // Y  / Triangle
  4:  'shiftDown',     // LB / L1
  5:  'shiftUp',       // RB / R1
  6:  'brake',         // LT / L2  (also mapped as analog axis — see pollGamepad)
  7:  'throttle',      // RT / R2  (analog)
  8:  'rewind',        // Back / Select
  9:  'pause',         // Start / Options
  10: 'sprint',        // Left stick click
  11: 'lookBack',      // Right stick click
  12: 'menuUp',        // D-pad up
  13: 'menuDown',      // D-pad down
  14: 'menuLeft',      // D-pad left
  15: 'menuRight',     // D-pad right
  16: 'camToggle',     // Xbox button / PS home (if exposed)
};

// Gamepad axis indices
const GP_AXES = {
  LEFT_X:  0,  // steer / menuX / moveX
  LEFT_Y:  1,  // moveZ / menuY
  RIGHT_X: 2,  // camYaw
  RIGHT_Y: 3,  // camPitch
  LT:      4,  // brake (analog)  — some browsers put triggers on axes 4/5
  RT:      5,  // throttle (analog)
};

/** Analog stick dead zone — inputs below this are treated as zero */
const DEADZONE = 0.12;

/** Trigger dead zone (triggers often rest slightly above 0) */
const TRIGGER_DEADZONE = 0.05;

// ─── INIT ─────────────────────────────────────────────────────────────────────

/**
 * Attach keyboard listeners and gamepad connect/disconnect listeners.
 * Synchronous — no async needed.
 */
export function initInput() {
  window.addEventListener('keydown', _onKeyDown, { passive: false });
  window.addEventListener('keyup',   _onKeyUp,   { passive: false });
  window.addEventListener('gamepadconnected',    _onGamepadConnected);
  window.addEventListener('gamepaddisconnected', _onGamepadDisconnected);

  // Check if a gamepad was already connected before init (page reload with pad plugged in)
  const pads = navigator.getGamepads?.();
  if (pads) {
    for (const pad of pads) {
      if (pad) { inputState.gamepadConnected = true; break; }
    }
  }

  console.log('[input] ✅ Initialised');
}

// ─── KEYBOARD LISTENERS ───────────────────────────────────────────────────────

function _onKeyDown(e) {
  // Prevent browser default for game keys (space scrolling page, arrows scrolling, etc.)
  if (_isGameKey(e.code)) e.preventDefault?.();

  _keys.add(e.code);
  inputState.lastDevice = 'keyboard';
}

function _onKeyUp(e) {
  _keys.delete(e.code);
}

const _GAME_KEYS = new Set([
  'KeyW','KeyA','KeyS','KeyD',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
  'Space','KeyE','KeyQ','KeyF','KeyH','KeyR',
  'KeyC','KeyV','KeyM','Tab',
]);

function _isGameKey(code) {
  return _GAME_KEYS.has(code);
}

// ─── GAMEPAD LISTENERS ───────────────────────────────────────────────────────

function _onGamepadConnected(e) {
  inputState.gamepadConnected = true;
  console.log('[input] Gamepad connected:', e.gamepad.id);
}

function _onGamepadDisconnected(e) {
  // Check if any pad is still connected
  const pads = navigator.getGamepads?.() ?? [];
  inputState.gamepadConnected = [...pads].some(p => p !== null);
  console.log('[input] Gamepad disconnected:', e.gamepad.id);
}

// ─── GAMEPAD POLL ─────────────────────────────────────────────────────────────

/**
 * Poll the Gamepad API and write analog values into inputState.
 * Must be called once per animation frame (loop.js handles this).
 *
 * Gamepad API is snapshot-based — you must call getGamepads() each frame
 * to get fresh data; the gamepad object is not live.
 */
export function pollGamepad() {
  const pads = navigator.getGamepads?.();
  if (!pads) return;

  let pad = null;
  for (const p of pads) {
    if (p) { pad = p; break; } // use first connected pad
  }
  if (!pad) return;

  // If any significant gamepad input is detected, switch lastDevice
  // (so UI can show gamepad prompts instead of keyboard hints)
  const leftX = _applyDeadzone(pad.axes[GP_AXES.LEFT_X], DEADZONE);
  const leftY = _applyDeadzone(pad.axes[GP_AXES.LEFT_Y], DEADZONE);

  if (Math.abs(leftX) > 0.05 || Math.abs(leftY) > 0.05) {
    inputState.lastDevice = 'gamepad';
  }

  // ── Analog axes ────────────────────────────────────────────────────────────

  // Steering / movement
  _gpAxes.leftX = leftX;
  _gpAxes.leftY = leftY;
  _gpAxes.rightX = _applyDeadzone(pad.axes[GP_AXES.RIGHT_X], DEADZONE);
  _gpAxes.rightY = _applyDeadzone(pad.axes[GP_AXES.RIGHT_Y], DEADZONE);

  // Triggers — browsers differ: some expose as axes [-1,1], some as buttons [0,1]
  // We handle both by reading axis AND button
  const ltAxis = pad.axes[GP_AXES.LT]; // may be undefined on some browsers
  const rtAxis = pad.axes[GP_AXES.RT];

  _gpAxes.lt = ltAxis !== undefined
    ? _applyDeadzone((ltAxis + 1) / 2, TRIGGER_DEADZONE)  // remap -1..1 → 0..1
    : _applyDeadzone(pad.buttons[6]?.value ?? 0, TRIGGER_DEADZONE);

  _gpAxes.rt = rtAxis !== undefined
    ? _applyDeadzone((rtAxis + 1) / 2, TRIGGER_DEADZONE)
    : _applyDeadzone(pad.buttons[7]?.value ?? 0, TRIGGER_DEADZONE);

  // ── Buttons ────────────────────────────────────────────────────────────────
  for (let i = 0; i < pad.buttons.length; i++) {
    const pressed = pad.buttons[i]?.pressed ?? false;
    _gpButtons[i] = pressed;
    if (pressed) inputState.lastDevice = 'gamepad';
  }
}

/** Intermediate gamepad axis values written by pollGamepad(), read by _buildInputState() */
const _gpAxes  = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, lt: 0, rt: 0 };
const _gpButtons = new Array(20).fill(false);
const _prevGpButtons = new Array(20).fill(false);

// ─── INPUT STATE BUILD ────────────────────────────────────────────────────────

/**
 * Rebuild inputState from current keyboard + gamepad data.
 * Called automatically by loop.js at the top of each tick, before game logic.
 * Clears justPressed flags, then re-evaluates rising edges.
 */
export function buildInputState() {
  // ── Clear rising-edge flags ───────────────────────────────────────────────
  inputState.justPressedInteract    = false;
  inputState.justPressedPause       = false;
  inputState.justPressedHandbrake   = false;
  inputState.justPressedShiftUp     = false;
  inputState.justPressedShiftDown   = false;
  inputState.justPressedCamToggle   = false;
  inputState.justPressedMap         = false;
  inputState.justPressedConfirm     = false;
  inputState.justPressedBack        = false;
  inputState.justPressedTabNext     = false;
  inputState.justPressedTabPrev     = false;
  inputState.justPressedMenuUp      = false;
  inputState.justPressedMenuDown    = false;
  inputState.justPressedMenuLeft    = false;
  inputState.justPressedMenuRight   = false;

  // ── Keyboard held-state → logical actions ────────────────────────────────
  const kb = _keys;

  // Driving axes (keyboard = binary, gamepad = analog — blend takes max)
  const kbThrottle   = (kb.has('KeyW') || kb.has('ArrowUp'))    ? 1 : 0;
  const kbBrake      = (kb.has('KeyS') || kb.has('ArrowDown'))  ? 1 : 0;
  const kbSteerLeft  = (kb.has('KeyA') || kb.has('ArrowLeft'))  ? 1 : 0;
  const kbSteerRight = (kb.has('KeyD') || kb.has('ArrowRight')) ? 1 : 0;

  inputState.throttle  = Math.max(kbThrottle,  _gpAxes.rt);
  inputState.brake     = Math.max(kbBrake,     _gpAxes.lt);
  inputState.steer     = _blendSteer(kbSteerLeft, kbSteerRight, _gpAxes.leftX);

  // Handbrake
  const kbHB = kb.has('Space');
  const gpHB = _gpButtons[GP_BTN('handbrake')];
  const prevHB = _prevKeys.has('Space') || _prevGpButtons[GP_BTN('handbrake')];
  inputState.handbrake = kbHB || gpHB;
  if (inputState.handbrake && !prevHB) inputState.justPressedHandbrake = true;

  // Gears
  const kbSU = kb.has('KeyE');
  const gpSU = _gpButtons[5]; // RB
  const prevSU = _prevKeys.has('KeyE') || _prevGpButtons[5];
  inputState.shiftUp = kbSU || gpSU;
  if (inputState.shiftUp && !prevSU) inputState.justPressedShiftUp = true;

  const kbSD = kb.has('KeyQ');
  const gpSD = _gpButtons[4]; // LB
  const prevSD = _prevKeys.has('KeyQ') || _prevGpButtons[4];
  inputState.shiftDown = kbSD || gpSD;
  if (inputState.shiftDown && !prevSD) inputState.justPressedShiftDown = true;

  // On-foot movement (same WASD, context gates which system reads it)
  inputState.moveX = _blendSteer(kbSteerLeft, kbSteerRight, _gpAxes.leftX);
  inputState.moveZ = kbThrottle - kbBrake || -_gpAxes.leftY;
  inputState.sprint = kb.has('ShiftLeft') || kb.has('ShiftRight') || _gpButtons[10];

  // Camera
  inputState.lookBack     = kb.has('KeyC') || _gpButtons[11];
  inputState.camYawDelta  = _gpAxes.rightX;
  inputState.camPitchDelta = _gpAxes.rightY;

  const kbCam = kb.has('KeyV');
  const gpCam = _gpButtons[GP_BTN('camToggle')];
  const prevCam = _prevKeys.has('KeyV') || _prevGpButtons[GP_BTN('camToggle')];
  inputState.camToggle = kbCam || gpCam;
  if (inputState.camToggle && !prevCam) inputState.justPressedCamToggle = true;

  // Map
  const kbMap = kb.has('KeyM');
  const gpMap = _gpButtons[13]; // D-pad down
  const prevMap = _prevKeys.has('KeyM') || _prevGpButtons[13];
  inputState.map = kbMap || gpMap;
  if (inputState.map && !prevMap) inputState.justPressedMap = true;

  // Pause
  const kbPause = kb.has('Escape');
  const gpPause = _gpButtons[9]; // Start
  const prevPause = _prevKeys.has('Escape') || _prevGpButtons[9];
  inputState.pause = kbPause || gpPause;
  if (inputState.pause && !prevPause) inputState.justPressedPause = true;

  // Interact (F / A button — also X on foot since X = handbrake only in car)
  const kbInt = kb.has('KeyF');
  const gpInt = _gpButtons[0]; // A
  const prevInt = _prevKeys.has('KeyF') || _prevGpButtons[0];
  inputState.interact = kbInt || gpInt;
  if (inputState.interact && !prevInt) inputState.justPressedInteract = true;

  // Horn
  inputState.horn = kb.has('KeyH') || _gpButtons[3]; // Y

  // Rewind
  inputState.rewind = kb.has('KeyR') || _gpButtons[8]; // Back/Select

  // ── Menu / UI ─────────────────────────────────────────────────────────────
  // Confirm: Enter / A
  const kbConf = kb.has('Enter') || kb.has('NumpadEnter');
  const gpConf = _gpButtons[0];
  const prevConf = _prevKeys.has('Enter') || _prevGpButtons[0];
  inputState.confirm = kbConf || gpConf;
  if (inputState.confirm && !prevConf) inputState.justPressedConfirm = true;

  // Back: Escape / B
  const kbBack = kb.has('Escape');
  const gpBack = _gpButtons[1];
  const prevBack = _prevKeys.has('Escape') || _prevGpButtons[1];
  inputState.back = kbBack || gpBack;
  if (inputState.back && !prevBack) inputState.justPressedBack = true;

  // Tab next/prev
  const kbTabN = kb.has('Tab') && !kb.has('ShiftLeft') && !kb.has('ShiftRight');
  const kbTabP = kb.has('Tab') && (kb.has('ShiftLeft') || kb.has('ShiftRight'));
  const gpTabN = _gpButtons[5]; // RB in menu
  const gpTabP = _gpButtons[4]; // LB in menu
  const prevTabN = (_prevKeys.has('Tab') && !_prevKeys.has('ShiftLeft')) || _prevGpButtons[5];
  const prevTabP = (_prevKeys.has('Tab') && _prevKeys.has('ShiftLeft')) || _prevGpButtons[4];

  inputState.tabNext = kbTabN || gpTabN;
  inputState.tabPrev = kbTabP || gpTabP;
  if (inputState.tabNext && !prevTabN) inputState.justPressedTabNext = true;
  if (inputState.tabPrev && !prevTabP) inputState.justPressedTabPrev = true;

  // Menu navigation axes
  const kbMenuX = (kb.has('ArrowRight') || kb.has('KeyD') ? 1 : 0)
                - (kb.has('ArrowLeft')  || kb.has('KeyA') ? 1 : 0);
  const kbMenuY = (kb.has('ArrowDown')  || kb.has('KeyS') ? 1 : 0)
                - (kb.has('ArrowUp')    || kb.has('KeyW') ? 1 : 0);

  const gpMenuX = _gpButtons[15] ? 1 : _gpButtons[14] ? -1 : _gpAxes.leftX;
  const gpMenuY = _gpButtons[13] ? 1 : _gpButtons[12] ? -1 : _gpAxes.leftY;

  inputState.menuX = kbMenuX || gpMenuX;
  inputState.menuY = kbMenuY || gpMenuY;

  // Menu directional rising edges
  const menuUp    = inputState.menuY < -0.5;
  const menuDown  = inputState.menuY >  0.5;
  const menuLeft  = inputState.menuX < -0.5;
  const menuRight = inputState.menuX >  0.5;
  const prevMenuUp    = (_menuState.prevY ?? 0) < -0.5;
  const prevMenuDown  = (_menuState.prevY ?? 0) >  0.5;
  const prevMenuLeft  = (_menuState.prevX ?? 0) < -0.5;
  const prevMenuRight = (_menuState.prevX ?? 0) >  0.5;

  if (menuUp    && !prevMenuUp)    inputState.justPressedMenuUp    = true;
  if (menuDown  && !prevMenuDown)  inputState.justPressedMenuDown  = true;
  if (menuLeft  && !prevMenuLeft)  inputState.justPressedMenuLeft  = true;
  if (menuRight && !prevMenuRight) inputState.justPressedMenuRight = true;

  _menuState.prevX = inputState.menuX;
  _menuState.prevY = inputState.menuY;

  // ── Snapshot this frame → prev for next frame ─────────────────────────────
  _prevKeys.clear();
  for (const k of _keys) _prevKeys.add(k);
  for (let i = 0; i < _prevGpButtons.length; i++) {
    _prevGpButtons[i] = _gpButtons[i];
  }
}

const _menuState = { prevX: 0, prevY: 0 };

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Apply deadzone to an axis value, remapping the outer range to 0–1. */
function _applyDeadzone(value, dz) {
  if (Math.abs(value) < dz) return 0;
  // Remap: (|v| - dz) / (1 - dz), preserve sign
  return Math.sign(value) * (Math.abs(value) - dz) / (1 - dz);
}

/**
 * Blend keyboard binary steer with gamepad analog steer.
 * Keyboard input is always ±1; gamepad is already -1..1.
 * If gamepad has any input (> deadzone), use it; otherwise keyboard.
 */
function _blendSteer(kbLeft, kbRight, gpX) {
  if (Math.abs(gpX) > 0.01) return gpX;
  return kbRight - kbLeft; // -1, 0, or 1
}

/** Look up a gamepad button index by logical name */
function GP_BTN(name) {
  for (const [idx, n] of Object.entries(GP_BUTTONS)) {
    if (n === name) return Number(idx);
  }
  return -1;
}

// ─── EVENT BUS ────────────────────────────────────────────────────────────────
/**
 * Lightweight event bus for one-shot input events.
 * Systems can subscribe to specific logical actions rather than
 * polling inputState every frame.
 *
 * Example:
 *   onInputEvent('justPressedPause', () => togglePauseMenu());
 *
 * @param {string}   action  - A justPressed* key on inputState
 * @param {Function} fn
 */
const _eventListeners = {};

export function onInputEvent(action, fn) {
  if (!_eventListeners[action]) _eventListeners[action] = [];
  _eventListeners[action].push(fn);
}

export function offInputEvent(action, fn) {
  if (!_eventListeners[action]) return;
  _eventListeners[action] = _eventListeners[action].filter(f => f !== fn);
}

/**
 * Fire any subscribed input events for this frame.
 * Called by loop.js after buildInputState().
 */
export function fireInputEvents() {
  for (const [action, listeners] of Object.entries(_eventListeners)) {
    if (inputState[action] === true && listeners.length) {
      for (const fn of listeners) fn();
    }
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Get a frozen snapshot of the current inputState.
 * Most systems read inputState directly; this is provided for systems
 * that need a guaranteed-immutable copy.
 *
 * @returns {Readonly<InputState>}
 */
export function getInput() {
  return inputState;
}

/**
 * Check if a specific key code is currently held down.
 * Useful for one-off checks outside the main input build.
 *
 * @param {string} code  KeyboardEvent.code string (e.g. 'Space', 'KeyW')
 * @returns {boolean}
 */
export function isKeyHeld(code) {
  return _keys.has(code);
}

/**
 * Rumble the connected gamepad (if supported).
 * Used by collision events and near-miss feedback.
 *
 * @param {number} intensity  0.0–1.0
 * @param {number} duration   milliseconds
 * @param {'weak'|'strong'|'both'} [type]
 */
export function rumble(intensity = 0.5, duration = 150, type = 'both') {
  const pads = navigator.getGamepads?.();
  if (!pads) return;
  for (const pad of pads) {
    if (!pad?.vibrationActuator) continue;
    pad.vibrationActuator.playEffect('dual-rumble', {
      duration,
      weakMagnitude:   type !== 'strong' ? intensity       : 0,
      strongMagnitude: type !== 'weak'   ? intensity * 0.7 : 0,
    }).catch(() => {}); // not all browsers support this — swallow the error
    break;
  }
}

/**
 * Remap a keyboard binding.
 * Writes to KB_MAP at runtime — persisted via SaveManager in SettingsMenu.
 *
 * @param {string} code    KeyboardEvent.code to bind
 * @param {string} action  Logical action name (must match KB_MAP values)
 */
export function remapKey(code, action) {
  // Remove existing binding for this code
  delete KB_MAP[code];
  // Remove any other code already bound to this action
  for (const [k, v] of Object.entries(KB_MAP)) {
    if (v === action) delete KB_MAP[k];
  }
  KB_MAP[code] = action;
}

/**
 * Return a copy of the current keyboard bindings (for display in SettingsMenu).
 * @returns {object}
 */
export function getKeyBindings() {
  return { ...KB_MAP };
}

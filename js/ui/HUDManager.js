/**
 * HUDManager.js
 * Part 8 — UI, HUD & Menus (Section 8.14)
 *
 * The root controller for all HUD and menu elements.
 * Sits between the Three.js canvas and the player — manages every
 * DOM layer so individual modules never need to touch each other.
 *
 * Responsibilities:
 *  - Create and own the full-screen DOM overlay on top of the canvas
 *  - Control pointer-events (none during gameplay, auto during menus)
 *  - Track which "layer" is active: gameplay | phone | map | setup | results
 *  - Responsive CSS variable scaling at breakpoints
 *  - Show / hide individual HUD modules based on game state
 *  - Route game-state updates to the correct child modules
 *  - Keyboard / gamepad navigation dispatch
 *
 * Child modules (instantiated here, not imported by anything else):
 *   NotificationSystem, DrivingHUD, MinimapRenderer, RaceHUD,
 *   PhoneMenu, RaceSetupScreen, RaceResultsScreen, WheelspinUI
 *
 * Usage:
 *   import { HUDManager } from './HUDManager.js';
 *   const hud = new HUDManager({ canvas: renderer.domElement });
 *   hud.init();
 *
 *   // Each game-loop tick:
 *   hud.update(playerState, raceState);
 *
 *   // On state changes:
 *   hud.enterRace(raceData, opponents);
 *   hud.exitRace();
 *   hud.openPhone();
 *   hud.closePhone();
 *   hud.showResults(resultsObj);
 *   hud.showWheelspin(prizes);
 */

import { NotificationSystem } from './NotificationSystem.js';

// ─── Layer names ──────────────────────────────────────────────────────────────
export const HUD_LAYER = {
  GAMEPLAY:  'gameplay',   // driving / on-foot, no menus open
  PHONE:     'phone',      // phone menu overlay
  MAP:       'map',        // full-screen map
  SETUP:     'setup',      // race setup screen
  RESULTS:   'results',    // race results screen
  WHEELSPIN: 'wheelspin',  // wheelspin animation
  TITLE:     'title',      // main title / loading screen
};

// ─── Breakpoints (match Part 8 spec) ─────────────────────────────────────────
const BP_MEDIUM = 1280;
const BP_SMALL  = 900;

// ─── CSS injected once ────────────────────────────────────────────────────────
const HUD_BASE_CSS = `
  /* ── Overlay root ── */
  #hc-hud-root {
    position: fixed;
    inset: 0;
    z-index: 800;
    pointer-events: none;   /* gameplay default — menus override per-layer */
    overflow: hidden;
    font-family: 'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif;

    /* CSS custom properties — all HUD modules read from here */
    --hud-scale:       1;
    --hud-edge:        24px;
    --hud-edge-sm:     16px;
    --hud-radius:      3px;
    --hud-blur:        6px;
    --hud-bg:          rgba(0, 0, 0, 0.55);
    --hud-bg-heavy:    rgba(0, 0, 0, 0.80);
    --hud-border:      rgba(255, 255, 255, 0.12);

    /* Colour language */
    --hud-gold:        #f5c542;
    --hud-silver:      #c0c8d8;
    --hud-bronze:      #cd7f32;
    --hud-blue:        #4da6ff;
    --hud-purple:      #b06aff;
    --hud-cyan:        #00e5ff;
    --hud-red:         #ff3b3b;
    --hud-green:       #3ddc84;
    --hud-white:       rgba(255, 255, 255, 0.92);
    --hud-dim:         rgba(255, 255, 255, 0.45);

    /* Typography scale */
    --hud-text-xs:     0.72rem;
    --hud-text-sm:     0.88rem;
    --hud-text-md:     1.0rem;
    --hud-text-lg:     1.25rem;
    --hud-text-xl:     1.6rem;
    --hud-text-2xl:    2.2rem;
  }

  /* ── Clickable menu layer on top of the overlay ── */
  #hc-menu-layer {
    position: absolute;
    inset: 0;
    pointer-events: none; /* toggled to auto when a menu is open */
    z-index: 50;
  }

  /* ── Backdrop dimmer (shown behind phone / setup / results) ── */
  #hc-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0);
    transition: background 0.25s ease;
    pointer-events: none;
    z-index: 10;
  }
  #hc-backdrop.visible {
    background: rgba(0, 0, 0, 0.45);
    pointer-events: auto; /* catches clicks outside menus */
  }

  /* ── Game-state class toggles ── */
  /* When a menu is open, re-enable pointer events on the menu layer */
  #hc-hud-root.menu-open #hc-menu-layer {
    pointer-events: auto;
  }
  /* Hide all race-specific HUD when not racing */
  #hc-hud-root:not(.racing) .hc-race-only {
    display: none !important;
  }
  /* Hide driving HUD when on foot */
  #hc-hud-root.on-foot .hc-driving-only {
    display: none !important;
  }

  /* ── Responsive scaling ── */
  @media (max-width: 1280px) {
    #hc-hud-root {
      --hud-scale: 0.88;
      --hud-edge:  18px;
    }
  }
  @media (max-width: 900px) {
    #hc-hud-root {
      --hud-scale: 0.75;
      --hud-edge:  12px;
    }
  }

  /* ── Accessibility: reduce motion ── */
  @media (prefers-reduced-motion: reduce) {
    #hc-hud-root * {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* ── Colour blind modes (class applied to root) ── */
  #hc-hud-root.cb-deuteranopia {
    --hud-gold:  #e6c619;
    --hud-green: #8be0ff;
    --hud-red:   #ff8c42;
  }
  #hc-hud-root.cb-protanopia {
    --hud-gold:  #ffe066;
    --hud-green: #80d4ff;
    --hud-red:   #ff9900;
  }
  #hc-hud-root.cb-tritanopia {
    --hud-gold:  #f5c542;
    --hud-blue:  #ff6f91;
    --hud-cyan:  #ff9de2;
  }
`;

// ─── HUDManager ───────────────────────────────────────────────────────────────
export class HUDManager {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas        – Three.js renderer canvas
   * @param {object}            [opts.settings]    – initial settings snapshot
   * @param {Function}          [opts.onPauseGame] – called when HUD pauses the game world
   * @param {Function}          [opts.onResumeGame]– called when HUD resumes the game world
   */
  constructor({ canvas, saveManager = null, settings = {}, onPauseGame = () => {}, onResumeGame = () => {} }) {
    this.canvas       = canvas;
    this._save        = saveManager;   // needed by WheelspinUI / RaceSetupScreen
    this.settings     = { ...DEFAULT_SETTINGS, ...settings };
    this.onPauseGame  = onPauseGame;
    this.onResumeGame = onResumeGame;

    // Layer tracking
    this.activeLayer  = HUD_LAYER.GAMEPLAY;
    this._layerStack  = [];  // history for back-navigation

    // DOM references (built in init())
    this.root        = null;
    this.menuLayer   = null;
    this.backdrop    = null;

    // Child modules (lazy-imported and instantiated in init())
    this.notifications  = null;
    this.drivingHUD     = null;
    this.minimap        = null;
    this.raceHUD        = null;
    this.phoneMenu      = null;
    this.raceSetup      = null;
    this.raceResults    = null;
    this.wheelspin      = null;

    // Game state flags
    this._isRacing    = false;
    this._isOnFoot    = false;
    this._isPaused    = false;

    // Input handling
    this._boundKeyDown = this._onKeyDown.bind(this);
  }

  // ─── Initialisation ─────────────────────────────────────────────────────────

  /**
   * Build the DOM, inject styles, instantiate child modules.
   * Call once after the Three.js canvas is in the document.
   */
  async init() {
    this._injectBaseStyles();
    this._buildRootDOM();

    // NotificationSystem must exist before _applySettings() touches it
    this.notifications = new NotificationSystem();

    this._applySettings(this.settings);
    this._startResizeObserver();
    document.addEventListener('keydown', this._boundKeyDown);

    // Remaining modules are loaded lazily when first needed to keep
    // initial bundle small. See _lazyLoad() calls in each public method.

    return this;
  }

  // ─── DOM construction ────────────────────────────────────────────────────────

  _injectBaseStyles() {
    if (document.getElementById('hc-hud-base-styles')) return;
    const style = document.createElement('style');
    style.id = 'hc-hud-base-styles';
    style.textContent = HUD_BASE_CSS;
    document.head.appendChild(style);
  }

  _buildRootDOM() {
    this.root = document.createElement('div');
    this.root.id = 'hc-hud-root';

    this.backdrop = document.createElement('div');
    this.backdrop.id = 'hc-backdrop';

    this.menuLayer = document.createElement('div');
    this.menuLayer.id = 'hc-menu-layer';

    this.root.appendChild(this.backdrop);
    this.root.appendChild(this.menuLayer);

    // Insert immediately after the canvas in the DOM
    this.canvas.insertAdjacentElement('afterend', this.root);
  }

  // ─── Per-frame update ────────────────────────────────────────────────────────

  /**
   * Called every game-loop tick.
   * Routes data to whichever child modules need it this frame.
   *
   * @param {object} playerState  – from driving physics / player controller
   * @param {object} [raceState]  – from RaceManager (null when not racing)
   */
  update(playerState, raceState = null) {
    if (!this.root) return;
    if (this._isPaused && this.activeLayer === HUD_LAYER.GAMEPLAY) return;

    if (this.drivingHUD && !this._isOnFoot) {
      this.drivingHUD.update(playerState);
    }
    if (this.minimap) {
      this.minimap.update(playerState, raceState);
    }
    if (this.raceHUD && this._isRacing && raceState) {
      this.raceHUD.update(raceState);
    }
  }

  // ─── Layer transitions ───────────────────────────────────────────────────────

  /**
   * Transition to a new HUD layer.
   * Pushes current layer to the stack so back() works.
   *
   * @param {string} layer  – HUD_LAYER constant
   * @param {boolean} [pushHistory=true]
   */
  _setLayer(layer, pushHistory = true) {
    if (this.activeLayer === layer) return;
    if (pushHistory) this._layerStack.push(this.activeLayer);
    this.activeLayer = layer;
    this._syncLayerDOM();
  }

  /** Navigate back to the previous layer (e.g., Escape from map → phone). */
  back() {
    const prev = this._layerStack.pop();
    if (prev) {
      this.activeLayer = prev;
      this._syncLayerDOM();
    } else {
      this.closeAllMenus();
    }
  }

  /** Sync root classes and backdrop visibility to the current layer. */
  _syncLayerDOM() {
    const menuLayers = [
      HUD_LAYER.PHONE,
      HUD_LAYER.MAP,
      HUD_LAYER.SETUP,
      HUD_LAYER.RESULTS,
      HUD_LAYER.WHEELSPIN,
    ];

    const isMenu = menuLayers.includes(this.activeLayer);

    this.root.classList.toggle('menu-open', isMenu);
    this.backdrop.classList.toggle('visible', isMenu);

    if (isMenu) {
      this.onPauseGame();
      this._isPaused = true;
    } else {
      this.onResumeGame();
      this._isPaused = false;
    }
  }

  // ─── Public state-change API ─────────────────────────────────────────────────

  /** Switch from driving to on-foot mode (hides speedometer, etc.) */
  setOnFoot(isOnFoot) {
    this._isOnFoot = isOnFoot;
    this.root.classList.toggle('on-foot', isOnFoot);
  }

  /**
   * Called by RaceManager when a race begins.
   * Shows race-only HUD elements (position, lap timer, etc.)
   *
   * @param {object}   raceData   – from RaceData.js
   * @param {object[]} opponents  – from RaceManager.spawnOpponents()
   */
  async enterRace(raceData, opponents) {
    this._isRacing = true;
    this.root.classList.add('racing');

    if (!this.raceHUD) {
      const { RaceHUD } = await import('./RaceHUD.js');
      this.raceHUD = new RaceHUD({ container: this.root, notifications: this.notifications });
    }
    this.raceHUD.startRace(raceData, opponents);
  }

  /** Called by RaceManager when the race ends (before results screen). */
  exitRace() {
    this._isRacing = false;
    this.root.classList.remove('racing');
    this.raceHUD?.endRace();
  }

  /** Open the phone menu (Escape / pause). */
  async openPhone() {
    if (!this.phoneMenu) {
      const { PhoneMenu } = await import('./PhoneMenu.js');
      this.phoneMenu = new PhoneMenu({
        container:    this.menuLayer,
        hudManager:   this,
        notifications: this.notifications,
      });
    }
    this._setLayer(HUD_LAYER.PHONE);
    this.phoneMenu.open();
  }

  /** Close the phone menu and return to gameplay. */
  closePhone() {
    this.phoneMenu?.close();
    this._setLayer(HUD_LAYER.GAMEPLAY, false);
    this._layerStack = []; // clear history on explicit close
  }

  /** Close all menus and return to gameplay. */
  closeAllMenus() {
    this.phoneMenu?.close();
    this.raceSetup?.hide();
    this._layerStack = [];
    this._setLayer(HUD_LAYER.GAMEPLAY, false);
  }

  /**
   * Show the race setup screen.
   * @param {object}   raceData
   * @param {object[]} opponents
   * @param {Function} onConfirm  – called when player hits Start Race
   * @param {Function} onCancel
   */
  async showRaceSetup(raceData, opponents, onConfirm, onCancel) {
    if (!this.raceSetup) {
      const { RaceSetupScreen } = await import('./RaceSetupScreen.js');
      // RaceSetupScreen expects positional args: (hudRoot, settingsStore, raceManager)
      // raceManager is null here — it will be supplied per-race via showRaceSetup()
      this.raceSetup = new RaceSetupScreen(this.menuLayer, this.settings, null);
    }
    this._setLayer(HUD_LAYER.SETUP);
    this.raceSetup.show(raceData, opponents, onConfirm, onCancel);
  }

  /**
   * Show the race results screen.
   * @param {object}   results    – from RaceManager.onRaceEnd
   * @param {Function} onRaceAgain
   * @param {Function} onNextEvent
   * @param {Function} onReturnToCity
   * @param {Function} onWheelspin
   */
  async showResults(results, { onRaceAgain, onNextEvent, onReturnToCity, onWheelspin } = {}) {
    if (!this.raceResults) {
      const { RaceResultsScreen } = await import('./RaceResultsScreen.js');
      this.raceResults = new RaceResultsScreen({ container: this.menuLayer });
    }
    this._setLayer(HUD_LAYER.RESULTS);
    this.raceResults.show(results, { onRaceAgain, onNextEvent, onReturnToCity, onWheelspin });
  }

  /**
   * Show the wheelspin UI.
   * @param {object[]} prizes  – array of { type, label, value, icon }
   * @param {number}   [count] – 1 = standard, 3 = super wheelspin
   * @param {Function} onClaim
   */
  async showWheelspin(prizes, count = 1, onClaim = () => {}) {
    if (!this.wheelspin) {
      const { WheelspinUI } = await import('./WheelspinUI.js');
      // WheelspinUI expects positional args: (hudRoot, inventoryStore, settingsStore)
      this.wheelspin = new WheelspinUI(this.root, this._save?.inventory ?? null, this.settings);
    }
    this._setLayer(HUD_LAYER.WHEELSPIN);
    this.wheelspin.show(prizes, count, onClaim);
  }

  // ─── Settings application ─────────────────────────────────────────────────

  /**
   * Apply a full or partial settings update.
   * Called from SettingsMenu when the player changes a value.
   *
   * @param {object} patch  – partial settings object
   */
  applySettings(patch) {
    Object.assign(this.settings, patch);
    this._applySettings(this.settings);
  }

  _applySettings(s) {
    if (!this.root) return;

    // UI scale
    const scaleMap = { '80%': 0.80, '100%': 1.00, '120%': 1.20, '150%': 1.50 };
    const scale = scaleMap[s.uiScale] ?? 1.00;
    this.root.style.setProperty('--hud-user-scale', scale);
    this.root.style.fontSize = `${scale * 16}px`;

    // Colour blind mode
    this.root.classList.remove('cb-deuteranopia', 'cb-protanopia', 'cb-tritanopia');
    if (s.colourBlindMode && s.colourBlindMode !== 'Off') {
      this.root.classList.add(`cb-${s.colourBlindMode.toLowerCase()}`);
    }

    // Reduce motion (adds class; CSS media query also handles OS-level setting)
    this.root.classList.toggle('reduce-motion', !!s.reduceMotion);

    // High contrast
    this.root.classList.toggle('high-contrast', !!s.highContrast);

    // Speed lines and chromatic aberration toggles — forwarded to DrivingHUD
    this.drivingHUD?.setEffects({
      speedLines:          s.speedLines          ?? true,
      chromaticAberration: s.chromaticAberration ?? true,
    });

    // Radio chatter on/off
    if (this.notifications) {
      if (s.radioChatter === false) {
        this.notifications.showRadio = () => {};
      } else {
        this.notifications.showRadio = NotificationSystem.prototype.showRadio.bind(this.notifications);
      }
    }

    // Minimap rotation mode
    this.minimap?.setRotationMode(s.minimapRotation ?? 'rotate');
  }

  // ─── Keyboard / input routing ─────────────────────────────────────────────

  _onKeyDown(e) {
    switch (e.key) {
      case 'Escape':
        this._handleEscape();
        break;
      case 'm':
      case 'M':
        if (this.activeLayer === HUD_LAYER.GAMEPLAY) this._openMap();
        else if (this.activeLayer === HUD_LAYER.MAP) this.back();
        break;
      case 'Tab':
        if (this.activeLayer === HUD_LAYER.GAMEPLAY && this._isRacing) {
          e.preventDefault();
          this.raceHUD?.toggleLeaderboard();
        }
        break;
    }
  }

  _handleEscape() {
    switch (this.activeLayer) {
      case HUD_LAYER.GAMEPLAY:
        this.openPhone();
        break;
      case HUD_LAYER.PHONE:
        this.closePhone();
        break;
      case HUD_LAYER.MAP:
        this.back();
        break;
      case HUD_LAYER.SETUP:
        this.raceSetup?.triggerCancel();
        this.closeAllMenus();
        break;
      case HUD_LAYER.RESULTS:
        // Escape on results goes to city — same as "Return to City" button
        this.raceResults?.triggerReturnToCity();
        break;
      case HUD_LAYER.WHEELSPIN:
        // Can't escape out of wheelspin — must claim first
        break;
      default:
        this.closeAllMenus();
    }
  }

  async _openMap() {
    // Full-screen map is a tab within PhoneMenu in the spec,
    // but can also be triggered directly with M key.
    await this.openPhone();
    this.phoneMenu?.switchTab('map');
    this._setLayer(HUD_LAYER.MAP);
  }

  // ─── Responsive observer ──────────────────────────────────────────────────

  _startResizeObserver() {
    if (!window.ResizeObserver) return;
    const ro = new ResizeObserver(() => this._onResize());
    ro.observe(document.documentElement);
  }

  _onResize() {
    const w = window.innerWidth;
    let breakpoint = 'large';
    if (w <= BP_SMALL)  breakpoint = 'small';
    else if (w <= BP_MEDIUM) breakpoint = 'medium';

    this.root?.setAttribute('data-bp', breakpoint);
    this.minimap?.onResize(breakpoint);
    this.raceHUD?.onResize(breakpoint);
    this.phoneMenu?.onResize(breakpoint);
  }

  // ─── Teardown ─────────────────────────────────────────────────────────────

  destroy() {
    document.removeEventListener('keydown', this._boundKeyDown);
    this.notifications?.destroy();
    this.root?.remove();
  }
}

// ─── Default settings ─────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  graphicsPreset:      'low',         // safe default for all hardware
  uiScale:             '100%',
  colourBlindMode:     'Off',
  reduceMotion:        false,
  highContrast:        false,
  speedLines:          true,
  chromaticAberration: true,
  radioChatter:        true,
  minimapRotation:     'rotate',  // 'rotate' | 'north-up'
};

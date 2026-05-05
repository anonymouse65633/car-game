/**
 * NotificationSystem.js
 * Part 8 — UI, HUD & Menus (Section 8.2.5 / 8.3)
 *
 * Manages all floating toast notifications shown during gameplay —
 * both in-car and on-foot. Injected into the DOM by HUDManager.
 *
 * Notification types:
 *   reward      – "Bonus Board Collected! +1,500 CR"        (gold)
 *   info        – "Landmark Discovered: The Grand Bridge"   (blue)
 *   personalBest– "New Personal Best!"                      (purple, large)
 *   slipstream  – "Slipstream Active!"                      (cyan, brief)
 *   wrongWay    – "Wrong Way!"                              (red, large, flashing)
 *   radio       – AI Gemini commentary                      (white/dim, small)
 *
 * Radio chatter has its own 20-second cooldown and renders in a
 * separate box below the minimap (section 8.2.3).
 *
 * All animations are CSS-only (no GSAP dependency here).
 * GSAP is reserved for Wheelspin and Results screens.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTIFICATION_TYPES = {
  reward:      { color: 'var(--hud-gold)',    duration: 3500, large: false, flash: false },
  info:        { color: 'var(--hud-blue)',    duration: 4000, large: false, flash: false },
  personalBest:{ color: 'var(--hud-purple)',  duration: 3000, large: true,  flash: false },
  slipstream:  { color: 'var(--hud-cyan)',    duration: 1800, large: false, flash: false },
  wrongWay:    { color: 'var(--hud-red)',     duration: 0,    large: true,  flash: true  },
  radio:       { color: 'var(--hud-white)',   duration: 4000, large: false, flash: false },
};

// Maximum toasts visible in the main stack at once
const MAX_VISIBLE = 4;

// Cooldown between radio chatter notifications (ms)
const RADIO_COOLDOWN_MS = 20_000;

// CSS injected once into <head>
const NOTIFICATION_CSS = `
  :root {
    --hud-gold:   #f5c542;
    --hud-blue:   #4da6ff;
    --hud-purple: #b06aff;
    --hud-cyan:   #00e5ff;
    --hud-red:    #ff3b3b;
    --hud-white:  rgba(255,255,255,0.85);
    --hud-font:   'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif;
  }

  /* ── Toast Stack (top-centre, below lap timer) ── */
  #hc-notifications {
    position: fixed;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    z-index: 900;
    pointer-events: none;
    width: 440px;
  }

  .hc-toast {
    font-family: var(--hud-font);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 8px 20px;
    border-radius: 3px;
    backdrop-filter: blur(6px);
    background: rgba(0,0,0,0.55);
    border-left: 3px solid currentColor;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;

    /* slide down + fade in */
    animation: hc-toast-in 0.18s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    will-change: transform, opacity;
  }

  .hc-toast.large {
    font-size: 1.25rem;
    padding: 10px 24px;
    border-left-width: 4px;
  }

  .hc-toast:not(.large) {
    font-size: 0.88rem;
  }

  .hc-toast.removing {
    animation: hc-toast-out 0.22s ease-in forwards;
  }

  .hc-toast.flash {
    animation:
      hc-toast-in 0.18s cubic-bezier(0.22, 1, 0.36, 1) forwards,
      hc-toast-flash 0.5s ease-in-out 0.18s infinite;
  }

  .hc-toast.flash.removing {
    animation: hc-toast-out 0.22s ease-in forwards;
  }

  @keyframes hc-toast-in {
    from { opacity: 0; transform: translateY(-10px) scaleY(0.9); }
    to   { opacity: 1; transform: translateY(0)     scaleY(1);   }
  }

  @keyframes hc-toast-out {
    from { opacity: 1; transform: translateY(0)    scaleX(1); }
    to   { opacity: 0; transform: translateY(-6px) scaleX(0.95); }
  }

  @keyframes hc-toast-flash {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }

  /* ── Radio Chatter Box (below minimap, bottom-left) ── */
  #hc-radio-chatter {
    position: fixed;
    bottom: 210px;   /* sits above the minimap */
    left: 24px;
    width: 280px;
    z-index: 900;
    pointer-events: none;
  }

  .hc-radio-msg {
    font-family: var(--hud-font);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--hud-white);
    background: rgba(0,0,0,0.50);
    backdrop-filter: blur(4px);
    border-left: 2px solid rgba(255,255,255,0.3);
    padding: 6px 12px;
    border-radius: 2px;
    animation: hc-radio-in 0.25s ease forwards;
    will-change: opacity, transform;
  }

  .hc-radio-msg .hc-radio-name {
    color: var(--hud-cyan);
    margin-right: 4px;
  }

  .hc-radio-msg.removing {
    animation: hc-radio-out 0.3s ease forwards;
  }

  @keyframes hc-radio-in {
    from { opacity: 0; transform: translateX(-8px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  @keyframes hc-radio-out {
    from { opacity: 1; }
    to   { opacity: 0; }
  }

  /* ── Responsive ── */
  @media (max-width: 1280px) {
    #hc-notifications { width: 360px; }
    .hc-toast.large   { font-size: 1.1rem; }
  }

  @media (max-width: 900px) {
    #hc-notifications { width: 92vw; top: 48px; }
    #hc-radio-chatter { width: 220px; }
  }
`;

// ─── NotificationSystem ───────────────────────────────────────────────────────

export class NotificationSystem {
  constructor() {
    /** @type {HTMLElement} Main toast stack container */
    this._stack = null;
    /** @type {HTMLElement} Radio chatter container */
    this._radioBox = null;
    /** @type {HTMLElement|null} Active "Wrong Way" toast (persistent until cleared) */
    this._wrongWayToast = null;
    /** @type {HTMLElement|null} Active radio chatter element */
    this._radioEl = null;
    /** @type {number} Timestamp of last radio chatter shown */
    this._lastRadioTime = -RADIO_COOLDOWN_MS;
    /** @type {Array<{el: HTMLElement, timerId: number}>} Active toasts */
    this._active = [];

    this._injectStyles();
    this._buildDOM();
  }

  // ─── Initialisation ────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('hc-notification-styles')) return;
    const style = document.createElement('style');
    style.id = 'hc-notification-styles';
    style.textContent = NOTIFICATION_CSS;
    document.head.appendChild(style);
  }

  _buildDOM() {
    // Toast stack
    this._stack = document.createElement('div');
    this._stack.id = 'hc-notifications';
    document.body.appendChild(this._stack);

    // Radio chatter box
    this._radioBox = document.createElement('div');
    this._radioBox.id = 'hc-radio-chatter';
    document.body.appendChild(this._radioBox);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Show a toast notification.
   *
   * @param {string} message   – Display text
   * @param {'reward'|'info'|'personalBest'|'slipstream'|'wrongWay'|'radio'} type
   * @param {object} [opts]
   * @param {number}  [opts.duration]  – Override auto-dismiss duration (ms). 0 = persistent.
   * @param {string}  [opts.icon]      – Optional emoji/icon prefix
   */
  show(message, type = 'info', opts = {}) {
    // Radio chatter is handled separately
    if (type === 'radio') {
      this._showRadio(message, opts);
      return;
    }

    // Wrong Way is a persistent singleton
    if (type === 'wrongWay') {
      this._showWrongWay(message);
      return;
    }

    const config = NOTIFICATION_TYPES[type] ?? NOTIFICATION_TYPES.info;

    // Trim stack if at capacity — remove the oldest
    if (this._active.length >= MAX_VISIBLE) {
      this._removeToast(this._active[0]);
    }

    // Build element
    const el = document.createElement('div');
    el.className = ['hc-toast', config.large ? 'large' : '', config.flash ? 'flash' : '']
      .filter(Boolean).join(' ');
    el.style.color = config.color;
    el.textContent = opts.icon ? `${opts.icon}  ${message}` : message;

    this._stack.appendChild(el);

    const duration = opts.duration ?? config.duration;
    let timerId = null;

    if (duration > 0) {
      timerId = setTimeout(() => this._removeToast(entry), duration);
    }

    const entry = { el, timerId };
    this._active.push(entry);
  }

  /**
   * Immediately clear the "Wrong Way" toast if it's showing.
   * Call this when the player corrects their direction.
   */
  clearWrongWay() {
    if (!this._wrongWayToast) return;
    this._removeElement(this._wrongWayToast);
    this._wrongWayToast = null;
  }

  /**
   * Show radio chatter from an AI driver (Gemini commentary).
   * Respects the 20-second cooldown — silently drops if too soon.
   *
   * @param {string} driverName
   * @param {string} text
   */
  showRadio(driverName, text) {
    this._showRadio(text, { driverName });
  }

  /**
   * Remove all active notifications immediately (e.g., on menu open).
   */
  clearAll() {
    for (const entry of [...this._active]) {
      this._removeToast(entry);
    }
    this.clearWrongWay();
    this._clearRadio();
  }

  /**
   * Tear down DOM elements and styles. Call on game teardown.
   */
  destroy() {
    this.clearAll();
    this._stack?.remove();
    this._radioBox?.remove();
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _showWrongWay(message) {
    // Only one wrong-way toast at a time
    if (this._wrongWayToast) return;

    const config = NOTIFICATION_TYPES.wrongWay;
    const el = document.createElement('div');
    el.className = 'hc-toast large flash';
    el.style.color = config.color;
    el.textContent = message || 'Wrong Way!';

    this._stack.prepend(el); // always at top
    this._wrongWayToast = el;
  }

  _showRadio(text, { driverName = null, duration } = {}) {
    const now = Date.now();
    if (now - this._lastRadioTime < RADIO_COOLDOWN_MS) return; // cooldown
    this._lastRadioTime = now;

    // Remove previous radio message if still showing
    this._clearRadio();

    const el = document.createElement('div');
    el.className = 'hc-radio-msg';

    if (driverName) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'hc-radio-name';
      nameSpan.textContent = `${driverName}:`;
      el.appendChild(nameSpan);
      el.appendChild(document.createTextNode(` ${text}`));
    } else {
      el.textContent = text;
    }

    this._radioBox.appendChild(el);
    this._radioEl = el;

    const ms = duration ?? NOTIFICATION_TYPES.radio.duration;
    setTimeout(() => this._clearRadio(), ms);
  }

  _clearRadio() {
    if (!this._radioEl) return;
    this._removeElement(this._radioEl);
    this._radioEl = null;
  }

  _removeToast(entry) {
    if (!entry) return;
    const idx = this._active.indexOf(entry);
    if (idx !== -1) this._active.splice(idx, 1);
    if (entry.timerId) clearTimeout(entry.timerId);
    this._removeElement(entry.el);
  }

  /** Plays the exit animation then removes the element from the DOM. */
  _removeElement(el) {
    if (!el || !el.parentNode) return;
    el.classList.add('removing');
    // Wait for animation to finish before removing from DOM
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Safety fallback in case animationend never fires
    setTimeout(() => el.remove(), 400);
  }
}

// ─── Convenience helpers (mirrors the game's colour language) ─────────────────

/**
 * Quick factory so callers don't need to remember type strings.
 * Used by RaceManager, world event system, economy system, etc.
 *
 * @example
 * notifications.reward('+1,500 CR — Bonus Board!');
 * notifications.wrongWay();
 * notifications.radio('Vega', 'Not letting you through.');
 */
NotificationSystem.prototype.reward      = function(msg, opts) { this.show(msg, 'reward',       opts); };
NotificationSystem.prototype.info        = function(msg, opts) { this.show(msg, 'info',          opts); };
NotificationSystem.prototype.personalBest= function(msg, opts) { this.show(msg, 'personalBest',  opts); };
NotificationSystem.prototype.slipstream  = function(msg, opts) { this.show(msg, 'slipstream',    opts); };
NotificationSystem.prototype.wrongWay    = function()          { this.show('Wrong Way!', 'wrongWay'); };
NotificationSystem.prototype.radio       = function(name, text){ this.showRadio(name, text); };

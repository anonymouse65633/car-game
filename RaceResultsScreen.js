/**
 * RaceResultsScreen.js
 * Part 8 — UI, HUD & Menus (Section 8.10)
 *
 * Post-race full-screen overlay. Shown immediately after crossing the
 * finish line — called by HUDManager.showResults(results, callbacks).
 *
 * Layout:
 *   Background   — dark podium gradient with subtle animated bokeh
 *   Left panel   — full leaderboard (all racers, times, gaps)
 *   Right panel  — rewards breakdown: credits line-by-line, XP bar fill,
 *                  wheelspin indicator, accolade chips
 *   Top banner   — personal best slide-in (purple) if isNewPB
 *   Bottom bar   — four action buttons
 *
 * Expected results object shape (from RaceManager.onRaceEnd):
 * {
 *   position:           number,      // 1-based finish position
 *   totalRacers:        number,
 *   raceTimeMs:         number,      // player's total race time
 *   bestLapMs:          number|null, // null for non-circuit events
 *   isNewPB:            boolean,
 *   newPBText:          string|null, // formatted "1:28.441"
 *   racers: [{
 *     name:             string,
 *     isPlayer:         boolean,
 *     position:         number,
 *     raceTimeMs:       number,
 *     gapMs:            number,      // 0 for race winner
 *     archetype:        string|null, // AI archetypes from RaceManager
 *   }],
 *   creditsBase:        number,
 *   creditsMultipliers: [{ label: string, value: number }],
 *   creditsTotal:       number,
 *   xpEarned:           number,
 *   xpBefore:           number,
 *   xpAfter:            number,
 *   xpToNextLevel:      number,      // full XP needed for current level
 *   levelBefore:        number,
 *   levelAfter:         number,      // equals levelBefore unless leveled up
 *   wheelspinCount:     number,      // 0 = none, 1 = standard, 3 = super
 *   accolades:          string[],    // e.g. ["First Win in Racing District!"]
 * }
 *
 * GSAP is used for the XP bar fill animation and credit count-up.
 * A lightweight CSS-transition fallback is used if GSAP is unavailable.
 *
 * Note on the podium environment mentioned in the spec: the 3D podium is a
 * Three.js concern (RaceManager hands off the camera). This file only manages
 * the DOM overlay that sits on top of it. The background gradient fakes the
 * podium atmosphere if the 3D scene is not yet visible.
 */

// ─── Archetype icons (mirror RaceHUD.js) ─────────────────────────────────────

const ARCHETYPE_ICON = {
  Pusher:   '🔥',
  Pacer:    '📐',
  Blocker:  '🛡',
  Hunter:   '🎯',
  Wildcard: '🎲',
};

// ─── Position colours (mirror RaceHUD.js) ─────────────────────────────────────

const POSITION_COLOUR = {
  1: 'var(--hud-gold)',
  2: 'var(--hud-silver)',
  3: 'var(--hud-bronze)',
};

const POSITION_LABEL = { 1: '1ST', 2: '2ND', 3: '3RD' };

// Medal background tints used on the player's leaderboard row.
const POSITION_ROW_TINT = {
  1: 'rgba(245, 197,  66, 0.12)',
  2: 'rgba(192, 200, 216, 0.10)',
  3: 'rgba(205, 127,  50, 0.10)',
};

// ─── Formatters ───────────────────────────────────────────────────────────────

/** Format milliseconds as M:SS.mmm */
const formatMs = (ms) => {
  if (ms == null || ms < 0) return '--:--.---';
  const m   = Math.floor(ms / 60_000);
  const s   = Math.floor((ms % 60_000) / 1000);
  const mil = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(mil).padStart(3, '0')}`;
};

/** Format a gap in ms as "+1.4s" or "+1:02" for gaps ≥ 60 s. */
const formatGapMs = (ms) => {
  const sec = ms / 1000;
  if (sec >= 60) {
    return `+${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  }
  return `+${sec.toFixed(1)}s`;
};

/** Format a credit amount with thousands separator: 12500 → "12,500" */
const formatCR = (n) => Math.round(n).toLocaleString('en-US');

// ─── CSS ──────────────────────────────────────────────────────────────────────

const RESULTS_CSS = `
/* ════════════════════════════════════════════════════════════════════════════
   Root overlay
════════════════════════════════════════════════════════════════════════════ */
#rrs-root {
  position: absolute;
  inset: 0;
  z-index: 60;                   /* sits within #hc-menu-layer */
  display: flex;
  flex-direction: column;
  font-family: 'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif;
  pointer-events: auto;

  /* Podium atmosphere gradient — overlaid on top of the live 3D scene.
     The 3D camera will frame the podium; this just deepens the mood. */
  background:
    linear-gradient(
      170deg,
      rgba(4, 6, 14, 0.82) 0%,
      rgba(8, 12, 30, 0.72) 55%,
      rgba(4, 6, 14, 0.90) 100%
    );

  /* Slide up from below on open */
  transform: translateY(100%);
  opacity: 0;
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity   320ms ease;
}

#rrs-root.visible {
  transform: translateY(0);
  opacity: 1;
}

/* ── Bokeh particles (purely decorative, CSS-animated) ─────────────────── */
#rrs-bokeh {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.rrs-bokeh-dot {
  position: absolute;
  border-radius: 50%;
  filter: blur(18px);
  opacity: 0;
  animation: rrs-bokeh-float linear infinite;
}

@keyframes rrs-bokeh-float {
  0%   { opacity: 0;    transform: translateY(0)    scale(0.8); }
  15%  { opacity: 0.18; }
  85%  { opacity: 0.14; }
  100% { opacity: 0;    transform: translateY(-90px) scale(1.1); }
}

/* ════════════════════════════════════════════════════════════════════════════
   Personal Best banner (slides down from top)
════════════════════════════════════════════════════════════════════════════ */
#rrs-pb-banner {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%) translateY(-100%);
  z-index: 10;
  background: linear-gradient(90deg, #6d28d9 0%, #a855f7 50%, #6d28d9 100%);
  color: #fff;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  padding: 10px 40px;
  border-radius: 0 0 6px 6px;
  box-shadow: 0 6px 28px rgba(168, 85, 247, 0.55);
  white-space: nowrap;
  transition: transform 400ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

#rrs-pb-banner.visible {
  transform: translateX(-50%) translateY(0);
}

/* ════════════════════════════════════════════════════════════════════════════
   Main content area (position badge + two panels)
════════════════════════════════════════════════════════════════════════════ */
#rrs-content {
  position: relative;
  z-index: 1;
  flex: 1;
  display: grid;
  grid-template-columns: 56px 1fr 1fr;
  grid-template-rows: 1fr;
  column-gap: 0;
  overflow: hidden;
}

/* ── Position medal strip (far left) ───────────────────────────────────── */
#rrs-medal {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 0 0 10px;
}

.rrs-medal-badge {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 3px solid currentColor;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.0rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  text-shadow: 0 0 12px currentColor;
  box-shadow: 0 0 20px -4px currentColor;
  transition: box-shadow 0.4s ease;
}

.rrs-medal-label {
  font-size: 0.60rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.55;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
}

/* ── Leaderboard panel (centre) ─────────────────────────────────────────── */
#rrs-leaderboard {
  display: flex;
  flex-direction: column;
  padding: 28px 20px 20px 24px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.12) transparent;
}

#rrs-leaderboard::-webkit-scrollbar { width: 4px; }
#rrs-leaderboard::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.15);
  border-radius: 2px;
}

.rrs-lb-heading {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.30);
  margin-bottom: 12px;
}

.rrs-lb-row {
  display: grid;
  grid-template-columns: 44px 1fr 100px 100px;
  align-items: center;
  padding: 9px 12px;
  border-radius: 3px;
  border-left: 2px solid transparent;
  margin-bottom: 3px;
  font-size: 0.92rem;
  font-weight: 600;
  color: rgba(255,255,255,0.60);
  transition: background 0.2s ease;
}

.rrs-lb-row.is-player {
  color: #fff;
  border-left-color: currentColor;
  background: var(--_row-tint, rgba(255,255,255,0.06));
}

.rrs-lb-pos {
  font-size: 0.80rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.rrs-lb-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.rrs-lb-icon {
  font-size: 0.75rem;
  opacity: 0.80;
}

.rrs-lb-time {
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
  text-align: right;
}

.rrs-lb-gap {
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
  color: rgba(255,255,255,0.35);
  text-align: right;
}

.rrs-lb-row.is-player .rrs-lb-gap {
  color: rgba(255,255,255,0.55);
}

/* ── Rewards panel (right) ──────────────────────────────────────────────── */
#rrs-rewards {
  display: flex;
  flex-direction: column;
  padding: 28px 28px 20px 20px;
  border-left: 1px solid rgba(255,255,255,0.07);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.12) transparent;
}

#rrs-rewards::-webkit-scrollbar { width: 4px; }
#rrs-rewards::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.15);
  border-radius: 2px;
}

.rrs-section-label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.30);
  margin-bottom: 10px;
}

/* Credits breakdown */
.rrs-cr-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  font-size: 0.88rem;
  font-weight: 600;
  color: rgba(255,255,255,0.65);
  border-bottom: 1px solid rgba(255,255,255,0.04);
  opacity: 0;
  transform: translateX(8px);
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.rrs-cr-row.revealed {
  opacity: 1;
  transform: translateX(0);
}

.rrs-cr-row.is-total {
  color: var(--hud-gold);
  font-size: 1.05rem;
  font-weight: 700;
  border-bottom: none;
  border-top: 1px solid rgba(245, 197, 66, 0.25);
  padding-top: 9px;
  margin-top: 3px;
}

.rrs-cr-value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* XP section */
.rrs-xp-section {
  margin-top: 18px;
}

.rrs-xp-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}

.rrs-xp-earned {
  font-size: 1.0rem;
  font-weight: 700;
  color: var(--hud-blue);
}

.rrs-xp-level {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255,255,255,0.40);
  letter-spacing: 0.06em;
}

.rrs-xp-track {
  height: 8px;
  background: rgba(255,255,255,0.10);
  border-radius: 4px;
  overflow: hidden;
}

.rrs-xp-fill {
  height: 100%;
  background: linear-gradient(90deg, #4da6ff, #00e5ff);
  border-radius: 4px;
  width: 0%;
  transition: width 1.2s cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: 0 0 10px rgba(77, 166, 255, 0.60);
}

/* Level-up badge — appears only if levelAfter > levelBefore */
.rrs-levelup {
  margin-top: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(90deg, rgba(77,166,255,0.18), rgba(0,229,255,0.12));
  border: 1px solid rgba(77,166,255,0.40);
  border-radius: 3px;
  padding: 5px 12px;
  font-size: 0.80rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--hud-blue);
  text-transform: uppercase;
  display: none;
}

.rrs-levelup.visible { display: inline-flex; }

/* Wheelspin indicator */
.rrs-wheelspin {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(245, 197, 66, 0.07);
  border: 1px solid rgba(245, 197, 66, 0.28);
  border-radius: 4px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
  display: none;
}

.rrs-wheelspin.visible   { display: flex; }
.rrs-wheelspin:hover     { background: rgba(245, 197, 66, 0.13); border-color: rgba(245,197,66,0.50); }

.rrs-wheelspin-icon {
  font-size: 1.5rem;
  animation: rrs-spin-pulse 2s ease-in-out infinite;
}

@keyframes rrs-spin-pulse {
  0%, 100% { transform: rotate(0deg)   scale(1.00); }
  50%       { transform: rotate(18deg) scale(1.10); }
}

.rrs-wheelspin-text {
  display: flex;
  flex-direction: column;
}

.rrs-wheelspin-title {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--hud-gold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rrs-wheelspin-hint {
  font-size: 0.72rem;
  color: rgba(255,255,255,0.35);
  margin-top: 1px;
}

/* Accolades */
.rrs-accolades {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rrs-accolade-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.05);
  border-left: 2px solid rgba(255,255,255,0.20);
  border-radius: 2px;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(255,255,255,0.75);
  opacity: 0;
  transform: translateX(10px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.rrs-accolade-chip.revealed {
  opacity: 1;
  transform: translateX(0);
}

.rrs-accolade-icon {
  font-size: 1.0rem;
  flex-shrink: 0;
}

/* ════════════════════════════════════════════════════════════════════════════
   Bottom action bar
════════════════════════════════════════════════════════════════════════════ */
#rrs-actions {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 16px 28px 20px;
  border-top: 1px solid rgba(255,255,255,0.06);
  background: rgba(0,0,0,0.35);
  backdrop-filter: blur(8px);
}

.rrs-btn {
  font-family: 'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 10px 24px;
  border-radius: 3px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease,
              transform 0.12s ease, box-shadow 0.18s ease;
  white-space: nowrap;
}

.rrs-btn:focus-visible {
  outline: 2px solid var(--hud-blue);
  outline-offset: 3px;
}

.rrs-btn:active { transform: scale(0.97); }

/* Primary — Race Again */
.rrs-btn-primary {
  background: var(--hud-green, #3ddc84);
  color: #000;
  border-color: transparent;
}
.rrs-btn-primary:hover {
  background: #55e898;
  box-shadow: 0 0 20px rgba(61, 220, 132, 0.45);
}

/* Secondary — Next Event */
.rrs-btn-secondary {
  background: rgba(77,166,255,0.15);
  color: var(--hud-blue);
  border-color: rgba(77,166,255,0.35);
}
.rrs-btn-secondary:hover {
  background: rgba(77,166,255,0.25);
  border-color: rgba(77,166,255,0.60);
}

/* Ghost — Return to City */
.rrs-btn-ghost {
  background: transparent;
  color: rgba(255,255,255,0.60);
  border-color: rgba(255,255,255,0.18);
}
.rrs-btn-ghost:hover {
  color: #fff;
  border-color: rgba(255,255,255,0.45);
}

/* Gold — Spin Wheelspin */
.rrs-btn-gold {
  background: linear-gradient(90deg, #c89a10, #f5c542);
  color: #000;
  border-color: transparent;
  display: none;
}
.rrs-btn-gold.visible {
  display: block;
}
.rrs-btn-gold:hover {
  box-shadow: 0 0 22px rgba(245, 197, 66, 0.55);
}

/* ════════════════════════════════════════════════════════════════════════════
   Responsive
════════════════════════════════════════════════════════════════════════════ */
@media (max-width: 1280px) {
  #rrs-content           { grid-template-columns: 44px 1fr 1fr; }
  .rrs-lb-row            { grid-template-columns: 38px 1fr 90px 86px; }
  .rrs-medal-badge       { width: 38px; height: 38px; font-size: 0.88rem; }
}

@media (max-width: 900px) {
  #rrs-content {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
    overflow-y: auto;
  }
  #rrs-medal    { flex-direction: row; padding: 14px 16px 0; justify-content: flex-start; }
  .rrs-medal-label { writing-mode: initial; transform: none; font-size: 0.68rem; }
  #rrs-leaderboard  { padding: 12px 16px; }
  #rrs-rewards      { border-left: none; border-top: 1px solid rgba(255,255,255,0.07); padding: 12px 16px; }
  .rrs-lb-row       { grid-template-columns: 36px 1fr 80px; }
  .rrs-lb-gap       { display: none; }
  #rrs-actions { flex-wrap: wrap; gap: 8px; }
  .rrs-btn      { flex: 1 1 calc(50% - 8px); text-align: center; }
}
`;

// ─── RaceResultsScreen ────────────────────────────────────────────────────────

export class RaceResultsScreen {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container  HUDManager's menu layer element.
   */
  constructor({ container }) {
    this._container = container;
    this._visible   = false;

    // Saved callbacks (set on show())
    this._onRaceAgain      = null;
    this._onNextEvent      = null;
    this._onReturnToCity   = null;
    this._onWheelspin      = null;

    // Refs to animated elements (set in _build())
    this._root        = null;
    this._pbBanner    = null;
    this._lbBody      = null;
    this._crRows      = null;
    this._xpFill      = null;
    this._xpEarned    = null;
    this._xpLevel     = null;
    this._levelUp     = null;
    this._wheelspinEl = null;
    this._accolades   = null;
    this._btnWheelspin= null;

    this._revealTimers = [];   // setTimeout ids, cleared on hide()

    this._injectCSS();
    this._build();
    this._buildBokeh();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Populate and show the results screen.
   *
   * @param {object}   results              – Shape documented at top of file.
   * @param {Function} [opts.onRaceAgain]
   * @param {Function} [opts.onNextEvent]
   * @param {Function} [opts.onReturnToCity]
   * @param {Function} [opts.onWheelspin]
   */
  show(results, { onRaceAgain, onNextEvent, onReturnToCity, onWheelspin } = {}) {
    this._onRaceAgain    = onRaceAgain    ?? (() => {});
    this._onNextEvent    = onNextEvent    ?? (() => {});
    this._onReturnToCity = onReturnToCity ?? (() => {});
    this._onWheelspin    = onWheelspin    ?? (() => {});

    this._populate(results);
    this._visible = true;

    // One rAF so the DOM paints before we trigger the transition.
    requestAnimationFrame(() => {
      this._root.classList.add('visible');
      this._scheduleReveals(results);
    });
  }

  /**
   * Hide and reset the screen (called when the player navigates away).
   */
  hide() {
    if (!this._visible) return;
    this._visible = false;

    this._revealTimers.forEach(clearTimeout);
    this._revealTimers = [];

    this._root.classList.remove('visible');
    this._pbBanner.classList.remove('visible');
  }

  /**
   * Called by HUDManager._handleEscape() — acts as "Return to City".
   */
  triggerReturnToCity() {
    this._onReturnToCity();
    this.hide();
  }

  /** Remove DOM. Call on full game teardown. */
  destroy() {
    this.hide();
    this._root?.remove();
  }

  // ─── DOM Construction ────────────────────────────────────────────────────────

  _build() {
    // ── Root
    const root = document.createElement('div');
    root.id = 'rrs-root';

    // ── Bokeh container (decorative particles inserted by _buildBokeh)
    const bokeh = document.createElement('div');
    bokeh.id = 'rrs-bokeh';
    root.appendChild(bokeh);
    this._bokeh = bokeh;

    // ── Personal best banner
    const pbBanner = document.createElement('div');
    pbBanner.id = 'rrs-pb-banner';
    pbBanner.textContent = '🏆  New Personal Best';
    root.appendChild(pbBanner);
    this._pbBanner = pbBanner;

    // ── Main content grid
    const content = document.createElement('div');
    content.id = 'rrs-content';

    // Medal strip
    const medal = document.createElement('div');
    medal.id = 'rrs-medal';
    const medalBadge = document.createElement('div');
    medalBadge.className = 'rrs-medal-badge';
    medalBadge.textContent = '—';
    const medalLabel = document.createElement('div');
    medalLabel.className = 'rrs-medal-label';
    medalLabel.textContent = 'Finish';
    medal.append(medalBadge, medalLabel);
    this._medalBadge = medalBadge;
    this._medalLabel = medalLabel;

    // Leaderboard panel
    const lb = document.createElement('div');
    lb.id = 'rrs-leaderboard';
    const lbHeading = document.createElement('div');
    lbHeading.className = 'rrs-lb-heading';
    lbHeading.textContent = 'Results';
    const lbBody = document.createElement('div');
    lb.append(lbHeading, lbBody);
    this._lbBody = lbBody;

    // Rewards panel
    const rewards = document.createElement('div');
    rewards.id = 'rrs-rewards';

    // Credits section
    const crLabel = document.createElement('div');
    crLabel.className = 'rrs-section-label';
    crLabel.textContent = 'Credits Earned';
    const crList = document.createElement('div');
    this._crList = crList;

    // XP section
    const xpSection = document.createElement('div');
    xpSection.className = 'rrs-xp-section';
    const xpMeta = document.createElement('div');
    xpMeta.className = 'rrs-xp-meta';
    const xpEarned = document.createElement('div');
    xpEarned.className = 'rrs-xp-earned';
    const xpLevel = document.createElement('div');
    xpLevel.className = 'rrs-xp-level';
    xpMeta.append(xpEarned, xpLevel);
    const xpTrack = document.createElement('div');
    xpTrack.className = 'rrs-xp-track';
    const xpFill = document.createElement('div');
    xpFill.className = 'rrs-xp-fill';
    xpTrack.appendChild(xpFill);
    const levelUp = document.createElement('div');
    levelUp.className = 'rrs-levelup';
    levelUp.textContent = '⬆  Level Up!';
    xpSection.append(xpMeta, xpTrack, levelUp);
    this._xpFill   = xpFill;
    this._xpEarned = xpEarned;
    this._xpLevel  = xpLevel;
    this._levelUp  = levelUp;

    // Wheelspin indicator
    const ws = document.createElement('div');
    ws.className = 'rrs-wheelspin';
    ws.innerHTML = `
      <div class="rrs-wheelspin-icon">🎡</div>
      <div class="rrs-wheelspin-text">
        <div class="rrs-wheelspin-title">Wheelspin Ready!</div>
        <div class="rrs-wheelspin-hint">Claim your prize from the results</div>
      </div>`;
    this._wheelspinEl = ws;

    // Accolades
    const accoladesEl = document.createElement('div');
    accoladesEl.className = 'rrs-accolades';
    this._accoladesEl = accoladesEl;

    rewards.append(crLabel, crList, xpSection, ws, accoladesEl);
    content.append(medal, lb, rewards);
    root.appendChild(content);

    // ── Action buttons
    const actions = document.createElement('div');
    actions.id = 'rrs-actions';

    const btnRaceAgain = this._makeBtn('Race Again',      'rrs-btn-primary');
    const btnNext      = this._makeBtn('Next Event',      'rrs-btn-secondary');
    const btnCity      = this._makeBtn('Return to City',  'rrs-btn-ghost');
    const btnSpin      = this._makeBtn('Spin Wheelspin',  'rrs-btn-gold');
    this._btnWheelspin = btnSpin;

    btnRaceAgain.addEventListener('click', () => { this._onRaceAgain();    this.hide(); });
    btnNext     .addEventListener('click', () => { this._onNextEvent();    this.hide(); });
    btnCity     .addEventListener('click', () => { this.triggerReturnToCity(); });
    btnSpin     .addEventListener('click', () => { this._onWheelspin();    this.hide(); });

    actions.append(btnRaceAgain, btnNext, btnCity, btnSpin);
    root.appendChild(actions);

    this._container.appendChild(root);
    this._root = root;
  }

  _makeBtn(label, className) {
    const btn = document.createElement('button');
    btn.className = `rrs-btn ${className}`;
    btn.textContent = label;
    return btn;
  }

  // ─── Bokeh particles ─────────────────────────────────────────────────────────

  _buildBokeh() {
    // 12 decorative blurred circles, randomised position + colour + timing
    const palette = ['#4da6ff', '#f5c542', '#b06aff', '#00e5ff', '#3ddc84'];
    for (let i = 0; i < 12; i++) {
      const dot = document.createElement('div');
      dot.className = 'rrs-bokeh-dot';
      const size  = 40 + Math.random() * 80;
      const color = palette[i % palette.length];
      const delay = (Math.random() * 6).toFixed(2);
      const dur   = (7 + Math.random() * 9).toFixed(2);
      dot.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        left: ${(Math.random() * 100).toFixed(1)}%;
        top: ${(20 + Math.random() * 70).toFixed(1)}%;
        background: ${color};
        animation-duration: ${dur}s;
        animation-delay: -${delay}s;
      `;
      this._bokeh.appendChild(dot);
    }
  }

  // ─── Population ──────────────────────────────────────────────────────────────

  _populate(results) {
    const {
      position, totalRacers, raceTimeMs, bestLapMs,
      isNewPB, newPBText,
      racers = [],
      creditsBase = 0, creditsMultipliers = [], creditsTotal = 0,
      xpEarned = 0, xpBefore = 0, xpAfter = 0, xpToNextLevel = 1,
      levelBefore = 1, levelAfter = 1,
      wheelspinCount = 0,
      accolades = [],
    } = results;

    // ── Medal strip
    const posColour = POSITION_COLOUR[position] ?? '#ffffff';
    const posLabel  = POSITION_LABEL[position]  ?? `${position}TH`;
    this._medalBadge.textContent = posLabel;
    this._medalBadge.style.color = posColour;
    this._medalLabel.textContent = `of ${totalRacers}`;

    // ── Personal best banner
    if (isNewPB && newPBText) {
      this._pbBanner.textContent = `🏆  New Personal Best — ${newPBText}`;
    }

    // ── Leaderboard rows
    this._lbBody.innerHTML = '';
    const sorted = [...racers].sort((a, b) => a.position - b.position);
    for (const racer of sorted) {
      const row  = document.createElement('div');
      const pCol = POSITION_COLOUR[racer.position] ?? 'rgba(255,255,255,0.45)';
      row.className = 'rrs-lb-row' + (racer.isPlayer ? ' is-player' : '');
      if (racer.isPlayer) {
        row.style.color = posColour;
        row.style.setProperty(
          '--_row-tint',
          POSITION_ROW_TINT[racer.position] ?? 'rgba(255,255,255,0.06)',
        );
        row.style.borderLeftColor = posColour;
      }

      const posEl  = document.createElement('div');
      posEl.className = 'rrs-lb-pos';
      posEl.textContent = `${racer.position}.`;
      posEl.style.color = pCol;

      const nameEl = document.createElement('div');
      nameEl.className = 'rrs-lb-name';
      nameEl.textContent = racer.name;
      if (racer.archetype) {
        const icon = document.createElement('span');
        icon.className = 'rrs-lb-icon';
        icon.textContent = ARCHETYPE_ICON[racer.archetype] ?? '';
        nameEl.appendChild(icon);
      }

      const timeEl = document.createElement('div');
      timeEl.className = 'rrs-lb-time';
      timeEl.textContent = formatMs(racer.raceTimeMs);

      const gapEl  = document.createElement('div');
      gapEl.className = 'rrs-lb-gap';
      gapEl.textContent = racer.position === 1 ? 'WINNER' : formatGapMs(racer.gapMs);

      row.append(posEl, nameEl, timeEl, gapEl);
      this._lbBody.appendChild(row);
    }

    // ── Credits rows
    this._crList.innerHTML = '';
    this._crRowEls = [];

    const allCrRows = [
      { label: 'Base Reward',  value: creditsBase, isTotal: false },
      ...creditsMultipliers.map(m => ({ label: m.label, value: m.value, isTotal: false })),
      { label: 'Total',        value: creditsTotal, isTotal: true },
    ];

    for (const { label, value, isTotal } of allCrRows) {
      const row = document.createElement('div');
      row.className = 'rrs-cr-row' + (isTotal ? ' is-total' : '');

      const labelEl = document.createElement('span');
      labelEl.textContent = label;

      const valEl = document.createElement('span');
      valEl.className = 'rrs-cr-value';
      valEl.textContent = `${formatCR(value)} CR`;

      row.append(labelEl, valEl);
      this._crList.appendChild(row);
      this._crRowEls.push(row);
    }

    // ── XP bar — set to starting position; animation fires in _scheduleReveals
    const pctBefore = Math.min(1, xpBefore / xpToNextLevel) * 100;
    this._xpFill.style.transition = 'none';
    this._xpFill.style.width      = `${pctBefore}%`;
    this._xpEarned.textContent    = `+${xpEarned.toLocaleString()} XP`;
    this._xpLevel.textContent     = `Level ${levelBefore}`;

    if (levelAfter > levelBefore) {
      this._levelUp.classList.add('visible');
      this._levelUp.textContent = `⬆  Level ${levelAfter} Reached!`;
    } else {
      this._levelUp.classList.remove('visible');
    }

    // ── Wheelspin indicator
    if (wheelspinCount > 0) {
      const isSuper = wheelspinCount >= 3;
      this._wheelspinEl.classList.add('visible');
      this._wheelspinEl.querySelector('.rrs-wheelspin-title').textContent =
        isSuper ? 'Super Wheelspin Ready!' : 'Wheelspin Ready!';
      this._wheelspinEl.querySelector('.rrs-wheelspin-hint').textContent =
        isSuper ? '3 prizes waiting for you' : 'Tap below to spin';
      this._wheelspinEl.onclick = () => { this._onWheelspin(); this.hide(); };
      this._btnWheelspin.classList.add('visible');
      this._btnWheelspin.textContent = isSuper ? 'Spin Super Wheelspin' : 'Spin Wheelspin';
    } else {
      this._wheelspinEl.classList.remove('visible');
      this._btnWheelspin.classList.remove('visible');
    }

    // ── Accolades
    this._accoladesEl.innerHTML = '';
    this._accoladeEls = [];

    if (accolades.length > 0) {
      const accoLabel = document.createElement('div');
      accoLabel.className = 'rrs-section-label';
      accoLabel.style.marginTop = '18px';
      accoLabel.textContent = 'Accolades';
      this._accoladesEl.appendChild(accoLabel);

      for (const text of accolades) {
        const chip = document.createElement('div');
        chip.className = 'rrs-accolade-chip';
        const icon = document.createElement('span');
        icon.className = 'rrs-accolade-icon';
        icon.textContent = '🏅';
        const label = document.createElement('span');
        label.textContent = text;
        chip.append(icon, label);
        this._accoladesEl.appendChild(chip);
        this._accoladeEls.push(chip);
      }
    }

    // ── Store for deferred animation
    this._pendingXP = { xpBefore, xpAfter, xpToNextLevel, levelAfter };
    this._pendingPB = isNewPB && !!newPBText;
  }

  // ─── Staggered reveal animation ──────────────────────────────────────────────

  /**
   * Fires timed reveals after the root slide-in completes.
   * All setTimeout ids are stored in _revealTimers for cancellation on hide().
   */
  _scheduleReveals(results) {
    const t = (ms, fn) => {
      const id = setTimeout(fn, ms);
      this._revealTimers.push(id);
    };

    // Personal best banner slides down early
    if (this._pendingPB) {
      t(260, () => this._pbBanner.classList.add('visible'));
      t(3500, () => this._pbBanner.classList.remove('visible'));
    }

    // Credit rows stagger in, 80 ms apart, starting at 380 ms
    (this._crRowEls ?? []).forEach((row, i) => {
      t(380 + i * 80, () => row.classList.add('revealed'));
    });

    // XP bar fills after credits are all shown
    const xpDelay = 380 + (this._crRowEls?.length ?? 0) * 80 + 120;
    t(xpDelay, () => this._animateXPBar());

    // Accolades stagger in after XP bar
    (this._accoladeEls ?? []).forEach((chip, i) => {
      t(xpDelay + 600 + i * 140, () => chip.classList.add('revealed'));
    });
  }

  _animateXPBar() {
    const { xpBefore, xpAfter, xpToNextLevel, levelAfter } = this._pendingXP ?? {};
    if (xpToNextLevel <= 0) return;

    // If the player leveled up, the bar fills to 100% then restarts from 0
    const didLevelUp = levelAfter > (this._pendingXP?.levelBefore ?? levelAfter);
    const pctAfter   = Math.min(1, xpAfter / xpToNextLevel) * 100;

    // Re-enable the CSS transition and animate to the target width.
    // GSAP is the preferred path; fall back to CSS transition.
    this._xpFill.style.transition = '';

    if (typeof gsap !== 'undefined') {
      // GSAP path — smooth, interruptible
      const startPct = Math.min(1, xpBefore / xpToNextLevel) * 100;
      if (didLevelUp) {
        gsap.to(this._xpFill, {
          width: '100%',
          duration: 0.7,
          ease: 'power2.inOut',
          onComplete: () => {
            this._xpFill.style.transition = 'none';
            this._xpFill.style.width = '0%';
            requestAnimationFrame(() => {
              this._xpFill.style.transition = '';
              gsap.to(this._xpFill, { width: `${pctAfter}%`, duration: 0.6, ease: 'power2.out' });
              this._xpLevel.textContent = `Level ${levelAfter}`;
            });
          },
        });
      } else {
        gsap.fromTo(this._xpFill,
          { width: `${startPct}%` },
          { width: `${pctAfter}%`, duration: 1.2, ease: 'power2.out' },
        );
      }
    } else {
      // CSS-transition fallback
      this._xpFill.style.width = `${pctAfter}%`;
    }

    this._xpLevel.textContent = `Level ${levelAfter}`;
  }

  // ─── CSS injection ────────────────────────────────────────────────────────────

  _injectCSS() {
    if (document.getElementById('rrs-styles')) return;
    const style = document.createElement('style');
    style.id = 'rrs-styles';
    style.textContent = RESULTS_CSS;
    document.head.appendChild(style);
  }
}

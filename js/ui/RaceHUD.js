/**
 * RaceHUD.js
 * Part 8 — UI, HUD & Menus
 *
 * All race-mode overlay elements that appear on race start and hide on return
 * to free roam. Zero knowledge of other HUD modules — HUDManager mounts this
 * and calls its public API.
 *
 * Elements managed:
 *   • Position indicator   top-left  — "2nd / 6", gold/silver/bronze/white
 *   • Gap indicator        top-left  — "+1.4s" / "-2.1s", updates every 2 s
 *   • Lap counter          top-centre — "Lap 2 / 3" (circuit only)
 *   • Lap timer            top-right  — current lap + personal best in gold
 *                                       purple flash on new PB
 *   • Mini leaderboard     right side — collapsed / expanded (Tab)
 *   • Radio chatter box    bottom     — Gemini commentary, 4 s, 20 s cooldown
 *
 * Expected raceState shape each frame (from RaceManager):
 * {
 *   position:       number,   // 1-based current place
 *   totalRacers:    number,
 *   gapAhead:       number|null,  // seconds to car ahead (positive = we're behind)
 *   raceType:       'circuit'|'sprint'|'drag'|'drift'|'speedtrap'|'speedzone',
 *   currentLap:     number,   // 1-based; circuit only
 *   totalLaps:      number,   // circuit only
 *   currentLapMs:   number,   // milliseconds elapsed this lap
 *   bestLapMs:      number|null,  // personal best lap in ms, null if none yet
 *   isNewPB:        boolean,  // true on the frame a new PB is confirmed
 *   racers: Array<{
 *     name:       string,
 *     isPlayer:   boolean,
 *     position:   number,
 *     gapMs:      number,    // ms behind leader (0 for leader)
 *     archetype:  string|undefined,  // AI only
 *   }>,
 * }
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Maps AI archetype names to a single-character icon shown in the leaderboard. */
const ARCHETYPE_ICON = {
  Pusher:   '🔥',
  Pacer:    '📐',
  Blocker:  '🛡',
  Hunter:   '🎯',
  Wildcard: '🎲',
};

/** Gold / silver / bronze colour for positions 1-3; white thereafter. */
const POSITION_COLOUR = {
  1: '#FFD700',
  2: '#C0C0C0',
  3: '#CD7F32',
};

const ORDINAL_SUFFIX = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

/** Format milliseconds as M:SS.mmm */
const formatMs = (ms) => {
  if (ms == null) return '--:--.---';
  const totalSec = ms / 1000;
  const m   = Math.floor(totalSec / 60);
  const s   = Math.floor(totalSec % 60);
  const ms3 = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms3).padStart(3, '0')}`;
};

/** Format a gap in seconds as "1:02" (if ≥60s) or "1.4s". */
const formatGap = (seconds) => {
  const abs = Math.abs(seconds);
  return abs >= 60
    ? `${Math.floor(abs / 60)}:${String(Math.round(abs % 60)).padStart(2, '0')}`
    : `${abs.toFixed(1)}s`;
};

// ─── Injected stylesheet ─────────────────────────────────────────────────────

const RACE_HUD_CSS = `
.rhud-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif;
}

/* ── Position block (top-left) ─────────────────────────────────────────── */
.rhud-position-block {
  position: absolute;
  top: 28px;
  left: 28px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  opacity: 0;
  transform: translateX(-14px);
  transition: opacity 300ms ease, transform 300ms ease;
}
.rhud-position-block.visible {
  opacity: 1;
  transform: translateX(0);
}

.rhud-pos-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.rhud-ordinal {
  font-size: 52px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  text-shadow: 0 2px 14px rgba(0,0,0,0.75);
  transition: color 350ms ease, transform 150ms ease;
}
.rhud-total {
  font-size: 20px;
  font-weight: 500;
  color: rgba(255,255,255,0.5);
  letter-spacing: 0.06em;
}

.rhud-gap {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.04em;
  transition: color 250ms ease;
  font-variant-numeric: tabular-nums;
}
.rhud-gap.ahead  { color: #FF3B30; }   /* behind the car ahead → red */
.rhud-gap.behind { color: #34C759; }   /* ahead of car behind → green */
.rhud-gap.leader { color: rgba(255,255,255,0.38); font-size: 15px; letter-spacing: .15em; }

/* ── Lap counter (top-centre) ──────────────────────────────────────────── */
.rhud-lap-counter {
  position: absolute;
  top: 28px;
  left: 50%;
  transform: translateX(-50%) translateY(-6px);
  font-size: 19px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-shadow: 0 2px 8px rgba(0,0,0,0.6);
  opacity: 0;
  transition: opacity 300ms ease, transform 300ms ease;
}
.rhud-lap-counter.visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* ── Timer block (top-right) ───────────────────────────────────────────── */
.rhud-timer-block {
  position: absolute;
  top: 28px;
  right: 28px;
  text-align: right;
  opacity: 0;
  transform: translateX(14px);
  transition: opacity 300ms ease, transform 300ms ease;
}
.rhud-timer-block.visible {
  opacity: 1;
  transform: translateX(0);
}
.rhud-current-lap {
  font-size: 34px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.03em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 10px rgba(0,0,0,0.6);
}
.rhud-best-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  margin-top: 4px;
}
.rhud-best-lap {
  font-size: 16px;
  font-weight: 600;
  color: #FFD700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

/* PB flash animation */
@keyframes rhud-pb {
  0%   { color: #fff;    text-shadow: none; }
  25%  { color: #A855F7; text-shadow: 0 0 22px #A855F7, 0 0 6px #fff; }
  65%  { color: #A855F7; }
  100% { color: #FFD700; text-shadow: none; }
}
.rhud-best-lap.pb-flash {
  animation: rhud-pb 1.5s ease forwards;
}

/* ── Mini leaderboard (right side) ────────────────────────────────────── */
.rhud-leaderboard {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  width: 220px;
  background: rgba(7, 9, 13, 0.80);
  border-left: 2px solid rgba(255,255,255,0.08);
  padding: 6px 0 4px;
  opacity: 0;
  transition: opacity 300ms ease, width 220ms cubic-bezier(.4,0,.2,1);
}
.rhud-leaderboard.visible   { opacity: 1; }
.rhud-leaderboard.collapsed { width: 148px; }

.rhud-lb-heading {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: rgba(255,255,255,0.28);
  text-transform: uppercase;
  padding: 0 14px 5px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.rhud-lb-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255,255,255,0.65);
  overflow: hidden;
  white-space: nowrap;
}
.rhud-lb-row.is-player {
  color: #fff;
  background: rgba(255,255,255,0.065);
}
.rhud-lb-row.hidden-collapsed { display: none; }

.rhud-lb-pos {
  min-width: 28px;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.rhud-lb-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rhud-lb-icon {
  font-size: 11px;
  flex-shrink: 0;
  opacity: 0.85;
}
.rhud-lb-gap-text {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.rhud-lb-hint {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: rgba(255,255,255,0.2);
  padding: 5px 14px 0;
  border-top: 1px solid rgba(255,255,255,0.05);
  margin-top: 3px;
}

/* ── AI radio chatter ──────────────────────────────────────────────────── */
.rhud-radio {
  position: absolute;
  bottom: 216px;  /* above minimap */
  left: 28px;
  max-width: 310px;
  background: rgba(7, 9, 13, 0.82);
  border-left: 3px solid #2C9CF0;
  border-radius: 0 5px 5px 0;
  padding: 8px 14px 9px;
  opacity: 0;
  transform: translateX(-8px);
  transition: opacity 260ms ease, transform 260ms ease;
  pointer-events: none;
}
.rhud-radio.visible {
  opacity: 1;
  transform: translateX(0);
}
.rhud-radio-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #2C9CF0;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.rhud-radio-text {
  font-size: 13.5px;
  font-weight: 500;
  color: rgba(255,255,255,0.87);
  line-height: 1.45;
}

/* ── Responsive ────────────────────────────────────────────────────────── */
@media (max-width: 1280px) {
  .rhud-ordinal           { font-size: 40px; }
  .rhud-leaderboard       { width: 188px; }
  .rhud-leaderboard.collapsed { width: 124px; }
  .rhud-current-lap       { font-size: 26px; }
}
@media (max-width: 900px) {
  .rhud-position-block    { top: 16px; left: 16px; }
  .rhud-timer-block       { top: 16px; right: 16px; }
  .rhud-leaderboard       { display: none; }
  .rhud-radio             { max-width: 220px; bottom: 180px; }
  .rhud-ordinal           { font-size: 34px; }
  .rhud-current-lap       { font-size: 22px; }
}
`;

// ─── RaceHUD ─────────────────────────────────────────────────────────────────

export class RaceHUD {
  /**
   * @param {HTMLElement} container  The HUD root element owned by HUDManager.
   */
  constructor(container) {
    this._container = container;
    this._visible   = false;
    this._raceType  = 'circuit';

    // Gap throttle — update display every 2 000 ms.
    this._lastGapTs        = 0;
    this._displayedGapAhead = null;

    // Leaderboard expansion.
    this._expanded  = false;
    this._lbRowEls  = [];   // [{row, posEl, nameEl, iconEl, gapEl}]

    // Radio chatter.
    this._chatCooldownUntil = 0;
    this._chatTimer         = null;

    // PB flash guard — track the last bestLapMs value we flashed for.
    this._lastFlashedPB = null;

    this._injectCSS();
    this._build();
    this._bindKeys();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Slide all race elements into view.
   * Called by RaceManager (via HUDManager) when a race begins.
   *
   * @param {{ raceType: string }} raceConfig
   */
  show(raceConfig = {}) {
    if (this._visible) return;
    this._visible  = true;
    this._raceType = raceConfig.raceType ?? 'circuit';

    // Reset state.
    this._lastGapTs        = 0;
    this._displayedGapAhead = null;
    this._expanded = false;
    this._lbRowEls = [];
    this._lbRows.innerHTML = '';
    this._updateExpandedCSS();
    this._lastFlashedPB = null;

    const isCircuit = this._raceType === 'circuit';
    this._lapCounter.style.display = isCircuit ? '' : 'none';

    // Stagger entrance (one rAF so layout is painted first).
    requestAnimationFrame(() => {
      this._posBlock.classList.add('visible');
      this._timerBlock.classList.add('visible');
      this._leaderboard.classList.add('visible');
      if (isCircuit) this._lapCounter.classList.add('visible');
    });
  }

  /**
   * Slide all race elements out.
   * Called by RaceManager when the race ends or player returns to free roam.
   */
  hide() {
    if (!this._visible) return;
    this._visible = false;

    this._posBlock.classList.remove('visible');
    this._timerBlock.classList.remove('visible');
    this._leaderboard.classList.remove('visible');
    this._lapCounter.classList.remove('visible');
    this._dismissRadio();
  }

  /**
   * Called every game frame with fresh race state from RaceManager.
   * @param {object} raceState
   */
  update(raceState) {
    if (!this._visible || !raceState) return;

    this._updatePositionBlock(raceState);
    this._updateGap(raceState);
    this._updateLapCounter(raceState);
    this._updateTimer(raceState);
    this._updateLeaderboard(raceState);
  }

  /**
   * Show a Gemini commentary string in the radio chatter box.
   * Silently dropped if the 20-second cooldown has not elapsed.
   *
   * @param {string} text  e.g. "Vega is defending hard — watch your braking point"
   */
  showRadioChatter(text) {
    const now = Date.now();
    if (!this._visible || now < this._chatCooldownUntil) return;

    this._chatCooldownUntil    = now + 20_000;
    this._radioText.textContent = text;
    this._radio.classList.add('visible');

    if (this._chatTimer) clearTimeout(this._chatTimer);
    this._chatTimer = setTimeout(() => this._dismissRadio(), 4_000);
  }

  /** Remove DOM and listeners. */
  destroy() {
    this._unbindKeys();
    if (this._chatTimer) clearTimeout(this._chatTimer);
    if (this._root.parentNode) this._root.parentNode.removeChild(this._root);
  }

  // ─── DOM Construction ──────────────────────────────────────────────────────

  _build() {
    const root = document.createElement('div');
    root.className = 'rhud-root';

    // ── Position block ────────────────────────────────────────────────────────
    const posBlock = document.createElement('div');
    posBlock.className = 'rhud-position-block';

    const posRow = document.createElement('div');
    posRow.className = 'rhud-pos-row';

    const ordinalEl = document.createElement('span');
    ordinalEl.className = 'rhud-ordinal';
    ordinalEl.textContent = '1st';

    const totalEl = document.createElement('span');
    totalEl.className = 'rhud-total';
    totalEl.textContent = '/ 6';

    posRow.append(ordinalEl, totalEl);

    const gapEl = document.createElement('div');
    gapEl.className = 'rhud-gap leader';
    gapEl.textContent = 'LEAD';

    posBlock.append(posRow, gapEl);

    // ── Lap counter ───────────────────────────────────────────────────────────
    const lapCounter = document.createElement('div');
    lapCounter.className = 'rhud-lap-counter';
    lapCounter.textContent = 'LAP 1 / 3';

    // ── Timer block ───────────────────────────────────────────────────────────
    const timerBlock = document.createElement('div');
    timerBlock.className = 'rhud-timer-block';

    const currentLapEl = document.createElement('div');
    currentLapEl.className = 'rhud-current-lap';
    currentLapEl.textContent = '0:00.000';

    const bestLabel = document.createElement('div');
    bestLabel.className = 'rhud-best-label';
    bestLabel.textContent = 'BEST LAP';

    const bestLapEl = document.createElement('div');
    bestLapEl.className = 'rhud-best-lap';
    bestLapEl.textContent = '--:--.---';

    timerBlock.append(currentLapEl, bestLabel, bestLapEl);

    // ── Mini leaderboard ──────────────────────────────────────────────────────
    const leaderboard = document.createElement('div');
    leaderboard.className = 'rhud-leaderboard collapsed';

    const lbHeading = document.createElement('div');
    lbHeading.className = 'rhud-lb-heading';
    lbHeading.textContent = 'Leaderboard';

    const lbRows = document.createElement('div');

    const lbHint = document.createElement('div');
    lbHint.className = 'rhud-lb-hint';
    lbHint.textContent = '[TAB] Expand';

    leaderboard.append(lbHeading, lbRows, lbHint);

    // ── Radio chatter ─────────────────────────────────────────────────────────
    const radio = document.createElement('div');
    radio.className = 'rhud-radio';

    const radioLabel = document.createElement('div');
    radioLabel.className = 'rhud-radio-label';
    radioLabel.textContent = '📻  Race Radio';

    const radioText = document.createElement('div');
    radioText.className = 'rhud-radio-text';

    radio.append(radioLabel, radioText);

    root.append(posBlock, lapCounter, timerBlock, leaderboard, radio);
    this._container.appendChild(root);

    // Store refs.
    this._root        = root;
    this._posBlock    = posBlock;
    this._ordinalEl   = ordinalEl;
    this._totalEl     = totalEl;
    this._gapEl       = gapEl;
    this._lapCounter  = lapCounter;
    this._timerBlock  = timerBlock;
    this._currentLapEl = currentLapEl;
    this._bestLapEl   = bestLapEl;
    this._leaderboard = leaderboard;
    this._lbRows      = lbRows;
    this._lbHint      = lbHint;
    this._radio       = radio;
    this._radioText   = radioText;
  }

  // ─── Frame-update helpers ──────────────────────────────────────────────────

  _updatePositionBlock({ position, totalRacers }) {
    const ordinal = ORDINAL_SUFFIX(position);
    if (this._ordinalEl.textContent !== ordinal) {
      this._ordinalEl.textContent = ordinal;
      // Brief pop-scale on position change.
      this._ordinalEl.style.transform = 'scale(1.18)';
      setTimeout(() => { this._ordinalEl.style.transform = 'scale(1)'; }, 160);
    }
    this._ordinalEl.style.color = POSITION_COLOUR[position] ?? '#FFFFFF';
    this._totalEl.textContent   = `/ ${totalRacers}`;
  }

  _updateGap({ position, gapAhead }) {
    // Throttle to every 2 000 ms to avoid distracting flicker.
    const now = Date.now();
    if (now - this._lastGapTs < 2_000) return;
    this._lastGapTs = now;

    if (position === 1) {
      this._gapEl.className   = 'rhud-gap leader';
      this._gapEl.textContent = 'LEAD';
      return;
    }

    if (gapAhead != null) this._displayedGapAhead = gapAhead;
    const gap = this._displayedGapAhead;
    if (gap == null) return;

    // Positive gapAhead = we are behind the car ahead.
    if (gap >= 0) {
      this._gapEl.className   = 'rhud-gap ahead';
      this._gapEl.textContent = `+${formatGap(gap)}`;
    } else {
      // Negative shouldn't happen for gapAhead but handle gracefully.
      this._gapEl.className   = 'rhud-gap behind';
      this._gapEl.textContent = `-${formatGap(Math.abs(gap))}`;
    }
  }

  _updateLapCounter({ currentLap, totalLaps }) {
    if (this._raceType !== 'circuit') return;
    const text = `LAP ${currentLap ?? 1} / ${totalLaps ?? 1}`;
    if (this._lapCounter.textContent !== text) this._lapCounter.textContent = text;
  }

  _updateTimer({ currentLapMs, bestLapMs, isNewPB }) {
    this._currentLapEl.textContent = formatMs(currentLapMs);

    const bestText = formatMs(bestLapMs);
    if (this._bestLapEl.textContent !== bestText) {
      this._bestLapEl.textContent = bestText;
    }

    // Trigger PB flash exactly once per new best.
    if (isNewPB && bestLapMs != null && bestLapMs !== this._lastFlashedPB) {
      this._lastFlashedPB = bestLapMs;
      this._triggerPBFlash();
    }
  }

  _triggerPBFlash() {
    const el = this._bestLapEl;
    el.classList.remove('pb-flash');
    void el.offsetWidth;   // force reflow so animation restarts
    el.classList.add('pb-flash');
    el.addEventListener('animationend', () => el.classList.remove('pb-flash'), { once: true });
  }

  _updateLeaderboard({ racers, position }) {
    if (!racers?.length) return;

    const sorted = [...racers].sort((a, b) => a.position - b.position);

    // In collapsed mode, always show: P1, P2, P3, and the player's position.
    const alwaysShow = new Set([1, 2, 3, position]);
    const expanded   = this._expanded;

    // Rebuild rows only when racer count changes.
    if (this._lbRowEls.length !== sorted.length) {
      this._lbRows.innerHTML = '';
      this._lbRowEls = sorted.map((racer) => {
        const row = document.createElement('div');
        row.className = 'rhud-lb-row' + (racer.isPlayer ? ' is-player' : '');

        const posEl  = document.createElement('span');
        posEl.className = 'rhud-lb-pos';

        const nameEl = document.createElement('span');
        nameEl.className = 'rhud-lb-name';
        nameEl.textContent = racer.name;

        const iconEl = document.createElement('span');
        iconEl.className = 'rhud-lb-icon';
        iconEl.textContent = racer.archetype ? (ARCHETYPE_ICON[racer.archetype] ?? '') : '';

        const gapTextEl = document.createElement('span');
        gapTextEl.className = 'rhud-lb-gap-text';

        row.append(posEl, nameEl, iconEl, gapTextEl);
        this._lbRows.appendChild(row);
        return { row, posEl, nameEl, iconEl, gapTextEl };
      });
    }

    // Update content + visibility per row.
    sorted.forEach((racer, i) => {
      const els = this._lbRowEls[i];
      if (!els) return;
      const { row, posEl, gapTextEl } = els;

      posEl.textContent = ORDINAL_SUFFIX(racer.position);
      posEl.style.color = POSITION_COLOUR[racer.position] ?? 'rgba(255,255,255,0.45)';

      gapTextEl.textContent = racer.position === 1
        ? 'LEAD'
        : `+${formatGap(racer.gapMs / 1000)}`;

      const shouldHide = !expanded && !alwaysShow.has(racer.position);
      row.classList.toggle('hidden-collapsed', shouldHide);
    });

    this._lbHint.textContent = expanded ? '[TAB] Collapse' : '[TAB] Expand';
  }

  // ─── Leaderboard expand/collapse ───────────────────────────────────────────

  _toggleLeaderboard() {
    this._expanded = !this._expanded;
    this._updateExpandedCSS();
    // Force a row visibility pass on the next frame.
    this._lastGapTs = 0;  // also refresh gap display
  }

  _updateExpandedCSS() {
    this._leaderboard.classList.toggle('collapsed', !this._expanded);
    if (this._lbHint) {
      this._lbHint.textContent = this._expanded ? '[TAB] Collapse' : '[TAB] Expand';
    }
  }

  // ─── Radio ─────────────────────────────────────────────────────────────────

  _dismissRadio() {
    this._radio.classList.remove('visible');
    if (this._chatTimer) { clearTimeout(this._chatTimer); this._chatTimer = null; }
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  _bindKeys() {
    this._onKeyDown = (e) => {
      if (!this._visible) return;
      if (e.code === 'Tab') {
        e.preventDefault();
        this._toggleLeaderboard();
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  _unbindKeys() {
    window.removeEventListener('keydown', this._onKeyDown);
  }

  // ─── CSS injection ─────────────────────────────────────────────────────────

  _injectCSS() {
    if (document.getElementById('rhud-styles')) return;
    const style = document.createElement('style');
    style.id = 'rhud-styles';
    style.textContent = RACE_HUD_CSS;
    document.head.appendChild(style);
  }
}

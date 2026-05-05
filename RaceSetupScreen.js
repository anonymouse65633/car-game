/**
 * RaceSetupScreen.js
 * Full-screen pre-race overlay shown when the player initiates a race.
 *
 * Responsibilities:
 *  - Render race info card (name, type, class, route diagram, distance/duration)
 *  - Render AI opponent list with driver cards pulled from RaceManager.spawnOpponents()
 *  - Difficulty selector (Tourist → Unbeatable, 5 levels)
 *  - Assists quick-toggle icons (ABS / TC / SC / Rewind)
 *  - Player car info with class-mismatch warning
 *  - Reward preview (1st / 2nd / 3rd CR + XP)
 *  - Start Race / Cancel buttons
 *  - Live blurred world visible through the background
 *
 * Dependencies:
 *  - SettingsStore  (reads/writes difficulty, assists, units)
 *  - RaceManager   (spawnOpponents, getRaceConfig)
 *  - HUDManager    (show/hide orchestration)
 *
 * Usage:
 *   const screen = new RaceSetupScreen(hudRoot, settingsStore, raceManager);
 *   screen.show(raceId, playerCar);   // open overlay
 *   screen.on('start',  (config) => …);
 *   screen.on('cancel', ()       => …);
 */

export class RaceSetupScreen {
  /* ─────────────────────────── constructor ────────────────────────────── */

  constructor(hudRoot, settingsStore, raceManager) {
    /** @type {HTMLElement} */
    this.hudRoot = hudRoot;
    /** @type {SettingsStore} */
    this.settings = settingsStore;
    /** @type {RaceManager} */
    this.raceManager = raceManager;

    /** Callbacks registered via .on() */
    this._listeners = { start: [], cancel: [] };

    /** Currently displayed race config */
    this._raceConfig = null;
    /** Currently displayed player car */
    this._playerCar = null;
    /** Index into DIFFICULTIES */
    this._selectedDifficulty = this._difficultyIndexFromSettings();

    /** Assist state — mirror of settings, edited locally until race starts */
    this._assists = {
      abs:    this.settings.get('assist_abs',    true),
      tc:     this.settings.get('assist_tc',     true),
      sc:     this.settings.get('assist_sc',     true),
      rewind: this.settings.get('assist_rewind', true),
    };

    this._el = null;   // root DOM element (null when hidden)

    this._handleKeyDown = this._handleKeyDown.bind(this);
  }

  /* ─────────────────────────── public API ─────────────────────────────── */

  /**
   * Open the race setup screen.
   * @param {string}  raceId     - identifier passed to RaceManager
   * @param {object}  playerCar  - { name, class, pr, id }
   */
  async show(raceId, playerCar) {
    this._playerCar  = playerCar;
    this._raceConfig = await this._fetchRaceConfig(raceId);

    // Re-read difficulty from settings each open so external changes take effect
    this._selectedDifficulty = this._difficultyIndexFromSettings();

    this._build();
    requestAnimationFrame(() => {
      if (this._el) this._el.classList.add('rss-visible');
    });

    document.addEventListener('keydown', this._handleKeyDown);
  }

  /** Programmatically close without firing start/cancel callbacks. */
  hide() {
    this._dismiss(false);
  }

  /**
   * Register an event callback.
   * @param {'start'|'cancel'} event
   * @param {Function} cb
   */
  on(event, cb) {
    if (this._listeners[event]) this._listeners[event].push(cb);
    return this;  // chainable
  }

  /* ─────────────────────────── internals ──────────────────────────────── */

  // ── Data helpers ──────────────────────────────────────────────────────

  async _fetchRaceConfig(raceId) {
    const cfg  = this.raceManager.getRaceConfig(raceId);
    const opps = await this.raceManager.spawnOpponents(raceId, this._settings_difficulty());

    return {
      id:          raceId,
      name:        cfg.name        ?? 'Unknown Race',
      type:        cfg.type        ?? 'Circuit',      // Circuit / Sprint / Drag / Drift
      raceClass:   cfg.class       ?? 'A',
      distance:    cfg.distanceKm  ?? 0,
      laps:        cfg.laps        ?? 1,
      estimatedMs: cfg.estimatedMs ?? 0,
      waypoints:   cfg.waypoints   ?? [],             // [{x,y}] for minimap diagram
      rewards:     cfg.rewards     ?? { p1:{cr:0,xp:0}, p2:{cr:0,xp:0}, p3:{cr:0,xp:0} },
      opponents:   opps,                              // [{ name, archetype, car, class, pr }]
    };
  }

  _settings_difficulty() {
    return DIFFICULTIES[this._selectedDifficulty].key;
  }

  _difficultyIndexFromSettings() {
    const key = this.settings.get('difficulty', 'novice');
    const idx = DIFFICULTIES.findIndex(d => d.key === key);
    return idx >= 0 ? idx : 1;   // default Novice
  }

  _classMismatch() {
    if (!this._playerCar || !this._raceConfig) return false;
    return this._playerCar.class !== this._raceConfig.raceClass;
  }

  _formatDuration(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return mins > 0 ? `~${mins}m ${secs}s` : `~${secs}s`;
  }

  _formatCR(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(0)}k CR` : `${n} CR`;
  }

  // ── DOM construction ──────────────────────────────────────────────────

  _build() {
    // Remove any stale element
    if (this._el) this._el.remove();

    const el = document.createElement('div');
    el.className = 'rss-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', `Race Setup: ${this._raceConfig.name}`);

    el.innerHTML = this._template();
    this.hudRoot.appendChild(el);
    this._el = el;

    this._injectStyle();
    this._wireEvents();

    // Initial render of dynamic sections
    this._renderDifficultyButtons();
    this._renderAssistIcons();
    this._renderOpponentList();
    this._renderMismatchWarning();
    this._renderRouteDiagram();
  }

  _template() {
    const cfg = this._raceConfig;
    const car = this._playerCar;
    const units   = this.settings.get('units', 'kmh') === 'mph' ? 'mi' : 'km';
    const dist    = units === 'mph'
      ? `${(cfg.distance * 0.621).toFixed(1)} mi`
      : `${cfg.distance.toFixed(1)} km`;
    const typeIcon = RACE_TYPE_ICONS[cfg.type] ?? '🏁';

    return /* html */`
      <!-- ── Blurred live background ── -->
      <div class="rss-bg-blur" aria-hidden="true"></div>
      <div class="rss-bg-vignette" aria-hidden="true"></div>

      <!-- ── Main content grid ── -->
      <div class="rss-grid">

        <!-- ── LEFT: Opponent list ── -->
        <section class="rss-panel rss-panel--opponents" aria-label="Opponents">
          <h2 class="rss-panel-title">Opponents</h2>
          <ul class="rss-opponent-list" id="rss-opponents" role="list">
            <!-- Populated by _renderOpponentList() -->
          </ul>
        </section>

        <!-- ── CENTRE: Race info card ── -->
        <section class="rss-panel rss-panel--centre" aria-label="Race Info">
          <div class="rss-race-card">

            <!-- Header -->
            <div class="rss-race-header">
              <span class="rss-type-badge" data-type="${cfg.type}">
                ${typeIcon} ${cfg.type}
              </span>
              <span class="rss-class-badge rss-class--${cfg.raceClass.toLowerCase()}">
                ${cfg.raceClass}
              </span>
            </div>

            <h1 class="rss-race-name">${cfg.name}</h1>

            <div class="rss-race-meta">
              <span class="rss-meta-item">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M7 0L7 14M0 7L14 7" stroke="currentColor" stroke-width="1.5"/>
                </svg>
                ${dist}
              </span>
              ${cfg.laps > 1 ? `
              <span class="rss-meta-item">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M7 4v3l2 2" stroke="currentColor" stroke-width="1.5"/>
                </svg>
                ${cfg.laps} Laps
              </span>` : ''}
              <span class="rss-meta-item">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M7 4v3l1.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                ${this._formatDuration(cfg.estimatedMs)}
              </span>
            </div>

            <!-- Route diagram canvas -->
            <div class="rss-route-wrap">
              <canvas class="rss-route-canvas" id="rss-route-canvas"
                      width="240" height="140"
                      aria-label="Route diagram"></canvas>
            </div>

            <!-- Rewards -->
            <div class="rss-rewards" aria-label="Rewards">
              ${this._rewardHTML(1, cfg.rewards.p1)}
              ${this._rewardHTML(2, cfg.rewards.p2)}
              ${this._rewardHTML(3, cfg.rewards.p3)}
            </div>

          </div>
        </section>

        <!-- ── RIGHT: Settings ── -->
        <section class="rss-panel rss-panel--settings" aria-label="Race Settings">

          <!-- Difficulty -->
          <div class="rss-settings-section">
            <h3 class="rss-settings-label">Difficulty</h3>
            <div class="rss-difficulty-row" id="rss-difficulty-row" role="radiogroup"
                 aria-label="Difficulty selector">
              <!-- Populated by _renderDifficultyButtons() -->
            </div>
          </div>

          <!-- Assists -->
          <div class="rss-settings-section">
            <h3 class="rss-settings-label">Assists</h3>
            <div class="rss-assist-row" id="rss-assist-row" role="group"
                 aria-label="Assist toggles">
              <!-- Populated by _renderAssistIcons() -->
            </div>
          </div>

          <!-- Player car info -->
          <div class="rss-settings-section">
            <h3 class="rss-settings-label">Your Car</h3>
            <div class="rss-car-info" id="rss-car-info">
              <div class="rss-car-name">${car?.name ?? '—'}</div>
              <div class="rss-car-details">
                <span class="rss-class-badge rss-class--${(car?.class ?? '').toLowerCase()}"
                      id="rss-player-class-badge">
                  ${car?.class ?? '?'}
                </span>
                <span class="rss-car-pr">PR ${car?.pr ?? '—'}</span>
              </div>
              <div class="rss-mismatch-warning" id="rss-mismatch-warning"
                   role="alert" aria-live="polite">
                <!-- Populated by _renderMismatchWarning() -->
              </div>
            </div>
          </div>

        </section>
      </div>

      <!-- ── Bottom action bar ── -->
      <div class="rss-action-bar">
        <button class="rss-btn rss-btn--cancel" id="rss-cancel" aria-label="Cancel race setup">
          Cancel
        </button>
        <button class="rss-btn rss-btn--start" id="rss-start" aria-label="Start race">
          Start Race
          <svg class="rss-start-arrow" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M4 9h10M10 5l4 4-4 4" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    `;
  }

  _rewardHTML(place, reward) {
    const medal = ['', '🥇', '🥈', '🥉'][place];
    const label = ['', '1st', '2nd', '3rd'][place];
    return /* html */`
      <div class="rss-reward-row rss-reward-row--p${place}">
        <span class="rss-reward-medal" aria-hidden="true">${medal}</span>
        <span class="rss-reward-label">${label}</span>
        <span class="rss-reward-cr">${this._formatCR(reward.cr)}</span>
        <span class="rss-reward-xp">+${reward.xp.toLocaleString()} XP</span>
      </div>
    `;
  }

  // ── Dynamic section renderers ─────────────────────────────────────────

  _renderDifficultyButtons() {
    const row = this._el.querySelector('#rss-difficulty-row');
    if (!row) return;
    row.innerHTML = '';

    DIFFICULTIES.forEach((diff, i) => {
      const btn = document.createElement('button');
      btn.className = 'rss-diff-btn';
      btn.dataset.index = i;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', i === this._selectedDifficulty ? 'true' : 'false');
      btn.setAttribute('aria-label', diff.label);
      btn.title = diff.label;
      btn.textContent = diff.label;
      if (i === this._selectedDifficulty) btn.classList.add('rss-diff-btn--active');

      btn.addEventListener('click', () => this._selectDifficulty(i));
      row.appendChild(btn);
    });
  }

  _renderAssistIcons() {
    const row = this._el.querySelector('#rss-assist-row');
    if (!row) return;
    row.innerHTML = '';

    ASSISTS.forEach(assist => {
      const btn = document.createElement('button');
      btn.className = 'rss-assist-btn';
      btn.dataset.assist = assist.key;
      btn.setAttribute('aria-label', `${assist.label}: ${this._assists[assist.key] ? 'On' : 'Off'}`);
      btn.setAttribute('aria-pressed', this._assists[assist.key] ? 'true' : 'false');
      btn.title = assist.label;

      const isOn = this._assists[assist.key];
      btn.innerHTML = /* html */`
        <span class="rss-assist-icon" aria-hidden="true">${assist.icon}</span>
        <span class="rss-assist-label">${assist.label}</span>
        <span class="rss-assist-state">${isOn ? 'ON' : 'OFF'}</span>
      `;
      if (isOn) btn.classList.add('rss-assist-btn--on');

      btn.addEventListener('click', () => this._toggleAssist(assist.key));
      row.appendChild(btn);
    });
  }

  _renderOpponentList() {
    const list = this._el.querySelector('#rss-opponents');
    if (!list) return;
    list.innerHTML = '';

    if (!this._raceConfig.opponents?.length) {
      list.innerHTML = '<li class="rss-opponent-empty">No opponents loaded</li>';
      return;
    }

    this._raceConfig.opponents.forEach((opp, i) => {
      const li = document.createElement('li');
      li.className = 'rss-opponent-item';
      li.setAttribute('role', 'listitem');
      li.innerHTML = /* html */`
        <span class="rss-opp-position">${i + 1}</span>
        <div class="rss-opp-info">
          <div class="rss-opp-name-row">
            <span class="rss-opp-name">${opp.name}</span>
            <span class="rss-opp-archetype" title="Driver style">${ARCHETYPE_ICONS[opp.archetype] ?? ''}</span>
          </div>
          <div class="rss-opp-details">
            <span class="rss-class-badge rss-class--${opp.class.toLowerCase()}">${opp.class}</span>
            <span class="rss-opp-car">${opp.car}</span>
            <span class="rss-opp-pr">PR ${opp.pr}</span>
          </div>
        </div>
      `;
      list.appendChild(li);
    });
  }

  _renderMismatchWarning() {
    const warn = this._el?.querySelector('#rss-mismatch-warning');
    if (!warn) return;

    if (this._classMismatch()) {
      const raceClass   = this._raceConfig.raceClass;
      const playerClass = this._playerCar.class;
      warn.innerHTML = /* html */`
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 1L13 13H1L7 1Z" fill="none" stroke="#f59e0b" stroke-width="1.5"/>
          <path d="M7 6v3M7 10.5v.5" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Class mismatch — race is ${raceClass} class, your car is ${playerClass} class
      `;
      warn.classList.add('rss-mismatch-warning--visible');
    } else {
      warn.innerHTML = '';
      warn.classList.remove('rss-mismatch-warning--visible');
    }
  }

  /**
   * Draw a simplified route diagram on the canvas.
   * Uses normalised waypoints [{x,y}] where x,y ∈ [0,1].
   */
  _renderRouteDiagram() {
    const canvas = this._el?.querySelector('#rss-route-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    const pad = 20;

    ctx.clearRect(0, 0, W, H);

    const wps = this._raceConfig.waypoints;
    if (!wps || wps.length < 2) {
      // Fallback: simple oval placeholder
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W / 2 - pad, H / 2 - pad, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    // Map normalised coords → canvas
    const toX = x => pad + x * (W - pad * 2);
    const toY = y => pad + y * (H - pad * 2);

    // Road shadow / track width
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 7;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(toX(wps[0].x), toY(wps[0].y));
    wps.slice(1).forEach(wp => ctx.lineTo(toX(wp.x), toY(wp.y)));
    if (this._raceConfig.type === 'Circuit') ctx.closePath();
    ctx.stroke();

    // Route line
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0,   '#3b82f6');
    grad.addColorStop(1,   '#06b6d4');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(toX(wps[0].x), toY(wps[0].y));
    wps.slice(1).forEach(wp => ctx.lineTo(toX(wp.x), toY(wp.y)));
    if (this._raceConfig.type === 'Circuit') ctx.closePath();
    ctx.stroke();

    // Start marker
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(toX(wps[0].x), toY(wps[0].y), 5, 0, Math.PI * 2);
    ctx.fill();

    // Finish marker
    const last = wps[wps.length - 1];
    ctx.fillStyle = this._raceConfig.type === 'Circuit' ? '#22c55e' : '#ef4444';
    ctx.beginPath();
    ctx.arc(toX(last.x), toY(last.y), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── State mutation ────────────────────────────────────────────────────

  _selectDifficulty(index) {
    this._selectedDifficulty = index;
    this._renderDifficultyButtons();
  }

  _toggleAssist(key) {
    this._assists[key] = !this._assists[key];
    this._renderAssistIcons();
  }

  // ── Wiring ────────────────────────────────────────────────────────────

  _wireEvents() {
    this._el.querySelector('#rss-start')?.addEventListener('click',  () => this._onStart());
    this._el.querySelector('#rss-cancel')?.addEventListener('click', () => this._onCancel());
  }

  _handleKeyDown(e) {
    if (!this._el) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this._onCancel();
        break;
      case 'Enter': {
        const focused = document.activeElement;
        if (focused && this._el.contains(focused)) break;   // let button handle it
        this._onStart();
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        const next  = Math.max(0, Math.min(DIFFICULTIES.length - 1,
                        this._selectedDifficulty + delta));
        this._selectDifficulty(next);
        break;
      }
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────

  _onStart() {
    // Persist choices to settings
    this.settings.set('difficulty',    DIFFICULTIES[this._selectedDifficulty].key);
    this.settings.set('assist_abs',    this._assists.abs);
    this.settings.set('assist_tc',     this._assists.tc);
    this.settings.set('assist_sc',     this._assists.sc);
    this.settings.set('assist_rewind', this._assists.rewind);

    const payload = {
      raceId:     this._raceConfig.id,
      difficulty: DIFFICULTIES[this._selectedDifficulty].key,
      assists:    { ...this._assists },
    };

    this._dismiss(false);
    this._emit('start', payload);
  }

  _onCancel() {
    this._dismiss(true);
    this._emit('cancel');
  }

  _dismiss(animate = true) {
    document.removeEventListener('keydown', this._handleKeyDown);
    if (!this._el) return;

    const el = this._el;
    this._el = null;

    if (animate) {
      el.classList.remove('rss-visible');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      // Safety fallback
      setTimeout(() => el.remove(), 400);
    } else {
      el.remove();
    }
  }

  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(cb => cb(data));
  }

  // ── CSS injection (idempotent) ────────────────────────────────────────

  _injectStyle() {
    if (document.getElementById('rss-style')) return;

    const style = document.createElement('style');
    style.id = 'rss-style';
    style.textContent = RSS_CSS;
    document.head.appendChild(style);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════════════ */

const DIFFICULTIES = [
  { key: 'tourist',     label: 'Tourist',     xpMult: 0.5  },
  { key: 'novice',      label: 'Novice',      xpMult: 0.75 },
  { key: 'experienced', label: 'Experienced', xpMult: 1.0  },
  { key: 'pro',         label: 'Pro',         xpMult: 1.25 },
  { key: 'unbeatable',  label: 'Unbeatable',  xpMult: 1.5  },
];

const ASSISTS = [
  { key: 'abs',    label: 'ABS',    icon: '🔴' },
  { key: 'tc',     label: 'TC',     icon: '🟡' },
  { key: 'sc',     label: 'SC',     icon: '🟠' },
  { key: 'rewind', label: 'Rewind', icon: '⏪' },
];

/** Race type → emoji icon */
const RACE_TYPE_ICONS = {
  Circuit:  '🔄',
  Sprint:   '➡️',
  Drag:     '⬆️',
  Drift:    '💨',
  Showcase: '🌟',
};

/** AI archetype → emoji */
const ARCHETYPE_ICONS = {
  Pusher:    '🔥',
  Blocker:   '🛡️',
  Pacer:     '📐',
  Racer:     '⚡',
  Wildcardz: '🎲',
};

/* ══════════════════════════════════════════════════════════════════════════
   CSS
══════════════════════════════════════════════════════════════════════════ */

const RSS_CSS = `
/* ── Root overlay ──────────────────────────────────────────────────── */
.rss-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-race-setup, 900);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  opacity: 0;
  transform: scale(0.97);
  transition: opacity 250ms ease, transform 250ms ease;
  pointer-events: none;
  font-family: var(--font-ui, 'Inter', sans-serif);
  color: #fff;
}
.rss-overlay.rss-visible {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}

/* ── Background ────────────────────────────────────────────────────── */
.rss-bg-blur {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px) saturate(0.7);
  -webkit-backdrop-filter: blur(12px) saturate(0.7);
}
.rss-bg-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%);
}

/* ── Content grid ──────────────────────────────────────────────────── */
.rss-grid {
  position: relative;
  display: grid;
  grid-template-columns: 260px 1fr 280px;
  gap: 24px;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 24px 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Panels ─────────────────────────────────────────────────────────── */
.rss-panel {
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.15) transparent;
}
.rss-panel-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.45);
  margin: 0;
}

/* ── Race info card ─────────────────────────────────────────────────── */
.rss-panel--centre {
  gap: 0;
  padding: 0;
  background: transparent;
  border: none;
}
.rss-race-card {
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}
.rss-race-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rss-type-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.8);
  letter-spacing: 0.04em;
}
.rss-class-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 4px;
  letter-spacing: 0.08em;
}
.rss-class--d  { background: #6b7280; color: #fff; }
.rss-class--c  { background: #16a34a; color: #fff; }
.rss-class--b  { background: #2563eb; color: #fff; }
.rss-class--a  { background: #d97706; color: #fff; }
.rss-class--s1 { background: #dc2626; color: #fff; }
.rss-class--s2 { background: #7c3aed; color: #fff; }
.rss-class--x  { background: linear-gradient(90deg,#7c3aed,#db2777); color: #fff; }

.rss-race-name {
  font-size: 28px;
  font-weight: 800;
  margin: 0;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.rss-race-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.rss-meta-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: rgba(255,255,255,0.6);
}

/* ── Route diagram ──────────────────────────────────────────────────── */
.rss-route-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.25);
  border-radius: 8px;
  overflow: hidden;
  min-height: 100px;
}
.rss-route-canvas {
  max-width: 100%;
  max-height: 100%;
}

/* ── Rewards ─────────────────────────────────────────────────────────── */
.rss-rewards {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rss-reward-row {
  display: grid;
  grid-template-columns: 24px 36px 1fr 1fr;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.rss-reward-row--p1 { background: rgba(234,179,8,0.12); }
.rss-reward-row--p2 { background: rgba(148,163,184,0.08); }
.rss-reward-row--p3 { background: rgba(180,83,9,0.08); }
.rss-reward-medal   { font-size: 16px; }
.rss-reward-label   { font-weight: 700; color: rgba(255,255,255,0.7); }
.rss-reward-cr      { font-weight: 700; color: #fbbf24; text-align: right; }
.rss-reward-xp      { color: rgba(139,92,246,0.9); font-size: 12px; text-align: right; }

/* ── Opponent list ──────────────────────────────────────────────────── */
.rss-opponent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rss-opponent-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.04);
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.06);
}
.rss-opp-position {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255,255,255,0.35);
  width: 18px;
  text-align: center;
  flex-shrink: 0;
}
.rss-opp-info { flex: 1; min-width: 0; }
.rss-opp-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.rss-opp-name {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rss-opp-archetype { font-size: 14px; }
.rss-opp-details {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rss-opp-car { font-size: 11px; color: rgba(255,255,255,0.45); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rss-opp-pr  { font-size: 11px; color: rgba(255,255,255,0.3); flex-shrink: 0; }
.rss-opponent-empty { color: rgba(255,255,255,0.3); font-size: 13px; padding: 8px; }

/* ── Settings panel ─────────────────────────────────────────────────── */
.rss-settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rss-settings-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.4);
  margin: 0;
}

/* ── Difficulty buttons ──────────────────────────────────────────────── */
.rss-difficulty-row {
  display: flex;
  gap: 4px;
}
.rss-diff-btn {
  flex: 1;
  padding: 7px 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: center;
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.45);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms, color 120ms, border-color 120ms, transform 80ms;
}
.rss-diff-btn:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); }
.rss-diff-btn--active {
  background: rgba(59,130,246,0.25);
  color: #93c5fd;
  border-color: rgba(59,130,246,0.5);
}
.rss-diff-btn:active { transform: scale(0.95); }
.rss-diff-btn:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

/* ── Assist toggles ──────────────────────────────────────────────────── */
.rss-assist-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.rss-assist-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  cursor: pointer;
  flex: 1;
  min-width: 52px;
  transition: background 120ms, border-color 120ms;
}
.rss-assist-icon  { font-size: 16px; line-height: 1; }
.rss-assist-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.45); letter-spacing: 0.05em; }
.rss-assist-state { font-size: 10px; font-weight: 800; color: rgba(239,68,68,0.75); }
.rss-assist-btn--on .rss-assist-state { color: #4ade80; }
.rss-assist-btn--on {
  background: rgba(74,222,128,0.08);
  border-color: rgba(74,222,128,0.25);
}
.rss-assist-btn:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

/* ── Player car info ────────────────────────────────────────────────── */
.rss-car-info {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rss-car-name {
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rss-car-details {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rss-car-pr { font-size: 12px; color: rgba(255,255,255,0.4); }

/* ── Mismatch warning ───────────────────────────────────────────────── */
.rss-mismatch-warning {
  display: none;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #fbbf24;
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.25);
  border-radius: 6px;
  padding: 6px 8px;
  line-height: 1.4;
}
.rss-mismatch-warning--visible { display: flex; }

/* ── Action bar ──────────────────────────────────────────────────────── */
.rss-action-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 20px 24px 28px;
}
.rss-btn {
  padding: 13px 32px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: 10px;
  cursor: pointer;
  transition: background 150ms, transform 80ms, opacity 150ms;
  border: none;
}
.rss-btn:active { transform: scale(0.97); }
.rss-btn:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

.rss-btn--cancel {
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.65);
  border: 1px solid rgba(255,255,255,0.1);
  min-width: 120px;
}
.rss-btn--cancel:hover { background: rgba(255,255,255,0.12); color: #fff; }

.rss-btn--start {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #16a34a;
  color: #fff;
  min-width: 180px;
  justify-content: center;
  box-shadow: 0 0 20px rgba(22,163,74,0.35);
}
.rss-btn--start:hover { background: #15803d; box-shadow: 0 0 28px rgba(22,163,74,0.5); }
.rss-start-arrow { flex-shrink: 0; }

/* ── Responsive ──────────────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .rss-grid {
    grid-template-columns: 220px 1fr 240px;
    gap: 16px;
  }
}
@media (max-width: 900px) {
  .rss-grid {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
  }
  .rss-panel--opponents { grid-column: 1 / -1; max-height: 200px; }
  .rss-panel--centre    { grid-column: 1; }
  .rss-panel--settings  { grid-column: 2; }
}
@media (max-width: 640px) {
  .rss-grid {
    grid-template-columns: 1fr;
    padding: 12px 12px 0;
  }
  .rss-panel--opponents { max-height: 160px; }
  .rss-panel--centre,
  .rss-panel--settings  { grid-column: 1; }
  .rss-race-name { font-size: 22px; }
  .rss-difficulty-row { flex-wrap: wrap; }
  .rss-diff-btn { min-width: 70px; flex: none; }
  .rss-action-bar { padding: 12px; gap: 10px; }
  .rss-btn { padding: 11px 20px; font-size: 14px; }
}
`;

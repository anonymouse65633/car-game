/**
 * DrivingHUD.js
 * Part 8 — UI, HUD & Menus (Section 8.2.1, 8.2.4, 8.2.6)
 *
 * Everything visible while driving in free roam or during a race.
 * Hidden entirely when the player is on foot.
 *
 * Elements:
 *  - Analog-style speedometer dial + sweep needle   (bottom right — FH5 style)
 *  - Digital speed readout inside the dial
 *  - RPM bar (horizontal, left-to-right) with redline zone
 *  - Gear indicator (number or "A" for auto)
 *  - Assist flash icons: TC / ABS / SSC              (bottom right)
 *  - Speed lines overlay at 150+ km/h               (CSS animation, screen edges)
 *  - Chromatic aberration overlay at 200+ km/h      (CSS filter on canvas wrapper)
 *
 * Receives playerState each frame from HUDManager.update().
 * All drawing is DOM/CSS — no canvas used here.
 * The Three.js canvas is untouched; effects sit in a sibling overlay div.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

// Needle sweep range: 0 km/h = -130°, maxSpeed = +130° (total 260° arc)
const NEEDLE_MIN_DEG = -130;
const NEEDLE_MAX_DEG =  130;

// Speed thresholds for effects
const SPEED_LINES_THRESHOLD   = 150; // km/h
const CHROMA_THRESHOLD        = 200; // km/h

// RPM redline starts at this fraction of maxRPM
const REDLINE_FRACTION = 0.90;

// Assist icon flash duration (ms)
const ASSIST_FLASH_MS = 600;

// ─── CSS ─────────────────────────────────────────────────────────────────────
const DRIVING_HUD_CSS = `
  /* ══════════════════════════════════════════
     Speedometer dial — BOTTOM RIGHT (FH5 exact)
  ══════════════════════════════════════════ */
  #hc-speedo {
    position: absolute;
    bottom: var(--hud-edge);
    right: var(--hud-edge);
    left: auto;
    transform: none;
    width: 220px;
    height: 130px;
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }

  /* SVG dial lives here */
  #hc-speedo-svg {
    width: 220px;
    height: 220px;
    position: absolute;
    top: 0;
    left: 0;
  }

  /* Digital speed readout */
  #hc-speed-digital {
    position: absolute;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'Barlow Condensed', 'Rajdhani', 'Arial Narrow', sans-serif;
    font-size: 2.6rem;
    font-weight: 700;
    color: var(--hud-white);
    letter-spacing: -0.02em;
    line-height: 1;
    text-shadow: 0 0 12px rgba(255,255,255,0.3);
    white-space: nowrap;
  }

  #hc-speed-unit {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--hud-dim);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-left: 3px;
  }

  /* ── RPM bar + gear — right-aligned above speedo ── */
  #hc-rpm-wrap {
    position: absolute;
    bottom: calc(var(--hud-edge) + 138px);
    right: var(--hud-edge);
    left: auto;
    transform: none;
    width: 260px;
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: none;
  }

  #hc-rpm-bar-track {
    flex: 1;
    height: 6px;
    background: rgba(255,255,255,0.10);
    border-radius: 3px;
    overflow: hidden;
    position: relative;
  }

  #hc-rpm-bar-fill {
    height: 100%;
    width: 0%;
    border-radius: 3px;
    background: var(--hud-white);
    transition: width 0.05s linear, background 0.1s ease;
    will-change: width;
  }

  #hc-rpm-bar-fill.redline {
    background: var(--hud-red);
    box-shadow: 0 0 8px var(--hud-red);
  }

  #hc-gear-indicator {
    font-family: 'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif;
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--hud-white);
    width: 28px;
    text-align: center;
    line-height: 1;
  }

  /* ── Assist icons — bottom right ── */
  #hc-assists {
    position: absolute;
    bottom: calc(var(--hud-edge) + 8px);
    right: var(--hud-edge);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
    pointer-events: none;
  }

  .hc-assist-icon {
    font-family: 'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif;
    font-size: 0.70rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 3px 7px;
    border-radius: 2px;
    opacity: 0;
    transition: opacity 0.1s ease;
    pointer-events: none;
  }

  .hc-assist-icon.tc  { color: #f5c542; border: 1px solid #f5c54255; background: rgba(245,197,66,0.10); }
  .hc-assist-icon.abs { color: #ff3b3b; border: 1px solid #ff3b3b55; background: rgba(255,59,59,0.10); }
  .hc-assist-icon.ssc { color: #ff9500; border: 1px solid #ff950055; background: rgba(255,149,0,0.10); }

  .hc-assist-icon.active { opacity: 1; }

  /* ── Speed lines overlay — screen edges ── */
  #hc-speed-lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
    background:
      radial-gradient(ellipse at center, transparent 55%, rgba(255,255,255,0.03) 100%);
    z-index: 1;
  }

  #hc-speed-lines.active {
    opacity: 1;
    animation: hc-speed-lines-pulse 0.18s linear infinite;
  }

  #hc-speed-lines.intense {
    opacity: 1;
    animation: hc-speed-lines-pulse 0.10s linear infinite;
  }

  @keyframes hc-speed-lines-pulse {
    0%   { background-size: 100% 100%; }
    50%  { background-size: 108% 108%; }
    100% { background-size: 100% 100%; }
  }

  /* Radial streak lines using box-shadow trick on pseudo-elements */
  #hc-speed-lines::before,
  #hc-speed-lines::after {
    content: '';
    position: absolute;
    inset: -20%;
    background: repeating-conic-gradient(
      rgba(255,255,255,0.015) 0deg,
      transparent 1.5deg,
      transparent 18deg
    );
    border-radius: 50%;
  }

  #hc-speed-lines::after {
    transform: rotate(9deg);
    opacity: 0.5;
  }

  /* ── Chromatic aberration overlay ── */
  #hc-chroma {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.4s ease;
    z-index: 2;
    /* RGB fringe via layered shadows on a transparent element */
    box-shadow:
      inset  3px  0 18px rgba(255, 0,   0,   0.08),
      inset -3px  0 18px rgba(0,   0,   255, 0.08),
      inset  0    3px 18px rgba(0,   255, 0,   0.04);
  }

  #hc-chroma.active {
    opacity: 1;
  }

  /* ── Responsive ── */
  @media (max-width: 1280px) {
    #hc-speedo     { width: 170px; height: 100px; }
    #hc-speedo-svg { width: 170px; height: 170px; }
    #hc-speed-digital { font-size: 2rem; }
    #hc-rpm-wrap   { width: 220px; bottom: calc(var(--hud-edge) + 108px); }
  }

  @media (max-width: 900px) {
    #hc-speedo     { width: 140px; height: 82px; }
    #hc-speedo-svg { width: 140px; height: 140px; }
    #hc-speed-digital { font-size: 1.6rem; }
    #hc-rpm-wrap   { width: 180px; bottom: calc(var(--hud-edge) + 90px); }
    #hc-assists    { display: none; } /* too cluttered on small screens */
  }
`;

// ─── SVG dial template ────────────────────────────────────────────────────────
// The dial is a semi-circle arc drawn in SVG.
// Tick marks and the sweep needle are positioned with trigonometry.

function buildDialSVG(maxSpeed) {
  const cx = 100, cy = 110, r = 86;

  // Arc path: from -130° to +130° (0° = right, so we offset by 90°)
  // SVG arc from startAngle to endAngle
  const toRad = (deg) => (deg - 90) * Math.PI / 180;
  const pt = (angle) => {
    const a = toRad(angle);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };

  const start = pt(NEEDLE_MIN_DEG + 90);
  const end   = pt(NEEDLE_MAX_DEG + 90);

  // Tick marks every 20 km/h
  let ticks = '';
  for (let s = 0; s <= maxSpeed; s += 20) {
    const frac   = s / maxSpeed;
    const angle  = NEEDLE_MIN_DEG + frac * (NEEDLE_MAX_DEG - NEEDLE_MIN_DEG);
    const a      = toRad(angle + 90);
    const inner  = s % 40 === 0 ? r - 14 : r - 8;
    const x1 = cx + r     * Math.cos(a);
    const y1 = cy + r     * Math.sin(a);
    const x2 = cx + inner * Math.cos(a);
    const y2 = cy + inner * Math.sin(a);
    const isLabel = s % 40 === 0 && s > 0;
    const lx = cx + (inner - 10) * Math.cos(a);
    const ly = cy + (inner - 10) * Math.sin(a);

    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}"
                    x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
                    stroke="rgba(255,255,255,0.25)" stroke-width="${s % 40 === 0 ? 2 : 1}"/>`;
    if (isLabel) {
      ticks += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"
                      text-anchor="middle" dominant-baseline="central"
                      fill="rgba(255,255,255,0.35)"
                      font-size="9" font-family="Rajdhani,Arial Narrow,sans-serif"
                      font-weight="600">${s}</text>`;
    }
  }

  // Redline arc — from 90% of maxSpeed to maxSpeed
  const redlineStart = pt(NEEDLE_MIN_DEG + 0.9 * (NEEDLE_MAX_DEG - NEEDLE_MIN_DEG) + 90);
  const redlineEnd   = pt(NEEDLE_MAX_DEG + 90);

  return `
    <svg id="hc-speedo-svg" viewBox="0 0 200 200"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">

      <!-- FH5 dark background circle with orange outer ring -->
      <circle cx="${cx}" cy="${cy}" r="${r + 6}"
              fill="rgba(0,0,0,0.55)" stroke="#ff6b1a" stroke-width="2.5"/>

      <!-- Main arc track (dark grey) -->
      <path d="M ${start.x.toFixed(1)} ${start.y.toFixed(1)}
               A ${r} ${r} 0 1 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}"
            fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="7"
            stroke-linecap="round"/>

      <!-- Redline arc (red zone) -->
      <path d="M ${redlineStart.x.toFixed(1)} ${redlineStart.y.toFixed(1)}
               A ${r} ${r} 0 0 1 ${redlineEnd.x.toFixed(1)} ${redlineEnd.y.toFixed(1)}"
            fill="none" stroke="rgba(255,59,59,0.65)" stroke-width="7"
            stroke-linecap="round"/>

      <!-- Tick marks + labels -->
      ${ticks}

      <!-- Needle — FH5 white needle with orange hub -->
      <g id="hc-needle-group"
         style="transform-origin: ${cx}px ${cy}px; transform: rotate(-130deg);">
        <!-- Glow backing -->
        <line x1="${cx}" y1="${cy}"
              x2="${cx}" y2="${(cy - r + 20).toFixed(1)}"
              stroke="rgba(255,107,26,0.30)" stroke-width="5" stroke-linecap="round"/>
        <!-- Main needle -->
        <line x1="${cx}" y1="${cy}"
              x2="${cx}" y2="${(cy - r + 20).toFixed(1)}"
              stroke="white" stroke-width="2" stroke-linecap="round"
              opacity="0.95"/>
        <!-- FH5 orange hub -->
        <circle cx="${cx}" cy="${cy}" r="7"
                fill="#ff6b1a" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>
        <circle cx="${cx}" cy="${cy}" r="3.5"
                fill="white" opacity="0.9"/>
      </g>
    </svg>
  `;
}

// ─── DrivingHUD ───────────────────────────────────────────────────────────────
export class DrivingHUD {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container – #hc-hud-root
   * @param {object}      [opts.settings]
   */
  constructor({ container, settings = {} }) {
    this.container = container;
    this._maxSpeed = settings.carMaxSpeed ?? 300;  // updated per-car
    this._units    = settings.units ?? 'kmh';       // 'kmh' | 'mph'
    this._autoGear = settings.automaticGears ?? true;

    this._effects = {
      speedLines:          settings.speedLines          ?? true,
      chromaticAberration: settings.chromaticAberration ?? true,
    };

    // Assist flash timers
    this._assistTimers = { TC: null, ABS: null, SSC: null };

    // Cached DOM refs
    this._els = {};

    this._injectStyles();
    this._buildDOM();
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('hc-driving-hud-styles')) return;
    const s = document.createElement('style');
    s.id = 'hc-driving-hud-styles';
    s.textContent = DRIVING_HUD_CSS;
    document.head.appendChild(s);
  }

  _buildDOM() {
    // ── Speedometer ──
    const speedo = document.createElement('div');
    speedo.id = 'hc-speedo';
    speedo.classList.add('hc-driving-only');
    speedo.innerHTML = buildDialSVG(this._maxSpeed);

    const digital = document.createElement('div');
    digital.id = 'hc-speed-digital';
    digital.innerHTML = `0<span id="hc-speed-unit" class="hc-speed-unit">${this._unitLabel()}</span>`;
    speedo.appendChild(digital);

    // ── RPM bar ──
    const rpmWrap = document.createElement('div');
    rpmWrap.id = 'hc-rpm-wrap';
    rpmWrap.classList.add('hc-driving-only');
    rpmWrap.innerHTML = `
      <div id="hc-rpm-bar-track">
        <div id="hc-rpm-bar-fill"></div>
      </div>
      <div id="hc-gear-indicator">1</div>
    `;

    // ── Assist icons ──
    const assists = document.createElement('div');
    assists.id = 'hc-assists';
    assists.classList.add('hc-driving-only');
    assists.innerHTML = `
      <div class="hc-assist-icon tc"  id="hc-assist-tc">TC</div>
      <div class="hc-assist-icon abs" id="hc-assist-abs">ABS</div>
      <div class="hc-assist-icon ssc" id="hc-assist-ssc">SSC</div>
    `;

    // ── Speed lines ──
    const lines = document.createElement('div');
    lines.id = 'hc-speed-lines';

    // ── Chromatic aberration ──
    const chroma = document.createElement('div');
    chroma.id = 'hc-chroma';

    this.container.appendChild(speedo);
    this.container.appendChild(rpmWrap);
    this.container.appendChild(assists);
    this.container.appendChild(lines);
    this.container.appendChild(chroma);

    // Cache refs
    this._els = {
      needle:     this.container.querySelector('#hc-needle-group'),
      digital:    this.container.querySelector('#hc-speed-digital'),
      unit:       this.container.querySelector('#hc-speed-unit'),
      rpmFill:    this.container.querySelector('#hc-rpm-bar-fill'),
      gear:       this.container.querySelector('#hc-gear-indicator'),
      assistTC:   this.container.querySelector('#hc-assist-tc'),
      assistABS:  this.container.querySelector('#hc-assist-abs'),
      assistSSC:  this.container.querySelector('#hc-assist-ssc'),
      speedLines: this.container.querySelector('#hc-speed-lines'),
      chroma:     this.container.querySelector('#hc-chroma'),
    };
  }

  // ─── Per-frame update ──────────────────────────────────────────────────────

  /**
   * @param {object} playerState
   *   { speedKmh, rpm, maxRpm, gear, assists: { TC, ABS, SSC }, maxSpeedKmh }
   */
  update(playerState) {
    if (!playerState) return;

    const {
      speedKmh   = 0,
      rpm        = 0,
      maxRpm     = 8000,
      gear       = 1,
      maxSpeedKmh = this._maxSpeed,
      assists    = {},
    } = playerState;

    // Update maxSpeed if car changed
    if (maxSpeedKmh !== this._maxSpeed) {
      this._maxSpeed = maxSpeedKmh;
      this._rebuildDial();
    }

    const displaySpeed = this._units === 'mph'
      ? Math.round(speedKmh * 0.621371)
      : Math.round(speedKmh);

    // ── Needle ──
    const fraction    = Math.min(1, speedKmh / this._maxSpeed);
    const needleDeg   = NEEDLE_MIN_DEG + fraction * (NEEDLE_MAX_DEG - NEEDLE_MIN_DEG);
    if (this._els.needle) {
      this._els.needle.style.transform = `rotate(${needleDeg}deg)`;
    }

    // ── Digital readout ──
    if (this._els.digital) {
      // Replace text node only, preserve unit span
      const unitSpan = this._els.digital.querySelector('#hc-speed-unit');
      this._els.digital.textContent = displaySpeed;
      if (unitSpan) this._els.digital.appendChild(unitSpan);
    }

    // ── RPM bar ──
    const rpmFraction = Math.min(1, rpm / maxRpm);
    if (this._els.rpmFill) {
      this._els.rpmFill.style.width = `${(rpmFraction * 100).toFixed(1)}%`;
      this._els.rpmFill.classList.toggle('redline', rpmFraction >= REDLINE_FRACTION);
    }

    // ── Gear ──
    if (this._els.gear) {
      this._els.gear.textContent = this._autoGear ? 'A' : (gear ?? '–');
    }

    // ── Assist flashes ──
    this._updateAssist('TC',  assists.TC,  this._els.assistTC);
    this._updateAssist('ABS', assists.ABS, this._els.assistABS);
    this._updateAssist('SSC', assists.SSC, this._els.assistSSC);

    // ── Speed effects ──
    this._updateSpeedEffects(speedKmh);
  }

  // ─── Assist flash logic ────────────────────────────────────────────────────

  _updateAssist(key, firing, el) {
    if (!el) return;
    if (firing && !this._assistTimers[key]) {
      el.classList.add('active');
      this._assistTimers[key] = setTimeout(() => {
        el.classList.remove('active');
        this._assistTimers[key] = null;
      }, ASSIST_FLASH_MS);
    }
  }

  // ─── Speed effects ─────────────────────────────────────────────────────────

  _updateSpeedEffects(speedKmh) {
    const { speedLines, chroma } = this._els;

    if (speedLines && this._effects.speedLines) {
      const active  = speedKmh >= SPEED_LINES_THRESHOLD;
      const intense = speedKmh >= CHROMA_THRESHOLD;
      speedLines.classList.toggle('active',  active && !intense);
      speedLines.classList.toggle('intense', intense);
    }

    if (chroma && this._effects.chromaticAberration) {
      chroma.classList.toggle('active', speedKmh >= CHROMA_THRESHOLD);
    }
  }

  // ─── Settings updates ──────────────────────────────────────────────────────

  /** Called by HUDManager.applySettings() */
  setEffects({ speedLines, chromaticAberration }) {
    this._effects.speedLines          = speedLines;
    this._effects.chromaticAberration = chromaticAberration;
    if (!speedLines  && this._els.speedLines) {
      this._els.speedLines.classList.remove('active', 'intense');
    }
    if (!chromaticAberration && this._els.chroma) {
      this._els.chroma.classList.remove('active');
    }
  }

  setUnits(units) {
    this._units = units;
    if (this._els.unit) this._els.unit.textContent = this._unitLabel();
  }

  setAutoGear(isAuto) {
    this._autoGear = isAuto;
  }

  // ─── Resize ────────────────────────────────────────────────────────────────

  onResize(breakpoint) {
    // CSS handles most of it via media queries; nothing extra needed here
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _unitLabel() {
    return this._units === 'mph' ? 'mph' : 'km/h';
  }

  _rebuildDial() {
    const svg = this.container.querySelector('#hc-speedo-svg');
    if (!svg) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = buildDialSVG(this._maxSpeed);
    svg.replaceWith(tempDiv.firstElementChild);
    // Re-cache needle ref
    this._els.needle = this.container.querySelector('#hc-needle-group');
  }

  // ─── Teardown ──────────────────────────────────────────────────────────────

  destroy() {
    for (const t of Object.values(this._assistTimers)) clearTimeout(t);
    ['hc-speedo','hc-rpm-wrap','hc-assists','hc-speed-lines','hc-chroma']
      .forEach(id => document.getElementById(id)?.remove());
  }
}

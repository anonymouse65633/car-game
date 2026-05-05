/**
 * WheelspinUI.js
 * Animated wheelspin prize wheel — standard (1 wheel) and Super (3 wheels).
 *
 * Responsibilities:
 *  - Build the segmented prize wheel(s) from a weighted prize pool
 *  - Animate spin using GSAP (accelerate → coast → decelerate → snap to winner)
 *  - Zoom-in segment reveal with fanfare particles
 *  - Super Wheelspin: 3 simultaneous wheels, 3 independent prizes
 *  - Claim flow: add prize to InventoryStore, fire callback
 *  - Duplicate car handling: shows "Converted to CR" card
 *  - Queued spins: tracks remaining count and chains them
 *
 * Dependencies:
 *  - GSAP          (window.gsap — loaded globally; graceful fallback if absent)
 *  - InventoryStore
 *  - SettingsStore  (for CR balance)
 *  - HUDManager    (show/hide orchestration)
 *
 * Usage:
 *   const ws = new WheelspinUI(hudRoot, inventoryStore, settingsStore);
 *   ws.on('claimed', (prize) => …);
 *   ws.spin(prizePool, 'standard');   // or 'super'
 *   ws.spinQueued(n, prizePool);      // n queued spins
 */

export class WheelspinUI {
  /* ─────────────────────────── constructor ────────────────────────────── */

  constructor(hudRoot, inventoryStore, settingsStore) {
    /** @type {HTMLElement} */
    this.hudRoot = hudRoot;
    /** @type {InventoryStore} */
    this.inventory = inventoryStore;
    /** @type {SettingsStore} */
    this.settings  = settingsStore;

    this._listeners = { claimed: [], allClaimed: [] };

    /** Queue of pending spins [ { prizePool, type } ] */
    this._queue = [];
    /** Currently displayed root element */
    this._el    = null;
    /** GSAP tweens in progress */
    this._tweens = [];

    // Auto-detect GSAP
    this._gsap = (typeof window !== 'undefined' && window.gsap) ? window.gsap : null;

    this._handleKeyDown = this._handleKeyDown.bind(this);
  }

  /* ─────────────────────────── public API ─────────────────────────────── */

  /**
   * Start a single-spin session.
   * @param {Prize[]} prizePool  - Full weighted prize pool array
   * @param {'standard'|'super'} type
   */
  spin(prizePool, type = 'standard') {
    this._queue = [{ prizePool, type }];
    this._runNext();
  }

  /**
   * Queue multiple spins — chains them one after another after Claim.
   * @param {number}  count
   * @param {Prize[]} prizePool
   * @param {'standard'|'super'} type
   */
  spinQueued(count, prizePool, type = 'standard') {
    this._queue = Array.from({ length: count }, () => ({ prizePool, type }));
    this._runNext();
  }

  /** Register event listener. Returns `this` for chaining. */
  on(event, cb) {
    if (this._listeners[event]) this._listeners[event].push(cb);
    return this;
  }

  /* ─────────────────────────── queue management ───────────────────────── */

  _runNext() {
    if (this._queue.length === 0) {
      this._emit('allClaimed');
      return;
    }
    const { prizePool, type } = this._queue.shift();
    this._open(prizePool, type);
  }

  /* ─────────────────────────── overlay lifecycle ──────────────────────── */

  _open(prizePool, type) {
    this._close(false);   // clean up any stale overlay first

    const winners = this._pickWinners(prizePool, type === 'super' ? 3 : 1);
    const segments = this._buildSegmentList(prizePool, winners, type === 'super' ? 3 : 1);

    this._build(type, segments, winners);

    requestAnimationFrame(() => {
      if (this._el) this._el.classList.add('ws-visible');
    });

    document.addEventListener('keydown', this._handleKeyDown);

    // Small delay so overlay fade-in finishes before wheel starts
    setTimeout(() => this._startSpin(winners, type), 350);
  }

  _close(runNext = true) {
    document.removeEventListener('keydown', this._handleKeyDown);
    this._killTweens();

    if (this._el) {
      const el = this._el;
      this._el = null;
      el.classList.remove('ws-visible');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400);
    }

    if (runNext) setTimeout(() => this._runNext(), 120);
  }

  /* ─────────────────────────── prize selection ────────────────────────── */

  /**
   * Pick `count` winners from a weighted prize pool.
   * @param {Prize[]} pool
   * @param {number}  count
   * @returns {Prize[]}
   */
  _pickWinners(pool, count) {
    const weighted = this._expandWeighted(pool);
    const winners  = [];
    for (let i = 0; i < count; i++) {
      winners.push(weighted[Math.floor(Math.random() * weighted.length)]);
    }
    return winners;
  }

  /** Expand pool into a flat weighted array for easy random picking. */
  _expandWeighted(pool) {
    const out = [];
    for (const prize of pool) {
      const w = prize.weight ?? 1;
      for (let i = 0; i < w; i++) out.push(prize);
    }
    return out.length ? out : pool;
  }

  /**
   * Build the ordered segment ring for a wheel.
   * Ensures the winning segment is placed in a random legal position;
   * fills the rest with random pool entries for visual variety.
   */
  _buildSegmentList(pool, winners, wheelCount) {
    const all = [];
    for (let w = 0; w < wheelCount; w++) {
      const segs       = [];
      const winnerIdx  = Math.floor(Math.random() * SEGMENT_COUNT);
      const winner     = winners[w];

      for (let s = 0; s < SEGMENT_COUNT; s++) {
        if (s === winnerIdx) {
          segs.push({ ...winner, isWinner: true, _winnerIdx: winnerIdx });
        } else {
          // Fill with random non-guaranteed prize for visual noise
          const filler = pool[Math.floor(Math.random() * pool.length)];
          segs.push({ ...filler, isWinner: false, _winnerIdx: winnerIdx });
        }
      }
      all.push({ segs, winnerIdx });
    }
    return all;
  }

  /* ─────────────────────────── DOM construction ───────────────────────── */

  _build(type, segmentData, winners) {
    const el = document.createElement('div');
    el.className = `ws-overlay ws-overlay--${type}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', type === 'super' ? 'Super Wheelspin' : 'Wheelspin');

    const title     = type === 'super' ? '⭐ Super Wheelspin' : 'Wheelspin';
    const subtitle  = type === 'super'
      ? 'Three prizes — one spin!'
      : 'Spin the wheel — good luck!';

    const wheelCount = type === 'super' ? 3 : 1;

    el.innerHTML = /* html */`
      <div class="ws-backdrop" aria-hidden="true"></div>
      <div class="ws-container">

        <!-- Header -->
        <div class="ws-header">
          <h1 class="ws-title">${title}</h1>
          <p class="ws-subtitle">${subtitle}</p>
          ${this._queue.length > 0
            ? `<span class="ws-queue-badge">${this._queue.length} more after this</span>`
            : ''}
        </div>

        <!-- Wheel(s) -->
        <div class="ws-wheels-row" data-wheel-count="${wheelCount}">
          ${segmentData.map((_, i) => this._wheelHTML(segmentData[i], i)).join('')}
        </div>

        <!-- Reveal area (hidden until spin complete) -->
        <div class="ws-reveal" id="ws-reveal" aria-live="polite" hidden>
          <!-- Populated after spin -->
        </div>

        <!-- Spin button (shown pre-spin) -->
        <div class="ws-action" id="ws-action">
          <button class="ws-btn ws-btn--spin" id="ws-spin-btn"
                  aria-label="Spin the wheel">
            <span class="ws-btn-text">Spin</span>
            <span class="ws-btn-sparkle" aria-hidden="true">✨</span>
          </button>
        </div>

        <!-- Particles canvas (fanfare) -->
        <canvas class="ws-particles" id="ws-particles" aria-hidden="true"></canvas>
      </div>
    `;

    this.hudRoot.appendChild(el);
    this._el = el;

    this._injectStyle();
    this._wireEvents();
  }

  _wheelHTML({ segs }, wheelIndex) {
    const SIZE   = 320;   // px — SVG viewBox size
    const CX     = SIZE / 2;
    const CY     = SIZE / 2;
    const R      = CX - 8;

    const sliceAngle = (2 * Math.PI) / SEGMENT_COUNT;
    let paths = '';
    let labels = '';

    segs.forEach((seg, i) => {
      const startAngle = i * sliceAngle - Math.PI / 2;
      const endAngle   = startAngle + sliceAngle;

      const x1 = CX + R * Math.cos(startAngle);
      const y1 = CY + R * Math.sin(startAngle);
      const x2 = CX + R * Math.cos(endAngle);
      const y2 = CY + R * Math.sin(endAngle);

      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      const colour   = SEGMENT_COLOURS[seg.rarity ?? 'common'];

      paths += /* html */`<path
        d="M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} Z"
        fill="${colour}"
        stroke="#0f172a"
        stroke-width="1.5"
        data-segment-index="${i}"
        class="ws-segment${seg.isWinner ? ' ws-segment--winner' : ''}"
      />`;

      // Label at midpoint of slice
      const mid    = startAngle + sliceAngle / 2;
      const lx     = CX + (R * 0.65) * Math.cos(mid);
      const ly     = CY + (R * 0.65) * Math.sin(mid);
      const rotate = (mid * 180 / Math.PI) + 90;

      labels += /* html */`
        <text
          x="${lx}" y="${ly}"
          text-anchor="middle"
          dominant-baseline="middle"
          transform="rotate(${rotate}, ${lx}, ${ly})"
          class="ws-seg-label"
          font-size="${SIZE < 260 ? 9 : 11}"
          fill="#fff"
          opacity="0.9"
        >${seg.icon ?? seg.label?.slice(0, 8) ?? '?'}</text>
      `;
    });

    return /* html */`
      <div class="ws-wheel-wrap" data-wheel-index="${wheelIndex}">
        <!-- Pointer arrow -->
        <div class="ws-pointer" aria-hidden="true">▼</div>

        <!-- SVG wheel -->
        <div class="ws-wheel-svg-wrap" id="ws-wheel-${wheelIndex}">
          <svg viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"
               class="ws-wheel-svg" role="img"
               aria-label="Prize wheel ${wheelIndex + 1}">
            <!-- Outer ring -->
            <circle cx="${CX}" cy="${CY}" r="${R + 6}"
                    fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3"/>
            <!-- Segments -->
            ${paths}
            <!-- Labels -->
            ${labels}
            <!-- Centre hub -->
            <circle cx="${CX}" cy="${CY}" r="22"
                    fill="#0f172a" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
            <circle cx="${CX}" cy="${CY}" r="8"
                    fill="rgba(255,255,255,0.9)"/>
          </svg>
        </div>
      </div>
    `;
  }

  /* ─────────────────────────── spin animation ─────────────────────────── */

  /**
   * Main animation driver.
   * Uses GSAP if available; falls back to CSS animation + setTimeout.
   */
  _startSpin(winners, type) {
    const wheelCount = type === 'super' ? 3 : 1;
    let settled = 0;

    for (let w = 0; w < wheelCount; w++) {
      const winner    = winners[w];
      const winnerIdx = winner._winnerIdx ?? 0;
      this._animateWheel(w, winnerIdx, () => {
        settled++;
        if (settled === wheelCount) {
          this._onAllWheelsSettled(winners, type);
        }
      });
    }
  }

  /**
   * Animate a single wheel to land on winnerIdx.
   * @param {number}   wheelIndex
   * @param {number}   winnerIdx    - segment index to land on
   * @param {Function} onComplete
   */
  _animateWheel(wheelIndex, winnerIdx, onComplete) {
    const wrapEl = this._el?.querySelector(`#ws-wheel-${wheelIndex}`);
    if (!wrapEl) { onComplete(); return; }

    const sliceAngle    = 360 / SEGMENT_COUNT;
    // The pointer is at top (270° offset from SVG 0). We want winnerIdx segment centred at top.
    const targetSegDeg  = winnerIdx * sliceAngle;
    const stopDegInRing = (360 - targetSegDeg - sliceAngle / 2 + 270) % 360;
    // Add several full rotations to make the spin look exciting
    const fullSpins     = MIN_SPINS + Math.floor(Math.random() * EXTRA_SPINS);
    const finalDeg      = fullSpins * 360 + stopDegInRing;

    if (this._gsap) {
      this._animateWithGSAP(wrapEl, finalDeg, onComplete);
    } else {
      this._animateWithCSS(wrapEl, finalDeg, onComplete);
    }
  }

  _animateWithGSAP(wrapEl, finalDeg, onComplete) {
    const gsap = this._gsap;

    // Disable spin button during animation
    const spinBtn = this._el?.querySelector('#ws-spin-btn');
    if (spinBtn) spinBtn.disabled = true;

    const tween = gsap.to(wrapEl, {
      rotation: finalDeg,
      duration: SPIN_DURATION_S,
      ease: 'power4.inOut',   // accelerate quickly, slow to a dramatic stop
      transformOrigin: '50% 50%',
      onComplete,
    });

    this._tweens.push(tween);
  }

  _animateWithCSS(wrapEl, finalDeg, onComplete) {
    // Fallback: CSS transition
    wrapEl.style.transition = `transform ${SPIN_DURATION_S}s cubic-bezier(0.17, 0.67, 0.12, 1.0)`;
    wrapEl.style.transform  = `rotate(${finalDeg}deg)`;

    const end = () => {
      wrapEl.removeEventListener('transitionend', end);
      onComplete();
    };
    wrapEl.addEventListener('transitionend', end);
    // Fallback in case transitionend doesn't fire
    setTimeout(onComplete, (SPIN_DURATION_S + 0.5) * 1000);
  }

  _killTweens() {
    if (this._gsap) {
      this._tweens.forEach(t => { try { t.kill(); } catch(_){} });
    }
    this._tweens = [];
  }

  /* ─────────────────────────── post-spin reveal ───────────────────────── */

  _onAllWheelsSettled(winners, type) {
    // Small pause before reveal for drama
    setTimeout(() => this._revealPrizes(winners, type), 500);
  }

  _revealPrizes(winners, type) {
    if (!this._el) return;

    // Highlight winning segments
    winners.forEach((winner, wi) => {
      const winnerIdx = winner._winnerIdx ?? 0;
      const seg = this._el.querySelector(
        `[data-wheel-index="${wi}"] [data-segment-index="${winnerIdx}"]`
      );
      if (seg) {
        seg.classList.add('ws-segment--revealed');
        this._flashSegment(seg);
      }
    });

    // Build reveal cards
    const revealEl = this._el.querySelector('#ws-reveal');
    if (revealEl) {
      revealEl.hidden = false;
      revealEl.innerHTML = winners.map(w => this._prizeCardHTML(w)).join('');

      // Animate cards in staggered
      revealEl.querySelectorAll('.ws-prize-card').forEach((card, i) => {
        card.style.animationDelay = `${i * 150}ms`;
        card.classList.add('ws-prize-card--animate-in');
      });
    }

    // Swap action button to Claim
    const actionEl = this._el.querySelector('#ws-action');
    if (actionEl) {
      actionEl.innerHTML = /* html */`
        <button class="ws-btn ws-btn--claim" id="ws-claim-btn"
                aria-label="Claim your prize${winners.length > 1 ? 's' : ''}">
          Claim ${winners.length > 1 ? 'All Prizes' : 'Prize'}
        </button>
      `;
      actionEl.querySelector('#ws-claim-btn').addEventListener('click', () => {
        this._claimAll(winners);
      });
    }

    // Fire particle fanfare
    this._spawnParticles();
  }

  _prizeCardHTML(prize) {
    const isDuplicate = prize.type === 'car' && this.inventory?.ownscar?.(prize.id);
    const colour      = RARITY_COLOURS[prize.rarity ?? 'common'];

    let valueHtml = '';
    if (isDuplicate) {
      const cr = Math.round((prize.shopPrice ?? 0) * 0.8);
      valueHtml = /* html */`
        <div class="ws-prize-dup">
          Duplicate — Converted to
          <span class="ws-prize-cr">${cr.toLocaleString()} CR</span>
        </div>
      `;
    } else if (prize.type === 'credits') {
      valueHtml = `<div class="ws-prize-cr">${prize.amount?.toLocaleString() ?? '?'} CR</div>`;
    } else if (prize.type === 'xp') {
      valueHtml = `<div class="ws-prize-xp">+${prize.amount?.toLocaleString() ?? '?'} XP</div>`;
    } else {
      valueHtml = `<div class="ws-prize-name">${prize.label ?? prize.name ?? 'Prize'}</div>`;
    }

    return /* html */`
      <div class="ws-prize-card" style="--rarity-colour: ${colour};">
        <div class="ws-prize-rarity">${RARITY_LABELS[prize.rarity ?? 'common']}</div>
        <div class="ws-prize-icon" aria-hidden="true">${prize.icon ?? '🎁'}</div>
        ${valueHtml}
        ${prize.type === 'car' && !isDuplicate
          ? `<div class="ws-prize-car-name">${prize.name ?? ''}</div>` : ''}
      </div>
    `;
  }

  _flashSegment(segEl) {
    if (this._gsap) {
      this._gsap.to(segEl, {
        filter: 'brightness(2)',
        duration: 0.2,
        yoyo: true,
        repeat: 5,
        ease: 'power2.inOut',
      });
    } else {
      segEl.classList.add('ws-segment--flash');
    }
  }

  /* ─────────────────────────── claim ─────────────────────────────────── */

  _claimAll(winners) {
    winners.forEach(prize => {
      const isDuplicate = prize.type === 'car' && this.inventory?.ownscar?.(prize.id);

      if (isDuplicate) {
        const cr = Math.round((prize.shopPrice ?? 0) * 0.8);
        this.settings?.addCredits?.(cr);
        this._emit('claimed', { ...prize, convertedCR: cr });
      } else {
        this.inventory?.addPrize?.(prize);
        this._emit('claimed', prize);
      }
    });

    this._close(true);   // open next in queue if any
  }

  /* ─────────────────────────── particle fanfare ───────────────────────── */

  _spawnParticles() {
    const canvas = this._el?.querySelector('#ws-particles');
    if (!canvas) return;

    const ctx    = canvas.getContext('2d');
    canvas.width  = canvas.offsetWidth  || 800;
    canvas.height = canvas.offsetHeight || 600;

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x:   canvas.width  / 2 + (Math.random() - 0.5) * 200,
      y:   canvas.height / 2 + (Math.random() - 0.5) * 100,
      vx:  (Math.random() - 0.5) * 8,
      vy:  -(2 + Math.random() * 6),
      r:   3 + Math.random() * 5,
      c:   PARTICLE_COLOURS[Math.floor(Math.random() * PARTICLE_COLOURS.length)],
      a:   1,
      rot: Math.random() * Math.PI * 2,
      rv:  (Math.random() - 0.5) * 0.3,
    }));

    let frame;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      for (const p of particles) {
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.18;   // gravity
        p.a  -= 0.012;
        p.rot += p.rv;

        if (p.a <= 0) continue;
        alive = true;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.a);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r);
        ctx.restore();
      }

      if (alive) {
        frame = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    frame = requestAnimationFrame(tick);

    // Safety: cancel after 4 seconds regardless
    setTimeout(() => {
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 4000);
  }

  /* ─────────────────────────── UI wiring ─────────────────────────────── */

  _wireEvents() {
    const spinBtn = this._el?.querySelector('#ws-spin-btn');
    spinBtn?.addEventListener('click', () => {
      spinBtn.disabled = true;
      spinBtn.classList.add('ws-btn--spinning');
      // Spin is triggered by _open() after delay — button is cosmetic here for manual trigger
    });
  }

  _handleKeyDown(e) {
    if (!this._el) return;
    if (e.key === 'Escape') {
      // Only allow Escape after spin completes (claim button visible)
      const claimBtn = this._el.querySelector('#ws-claim-btn');
      if (claimBtn) {
        e.preventDefault();
        claimBtn.click();
      }
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const claimBtn = this._el.querySelector('#ws-claim-btn');
      if (claimBtn && document.activeElement === claimBtn) {
        e.preventDefault();
        claimBtn.click();
      }
    }
  }

  /* ─────────────────────────── event bus ─────────────────────────────── */

  _emit(event, data) {
    (this._listeners[event] ?? []).forEach(cb => cb(data));
  }

  /* ─────────────────────────── CSS injection ──────────────────────────── */

  _injectStyle() {
    if (document.getElementById('ws-style')) return;
    const style = document.createElement('style');
    style.id = 'ws-style';
    style.textContent = WS_CSS;
    document.head.appendChild(style);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════════════ */

/** Segments per wheel */
const SEGMENT_COUNT  = 16;

/** How many full rotations before the final stop */
const MIN_SPINS      = 5;
const EXTRA_SPINS    = 3;

/** Total spin duration in seconds */
const SPIN_DURATION_S = 4.5;

/** Particle fanfare */
const PARTICLE_COUNT  = 80;
const PARTICLE_COLOURS = ['#fbbf24','#f472b6','#34d399','#60a5fa','#a78bfa','#fb923c'];

/** Segment fill colours per rarity */
const SEGMENT_COLOURS = {
  veryCommon: '#374151',
  common:     '#1e3a5f',
  uncommon:   '#1a4731',
  rare:       '#3b1f6b',
  veryRare:   '#6b1414',
  legendary:  '#783300',
};

/** Glow/border colours for prize cards */
const RARITY_COLOURS = {
  veryCommon: 'rgba(156,163,175,0.4)',
  common:     'rgba(59,130,246,0.4)',
  uncommon:   'rgba(52,211,153,0.5)',
  rare:       'rgba(139,92,246,0.6)',
  veryRare:   'rgba(239,68,68,0.6)',
  legendary:  'rgba(251,146,60,0.7)',
};

const RARITY_LABELS = {
  veryCommon: 'Common',
  common:     'Common',
  uncommon:   'Uncommon',
  rare:       'Rare',
  veryRare:   'Very Rare',
  legendary:  '✨ Legendary',
};

/* ══════════════════════════════════════════════════════════════════════════
   CSS
══════════════════════════════════════════════════════════════════════════ */

const WS_CSS = `
/* ── Root overlay ───────────────────────────────────────────────────── */
.ws-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-wheelspin, 950);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 300ms ease;
  pointer-events: none;
  font-family: var(--font-ui, 'Inter', sans-serif);
  color: #fff;
}
.ws-overlay.ws-visible {
  opacity: 1;
  pointer-events: auto;
}

/* ── Backdrop ───────────────────────────────────────────────────────── */
.ws-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  backdrop-filter: blur(8px) saturate(0.5);
  -webkit-backdrop-filter: blur(8px) saturate(0.5);
}

/* ── Container ──────────────────────────────────────────────────────── */
.ws-container {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  max-width: 1000px;
  width: 100%;
  padding: 36px 24px 32px;
}

/* ── Header ─────────────────────────────────────────────────────────── */
.ws-header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.ws-title {
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -0.03em;
  margin: 0;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.ws-overlay--super .ws-title {
  background: linear-gradient(135deg, #a78bfa, #f472b6, #fb923c);
  -webkit-background-clip: text;
  background-clip: text;
}
.ws-subtitle {
  font-size: 14px;
  color: rgba(255,255,255,0.5);
  margin: 0;
}
.ws-queue-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: rgba(139,92,246,0.2);
  border: 1px solid rgba(139,92,246,0.4);
  color: #c4b5fd;
  padding: 3px 10px;
  border-radius: 20px;
  margin-top: 4px;
}

/* ── Wheel row ──────────────────────────────────────────────────────── */
.ws-wheels-row {
  display: flex;
  gap: 32px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}
.ws-wheels-row[data-wheel-count="1"] .ws-wheel-wrap { transform: scale(1.15); }

/* ── Single wheel ───────────────────────────────────────────────────── */
.ws-wheel-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  position: relative;
}
.ws-pointer {
  font-size: 22px;
  color: #fbbf24;
  line-height: 1;
  filter: drop-shadow(0 0 8px rgba(251,191,36,0.8));
  z-index: 2;
}
.ws-wheel-svg-wrap {
  transform-origin: center center;
  will-change: transform;
  filter: drop-shadow(0 4px 24px rgba(0,0,0,0.6));
}
.ws-wheel-svg { display: block; }

/* ── Segments ───────────────────────────────────────────────────────── */
.ws-segment {
  transition: filter 80ms;
}
.ws-segment--revealed {
  filter: brightness(1.5) saturate(1.3);
  stroke: #fbbf24 !important;
  stroke-width: 2.5 !important;
}
.ws-segment--flash {
  animation: ws-seg-flash 0.15s linear 6;
}
@keyframes ws-seg-flash {
  0%   { filter: brightness(1); }
  50%  { filter: brightness(2.5); }
  100% { filter: brightness(1); }
}
.ws-seg-label {
  pointer-events: none;
  user-select: none;
}

/* ── Reveal area ────────────────────────────────────────────────────── */
.ws-reveal {
  display: flex;
  gap: 20px;
  justify-content: center;
  flex-wrap: wrap;
  width: 100%;
}
.ws-prize-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 24px;
  background: rgba(15, 23, 42, 0.85);
  border: 2px solid var(--rarity-colour, rgba(255,255,255,0.2));
  border-radius: 14px;
  min-width: 150px;
  box-shadow: 0 0 20px var(--rarity-colour, transparent);
  opacity: 0;
  transform: translateY(20px) scale(0.95);
  transition: none;
}
.ws-prize-card--animate-in {
  animation: ws-card-in 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes ws-card-in {
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.ws-prize-rarity {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.45);
}
.ws-prize-icon {
  font-size: 40px;
  line-height: 1;
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5));
}
.ws-prize-cr {
  font-size: 18px;
  font-weight: 800;
  color: #fbbf24;
}
.ws-prize-xp {
  font-size: 18px;
  font-weight: 800;
  color: #a78bfa;
}
.ws-prize-name {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  text-align: center;
}
.ws-prize-car-name {
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  text-align: center;
}
.ws-prize-dup {
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  text-align: center;
  line-height: 1.4;
}

/* ── Action buttons ─────────────────────────────────────────────────── */
.ws-action { display: flex; justify-content: center; }
.ws-btn {
  padding: 14px 44px;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.04em;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 150ms, transform 80ms, box-shadow 150ms;
}
.ws-btn:active  { transform: scale(0.96); }
.ws-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ws-btn:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

.ws-btn--spin {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #0f172a;
  box-shadow: 0 0 24px rgba(245,158,11,0.4);
  min-width: 180px;
  justify-content: center;
}
.ws-btn--spin:hover { box-shadow: 0 0 36px rgba(245,158,11,0.6); }
.ws-btn--spin.ws-btn--spinning {
  animation: ws-spin-pulse 0.6s ease-in-out infinite alternate;
}
@keyframes ws-spin-pulse {
  to { box-shadow: 0 0 48px rgba(245,158,11,0.8); }
}
.ws-btn-sparkle { font-size: 18px; }

.ws-btn--claim {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  box-shadow: 0 0 24px rgba(124,58,237,0.45);
  min-width: 200px;
  justify-content: center;
  animation: ws-claim-appear 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.ws-btn--claim:hover { box-shadow: 0 0 36px rgba(124,58,237,0.65); }
@keyframes ws-claim-appear {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}

/* ── Particles canvas ───────────────────────────────────────────────── */
.ws-particles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

/* ── Responsive ─────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  .ws-wheels-row[data-wheel-count="3"] .ws-wheel-svg {
    width: 220px;
    height: 220px;
  }
  .ws-title { font-size: 26px; }
  .ws-container { padding: 24px 16px; gap: 20px; }
}
@media (max-width: 600px) {
  .ws-wheels-row {
    gap: 16px;
  }
  .ws-wheels-row[data-wheel-count="3"] .ws-wheel-svg {
    width: 160px;
    height: 160px;
  }
  .ws-wheels-row[data-wheel-count="1"] .ws-wheel-svg {
    width: 260px;
    height: 260px;
  }
  .ws-title { font-size: 22px; }
  .ws-btn { padding: 12px 28px; font-size: 15px; }
}
`;

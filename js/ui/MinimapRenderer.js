/**
 * MinimapRenderer.js
 * Part 8 — UI, HUD & Menus
 *
 * Draws the circular minimap onto a <canvas> element.
 * Handles: road network lines, player arrow, AI dots, POI icons,
 * race route line + pulsing waypoint. Rotates with player heading.
 * Manages the brief expand on hold-M and hands off to full map on tap-M.
 *
 * Consumed each frame via update(playerState, worldData, raceState).
 * HUDManager creates this and mounts it; it has no knowledge of other modules.
 *
 * Coordinate conventions (Three.js):
 *   World: x = east, z = south, y = up (ignored here)
 *   Heading: radians, 0 = facing +Z (south), increases clockwise viewed from above
 *   Minimap: canvas y+ = down, so "forward" is drawn toward canvas top (y-)
 */

export class MinimapRenderer {
  // ─── Constants ──────────────────────────────────────────────────────────────

  /** Default diameter in CSS pixels at full resolution. */
  static BASE_DIAMETER = 180;

  /** Expanded diameter while M is held. */
  static EXPANDED_DIAMETER = 300;

  /** World-space radius shown on the minimap at default zoom (metres). */
  static DEFAULT_WORLD_RADIUS = 1000;

  /** Tapping M within this many ms opens full map instead of expanding. */
  static TAP_THRESHOLD_MS = 250;

  /** How long the expand animation takes (ms). */
  static EXPAND_DURATION_MS = 180;

  /** Waypoint pulse cycle duration (ms). */
  static PULSE_DURATION_MS = 1200;

  // ─── Colour palette (all minimap drawing colours) ───────────────────────────

  static COLOURS = {
    background:      'rgba(8, 10, 14, 0.88)',
    border:          '#ff6b1a',              // FH5 Horizon Festival orange ring
    borderExpanded:  '#ff8c40',              // brighter orange when expanded
    road:            'rgba(190, 195, 205, 0.60)',
    roadMinor:       'rgba(140, 145, 155, 0.38)',
    player:          '#ff6b1a',              // FH5: orange player dot
    playerShadow:    'rgba(0,0,0,0.7)',
    aiDot:           '#FF3B30',
    routeLine:       '#ff6b1a',              // FH5: orange route line
    waypointCore:    '#ff6b1a',
    waypointGlow:    'rgba(255, 107, 26, 0.0)',  // animated FH5 orange
    poiShop:         '#2C9CF0',
    poiRace:         '#ff6b1a',              // FH5 orange for race events
    poiBoard:        '#FFD700',
    poiLandmark:     '#FFFFFF',
    poiFastTravel:   '#A855F7',
    compassLabel:    'rgba(255,255,255,0.45)',
    cardinalN:       'rgba(255, 60, 60, 0.85)',
  };

  // ─── Constructor ─────────────────────────────────────────────────────────────

  /**
   * @param {HTMLElement} container  - The HUD root element to append the minimap into.
   * @param {object}      options
   * @param {() => void}  options.onOpenFullMap  - Called when the player taps M.
   *   HUDManager intercepts this to open PhoneMenu on the Map tab — keeps modules decoupled.
   */
  constructor(container, { onOpenFullMap = () => {} } = {}) {
    this._container   = container;
    this._onOpenFullMap = onOpenFullMap;

    // Current rendered diameter (animated between BASE and EXPANDED).
    this._currentDiameter  = MinimapRenderer.BASE_DIAMETER;
    this._targetDiameter   = MinimapRenderer.BASE_DIAMETER;

    // Expand / tap tracking.
    this._mPressedAt  = null;   // timestamp of M keydown, null if not held
    this._isExpanded  = false;

    // Pulse tracking.
    this._pulseStart  = performance.now();

    // Cached frame state (set each update call).
    this._playerState = null;
    this._worldData   = null;
    this._raceState   = null;

    // CSS scale factor from HUDManager (responsive breakpoints).
    this._uiScale = 1;

    this._build();
    this._bindKeys();

    // Animation loop — runs independently so the minimap always animates even
    // when update() is called at a lower frequency.
    this._rafId = null;
    this._animating = false;
    this._startAnimLoop();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Called once per game frame with fresh state.
   *
   * @param {object} playerState
   * @param {number} playerState.x          World X position
   * @param {number} playerState.z          World Z position
   * @param {number} playerState.heading    Rotation in radians (0 = +Z / south)
   * @param {number} playerState.speed      km/h (unused here but passed in)
   * @param {boolean} playerState.isOnFoot  Hides car-specific decorations
   *
   * @param {object} worldData
   * @param {Array}  worldData.roadSegments   [{x1,z1,x2,z2,minor?}]
   * @param {Array}  worldData.pois           [{x,z,type,label}]  type: 'shop'|'race'|'board'|'landmark'|'fasttravel'
   *
   * @param {object|null} raceState           null when not in a race
   * @param {Array}  raceState.routePoints    [{x,z}] ordered list forming the race route polyline
   * @param {number} raceState.nextWaypointIdx  index into routePoints for the next waypoint
   * @param {Array}  raceState.aiPositions    [{x,z}]
   */
  update(playerState, worldData, raceState = null) {
    this._playerState = playerState;
    this._worldData   = worldData;
    this._raceState   = raceState;
    // Actual redraw happens in the animation loop (_draw).
  }

  /**
   * Called by HUDManager when responsive CSS variables are recalculated.
   * @param {number} scale  — e.g. 0.8 at <1280px, 0.65 at <900px
   */
  setUIScale(scale) {
    this._uiScale = scale;
    this._applyContainerSize(this._currentDiameter);
  }

  /** Show or hide the entire minimap. */
  setVisible(visible) {
    this._wrapper.style.display = visible ? '' : 'none';
  }

  /** Clean up event listeners and cancel animation frame. */
  destroy() {
    this._stopAnimLoop();
    this._unbindKeys();
    if (this._wrapper.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
  }

  // ─── DOM Construction ────────────────────────────────────────────────────────

  _build() {
    // Outer wrapper — positioned bottom-left by HUDManager's CSS.
    const wrapper = document.createElement('div');
    wrapper.className = 'minimap-wrapper';
    wrapper.setAttribute('aria-label', 'Minimap');
    wrapper.setAttribute('role', 'img');
    Object.assign(wrapper.style, {
      position:       'absolute',
      bottom:         '24px',
      left:           '24px',
      borderRadius:   '50%',
      overflow:       'hidden',
      boxShadow:      '0 4px 24px rgba(0,0,0,0.55)',
      transition:     `width ${MinimapRenderer.EXPAND_DURATION_MS}ms cubic-bezier(.4,0,.2,1),
                       height ${MinimapRenderer.EXPAND_DURATION_MS}ms cubic-bezier(.4,0,.2,1)`,
      pointerEvents:  'none',   // HUDManager owns pointer-events at the root
      zIndex:         '10',
    });

    // Canvas inside the wrapper.
    const canvas = document.createElement('canvas');
    canvas.className = 'minimap-canvas';
    // We draw at 2× device pixel ratio for crisp rendering.
    // Actual CSS size is set by _applyContainerSize.
    wrapper.appendChild(canvas);

    // Compass N label (sits outside canvas, overlaid via absolute positioning).
    const compass = document.createElement('span');
    compass.className = 'minimap-compass';
    compass.textContent = 'N';
    Object.assign(compass.style, {
      position:   'absolute',
      top:        '4px',
      left:       '50%',
      transform:  'translateX(-50%)',
      fontSize:   '9px',
      fontFamily: 'system-ui, sans-serif',
      fontWeight: '700',
      color:      MinimapRenderer.COLOURS.cardinalN,
      letterSpacing: '0.05em',
      userSelect: 'none',
      pointerEvents: 'none',
    });
    wrapper.appendChild(compass);

    this._wrapper  = wrapper;
    this._canvas   = canvas;
    this._compass  = compass;
    this._ctx      = canvas.getContext('2d');

    this._applyContainerSize(this._currentDiameter);
    this._container.appendChild(wrapper);
  }

  /**
   * Resize the canvas and wrapper to match the given CSS diameter.
   * Uses devicePixelRatio for HiDPI clarity.
   */
  _applyContainerSize(cssDiameter) {
    const scaled = cssDiameter * this._uiScale;
    const dpr    = window.devicePixelRatio || 1;

    this._wrapper.style.width  = `${scaled}px`;
    this._wrapper.style.height = `${scaled}px`;

    this._canvas.style.width   = `${scaled}px`;
    this._canvas.style.height  = `${scaled}px`;
    this._canvas.width         = Math.round(scaled * dpr);
    this._canvas.height        = Math.round(scaled * dpr);

    // Store for draw calls.
    this._cssDiameter  = scaled;
    this._canvasSize   = Math.round(scaled * dpr);
    this._center       = this._canvasSize / 2;
    this._dpr          = dpr;
  }

  // ─── Input Binding ───────────────────────────────────────────────────────────

  _bindKeys() {
    this._onKeyDown = (e) => {
      if (e.code !== 'KeyM' || e.repeat) return;
      this._mPressedAt = performance.now();
      this._expand();
    };
    this._onKeyUp = (e) => {
      if (e.code !== 'KeyM' || this._mPressedAt === null) return;
      const held = performance.now() - this._mPressedAt;
      this._mPressedAt = null;
      if (held < MinimapRenderer.TAP_THRESHOLD_MS) {
        // Quick tap → open full map.
        this._collapse();
        this._onOpenFullMap();
      } else {
        // Held → just collapse back.
        this._collapse();
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);
  }

  _unbindKeys() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
  }

  _expand() {
    if (this._isExpanded) return;
    this._isExpanded    = true;
    this._targetDiameter = MinimapRenderer.EXPANDED_DIAMETER;
  }

  _collapse() {
    if (!this._isExpanded) return;
    this._isExpanded    = false;
    this._targetDiameter = MinimapRenderer.BASE_DIAMETER;
  }

  // ─── Animation Loop ──────────────────────────────────────────────────────────

  _startAnimLoop() {
    this._animating = true;
    const tick = () => {
      if (!this._animating) return;
      this._animateDiameter();
      this._draw();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopAnimLoop() {
    this._animating = false;
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * Smoothly lerp _currentDiameter toward _targetDiameter.
   * CSS transitions on the wrapper handle the visual size change;
   * we update the canvas backing store when they differ significantly.
   */
  _animateDiameter() {
    const diff = this._targetDiameter - this._currentDiameter;
    if (Math.abs(diff) < 0.5) {
      if (this._currentDiameter !== this._targetDiameter) {
        this._currentDiameter = this._targetDiameter;
        this._applyContainerSize(this._currentDiameter);
      }
      return;
    }
    // Lerp at ~10 units/frame — crisp without being jarring.
    this._currentDiameter += diff * 0.18;
    this._applyContainerSize(this._currentDiameter);
  }

  // ─── Main Draw ───────────────────────────────────────────────────────────────

  _draw() {
    const ctx   = this._ctx;
    const size  = this._canvasSize;
    const cx    = this._center;
    const cy    = this._center;
    const r     = size / 2;

    ctx.clearRect(0, 0, size, size);

    // Clip everything to the circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    // Background.
    ctx.fillStyle = MinimapRenderer.COLOURS.background;
    ctx.fillRect(0, 0, size, size);

    if (!this._playerState) {
      ctx.restore();
      this._drawBorder(ctx, cx, cy, r);
      return;
    }

    const { x: px, z: pz, heading } = this._playerState;
    // pixels per world metre on the canvas
    const worldRadius = MinimapRenderer.DEFAULT_WORLD_RADIUS;
    const scale = r / worldRadius;   // canvas pixels per world metre

    // ── Road network ──────────────────────────────────────────────────────────
    this._drawRoads(ctx, px, pz, heading, scale, cx, cy, r);

    // ── Race route + waypoint ─────────────────────────────────────────────────
    if (this._raceState) {
      this._drawRaceRoute(ctx, px, pz, heading, scale, cx, cy, r);
    }

    // ── POI icons ─────────────────────────────────────────────────────────────
    if (this._worldData?.pois) {
      this._drawPOIs(ctx, px, pz, heading, scale, cx, cy, r);
    }

    // ── AI dots ───────────────────────────────────────────────────────────────
    if (this._raceState?.aiPositions) {
      this._drawAIDots(ctx, px, pz, heading, scale, cx, cy, r);
    }

    // ── Player arrow ──────────────────────────────────────────────────────────
    this._drawPlayerArrow(ctx, cx, cy);

    ctx.restore();  // end clip

    // ── Border ring (drawn outside clip so it sits clean on top) ──────────────
    this._drawBorder(ctx, cx, cy, r);
  }

  // ─── Road Network ────────────────────────────────────────────────────────────

  _drawRoads(ctx, px, pz, heading, scale, cx, cy, r) {
    const segments = this._worldData?.roadSegments ?? [];
    if (!segments.length) return;

    // Draw minor roads first (under major).
    ctx.lineWidth = Math.max(1, scale * 5 * this._dpr * 0.5);   // ~minor road width
    ctx.strokeStyle = MinimapRenderer.COLOURS.roadMinor;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const seg of segments) {
      if (!seg.minor) continue;
      const a = this._worldToCanvas(seg.x1, seg.z1, px, pz, heading, scale, cx, cy);
      const b = this._worldToCanvas(seg.x2, seg.z2, px, pz, heading, scale, cx, cy);
      if (!this._segmentNearCircle(a, b, r, cx, cy)) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // Major roads.
    ctx.lineWidth = Math.max(1.5, scale * 10 * this._dpr * 0.5);
    ctx.strokeStyle = MinimapRenderer.COLOURS.road;
    ctx.beginPath();
    for (const seg of segments) {
      if (seg.minor) continue;
      const a = this._worldToCanvas(seg.x1, seg.z1, px, pz, heading, scale, cx, cy);
      const b = this._worldToCanvas(seg.x2, seg.z2, px, pz, heading, scale, cx, cy);
      if (!this._segmentNearCircle(a, b, r, cx, cy)) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  // ─── Race Route ──────────────────────────────────────────────────────────────

  _drawRaceRoute(ctx, px, pz, heading, scale, cx, cy, r) {
    const { routePoints, nextWaypointIdx } = this._raceState;
    if (!routePoints?.length) return;

    // Route polyline.
    ctx.save();
    ctx.strokeStyle = MinimapRenderer.COLOURS.routeLine;
    ctx.lineWidth   = Math.max(2, 2.5 * this._dpr);
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.setLineDash([Math.round(4 * this._dpr), Math.round(4 * this._dpr)]);
    ctx.beginPath();

    let first = true;
    for (const pt of routePoints) {
      const c = this._worldToCanvas(pt.x, pt.z, px, pz, heading, scale, cx, cy);
      if (first) { ctx.moveTo(c.x, c.y); first = false; }
      else        { ctx.lineTo(c.x, c.y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Pulsing next waypoint.
    if (nextWaypointIdx != null && nextWaypointIdx < routePoints.length) {
      const wp = routePoints[nextWaypointIdx];
      const wc = this._worldToCanvas(wp.x, wp.z, px, pz, heading, scale, cx, cy);
      // Only draw if on-screen.
      const dx = wc.x - cx, dy = wc.y - cy;
      if (dx * dx + dy * dy <= r * r) {
        this._drawWaypointPulse(ctx, wc.x, wc.y);
      }
    }
  }

  _drawWaypointPulse(ctx, x, y) {
    const t   = (performance.now() - this._pulseStart) / MinimapRenderer.PULSE_DURATION_MS;
    const sin = Math.sin(t * Math.PI * 2);
    const pulse = 0.5 + 0.5 * sin;   // 0..1

    const innerR  = 3  * this._dpr;
    const outerR  = (6 + 4 * pulse) * this._dpr;
    const opacity = 0.3 + 0.5 * (1 - pulse);

    // Glow ring.
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, outerR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(44, 156, 240, ${opacity})`;
    ctx.fill();

    // Solid core.
    ctx.beginPath();
    ctx.arc(x, y, innerR, 0, Math.PI * 2);
    ctx.fillStyle = MinimapRenderer.COLOURS.waypointCore;
    ctx.fill();
    ctx.restore();
  }

  // ─── POI Icons ───────────────────────────────────────────────────────────────

  _drawPOIs(ctx, px, pz, heading, scale, cx, cy, r) {
    const POI_COLOUR = {
      shop:       MinimapRenderer.COLOURS.poiShop,
      race:       MinimapRenderer.COLOURS.poiRace,
      board:      MinimapRenderer.COLOURS.poiBoard,
      landmark:   MinimapRenderer.COLOURS.poiLandmark,
      fasttravel: MinimapRenderer.COLOURS.poiFastTravel,
    };

    for (const poi of this._worldData.pois) {
      const c = this._worldToCanvas(poi.x, poi.z, px, pz, heading, scale, cx, cy);
      // Skip if outside circle.
      const dx = c.x - cx, dy = c.y - cy;
      if (dx * dx + dy * dy > r * r) continue;

      const colour = POI_COLOUR[poi.type] ?? '#FFFFFF';
      this._drawPOIDot(ctx, c.x, c.y, colour, poi.type);
    }
  }

  _drawPOIDot(ctx, x, y, colour, type) {
    const dr = this._dpr;
    ctx.save();
    ctx.fillStyle   = colour;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth   = 1 * dr;

    if (type === 'landmark') {
      // Diamond.
      const s = 4 * dr;
      ctx.beginPath();
      ctx.moveTo(x,     y - s);
      ctx.lineTo(x + s, y    );
      ctx.lineTo(x,     y + s);
      ctx.lineTo(x - s, y    );
      ctx.closePath();
    } else if (type === 'race') {
      // Triangle (flag-like).
      const s = 4 * dr;
      ctx.beginPath();
      ctx.moveTo(x,     y - s);
      ctx.lineTo(x + s, y + s);
      ctx.lineTo(x - s, y + s);
      ctx.closePath();
    } else {
      // Default: circle.
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * dr, 0, Math.PI * 2);
    }

    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ─── AI Dots ─────────────────────────────────────────────────────────────────

  _drawAIDots(ctx, px, pz, heading, scale, cx, cy, r) {
    ctx.fillStyle = MinimapRenderer.COLOURS.aiDot;

    for (const ai of this._raceState.aiPositions) {
      const c = this._worldToCanvas(ai.x, ai.z, px, pz, heading, scale, cx, cy);
      const dx = c.x - cx, dy = c.y - cy;
      if (dx * dx + dy * dy > r * r) continue;

      ctx.save();
      // Drop shadow for readability.
      ctx.shadowColor  = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur   = 3 * this._dpr;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3 * this._dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── Player Arrow ────────────────────────────────────────────────────────────

  /**
   * The player arrow is always drawn at the canvas centre.
   * In heading-up mode the map rotates around it, so no transform needed here.
   */
  _drawPlayerArrow(ctx, cx, cy) {
    const dr   = this._dpr;
    const size = 7 * dr;

    ctx.save();
    ctx.translate(cx, cy);
    // Arrow always points up (canvas north = player forward).
    ctx.beginPath();
    ctx.moveTo(0,          -size);          // tip
    ctx.lineTo( size * 0.55, size * 0.7);  // bottom-right
    ctx.lineTo(0,           size * 0.3);   // inner bottom
    ctx.lineTo(-size * 0.55, size * 0.7);  // bottom-left
    ctx.closePath();

    // Shadow.
    ctx.shadowColor  = MinimapRenderer.COLOURS.playerShadow;
    ctx.shadowBlur   = 5 * dr;
    ctx.fillStyle    = MinimapRenderer.COLOURS.player;
    ctx.fill();

    // Thin outline.
    ctx.shadowBlur   = 0;
    ctx.strokeStyle  = 'rgba(0,0,0,0.45)';
    ctx.lineWidth    = 1 * dr;
    ctx.stroke();

    ctx.restore();
  }

  // ─── Border Ring ─────────────────────────────────────────────────────────────

  _drawBorder(ctx, cx, cy, r) {
    ctx.save();

    // Outer glow (subtle orange bloom — FH5 signature)
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 107, 26, 0.25)';
    ctx.lineWidth   = 5 * this._dpr;
    ctx.stroke();

    // Main FH5 Horizon Festival orange border ring
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.strokeStyle = this._isExpanded
      ? MinimapRenderer.COLOURS.borderExpanded
      : MinimapRenderer.COLOURS.border;
    ctx.lineWidth   = 3 * this._dpr;
    ctx.stroke();

    // Inner dark ring (FH5 has a thin dark separator inside the orange ring)
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth   = 1 * this._dpr;
    ctx.stroke();

    ctx.restore();
  }

  // ─── Coordinate Transform ────────────────────────────────────────────────────

  /**
   * Converts a world (x, z) position into canvas pixel coordinates
   * centred on (cx, cy) and rotated so the player's heading faces canvas-up.
   *
   * @param {number} wx   World X
   * @param {number} wz   World Z
   * @param {number} px   Player world X
   * @param {number} pz   Player world Z
   * @param {number} h    Player heading (radians, 0 = +Z, increases CW from above)
   * @param {number} scale  Canvas pixels per world metre
   * @param {number} cx   Canvas centre X
   * @param {number} cy   Canvas centre Y
   * @returns {{ x: number, y: number }}
   */
  _worldToCanvas(wx, wz, px, pz, h, scale, cx, cy) {
    // Offset from player.
    const dx = wx - px;
    const dz = wz - pz;

    // Rotate so player heading = canvas up (−y).
    // heading=0 means facing +Z; to put +Z at canvas top we rotate by -h.
    const cosH =  Math.cos(-h);
    const sinH =  Math.sin(-h);
    const rx   =  dx * cosH - dz * sinH;
    const rz   =  dx * sinH + dz * cosH;

    // Canvas y is inverted (world +Z maps to canvas −y after rotation).
    return {
      x: cx + rx * scale,
      y: cy - rz * scale,
    };
  }

  /**
   * Cheap check: is any part of a segment within the circular draw area?
   * Avoids stroking segments that are entirely off-map.
   */
  _segmentNearCircle(a, b, r, cx, cy) {
    // Check both endpoints and midpoint against a slightly larger radius.
    const margin = r * 1.1;
    const m2 = margin * margin;
    const check = (p) => {
      const dx = p.x - cx, dy = p.y - cy;
      return dx * dx + dy * dy < m2;
    };
    if (check(a) || check(b)) return true;
    // Midpoint.
    return check({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
}

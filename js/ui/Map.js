/**
 * map.js — Full-Screen Map Overlay
 * Part UI
 *
 * Responsibilities:
 *  - Full-screen Canvas 2D overhead map of Horizon City
 *  - Draws district colour zones, road network (vector lines), and labels
 *  - Player arrow icon always visible; re-centres on open
 *  - 5-level zoom (scroll wheel / pinch) with smooth lerp
 *  - Click-drag / touch-drag to pan
 *  - Icon layers (toggleable): Races, Shops, Boards, Landmarks, Fast Travel, AI
 *  - Click POI icon → info card slides in from right (name, description, action button)
 *  - Info card actions: fast travel to race, shop, or set board as minimap destination
 *  - Press C to re-centre on player
 *  - Escape / M to close
 *  - Keyboard navigable (Tab through filters, Enter to toggle)
 *  - Exposes setPlayerPos(), setAIPositions(), markBoardCollected() for live updates
 *
 * Exports:
 *  FullscreenMap                      — class
 *  createFullscreenMap(opts)          — factory
 *
 * Dependencies:
 *  None — pure Canvas 2D + DOM. No Three.js or Rapier.
 */

'use strict';

// ─── World → screen coordinate system ────────────────────────────────────────
// Horizon City is 4 km × 4 km, origin at centre.
// World coords: X = east, Z = north (matches Three.js XZ plane).
// Map canvas maps world [-2000, 2000] onto canvas pixels at current zoom/pan.

const WORLD_SIZE   = 4000; // metres across
const ZOOM_LEVELS  = [0.12, 0.22, 0.40, 0.70, 1.20]; // px per metre
const ZOOM_DEFAULT = 1;    // index into ZOOM_LEVELS (city overview)

// ─── District definitions ─────────────────────────────────────────────────────

const DISTRICTS = [
  {
    id: 'downtown',
    label: 'Downtown Core',
    color: 'rgba(100,140,220,0.18)',
    borderColor: 'rgba(100,140,220,0.45)',
    // Approximate bounding polygon [worldX, worldZ] pairs
    poly: [[-600,600],[600,600],[600,-200],[-600,-200]],
  },
  {
    id: 'waterfront',
    label: 'Waterfront & Harbor',
    color: 'rgba(60,180,200,0.18)',
    borderColor: 'rgba(60,180,200,0.45)',
    poly: [[600,600],[1800,600],[1800,-600],[600,-200]],
  },
  {
    id: 'industrial',
    label: 'Industrial Zone',
    color: 'rgba(180,130,60,0.18)',
    borderColor: 'rgba(180,130,60,0.45)',
    poly: [[-1800,200],[-600,200],[-600,-600],[-1800,-600]],
  },
  {
    id: 'suburbs',
    label: 'Suburbs & Hillside',
    color: 'rgba(80,180,90,0.18)',
    borderColor: 'rgba(80,180,90,0.45)',
    poly: [[-600,600],[-1800,600],[-1800,200],[-600,200]],
  },
  {
    id: 'racing',
    label: 'Racing District',
    color: 'rgba(220,80,60,0.18)',
    borderColor: 'rgba(220,80,60,0.45)',
    poly: [[-600,-200],[600,-200],[600,-1000],[-600,-1000]],
  },
  {
    id: 'outskirts',
    label: 'Outskirts & Highway',
    color: 'rgba(160,100,200,0.15)',
    borderColor: 'rgba(160,100,200,0.35)',
    // Ring road band around the outside — drawn as a thick stroke, not fill
    poly: [[-1800,1800],[1800,1800],[1800,-1800],[-1800,-1800],[-1600,-1600],[-1600,1600],[1600,1600],[1600,-1600]],
    isRing: true,
  },
];

// ─── Road network (simplified vector lines) ──────────────────────────────────
// Each road: { points: [[x,z],...], width: metres, type }

const ROADS = [
  // Downtown grid
  { type:'boulevard', width:14, points:[[-600,-200],[-600,600]] },
  { type:'boulevard', width:14, points:[[600,-200],[600,600]] },
  { type:'boulevard', width:14, points:[[-600,200],[600,200]] },
  { type:'street',    width:8,  points:[[-600,0],[600,0]] },
  { type:'street',    width:8,  points:[[0,-200],[0,600]] },
  { type:'street',    width:8,  points:[[-300,-200],[-300,600]] },
  { type:'street',    width:8,  points:[[300,-200],[300,600]] },
  // Waterfront promenade
  { type:'boulevard', width:12, points:[[600,0],[1800,0]] },
  { type:'boulevard', width:12, points:[[600,-600],[1800,-600]] },
  { type:'street',    width:8,  points:[[1200,600],[1200,-600]] },
  // Industrial throughway
  { type:'boulevard', width:12, points:[[-1800,-200],[-600,-200]] },
  { type:'street',    width:8,  points:[[-1200,200],[-1200,-600]] },
  { type:'street',    width:6,  points:[[-1800,-400],[-600,-400]] },
  // Suburbs hillside
  { type:'winding',   width:6,  points:[[-1800,200],[-1400,400],[-1000,600],[-600,600]] },
  { type:'street',    width:6,  points:[[-1400,200],[-1400,600]] },
  // Racing district
  { type:'racing',    width:14, points:[[-600,-200],[-600,-1000],[600,-1000],[600,-200]] },
  { type:'racing',    width:10, points:[[-300,-600],[300,-600]] },
  // Highway ring road
  { type:'highway',   width:22, points:[
    [-1800,-1800],[1800,-1800],[1800,1800],[-1800,1800],[-1800,-1800],
  ]},
  // Cross-city boulevard
  { type:'boulevard', width:14, points:[[-1800,0],[1800,0]] },
  { type:'boulevard', width:14, points:[[0,-1800],[0,1800]] },
  // Grand Bridge
  { type:'bridge',    width:16, points:[[600,600],[1200,1200]] },
  // Highway on/off ramps
  { type:'highway',   width:14, points:[[-600,-1000],[-600,-1800]] },
  { type:'highway',   width:14, points:[[600,-1000],[600,-1800]] },
  { type:'highway',   width:14, points:[[-1800,-200],[-1800,-1800]] },
  { type:'highway',   width:14, points:[[1800,0],[1800,-1800]] },
  // Drag strip
  { type:'dragstrip', width:20, points:[[800,-100],[1600,-100]] },
];

// Road colour palette
const ROAD_COLORS = {
  highway:   '#555566',
  boulevard: '#44444e',
  street:    '#393944',
  winding:   '#393944',
  racing:    '#4a2222',
  bridge:    '#3a3a50',
  dragstrip: '#3a2222',
};

// ─── POI data ─────────────────────────────────────────────────────────────────

// Filter layer keys
const LAYER_RACES    = 'races';
const LAYER_SHOPS    = 'shops';
const LAYER_BOARDS   = 'boards';
const LAYER_LANDMARKS= 'landmarks';
const LAYER_FASTTRAV = 'fasttravel';
const LAYER_AI       = 'ai';

// Icon emoji / glyph for each category
const LAYER_ICONS = {
  [LAYER_RACES]:    '🏁',
  [LAYER_SHOPS]:    '🛒',
  [LAYER_BOARDS]:   '⭐',
  [LAYER_LANDMARKS]:'◆',
  [LAYER_FASTTRAV]: '⬡',
  [LAYER_AI]:       '●',
};

const LAYER_COLORS = {
  [LAYER_RACES]:    '#f5800a',
  [LAYER_SHOPS]:    '#4a9eff',
  [LAYER_BOARDS]:   '#f5d800',
  [LAYER_LANDMARKS]:'#ffffff',
  [LAYER_FASTTRAV]: '#b066ff',
  [LAYER_AI]:       '#ff4444',
};

const LAYER_LABELS = {
  [LAYER_RACES]:    'Race Events',
  [LAYER_SHOPS]:    'Shops',
  [LAYER_BOARDS]:   'Bonus Boards',
  [LAYER_LANDMARKS]:'Landmarks',
  [LAYER_FASTTRAV]: 'Fast Travel',
  [LAYER_AI]:       'AI Cars',
};

// Static POI list — coordinates in world XZ
const STATIC_POIS = [
  // Races
  { id:'r1',  layer: LAYER_RACES,    x:0,     z:500,   label:'City Sprint',       desc:'D–A Class · 3 Laps · Downtown streets',      action:'race' },
  { id:'r2',  layer: LAYER_RACES,    x:1200,  z:-300,  label:'Harbor Drag',       desc:'All Classes · Drag Race · 800m straight',    action:'race' },
  { id:'r3',  layer: LAYER_RACES,    x:-1200, z:-400,  label:'Industrial Run',    desc:'B–S1 Class · Sprint · Rough surface',        action:'race' },
  { id:'r4',  layer: LAYER_RACES,    x:0,     z:-600,  label:'Grand Circuit',     desc:'A–S2 Class · 5 Laps · Racing District',      action:'race' },
  { id:'r5',  layer: LAYER_RACES,    x:-1000, z:400,   label:'Hillside Blast',    desc:'C–B Class · Sprint · Winding roads',         action:'race' },
  { id:'r6',  layer: LAYER_RACES,    x:1600,  z:400,   label:'Waterfront Rush',   desc:'A–S1 Class · Circuit · Promenade',           action:'race' },
  { id:'r7',  layer: LAYER_RACES,    x:0,     z:-1600, label:'Highway Ring',      desc:'S1–S2 Class · Sprint · Ring road',           action:'race' },
  // Shops
  { id:'s1',  layer: LAYER_SHOPS,    x:200,   z:300,   label:'Autoshow',          desc:'Buy new & used cars',                        action:'shop' },
  { id:'s2',  layer: LAYER_SHOPS,    x:-1200, z:-200,  label:'Parts Shop',        desc:'Performance upgrades & tuning',              action:'shop' },
  { id:'s3',  layer: LAYER_SHOPS,    x:-200,  z:500,   label:'Livery Shop',       desc:'Paint, wraps & body kits',                   action:'shop' },
  { id:'s4',  layer: LAYER_SHOPS,    x:-800,  z:500,   label:'Clothing Boutique', desc:'Driver outfits & accessories',               action:'shop' },
  { id:'s5',  layer: LAYER_SHOPS,    x:100,   z:0,     label:'Festival Hub',      desc:'Game home base · Spin the wheel',            action:'shop' },
  { id:'s6',  layer: LAYER_SHOPS,    x:-800,  z:300,   label:'Race HQ',           desc:'Browse & enter race events',                 action:'shop' },
  // Landmarks
  { id:'l1',  layer: LAYER_LANDMARKS,x:0,     z:400,   label:'Central Tower',     desc:'Tallest building in Horizon City',           action:'mark' },
  { id:'l2',  layer: LAYER_LANDMARKS,x:900,   z:900,   label:'The Grand Bridge',  desc:'Iconic harbour crossing',                    action:'mark' },
  { id:'l3',  layer: LAYER_LANDMARKS,x:-1400, z:-400,  label:'Chimney Stack',     desc:'Industrial district landmark',               action:'mark' },
  { id:'l4',  layer: LAYER_LANDMARKS,x:-1400, z:400,   label:'Hillside Lookout',  desc:'Panoramic city viewpoint',                   action:'mark' },
  { id:'l5',  layer: LAYER_LANDMARKS,x:0,     z:-800,  label:'Grand Circuit',     desc:'Main race venue of Horizon City',            action:'mark' },
  { id:'l6',  layer: LAYER_LANDMARKS,x:0,     z:-1600, label:'Overpass Stack',    desc:'Complex highway interchange',                action:'mark' },
  // Fast Travel
  { id:'ft1', layer: LAYER_FASTTRAV, x:0,     z:300,   label:'Festival Hub',      desc:'Fast travel · Free',                         action:'travel' },
  { id:'ft2', layer: LAYER_FASTTRAV, x:1200,  z:0,     label:'Waterfront',        desc:'Fast travel · 500 CR',                      action:'travel' },
  { id:'ft3', layer: LAYER_FASTTRAV, x:-1200, z:-300,  label:'Industrial',        desc:'Fast travel · 500 CR',                      action:'travel' },
  { id:'ft4', layer: LAYER_FASTTRAV, x:-800,  z:400,   label:'Suburbs',           desc:'Fast travel · 500 CR',                      action:'travel' },
  { id:'ft5', layer: LAYER_FASTTRAV, x:0,     z:-800,  label:'Racing District',   desc:'Fast travel · 500 CR',                      action:'travel' },
  { id:'ft6', layer: LAYER_FASTTRAV, x:0,     z:-1600, label:'Highway Ring',      desc:'Fast travel · 1000 CR',                     action:'travel' },
];

// ─── FullscreenMap class ──────────────────────────────────────────────────────

export class FullscreenMap {

  /**
   * @param {object} opts
   *   container      {HTMLElement}   — parent element (default: document.body)
   *   saveManager    {object}        — for reading collected boards
   *   onFastTravel   {function}      — (poiId, worldX, worldZ) => void
   *   onSetDestination {function}    — (poiId, worldX, worldZ) => void  (for boards)
   *   onRaceSelect   {function}      — (raceId) => void
   *   creditBalance  {function}      — () => number   (live credit query)
   *   boardData      {Array}         — BOARD_DATA from poi.js (optional, for board icons)
   */
  constructor(opts = {}) {
    this._container      = opts.container ?? document.body;
    this._saveManager    = opts.saveManager    ?? null;
    this._onFastTravel   = opts.onFastTravel   ?? null;
    this._onSetDest      = opts.onSetDestination ?? null;
    this._onRaceSelect   = opts.onRaceSelect   ?? null;
    this._getCreditBal   = opts.creditBalance  ?? (() => 0);

    // ── State ──────────────────────────────────────────────────────────────
    this._visible        = false;
    this._zoomIdx        = ZOOM_DEFAULT;
    this._zoomTarget     = ZOOM_LEVELS[ZOOM_DEFAULT];
    this._zoom           = ZOOM_LEVELS[ZOOM_DEFAULT];
    // Pan offset in world metres (offset from world origin to screen centre)
    this._panX           = 0;
    this._panZ           = 0;
    this._panTargetX     = 0;
    this._panTargetZ     = 0;

    // ── Player / AI live data ──────────────────────────────────────────────
    this._playerX        = 0;
    this._playerZ        = 0;
    this._playerHeading  = 0;  // radians
    this._aiPositions    = [];  // [{x, z}]

    // ── Boards (dynamic collected state) ──────────────────────────────────
    this._boardPOIs      = [];  // built from boardData
    this._collectedBoards = new Set();
    if (opts.boardData) this._buildBoardPOIs(opts.boardData);

    // ── Filters ───────────────────────────────────────────────────────────
    this._layers = {
      [LAYER_RACES]:     true,
      [LAYER_SHOPS]:     true,
      [LAYER_BOARDS]:    true,
      [LAYER_LANDMARKS]: true,
      [LAYER_FASTTRAV]:  true,
      [LAYER_AI]:        false,
    };

    // ── Selected POI & info card ───────────────────────────────────────────
    this._selectedPOI    = null;
    this._cardVisible    = false;
    this._cardAnim       = 0;  // 0=hidden, 1=visible

    // ── Drag/pan ──────────────────────────────────────────────────────────
    this._dragging       = false;
    this._dragStartX     = 0;
    this._dragStartZ     = 0;
    this._dragStartMouseX= 0;
    this._dragStartMouseY= 0;

    // ── Touch pinch ───────────────────────────────────────────────────────
    this._pinchDist      = 0;

    // ── RAF loop ──────────────────────────────────────────────────────────
    this._rafId          = null;
    this._lastTime       = 0;

    this._buildDOM();
    this._bindEvents();
    this._injectStyles();
  }

  // ─── DOM Construction ─────────────────────────────────────────────────────

  _buildDOM() {
    // Root overlay
    this._root = document.createElement('div');
    this._root.id        = 'hc-fullmap-root';
    this._root.className = 'hc-map-hidden';
    this._root.setAttribute('role', 'dialog');
    this._root.setAttribute('aria-label', 'City Map');

    // Canvas
    this._canvas = document.createElement('canvas');
    this._canvas.id = 'hc-fullmap-canvas';
    this._ctx    = this._canvas.getContext('2d');
    this._root.appendChild(this._canvas);

    // ── Top bar ────────────────────────────────────────────────────────────
    const topBar = document.createElement('div');
    topBar.className = 'hc-map-topbar';
    topBar.innerHTML = '<span class="hc-map-title">HORIZON CITY</span>';
    this._root.appendChild(topBar);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className    = 'hc-map-close-btn';
    closeBtn.textContent  = '✕';
    closeBtn.title        = 'Close Map (M or Escape)';
    closeBtn.addEventListener('click', () => this.close());
    topBar.appendChild(closeBtn);

    // Re-centre button
    const centreBtn = document.createElement('button');
    centreBtn.className   = 'hc-map-centre-btn';
    centreBtn.textContent = '⊕ Centre';
    centreBtn.title       = 'Centre on player (C)';
    centreBtn.addEventListener('click', () => this._centrOnPlayer());
    topBar.appendChild(centreBtn);

    // ── Filter panel ───────────────────────────────────────────────────────
    const filterPanel = document.createElement('div');
    filterPanel.className = 'hc-map-filters';
    this._filterBtns = {};

    for (const [key, label] of Object.entries(LAYER_LABELS)) {
      const btn = document.createElement('button');
      btn.className   = 'hc-map-filter-btn' + (this._layers[key] ? ' active' : '');
      btn.dataset.layer = key;
      btn.title       = label;
      btn.innerHTML   = `<span class="hc-map-filter-icon" style="color:${LAYER_COLORS[key]}">${LAYER_ICONS[key]}</span> ${label}`;
      btn.addEventListener('click', () => this._toggleLayer(key));
      filterPanel.appendChild(btn);
      this._filterBtns[key] = btn;
    }

    this._root.appendChild(filterPanel);

    // ── Zoom controls ──────────────────────────────────────────────────────
    const zoomPanel = document.createElement('div');
    zoomPanel.className = 'hc-map-zoom-panel';

    const zoomIn = document.createElement('button');
    zoomIn.textContent = '+';
    zoomIn.className   = 'hc-map-zoom-btn';
    zoomIn.addEventListener('click', () => this._changeZoom(1));

    const zoomOut = document.createElement('button');
    zoomOut.textContent = '−';
    zoomOut.className   = 'hc-map-zoom-btn';
    zoomOut.addEventListener('click', () => this._changeZoom(-1));

    zoomPanel.appendChild(zoomIn);
    zoomPanel.appendChild(zoomOut);
    this._root.appendChild(zoomPanel);

    // ── Info card ──────────────────────────────────────────────────────────
    this._infoCard = document.createElement('div');
    this._infoCard.className = 'hc-map-infocard hc-map-infocard-hidden';

    this._infoTitle = document.createElement('div');
    this._infoTitle.className = 'hc-map-infocard-title';

    this._infoCategory = document.createElement('div');
    this._infoCategory.className = 'hc-map-infocard-category';

    this._infoDesc = document.createElement('div');
    this._infoDesc.className = 'hc-map-infocard-desc';

    this._infoAction = document.createElement('button');
    this._infoAction.className = 'hc-map-infocard-action';

    this._infoDismiss = document.createElement('button');
    this._infoDismiss.className = 'hc-map-infocard-dismiss';
    this._infoDismiss.textContent = '✕';
    this._infoDismiss.addEventListener('click', () => this._closeCard());

    this._infoCard.appendChild(this._infoDismiss);
    this._infoCard.appendChild(this._infoCategory);
    this._infoCard.appendChild(this._infoTitle);
    this._infoCard.appendChild(this._infoDesc);
    this._infoCard.appendChild(this._infoAction);
    this._root.appendChild(this._infoCard);

    // ── Legend ─────────────────────────────────────────────────────────────
    const legend = document.createElement('div');
    legend.className = 'hc-map-legend';
    legend.innerHTML = 'Scroll to zoom · Drag to pan · C to centre · M or Esc to close';
    this._root.appendChild(legend);

    this._container.appendChild(this._root);
  }

  // ─── Styles ───────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('hc-fullmap-styles')) return;
    const s = document.createElement('style');
    s.id = 'hc-fullmap-styles';
    s.textContent = `
      #hc-fullmap-root {
        position: fixed; inset: 0; z-index: 1200;
        background: #0a0c14;
        display: flex; align-items: stretch; justify-content: stretch;
        transition: opacity 0.22s ease;
        font-family: 'Rajdhani', sans-serif;
      }
      #hc-fullmap-root.hc-map-hidden { opacity: 0; pointer-events: none; }
      #hc-fullmap-canvas {
        position: absolute; inset: 0; width: 100%; height: 100%;
        cursor: grab;
      }
      #hc-fullmap-canvas.dragging { cursor: grabbing; }

      .hc-map-topbar {
        position: absolute; top: 0; left: 0; right: 0;
        height: 52px; display: flex; align-items: center; gap: 12px;
        padding: 0 18px;
        background: linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%);
        pointer-events: none;
        z-index: 10;
      }
      .hc-map-title {
        font-size: 22px; font-weight: 700; letter-spacing: 4px;
        color: #fff; text-shadow: 0 0 12px rgba(80,160,255,0.6);
        flex: 1;
        pointer-events: none;
      }
      .hc-map-close-btn, .hc-map-centre-btn {
        pointer-events: all;
        background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
        color: #fff; border-radius: 6px; padding: 6px 14px;
        font-size: 14px; font-family: inherit; cursor: pointer;
        transition: background 0.15s;
      }
      .hc-map-close-btn:hover, .hc-map-centre-btn:hover {
        background: rgba(255,255,255,0.22);
      }

      .hc-map-filters {
        position: absolute; top: 60px; right: 18px;
        display: flex; flex-direction: column; gap: 6px;
        z-index: 10;
      }
      .hc-map-filter-btn {
        display: flex; align-items: center; gap: 8px;
        background: rgba(10,12,20,0.82); border: 1px solid rgba(255,255,255,0.12);
        color: rgba(255,255,255,0.5); border-radius: 6px;
        padding: 6px 12px; font-size: 13px; font-family: inherit;
        cursor: pointer; transition: all 0.15s; white-space: nowrap;
        letter-spacing: 0.5px;
      }
      .hc-map-filter-btn.active {
        color: #fff; border-color: rgba(255,255,255,0.35);
        background: rgba(30,40,70,0.92);
      }
      .hc-map-filter-btn:hover { background: rgba(40,50,90,0.92); color: #fff; }
      .hc-map-filter-icon { font-size: 15px; }

      .hc-map-zoom-panel {
        position: absolute; bottom: 40px; right: 18px;
        display: flex; flex-direction: column; gap: 4px; z-index: 10;
      }
      .hc-map-zoom-btn {
        width: 36px; height: 36px;
        background: rgba(10,12,20,0.85); border: 1px solid rgba(255,255,255,0.2);
        color: #fff; font-size: 20px; border-radius: 6px; cursor: pointer;
        font-family: inherit; transition: background 0.15s; line-height: 1;
      }
      .hc-map-zoom-btn:hover { background: rgba(40,60,120,0.9); }

      .hc-map-infocard {
        position: absolute; right: 18px; top: 50%;
        transform: translateY(-50%) translateX(0);
        width: 280px;
        background: rgba(8,10,20,0.95);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 12px; padding: 20px 20px 16px;
        z-index: 20;
        transition: transform 0.28s cubic-bezier(0.22,1,0.36,1), opacity 0.22s;
        box-shadow: 0 8px 40px rgba(0,0,0,0.6);
      }
      .hc-map-infocard.hc-map-infocard-hidden {
        transform: translateY(-50%) translateX(320px);
        opacity: 0; pointer-events: none;
      }
      .hc-map-infocard-dismiss {
        position: absolute; top: 10px; right: 12px;
        background: none; border: none; color: rgba(255,255,255,0.4);
        font-size: 16px; cursor: pointer; padding: 2px 6px;
      }
      .hc-map-infocard-dismiss:hover { color: #fff; }
      .hc-map-infocard-category {
        font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
        color: rgba(255,255,255,0.45); margin-bottom: 4px;
      }
      .hc-map-infocard-title {
        font-size: 20px; font-weight: 700; color: #fff;
        margin-bottom: 8px; letter-spacing: 1px;
      }
      .hc-map-infocard-desc {
        font-size: 13px; color: rgba(255,255,255,0.6);
        line-height: 1.5; margin-bottom: 16px;
      }
      .hc-map-infocard-action {
        width: 100%; padding: 10px;
        background: linear-gradient(135deg, #1a6bcc, #0d4a9a);
        border: none; border-radius: 8px;
        color: #fff; font-size: 14px; font-weight: 700;
        font-family: inherit; letter-spacing: 1px;
        cursor: pointer; transition: filter 0.15s;
      }
      .hc-map-infocard-action:hover { filter: brightness(1.2); }
      .hc-map-infocard-action.action-travel {
        background: linear-gradient(135deg, #7a22cc, #5010a0);
      }
      .hc-map-infocard-action.action-mark {
        background: linear-gradient(135deg, #888, #555);
      }
      .hc-map-infocard-action.action-race {
        background: linear-gradient(135deg, #cc5500, #9a3300);
      }

      .hc-map-legend {
        position: absolute; bottom: 12px; left: 50%;
        transform: translateX(-50%);
        font-size: 12px; color: rgba(255,255,255,0.3);
        letter-spacing: 1px; pointer-events: none; z-index: 10;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(s);
  }

  // ─── Event Binding ────────────────────────────────────────────────────────

  _bindEvents() {
    // Keyboard
    this._onKeyDown = (e) => this._handleKey(e);
    document.addEventListener('keydown', this._onKeyDown);

    // Mouse wheel zoom
    this._canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._changeZoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // Mouse drag
    this._canvas.addEventListener('mousedown', (e) => this._dragStart(e));
    window.addEventListener('mousemove', (e) => this._dragMove(e));
    window.addEventListener('mouseup',   ()  => this._dragEnd());

    // Click to select POI
    this._canvas.addEventListener('click', (e) => this._handleClick(e));

    // Touch pinch + drag
    this._canvas.addEventListener('touchstart',  (e) => this._touchStart(e),  { passive: false });
    this._canvas.addEventListener('touchmove',   (e) => this._touchMove(e),   { passive: false });
    this._canvas.addEventListener('touchend',    (e) => this._touchEnd(e));

    // Resize
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
  }

  // ─── Open / Close ─────────────────────────────────────────────────────────

  open() {
    if (this._visible) return;
    this._visible = true;
    this._resize();
    this._root.classList.remove('hc-map-hidden');
    this._centrOnPlayer(false); // instant
    this._startLoop();
  }

  close() {
    if (!this._visible) return;
    this._visible = false;
    this._root.classList.add('hc-map-hidden');
    this._stopLoop();
    this._closeCard();
  }

  toggle() {
    this._visible ? this.close() : this.open();
  }

  // ─── Player / AI updates ─────────────────────────────────────────────────

  /** Call each frame from driving.js / main.js */
  setPlayerPos(worldX, worldZ, headingRad) {
    this._playerX       = worldX;
    this._playerZ       = worldZ;
    this._playerHeading = headingRad;
  }

  /** Pass array of {x, z} for AI opponents (race mode). */
  setAIPositions(positions) {
    this._aiPositions = positions ?? [];
  }

  /** Called by poi.js when a board is driven through. */
  markBoardCollected(boardId) {
    this._collectedBoards.add(boardId);
  }

  // ─── Rendering Loop ───────────────────────────────────────────────────────

  _startLoop() {
    this._lastTime = performance.now();
    const tick = (now) => {
      if (!this._visible) return;
      const dt = Math.min((now - this._lastTime) / 1000, 0.1);
      this._lastTime = now;
      this._step(dt);
      this._draw();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _step(dt) {
    // Smooth zoom
    this._zoom += (this._zoomTarget - this._zoom) * Math.min(10 * dt, 1);
    // Smooth pan
    this._panX += (this._panTargetX - this._panX) * Math.min(10 * dt, 1);
    this._panZ += (this._panTargetZ - this._panZ) * Math.min(10 * dt, 1);
  }

  // ─── Drawing ──────────────────────────────────────────────────────────────

  _draw() {
    const ctx = this._ctx;
    const W   = this._canvas.width;
    const H   = this._canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0e1020';
    ctx.fillRect(0, 0, W, H);

    // World → canvas transform
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(this._zoom, this._zoom);
    ctx.translate(-this._panX, -this._panZ);

    this._drawDistricts(ctx);
    this._drawRoads(ctx);
    this._drawPOIs(ctx);
    this._drawAI(ctx);
    this._drawPlayer(ctx);

    ctx.restore();
  }

  _drawDistricts(ctx) {
    for (const d of DISTRICTS) {
      if (d.isRing) {
        // Draw as thick stroke on ring road instead of fill
        ctx.beginPath();
        ctx.moveTo(d.poly[0][0], d.poly[0][1]);
        for (let i = 1; i < d.poly.length; i++) ctx.lineTo(d.poly[i][0], d.poly[i][1]);
        ctx.closePath();
        ctx.strokeStyle = d.borderColor;
        ctx.lineWidth   = 80 / this._zoom;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(d.poly[0][0], d.poly[0][1]);
        for (let i = 1; i < d.poly.length; i++) ctx.lineTo(d.poly[i][0], d.poly[i][1]);
        ctx.closePath();
        ctx.fillStyle   = d.color;
        ctx.fill();
        ctx.strokeStyle = d.borderColor;
        ctx.lineWidth   = 2 / this._zoom;
        ctx.stroke();
      }

      // District label (only at lower zoom levels)
      if (this._zoom < 0.5 && !d.isRing) {
        const cx = d.poly.reduce((s, p) => s + p[0], 0) / d.poly.length;
        const cz = d.poly.reduce((s, p) => s + p[1], 0) / d.poly.length;
        ctx.save();
        ctx.font         = `bold ${Math.round(22 / this._zoom)}px Rajdhani, sans-serif`;
        ctx.fillStyle    = 'rgba(255,255,255,0.25)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.label.toUpperCase(), cx, cz);
        ctx.restore();
      }
    }
  }

  _drawRoads(ctx) {
    for (const road of ROADS) {
      if (road.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(road.points[0][0], road.points[0][1]);
      for (let i = 1; i < road.points.length; i++) {
        ctx.lineTo(road.points[i][0], road.points[i][1]);
      }
      ctx.strokeStyle = ROAD_COLORS[road.type] ?? '#333';
      ctx.lineWidth   = road.width;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.stroke();

      // Road centre line (dashed, higher zoom only)
      if (this._zoom > 0.35 && road.type !== 'highway') {
        ctx.beginPath();
        ctx.moveTo(road.points[0][0], road.points[0][1]);
        for (let i = 1; i < road.points.length; i++) {
          ctx.lineTo(road.points[i][0], road.points[i][1]);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([30, 30]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  _drawPOIs(ctx) {
    const allPOIs = [...STATIC_POIS, ...this._boardPOIs];

    for (const poi of allPOIs) {
      if (!this._layers[poi.layer]) continue;

      // Hide collected boards (if filter shows uncollected only)
      if (poi.layer === LAYER_BOARDS && this._collectedBoards.has(poi.id)) {
        ctx.globalAlpha = 0.25; // dim, don't hide
      } else {
        ctx.globalAlpha = 1;
      }

      const isSelected = this._selectedPOI?.id === poi.id;
      const color      = LAYER_COLORS[poi.layer];
      const icon       = LAYER_ICONS[poi.layer];
      const iconSize   = Math.max(10, Math.round(16 / this._zoom));
      const bgRadius   = Math.max(8, Math.round(12 / this._zoom));

      // Draw background circle
      ctx.beginPath();
      ctx.arc(poi.x, poi.z, bgRadius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#ffffff' : 'rgba(10,12,22,0.88)';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#ffffff' : color;
      ctx.lineWidth   = isSelected ? 2.5 / this._zoom : 1.5 / this._zoom;
      ctx.stroke();

      // Draw icon text
      ctx.font         = `${iconSize}px sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = isSelected ? '#111' : color;
      ctx.fillText(icon, poi.x, poi.z);

      // Label at higher zoom
      if (this._zoom > 0.35) {
        ctx.font      = `bold ${Math.round(10 / this._zoom)}px Rajdhani, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(poi.label, poi.x, poi.z + bgRadius + 8 / this._zoom);
      }

      // Selected pulse ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(poi.x, poi.z, bgRadius + 5 / this._zoom, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth   = 1 / this._zoom;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawAI(ctx) {
    if (!this._layers[LAYER_AI]) return;
    for (const ai of this._aiPositions) {
      ctx.beginPath();
      ctx.arc(ai.x, ai.z, 8 / this._zoom, 0, Math.PI * 2);
      ctx.fillStyle = LAYER_COLORS[LAYER_AI];
      ctx.fill();
    }
  }

  _drawPlayer(ctx) {
    const x = this._playerX;
    const z = this._playerZ;
    const h = this._playerHeading;
    const s = Math.max(12, 18 / this._zoom);

    ctx.save();
    ctx.translate(x, z);
    ctx.rotate(h);

    // Arrow shape
    ctx.beginPath();
    ctx.moveTo(0, -s);        // nose
    ctx.lineTo(s * 0.6, s * 0.7);
    ctx.lineTo(0, s * 0.35);
    ctx.lineTo(-s * 0.6, s * 0.7);
    ctx.closePath();

    // Drop shadow
    ctx.shadowColor  = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur   = 6 / this._zoom;
    ctx.fillStyle    = '#ffffff';
    ctx.fill();
    ctx.strokeStyle  = '#4a9eff';
    ctx.lineWidth    = 2 / this._zoom;
    ctx.stroke();
    ctx.shadowBlur   = 0;

    ctx.restore();
  }

  // ─── Coordinate Conversion ────────────────────────────────────────────────

  /** Screen pixel → world coords */
  _screenToWorld(sx, sy) {
    const W  = this._canvas.width;
    const H  = this._canvas.height;
    const wx = (sx - W / 2) / this._zoom + this._panX;
    const wz = (sy - H / 2) / this._zoom + this._panZ;
    return { x: wx, z: wz };
  }

  /** World coords → screen pixels */
  _worldToScreen(wx, wz) {
    const W  = this._canvas.width;
    const H  = this._canvas.height;
    const sx = (wx - this._panX) * this._zoom + W / 2;
    const sy = (wz - this._panZ) * this._zoom + H / 2;
    return { x: sx, y: sy };
  }

  // ─── Interaction ──────────────────────────────────────────────────────────

  _handleClick(e) {
    if (this._dragged) return; // was a drag, not a click

    const rect = this._canvas.getBoundingClientRect();
    const sx   = (e.clientX - rect.left) * (this._canvas.width / rect.width);
    const sy   = (e.clientY - rect.top)  * (this._canvas.height / rect.height);
    const world = this._screenToWorld(sx, sy);

    // Find nearest POI within hit radius
    const allPOIs = [...STATIC_POIS, ...this._boardPOIs];
    const hitRadius = 20 / this._zoom;
    let nearest = null;
    let nearestDist = Infinity;

    for (const poi of allPOIs) {
      if (!this._layers[poi.layer]) continue;
      const dx = poi.x - world.x;
      const dz = poi.z - world.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d < hitRadius && d < nearestDist) {
        nearest     = poi;
        nearestDist = d;
      }
    }

    if (nearest) {
      this._selectPOI(nearest);
    } else {
      this._closeCard();
    }
  }

  _selectPOI(poi) {
    this._selectedPOI = poi;
    this._showCard(poi);
    // Animate pan to POI
    this._panTargetX = poi.x;
    this._panTargetZ = poi.z;
  }

  _showCard(poi) {
    const color = LAYER_COLORS[poi.layer];
    this._infoCategory.textContent = LAYER_LABELS[poi.layer].toUpperCase();
    this._infoCategory.style.color = color;
    this._infoTitle.textContent    = poi.label;
    this._infoDesc.textContent     = poi.desc;

    // Configure action button
    const btn = this._infoAction;
    btn.className = `hc-map-infocard-action action-${poi.action}`;

    switch (poi.action) {
      case 'race':
        btn.textContent = '🏁  Go to Race';
        btn.onclick     = () => this._doRace(poi);
        break;
      case 'shop':
        btn.textContent = '⬡  Fast Travel to Shop';
        btn.onclick     = () => this._doTravel(poi);
        break;
      case 'travel':
        btn.textContent = '⬡  Fast Travel Here';
        btn.onclick     = () => this._doTravel(poi);
        break;
      case 'mark':
        btn.textContent = '📍  Set as Destination';
        btn.onclick     = () => this._doMark(poi);
        break;
      default:
        btn.textContent = 'Close';
        btn.onclick     = () => this._closeCard();
    }

    this._infoCard.classList.remove('hc-map-infocard-hidden');
  }

  _closeCard() {
    this._selectedPOI = null;
    this._infoCard.classList.add('hc-map-infocard-hidden');
  }

  _doRace(poi) {
    this._onRaceSelect?.(poi.id);
    this.close();
  }

  _doTravel(poi) {
    this._onFastTravel?.(poi.id, poi.x, poi.z);
    this.close();
  }

  _doMark(poi) {
    this._onSetDest?.(poi.id, poi.x, poi.z);
    this.close();
  }

  // ─── Zoom & Pan ───────────────────────────────────────────────────────────

  _changeZoom(dir) {
    this._zoomIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, this._zoomIdx + dir));
    this._zoomTarget = ZOOM_LEVELS[this._zoomIdx];
  }

  _centrOnPlayer(animate = true) {
    this._panTargetX = this._playerX;
    this._panTargetZ = this._playerZ;
    if (!animate) {
      this._panX = this._playerX;
      this._panZ = this._playerZ;
    }
  }

  // ── Mouse drag ────────────────────────────────────────────────────────────

  _dragStart(e) {
    if (e.button !== 0) return;
    this._dragging       = true;
    this._dragged        = false;
    this._dragStartMouseX= e.clientX;
    this._dragStartMouseY= e.clientY;
    this._dragStartPanX  = this._panTargetX;
    this._dragStartPanZ  = this._panTargetZ;
    this._canvas.classList.add('dragging');
  }

  _dragMove(e) {
    if (!this._dragging) return;
    const dx = e.clientX - this._dragStartMouseX;
    const dy = e.clientY - this._dragStartMouseY;
    if (Math.abs(dx) + Math.abs(dy) > 4) this._dragged = true;
    const scale = this._canvas.width / this._canvas.getBoundingClientRect().width;
    this._panTargetX = this._dragStartPanX - (dx * scale) / this._zoom;
    this._panTargetZ = this._dragStartPanZ - (dy * scale) / this._zoom;
  }

  _dragEnd() {
    this._dragging = false;
    this._canvas.classList.remove('dragging');
  }

  // ── Touch ─────────────────────────────────────────────────────────────────

  _touchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      this._dragStart({ button: 0, clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    } else if (e.touches.length === 2) {
      this._pinchDist = this._getTouchDist(e);
    }
  }

  _touchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      this._dragMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
    } else if (e.touches.length === 2) {
      const dist = this._getTouchDist(e);
      if (this._pinchDist > 0) {
        const ratio = dist / this._pinchDist;
        const newZoom = Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], this._zoomTarget * ratio));
        this._zoomTarget = newZoom;
        // Snap zoom index to nearest
        let best = 0;
        for (let i = 1; i < ZOOM_LEVELS.length; i++) {
          if (Math.abs(ZOOM_LEVELS[i] - newZoom) < Math.abs(ZOOM_LEVELS[best] - newZoom)) best = i;
        }
        this._zoomIdx = best;
      }
      this._pinchDist = dist;
    }
  }

  _touchEnd(e) {
    if (e.touches.length === 0) this._dragEnd();
    this._pinchDist = 0;
  }

  _getTouchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  _handleKey(e) {
    if (!this._visible) return;
    switch (e.key) {
      case 'Escape':
      case 'm': case 'M':
        e.preventDefault();
        this.close();
        break;
      case 'c': case 'C':
        e.preventDefault();
        this._centrOnPlayer();
        break;
      case '+': case '=':
        this._changeZoom(1);
        break;
      case '-':
        this._changeZoom(-1);
        break;
    }
  }

  // ─── Filter toggle ────────────────────────────────────────────────────────

  _toggleLayer(key) {
    this._layers[key] = !this._layers[key];
    this._filterBtns[key].classList.toggle('active', this._layers[key]);
  }

  // ─── Board POIs ───────────────────────────────────────────────────────────

  _buildBoardPOIs(boardData) {
    this._boardPOIs = boardData.map(b => ({
      id:     `board_${b.id}`,
      layer:  LAYER_BOARDS,
      x:      b.position?.x ?? 0,
      z:      b.position?.z ?? 0,
      label:  b.type === 'xp' ? 'XP Board' : 'Credit Board',
      desc:   b.type === 'xp' ? `+${b.xpReward ?? 500} XP` : `+${b.crReward ?? 1500} CR`,
      action: 'mark',
    }));
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  _resize() {
    const dpr = window.devicePixelRatio ?? 1;
    const W   = this._root.clientWidth;
    const H   = this._root.clientHeight;
    this._canvas.width  = W * dpr;
    this._canvas.height = H * dpr;
    this._canvas.style.width  = W + 'px';
    this._canvas.style.height = H + 'px';
    this._ctx.scale(dpr, dpr);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Remove DOM nodes and event listeners. Call when shutting down the game. */
  dispose() {
    this._stopLoop();
    document.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('mousemove', this._dragMove);
    window.removeEventListener('mouseup', this._dragEnd);
    this._root.remove();
  }

  /** Programmatically set a filter state. */
  setLayer(key, on) {
    this._layers[key] = on;
    if (this._filterBtns[key]) {
      this._filterBtns[key].classList.toggle('active', on);
    }
  }

  /** Returns whether the map is currently open. */
  get isOpen() { return this._visible; }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * @param {object} opts — see FullscreenMap constructor
 * @returns {FullscreenMap}
 */
export function createFullscreenMap(opts = {}) {
  return new FullscreenMap(opts);
}

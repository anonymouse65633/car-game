/**
 * poi.js — Points of Interest
 * Part 1 / World layer
 *
 * Responsibilities:
 *  - BOARD_DATA:    all 80 bonus boards (50 Credit + 30 XP) with world positions
 *  - SPEED_TRAPS:  10 speed zones with bronze/silver/gold speed thresholds
 *  - LANDMARK_DATA: 12 named landmarks (discovery unlocks map icon + XP)
 *  - BARN_FINDS:   5 hidden garages with rare car payloads
 *  - Glow mesh for each uncollected board (pulsing emissive quad)
 *  - Rapier sensor bodies for collection trigger zones
 *  - Per-frame collection check: playerPos/speed → fires reward callbacks
 *  - Persistent collected state synced to SaveManager
 *  - map.js icon layer — exposes live state for minimap & full-screen map
 *
 * Exports:
 *  initPOI(scene, world, saveManager) — sets up all POI meshes + sensors
 *  tickPOI(dt, playerPos, speedKph)   — collection checks, glow animation
 *  onCollect(fn)                      — subscribe to collect events
 *  getPOIState()                      — snapshot for map.js icon layer
 *  BOARD_DATA                         — all board definitions
 *  SPEED_TRAPS                        — all speed trap definitions
 *  LANDMARK_DATA                      — all landmark definitions
 *  BARN_FINDS                         — all barn find definitions
 */

import * as THREE                 from 'three';
import { GROUPS }                 from '../engine/renderer.js';
import { createBody }             from '../engine/physics.js';
import { getDistrictAt }          from './city.js';
import { saveManager as _defaultSave } from '../save/SaveManager.js';

// ─── Board Data ───────────────────────────────────────────────────────────────

/**
 * 50 Credit Boards + 30 XP Boards = 80 total.
 * Positions spread across all 6 districts.
 * creditReward / xpReward are 0 for the opposite type.
 */
export const BOARD_DATA = Object.freeze([
  // ── Downtown Credit Boards (12) ───────────────────────────────────────────
  { id: 'cb_dt_01', type: 'credit', position: new THREE.Vector3(  50,  1,  -80), creditReward: 2000,  xpReward: 300 },
  { id: 'cb_dt_02', type: 'credit', position: new THREE.Vector3(-120,  1, -220), creditReward: 2500,  xpReward: 300 },
  { id: 'cb_dt_03', type: 'credit', position: new THREE.Vector3( 200,  1,  -50), creditReward: 3000,  xpReward: 300 },
  { id: 'cb_dt_04', type: 'credit', position: new THREE.Vector3(-200,  1, -100), creditReward: 2000,  xpReward: 300 },
  { id: 'cb_dt_05', type: 'credit', position: new THREE.Vector3(  80,  1,  300), creditReward: 2500,  xpReward: 300 },
  { id: 'cb_dt_06', type: 'credit', position: new THREE.Vector3(-300,  1,  150), creditReward: 2000,  xpReward: 300 },
  { id: 'cb_dt_07', type: 'credit', position: new THREE.Vector3( 400,  1, -300), creditReward: 3500,  xpReward: 300 },
  { id: 'cb_dt_08', type: 'credit', position: new THREE.Vector3(-450,  1,  400), creditReward: 2000,  xpReward: 300 },
  { id: 'cb_dt_09', type: 'credit', position: new THREE.Vector3( 300,  1,  480), creditReward: 2500,  xpReward: 300 },
  { id: 'cb_dt_10', type: 'credit', position: new THREE.Vector3(-100,  1,  450), creditReward: 2000,  xpReward: 300 },
  { id: 'cb_dt_11', type: 'credit', position: new THREE.Vector3( 470,  1,  200), creditReward: 3000,  xpReward: 300 },
  { id: 'cb_dt_12', type: 'credit', position: new THREE.Vector3(-480,  1, -400), creditReward: 2500,  xpReward: 300 },

  // ── Waterfront Credit Boards (8) ──────────────────────────────────────────
  { id: 'cb_wf_01', type: 'credit', position: new THREE.Vector3( 700,  1, -200), creditReward: 3000,  xpReward: 350 },
  { id: 'cb_wf_02', type: 'credit', position: new THREE.Vector3( 900,  1,  100), creditReward: 2500,  xpReward: 350 },
  { id: 'cb_wf_03', type: 'credit', position: new THREE.Vector3(1100,  1, -400), creditReward: 4000,  xpReward: 350 },
  { id: 'cb_wf_04', type: 'credit', position: new THREE.Vector3(1400,  1,  300), creditReward: 3000,  xpReward: 350 },
  { id: 'cb_wf_05', type: 'credit', position: new THREE.Vector3(1800,  1, -300), creditReward: 5000,  xpReward: 350 },
  { id: 'cb_wf_06', type: 'credit', position: new THREE.Vector3( 800,  1,  400), creditReward: 2500,  xpReward: 350 },
  { id: 'cb_wf_07', type: 'credit', position: new THREE.Vector3(1600,  1,  200), creditReward: 3500,  xpReward: 350 },
  { id: 'cb_wf_08', type: 'credit', position: new THREE.Vector3(1200,  2,  -20), creditReward: 6000,  xpReward: 350 }, // On the bridge

  // ── Industrial Credit Boards (8) ─────────────────────────────────────────
  { id: 'cb_in_01', type: 'credit', position: new THREE.Vector3(-800,  1,  100), creditReward: 2500,  xpReward: 400 },
  { id: 'cb_in_02', type: 'credit', position: new THREE.Vector3(-1100, 1,  400), creditReward: 3000,  xpReward: 400 },
  { id: 'cb_in_03', type: 'credit', position: new THREE.Vector3(-1400, 1, -200), creditReward: 3500,  xpReward: 400 },
  { id: 'cb_in_04', type: 'credit', position: new THREE.Vector3(-600,  1,  800), creditReward: 2000,  xpReward: 400 },
  { id: 'cb_in_05', type: 'credit', position: new THREE.Vector3(-1800, 1,  600), creditReward: 5000,  xpReward: 400 },
  { id: 'cb_in_06', type: 'credit', position: new THREE.Vector3(-1200, 1,  900), creditReward: 3000,  xpReward: 400 },
  { id: 'cb_in_07', type: 'credit', position: new THREE.Vector3(-900,  1, -300), creditReward: 2500,  xpReward: 400 },
  { id: 'cb_in_08', type: 'credit', position: new THREE.Vector3(-1600, 1,  200), creditReward: 4000,  xpReward: 400 },

  // ── Suburbs Credit Boards (6) ─────────────────────────────────────────────
  { id: 'cb_sb_01', type: 'credit', position: new THREE.Vector3( 200,  1,  900), creditReward: 2000,  xpReward: 300 },
  { id: 'cb_sb_02', type: 'credit', position: new THREE.Vector3( 500, 30, 1400), creditReward: 4000,  xpReward: 300 }, // Hillside
  { id: 'cb_sb_03', type: 'credit', position: new THREE.Vector3( 800,  1,  700), creditReward: 2500,  xpReward: 300 },
  { id: 'cb_sb_04', type: 'credit', position: new THREE.Vector3( 700, 60, 1700), creditReward: 6000,  xpReward: 300 }, // Lookout
  { id: 'cb_sb_05', type: 'credit', position: new THREE.Vector3( 300,  1, 1900), creditReward: 3000,  xpReward: 300 },
  { id: 'cb_sb_06', type: 'credit', position: new THREE.Vector3( 900,  1, 1800), creditReward: 2500,  xpReward: 300 },

  // ── Racing District Credit Boards (8) ────────────────────────────────────
  { id: 'cb_rd_01', type: 'credit', position: new THREE.Vector3( 700,  1, 700),  creditReward: 3000,  xpReward: 500 },
  { id: 'cb_rd_02', type: 'credit', position: new THREE.Vector3(1000,  1, 600),  creditReward: 3500,  xpReward: 500 },
  { id: 'cb_rd_03', type: 'credit', position: new THREE.Vector3(1500,  1, 800),  creditReward: 4000,  xpReward: 500 },
  { id: 'cb_rd_04', type: 'credit', position: new THREE.Vector3(1800,  1, 1200), creditReward: 5000,  xpReward: 500 },
  { id: 'cb_rd_05', type: 'credit', position: new THREE.Vector3(1200,  1, 1800), creditReward: 4000,  xpReward: 500 },
  { id: 'cb_rd_06', type: 'credit', position: new THREE.Vector3( 900,  1, 1500), creditReward: 3000,  xpReward: 500 },
  { id: 'cb_rd_07', type: 'credit', position: new THREE.Vector3(1600,  1, 600),  creditReward: 3500,  xpReward: 500 },
  { id: 'cb_rd_08', type: 'credit', position: new THREE.Vector3( 600,  1, 1800), creditReward: 3000,  xpReward: 500 },

  // ── Outskirts Credit Boards (8) ───────────────────────────────────────────
  { id: 'cb_ok_01', type: 'credit', position: new THREE.Vector3(-1000, 1, -1200), creditReward: 4000,  xpReward: 400 },
  { id: 'cb_ok_02', type: 'credit', position: new THREE.Vector3(    0, 1, -1500), creditReward: 5000,  xpReward: 400 },
  { id: 'cb_ok_03', type: 'credit', position: new THREE.Vector3( 1000, 1, -1300), creditReward: 4000,  xpReward: 400 },
  { id: 'cb_ok_04', type: 'credit', position: new THREE.Vector3(-1800, 1, -1600), creditReward: 6000,  xpReward: 400 },
  { id: 'cb_ok_05', type: 'credit', position: new THREE.Vector3( 1800, 1, -1700), creditReward: 7000,  xpReward: 400 },
  { id: 'cb_ok_06', type: 'credit', position: new THREE.Vector3(-500,  1, -1800), creditReward: 5000,  xpReward: 400 },
  { id: 'cb_ok_07', type: 'credit', position: new THREE.Vector3( 1500, 1, -1500), creditReward: 4500,  xpReward: 400 },
  { id: 'cb_ok_08', type: 'credit', position: new THREE.Vector3(-1500, 1, -1400), creditReward: 5000,  xpReward: 400 },

  // ── XP Boards — Downtown (8) ──────────────────────────────────────────────
  { id: 'xb_dt_01', type: 'xp', position: new THREE.Vector3( 150,  1, -300), creditReward: 0, xpReward: 500 },
  { id: 'xb_dt_02', type: 'xp', position: new THREE.Vector3(-350,  1,  300), creditReward: 0, xpReward: 400 },
  { id: 'xb_dt_03', type: 'xp', position: new THREE.Vector3( 450,  1, -450), creditReward: 0, xpReward: 500 },
  { id: 'xb_dt_04', type: 'xp', position: new THREE.Vector3(-200,  1,  400), creditReward: 0, xpReward: 400 },
  { id: 'xb_dt_05', type: 'xp', position: new THREE.Vector3( 350,  1,  350), creditReward: 0, xpReward: 450 },
  { id: 'xb_dt_06', type: 'xp', position: new THREE.Vector3(-400,  1, -350), creditReward: 0, xpReward: 400 },
  { id: 'xb_dt_07', type: 'xp', position: new THREE.Vector3( 100,  1,  480), creditReward: 0, xpReward: 500 },
  { id: 'xb_dt_08', type: 'xp', position: new THREE.Vector3(-480,  1,  100), creditReward: 0, xpReward: 400 },

  // ── XP Boards — Waterfront (5) ────────────────────────────────────────────
  { id: 'xb_wf_01', type: 'xp', position: new THREE.Vector3( 850,  1, -500), creditReward: 0, xpReward: 500 },
  { id: 'xb_wf_02', type: 'xp', position: new THREE.Vector3(1300,  2,   80), creditReward: 0, xpReward: 500 }, // Bridge
  { id: 'xb_wf_03', type: 'xp', position: new THREE.Vector3(1700,  1,  400), creditReward: 0, xpReward: 400 },
  { id: 'xb_wf_04', type: 'xp', position: new THREE.Vector3( 600,  1,  300), creditReward: 0, xpReward: 400 },
  { id: 'xb_wf_05', type: 'xp', position: new THREE.Vector3(1900,  1, -100), creditReward: 0, xpReward: 500 },

  // ── XP Boards — Industrial (5) ────────────────────────────────────────────
  { id: 'xb_in_01', type: 'xp', position: new THREE.Vector3(-750,  1,  500), creditReward: 0, xpReward: 450 },
  { id: 'xb_in_02', type: 'xp', position: new THREE.Vector3(-1300, 1, -100), creditReward: 0, xpReward: 500 },
  { id: 'xb_in_03', type: 'xp', position: new THREE.Vector3(-1700, 1,  800), creditReward: 0, xpReward: 500 },
  { id: 'xb_in_04', type: 'xp', position: new THREE.Vector3(-1000, 1,  700), creditReward: 0, xpReward: 400 },
  { id: 'xb_in_05', type: 'xp', position: new THREE.Vector3(-1900, 1,  300), creditReward: 0, xpReward: 500 },

  // ── XP Boards — Racing District (5) ──────────────────────────────────────
  { id: 'xb_rd_01', type: 'xp', position: new THREE.Vector3( 800,  1,  900),  creditReward: 0, xpReward: 500 },
  { id: 'xb_rd_02', type: 'xp', position: new THREE.Vector3(1400,  1, 1400),  creditReward: 0, xpReward: 500 },
  { id: 'xb_rd_03', type: 'xp', position: new THREE.Vector3(1900,  1,  700),  creditReward: 0, xpReward: 500 },
  { id: 'xb_rd_04', type: 'xp', position: new THREE.Vector3( 650,  1, 1700),  creditReward: 0, xpReward: 450 },
  { id: 'xb_rd_05', type: 'xp', position: new THREE.Vector3(1700,  1, 1900),  creditReward: 0, xpReward: 500 },

  // ── XP Boards — Outskirts (7) ─────────────────────────────────────────────
  { id: 'xb_ok_01', type: 'xp', position: new THREE.Vector3(-1400, 1, -1800), creditReward: 0, xpReward: 500 },
  { id: 'xb_ok_02', type: 'xp', position: new THREE.Vector3( 500,  1, -1600), creditReward: 0, xpReward: 500 },
  { id: 'xb_ok_03', type: 'xp', position: new THREE.Vector3( 1600, 1, -1900), creditReward: 0, xpReward: 500 },
  { id: 'xb_ok_04', type: 'xp', position: new THREE.Vector3(-600,  1, -1300), creditReward: 0, xpReward: 450 },
  { id: 'xb_ok_05', type: 'xp', position: new THREE.Vector3( 1100, 1, -1800), creditReward: 0, xpReward: 500 },
  { id: 'xb_ok_06', type: 'xp', position: new THREE.Vector3(-1900, 1, -1200), creditReward: 0, xpReward: 500 },
  { id: 'xb_ok_07', type: 'xp', position: new THREE.Vector3(  200, 1, -1900), creditReward: 0, xpReward: 450 },
]);

// ─── Speed Traps ──────────────────────────────────────────────────────────────

export const SPEED_TRAPS = Object.freeze([
  { id: 'st_01', label: 'Harbor Straight',    position: new THREE.Vector3(1000, 1, -250), normal: new THREE.Vector3(1,0,0), bronze: 160, silver: 200, gold: 240, xpReward: 600 },
  { id: 'st_02', label: 'Highway East',       position: new THREE.Vector3(1700, 1,-1500), normal: new THREE.Vector3(1,0,0), bronze: 200, silver: 260, gold: 320, xpReward: 600 },
  { id: 'st_03', label: 'Highway West',       position: new THREE.Vector3(-1700,1,-1500), normal: new THREE.Vector3(1,0,0), bronze: 200, silver: 260, gold: 320, xpReward: 600 },
  { id: 'st_04', label: 'Downtown Boulevard', position: new THREE.Vector3(   0, 1, -300), normal: new THREE.Vector3(0,0,1), bronze: 120, silver: 160, gold: 200, xpReward: 600 },
  { id: 'st_05', label: 'Industrial Run',     position: new THREE.Vector3(-1200,1,  500), normal: new THREE.Vector3(1,0,0), bronze: 140, silver: 180, gold: 220, xpReward: 600 },
  { id: 'st_06', label: 'Drag Strip',         position: new THREE.Vector3( 900, 1,  200), normal: new THREE.Vector3(0,0,1), bronze: 180, silver: 240, gold: 300, xpReward: 600 },
  { id: 'st_07', label: 'Circuit Back Straight',position:new THREE.Vector3(1600,1, 1200), normal: new THREE.Vector3(1,0,0), bronze: 180, silver: 230, gold: 280, xpReward: 600 },
  { id: 'st_08', label: 'Hillside Descent',   position: new THREE.Vector3( 500,50, 1200), normal: new THREE.Vector3(0,0,1), bronze: 100, silver: 130, gold: 160, xpReward: 600 },
  { id: 'st_09', label: 'Waterfront Promenade',position:new THREE.Vector3(1500,1,   50), normal: new THREE.Vector3(0,0,1), bronze: 150, silver: 200, gold: 250, xpReward: 600 },
  { id: 'st_10', label: 'Outskirts Ring',     position: new THREE.Vector3(   0, 1,-1700), normal: new THREE.Vector3(1,0,0), bronze: 210, silver: 270, gold: 330, xpReward: 600 },
]);

// ─── Landmark Data ────────────────────────────────────────────────────────────

export const LANDMARK_DATA = Object.freeze([
  { id: 'lm_central_tower',    label: 'Central Tower',         position: new THREE.Vector3(   0,  0, -200), district: 'downtown',   xpReward: 400 },
  { id: 'lm_grand_bridge',     label: 'The Grand Bridge',      position: new THREE.Vector3(1200,  8, -300), district: 'waterfront', xpReward: 400 },
  { id: 'lm_chimney_stack',    label: 'The Chimney Stack',     position: new THREE.Vector3(-1400, 0,  300), district: 'industrial', xpReward: 400 },
  { id: 'lm_hillside_lookout', label: 'Hillside Lookout',      position: new THREE.Vector3( 600,120, 1600), district: 'suburbs',    xpReward: 400 },
  { id: 'lm_grand_circuit',    label: 'The Grand Circuit',     position: new THREE.Vector3(1300,  0, 1200), district: 'racing',     xpReward: 400 },
  { id: 'lm_overpass_stack',   label: 'The Overpass Stack',    position: new THREE.Vector3(-800, 20,-1600), district: 'outskirts',  xpReward: 400 },
  { id: 'lm_drag_strip',       label: 'Harbor Drag Strip',     position: new THREE.Vector3( 900,  0,  200), district: 'waterfront', xpReward: 400 },
  { id: 'lm_drift_arena',      label: 'Industrial Drift Arena',position: new THREE.Vector3(-1100, 0,  700), district: 'industrial', xpReward: 400 },
  { id: 'lm_festival_plaza',   label: 'Festival Plaza',        position: new THREE.Vector3(   0,  0, -120), district: 'downtown',   xpReward: 400 },
  { id: 'lm_harbor_lighthouse',label: 'Harbor Lighthouse',     position: new THREE.Vector3(1900,  0,  450), district: 'waterfront', xpReward: 400 },
  { id: 'lm_pit_lane',         label: 'Race Pit Lane',         position: new THREE.Vector3(1000,  0,  750), district: 'racing',     xpReward: 400 },
  { id: 'lm_tunnel_entrance',  label: 'Downtown Tunnel',       position: new THREE.Vector3( 100,  0,  200), district: 'downtown',   xpReward: 400 },
]);

// ─── Barn Finds ───────────────────────────────────────────────────────────────

export const BARN_FINDS = Object.freeze([
  {
    id:              'bf_01',
    carId:           'barn_classic_muscle',
    label:           'Barn Find #1 — Classic Muscle',
    hint:            'Heard about an old garage near the industrial crane...',
    position:        new THREE.Vector3(-1750, 0, 900),
    district:        'industrial',
    glowRadius:      10,
    restorationCost: 35000,
    lore:            'A 1969 muscle car abandoned by a racing team after a crash that ended their season. Left untouched for decades, the engine still turns over.',
  },
  {
    id:              'bf_02',
    carId:           'barn_vintage_racer',
    label:           'Barn Find #2 — Vintage Circuit Racer',
    hint:            'The old track mechanic mentioned a storage unit near the back of the racing district...',
    position:        new THREE.Vector3(1850, 0, 1800),
    district:        'racing',
    glowRadius:      10,
    restorationCost: 75000,
    lore:            'A hand-built prototype from the 1960s that never made it to the grid. The team folded before its debut race. Now it can finally run.',
  },
  {
    id:              'bf_03',
    carId:           'barn_harbor_speedster',
    label:           'Barn Find #3 — Harbor Speedster',
    hint:            'Someone spotted a covered car in one of the old dock warehouses...',
    position:        new THREE.Vector3(1900, 0, 480),
    district:        'waterfront',
    glowRadius:      10,
    restorationCost: 50000,
    lore:            'A lightweight two-seater roadster that once won a legendary coastal race. Seized by customs and forgotten in a bond store for thirty years.',
  },
  {
    id:              'bf_04',
    carId:           'barn_hillside_classic',
    label:           'Barn Find #4 — Hillside Estate Classic',
    hint:            'The gardener at the old Pearson estate says there\'s a locked garage at the top of the hill...',
    position:        new THREE.Vector3(950, 90, 1900),
    district:        'suburbs',
    glowRadius:      10,
    restorationCost: 20000,
    lore:            'A luxury grand tourer from the 1950s, once owned by a movie director. Parked in the estate garage after a minor fender bender that was never repaired.',
  },
  {
    id:              'bf_05',
    carId:           'barn_outskirts_rally',
    label:           'Barn Find #5 — Outskirts Rally Legend',
    hint:            'The highway patrol mentioned a derelict building near the old toll plaza...',
    position:        new THREE.Vector3(-1850, 0, -1800),
    district:        'outskirts',
    glowRadius:      10,
    restorationCost: 150000,
    lore:            'A works rally car that finished second in a world championship thirty years ago. Retired to a private collection, then sold, then lost. Until now.',
  },
]);

// ─── Board Glow Config ────────────────────────────────────────────────────────

const BOARD_COLLECT_RADIUS  = 8;    // metres
const BOARD_GLOW_SIZE       = 3.5;  // metres — quad size
const BOARD_PULSE_SPEED     = 1.8;  // radians per second
const BOARD_PULSE_MIN       = 0.6;  // emissive intensity low
const BOARD_PULSE_MAX       = 1.4;  // emissive intensity high

const LANDMARK_DISCOVER_RADIUS = 20; // metres
const BARN_GLOW_RADIUS         = 10; // metres at night

// ─── Materials (shared) ───────────────────────────────────────────────────────

const _creditBoardMat = new THREE.MeshStandardMaterial({
  color:             0xffdd00,
  emissive:          new THREE.Color(0xffaa00),
  emissiveIntensity: 1.0,
  roughness:         0.3,
  metalness:         0.6,
});
const _xpBoardMat = new THREE.MeshStandardMaterial({
  color:             0x00aaff,
  emissive:          new THREE.Color(0x0055ff),
  emissiveIntensity: 1.0,
  roughness:         0.3,
  metalness:         0.6,
});
const _barnGlowMat = new THREE.MeshStandardMaterial({
  color:             0x88ff88,
  emissive:          new THREE.Color(0x00ff44),
  emissiveIntensity: 0.0,
  transparent:       true,
  opacity:           0.55,
  roughness:         0.5,
});

// ─── Internal State ───────────────────────────────────────────────────────────

/** Map<id, { mesh:THREE.Mesh, collected:boolean, phase:number }> */
const _boards      = new Map();
/** Map<id, { discovered:boolean }> */
const _landmarks   = new Map();
/** Map<id, { claimed:boolean, glowMesh:THREE.Mesh }> */
const _barnFinds   = new Map();
/** Map<id, { bestTierIndex:number }> — 0=none,1=bronze,2=silver,3=gold */
const _speedTraps  = new Map();

/** Collect event subscribers. */
const _collectSubs = new Set();

/** Running phase counter for glow pulse. */
let _phase = 0;

/** SaveManager reference injected at init. */
let _save  = null;

let _ready = false;

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * @param {THREE.Scene} scene
 * @param {object}      world        — Rapier world
 * @param {object}      saveManager  — SaveManager singleton
 */
export function initPOI(scene, world, saveManager) {
  _save = saveManager;
  if (!_save) { _save = { get: (_k, d) => d, set: () => {} }; }

  const collectedBoards    = sm.get('world',     'collectedBoards')     ?? [];
  const discoveredLandmarks= sm.get('world',     'discoveredLandmarks') ?? [];
  const claimedBarns       = sm.get('barnFinds', 'discovered')          ?? [];
  const trapBests          = sm.get('world',     'speedTrapBests')      ?? {};
  
  // ── Boards ───────────────────────────────────────────────────────────────
  const boardGeo = new THREE.PlaneGeometry(BOARD_GLOW_SIZE, BOARD_GLOW_SIZE);

  for (const board of BOARD_DATA) {
    const collected = collectedBoards.includes(board.id);
    const mat       = board.type === 'credit' ? _creditBoardMat.clone() : _xpBoardMat.clone();

    const mesh      = new THREE.Mesh(boardGeo, mat);
    mesh.position.copy(board.position);
    mesh.position.y += 1.5;
    mesh.rotation.y  = Math.random() * Math.PI * 2; // Random facing — billboard-style
    mesh.visible     = !collected;
    mesh.name        = `board_${board.id}`;
    GROUPS.world.add(mesh);

    if (!collected) {
      // Sensor body for drive-through detection
      createBody({
        handle:      `poi_board_${board.id}`,
        type:        'fixed',
        translation: { x: board.position.x, y: board.position.y + 1.5, z: board.position.z },
        colliders:   [{ shape: 'ball', args: [BOARD_COLLECT_RADIUS], sensor: true }],
      });
    }

    _boards.set(board.id, { board, mesh, collected, phase: Math.random() * Math.PI * 2 });
  }

  // ── Landmarks ────────────────────────────────────────────────────────────
  for (const lm of LANDMARK_DATA) {
    const discovered = discoveredLandmarks.includes(lm.id);
    _landmarks.set(lm.id, { lm, discovered });
  }

  // ── Barn Finds ────────────────────────────────────────────────────────────
  const barnGeo  = new THREE.SphereGeometry(2, 8, 6);
  for (const barn of BARN_FINDS) {
    const claimed    = claimedBarns.includes(barn.id);
    const glowMesh   = new THREE.Mesh(barnGeo, _barnGlowMat.clone());
    glowMesh.position.copy(barn.position);
    glowMesh.position.y += 2;
    glowMesh.visible     = !claimed;
    GROUPS.world.add(glowMesh);
    _barnFinds.set(barn.id, { barn, claimed, glowMesh });
  }

  // ── Speed Traps ───────────────────────────────────────────────────────────
  for (const trap of SPEED_TRAPS) {
    _speedTraps.set(trap.id, { best: trapBests[trap.id] ?? 0 }); // 0=none,1=bronze,2=silver,3=gold
  }

  _ready = true;
  console.log(`[poi] initPOI() complete — ${BOARD_DATA.length} boards, ${LANDMARK_DATA.length} landmarks, ${BARN_FINDS.length} barn finds.`);
}

// ─── Per-Frame Tick ───────────────────────────────────────────────────────────

/**
 * @param {number}        dt
 * @param {THREE.Vector3} playerPos  — car or avatar world position
 * @param {number}        speedKph   — current vehicle speed for trap checks
 */
export function tickPOI(dt, playerPos, speedKph = 0) {
  if (!_ready) return;

  _phase += BOARD_PULSE_SPEED * dt;

  const pulse = BOARD_PULSE_MIN +
    (Math.sin(_phase) * 0.5 + 0.5) * (BOARD_PULSE_MAX - BOARD_PULSE_MIN);

  // ── Board glow + collect check ────────────────────────────────────────────
  for (const [id, state] of _boards) {
    if (state.collected) continue;

    // Pulse emissive
    state.mesh.material.emissiveIntensity = pulse;

    // Spin slowly for visibility
    state.mesh.rotation.y += dt * 0.8;

    // Collection proximity check
    const dx   = playerPos.x - state.board.position.x;
    const dz   = playerPos.z - state.board.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < BOARD_COLLECT_RADIUS) {
      _collectBoard(id, state);
    }
  }

  // ── Landmark discovery check ──────────────────────────────────────────────
  for (const [id, state] of _landmarks) {
    if (state.discovered) continue;

    const dx   = playerPos.x - state.lm.position.x;
    const dz   = playerPos.z - state.lm.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < LANDMARK_DISCOVER_RADIUS) {
      _discoverLandmark(id, state);
    }
  }

  // ── Barn find glow + proximity ────────────────────────────────────────────
  for (const [id, state] of _barnFinds) {
    if (state.claimed) continue;

    const dx   = playerPos.x - state.barn.position.x;
    const dz   = playerPos.z - state.barn.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Glow fades in as player approaches
    const glowTarget = dist < BARN_GLOW_RADIUS * 2
      ? Math.max(0, 1 - dist / (BARN_GLOW_RADIUS * 2))
      : 0;
    state.glowMesh.material.emissiveIntensity +=
      (glowTarget - state.glowMesh.material.emissiveIntensity) * Math.min(1, dt * 3);

    if (dist < state.barn.glowRadius) {
      _fireCollect({
        type:     'barn_proximity',
        barnId:   id,
        barn:     state.barn,
        distance: dist,
      });
      // Actual claim happens when player presses E — handled by buildings.js-style interaction
    }
  }

  // ── Speed trap check ──────────────────────────────────────────────────────
  if (speedKph > 80) { // Skip check when going slow — saves iteration
    for (const [id, state] of _speedTraps) {
      const trap = SPEED_TRAPS.find(t => t.id === id);
      if (!trap) continue;

      const dx   = playerPos.x - trap.position.x;
      const dz   = playerPos.z - trap.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 12) {
        _checkSpeedTrap(id, state, trap, speedKph);
      }
    }
  }
}

// ─── Collect Logic ────────────────────────────────────────────────────────────

function _collectBoard(id, state) {
  state.collected = true;
  state.mesh.visible = false;

  // Persist
  const collected = _save?.get('collectedBoards', []) ?? [];
  if (!collected.includes(id)) {
    collected.push(id);
    _save?.set('collectedBoards', collected);
  }

  _fireCollect({
    type:         'board',
    boardId:      id,
    boardType:    state.board.type,
    creditReward: state.board.creditReward,
    xpReward:     state.board.xpReward,
    position:     state.board.position,
  });
}

function _discoverLandmark(id, state) {
  state.discovered = true;

  const discovered = _save?.get('discoveredLandmarks', []) ?? [];
  if (!discovered.includes(id)) {
    discovered.push(id);
    _save?.set('discoveredLandmarks', discovered);
  }

  // Check district completion
  const districtLandmarks = LANDMARK_DATA.filter(lm => lm.district === state.lm.district);
  const allFound = districtLandmarks.every(lm => {
    const s = _landmarks.get(lm.id);
    return s?.discovered;
  });

  _fireCollect({
    type:              'landmark',
    landmarkId:        id,
    label:             state.lm.label,
    xpReward:          state.lm.xpReward,
    position:          state.lm.position,
    districtComplete:  allFound,
    district:          state.lm.district,
  });
}

export function claimBarnFind(id) {
  const state = _barnFinds.get(id);
  if (!state || state.claimed) return;

  state.claimed = true;
  state.glowMesh.visible = false;
  state.glowMesh.material.emissiveIntensity = 0;

  const claimed = _save?.get('claimedBarns', []) ?? [];
  if (!claimed.includes(id)) {
    claimed.push(id);
    _save?.set('claimedBarns', claimed);
  }

  _fireCollect({
    type:    'barn',
    barnId:  id,
    barn:    state.barn,
    carId:   state.barn.carId,
  });
}

function _checkSpeedTrap(id, state, trap, speedKph) {
  let tier = 0;
  if      (speedKph >= trap.gold)   tier = 3;
  else if (speedKph >= trap.silver) tier = 2;
  else if (speedKph >= trap.bronze) tier = 1;

  if (tier > state.best) {
    const prevBest = state.best;
    state.best = tier;

    const bests = _save?.get('world', 'speedTrapBests') ?? {};
    bests[id] = tier;
    _save?.set('world', 'speedTrapBests', bests);
    
    const tierLabels = ['', 'Bronze', 'Silver', 'Gold'];
    _fireCollect({
      type:     'speedTrap',
      trapId:   id,
      label:    trap.label,
      speedKph,
      tier,
      tierLabel:tierLabels[tier],
      prevBest,
      xpReward: tier === 3 ? trap.xpReward : tier === 2 ? Math.floor(trap.xpReward * 0.6) : Math.floor(trap.xpReward * 0.3),
      position: trap.position,
    });
  }
}

// ─── Event Bus ────────────────────────────────────────────────────────────────

/**
 * Subscribe to POI collect / discover events.
 * Payload shape varies by type — see _collectBoard, _discoverLandmark etc.
 *
 * @param {function} fn
 */
export function onCollect(fn) {
  _collectSubs.add(fn);
}

function _fireCollect(payload) {
  for (const fn of _collectSubs) {
    try { fn(payload); } catch (e) { console.warn('[poi] collect subscriber error', e); }
  }
}

// ─── Map Layer Snapshot ───────────────────────────────────────────────────────

/**
 * Returns live POI state snapshot consumed by map.js and minimap renderer.
 * Called once per map open (not every frame).
 */
export function getPOIState() {
  return {
    boards: [..._boards.values()].map(s => ({
      id:        s.board.id,
      type:      s.board.type,
      position:  s.board.position,
      collected: s.collected,
    })),
    landmarks: [..._landmarks.values()].map(s => ({
      id:         s.lm.id,
      label:      s.lm.label,
      position:   s.lm.position,
      discovered: s.discovered,
    })),
    barnFinds: [..._barnFinds.values()].map(s => ({
      id:      s.barn.id,
      label:   s.barn.label,
      position:s.barn.position,
      claimed: s.claimed,
    })),
    speedTraps: [..._speedTraps.values()].map((s, i) => ({
      id:       SPEED_TRAPS[i].id,
      label:    SPEED_TRAPS[i].label,
      position: SPEED_TRAPS[i].position,
      best:     s.best,
    })),
    totals: {
      boardsCollected:     [..._boards.values()].filter(s => s.collected).length,
      boardsTotal:         BOARD_DATA.length,
      landmarksDiscovered: [..._landmarks.values()].filter(s => s.discovered).length,
      landmarksTotal:      LANDMARK_DATA.length,
      barnsFound:          [..._barnFinds.values()].filter(s => s.claimed).length,
      barnsTotal:          BARN_FINDS.length,
    },
  };
}

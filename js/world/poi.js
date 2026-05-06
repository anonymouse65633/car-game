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
  // ── Guanajuato Credit Boards (30) — dense colonial streets ────────────────
  { id:'cb_gua_01', type:'credit', position: new THREE.Vector3(1600, 82,  -2400), creditReward:2000, xpReward:300 },
  { id:'cb_gua_02', type:'credit', position: new THREE.Vector3(1900, 85,  -2200), creditReward:2500, xpReward:300 },
  { id:'cb_gua_03', type:'credit', position: new THREE.Vector3(2100, 90,  -2000), creditReward:3000, xpReward:300 },
  { id:'cb_gua_04', type:'credit', position: new THREE.Vector3(2300, 95,  -1800), creditReward:2000, xpReward:300 },
  { id:'cb_gua_05', type:'credit', position: new THREE.Vector3(2000, 88,  -1600), creditReward:2500, xpReward:300 },
  { id:'cb_gua_06', type:'credit', position: new THREE.Vector3(1700, 82,  -1500), creditReward:3500, xpReward:300 },
  { id:'cb_gua_07', type:'credit', position: new THREE.Vector3(1500, 80,  -1900), creditReward:2000, xpReward:300 },
  { id:'cb_gua_08', type:'credit', position: new THREE.Vector3(2400, 100, -2800), creditReward:4000, xpReward:300 },
  { id:'cb_gua_09', type:'credit', position: new THREE.Vector3(2700, 110, -2600), creditReward:5000, xpReward:300 },
  { id:'cb_gua_10', type:'credit', position: new THREE.Vector3(2800, 105, -2200), creditReward:3000, xpReward:300 },
  { id:'cb_gua_11', type:'credit', position: new THREE.Vector3(2600, 95,  -1900), creditReward:2500, xpReward:300 },
  { id:'cb_gua_12', type:'credit', position: new THREE.Vector3(1800, 82,  -2700), creditReward:3000, xpReward:300 },
  { id:'cb_gua_13', type:'xp',     position: new THREE.Vector3(1600, 82,  -2100), creditReward:0,    xpReward:1000 },
  { id:'cb_gua_14', type:'xp',     position: new THREE.Vector3(2100, 95,  -2500), creditReward:0,    xpReward:1200 },
  { id:'cb_gua_15', type:'xp',     position: new THREE.Vector3(2500, 100, -2300), creditReward:0,    xpReward:1000 },
  { id:'cb_gua_16', type:'credit', position: new THREE.Vector3(1900, 84,  -1700), creditReward:2000, xpReward:300 },
  { id:'cb_gua_17', type:'credit', position: new THREE.Vector3(2200, 92,  -1500), creditReward:2500, xpReward:300 },
  { id:'cb_gua_18', type:'credit', position: new THREE.Vector3(2400, 98,  -1300), creditReward:3000, xpReward:300 },
  { id:'cb_gua_19', type:'xp',     position: new THREE.Vector3(1700, 82,  -1200), creditReward:0,    xpReward:800  },
  { id:'cb_gua_20', type:'xp',     position: new THREE.Vector3(2800, 110, -2900), creditReward:0,    xpReward:1500 },
  { id:'cb_gua_21', type:'credit', position: new THREE.Vector3(1100, 80,  -1100), creditReward:2000, xpReward:300 },
  { id:'cb_gua_22', type:'credit', position: new THREE.Vector3(1300, 80,  -1400), creditReward:2000, xpReward:300 },
  { id:'cb_gua_23', type:'credit', position: new THREE.Vector3(2900, 112, -2700), creditReward:6000, xpReward:300 },
  { id:'cb_gua_24', type:'xp',     position: new THREE.Vector3(2600, 105, -2100), creditReward:0,    xpReward:1200 },
  { id:'cb_gua_25', type:'credit', position: new THREE.Vector3(1400, 80,  -2900), creditReward:2000, xpReward:300 },
  { id:'cb_gua_26', type:'credit', position: new THREE.Vector3(1200, 80,  -1800), creditReward:2000, xpReward:300 },
  { id:'cb_gua_27', type:'credit', position: new THREE.Vector3(2100, 90,  -1200), creditReward:2500, xpReward:300 },
  { id:'cb_gua_28', type:'xp',     position: new THREE.Vector3(1800, 85,  -1300), creditReward:0,    xpReward:1000 },
  { id:'cb_gua_29', type:'credit', position: new THREE.Vector3(2700, 108, -1700), creditReward:4000, xpReward:300 },
  { id:'cb_gua_30', type:'xp',     position: new THREE.Vector3(2900, 115, -2400), creditReward:0,    xpReward:2000 },

  // ── Caldera volcanic road boards (15) — reward daring drivers ─────────────
  { id:'cb_cal_01', type:'credit', position: new THREE.Vector3(2200,-2900,  1), creditReward:4000, xpReward:500 },
  { id:'cb_cal_02', type:'credit', position: new THREE.Vector3(2500,-3200,  1), creditReward:5000, xpReward:500 },
  { id:'cb_cal_03', type:'credit', position: new THREE.Vector3(2800,-3500,  1), creditReward:6000, xpReward:500 },
  { id:'cb_cal_04', type:'credit', position: new THREE.Vector3(3100,-3800,  1), creditReward:7000, xpReward:500 },
  { id:'cb_cal_05', type:'xp',     position: new THREE.Vector3(3300,-4000,  1), creditReward:0,    xpReward:3000 },
  { id:'cb_cal_06', type:'credit', position: new THREE.Vector3(3500,-3900,  1), creditReward:8000, xpReward:500 },
  { id:'cb_cal_07', type:'xp',     position: new THREE.Vector3(3700,-4200,  1), creditReward:0,    xpReward:4000 },
  { id:'cb_cal_08', type:'credit', position: new THREE.Vector3(2000,-2600,  1), creditReward:3500, xpReward:500 },
  { id:'cb_cal_09', type:'xp',     position: new THREE.Vector3(2400,-2700,  1), creditReward:0,    xpReward:2000 },
  { id:'cb_cal_10', type:'credit', position: new THREE.Vector3(2900,-3100,  1), creditReward:5500, xpReward:500 },
  { id:'cb_cal_11', type:'xp',     position: new THREE.Vector3(3200,-4100,  1), creditReward:0,    xpReward:3500 },
  { id:'cb_cal_12', type:'credit', position: new THREE.Vector3(3600,-4400,  1), creditReward:9000, xpReward:500 },
  { id:'cb_cal_13', type:'xp',     position: new THREE.Vector3(3800,-4500,  1), creditReward:0,    xpReward:5000 },
  { id:'cb_cal_14', type:'credit', position: new THREE.Vector3(4000,-3800,  1), creditReward:8000, xpReward:500 },
  { id:'cb_cal_15', type:'credit', position: new THREE.Vector3(4200,-3400,  1), creditReward:7000, xpReward:500 },

  // ── Riviera beachfront boards (20) ────────────────────────────────────────
  { id:'cb_riv_01', type:'credit', position: new THREE.Vector3(3000, 5, -1800), creditReward:3000, xpReward:350 },
  { id:'cb_riv_02', type:'credit', position: new THREE.Vector3(3400, 5, -1500), creditReward:2500, xpReward:350 },
  { id:'cb_riv_03', type:'credit', position: new THREE.Vector3(3800, 5, -1200), creditReward:3500, xpReward:350 },
  { id:'cb_riv_04', type:'credit', position: new THREE.Vector3(4200, 5,  -900), creditReward:4000, xpReward:350 },
  { id:'cb_riv_05', type:'credit', position: new THREE.Vector3(4600, 5,  -600), creditReward:3000, xpReward:350 },
  { id:'cb_riv_06', type:'credit', position: new THREE.Vector3(4800, 5,  -300), creditReward:5000, xpReward:350 },
  { id:'cb_riv_07', type:'credit', position: new THREE.Vector3(4700, 5,   100), creditReward:3000, xpReward:350 },
  { id:'cb_riv_08', type:'credit', position: new THREE.Vector3(4400, 5,   300), creditReward:2500, xpReward:350 },
  { id:'cb_riv_09', type:'xp',     position: new THREE.Vector3(4000, 5,  -100), creditReward:0,    xpReward:1500 },
  { id:'cb_riv_10', type:'xp',     position: new THREE.Vector3(3600, 5,  -600), creditReward:0,    xpReward:1200 },
  { id:'cb_riv_11', type:'credit', position: new THREE.Vector3(3200, 5,  -400), creditReward:3000, xpReward:350 },
  { id:'cb_riv_12', type:'xp',     position: new THREE.Vector3(4800, 8, -2000), creditReward:0,    xpReward:2000 },
  { id:'cb_riv_13', type:'credit', position: new THREE.Vector3(4600, 5, -1600), creditReward:5000, xpReward:350 },
  { id:'cb_riv_14', type:'credit', position: new THREE.Vector3(4400, 5, -2200), creditReward:4000, xpReward:350 },
  { id:'cb_riv_15', type:'xp',     position: new THREE.Vector3(4100, 5, -2400), creditReward:0,    xpReward:1800 },
  { id:'cb_riv_16', type:'credit', position: new THREE.Vector3(3700, 5, -2200), creditReward:3500, xpReward:350 },
  { id:'cb_riv_17', type:'credit', position: new THREE.Vector3(3400, 5, -2000), creditReward:3000, xpReward:350 },
  { id:'cb_riv_18', type:'xp',     position: new THREE.Vector3(3000, 5,  -300), creditReward:0,    xpReward:1000 },
  { id:'cb_riv_19', type:'credit', position: new THREE.Vector3(2700, 5,  200),  creditReward:2000, xpReward:350 },
  { id:'cb_riv_20', type:'credit', position: new THREE.Vector3(2900, 5,  400),  creditReward:2000, xpReward:350 },

  // ── Dunas reward boards (20) — explorers only ─────────────────────────────
  { id:'cb_dun_01', type:'credit', position: new THREE.Vector3(-2000,-3200, 1), creditReward:4000, xpReward:400 },
  { id:'cb_dun_02', type:'credit', position: new THREE.Vector3(-2500,-3000, 1), creditReward:4500, xpReward:400 },
  { id:'cb_dun_03', type:'credit', position: new THREE.Vector3(-3000,-2800, 1), creditReward:5000, xpReward:400 },
  { id:'cb_dun_04', type:'xp',     position: new THREE.Vector3(-3500,-2600, 1), creditReward:0,    xpReward:2000 },
  { id:'cb_dun_05', type:'credit', position: new THREE.Vector3(-4000,-2800, 1), creditReward:5500, xpReward:400 },
  { id:'cb_dun_06', type:'xp',     position: new THREE.Vector3(-4400,-3000, 1), creditReward:0,    xpReward:2500 },
  { id:'cb_dun_07', type:'credit', position: new THREE.Vector3(-4600,-3400, 1), creditReward:6000, xpReward:400 },
  { id:'cb_dun_08', type:'credit', position: new THREE.Vector3(-4200,-3800, 1), creditReward:5000, xpReward:400 },
  { id:'cb_dun_09', type:'xp',     position: new THREE.Vector3(-3600,-3600, 1), creditReward:0,    xpReward:3000 },
  { id:'cb_dun_10', type:'credit', position: new THREE.Vector3(-3000,-3400, 1), creditReward:4000, xpReward:400 },
  { id:'cb_dun_11', type:'xp',     position: new THREE.Vector3(-2400,-3600, 1), creditReward:0,    xpReward:1800 },
  { id:'cb_dun_12', type:'credit', position: new THREE.Vector3(-1800,-3000, 1), creditReward:3500, xpReward:400 },
  { id:'cb_dun_13', type:'credit', position: new THREE.Vector3(-1500,-2400, 1), creditReward:3000, xpReward:400 },
  { id:'cb_dun_14', type:'xp',     position: new THREE.Vector3(-1200,-1800, 1), creditReward:0,    xpReward:1500 },
  { id:'cb_dun_15', type:'credit', position: new THREE.Vector3(-1800,-1500, 1), creditReward:3000, xpReward:400 },
  { id:'cb_dun_16', type:'credit', position: new THREE.Vector3(-2400,-1400, 1), creditReward:3500, xpReward:400 },
  { id:'cb_dun_17', type:'xp',     position: new THREE.Vector3(-3000,-1600, 1), creditReward:0,    xpReward:2000 },
  { id:'cb_dun_18', type:'credit', position: new THREE.Vector3(-3600,-1800, 1), creditReward:4000, xpReward:400 },
  { id:'cb_dun_19', type:'xp',     position: new THREE.Vector3(-4200,-2200, 1), creditReward:0,    xpReward:2500 },
  { id:'cb_dun_20', type:'credit', position: new THREE.Vector3(-4800,-2600, 1), creditReward:6000, xpReward:400 },

  // ── Baja Desert boards (20) ───────────────────────────────────────────────
  { id:'cb_baj_01', type:'credit', position: new THREE.Vector3(-1000, 50,  200), creditReward:3000, xpReward:400 },
  { id:'cb_baj_02', type:'credit', position: new THREE.Vector3(-1500, 60,  400), creditReward:3500, xpReward:400 },
  { id:'cb_baj_03', type:'xp',     position: new THREE.Vector3(-2000, 70,  600), creditReward:0,    xpReward:1500 },
  { id:'cb_baj_04', type:'credit', position: new THREE.Vector3(-2500, 80,  800), creditReward:4000, xpReward:400 },
  { id:'cb_baj_05', type:'credit', position: new THREE.Vector3(-3000, 90, 1000), creditReward:4500, xpReward:400 },
  { id:'cb_baj_06', type:'xp',     position: new THREE.Vector3(-3500,100, 1200), creditReward:0,    xpReward:2000 },
  { id:'cb_baj_07', type:'credit', position: new THREE.Vector3(-4000,110, 1400), creditReward:5000, xpReward:400 },
  { id:'cb_baj_08', type:'xp',     position: new THREE.Vector3(-4500,120, 1600), creditReward:0,    xpReward:2500 },
  { id:'cb_baj_09', type:'credit', position: new THREE.Vector3(-4800,125, 1800), creditReward:6000, xpReward:400 },
  { id:'cb_baj_10', type:'credit', position: new THREE.Vector3(-4600,120, -200), creditReward:5000, xpReward:400 },
  { id:'cb_baj_11', type:'xp',     position: new THREE.Vector3(-4200,110, -400), creditReward:0,    xpReward:2000 },
  { id:'cb_baj_12', type:'credit', position: new THREE.Vector3(-3800,100, -600), creditReward:4000, xpReward:400 },
  { id:'cb_baj_13', type:'credit', position: new THREE.Vector3(-3400, 90, -800), creditReward:3500, xpReward:400 },
  { id:'cb_baj_14', type:'xp',     position: new THREE.Vector3(-3000, 80,-1000), creditReward:0,    xpReward:1800 },
  { id:'cb_baj_15', type:'credit', position: new THREE.Vector3(-2600, 70, -800), creditReward:3000, xpReward:400 },
  { id:'cb_baj_16', type:'credit', position: new THREE.Vector3(-2200, 65, -500), creditReward:2500, xpReward:400 },
  { id:'cb_baj_17', type:'xp',     position: new THREE.Vector3(-1800, 55, -300), creditReward:0,    xpReward:1200 },
  { id:'cb_baj_18', type:'credit', position: new THREE.Vector3(-1400, 50,  -50), creditReward:2500, xpReward:400 },
  { id:'cb_baj_19', type:'credit', position: new THREE.Vector3(-800,  45,  100), creditReward:2000, xpReward:400 },
  { id:'cb_baj_20', type:'xp',     position: new THREE.Vector3(-600,  40,  -50), creditReward:0,    xpReward:1000 },

  // ── Festival Grounds boards (20) ──────────────────────────────────────────
  { id:'cb_fes_01', type:'credit', position: new THREE.Vector3(-2800, 20, 700),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_02', type:'credit', position: new THREE.Vector3(-2400, 20, 900),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_03', type:'xp',     position: new THREE.Vector3(-2000, 20,1100),  creditReward:0,    xpReward:800  },
  { id:'cb_fes_04', type:'credit', position: new THREE.Vector3(-1600, 20,1300),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_05', type:'credit', position: new THREE.Vector3(-1200, 20,1500),  creditReward:2500, xpReward:300 },
  { id:'cb_fes_06', type:'xp',     position: new THREE.Vector3( -800, 20,1700),  creditReward:0,    xpReward:1000 },
  { id:'cb_fes_07', type:'credit', position: new THREE.Vector3( -400, 20,1900),  creditReward:2500, xpReward:300 },
  { id:'cb_fes_08', type:'credit', position: new THREE.Vector3( -400, 20,2400),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_09', type:'xp',     position: new THREE.Vector3(-1000, 20,2600),  creditReward:0,    xpReward:800  },
  { id:'cb_fes_10', type:'credit', position: new THREE.Vector3(-1800, 20,2800),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_11', type:'credit', position: new THREE.Vector3(-2600, 20,2800),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_12', type:'xp',     position: new THREE.Vector3(-2900, 20,2400),  creditReward:0,    xpReward:1000 },
  { id:'cb_fes_13', type:'credit', position: new THREE.Vector3(-2800, 20,1800),  creditReward:2500, xpReward:300 },
  { id:'cb_fes_14', type:'credit', position: new THREE.Vector3(-2400, 20,1500),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_15', type:'xp',     position: new THREE.Vector3(-2000, 20,2000),  creditReward:0,    xpReward:1200 },
  { id:'cb_fes_16', type:'credit', position: new THREE.Vector3(-1600, 20,2200),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_17', type:'credit', position: new THREE.Vector3(-1200, 20,2400),  creditReward:2000, xpReward:300 },
  { id:'cb_fes_18', type:'xp',     position: new THREE.Vector3( -800, 20,2200),  creditReward:0,    xpReward:1000 },
  { id:'cb_fes_19', type:'credit', position: new THREE.Vector3( -300, 20,2600),  creditReward:2500, xpReward:300 },
  { id:'cb_fes_20', type:'credit', position: new THREE.Vector3(-2600, 20,2200),  creditReward:2000, xpReward:300 },

  // ── La Selva Jungle boards (20) ───────────────────────────────────────────
  { id:'cb_jun_01', type:'credit', position: new THREE.Vector3( 800, 20, 1400), creditReward:3000, xpReward:450 },
  { id:'cb_jun_02', type:'xp',     position: new THREE.Vector3(1100, 25, 1600), creditReward:0,    xpReward:1500 },
  { id:'cb_jun_03', type:'credit', position: new THREE.Vector3(1400, 25, 1800), creditReward:3500, xpReward:450 },
  { id:'cb_jun_04', type:'credit', position: new THREE.Vector3(1800, 30, 2100), creditReward:4000, xpReward:450 },
  { id:'cb_jun_05', type:'xp',     position: new THREE.Vector3(2100, 30, 2400), creditReward:0,    xpReward:2000 },
  { id:'cb_jun_06', type:'credit', position: new THREE.Vector3(2400, 30, 2700), creditReward:4500, xpReward:450 },
  { id:'cb_jun_07', type:'xp',     position: new THREE.Vector3(2200, 30, 3000), creditReward:0,    xpReward:2500 },
  { id:'cb_jun_08', type:'credit', position: new THREE.Vector3(1900, 30, 3300), creditReward:5000, xpReward:450 },
  { id:'cb_jun_09', type:'credit', position: new THREE.Vector3(1500, 25, 3600), creditReward:4000, xpReward:450 },
  { id:'cb_jun_10', type:'xp',     position: new THREE.Vector3(1100, 20, 3800), creditReward:0,    xpReward:3000 },
  { id:'cb_jun_11', type:'credit', position: new THREE.Vector3(2800, 35, 1200), creditReward:3000, xpReward:450 },
  { id:'cb_jun_12', type:'credit', position: new THREE.Vector3(3200, 35, 1600), creditReward:3500, xpReward:450 },
  { id:'cb_jun_13', type:'xp',     position: new THREE.Vector3(3000, 35, 2200), creditReward:0,    xpReward:2000 },
  { id:'cb_jun_14', type:'credit', position: new THREE.Vector3(2800, 30, 2800), creditReward:4000, xpReward:450 },
  { id:'cb_jun_15', type:'xp',     position: new THREE.Vector3(2500, 30, 3400), creditReward:0,    xpReward:2500 },
  { id:'cb_jun_16', type:'credit', position: new THREE.Vector3(2100, 30, 3700), creditReward:5000, xpReward:450 },
  { id:'cb_jun_17', type:'credit', position: new THREE.Vector3(1600, 25, 3900), creditReward:5000, xpReward:450 },
  { id:'cb_jun_18', type:'xp',     position: new THREE.Vector3(1200, 25, 3700), creditReward:0,    xpReward:3000 },
  { id:'cb_jun_19', type:'credit', position: new THREE.Vector3( 900, 20, 3400), creditReward:4000, xpReward:450 },
  { id:'cb_jun_20', type:'credit', position: new THREE.Vector3( 700, 20, 3100), creditReward:3500, xpReward:450 },

  // ── Farmland boards (15) ──────────────────────────────────────────────────
  { id:'cb_frm_01', type:'credit', position: new THREE.Vector3( 200, 22, -600), creditReward:2000, xpReward:300 },
  { id:'cb_frm_02', type:'xp',     position: new THREE.Vector3( 600, 22, -400), creditReward:0,    xpReward:800  },
  { id:'cb_frm_03', type:'credit', position: new THREE.Vector3(1000, 22, -200), creditReward:2500, xpReward:300 },
  { id:'cb_frm_04', type:'credit', position: new THREE.Vector3(1400, 22,  200), creditReward:2000, xpReward:300 },
  { id:'cb_frm_05', type:'xp',     position: new THREE.Vector3(1800, 22,  600), creditReward:0,    xpReward:1000 },
  { id:'cb_frm_06', type:'credit', position: new THREE.Vector3(2200, 22,  900), creditReward:3000, xpReward:300 },
  { id:'cb_frm_07', type:'credit', position: new THREE.Vector3( 400, 22,  800), creditReward:2000, xpReward:300 },
  { id:'cb_frm_08', type:'xp',     position: new THREE.Vector3( 800, 22, 1200), creditReward:0,    xpReward:1000 },
  { id:'cb_frm_09', type:'credit', position: new THREE.Vector3(1200, 22, 1400), creditReward:2500, xpReward:300 },
  { id:'cb_frm_10', type:'credit', position: new THREE.Vector3(1600, 22, 1200), creditReward:2500, xpReward:300 },
  { id:'cb_frm_11', type:'xp',     position: new THREE.Vector3(2000, 22, 1000), creditReward:0,    xpReward:1200 },
  { id:'cb_frm_12', type:'credit', position: new THREE.Vector3(2400, 22,  700), creditReward:3000, xpReward:300 },
  { id:'cb_frm_13', type:'credit', position: new THREE.Vector3( 100, 22,-1600), creditReward:2000, xpReward:300 },
  { id:'cb_frm_14', type:'xp',     position: new THREE.Vector3( 500, 22,-1400), creditReward:0,    xpReward:800  },
  { id:'cb_frm_15', type:'credit', position: new THREE.Vector3( 900, 22,-1000), creditReward:2500, xpReward:300 },

  // ── Highway Ring boards (10) ──────────────────────────────────────────────
  { id:'cb_hwy_01', type:'credit', position: new THREE.Vector3(4800, 22,-4000), creditReward:5000, xpReward:500 },
  { id:'cb_hwy_02', type:'credit', position: new THREE.Vector3(4800, 22,-2000), creditReward:5000, xpReward:500 },
  { id:'cb_hwy_03', type:'credit', position: new THREE.Vector3(4800, 22,    0), creditReward:5000, xpReward:500 },
  { id:'cb_hwy_04', type:'credit', position: new THREE.Vector3(4800, 22, 2000), creditReward:5000, xpReward:500 },
  { id:'cb_hwy_05', type:'credit', position: new THREE.Vector3(4800, 22, 4000), creditReward:5000, xpReward:500 },
  { id:'cb_hwy_06', type:'xp',     position: new THREE.Vector3(-4800, 22,-3000), creditReward:0,   xpReward:2000 },
  { id:'cb_hwy_07', type:'xp',     position: new THREE.Vector3(-4800, 22, 1000), creditReward:0,   xpReward:2000 },
  { id:'cb_hwy_08', type:'credit', position: new THREE.Vector3(   0, 22,-4800), creditReward:5000, xpReward:500 },
  { id:'cb_hwy_09', type:'credit', position: new THREE.Vector3(2000, 22, 4800), creditReward:5000, xpReward:500 },
  { id:'cb_hwy_10', type:'xp',     position: new THREE.Vector3(-2000, 22, 4800), creditReward:0,   xpReward:2000 },
]);

// ─── Speed Traps ──────────────────────────────────────────────────────────────
// Each trap is a single sensor point. speedKph is checked when player crosses.

export const SPEED_TRAPS = Object.freeze([
  // Riviera Coastal straight — flat, sea-level, fastest in the south
  { id:'st_riviera_north',  label:'Riviera Coast Sprint', position: new THREE.Vector3(4600,  5,-1400), bronze:220, silver:280, gold:330 },
  // Baja Highway — long desert straight
  { id:'st_baja_highway',   label:'Baja Highway Blast',   position: new THREE.Vector3(-3400, 60,  600), bronze:250, silver:300, gold:350 },
  // Festival Airstrip — longest flat straight in the world
  { id:'st_airstrip',       label:'Festival Airstrip',    position: new THREE.Vector3(-1800, 20, 1000), bronze:280, silver:330, gold:380 },
  // Guanajuato downhill run
  { id:'st_gua_downhill',   label:'Guanajuato Descent',   position: new THREE.Vector3(1800,  80,-1500), bronze:180, silver:210, gold:240 },
  // Caldera descent road — technical and terrifying
  { id:'st_caldera',        label:'Caldera Descent',      position: new THREE.Vector3(3000,-3500,   1), bronze:200, silver:240, gold:280 },
  // Highway Ring east — built for top speed
  { id:'st_highway_east',   label:'Highway East Stretch', position: new THREE.Vector3(4800, 22,-1000), bronze:260, silver:310, gold:360 },
  // Dunas flat section between dunes
  { id:'st_dunas_flat',     label:'Dunas Flats',          position: new THREE.Vector3(-3000,-2400,  1), bronze:200, silver:250, gold:290 },
  // Riviera marina straight (shorter but fast)
  { id:'st_riviera_marina', label:'Riviera Marina Run',   position: new THREE.Vector3(3800,  5, -600), bronze:210, silver:260, gold:310 },
  // Farmland long straight
  { id:'st_farmland',       label:'Farmland Sprint',      position: new THREE.Vector3(1200, 22,  600), bronze:180, silver:220, gold:260 },
  // Jungle clearing burst
  { id:'st_jungle',         label:'Jungle Clearance',     position: new THREE.Vector3(1800, 25, 2600), bronze:150, silver:190, gold:230 },
  // Baja mesa north section
  { id:'st_baja_mesa',      label:'Mesa Top Run',         position: new THREE.Vector3(-4400,120,  700), bronze:200, silver:240, gold:280 },
  // Highway ring north
  { id:'st_highway_north',  label:'Northern Ring Sprint', position: new THREE.Vector3(   0, 22,-4800), bronze:260, silver:310, gold:360 },
  // Riviera beach drag start line
  { id:'st_beach_drag',     label:'Riviera Beach Drag',   position: new THREE.Vector3(4200,  5,  200), bronze:230, silver:280, gold:330 },
  // Guanajuato aqueduct straight
  { id:'st_aqueduct',       label:'Aqueduct Straight',    position: new THREE.Vector3(2100, 90,-1800), bronze:170, silver:200, gold:230 },
  // Festival ring outer
  { id:'st_festival_outer', label:'Festival Outer Loop',  position: new THREE.Vector3(-2400, 20,1800), bronze:200, silver:250, gold:290 },
  // Canyon road sprint
  { id:'st_canyon',         label:'Canyon Floor',         position: new THREE.Vector3(-1400,-1000,  1), bronze:160, silver:200, gold:240 },
  // Highway south ring
  { id:'st_highway_south',  label:'Southern Ring Sprint', position: new THREE.Vector3(2000, 22, 4800), bronze:260, silver:310, gold:360 },
  // Farmland back road
  { id:'st_farmland_back',  label:'Back Road Sprint',     position: new THREE.Vector3( 400, 22,-1200), bronze:160, silver:200, gold:240 },
  // Caldera approach switchback launch
  { id:'st_caldera_launch', label:'Caldera Road Launch',  position: new THREE.Vector3(2600,-3300,   1), bronze:180, silver:220, gold:260 },
  // Jungle clearing exit
  { id:'st_jungle_exit',    label:'Jungle Exit',          position: new THREE.Vector3(2200, 30, 3000), bronze:140, silver:180, gold:220 },
]);

export const LANDMARK_DATA = Object.freeze([
  { id:'lm_caldera_summit',  label:'Gran Caldera Summit',    position: new THREE.Vector3(3500, 800,-4000), xpReward:3000, icon:'volcano'   },
  { id:'lm_gua_cathedral',   label:'Guanajuato Cathedral',   position: new THREE.Vector3(1800,  80,-2200), xpReward:1500, icon:'church'    },
  { id:'lm_grand_bridge',    label:'The Grand Bridge',       position: new THREE.Vector3(3800,  15,-1000), xpReward:1000, icon:'bridge'    },
  { id:'lm_festival_stage',  label:'Festival Main Stage',    position: new THREE.Vector3(-1500, 20, 1500), xpReward:1000, icon:'festival'  },
  { id:'lm_riviera_light',   label:'Riviera Lighthouse',     position: new THREE.Vector3(4200,  20,-1200), xpReward:1200, icon:'lighthouse'},
  { id:'lm_dunas_crest',     label:'Dunas Crest',            position: new THREE.Vector3(-3200,120,-2600), xpReward:1500, icon:'dunes'     },
  { id:'lm_canyon_overlook', label:'Canyon Overlook',        position: new THREE.Vector3(-800,  200,-1600), xpReward:1800, icon:'canyon'   },
  { id:'lm_jungle_temple',   label:'Jungle Temple Ruin',     position: new THREE.Vector3(1800,  30, 3200), xpReward:2000, icon:'ruin'      },
  { id:'lm_baja_mesa',       label:'Baja Mesa',              position: new THREE.Vector3(-3800, 120,  600), xpReward:1500, icon:'mesa'     },
  { id:'lm_farm_windmill',   label:'Farmland Windmill',      position: new THREE.Vector3(800,   10, -400), xpReward:800,  icon:'windmill'  },
  { id:'lm_airstrip_tower',  label:'Airstrip Control Tower', position: new THREE.Vector3(-2000, 20, 1600), xpReward:800,  icon:'tower'     },
  { id:'lm_harbor_crane',    label:'Harbor Crane',           position: new THREE.Vector3(3800,  5,  -800), xpReward:800,  icon:'crane'     },
  { id:'lm_hot_springs',     label:'Volcano Hot Springs',    position: new THREE.Vector3(3200, 400,-3800), xpReward:2500, icon:'hot_spring'},
  { id:'lm_aqueduct',        label:'Colonial Aqueduct',      position: new THREE.Vector3(2100,  90,-1800), xpReward:1200, icon:'aqueduct'  },
  { id:'lm_coastal_arch',    label:'Coastal Arch Rock',      position: new THREE.Vector3(4700,  8,  -400), xpReward:1200, icon:'arch'      },
  { id:'lm_market_square',   label:'Market Square',          position: new THREE.Vector3(1600,  80,-2100), xpReward:800,  icon:'market'    },
  { id:'lm_desert_station',  label:'Desert Gas Station',     position: new THREE.Vector3(-2000, 50,  200), xpReward:600,  icon:'gas'       },
  { id:'lm_waterfall',       label:'Jungle Waterfall',       position: new THREE.Vector3(2400,  35, 2800), xpReward:1500, icon:'waterfall' },
  { id:'lm_beach_pier',      label:'Sandy Beach Pier',       position: new THREE.Vector3(4000,   5,  400), xpReward:800,  icon:'pier'      },
  { id:'lm_shrine',          label:'Mountain Shrine',        position: new THREE.Vector3(2800, 350,-4200), xpReward:2000, icon:'shrine'    },
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
  _save = saveManager ?? _defaultSave ?? { get: (_k, d) => d, set: () => {} };
  if (!_save) { _save = { get: (_k, d) => d, set: () => {} }; }

  const sm = _save;
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

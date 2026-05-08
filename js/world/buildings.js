/**
 * buildings.js — Part 4 Rebuild: Instanced Buildings + Biome Zones
 * ================================================================
 *
 * What changed vs the old version:
 *  - ALL decorative buildings now rendered with THREE.InstancedMesh
 *    (ONE draw call per building archetype, regardless of count)
 *  - Terrain-height snapping: every building Y is read from getTerrainHeight()
 *  - Two new procedural zones:
 *      • Guanajuato colonial zone  (x 500–2500, z -1000 to -3000)
 *        — terracotta/ochre box buildings on hillside, narrow alley grid
 *      • Desert dunes zone (x -2000 to -6000, z -500 to -2500)
 *        — adobe mud cubes, scattered at wider intervals
 *  - Building REGISTRY (shops) kept identical — still spawns colliders +
 *    entry prompts via createBody / checkEntryTriggers
 *  - No Rapier dependency — createBody() is from the custom physics.js stub
 *
 * Public API (unchanged from Part 1):
 *   initBuildings(scene, world)          — async
 *   checkEntryTriggers(avatarPos)        — per frame
 *   enterBuilding(buildingId)            — on player input
 *   exitBuilding()                       — on player input
 *   onEnterPrompt(fn)                    — subscribe
 *   tickBuildings(dt, avatarPos)         — per frame (streetlights + neon)
 *   getActiveBuildingId()                — query
 *   BUILDING_REGISTRY                    — for minimap
 */

import * as THREE                    from 'three';
import { scene, GROUPS }             from '../engine/renderer.js';
import { createBody }                from '../engine/physics.js';
import { isNight }                   from './environment.js';
import { getTerrainHeight }          from './terrain.js';

// ─── Building Registry (enterable shops — unchanged positions, Y snapped) ─────

export const BUILDING_REGISTRY = Object.freeze([
  {
    id: 'festival_hub',      label: 'Festival Hub',    district: 'festival',
    position:       new THREE.Vector3(-1500, 0,  1500),
    doorPosition:   new THREE.Vector3(-1500, 0,  1483),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(-1500, 0,  1480),
    shopModule:     '../ui/phoneMenu.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 30, hy: 20, hz: 25 },
    type: 'B',  neonColor: 0xff6600,
  },
  {
    id: 'autoshow_main',     label: 'Autoshow',         district: 'guanajuato',
    position:       new THREE.Vector3(1800, 0, -1800),
    doorPosition:   new THREE.Vector3(1800, 0, -1783),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(1800, 0, -1780),
    shopModule:     '../shops/AutoShow.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 35, hy: 18, hz: 28 },
    type: 'B',  neonColor: 0x00ccff,
  },
  {
    id: 'parts_shop_main',   label: 'Parts Shop',       district: 'baja',
    position:       new THREE.Vector3(-2000, 0,  800),
    doorPosition:   new THREE.Vector3(-2000, 0,  817),
    doorNormal:     new THREE.Vector3(0, 0,  1),
    exitPosition:   new THREE.Vector3(-2000, 0,  820),
    shopModule:     '../shops/partsShop.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 25, hy: 12, hz: 20 },
    type: 'B',  neonColor: 0xffaa00,
  },
  {
    id: 'race_hq',           label: 'Race HQ',          district: 'guanajuato',
    position:       new THREE.Vector3(1200, 0, -2200),
    doorPosition:   new THREE.Vector3(1200, 0, -2183),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(1200, 0, -2180),
    shopModule:     '../shops/raceHQ.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 22, hy: 14, hz: 18 },
    type: 'B',  neonColor: 0xff2200,
  },
  {
    id: 'clothing_boutique', label: 'Clothing',         district: 'guanajuato',
    position:       new THREE.Vector3(1600, 0, -1600),
    doorPosition:   new THREE.Vector3(1600, 0, -1583),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(1600, 0, -1580),
    shopModule:     '../shops/ClothingShop.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 14, hy: 10, hz: 12 },
    type: 'B',  neonColor: 0xff66cc,
  },
  {
    id: 'livery_shop',       label: 'Livery Shop',      district: 'guanajuato',
    position:       new THREE.Vector3(1400, 0, -2000),
    doorPosition:   new THREE.Vector3(1400, 0, -1983),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(1400, 0, -1980),
    shopModule:     '../shops/LiveryShop.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 18, hy: 10, hz: 14 },
    type: 'B',  neonColor: 0xcc44ff,
  },
  {
    id: 'drag_strip',        label: 'Drag Strip',       district: 'festival',
    position:       new THREE.Vector3(-1000, 0, 2000),
    doorPosition:   new THREE.Vector3(-1000, 0, 2017),
    doorNormal:     new THREE.Vector3(0, 0,  1),
    exitPosition:   new THREE.Vector3(-1000, 0, 2020),
    shopModule:     '../shops/raceHQ.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 20, hy: 8, hz: 16 },
    type: 'B',  neonColor: 0xffdd00,
  },
  {
    id: 'drift_arena',       label: 'Drift Arena',      district: 'festival',
    position:       new THREE.Vector3(-800, 0, 1800),
    doorPosition:   new THREE.Vector3(-800, 0, 1817),
    doorNormal:     new THREE.Vector3(0, 0,  1),
    exitPosition:   new THREE.Vector3(-800, 0, 1820),
    shopModule:     '../shops/raceHQ.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 30, hy: 10, hz: 25 },
    type: 'B',  neonColor: 0x00ff88,
  },
]);

// ─── Entry Trigger Config ─────────────────────────────────────────────────────

const PROMPT_RADIUS = 4.0;
const ENTER_RADIUS  = 2.2;

// ─── Streetlight Config ───────────────────────────────────────────────────────

const STREETLIGHT_SPACING  = 40;
const STREETLIGHT_HEIGHT   = 8;
const STREETLIGHT_RANGE    = 30;
const STREETLIGHT_LOD_DIST = 100;
const MAX_ACTIVE_LIGHTS    = 24;

// ─── Internal State ───────────────────────────────────────────────────────────

const _buildingState    = new Map();
const _promptSubscribers= new Set();
let   _activeBuildingId = null;
let   _interiorGroup    = null;
const _streetlights     = [];
const _neonMeshes       = [];
let   _ready            = false;
const _instanceGroups   = [];

// ─── Instanced Building Archetypes ───────────────────────────────────────────

const ARCHETYPES = [
  // Guanajuato colonial
  { id:'guan_house_sm',  geom:[4,6,5],   color:0xC27C4C, roofClr:0x7A3F20, zone:'guanajuato', spacing:18, jitter:5,  count:120 },
  { id:'guan_house_lg',  geom:[8,10,7],  color:0xE8C07C, roofClr:0x8B3A1A, zone:'guanajuato', spacing:30, jitter:6,  count:60  },
  { id:'guan_church',    geom:[10,18,12],color:0xF0E0C8, roofClr:0x5A7A3E, zone:'guanajuato', spacing:80, jitter:10, count:8   },
  // Desert adobe
  { id:'desert_adobe_sm',geom:[5,3.5,5], color:0xC4A47C, roofClr:0xB07840, zone:'desert',     spacing:60, jitter:25, count:80  },
  { id:'desert_adobe_lg',geom:[9,5,8],   color:0xBE9970, roofClr:0x8C6040, zone:'desert',     spacing:120,jitter:30, count:30  },
  { id:'desert_ruin',    geom:[6,2.5,6], color:0xAA8C6A, roofClr:0x887060, zone:'desert',     spacing:200,jitter:40, count:15  },
  // Festival
  { id:'festival_tent',  geom:[20,6,14], color:0xE8E020, roofClr:0xCC0000, zone:'festival',   spacing:80, jitter:15, count:20  },
  // Baja workshops
  { id:'baja_workshop',  geom:[12,5,9],  color:0x708090, roofClr:0x556070, zone:'baja',       spacing:90, jitter:20, count:25  },
];

const ZONES = {
  guanajuato: { xMin:  500, xMax: 2500,  zMin:-3000, zMax:-1000 },
  desert:     { xMin:-6000, xMax:-2000,  zMin:-2500, zMax: -500 },
  festival:   { xMin:-3000, xMax:  500,  zMin:  500, zMax: 3000 },
  baja:       { xMin:-5000, xMax: -500,  zMin: -800, zMax: 1800 },
};

// ─── Seeded random ────────────────────────────────────────────────────────────

function _rng(seed) {
  let s = seed | 0;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

// ─── Terrain height guard ─────────────────────────────────────────────────────

function _safeH(x, z) {
  try { const h = getTerrainHeight(x, z); return (isFinite(h) && !isNaN(h)) ? h : 0; }
  catch { return 0; }
}

// ─── Build one instanced archetype ───────────────────────────────────────────

function _buildArchetype(arch, sceneRef) {
  const zone = ZONES[arch.zone];
  if (!zone) return;

  const [hw, hh, hd] = arch.geom;
  const bodyGeo = new THREE.BoxGeometry(hw*2, hh*2, hd*2);
  const roofGeo = new THREE.BoxGeometry(hw*2+0.4, 0.8, hd*2+0.4);
  const bodyMat = new THREE.MeshLambertMaterial({ color: arch.color   });
  const roofMat = new THREE.MeshLambertMaterial({ color: arch.roofClr });

  const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, arch.count);
  const roofMesh = new THREE.InstancedMesh(roofGeo, roofMat, arch.count);
  bodyMesh.castShadow = bodyMesh.receiveShadow = roofMesh.castShadow = true;
  bodyMesh.name = `inst_${arch.id}_body`;
  roofMesh.name = `inst_${arch.id}_roof`;

  const rand = _rng(arch.id.split('').reduce((a,c) => a + c.charCodeAt(0), 0));
  const dummy = new THREE.Object3D();
  const zoneW = zone.xMax - zone.xMin;
  const zoneD = zone.zMax - zone.zMin;
  const cols  = Math.ceil(Math.sqrt(arch.count * (zoneW / Math.max(zoneD,1))));
  const rows  = Math.ceil(arch.count / Math.max(cols, 1));

  let placed = 0;
  for (let row = 0; row < rows && placed < arch.count; row++) {
    for (let col = 0; col < cols && placed < arch.count; col++) {
      const tx = zone.xMin + (col / cols) * zoneW + (rand()-0.5)*arch.jitter*2;
      const tz = zone.zMin + (row / rows) * zoneD + (rand()-0.5)*arch.jitter*2;
      const ty = _safeH(tx, tz);
      const ry = rand() * Math.PI * 2;

      dummy.position.set(tx, ty + hh, tz);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(placed, dummy.matrix);

      dummy.position.set(tx, ty + hh*2 + 0.4, tz);
      dummy.updateMatrix();
      roofMesh.setMatrixAt(placed, dummy.matrix);

      placed++;
    }
  }

  bodyMesh.count = roofMesh.count = placed;
  bodyMesh.instanceMatrix.needsUpdate = roofMesh.instanceMatrix.needsUpdate = true;
  sceneRef.add(bodyMesh);
  sceneRef.add(roofMesh);
  _instanceGroups.push(bodyMesh, roofMesh);

  console.log(`[buildings] ${arch.id}: ${placed} instances`);
}

// ─── Initialisation ───────────────────────────────────────────────────────────

export async function initBuildings(sceneRef, worldRef) {
  // Build procedural instanced zones
  for (const arch of ARCHETYPES) _buildArchetype(arch, sceneRef);

  // Register enterable shops
  for (const bld of BUILDING_REGISTRY) {
    const groundY = _safeH(bld.position.x, bld.position.z);
    bld.position.y     = groundY;
    bld.doorPosition.y = groundY;
    bld.exitPosition.y = groundY;

    createBody({
      handle:      `bld_col_${bld.id}`,
      type:        'fixed',
      translation: { x: bld.position.x, y: groundY + bld.colliderSize.hy, z: bld.position.z },
      colliders:   [{ shape:'cuboid', args:[bld.colliderSize.hx, bld.colliderSize.hy, bld.colliderSize.hz] }],
    });
    createBody({
      handle:      `bld_sensor_${bld.id}`,
      type:        'fixed',
      translation: { x: bld.doorPosition.x, y: groundY + 1.0, z: bld.doorPosition.z },
      colliders:   [{ shape:'ball', args:[PROMPT_RADIUS], sensor:true }],
    });

    _spawnShopMesh(bld, groundY, sceneRef);
    _buildingState.set(bld.id, { promptVisible: false });
  }

  // Streetlights
  const preset = (() => { try { return localStorage.getItem('graphicsPreset')?? 'medium'; } catch { return 'medium'; }})();
  if (preset !== 'low') _seedStreetlights();

  _ready = true;
  console.log(`[buildings] Done — ${BUILDING_REGISTRY.length} shops, ${_instanceGroups.length} instanced meshes`);
}

// ─── Shop visible mesh ────────────────────────────────────────────────────────

function _shopColor(district) {
  return { festival:0xF0A020, guanajuato:0xD06040, baja:0x607080, riviera:0x40A0C0 }[district] ?? 0x888899;
}

function _spawnShopMesh(bld, groundY, sceneRef) {
  const { hx, hy, hz } = bld.colliderSize;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(hx*2, hy*2, hz*2),
    new THREE.MeshLambertMaterial({ color: _shopColor(bld.district) })
  );
  mesh.position.set(bld.position.x, groundY + hy, bld.position.z);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = `shop_${bld.id}`;

  if (bld.neonColor) {
    const panelMat = new THREE.MeshStandardMaterial({
      color: bld.neonColor, emissive: new THREE.Color(bld.neonColor), emissiveIntensity: 0,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(hx*1.2, 3), panelMat);
    panel.position.set(0, hy*0.4, hz+0.05);
    mesh.add(panel);
    _neonMeshes.push({ mesh: panel, baseIntensity: 2.5 });
  }
  sceneRef.add(mesh);
}

// ─── Entry triggers ───────────────────────────────────────────────────────────

export function checkEntryTriggers(avatarPos) {
  if (!_ready || _activeBuildingId) return null;
  let nearest = null, nearestDist = Infinity;
  for (const bld of BUILDING_REGISTRY) {
    const dx = avatarPos.x - bld.doorPosition.x;
    const dz = avatarPos.z - bld.doorPosition.z;
    const d  = Math.sqrt(dx*dx + dz*dz);
    if (d < PROMPT_RADIUS && d < nearestDist) { nearest = bld; nearestDist = d; }
  }
  _firePromptEvent(nearest, nearestDist);
  return nearest ? { building: nearest, distance: nearestDist } : null;
}

export async function enterBuilding(buildingId) {
  const bld = BUILDING_REGISTRY.find(b => b.id === buildingId);
  if (!bld) return;
  _activeBuildingId = buildingId;
  _interiorGroup    = _buildPlaceholderInterior(bld);
  GROUPS.world.add(_interiorGroup);
  if (bld.shopModule) {
    try { const m = await import(bld.shopModule); if(m.open) m.open(); if(m.show) m.show(); }
    catch(e) { console.warn('[buildings] shop module failed:', e); }
  }
}

export async function exitBuilding() {
  if (!_activeBuildingId) return null;
  const bld = BUILDING_REGISTRY.find(b => b.id === _activeBuildingId);
  if (bld?.shopModule) {
    try { const m = await import(bld.shopModule); if(m.close) m.close(); if(m.hide) m.hide(); }
    catch(_) {}
  }
  if (_interiorGroup) { GROUPS.world.remove(_interiorGroup); _disposeGroup(_interiorGroup); _interiorGroup = null; }
  const exitPos = bld?.exitPosition?.clone() ?? new THREE.Vector3();
  _activeBuildingId = null;
  return exitPos;
}

export function getActiveBuildingId() { return _activeBuildingId; }
export function onEnterPrompt(fn)     { _promptSubscribers.add(fn); }

let _lastPromptBldId = null;
function _firePromptEvent(building, distance) {
  const newId = building?.id ?? null;
  if (newId === _lastPromptBldId) return;
  _lastPromptBldId = newId;
  const payload = { visible:!!building, label: building?`Press E to enter ${building.label}`:null, distance: building?distance:null, canEnter: building?distance<=ENTER_RADIUS:false };
  for (const fn of _promptSubscribers) try { fn(payload); } catch(e) {}
}

// ─── Per-frame ────────────────────────────────────────────────────────────────

export function tickBuildings(dt, avatarPos) {
  if (!_ready) return;
  const night = isNight();
  const sorted = _streetlights.map(sl=>({sl, dist:avatarPos.distanceTo(sl.position)})).sort((a,b)=>a.dist-b.dist);
  for (let i=0; i<sorted.length; i++) {
    const {sl, dist} = sorted[i];
    const on = night && dist < STREETLIGHT_LOD_DIST && i < MAX_ACTIVE_LIGHTS;
    if (on && !sl.light) {
      sl.light = new THREE.PointLight(0xffeeaa, 1.2, STREETLIGHT_RANGE);
      sl.light.position.set(sl.position.x, sl.position.y + STREETLIGHT_HEIGHT, sl.position.z);
      scene.add(sl.light);
    } else if (!on && sl.light) {
      scene.remove(sl.light); sl.light.dispose?.(); sl.light = null;
    }
  }
  for (const n of _neonMeshes) {
    if (!n.mesh.material) continue;
    const target = n.baseIntensity * (night ? 1 : 0);
    n.mesh.material.emissiveIntensity += (target - n.mesh.material.emissiveIntensity) * Math.min(1, dt*3);
  }
}

// ─── Streetlight seeding ──────────────────────────────────────────────────────

function _seedStreetlights() {
  const H = 2000;
  for (const z of [-400,-200,0,200,400])
    for (let x=-H; x<=H; x+=STREETLIGHT_SPACING)
      _streetlights.push({ position: new THREE.Vector3(x, _safeH(x,z), z), light: null });
  for (const x of [-400,-200,0,200,400])
    for (let z=-H; z<=H; z+=STREETLIGHT_SPACING)
      _streetlights.push({ position: new THREE.Vector3(x, _safeH(x,z), z), light: null });
  console.log(`[buildings] ${_streetlights.length} streetlights seeded`);
}

// ─── Placeholder interior ─────────────────────────────────────────────────────

function _buildPlaceholderInterior(bld) {
  const g = new THREE.Group();
  g.name  = `interior_${bld.id}`;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20,20), new THREE.MeshLambertMaterial({color:0x333344}));
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; g.add(floor);
  const wm = new THREE.MeshLambertMaterial({color:0x222233});
  for (const wp of [{x:0,z:-10,ry:0},{x:0,z:10,ry:Math.PI},{x:-10,z:0,ry:Math.PI/2},{x:10,z:0,ry:-Math.PI/2}]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(20,8), wm);
    w.position.set(wp.x,4,wp.z); w.rotation.y=wp.ry; g.add(w);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(20,20), new THREE.MeshLambertMaterial({color:0x1a1a2e}));
  ceil.rotation.x=Math.PI/2; ceil.position.y=8; g.add(ceil);
  const li = new THREE.PointLight(0xffffff,0.8,30); li.position.set(0,6,0); g.add(li);
  g.position.copy(bld.interiorAnchor);
  return g;
}

function _disposeGroup(group) {
  group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());
  });
}

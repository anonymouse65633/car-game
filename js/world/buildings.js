/**
 * buildings.js — Building Colliders, Entry Triggers & Lighting
 * Part 1 / World layer
 *
 * Responsibilities:
 *  - BUILDING_REGISTRY: all enterable shop buildings (Type B) with door positions,
 *    shop IDs, interior scene paths, and entry prompt labels
 *  - Rapier sensor bodies for door trigger zones (2 m radius spheres)
 *  - Per-frame proximity check: avatarPos within any trigger → fire onEnterPrompt cb
 *  - Entry execution: teleport avatar to interior anchor + open shop UI
 *  - Exit handling: return avatar to street-side exit anchor
 *  - Streetlight point-light pool: LOD-gated, only rendered within 100 m
 *  - Neon sign emissive intensity driven by environment.isNight()
 *  - Type C framework: placeholder hooks for Phase 2 exploration buildings
 *
 * Exports:
 *  initBuildings(scene, world)          — async; registers all colliders & lights
 *  checkEntryTriggers(avatarPos)        — call each LATE tick; returns nearest trigger or null
 *  enterBuilding(buildingId)            — execute entry (called when player presses E)
 *  exitBuilding()                       — return player to street
 *  onEnterPrompt(fn)                    — subscribe to prompt-show/hide events
 *  tickBuildings(dt, avatarPos)         — LOD streetlight pool + neon fade
 *  getActiveBuildingId()                — returns shopId of currently entered building, or null
 *  BUILDING_REGISTRY                    — exported for minimap icon placement
 */

import * as THREE                    from 'three';
import { GLTFLoader }                from 'three/examples/jsm/loaders/GLTFLoader.js';
import { scene, GROUPS }             from '../engine/renderer.js';
import { createBody, removeBody }    from '../engine/physics.js';
import { isNight }                   from './environment.js';

// ─── Building Registry ────────────────────────────────────────────────────────

/**
 * All Type-B enterable buildings.
 *
 * Fields:
 *  id            — unique string, matches shopIds in DISTRICT_DATA
 *  label         — display name shown above door prompt
 *  district      — district id for minimap colouring
 *  position      — THREE.Vector3 world position of the building
 *  doorPosition  — THREE.Vector3 world position of the door trigger centre
 *  doorNormal    — THREE.Vector3 direction player faces when entering
 *  exitPosition  — where the avatar is placed when leaving
 *  shopModule    — dynamic import path for the shop UI module
 *  interiorFile  — GLB path for interior scene (null = flat room placeholder)
 *  interiorAnchor— THREE.Vector3 position inside the interior scene
 *  colliderSize  — { hx, hy, hz } half-extents for the building box collider
 *  type          — 'B' (enterable shop) | 'C' (Phase 2 exploration)
 *  neonColor     — optional hex for neon sign emissive colour (null = no neon)
 */
export const BUILDING_REGISTRY = Object.freeze([
  // ── Festival Hub — Airstrip festival tent complex ──────────────────────────
  {
    id: 'festival_hub',
    label: 'Festival Hub',
    district: 'festival',
    position:       new THREE.Vector3(-1500, 20,  1500),
    doorPosition:   new THREE.Vector3(-1500, 20,  1483),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(-1500, 20,  1480),
    shopModule:     '../ui/phoneMenu.js',
    interiorFile:   'assets/models/city/interiors/festival_hub.glb',
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 30, hy: 20, hz: 25 },
    type:           'B',
    neonColor:      0xff6600,
  },
  // ── Autoshow — Guanajuato showroom ────────────────────────────────────────
  {
    id: 'autoshow_main',
    label: 'Autoshow',
    district: 'guanajuato',
    position:       new THREE.Vector3(1800, 80, -1800),
    doorPosition:   new THREE.Vector3(1800, 80, -1783),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(1800, 80, -1780),
    shopModule:     '../shops/AutoShow.js',
    interiorFile:   'assets/models/city/interiors/autoshow.glb',
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 35, hy: 18, hz: 28 },
    type:           'B',
    neonColor:      0x00ccff,
  },
  // ── Parts Shop — Baja garage ──────────────────────────────────────────────
  {
    id: 'parts_shop_main',
    label: 'Parts Shop',
    district: 'baja',
    position:       new THREE.Vector3(-2000, 50,  800),
    doorPosition:   new THREE.Vector3(-2000, 50,  817),
    doorNormal:     new THREE.Vector3(0, 0,  1),
    exitPosition:   new THREE.Vector3(-2000, 50,  820),
    shopModule:     '../shops/partsShop.js',
    interiorFile:   'assets/models/city/interiors/parts_shop.glb',
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 25, hy: 12, hz: 20 },
    type:           'B',
    neonColor:      0xffaa00,
  },
  // ── Race HQ — Guanajuato race office ──────────────────────────────────────
  {
    id: 'race_hq',
    label: 'Race HQ',
    district: 'guanajuato',
    position:       new THREE.Vector3(1200, 80, -2200),
    doorPosition:   new THREE.Vector3(1200, 80, -2183),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(1200, 80, -2180),
    shopModule:     '../shops/raceHQ.js',
    interiorFile:   'assets/models/city/interiors/race_hq.glb',
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 22, hy: 14, hz: 18 },
    type:           'B',
    neonColor:      0xff2200,
  },
  // ── Clothing Boutique — Guanajuato colonial boutique ──────────────────────
  {
    id: 'clothing_boutique',
    label: 'Clothing',
    district: 'guanajuato',
    position:       new THREE.Vector3(1600, 80, -1600),
    doorPosition:   new THREE.Vector3(1600, 80, -1583),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(1600, 80, -1580),
    shopModule:     '../shops/ClothingShop.js',
    interiorFile:   'assets/models/city/interiors/clothing.glb',
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 14, hy: 10, hz: 12 },
    type:           'B',
    neonColor:      0xff66cc,
  },
  // ── Livery Shop — Guanajuato custom shop ──────────────────────────────────
  {
    id: 'livery_shop',
    label: 'Livery Shop',
    district: 'guanajuato',
    position:       new THREE.Vector3(1400, 80, -2000),
    doorPosition:   new THREE.Vector3(1400, 80, -1983),
    doorNormal:     new THREE.Vector3(0, 0, -1),
    exitPosition:   new THREE.Vector3(1400, 80, -1980),
    shopModule:     '../shops/LiveryShop.js',
    interiorFile:   'assets/models/city/interiors/livery.glb',
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 18, hy: 10, hz: 14 },
    type:           'B',
    neonColor:      0xcc44ff,
  },
  // ── Drag Strip — Festival airstrip ────────────────────────────────────────
  {
    id: 'drag_strip',
    label: 'Drag Strip',
    district: 'festival',
    position:       new THREE.Vector3(-1000, 20, 2000),
    doorPosition:   new THREE.Vector3(-1000, 20, 2017),
    doorNormal:     new THREE.Vector3(0, 0,  1),
    exitPosition:   new THREE.Vector3(-1000, 20, 2020),
    shopModule:     '../shops/raceHQ.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 20, hy: 8, hz: 16 },
    type:           'B',
    neonColor:      0xffdd00,
  },
  // ── Drift Arena — Festival arena ──────────────────────────────────────────
  {
    id: 'drift_arena',
    label: 'Drift Arena',
    district: 'festival',
    position:       new THREE.Vector3( -800, 20, 1800),
    doorPosition:   new THREE.Vector3( -800, 20, 1817),
    doorNormal:     new THREE.Vector3(0, 0,  1),
    exitPosition:   new THREE.Vector3( -800, 20, 1820),
    shopModule:     '../shops/raceHQ.js',
    interiorFile:   null,
    interiorAnchor: new THREE.Vector3(0, 0, 0),
    colliderSize:   { hx: 30, hy: 10, hz: 25 },
    type:           'B',
    neonColor:      0x00ff88,
  },
]);


// ─── Entry Trigger Config ─────────────────────────────────────────────────────

/** Distance (metres) at which the "Press E to enter" prompt appears. */
const PROMPT_RADIUS = 4.0;

/** Distance at which entry is actually allowed (stricter than prompt radius). */
const ENTER_RADIUS  = 2.2;

// ─── Streetlight Config ───────────────────────────────────────────────────────

/** Streetlight positions are procedurally distributed along road centrelines.
 *  In production these come from the city manifest; here we seed them. */
const STREETLIGHT_SPACING = 40;    // metres between lights
const STREETLIGHT_HEIGHT  = 8;     // metres
const STREETLIGHT_RANGE   = 30;    // Three.js PointLight range
const STREETLIGHT_LOD_DIST = 100;  // metres from camera to activate light
const MAX_ACTIVE_LIGHTS   = 24;    // GPU limit — only the nearest N lights on

// ─── Internal State ───────────────────────────────────────────────────────────

const _loader = new GLTFLoader();

/** Map< buildingId, { sensorHandle:string, mesh:THREE.Mesh|null } > */
const _buildingState = new Map();

/** Set of subscriber functions for prompt events. */
const _promptSubscribers = new Set();

/** Currently entered building id, or null. */
let _activeBuildingId = null;

/** Interior scene group currently mounted, or null. */
let _interiorGroup = null;

/** All streetlight definitions: { position:Vector3, light:PointLight|null } */
const _streetlights = [];

/** Neon sign meshes: { mesh:Mesh, baseIntensity:number } */
const _neonMeshes = [];

/** Whether initBuildings has completed. */
let _ready = false;

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * @param {THREE.Scene} sceneRef  — Same ref as renderer exports
 * @param {object}      worldRef  — Rapier world from physics.js
 */
export async function initBuildings(sceneRef, worldRef) {
  // Register physics colliders + sensor bodies for all buildings
  for (const bld of BUILDING_REGISTRY) {
    // Static box collider — prevents car/avatar walking through the building
    const colHandle = `bld_col_${bld.id}`;
    createBody({
      handle:      colHandle,
      type:        'fixed',
      translation: { x: bld.position.x, y: bld.colliderSize.hy, z: bld.position.z },
      colliders:   [{
        shape: 'cuboid',
        args:  [bld.colliderSize.hx, bld.colliderSize.hy, bld.colliderSize.hz],
      }],
    });

    // Sensor sphere at the door position — used for proximity checks
    const sensorHandle = `bld_sensor_${bld.id}`;
    createBody({
      handle:      sensorHandle,
      type:        'fixed',
      translation: { x: bld.doorPosition.x, y: 1.0, z: bld.doorPosition.z },
      colliders:   [{
        shape:    'ball',
        args:     [PROMPT_RADIUS],
        sensor:   true,
      }],
    });

    _buildingState.set(bld.id, { sensorHandle, colHandle, promptVisible: false });
  }

  // Seed streetlights along the main road grid
  _seedStreetlights();

  _ready = true;
  console.log(`[buildings] initBuildings() complete — ${BUILDING_REGISTRY.length} buildings registered.`);
}

// ─── Per-Frame Entry Check ────────────────────────────────────────────────────

/**
 * Check whether the avatar is near any building door.
 * Call from LATE-phase tick.
 *
 * @param {THREE.Vector3} avatarPos
 * @returns {{ building: object, distance: number } | null}
 *          Nearest triggerable building entry or null if none in range
 */
export function checkEntryTriggers(avatarPos) {
  if (!_ready || _activeBuildingId) return null; // Don't check while inside

  let nearest     = null;
  let nearestDist = Infinity;

  for (const bld of BUILDING_REGISTRY) {
    if (bld.type === 'C' && !bld.shopModule) continue; // Phase 2 - skip

    const dx   = avatarPos.x - bld.doorPosition.x;
    const dz   = avatarPos.z - bld.doorPosition.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < PROMPT_RADIUS && dist < nearestDist) {
      nearest     = bld;
      nearestDist = dist;
    }
  }

  // Fire prompt events to subscribers
  _firePromptEvent(nearest, nearestDist);

  return nearest ? { building: nearest, distance: nearestDist } : null;
}

/**
 * Execute building entry.  Call when the player presses E and checkEntryTriggers
 * returned a valid result.
 *
 * @param {string} buildingId
 */
export async function enterBuilding(buildingId) {
  const bld = BUILDING_REGISTRY.find(b => b.id === buildingId);
  if (!bld || bld.type === 'C') return;

  _activeBuildingId = buildingId;

  // Load interior GLB if one is defined
  if (bld.interiorFile) {
    try {
      const gltf = await _loadGLTF(bld.interiorFile);
      _interiorGroup = gltf.scene;
      _interiorGroup.position.copy(bld.interiorAnchor);
      GROUPS.world.add(_interiorGroup);
    } catch (err) {
      console.warn(`[buildings] Interior GLB failed for ${buildingId}:`, err);
      _interiorGroup = _buildPlaceholderInterior(bld);
      GROUPS.world.add(_interiorGroup);
    }
  } else {
    _interiorGroup = _buildPlaceholderInterior(bld);
    GROUPS.world.add(_interiorGroup);
  }

  // Dynamic-import the shop UI module and open it
  if (bld.shopModule) {
    try {
      const mod = await import(/* @vite-ignore */ bld.shopModule);
      if (mod.open)  mod.open();
      if (mod.show)  mod.show();
    } catch (err) {
      console.warn(`[buildings] Could not load shop module "${bld.shopModule}":`, err);
    }
  }

  console.log(`[buildings] Entered: ${bld.label}`);
}

/**
 * Exit the current building.  Teleports avatar back to the street exit anchor.
 * Returns the exit position so avatar.js can reposition the avatar mesh.
 *
 * @returns {THREE.Vector3 | null}
 */
export async function exitBuilding() {
  if (!_activeBuildingId) return null;

  const bld = BUILDING_REGISTRY.find(b => b.id === _activeBuildingId);

  // Close shop UI
  if (bld?.shopModule) {
    try {
      const mod = await import(/* @vite-ignore */ bld.shopModule);
      if (mod.close) mod.close();
      if (mod.hide)  mod.hide();
    } catch (_) { /* already unloaded */ }
  }

  // Remove interior scene
  if (_interiorGroup) {
    GROUPS.world.remove(_interiorGroup);
    _disposeGroup(_interiorGroup);
    _interiorGroup = null;
  }

  const exitPos = bld?.exitPosition?.clone() ?? new THREE.Vector3(0, 0, 0);
  _activeBuildingId = null;

  console.log(`[buildings] Exited building, returning to ${exitPos.toArray()}`);
  return exitPos;
}

/** @returns {string|null} */
export function getActiveBuildingId() {
  return _activeBuildingId;
}

// ─── Prompt Event Bus ─────────────────────────────────────────────────────────

/**
 * Subscribe to prompt show/hide events.
 * Callback receives: { visible:boolean, label:string|null, distance:number|null }
 *
 * @param {function} fn
 */
export function onEnterPrompt(fn) {
  _promptSubscribers.add(fn);
}

/** Previous prompt state — used to suppress duplicate events. */
let _lastPromptBldId = null;

function _firePromptEvent(building, distance) {
  const newId = building?.id ?? null;
  if (newId === _lastPromptBldId) return; // No change

  _lastPromptBldId = newId;
  const payload = {
    visible:  !!building,
    label:    building ? `Press E to enter ${building.label}` : null,
    distance: building ? distance : null,
    canEnter: building ? distance <= ENTER_RADIUS : false,
  };

  for (const fn of _promptSubscribers) {
    try { fn(payload); } catch (e) { console.warn('[buildings] prompt subscriber error', e); }
  }
}

// ─── Per-Frame Lighting & Neon ────────────────────────────────────────────────

/**
 * Update streetlight LOD pool and neon sign emissives.
 * Register on LOOP_PHASE.LATE in main.js.
 *
 * @param {number}        dt
 * @param {THREE.Vector3} avatarPos  — or camera position
 */
export function tickBuildings(dt, avatarPos) {
  if (!_ready) return;

  const night       = isNight();
  const nightFactor = night ? 1.0 : 0.0;

  // ── Streetlight LOD pool ─────────────────────────────────────────────────
  // Sort by distance, activate only the nearest MAX_ACTIVE_LIGHTS
  const sorted = _streetlights
    .map(sl => ({ sl, dist: avatarPos.distanceTo(sl.position) }))
    .sort((a, b) => a.dist - b.dist);

  for (let i = 0; i < sorted.length; i++) {
    const { sl, dist } = sorted[i];
    const shouldBeOn   = night && dist < STREETLIGHT_LOD_DIST && i < MAX_ACTIVE_LIGHTS;

    if (shouldBeOn && !sl.light) {
      // Activate light
      sl.light = new THREE.PointLight(0xffeeaa, 1.2, STREETLIGHT_RANGE);
      sl.light.position.copy(sl.position);
      sl.light.position.y = STREETLIGHT_HEIGHT;
      scene.add(sl.light);
    } else if (!shouldBeOn && sl.light) {
      // Deactivate light — remove from scene and free
      scene.remove(sl.light);
      sl.light.dispose?.();
      sl.light = null;
    }
  }

  // ── Neon sign emissives ──────────────────────────────────────────────────
  for (const neon of _neonMeshes) {
    if (!neon.mesh.material) continue;
    const target = neon.baseIntensity * nightFactor;
    // Smooth fade
    neon.mesh.material.emissiveIntensity +=
      (target - neon.mesh.material.emissiveIntensity) * Math.min(1, dt * 3);
  }
}

// ─── Streetlight Seeding ──────────────────────────────────────────────────────

/**
 * Procedurally place streetlights along the main east-west and north-south
 * road centrelines.  Production would load these from the city manifest.
 */
function _seedStreetlights() {
  const CITY_HALF = 2000;

  // East-West roads at Z = -400, -200, 0, 200, 400
  const zLines = [-400, -200, 0, 200, 400];
  for (const z of zLines) {
    for (let x = -CITY_HALF; x <= CITY_HALF; x += STREETLIGHT_SPACING) {
      _streetlights.push({ position: new THREE.Vector3(x, 0, z), light: null });
    }
  }

  // North-South roads at X = -400, -200, 0, 200, 400
  const xLines = [-400, -200, 0, 200, 400];
  for (const x of xLines) {
    for (let z = -CITY_HALF; z <= CITY_HALF; z += STREETLIGHT_SPACING) {
      _streetlights.push({ position: new THREE.Vector3(x, 0, z), light: null });
    }
  }

  console.log(`[buildings] Seeded ${_streetlights.length} streetlight positions.`);
}

// ─── Placeholder Interior ─────────────────────────────────────────────────────

/**
 * Build a simple flat room when no interior GLB is available.
 * Shop UI mounts on top of this as a DOM overlay so even the placeholder
 * looks functional.
 */
function _buildPlaceholderInterior(bld) {
  const group = new THREE.Group();
  group.name  = `interior_${bld.id}`;

  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.8 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.9 });
  const wallPositions = [
    { x: 0,    z: -10, ry: 0         },
    { x: 0,    z:  10, ry: Math.PI   },
    { x: -10,  z: 0,   ry:  Math.PI / 2 },
    { x:  10,  z: 0,   ry: -Math.PI / 2 },
  ];
  for (const wp of wallPositions) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 8), wallMat);
    wall.position.set(wp.x, 4, wp.z);
    wall.rotation.y = wp.ry;
    group.add(wall);
  }

  // Ceiling
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x1a1a2e })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 8;
  group.add(ceiling);

  // Ambient interior light
  const intLight = new THREE.PointLight(0xffffff, 0.8, 30);
  intLight.position.set(0, 6, 0);
  group.add(intLight);

  // Position group at interior anchor
  group.position.copy(bld.interiorAnchor);

  return group;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _loadGLTF(url) {
  return new Promise((resolve, reject) => {
    _loader.load(url, resolve, undefined, reject);
  });
}

function _disposeGroup(group) {
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      (Array.isArray(obj.material) ? obj.material : [obj.material])
        .forEach(m => m.dispose());
    }
  });
}

/**
 * city.js — Horizon City World
 * Part 1 / World layer
 *
 * Responsibilities:
 *  - DISTRICT_DATA: definitions for all 6 districts (bounds, road type, colour, name)
 *  - City chunk streaming: only nearby chunks are loaded (3×3 grid around player)
 *  - Per-chunk LOD: < 150 m = full mesh, 150–300 m = simplified, > 300 m = billboard sprite
 *  - Road network: single merged BufferGeometry for efficiency
 *  - Building instance pool: Three.js InstancedMesh per building archetype
 *  - Chunk collision bodies via Rapier trimesh (registered with physics.js)
 *  - Fog & draw-distance management that environment.js can override
 *  - Fast travel anchor positions
 *
 * Exports:
 *  initCity(scene, world)           — async; loads manifest, seeds chunks around origin
 *  updateChunks(playerPos)          — call each frame from loop; streams in/out chunks
 *  getDistrictAt(x, z)              — returns DISTRICT_DATA entry for a world position
 *  getRoadSurface(x, z)             — returns { grip, type } for tyre physics
 *  getFastTravelPoints()            — array of { id, label, position }
 *  DISTRICT_DATA                    — exported constant, used by minimap & map.js
 *  CITY_BOUNDS                      — { minX, maxX, minZ, maxZ } for map clamping
 *  CHUNK_SIZE                       — metres per chunk side (exported for minimap)
 */

import * as THREE from 'three';
import { GLTFLoader }    from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { scene, GROUPS } from '../engine/renderer.js';
import { createBody, removeBody } from '../engine/physics.js';

// ─── Shared Material Pool ─────────────────────────────────────────────────────
// ONE material per district color — never create materials inside loops.
// Map<colorHex:string, THREE.Material>
const _matPool = new Map();

function _getPooledMat(colorHex, flat) {
  const key = `${colorHex}_${flat ? 'L' : 'S'}`;
  if (_matPool.has(key)) return _matPool.get(key);
  const color = new THREE.Color(colorHex);
  const mat   = flat
    ? new THREE.MeshLambertMaterial({ color })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.0 });
  _matPool.set(key, mat);
  return mat;
}

// ─── District Definitions ────────────────────────────────────────────────────

/**
 * Each district owns a rectangular region of the 4 km × 4 km map.
 * Origin (0,0) is the map centre.  All values in metres.
 *
 * Fields:
 *  id          — unique key used throughout the codebase
 *  name        — display name
 *  color       — hex colour used on minimap / full map
 *  bounds      — { x1, z1, x2, z2 }  (min/max corners)
 *  roadType    — default road surface type for tyre grip
 *  ambientTag  — audio.js uses this to pick the ambient sound bed
 *  shopIds     — shop IDs that spawn in this district
 *  raceTier    — race difficulty / speed class (for RaceSetupScreen filtering)
 *  landmark    — { id, label, position: THREE.Vector3 }
 */
export const DISTRICT_DATA = Object.freeze([
  // ── Guanajuato — colonial hilltop city, warm tarmac streets ───────────────
  {
    id:         'guanajuato',
    name:       'Guanajuato',
    color:      '#e8a020',
    bounds:     { x1: 500,   z1: -3000, x2: 3000,  z2: -1000 },
    roadType:   'smooth_tarmac',
    ambientTag: 'city',
    shopIds:    ['autoshow_main', 'clothing_boutique', 'livery_shop', 'race_hq'],
    raceTier:   'C',
    landmark: {
      id:       'guanajuato_cathedral',
      label:    'Guanajuato Cathedral',
      position: new THREE.Vector3(1800, 80, -2200),
    },
  },
  // ── Gran Caldera — active volcano, volcanic dirt roads, extreme elevation ──
  {
    id:         'caldera',
    name:       'Gran Caldera',
    color:      '#8b3a00',
    bounds:     { x1: 1500,  z1: -5000, x2: 5000,  z2: -2500 },
    roadType:   'volcanic_dirt',
    ambientTag: 'volcano',
    shopIds:    [],
    raceTier:   'A',
    landmark: {
      id:       'caldera_summit',
      label:    'Caldera Summit',
      position: new THREE.Vector3(3500, 800, -4000),
    },
  },
  // ── Riviera Maya — beach hotels, marina, flat sea-level tarmac ───────────
  {
    id:         'riviera',
    name:       'Riviera Maya',
    color:      '#00bfff',
    bounds:     { x1: 2500,  z1: -2500, x2: 5000,  z2:  500 },
    roadType:   'smooth_tarmac',
    ambientTag: 'beach',
    shopIds:    ['drag_strip'],
    raceTier:   'B',
    landmark: {
      id:       'riviera_lighthouse',
      label:    'Riviera Lighthouse',
      position: new THREE.Vector3(4200, 20, -1200),
    },
  },
  // ── Dunas Blancas — white sand dunes, loose surface ──────────────────────
  {
    id:         'dunas',
    name:       'Dunas Blancas',
    color:      '#f5deb3',
    bounds:     { x1: -5000, z1: -4000, x2: -1000, z2: -1000 },
    roadType:   'sand',
    ambientTag: 'dunes',
    shopIds:    [],
    raceTier:   'B',
    landmark: {
      id:       'dunas_crest',
      label:    'Dunas Crest',
      position: new THREE.Vector3(-3200, 120, -2600),
    },
  },
  // ── Baja Desert — dry scrub, mesa plateaus, dirt tracks ──────────────────
  {
    id:         'baja',
    name:       'Baja Desert',
    color:      '#c8a060',
    bounds:     { x1: -5000, z1: -1000, x2: -500,  z2: 2000 },
    roadType:   'dirt',
    ambientTag: 'desert',
    shopIds:    ['parts_shop_main'],
    raceTier:   'B',
    landmark: {
      id:       'baja_mesa',
      label:    'Baja Mesa',
      position: new THREE.Vector3(-3800, 120, 600),
    },
  },
  // ── Expedición Farmland — flat green fields, narrow country lanes ─────────
  {
    id:         'farmland',
    name:       'Expedición',
    color:      '#5a8a30',
    bounds:     { x1: -500,  z1: -2000, x2: 2500,  z2: 1500 },
    roadType:   'narrow_tarmac',
    ambientTag: 'countryside',
    shopIds:    [],
    raceTier:   'C',
    landmark: {
      id:       'farmland_windmill',
      label:    'Farmland Windmill',
      position: new THREE.Vector3(800, 10, -400),
    },
  },
  // ── Festival Grounds — airstrip, tents, race tarmac ──────────────────────
  {
    id:         'festival',
    name:       'Festival Grounds',
    color:      '#ff4500',
    bounds:     { x1: -3000, z1:  500,  x2:  500,  z2: 3000 },
    roadType:   'race_tarmac',
    ambientTag: 'festival',
    shopIds:    ['festival_hub', 'drift_arena', 'drag_strip_airstrip'],
    raceTier:   'D',
    landmark: {
      id:       'airstrip_tower',
      label:    'Airstrip Control Tower',
      position: new THREE.Vector3(-1500, 20, 1500),
    },
  },
  // ── La Selva — dense jungle, muddy undulating tracks ─────────────────────
  {
    id:         'jungle',
    name:       'La Selva',
    color:      '#2d6a2d',
    bounds:     { x1:  500,  z1: 1000,  x2: 3500,  z2: 4000 },
    roadType:   'muddy',
    ambientTag: 'jungle',
    shopIds:    [],
    raceTier:   'B',
    landmark: {
      id:       'jungle_temple',
      label:    'Jungle Temple Ruin',
      position: new THREE.Vector3(1800, 30, 3200),
    },
  },
  // ── Highway Ring — outer loop tying all zones together ───────────────────
  {
    id:         'highway',
    name:       'Highway Ring',
    color:      '#444444',
    bounds:     { x1: -5000, z1: -5000, x2: 5000,  z2: 5000 },
    roadType:   'highway',
    ambientTag: 'outskirts',
    shopIds:    [],
    raceTier:   'A',
    landmark: {
      id:       'canyon_overlook',
      label:    'Canyon Overlook',
      position: new THREE.Vector3(-800, 200, -1600),
    },
  },
]);

/** Grip coefficients keyed by roadType, used by suspension / tyre model. */
const ROAD_GRIP = Object.freeze({
  smooth_tarmac:  1.00,
  race_tarmac:    1.10,
  highway:        0.95,
  narrow_tarmac:  0.90,
  mixed:          0.75,
  gravel:         0.55,
  concrete:       0.80,
  dirt:           0.50,
  wet_tarmac:     0.65,   // environment.js swaps this in during rain
  volcanic_dirt:  0.45,   // loose volcanic gravel, very slippy
  sand:           0.38,   // deep Dunas sand — very low grip
  muddy:          0.42,   // jungle mud — low grip, high drag
});

// ─── City Constants ───────────────────────────────────────────────────────────

/** Full map extents in metres. */
export const CITY_BOUNDS = Object.freeze({ minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 });

/** Side length of one streaming chunk in metres. */
export const CHUNK_SIZE = 500;

/** How many chunks each side to keep loaded around the player.
 *  Low = 1 (3×3 = 9 chunks), Medium = 1, High+ = 2 (5×5 = 25 chunks) */
const _CITY_PRESET    = (() => { try { return localStorage.getItem('graphicsPreset') ?? 'low'; } catch { return 'low'; } })();
const STREAM_RADIUS   = (_CITY_PRESET === 'low' || _CITY_PRESET === 'medium') ? 1 : 2;
/** True when we should use flat/Lambert materials instead of PBR */
const _FLAT_MATERIALS = (_CITY_PRESET === 'low');

/** Distance at which a chunk switches to simplified LOD mesh. */
const LOD_NEAR = 150;

/** Distance at which a chunk switches to billboard sprite. */
const LOD_FAR  = 300;

/** Y-range of building instances — used for clipping off-camera objects. */
const BUILDING_HEIGHT_MAX = 250;

// ─── Fast Travel Points ───────────────────────────────────────────────────────

const _FAST_TRAVEL = Object.freeze([
  { id: 'ft_festival',      label: 'Festival Grounds',       position: new THREE.Vector3(-1500,  20,  1500) },
  { id: 'ft_guanajuato',    label: 'Guanajuato Plaza',       position: new THREE.Vector3( 1800,  80, -2000) },
  { id: 'ft_caldera',       label: 'Caldera Summit',         position: new THREE.Vector3( 3500, 800, -4000) },
  { id: 'ft_dunas',         label: 'Dunas Lookout',          position: new THREE.Vector3(-3200, 120, -2600) },
  { id: 'ft_riviera',       label: 'Riviera Marina',         position: new THREE.Vector3( 3800,   5,  -800) },
  { id: 'ft_jungle',        label: 'Jungle Outpost',         position: new THREE.Vector3( 1800,  30,  3200) },
  { id: 'ft_baja',          label: 'Baja Crossroads',        position: new THREE.Vector3(-3000,  60,   400) },
  { id: 'ft_farmland',      label: 'Farmland Hub',           position: new THREE.Vector3(  800,  10,  -400) },
  { id: 'ft_canyon',        label: 'Canyon Overlook',        position: new THREE.Vector3( -800, 200, -1600) },
  { id: 'ft_airstrip',      label: 'Airstrip',               position: new THREE.Vector3(-2000,  20,  1600) },
]);

export function getFastTravelPoints() {
  return [..._FAST_TRAVEL];
}

// ─── Internal State ───────────────────────────────────────────────────────────

/** GLTF loader shared across all chunk loads. */
const _loader = new GLTFLoader();

/**
 * Active chunk registry.
 * Map< chunkKey:string, { group:THREE.Group, physicsHandle:string|null, lod:number } >
 */
const _chunks = new Map();

/** Building instance pool — one InstancedMesh per archetype ID. */
const _instancedMeshes = new Map();

/** Chunk asset manifest — loaded once from assets/city/manifest.json */
let _manifest = null;

/** Last chunk coords the player was in — used to skip redundant update calls. */
let _lastPlayerChunk = { cx: null, cz: null };

/** Reference to THREE.Scene — stored by initCity. */
let _scene = null;

/** Reference to Rapier world handle — stored by initCity. */
let _world = null;

/** Whether initCity has completed. */
let _ready = false;

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Initialise the city system.
 *
 * @param {THREE.Scene} scene  — The Three.js scene (same ref as renderer.js exports)
 * @param {object}      world  — Rapier world reference from physics.js
 */
export async function initCity(scene, world) {
  _scene = scene;
  _world = world;

  // Load chunk manifest (lists available GLB files, LOD variants, instance data)
  try {
    const res = await fetch('assets/city/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _manifest = await res.json();
    console.log(`[city] Manifest loaded — ${_manifest.chunks.length} chunks, ${_manifest.archetypes.length} building archetypes.`);
  } catch (err) {
    console.warn('[city] Manifest not found — running in procedural placeholder mode.', err);
    _manifest = _buildPlaceholderManifest();
  }

  // Pre-allocate InstancedMeshes for each building archetype
  _initInstancedMeshes();

  // Prime the road surface merged mesh (visible from the start)
  _buildRoadMesh();

  // Load the initial 3×3 chunk grid around the world origin
  await _streamChunks(0, 0, true);

  _ready = true;
  console.log('[city] initCity() complete.');
}

// ─── Per-Frame Streaming ──────────────────────────────────────────────────────

/**
 * Call every frame (onTick LATE phase) with the player's world-space position.
 * Streams in chunks that just entered range, streams out chunks that left range,
 * and updates LOD for all visible chunks.
 *
 * @param {THREE.Vector3} playerPos
 */
export function updateChunks(playerPos) {
  if (!_ready) return;

  const cx = Math.floor(playerPos.x / CHUNK_SIZE);
  const cz = Math.floor(playerPos.z / CHUNK_SIZE);

  // Skip if player hasn't crossed a chunk boundary
  if (cx === _lastPlayerChunk.cx && cz === _lastPlayerChunk.cz) {
    _updateLOD(playerPos); // Still update LOD even if chunk coords unchanged
    return;
  }

  _lastPlayerChunk = { cx, cz };
  _streamChunks(cx, cz, false);
  _updateLOD(playerPos);
}

/**
 * Determine which chunks should be active for a given chunk coordinate,
 * load new ones, unload old ones.
 *
 * @param {number}  cx     — Player's chunk X index
 * @param {number}  cz     — Player's chunk Z index
 * @param {boolean} await_ — If true, returns a promise that resolves when all loads complete
 */
async function _streamChunks(cx, cz, await_) {
  const needed = new Set();

  for (let dx = -STREAM_RADIUS; dx <= STREAM_RADIUS; dx++) {
    for (let dz = -STREAM_RADIUS; dz <= STREAM_RADIUS; dz++) {
      needed.add(_chunkKey(cx + dx, cz + dz));
    }
  }

  // Unload chunks that are no longer needed
  for (const key of _chunks.keys()) {
    if (!needed.has(key)) _unloadChunk(key);
  }

  // Collect which chunks need loading
  const toLoad = [];
  for (const key of needed) {
    if (!_chunks.has(key)) toLoad.push(key);
  }

  if (!await_) {
    // Normal mid-game streaming: fire all loads in parallel (non-blocking)
    for (const key of toLoad) _loadChunk(key);
    return;
  }

  // ── Boot path: load chunks ONE AT A TIME, yielding between each ────────────
  // Each yield (setTimeout 0) hands control back to the browser event loop so
  // Chrome can process input and avoid the "page unresponsive" dialog.
  // The loading screen stays visible until boot() hides it after all awaits.
  const loadingEl = document.getElementById('hc-loading-screen');
  for (let i = 0; i < toLoad.length; i++) {
    const key = toLoad[i];
    if (loadingEl) loadingEl.querySelector('span').textContent =
      `HORIZON CITY — Loading world (${i + 1}/${toLoad.length})…`;
    await _loadChunk(key);
    // Yield to browser between each chunk — prevents main-thread freeze
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

// ─── Chunk Load / Unload ──────────────────────────────────────────────────────

async function _loadChunk(key) {
  const { cx, cz } = _parseChunkKey(key);
  const worldX = cx * CHUNK_SIZE;
  const worldZ = cz * CHUNK_SIZE;

  // Register a placeholder entry immediately so duplicate loads don't race
  const placeholder = {
    group:         null,
    physicsHandle: null,
    lod:           0,
    loading:       true,
  };
  _chunks.set(key, placeholder);

  // Find this chunk in the manifest
  const chunkDef = _manifest?.chunks.find(c => c.cx === cx && c.cz === cz);

  const group = new THREE.Group();
  group.name  = `chunk_${key}`;
  group.position.set(worldX, 0, worldZ);
  GROUPS.world.add(group);

  if (chunkDef && chunkDef.file) {
    // --- Real asset path ---
    try {
      const gltf = await _loadGLTF(`assets/city/${chunkDef.file}`);
      group.add(gltf.scene);

      // Register trimesh physics collider for this chunk's static geometry
      const handle = `chunk_${key}_col`;
      _registerChunkCollider(gltf.scene, handle, worldX, worldZ);
      placeholder.physicsHandle = handle;
    } catch (err) {
      console.warn(`[city] Failed to load chunk ${key}:`, err);
      _buildPlaceholderChunk(group, cx, cz);
    }
  } else {
    // --- No GLB for this chunk — build a coloured procedural placeholder ---
    _buildPlaceholderChunk(group, cx, cz);
  }

  // Populate building instances for this chunk
  _populateBuildingInstances(cx, cz, chunkDef);

  placeholder.group   = group;
  placeholder.loading = false;

  _chunks.set(key, placeholder);
}

function _unloadChunk(key) {
  const chunk = _chunks.get(key);
  if (!chunk) return;

  if (chunk.group) {
    GROUPS.world.remove(chunk.group);
    _disposeGroup(chunk.group);
  }

  if (chunk.physicsHandle) {
    removeBody(chunk.physicsHandle);
  }

  _chunks.delete(key);
}

// ─── LOD Management ──────────────────────────────────────────────────────────

function _updateLOD(playerPos) {
  for (const [, chunk] of _chunks) {
    if (!chunk.group || chunk.loading) continue;

    const dist = playerPos.distanceTo(chunk.group.position);
    const newLod = dist < LOD_NEAR ? 0 : dist < LOD_FAR ? 1 : 2;

    if (newLod !== chunk.lod) {
      chunk.lod = newLod;
      _applyLOD(chunk.group, newLod);
    }
  }
}

/**
 * Switch visible child by LOD level.
 * Convention: chunk GLTFs have three children named 'lod0', 'lod1', 'lod2'.
 * Placeholder chunks only have lod0.
 */
function _applyLOD(group, level) {
  for (const child of group.children) {
    const lodIndex = parseInt(child.name.replace('lod', ''), 10);
    if (!isNaN(lodIndex)) {
      child.visible = (lodIndex === level);
    }
  }
}

// ─── Road Mesh ────────────────────────────────────────────────────────────────

// ─── FH5 Biome Ground Colour Map ─────────────────────────────────────────────
// Maps district ID → hex colour matching FH5 Mexico ground tones
const BIOME_GROUND_COLORS = {
  guanajuato: '#8c7355',   // warm cobblestone
  caldera:    '#3d2b1a',   // volcanic rock dark
  riviera:    '#c4b090',   // pale sandy coastal
  dunas:      '#d4c49a',   // Dunas Blancas sand
  baja:       '#c4956a',   // arid sandy desert
  farmland:   '#7a9e5c',   // green Mexican farmland
  festival:   '#404040',   // airstrip tarmac
  jungle:     '#2d5a1b',   // dense jungle floor
  highway:    '#282828',   // dark asphalt
};

/**
 * Build per-district road/ground meshes with FH5 biome colours.
 * Each district gets its own plane so materials can differ.
 */
function _buildRoadMesh() {
  // One merged base + per-district colour overlays
  // First: dark highway base (fills undistricted areas)
  const baseGeo = new THREE.PlaneGeometry(12000, 12000, 1, 1);
  baseGeo.rotateX(-Math.PI / 2);
  const baseMat = _getPooledMat('#1a1a1a', _FLAT_MATERIALS);
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.name = 'road_base';
  baseMesh.receiveShadow = !_FLAT_MATERIALS;
  baseMesh.position.set(0, -0.05, 0);
  GROUPS.world.add(baseMesh);

  // Per-district coloured ground planes
  for (const district of DISTRICT_DATA) {
    if (district.id === 'highway') continue; // already covered by base
    const { x1, z1, x2, z2 } = district.bounds;
    const w = x2 - x1;
    const d = z2 - z1;
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const colorHex = BIOME_GROUND_COLORS[district.id] ?? '#555555';
    const mat = _getPooledMat(colorHex, _FLAT_MATERIALS);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `ground_${district.id}`;
    mesh.receiveShadow = !_FLAT_MATERIALS;
    // Centre the plane on the district bounds, very slightly above highway base
    mesh.position.set((x1 + x2) / 2, -0.02, (z1 + z2) / 2);
    GROUPS.world.add(mesh);
  }

  // Guanajuato cobblestone overlay (warm grey-brown, slightly raised)
  const guaDist = DISTRICT_DATA.find(d => d.id === 'guanajuato');
  if (guaDist) {
    const { x1, z1, x2, z2 } = guaDist.bounds;
    const geo = new THREE.PlaneGeometry(x2 - x1, z2 - z1, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = _getPooledMat('#7a6e60', _FLAT_MATERIALS); // cobblestone
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'road_guanajuato_cobble';
    mesh.position.set((x1 + x2) / 2, 0.01, (z1 + z2) / 2);
    GROUPS.world.add(mesh);
  }
}

// ─── Building Instances ───────────────────────────────────────────────────────

function _initInstancedMeshes() {
  if (!_manifest?.archetypes) return;

  for (const arch of _manifest.archetypes) {
    // Placeholder geometry until GLBs load — replaced by _populateBuildingInstances
    const geo  = new THREE.BoxGeometry(arch.w || 20, arch.h || 40, arch.d || 20);
    // Use shared material pool — never create a new material per archetype
    const colorVal = typeof arch.color === 'string' ? parseInt(arch.color) : (arch.color || 0x556677);
    const colorHex = '#' + colorVal.toString(16).padStart(6, '0');
    const mat  = _getPooledMat(colorHex, _FLAT_MATERIALS);
    const mesh = new THREE.InstancedMesh(geo, mat, arch.maxInstances || 256);
    mesh.name         = `inst_${arch.id}`;
    mesh.castShadow   = true;
    mesh.receiveShadow = true;
    mesh.count        = 0; // Will be filled per chunk
    GROUPS.world.add(mesh);
    _instancedMeshes.set(arch.id, mesh);
  }
}

function _populateBuildingInstances(cx, cz, chunkDef) {
  if (!chunkDef?.buildings) return;

  const dummy = new THREE.Object3D();

  for (const bld of chunkDef.buildings) {
    const mesh = _instancedMeshes.get(bld.archetypeId);
    if (!mesh) continue;

    const idx = mesh.count;
    if (idx >= mesh.instanceMatrix.count) continue; // Pool exhausted

    dummy.position.set(bld.x, bld.y ?? 0, bld.z);
    dummy.rotation.y = bld.ry ?? 0;
    dummy.scale.set(bld.sx ?? 1, bld.sy ?? 1, bld.sz ?? 1);
    dummy.updateMatrix();

    mesh.setMatrixAt(idx, dummy.matrix);
    mesh.count++;
    mesh.instanceMatrix.needsUpdate = true;
  }
}

// ─── Physics Collider ─────────────────────────────────────────────────────────

function _registerChunkCollider(gltfScene, handle, worldX, worldZ) {
  // Collect all mesh geometry from the GLTF for trimesh collider
  const positions = [];
  const indices   = [];
  let   indexOffset = 0;

  gltfScene.traverse(obj => {
    if (!obj.isMesh) return;
    const geo = obj.geometry;
    if (!geo.index) return;

    const pos = geo.attributes.position.array;
    const idx = geo.index.array;

    // Transform local verts to world space (simple translation for root-level chunks)
    for (let i = 0; i < pos.length; i += 3) {
      positions.push(pos[i] + worldX, pos[i + 1], pos[i + 2] + worldZ);
    }
    for (let i = 0; i < idx.length; i++) {
      indices.push(idx[i] + indexOffset);
    }
    indexOffset += pos.length / 3;
  });

  if (positions.length === 0) return;

  createBody({
    handle,
    type: 'fixed',
    colliders: [{
      shape:     'trimesh',
      vertices:  new Float32Array(positions),
      indices:   new Uint32Array(indices),
    }],
    translation: { x: 0, y: 0, z: 0 },
  });
}

// ─── Public Queries ───────────────────────────────────────────────────────────

/**
 * Return the district definition for a given world-space XZ coordinate.
 * Falls back to 'outskirts' if outside all district bounds.
 *
 * @param {number} x
 * @param {number} z
 * @returns {object} — One entry from DISTRICT_DATA
 */
export function getDistrictAt(x, z) {
  for (const d of DISTRICT_DATA) {
    if (x >= d.bounds.x1 && x <= d.bounds.x2 &&
        z >= d.bounds.z1 && z <= d.bounds.z2) {
      return d;
    }
  }
  // Default to highway (was 'outskirts') for areas outside district polygons
  return DISTRICT_DATA.find(d => d.id === 'highway') ?? DISTRICT_DATA[0];
}

/**
 * Return road surface properties at a given world-space XZ coordinate.
 * driving.js / suspension.js call this each frame to get grip multiplier.
 *
 * @param {number} x
 * @param {number} z
 * @returns {{ grip: number, type: string }}
 */
export function getRoadSurface(x, z) {
  const district  = getDistrictAt(x, z);
  const roadType  = district.roadType;
  const grip      = ROAD_GRIP[roadType] ?? 0.80;
  return { grip, type: roadType };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function _parseChunkKey(key) {
  const [cx, cz] = key.split(',').map(Number);
  return { cx, cz };
}

function _loadGLTF(url) {
  return new Promise((resolve, reject) => {
    _loader.load(url, resolve, undefined, reject);
  });
}

function _disposeGroup(group) {
  group.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}

// ─── Placeholder Helpers (dev / asset-free mode) ──────────────────────────────

/**
 * Build a bare-minimum manifest when the real one isn't available.
 * This lets the game boot and render a coloured block city so rendering
 * and physics can be tested before assets exist.
 */
function _buildPlaceholderManifest() {
  const chunks = [];
  for (let cx = -10; cx <= 10; cx++) {
    for (let cz = -10; cz <= 10; cz++) {
      chunks.push({ cx, cz, file: null, buildings: [] });
    }
  }
  return { chunks, archetypes: [] };
}

/**
 * Build chunk placeholder geometry with FH5-accurate biome colours.
 * Guanajuato: 7-colour colonial palette, height variance 6–28m, flat parapets, street gaps.
 */
function _buildPlaceholderChunk(group, cx, cz) {
  const worldX = cx * CHUNK_SIZE;
  const worldZ = cz * CHUNK_SIZE;

  const district  = getDistrictAt(worldX + CHUNK_SIZE / 2, worldZ + CHUNK_SIZE / 2);
  const isGua     = district.id === 'guanajuato';
  const isCaldera = district.id === 'caldera';
  const isJungle  = district.id === 'jungle';

  // FH5 Guanajuato 7-colour colonial palette
  const GUA_PALETTE = [
    '#e8a020', '#d4472a', '#e8c44a',
    '#2a8060', '#c44a7a', '#f0e8d0', '#6a4aaa',
  ];

  // Biome-accurate ground colour
  const groundColorHex = BIOME_GROUND_COLORS[district.id]
    ?? '#' + new THREE.Color(district.color).multiplyScalar(0.42).getHexString();
  const groundMat = _getPooledMat(groundColorHex, _FLAT_MATERIALS);

  const lod0 = new THREE.Group(); lod0.name = 'lod0';
  const lod1 = new THREE.Group(); lod1.name = 'lod1'; lod1.visible = false;
  const lod2 = new THREE.Group(); lod2.name = 'lod2'; lod2.visible = false;

  const groundGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = !_FLAT_MATERIALS;
  ground.position.set(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2);
  lod0.add(ground);
  lod1.add(ground.clone());

  const RNG_SEED = (cx * 73856093) ^ (cz * 19349663);
  const rng = _seededRNG(RNG_SEED);

  // Building density per district
  const densityMap = { guanajuato: 8, riviera: 5, jungle: 3, farmland: 3, festival: 2, baja: 1 };
  const count = isCaldera ? 0 : (densityMap[district.id] ?? 3) + Math.floor(rng() * 3);

  const bldGeos = [];

  for (let i = 0; i < count; i++) {
    let w, h, d, bx, bz;
    let wallColor;

    if (isGua) {
      // FH5 Guanajuato: colonial proportions, 6–28m heights, narrow lots
      w = 8  + rng() * 14;
      h = 6  + rng() * 22;
      d = 8  + rng() * 14;

      // Street gap: place in one of 4 quadrants around 8m cross-shaped street
      const halfC = CHUNK_SIZE / 2;
      const sGap  = 4; // half of 8m street width
      const qx    = rng() > 0.5 ? 1 : 0;
      const qz    = rng() > 0.5 ? 1 : 0;
      const minX  = qx === 0 ? 5         : halfC + sGap + 2;
      const maxX  = qx === 0 ? halfC - sGap - w - 2 : CHUNK_SIZE - w - 5;
      const minZ  = qz === 0 ? 5         : halfC + sGap + 2;
      const maxZ  = qz === 0 ? halfC - sGap - d - 2 : CHUNK_SIZE - d - 5;
      bx = minX + rng() * Math.max(1, maxX - minX);
      bz = minZ + rng() * Math.max(1, maxZ - minZ);

      // Seeded colour — adjacent buildings always different (palette index cycles)
      const palIdx = (i * 3 + Math.floor(rng() * 2)) % GUA_PALETTE.length;
      wallColor = GUA_PALETTE[palIdx];
    } else {
      w = 12 + rng() * 24;
      h = 10 + rng() * 60;
      d = 12 + rng() * 24;
      bx = 20 + rng() * (CHUNK_SIZE - 40);
      bz = 20 + rng() * (CHUNK_SIZE - 40);
      wallColor = '#' + new THREE.Color(district.color).multiplyScalar(0.68).getHexString();
    }

    if (_FLAT_MATERIALS) {
      const wallMat = _getPooledMat(wallColor, true);
      const wallGeo = new THREE.BoxGeometry(w, h, d);
      wallGeo.translate(bx, h / 2, bz);
      const wallMesh = new THREE.Mesh(wallGeo, wallMat);
      lod0.add(wallMesh);

      if (isGua) {
        // Flat roof parapet — slightly darker, makes it read as colonial architecture
        const parHex = '#' + new THREE.Color(wallColor).multiplyScalar(0.72).getHexString();
        const parMat = _getPooledMat(parHex, true);
        const parGeo = new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5);
        parGeo.translate(bx, h + 0.25, bz);
        lod0.add(new THREE.Mesh(parGeo, parMat));
      }
    } else {
      const wallMat = _getPooledMat(wallColor, false);
      const bldGeo  = new THREE.BoxGeometry(w, h, d);
      const bldMesh = new THREE.Mesh(bldGeo, wallMat);
      bldMesh.castShadow    = true;
      bldMesh.receiveShadow = true;
      bldMesh.position.set(bx, h / 2, bz);
      lod0.add(bldMesh);

      if (isGua) {
        const parHex  = '#' + new THREE.Color(wallColor).multiplyScalar(0.72).getHexString();
        const parMat  = _getPooledMat(parHex, false);
        const parGeo  = new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5);
        const parMesh = new THREE.Mesh(parGeo, parMat);
        parMesh.position.set(bx, h + 0.25, bz);
        lod0.add(parMesh);
      }
    }

    createBody({
      handle:      `placeholder_bld_${cx}_${cz}_${i}`,
      type:        'fixed',
      translation: { x: worldX + bx, y: h / 2, z: worldZ + bz },
      colliders:   [{ shape: 'cuboid', args: [w / 2, h / 2, d / 2] }],
    });
  }

  // Merge non-Guanajuato buildings in flat mode for performance
  if (_FLAT_MATERIALS && bldGeos.length > 0) {
    const bldColorHex = '#' + new THREE.Color(district.color).multiplyScalar(0.65).getHexString();
    const bldMat = _getPooledMat(bldColorHex, true);
    const merged = mergeGeometries(bldGeos, false);
    bldGeos.forEach(g => g.dispose());
    if (merged) {
      const mergedMesh = new THREE.Mesh(merged, bldMat);
      mergedMesh.name = 'bld_merged';
      mergedMesh.frustumCulled = true;
      lod0.add(mergedMesh);
    }
  }

  group.add(lod0, lod1, lod2);
}

/** Simple seeded pseudo-random number generator (mulberry32). */
function _seededRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

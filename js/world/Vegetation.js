/**
 * Vegetation.js — Part 15: Wind-Animated Trees, Grass & Cacti
 * =============================================================
 * - 8 tree/plant archetypes built from procedural geometry (no asset files needed)
 * - InstancedMesh: up to 10 000 instances per archetype — one GPU draw call per type
 * - Wind vertex shader: trunk barely moves, canopy sways ±8 cm, phase unique per instance
 * - Grass: GPU-instanced billboard quads (8 cm tall), up to 500 000 instances
 * - Grass LOD: full density < 80 m, half 80–150 m, hidden > 150 m (per-frame camera test)
 * - Poisson-disk placement: never on road spline corridors or city footprints
 * - Biome dispatch: each archetype is seeded only into its native biome(s)
 *
 * Public API
 * ----------
 *   initVegetation(scene, opts)  → Promise<void>
 *     opts.getTerrainHeight(x,z) → number
 *     opts.getBiome(x,z)         → string
 *     opts.getRoadSurface(x,z)   → string|null
 *   updateVegetation(elapsedSec, camera) → void   (wind + grass LOD)
 *   disposeVegetation()          → void
 */

import * as THREE from 'three';

// ─── Tunables ────────────────────────────────────────────────────────────────
const WORLD_MIN_X   = -6000;
const WORLD_MIN_Z   = -6000;
const WORLD_SIZE    = 12000;
const TREE_MAX      = 8000;    // instances per archetype (GPU budget)
// Grass count scaled to graphics preset — read at module load so InstancedMesh
// is never over-allocated.  Low=0 (no grass), medium=1000, high=20000, ultra=100000, extreme=400000
const _GRASS_BY_PRESET = { low: 0, medium: 1000, high: 20000, ultra: 100000, extreme: 400000 };
const _SAVED_PRESET    = (() => { try { return localStorage.getItem('graphicsPreset') ?? 'low'; } catch { return 'low'; } })();
const GRASS_MAX     = _GRASS_BY_PRESET[_SAVED_PRESET] ?? 0;
const GRASS_FULL_R  = 80;      // metres: full density band
const GRASS_HALF_R  = 160;     // metres: half density band
const ROAD_EXCL_R   = 10;      // metres: no vegetation near road samples
const CITY_EXCL_R   = 40;      // metres: no vegetation near city centre
const POISSON_ATTEMPTS = 30;   // Bridson rejection samples

// City / festival exclusion zones (world-space centres, radius)
const CITY_ZONES = [
  { x:    0, z: 1200, r: 600 },   // festival
  { x: 1500, z:-2100, r: 500 },   // guanajuato
  { x: 3500, z: -800, r: 400 },   // riviera town
];

// ─── State ───────────────────────────────────────────────────────────────────
let _scene            = null;
let _getH             = null;
let _getBiome         = null;
let _getRoadSurface   = null;
let _treeMeshes       = [];      // { mesh: InstancedMesh, mat: ShaderMaterial }
let _grassMesh        = null;
let _grassMat         = null;
let _initialized      = false;

// Grass LOD: keep two counts (full / half) so we can toggle visibleCount
let _grassFull        = 0;
let _grassHalf        = 0;

// ─── Wind ShaderMaterial ─────────────────────────────────────────────────────

function _makeWindMaterial(color, roughness, emissive) {
  // MeshStandardMaterial compiled with wind injection
  const mat = new THREE.MeshStandardMaterial({
    color:     new THREE.Color(color),
    roughness: roughness ?? 0.9,
    metalness: 0.0,
    side:      THREE.DoubleSide,
  });
  if (emissive) mat.emissive.set(emissive);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime     = { value: 0 };
    shader.uniforms.uWindStr  = { value: 1.0 };

    // Pass instanceID through as a varying so GLSL can read it
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       uniform float uWindStr;
       varying float vInstanceID;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vInstanceID = float(gl_InstanceID);
       // Height-proportional wind — trunk barely moves (position.y ≈ 0),
       // canopy sways (position.y near top).
       float phase  = vInstanceID * 0.6180339887;   // golden-ratio spread
       float heightFactor = clamp(transformed.y / 6.0, 0.0, 1.0);
       float swayX  = sin(uTime * 1.35 + phase) * heightFactor * 0.08 * uWindStr;
       float swayZ  = cos(uTime * 1.10 + phase * 1.3) * heightFactor * 0.06 * uWindStr;
       transformed.x += swayX;
       transformed.z += swayZ;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying float vInstanceID;`,
    );

    mat._shader = shader;
  };
  return mat;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** Merge an array of {geo, mat} pairs into one InstancedMesh-friendly geometry */
function _cone(radiusTop, radiusBottom, height, segs = 7) {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segs);
}
function _cyl(r, h, segs = 7) {
  return new THREE.CylinderGeometry(r, r, h, segs);
}
function _sphere(r, ws = 7, hs = 6) {
  return new THREE.SphereGeometry(r, ws, hs);
}
function _box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

/** Merge geometries into a single BufferGeometry for instancing */
function _mergeGeos(parts) {
  const merged = new THREE.BufferGeometry();
  const positions = [];
  const normals   = [];
  const uvs       = [];
  const indices   = [];
  let indexOffset = 0;

  for (const g of parts) {
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const uv  = g.getAttribute('uv');
    const idx = g.index;

    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
      else     uvs.push(0, 0);
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + indexOffset);
    }
    indexOffset += pos.count;
    g.dispose();
  }

  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  merged.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
  merged.setIndex(indices);
  return merged;
}

// ─── Archetype definitions ───────────────────────────────────────────────────
//
// Each archetype: { name, biomes[], maxCount, geoFn, trunkColor, leafColor, roughness,
//                   minScale, maxScale, slopeMax }
// geoFn() returns merged BufferGeometry (trunk + canopy combined, Y=0 at base)

function _makePalmGeo() {
  // Trunk: tall thin cylinder, slight lean baked in via translate
  const trunk = _cyl(0.18, 2.2, 10, 8);
  trunk.translate(0, 5, 0);
  // Three frond clusters at top — flat cones tilted via rotation
  const fronds = [];
  for (let i = 0; i < 7; i++) {
    const f = _cone(0, 1.6, 5, 5);
    f.rotateZ(Math.PI * 0.4);
    f.rotateY((i / 7) * Math.PI * 2);
    f.translate(0, 9.5, 0);
    fronds.push(f);
  }
  return _mergeGeos([trunk, ...fronds]);
}

function _makePineGeo() {
  const trunk = _cyl(0.22, 1.8, 7, 7);
  trunk.translate(0, 3.5, 0);
  // Three stacked cones
  const c1 = _cone(0, 2.5, 5, 7); c1.translate(0, 6, 0);
  const c2 = _cone(0, 2.0, 4, 7); c2.translate(0, 8, 0);
  const c3 = _cone(0, 1.2, 3, 7); c3.translate(0, 10, 0);
  return _mergeGeos([trunk, c1, c2, c3]);
}

function _makeOrganPipeCactusGeo() {
  // Central column + 4 side arms curved outward
  const body = _cyl(0.28, 2.0, 8, 7); body.translate(0, 4, 0);
  const arms = [];
  for (let i = 0; i < 4; i++) {
    const arm = _cyl(0.18, 1.0, 4, 6);
    arm.rotateZ(Math.PI * 0.25);
    arm.rotateY((i / 4) * Math.PI * 2);
    arm.translate(0, 5, 0);
    arms.push(arm);
  }
  return _mergeGeos([body, ...arms]);
}

function _makeSaguaroCactusGeo() {
  const body = _cyl(0.35, 2.2, 9, 8); body.translate(0, 4.5, 0);
  // Two arms
  const armL = _cyl(0.20, 1.0, 3, 6);
  armL.rotateZ(Math.PI * 0.35); armL.translate(-1.2, 5, 0);
  const armR = _cyl(0.20, 1.0, 3, 6);
  armR.rotateZ(-Math.PI * 0.35); armR.translate(1.2, 5, 0);
  return _mergeGeos([body, armL, armR]);
}

function _makeJungleFernGeo() {
  // Low fern: short trunk + spreading leaf planes
  const trunk = _cyl(0.1, 0.6, 1.5, 6); trunk.translate(0, 0.75, 0);
  const leaves = [];
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.PlaneGeometry(2.2, 0.8);
    leaf.rotateY((i / 6) * Math.PI * 2);
    leaf.rotateX(-Math.PI * 0.25);
    leaf.translate(0, 1.4, 0);
    leaves.push(leaf);
  }
  return _mergeGeos([trunk, ...leaves]);
}

function _makeAgaveGeo() {
  // Rosette of spiky leaves
  const base = _cyl(0.12, 0.6, 0.8, 6); base.translate(0, 0.4, 0);
  const leaves = [];
  for (let i = 0; i < 8; i++) {
    const l = _cone(0.04, 0.18, 2.2, 4);
    l.rotateZ(Math.PI * 0.3);
    l.rotateY((i / 8) * Math.PI * 2);
    l.translate(0, 0.6, 0);
    leaves.push(l);
  }
  return _mergeGeos([base, ...leaves]);
}

function _makeMesquiteScrubGeo() {
  // Multi-stem low bush
  const stems = [];
  for (let i = 0; i < 5; i++) {
    const s = _cyl(0.08, 0.4, 2.5, 5);
    s.rotateZ((Math.random() - 0.5) * 0.6);
    s.rotateY((i / 5) * Math.PI * 2);
    s.translate(0, 1.25, 0);
    stems.push(s);
  }
  const canopy = _sphere(1.4, 6, 5); canopy.translate(0, 2.8, 0);
  return _mergeGeos([...stems, canopy]);
}

function _makeDeadTreeGeo() {
  // Bare trunk + bare branches
  const trunk = _cyl(0.25, 1.6, 6, 6); trunk.translate(0, 3, 0);
  const branches = [];
  for (let i = 0; i < 5; i++) {
    const b = _cyl(0.06, 0.3, 2.5, 5);
    b.rotateZ(Math.PI * (0.3 + Math.random() * 0.25));
    b.rotateY((i / 5) * Math.PI * 2);
    b.translate(0, 5.5, 0);
    branches.push(b);
  }
  return _mergeGeos([trunk, ...branches]);
}

/** Central archetype table */
function _archetypes() {
  return [
    {
      name:       'palm',
      biomes:     ['riviera'],           // FH5: palms only on Riviera Maya coast
      maxCount:   TREE_MAX,
      geoFn:      _makePalmGeo,
      trunkColor: 0x8B7355,
      leafColor:  0x2E7D1A,
      roughness:  0.85,
      minScale:   0.7, maxScale: 1.3,
      slopeMax:   0.5,
    },
    {
      name:       'pine',
      biomes:     ['farmland'],          // FH5: pines in highland farmland
      maxCount:   TREE_MAX,
      geoFn:      _makePineGeo,
      trunkColor: 0x5C4033,
      leafColor:  0x1B5E20,
      roughness:  0.9,
      minScale:   0.6, maxScale: 1.5,
      slopeMax:   0.9,
    },
    {
      name:       'organ_pipe_cactus',
      biomes:     ['baja'],              // FH5: organ pipe in Baja desert
      maxCount:   TREE_MAX,
      geoFn:      _makeOrganPipeCactusGeo,
      trunkColor: 0x3A7A2A,
      leafColor:  0x2E6B1A,
      roughness:  0.95,
      minScale:   0.5, maxScale: 1.2,
      slopeMax:   0.6,
    },
    {
      name:       'saguaro',
      biomes:     ['baja', 'dunas'],     // FH5: saguaro in Living Desert / Baja
      maxCount:   TREE_MAX,
      geoFn:      _makeSaguaroCactusGeo,
      trunkColor: 0x4A8832,
      leafColor:  0x3A7022,
      roughness:  0.95,
      minScale:   0.6, maxScale: 1.4,
      slopeMax:   0.5,
    },
    {
      name:       'jungle_fern',
      biomes:     ['jungle'],            // FH5: ferns ONLY in La Selva jungle
      maxCount:   TREE_MAX,
      geoFn:      _makeJungleFernGeo,
      trunkColor: 0x5D4E37,
      leafColor:  0x33691E,
      roughness:  0.85,
      minScale:   0.8, maxScale: 1.6,
      slopeMax:   0.7,
    },
    {
      name:       'agave',
      biomes:     ['baja', 'farmland'],  // FH5: agave on arid hills and farmland
      maxCount:   TREE_MAX,
      geoFn:      _makeAgaveGeo,
      trunkColor: 0x607850,
      leafColor:  0x4A6830,
      roughness:  0.9,
      minScale:   0.7, maxScale: 1.1,
      slopeMax:   0.6,
    },
    {
      name:       'mesquite_scrub',
      biomes:     ['farmland', 'baja'],  // FH5: scrub in open farmland and desert
      maxCount:   TREE_MAX,
      geoFn:      _makeMesquiteScrubGeo,
      trunkColor: 0x795548,
      leafColor:  0x558B2F,
      roughness:  0.88,
      minScale:   0.6, maxScale: 1.2,
      slopeMax:   0.7,
    },
    {
      name:       'dead_tree',
      biomes:     ['caldera'],           // FH5: dead trees ONLY in Gran Caldera volcanic zone
      maxCount:   TREE_MAX,
      geoFn:      _makeDeadTreeGeo,
      trunkColor: 0x4E342E,
      leafColor:  0x4E342E,
      roughness:  0.98,
      minScale:   0.5, maxScale: 1.8,
      slopeMax:   0.8,
    },
  ];
}

// ─── Poisson-disk placement ───────────────────────────────────────────────────

/**
 * Generate Poisson-disk candidate positions in a 2D world slice,
 * filtered by biome, road exclusion zone, and city zones.
 *
 * Returns Array<{x, z}>
 */
function _poissonPoints(biomeList, targetCount, minDist, getH, getBiome, getRoadSurface) {
  const pts  = [];
  const grid = new Map();

  const cellSize = minDist / Math.SQRT2;

  function key(x, z) {
    return `${Math.floor(x / cellSize)}_${Math.floor(z / cellSize)}`;
  }

  function isTooClose(x, z) {
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const p = grid.get(`${cx + dx}_${cz + dz}`);
        if (p) {
          const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
          if (d2 < minDist * minDist) return true;
        }
      }
    }
    return false;
  }

  function isExcluded(x, z) {
    // Road exclusion
    if (getRoadSurface && getRoadSurface(x, z) !== null) return true;
    // City zone exclusion
    for (const cz of CITY_ZONES) {
      const d2 = (x - cz.x) ** 2 + (z - cz.z) ** 2;
      if (d2 < (cz.r + CITY_EXCL_R) ** 2) return true;
    }
    // Out of world
    if (x < WORLD_MIN_X || x > WORLD_MIN_X + WORLD_SIZE) return true;
    if (z < WORLD_MIN_Z || z > WORLD_MIN_Z + WORLD_SIZE) return true;
    return false;
  }

  const active = [];

  // Seed with random start
  const sx = WORLD_MIN_X + Math.random() * WORLD_SIZE;
  const sz = WORLD_MIN_Z + Math.random() * WORLD_SIZE;
  if (biomeList.includes(getBiome(sx, sz)) && !isExcluded(sx, sz)) {
    const p = { x: sx, z: sz };
    pts.push(p);
    active.push(p);
    grid.set(key(sx, sz), p);
  }

  while (active.length > 0 && pts.length < targetCount) {
    const idx = Math.floor(Math.random() * active.length);
    const base = active[idx];
    let found = false;

    for (let attempt = 0; attempt < POISSON_ATTEMPTS; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = minDist + Math.random() * minDist;
      const nx    = base.x + Math.cos(angle) * dist;
      const nz    = base.z + Math.sin(angle) * dist;

      if (isExcluded(nx, nz)) continue;
      if (!biomeList.includes(getBiome(nx, nz))) continue;
      if (isTooClose(nx, nz)) continue;

      const p = { x: nx, z: nz };
      pts.push(p);
      active.push(p);
      grid.set(key(nx, nz), p);
      found = true;
      if (pts.length >= targetCount) break;
    }

    if (!found) active.splice(idx, 1);
  }

  return pts;
}

// ─── InstancedMesh builder ───────────────────────────────────────────────────

const _dummy = new THREE.Object3D();

function _buildInstancedTree(archetype, getH, getBiome, getRoadSurface) {
  const geo = archetype.geoFn();
  const mat = _makeWindMaterial(archetype.leafColor, archetype.roughness);

  const minDist = archetype.minScale < 0.7 ? 6 : 9; // denser for small plants

  const pts = _poissonPoints(
    archetype.biomes,
    archetype.maxCount,
    minDist,
    getH, getBiome, getRoadSurface,
  );

  const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  mesh.name          = `veg_${archetype.name}`;

  // Seeded RNG for reproducible scale/rotation per instance
  let seed = archetype.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  function rng() { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; }

  for (let i = 0; i < pts.length; i++) {
    const { x, z } = pts[i];
    const rawY     = getH(x, z);
    // Guard against NaN/Infinity from terrain height lookups — these produce
    // NaN matrices which make Three.js throw "Computed radius is NaN" when
    // it tries to compute the InstancedMesh bounding sphere.
    const y        = (typeof rawY === 'number' && isFinite(rawY)) ? rawY : 0;
    const scale    = archetype.minScale + rng() * (archetype.maxScale - archetype.minScale);
    const rotY     = rng() * Math.PI * 2;

    _dummy.position.set(x, y, z);
    _dummy.rotation.set(0, rotY, 0);
    _dummy.scale.setScalar(scale);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = pts.length;

  return { mesh, mat };
}

// ─── Grass system ─────────────────────────────────────────────────────────────

function _buildGrassMat() {
  const mat = new THREE.MeshStandardMaterial({
    color:       0x4A7C2F,
    roughness:   0.95,
    metalness:   0.0,
    side:        THREE.DoubleSide,
    alphaTest:   0.3,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime    = { value: 0 };
    shader.uniforms.uCamPos  = { value: new THREE.Vector3() };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       uniform vec3  uCamPos;
       varying float vFade;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // Grass wind — fast, shallow, tip-only
       float phase   = float(gl_InstanceID) * 2.399963;
       float tipFac  = clamp(transformed.y / 0.08, 0.0, 1.0);
       transformed.x += sin(uTime * 2.8 + phase) * tipFac * 0.025;
       transformed.z += cos(uTime * 2.1 + phase * 1.7) * tipFac * 0.018;
       // Distance fade for LOD softening
       vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
       float dist = length(worldPos.xyz - uCamPos);
       vFade = 1.0 - smoothstep(${GRASS_FULL_R}.0, ${GRASS_HALF_R}.0, dist);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying float vFade;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       if (vFade < 0.01) discard;
       gl_FragColor.a *= vFade;`,
    );

    mat._shader = shader;
  };
  return mat;
}

function _buildGrass(getH, getBiome, getRoadSurface) {
  // Skip entirely on low preset — no GPU budget for grass
  if (GRASS_MAX === 0) return null;
  // Single quad blade: 5 cm wide, 8 cm tall
  const bladeGeo = new THREE.PlaneGeometry(0.05, 0.08, 1, 3);
  bladeGeo.translate(0, 0.04, 0);  // pivot at base

  _grassMat = _buildGrassMat();
  const mesh = new THREE.InstancedMesh(bladeGeo, _grassMat, GRASS_MAX);
  mesh.castShadow    = false;
  mesh.receiveShadow = true;
  mesh.name          = 'veg_grass';

  const grassBiomes = ['farmland', 'jungle', 'festival', 'riviera'];

  // Tight grid placement with biome + road filter
  const SPACING = 1.4;  // metres between blades (target density)
  let count = 0;
  let seed  = 42;
  function rng() { seed = (seed * 22695477 + 1) & 0x7fffffff; return seed / 0x7fffffff; }

  // Sample a regular jittered grid across the world, capped at GRASS_MAX
  const gridStep = Math.sqrt((WORLD_SIZE * WORLD_SIZE) / GRASS_MAX) * 0.9;
  const cols     = Math.ceil(WORLD_SIZE / gridStep);
  const rows     = Math.ceil(WORLD_SIZE / gridStep);

  outer:
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = WORLD_MIN_X + col * gridStep + rng() * gridStep * 0.8;
      const z = WORLD_MIN_Z + row * gridStep + rng() * gridStep * 0.8;

      if (!grassBiomes.includes(getBiome(x, z))) continue;
      if (getRoadSurface && getRoadSurface(x, z) !== null) continue;

      const rawY  = getH(x, z);
      const y     = (typeof rawY === 'number' && isFinite(rawY)) ? rawY : 0;
      const rotY  = rng() * Math.PI * 2;
      const scale = 0.7 + rng() * 0.6;

      _dummy.position.set(x, y, z);
      _dummy.rotation.set(0, rotY, 0);
      _dummy.scale.setScalar(scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(count, _dummy.matrix);
      count++;
      if (count >= GRASS_MAX) break outer;
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  _grassFull = count;
  _grassHalf = Math.ceil(count / 2);
  mesh.count = count;

  console.log(`[Vegetation] Grass: ${count.toLocaleString()} blades placed`);
  return mesh;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the vegetation system.
 *
 * @param {THREE.Scene} scene
 * @param {{getTerrainHeight, getBiome, getRoadSurface}} opts
 */
export async function initVegetation(scene, opts = {}) {
  if (_initialized) return;
  _initialized    = true;
  _scene          = scene;
  _getH           = opts.getTerrainHeight;
  _getBiome       = opts.getBiome;
  _getRoadSurface = opts.getRoadSurface ?? null;

  const group  = new THREE.Group();
  group.name   = 'Vegetation';

  console.log('[Vegetation] Part 15 — building tree archetypes …');

  const archs = _archetypes();
  let totalTrees = 0;

  for (const arch of archs) {
    const { mesh, mat } = _buildInstancedTree(arch, _getH, _getBiome, _getRoadSurface);
    group.add(mesh);
    _treeMeshes.push({ mesh, mat });
    totalTrees += mesh.count;
    console.log(`[Vegetation]   ${arch.name}: ${mesh.count} instances`);
  }

  console.log(`[Vegetation] Trees total: ${totalTrees.toLocaleString()}`);
  console.log('[Vegetation] Building grass …');

  _grassMesh = _buildGrass(_getH, _getBiome, _getRoadSurface);
  if (_grassMesh) group.add(_grassMesh); // null on low preset (GRASS_MAX=0)

  scene.add(group);

  console.log('[Vegetation] Part 15 complete ✓');
}

/**
 * Call every frame — updates wind uniforms and grass LOD visibility.
 *
 * @param {number}       elapsed  seconds since start
 * @param {THREE.Camera} camera
 */
export function updateVegetation(elapsed, camera) {
  if (!_initialized) return;

  // ── Wind uniform update ───────────────────────────────────────────────────
  for (const { mat } of _treeMeshes) {
    if (mat._shader) {
      mat._shader.uniforms.uTime.value    = elapsed;
      mat._shader.uniforms.uWindStr.value = 1.0;   // could be driven by weather
    }
  }

  // ── Grass wind + LOD ──────────────────────────────────────────────────────
  if (_grassMat?._shader) {
    _grassMat._shader.uniforms.uTime.value = elapsed;
    _grassMat._shader.uniforms.uCamPos.value.copy(camera.position);
  }

  // Coarse LOD: hide grass entirely beyond GRASS_HALF_R × 2
  if (_grassMesh) {
    const camY = camera.position.y;
    // Only toggle count, never re-upload matrices
    const farAway = camY > 300;   // high altitude (map view) → hide all grass
    _grassMesh.count = farAway ? 0 : _grassFull;
  }
}

/**
 * Dispose all GPU resources.
 */
export function disposeVegetation() {
  for (const { mesh, mat } of _treeMeshes) {
    mesh.geometry.dispose();
    mat.dispose();
    _scene?.remove(mesh);
  }
  if (_grassMesh) {
    _grassMesh.geometry.dispose();
    _grassMat?.dispose();
    _scene?.remove(_grassMesh);
  }
  _treeMeshes  = [];
  _grassMesh   = null;
  _initialized = false;
}

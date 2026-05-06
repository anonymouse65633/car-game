/**
 * RoadNetwork.js — Part 14: Accurate FH5 Road Network
 * =====================================================
 * - 8 named road splines (CatmullRomCurve3) covering the full world
 * - Procedural road mesh: extruded profile + kerb strip per spline
 * - Road markings shader: UV-scrolling dashed centre line + solid edge lines
 * - getRoadSurface(x, z) — returns surface type string for physics/audio
 * - getRoadY(x, z)       — returns flattened road height at query point
 * - Exposed for minimap: getRoadSplines()
 *
 * Public API
 * ----------
 *   initRoadNetwork(scene, getTerrainHeight) → Promise<void>
 *   updateRoadMarkings(elapsedSeconds)        → void   (animate UV scroll)
 *   getRoadSurface(x, z)                      → string ('tarmac' | 'cobblestone' | 'dirt' | …)
 *   getRoadY(x, z)                            → number | null
 *   getRoadSplines()                           → Array<{curve, width, surfaceType, name}>
 *   disposeRoadNetwork()                       → void
 */

import * as THREE from 'three';
import { getTerrainHeight as _defaultTHFn } from './terrain.js';

// ─── Singleton state ────────────────────────────────────────────────────────
let _scene            = null;
let _getTerrainHeight = null;
let _roadMeshes       = [];
let _kerbMeshes       = [];
let _markingMat       = null;       // shared, time-driven
let _tarmacMat        = null;
let _cobblestoneMat   = null;
let _dirtMat          = null;
let _kerbMat          = null;
let _roadObjects      = [];         // {curve, width, surfaceType, name, halfW}
let _initialized      = false;

// ─── Road definitions ────────────────────────────────────────────────────────
// Control points chosen to match FH5 biome layout in terrain.js:
//   guanajuato: x 500–3000, z -3000 to -1000
//   caldera:    x -5000 to -1000, z -5500 to -2500
//   riviera:    x 2500–6000, z -2500 to 500
//   dunas:      x -6000 to -1000, z -2500 to -1000
//   baja:       x -6000 to -500,  z -1000 to 2000
//   farmland:   x -500 to 2500,   z -2000 to 1500
//   festival:   x -3000 to 500,   z 500 to 3000
//   jungle:     x 500 to 3500,    z 1000 to 4000

function _defineSplines() {
  // Heights are relative to terrain — we project onto terrain in geometry builder
  return [
    // ── 1. MAIN HIGHWAY LOOP — 7 m wide, smooth tarmac, closed loop ──────
    {
      name:        'highway_loop',
      surfaceType: 'tarmac',
      width:        7,
      closed:       true,
      points: [
        [-5400,  22,  1800], [-4000,  22,  1200], [-3000,  22,   800],
        [-2000,  22,   400], [-1400,  22,  -200], [-1200,  22,  -800],
        [-1000,  26, -1400], [ -600,  30, -1900], [  200,  35, -2400],
        [  800,  55, -2800], [ 1200,  80, -3000], [ 1700, 100, -2800],
        [ 2100, 120, -2600], [ 2500, 140, -2200], [ 2800, 200, -3200],
        [ 3200, 300, -3800], [ 3600, 400, -4200], [ 4000, 380, -3600],
        [ 4400, 200, -2800], [ 4700,  80, -2000], [ 5000,  30,  -800],
        [ 4800,  14,   200], [ 4200,  14,   800], [ 3600,  16,  1200],
        [ 2800,  18,  1600], [ 1800,  20,  2000], [  800,  22,  2200],
        [ -400,  22,  2000], [-1600,  22,  1800], [-3000,  22,  1800],
      ],
    },
    // ── 2. GUANAJUATO HIGH STREET — 5 m wide, cobblestone ───────────────
    {
      name:        'guanajuato_street',
      surfaceType: 'cobblestone',
      width:        5,
      closed:       false,
      points: [
        [ 600,  42, -1100], [ 780,  55, -1400], [ 950,  68, -1700],
        [1100,  80, -2000], [1300,  95, -2200], [1500, 105, -2400],
        [1700, 115, -2600], [1900, 118, -2700], [2100, 120, -2800],
        [2300, 118, -2900], [2500, 115, -2950],
      ],
    },
    // ── 3. CALDERA SWITCHBACKS — 5 m wide, volcanic dirt, mountain climb ─
    {
      name:        'caldera_switchbacks',
      surfaceType: 'volcanic_dirt',
      width:        5,
      closed:       false,
      points: [
        [-1200,  30, -2600], [-1600,  60, -2800], [-2000, 100, -3000],
        [-2400, 160, -3200], [-2600, 220, -3400], [-2800, 290, -3600],
        [-3000, 370, -3800], [-3200, 430, -4000], [-3400, 480, -4200],
        [-3600, 510, -4400], [-3800, 520, -4600], [-4000, 490, -4800],
      ],
    },
    // ── 4. BEACH BOULEVARD — 6 m wide, wet tarmac, Riviera coast ─────────
    {
      name:        'beach_boulevard',
      surfaceType: 'tarmac',
      width:        6,
      closed:       false,
      points: [
        [2600,  14, -2400], [3000,  14, -2000], [3400,  14, -1400],
        [3800,  14,  -800], [4200,  14,  -400], [4600,  14,   200],
        [4800,  14,   800], [4600,  16,  1400], [4200,  18,  1800],
        [3800,  18,  2200], [3400,  18,  2600],
      ],
    },
    // ── 5. FESTIVAL AIRSTRIP — 30 m wide, smooth tarmac ──────────────────
    {
      name:        'festival_airstrip',
      surfaceType: 'tarmac',
      width:       30,
      closed:       false,
      points: [
        [-2800,  24,  700], [-2400,  24,  900], [-1800,  24,  1100],
        [-1200,  24,  1300], [ -600,  24,  1500], [  0,   24,  1600],
        [  600,  24,  1600], [ 1200,  24,  1500], [ 1600,  24,  1300],
      ],
    },
    // ── 6. BAJA DIRT TRACKS — 4 m wide, loose dirt ───────────────────────
    {
      name:        'baja_dirt',
      surfaceType: 'dirt',
      width:        4,
      closed:       false,
      points: [
        [-5000,  30,  200], [-4400,  32,  -200], [-3800,  35,  -600],
        [-3200,  38, -1000], [-2800,  40, -1400], [-2400,  42, -1800],
        [-2000,  44, -2000], [-1600,  46, -2200], [-1200,  48, -2400],
      ],
    },
    // ── 7. JUNGLE TRAIL — 4 m wide, muddy dirt ───────────────────────────
    {
      name:        'jungle_trail',
      surfaceType: 'mud',
      width:        4,
      closed:       false,
      points: [
        [  600,  24,  1100], [ 900,  26,  1400], [1200,  28,  1800],
        [ 1500,  30,  2200], [1800,  32,  2600], [2100,  34,  3000],
        [ 2400,  36,  3400], [2700,  38,  3800],
      ],
    },
    // ── 8. DUNAS SAND TRACK — 4 m wide, sand ────────────────────────────
    {
      name:        'dunas_track',
      surfaceType: 'sand',
      width:        4,
      closed:       false,
      points: [
        [-4800, -2, -1000], [-4400,  0, -1300], [-4000,  2, -1600],
        [-3600,  3, -1900], [-3200,  4, -2200], [-2800,  4, -2400],
        [-2400,  3, -2200], [-2000,  2, -2000], [-1600,  2, -1800],
      ],
    },
  ];
}

// ─── Material builders ───────────────────────────────────────────────────────

/**
 * Road surface markings — dashed centre, solid edges.
 * Uses onBeforeCompile injection so it works with MeshStandardMaterial lighting.
 */
function _buildMarkingMaterial(surfaceType) {
  const baseColor = surfaceType === 'cobblestone' ? 0x6e5e4e
    : surfaceType === 'volcanic_dirt'             ? 0x2a1a0a
    : surfaceType === 'dirt' || surfaceType === 'mud' ? 0x4a3820
    : surfaceType === 'sand'                      ? 0xc8a870
    : /* tarmac */                                  0x1e1e1e;

  const mat = new THREE.MeshStandardMaterial({
    color:     baseColor,
    roughness: surfaceType === 'cobblestone' ? 0.85
             : surfaceType === 'tarmac'      ? 0.78
             : 0.95,
    metalness: 0.0,
  });

  // Road markings — only on tarmac and cobblestone wide enough for lines
  if (surfaceType === 'tarmac' || surfaceType === 'cobblestone') {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime      = { value: 0 };
      shader.uniforms.uRoadWidth = { value: 1.0 };   // normalised; 0=edge, 1=edge

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec2 vRoadUV;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vRoadUV = uv;`,   // UV.x = 0..1 across width, UV.y = 0..1 along road
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform float uRoadWidth;
         varying vec2 vRoadUV;

         // Returns 1.0 inside a marking, 0.0 outside
         float roadMarkings(vec2 uv) {
           float x = uv.x;   // 0–1 across the road
           float y = uv.y + uTime * 0.04;  // scroll slightly with traffic

           // Edge lines — solid white, 4% inset from each edge
           float edgeL = step(0.03, x) * step(x, 0.07);
           float edgeR = step(0.93, x) * step(x, 0.97);
           float edgeLines = max(edgeL, edgeR);

           // Centre dashed line — 48% / 50–52% / 52% → dash every 0.25 UV units
           float centre = abs(x - 0.5);
           float inCentre = step(centre, 0.015);
           float dash = step(0.5, fract(y * 4.0));
           float centreLine = inCentre * dash;

           return max(edgeLines, centreLine);
         }`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float marking = roadMarkings(vRoadUV);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.95, 0.93, 0.85), marking * 0.85);`,
      );

      mat._shader = shader;
    };
  }

  return mat;
}

function _buildKerbMaterial() {
  return new THREE.MeshStandardMaterial({
    color:     0xd4c9b8,
    roughness: 0.9,
    metalness: 0.0,
  });
}

// ─── Geometry builder ────────────────────────────────────────────────────────

/**
 * Build an extruded road strip along a CatmullRomCurve3.
 * Returns { roadMesh, kerbMeshLeft, kerbMeshRight }
 */
function _buildRoadGeometry(curve, halfW, getH, surfaceType) {
  const ROAD_SEGS   = Math.max(80, Math.round(curve.getLength() / 15)); // 1 seg per 15 m
  const KERB_W      = 0.30;  // kerb horizontal width (metres)
  const KERB_H      = 0.10;  // kerb raise above road surface

  const pts         = curve.getPoints(ROAD_SEGS);

  // Build road strip — 4 verts per segment cross-section (left edge, left inner, right inner, right edge)
  const roadPositions  = new Float32Array(pts.length * 4 * 3);
  const roadNormals    = new Float32Array(pts.length * 4 * 3);
  const roadUVs        = new Float32Array(pts.length * 4 * 2);
  const roadIndices    = [];

  const kLPos = new Float32Array(pts.length * 2 * 3);
  const kRPos = new Float32Array(pts.length * 2 * 3);
  const kLN   = new Float32Array(pts.length * 2 * 3);
  const kRN   = new Float32Array(pts.length * 2 * 3);
  const kLUV  = new Float32Array(pts.length * 2 * 2);
  const kRUV  = new Float32Array(pts.length * 2 * 2);
  const kLIdx = [];
  const kRIdx = [];

  const _up  = new THREE.Vector3(0, 1, 0);
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();

  let totalLength = 0;
  const segLengths = [0];
  for (let i = 1; i < pts.length; i++) {
    totalLength += pts[i].distanceTo(pts[i - 1]);
    segLengths.push(totalLength);
  }

  for (let i = 0; i < pts.length; i++) {
    const pt  = pts[i];
    const uvY = segLengths[i] / totalLength;  // 0..1 along road

    // Tangent direction
    if (i < pts.length - 1) {
      _fwd.subVectors(pts[i + 1], pt).normalize();
    } else {
      _fwd.subVectors(pt, pts[i - 1]).normalize();
    }
    _right.crossVectors(_fwd, _up).normalize();

    // Sample terrain height, apply a small lift so road floats just above
    const roadY = getH(pt.x, pt.z) + 0.08;

    const base = i * 4 * 3;

    // Left outer kerb edge
    const lOX = pt.x - _right.x * (halfW + KERB_W);
    const lOZ = pt.z - _right.z * (halfW + KERB_W);
    const lOY = getH(lOX, lOZ) + 0.08 + KERB_H;

    // Left road edge
    const lRX = pt.x - _right.x * halfW;
    const lRZ = pt.z - _right.z * halfW;

    // Right road edge
    const rRX = pt.x + _right.x * halfW;
    const rRZ = pt.z + _right.z * halfW;

    // Right outer kerb edge
    const rOX = pt.x + _right.x * (halfW + KERB_W);
    const rOZ = pt.z + _right.z * (halfW + KERB_W);
    const rOY = getH(rOX, rOZ) + 0.08 + KERB_H;

    // Road verts: left edge (0), left kerb-inside (1 = same as road edge), right edge (2), …
    // We use 4 verts: [0]=left edge, [1]=centre-ish left, [2]=centre-ish right, [3]=right edge
    // Simpler: 2 verts per edge (across width) → use exact UV mapping
    const positions = [
      lRX, roadY, lRZ,   // 0: left
      lRX, roadY, lRZ,   // 1: left  (degenerate, UV 0.01 to avoid edge artefact)
      rRX, roadY, rRZ,   // 2: right
      rRX, roadY, rRZ,   // 3: right
    ];
    const uvXs = [0.0, 0.03, 0.97, 1.0];

    for (let v = 0; v < 4; v++) {
      roadPositions[base + v * 3 + 0] = positions[v * 3 + 0];
      roadPositions[base + v * 3 + 1] = positions[v * 3 + 1];
      roadPositions[base + v * 3 + 2] = positions[v * 3 + 2];
      roadNormals[base + v * 3 + 0] = 0;
      roadNormals[base + v * 3 + 1] = 1;
      roadNormals[base + v * 3 + 2] = 0;
      roadUVs[(i * 4 + v) * 2 + 0] = uvXs[v];
      roadUVs[(i * 4 + v) * 2 + 1] = uvY;
    }

    if (i < pts.length - 1) {
      const a = i * 4;
      // Two triangles per quad (across 4 verts → take outer two as the strip)
      roadIndices.push(a,     a + 2, a + 6);
      roadIndices.push(a,     a + 6, a + 4);
      roadIndices.push(a + 1, a + 3, a + 7);
      roadIndices.push(a + 1, a + 7, a + 5);
    }

    // Kerb verts — left kerb: inner (road edge) → outer (raised)
    const kb = i * 2 * 3;
    // Left kerb
    kLPos[kb + 0] = lRX;   kLPos[kb + 1] = roadY;      kLPos[kb + 2] = lRZ;
    kLPos[kb + 3] = lOX;   kLPos[kb + 4] = lOY;         kLPos[kb + 5] = lOZ;
    kLN[kb + 0] = -_right.x; kLN[kb + 1] = 0; kLN[kb + 2] = -_right.z;
    kLN[kb + 3] = -_right.x; kLN[kb + 4] = 0; kLN[kb + 5] = -_right.z;
    kLUV[(i * 2) * 2 + 0] = 0; kLUV[(i * 2) * 2 + 1] = uvY;
    kLUV[(i * 2 + 1) * 2 + 0] = 1; kLUV[(i * 2 + 1) * 2 + 1] = uvY;
    // Right kerb
    kRPos[kb + 0] = rRX;   kRPos[kb + 1] = roadY;      kRPos[kb + 2] = rRZ;
    kRPos[kb + 3] = rOX;   kRPos[kb + 4] = rOY;         kRPos[kb + 5] = rOZ;
    kRN[kb + 0] = _right.x; kRN[kb + 1] = 0; kRN[kb + 2] = _right.z;
    kRN[kb + 3] = _right.x; kRN[kb + 4] = 0; kRN[kb + 5] = _right.z;
    kRUV[(i * 2) * 2 + 0] = 0; kRUV[(i * 2) * 2 + 1] = uvY;
    kRUV[(i * 2 + 1) * 2 + 0] = 1; kRUV[(i * 2 + 1) * 2 + 1] = uvY;

    if (i < pts.length - 1) {
      const a = i * 2;
      kLIdx.push(a, a + 2, a + 3); kLIdx.push(a, a + 3, a + 1);
      kRIdx.push(a, a + 2, a + 3); kRIdx.push(a, a + 3, a + 1);
    }
  }

  // ─── Road mesh ────────────────────────────────────────────────────────────
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.BufferAttribute(roadPositions, 3));
  roadGeo.setAttribute('normal',   new THREE.BufferAttribute(roadNormals,   3));
  roadGeo.setAttribute('uv',       new THREE.BufferAttribute(roadUVs,       2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();  // smooth normals override flat ones above

  const mat  = _buildMarkingMaterial(surfaceType);
  const roadMesh = new THREE.Mesh(roadGeo, mat);
  roadMesh.receiveShadow = true;
  roadMesh.name = `road_surface`;

  // ─── Kerb meshes ─────────────────────────────────────────────────────────
  function _makeKerbMesh(posArr, normArr, uvArr, idxArr) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(normArr, 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(uvArr,   2));
    geo.setIndex(idxArr);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, _kerbMat);
    m.receiveShadow = true;
    m.name = 'road_kerb';
    return m;
  }

  const kerbMeshLeft  = _makeKerbMesh(kLPos, kLN, kLUV, kLIdx);
  const kerbMeshRight = _makeKerbMesh(kRPos, kRN, kRUV, kRIdx);

  // Store shader ref on road mesh for updateRoadMarkings()
  roadMesh._mat = mat;

  return { roadMesh, kerbMeshLeft, kerbMeshRight };
}

// ─── Proximity lookup table ──────────────────────────────────────────────────
// For getRoadSurface / getRoadY we need fast point-on-spline queries.
// Pre-sample each spline into a flat array of [x, z, surfaceType, y] buckets.

const LOOKUP_STEP = 20;  // sample every 20 m — sufficient for width test

function _buildLookup(splineDef, curve) {
  const halfW = splineDef.width / 2 + 2.0;  // include 2 m margin
  const len   = curve.getLength();
  const steps = Math.max(10, Math.ceil(len / LOOKUP_STEP));
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const pt = curve.getPointAt(i / steps);
    samples.push({ x: pt.x, z: pt.z, halfW, surfaceType: splineDef.surfaceType, y: pt.y });
  }
  return samples;
}

let _lookupSamples = [];  // flat array of all samples

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialise the road network — build all spline meshes and add to scene.
 *
 * @param {THREE.Scene} scene
 * @param {function}    getTerrainHeight   (x, z) → number
 */
export async function initRoadNetwork(scene, getTerrainHeight) {
  if (_initialized) return;
  _initialized      = true;
  _scene            = scene;
  _getTerrainHeight = getTerrainHeight || _defaultTHFn;

  _kerbMat = _buildKerbMaterial();

  const splineDefs = _defineSplines();
  _lookupSamples = [];

  const group = new THREE.Group();
  group.name  = 'RoadNetwork';

  for (const def of splineDefs) {
    const controlPts = def.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const curve      = new THREE.CatmullRomCurve3(controlPts, def.closed, 'catmullrom', 0.5);

    const halfW = def.width / 2;

    const { roadMesh, kerbMeshLeft, kerbMeshRight } = _buildRoadGeometry(
      curve, halfW, _getTerrainHeight, def.surfaceType
    );

    roadMesh.name       = `road_${def.name}`;
    kerbMeshLeft.name   = `kerb_L_${def.name}`;
    kerbMeshRight.name  = `kerb_R_${def.name}`;

    group.add(roadMesh, kerbMeshLeft, kerbMeshRight);

    _roadMeshes.push(roadMesh);
    _kerbMeshes.push(kerbMeshLeft, kerbMeshRight);
    _roadObjects.push({ curve, width: def.width, halfW, surfaceType: def.surfaceType, name: def.name });

    const lookupSamples = _buildLookup(def, curve);
    _lookupSamples.push(...lookupSamples);

    // Track the material shader ref for time updates
    if (roadMesh._mat?._shader) {
      _markingMat = roadMesh._mat; // last one wins; all share same uTime pattern
    }
  }

  scene.add(group);

  console.log(
    `[RoadNetwork] Part 14 — ${_roadObjects.length} splines built,`,
    `${_lookupSamples.length} lookup samples,`,
    `${_roadMeshes.length} road meshes`
  );
}

/**
 * Call every frame — animates the UV-scroll on road markings.
 *
 * @param {number} elapsed  Clock.getElapsedTime() in seconds
 */
export function updateRoadMarkings(elapsed) {
  if (!_initialized) return;
  for (const rm of _roadMeshes) {
    const shader = rm._mat?._shader;
    if (shader) {
      shader.uniforms.uTime.value = elapsed;
    }
  }
}

/**
 * Returns the surface type of the road at world (x, z), or null if not on a road.
 *
 * @param   {number}         x
 * @param   {number}         z
 * @returns {string | null}
 */
export function getRoadSurface(x, z) {
  const hit = _findNearestSample(x, z);
  return hit ? hit.surfaceType : null;
}

/**
 * Returns the road surface Y at (x, z), or null if not on a road.
 *
 * @param   {number}         x
 * @param   {number}         z
 * @returns {number | null}
 */
export function getRoadY(x, z) {
  const hit = _findNearestSample(x, z);
  if (!hit) return null;
  return (_getTerrainHeight ?? _defaultTHFn)(x, z) + 0.08;
}

/**
 * Returns all road spline descriptors — used by minimap, NPC system, etc.
 *
 * @returns {Array<{curve: THREE.CatmullRomCurve3, width: number, surfaceType: string, name: string}>}
 */
export function getRoadSplines() {
  return _roadObjects.map(({ curve, width, surfaceType, name }) => ({
    curve, width, surfaceType, name,
  }));
}

/**
 * Free all GPU resources.
 */
export function disposeRoadNetwork() {
  for (const m of [..._roadMeshes, ..._kerbMeshes]) {
    m.geometry.dispose();
    if (Array.isArray(m.material)) m.material.forEach(x => x.dispose());
    else m.material.dispose();
    _scene?.remove(m);
  }
  _kerbMat?.dispose();
  _roadMeshes  = [];
  _kerbMeshes  = [];
  _roadObjects = [];
  _lookupSamples = [];
  _initialized = false;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function _findNearestSample(x, z) {
  // Walk lookup samples; return first one within halfW of (x, z)
  let bestDist = Infinity;
  let bestSample = null;

  for (const s of _lookupSamples) {
    const dx = x - s.x;
    const dz = z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < s.halfW * s.halfW && d2 < bestDist) {
      bestDist   = d2;
      bestSample = s;
    }
  }
  return bestSample;
}

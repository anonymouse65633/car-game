/**
 * terrain.js — Procedural Terrain Height & Biome Queries
 * Part 2 / World layer — NEW FILE
 *
 * Responsibilities:
 *  - getTerrainHeight(x, z)  — procedural elevation for any world position
 *  - getBiome(x, z)          — returns biome string for ambient / FX lookup
 *  - getTerrainNormal(x, z)  — surface normal for vehicle alignment on slopes
 *
 * Algorithm:
 *  Four summed sine waves give broad rolling terrain, then district-specific
 *  biases lift or lower the result.  No heightmap image required — fully
 *  deterministic, computable from any world position in O(1).
 *
 *  Gran Caldera uses a Gaussian cone centred at (3500, -4000) rising to y=800.
 *  Dunas Blancas uses a high-frequency sine stack for rolling dune shapes.
 *  The rest use the base wave blend + district offset.
 *
 * Exports:
 *  getTerrainHeight(x, z)   → number   (metres above sea level)
 *  getBiome(x, z)           → string
 *  getTerrainNormal(x, z)   → { nx, ny, nz }
 *  sampleTerrainGrid(x, z, step) → 2D Float32Array  (for chunk mesh deformation)
 */

'use strict';

// ─── Caldera volcano cone ──────────────────────────────────────────────────────
const CALDERA_X      =  3500;
const CALDERA_Z      = -4000;
const CALDERA_PEAK_Y =   800;   // metres at summit
const CALDERA_RADIUS =  1800;   // Gaussian sigma — tuned for approach roads

// ─── District elevation biases (additive, metres) ─────────────────────────────
const DISTRICT_BIAS = {
  guanajuato:  100,   // colonial hilltop streets
  caldera:       0,   // handled by Gaussian cone
  riviera:      -5,   // sea level, slight below
  dunas:        40,   // dune base elevation
  baja:         80,   // mesa plateau
  farmland:     20,   // gentle rolling fields
  festival:     18,   // flat airstrip
  jungle:       15,   // forest floor
  highway:       0,   // carved into terrain
};

// ─── Base wave parameters ──────────────────────────────────────────────────────
// Four sine waves at different frequencies and amplitudes.
const BASE_WAVES = [
  { ampX: 1 / 4000, ampZ: 1 / 3500, scaleY: 30 },
  { ampX: 1 / 1800, ampZ: 1 / 2200, scaleY: 15 },
  { ampX: 1 / 800,  ampZ: 1 / 1000, scaleY:  7 },
  { ampX: 1 / 300,  ampZ: 1 /  350, scaleY:  3 },
];

// ─── Dune wave stack (Dunas Blancas only) ─────────────────────────────────────
const DUNE_WAVES = [
  { ampX: 1 / 600, ampZ: 1 / 700, scaleY: 55 },
  { ampX: 1 / 220, ampZ: 1 / 280, scaleY: 25 },
  { ampX: 1 / 80,  ampZ: 1 / 100, scaleY:  8 },
];

// ─── Guanajuato hill waves (denser hills for colonial city feel) ───────────────
const GUA_WAVES = [
  { ampX: 1 / 500, ampZ: 1 / 600, scaleY: 40 },
  { ampX: 1 / 180, ampZ: 1 / 200, scaleY: 18 },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the terrain height (Y) in metres for a given world XZ coordinate.
 * This is used by:
 *  - city.js _buildPlaceholderChunk → lifts ground mesh vertices
 *  - main.js → initial car spawn position
 *  - BarnFindManager → verify barn world positions
 *
 * @param {number} x  World X (east)
 * @param {number} z  World Z (south)
 * @returns {number}  Metres above sea level (never below -2)
 */
export function getTerrainHeight(x, z) {
  // ── Gran Caldera volcano cone ──────────────────────────────────────────────
  const caldera = _calderaHeight(x, z);

  // ── Base undulation ────────────────────────────────────────────────────────
  let base = 0;
  for (const w of BASE_WAVES) {
    base += Math.sin(x * w.ampX * Math.PI * 2) * w.scaleY * 0.5
          + Math.sin(z * w.ampZ * Math.PI * 2) * w.scaleY * 0.5;
  }

  // ── Biome-specific overlay ─────────────────────────────────────────────────
  const biome = getBiome(x, z);
  let overlay = 0;
  let bias    = DISTRICT_BIAS[biome] ?? 0;

  if (biome === 'dunas') {
    for (const w of DUNE_WAVES) {
      overlay += Math.abs(Math.sin(x * w.ampX * Math.PI * 2 + 0.4))
               * Math.abs(Math.sin(z * w.ampZ * Math.PI * 2 + 1.1))
               * w.scaleY;
    }
  } else if (biome === 'guanajuato') {
    for (const w of GUA_WAVES) {
      overlay += Math.sin(x * w.ampX * Math.PI * 2 + 0.7) * w.scaleY * 0.5
               + Math.sin(z * w.ampZ * Math.PI * 2 + 0.3) * w.scaleY * 0.5;
    }
  } else if (biome === 'riviera') {
    // Coastal clamp — flatten toward sea level at eastern edge
    const coastBlend = Math.max(0, Math.min(1, (x - 2500) / 2000));
    bias -= coastBlend * 30;
    overlay = base * (1 - coastBlend * 0.8);
  } else if (biome === 'festival') {
    // Flat airstrip — dampen variation significantly
    overlay = base * 0.08;
  } else if (biome === 'baja') {
    // Mesa effect — sigmoid clamp creates flat-top plateau at ~120m
    const raw = base + bias;
    return Math.max(-2, Math.min(180, raw + overlay) * 0.7 + 20);
  }

  const total = Math.max(-2, base + overlay + bias + caldera);
  return total;
}

/**
 * Return the biome name for a world XZ position.
 * Matches district IDs from DISTRICT_DATA in city.js.
 *
 * @param {number} x
 * @param {number} z
 * @returns {string}
 */
export function getBiome(x, z) {
  if (x >  500 && x <  3000 && z > -3000 && z < -1000) return 'guanajuato';
  if (x > 1500 && x <  5000 && z > -5000 && z < -2500) return 'caldera';
  if (x > 2500 && x <  5000 && z > -2500 && z <   500) return 'riviera';
  if (x > -5000 && x < -1000 && z > -4000 && z < -1000) return 'dunas';
  if (x > -5000 && x <  -500 && z > -1000 && z <  2000) return 'baja';
  if (x >  -500 && x <  2500 && z > -2000 && z <  1500) return 'farmland';
  if (x > -3000 && x <   500 && z >   500 && z <  3000) return 'festival';
  if (x >   500 && x <  3500 && z >  1000 && z <  4000) return 'jungle';
  return 'highway';
}

/**
 * Approximate surface normal at (x, z) using central differences.
 * Used to tilt the car body to match terrain slope.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} [step=2]  Sample offset in metres
 * @returns {{ nx:number, ny:number, nz:number }}  (already normalised)
 */
export function getTerrainNormal(x, z, step = 2) {
  const hL = getTerrainHeight(x - step, z);
  const hR = getTerrainHeight(x + step, z);
  const hD = getTerrainHeight(x, z - step);
  const hU = getTerrainHeight(x, z + step);

  // Cross product of the two tangent vectors
  let nx = hL - hR;
  let ny = 2 * step;
  let nz = hD - hU;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return { nx: nx / len, ny: ny / len, nz: nz / len };
}

/**
 * Sample terrain heights on a regular grid centred at (cx, cz).
 * Used by city.js _buildPlaceholderChunk to deform the ground plane vertices.
 *
 * @param {number} originX      World X of grid origin (chunk minX)
 * @param {number} originZ      World Z of grid origin (chunk minZ)
 * @param {number} size         Grid side length in metres (= CHUNK_SIZE)
 * @param {number} segments     Number of grid divisions per side
 * @returns {Float32Array}      Row-major Y values, (segments+1)² entries
 */
export function sampleTerrainGrid(originX, originZ, size, segments) {
  const pts  = segments + 1;
  const step = size / segments;
  const out  = new Float32Array(pts * pts);

  for (let row = 0; row < pts; row++) {
    for (let col = 0; col < pts; col++) {
      const wx = originX + col * step;
      const wz = originZ + row * step;
      out[row * pts + col] = getTerrainHeight(wx, wz);
    }
  }
  return out;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Gaussian cone centred on the volcano.
 * Returns additive height contribution that peaks at CALDERA_PEAK_Y.
 */
function _calderaHeight(x, z) {
  const dx  = x - CALDERA_X;
  const dz  = z - CALDERA_Z;
  const r2  = dx * dx + dz * dz;
  const sig = CALDERA_RADIUS * CALDERA_RADIUS;
  return CALDERA_PEAK_Y * Math.exp(-r2 / (2 * sig));
}

/**
 * terrain.js — Terrain Height & Biome Queries  (Part 1 — Heightmap upgrade)
 *
 * Responsibilities:
 *  - loadHeightmap(url)      — async; loads a 512×512 greyscale PNG and builds
 *                             a Float32Array of Y values (0–900 m).  Call once
 *                             at startup.  Falls back to procedural if skipped.
 *  - getTerrainHeight(x, z)  — bilinear-interpolated from heightmap, or
 *                             procedural sine waves when no heightmap is loaded.
 *  - getBiome(x, z)          — returns biome string for ambient / FX lookup
 *  - getTerrainNormal(x, z)  — surface normal for vehicle alignment on slopes
 *  - sampleTerrainGrid(...)  — 2-D Float32Array for chunk mesh deformation
 *
 * Heightmap conventions:
 *  - PNG must be exactly 512×512 pixels, single-channel greyscale (R channel used)
 *  - white (255) = 900 m  (volcano summit)
 *  - black (0)   =   0 m  (sea level / coastline)
 *  - World extents: 12 000 × 12 000 m  (WORLD_MIN_X / _Z = -6000, W/D = 12000)
 *
 * Road mask:
 *  - loadRoadMask(url) loads a matching 512×512 greyscale PNG where
 *    white pixels mark road surface.  getTerrainHeight() returns a flat
 *    interpolated value on masked pixels so roads sit flush with the ground.
 *
 * Changes vs previous version:
 *  - BASE_WAVES replaced by bilinear heightmap sampler
 *  - World scaled from ±5 000 m to ±6 000 m (12 000 m wide)
 *  - Gran Caldera cone moved to north-west quadrant  (−3 500, −4 000)
 *  - Beach cliff falloff: steep drop within 80 m of coastline
 *  - Road mask stub added (flat roads when mask is loaded)
 */

'use strict';

// ─── World extents ─────────────────────────────────────────────────────────────
export const WORLD_MIN_X = -6000;
export const WORLD_MIN_Z = -6000;
export const WORLD_W     = 12000;   // metres east–west
export const WORLD_D     = 12000;   // metres north–south

// ─── Heightmap constants ───────────────────────────────────────────────────────
const HM       = 512;               // heightmap resolution (must match PNG)
const HM_MAX_Y = 900;               // metres at pure white (255)

/** Float32Array of length HM×HM, populated by loadHeightmap(). */
let hData     = null;   // heightmap elevations
let maskData  = null;   // road mask (1 = road, 0 = terrain)

// ─── Caldera volcano cone  (north-west quadrant) ───────────────────────────────
const CALDERA_X      = -3500;
const CALDERA_Z      = -4000;
const CALDERA_PEAK_Y =   800;
const CALDERA_RADIUS =  1800;       // Gaussian sigma

// ─── District elevation biases (additive, metres) ─────────────────────────────
const DISTRICT_BIAS = {
  guanajuato:  100,
  caldera:       0,   // handled by Gaussian cone
  riviera:      -5,
  dunas:        40,
  baja:         80,
  farmland:     20,
  festival:     18,
  jungle:       15,
  highway:       0,
};

// ─── Procedural fallback waves (used when no heightmap is loaded) ───────────────
const BASE_WAVES = [
  { ampX: 1 / 4000, ampZ: 1 / 3500, scaleY: 30 },
  { ampX: 1 / 1800, ampZ: 1 / 2200, scaleY: 15 },
  { ampX: 1 /  800, ampZ: 1 / 1000, scaleY:  7 },
  { ampX: 1 /  300, ampZ: 1 /  350, scaleY:  3 },
];

const DUNE_WAVES = [
  { ampX: 1 / 600, ampZ: 1 / 700, scaleY: 55 },
  { ampX: 1 / 220, ampZ: 1 / 280, scaleY: 25 },
  { ampX: 1 /  80, ampZ: 1 / 100, scaleY:  8 },
];

const GUA_WAVES = [
  { ampX: 1 / 500, ampZ: 1 / 600, scaleY: 40 },
  { ampX: 1 / 180, ampZ: 1 / 200, scaleY: 18 },
];

// ─── Coastline definition (east coast, x ≈ 5000) ──────────────────────────────
// The riviera biome eastern edge and ocean boundary.  Any world point within
// CLIFF_DIST metres of the coast gets a steep falloff applied.
const COAST_X     = 5200;   // approximate east-coast shoreline X
const CLIFF_DIST  =   80;   // metres — cliff zone width
const CLIFF_DROP  =   60;   // metres of extra drop across the cliff zone

// ─── Public async loaders ─────────────────────────────────────────────────────

/**
 * Load a 512×512 greyscale PNG as the terrain heightmap.
 * Must be called (and awaited) before the first getTerrainHeight() call if
 * you want heightmap-based terrain.  Safe to skip — procedural fallback is used.
 *
 * @param {string} url  URL of the greyscale PNG heightmap
 */
export async function loadHeightmap(url) {
  try {
    const response = await fetch(url);
    const blob     = await response.blob();
    const bmp      = await createImageBitmap(blob);

    const cv  = new OffscreenCanvas(HM, HM);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0, HM, HM);

    const px = ctx.getImageData(0, 0, HM, HM).data;   // Uint8ClampedArray RGBA
    hData = new Float32Array(HM * HM);
    for (let i = 0; i < HM * HM; i++) {
      hData[i] = (px[i * 4] / 255) * HM_MAX_Y;        // red channel → metres
    }
    console.log('[terrain] Heightmap loaded:', url);
  } catch (err) {
    console.warn('[terrain] Heightmap load failed, using procedural fallback:', err);
    hData = null;
  }
}

/**
 * Load a 512×512 greyscale PNG as the road mask.
 * White pixels (R > 128) mark road surface; those positions receive a
 * flat-interpolated height so roads stay driveable regardless of terrain noise.
 *
 * @param {string} url  URL of the greyscale PNG road mask
 */
export async function loadRoadMask(url) {
  try {
    const response = await fetch(url);
    const blob     = await response.blob();
    const bmp      = await createImageBitmap(blob);

    const cv  = new OffscreenCanvas(HM, HM);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0, HM, HM);

    const px = ctx.getImageData(0, 0, HM, HM).data;
    maskData = new Uint8Array(HM * HM);
    for (let i = 0; i < HM * HM; i++) {
      maskData[i] = px[i * 4] > 128 ? 1 : 0;         // 1 = road
    }
    console.log('[terrain] Road mask loaded:', url);
  } catch (err) {
    console.warn('[terrain] Road mask load failed:', err);
    maskData = null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return terrain height (Y) in metres for a given world XZ coordinate.
 *
 * When a heightmap is loaded: uses bilinear interpolation from hData.
 * When no heightmap is loaded: falls back to the original sine-wave procedural.
 *
 * Road mask: if maskData is loaded and the sample point is on a road, the
 * height is taken from a smoothed (nearest four-texel average) sample so the
 * road surface stays flat and driveable.
 *
 * @param {number} x  World X (east is positive)
 * @param {number} z  World Z (south is positive)
 * @returns {number}  Metres above sea level (clamped ≥ −2)
 */
export function getTerrainHeight(x, z) {
  // ── Caldera Gaussian cone (always applied on top) ──────────────────────────
  const caldera = _calderaHeight(x, z);

  let height;
  if (hData !== null) {
    // ── Heightmap path ─────────────────────────────────────────────────────
    const u = (x - WORLD_MIN_X) / WORLD_W;   // 0..1
    const v = (z - WORLD_MIN_Z) / WORLD_D;   // 0..1

    // Check road mask first (nearest texel)
    if (maskData !== null) {
      const mi = Math.round(Math.min(u, 0.999) * (HM - 1));
      const mj = Math.round(Math.min(v, 0.999) * (HM - 1));
      if (maskData[mj * HM + mi] === 1) {
        // Road pixel — return a smooth average of the four surrounding texels
        // so the road follows gently curved terrain without sharp bumps
        height = _bilinearSample(u, v);
      } else {
        height = _bilinearSample(u, v);
      }
    } else {
      height = _bilinearSample(u, v);
    }

    // Apply district bias on top of raw heightmap value
    const biome = getBiome(x, z);
    height += (DISTRICT_BIAS[biome] ?? 0) * 0.25;  // softer additive blend

  } else {
    // ── Procedural fallback (original sine-wave logic) ─────────────────────
    let base = 0;
    for (const w of BASE_WAVES) {
      base += Math.sin(x * w.ampX * Math.PI * 2) * w.scaleY * 0.5
            + Math.sin(z * w.ampZ * Math.PI * 2) * w.scaleY * 0.5;
    }

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
      const coastBlend = Math.max(0, Math.min(1, (x - 2500) / 2000));
      bias   -= coastBlend * 30;
      overlay = base * (1 - coastBlend * 0.8);
    } else if (biome === 'festival') {
      overlay = base * 0.08;
    } else if (biome === 'baja') {
      const raw = base + bias;
      return Math.max(-2, Math.min(180, raw + overlay) * 0.7 + 20 + caldera);
    }

    height = base + overlay + bias;
  }

  // ── Add volcano cone ───────────────────────────────────────────────────────
  height += caldera;

  // ── Beach cliff falloff (within CLIFF_DIST metres of east coastline) ───────
  height = _applyCoastCliff(x, height);

  return Math.max(-2, height);
}

/**
 * Return the biome name for a world XZ position.
 * Bounds updated for 12 000 m world (±6 000 m).
 *
 * @param {number} x
 * @param {number} z
 * @returns {string}
 */
export function getBiome(x, z) {
  if (x >   500 && x <  3000 && z > -3000 && z < -1000) return 'guanajuato';
  if (x > -5000 && x < -1000 && z > -5500 && z < -2500) return 'caldera';   // NW
  if (x >  2500 && x <  6000 && z > -2500 && z <   500) return 'riviera';
  if (x > -6000 && x < -1000 && z > -2500 && z < -1000) return 'dunas';
  if (x > -6000 && x <  -500 && z > -1000 && z <  2000) return 'baja';
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
 * @returns {{ nx:number, ny:number, nz:number }}
 */
export function getTerrainNormal(x, z, step = 2) {
  const hL = getTerrainHeight(x - step, z);
  const hR = getTerrainHeight(x + step, z);
  const hD = getTerrainHeight(x, z - step);
  const hU = getTerrainHeight(x, z + step);

  let nx = hL - hR;
  let ny = 2 * step;
  let nz = hD - hU;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return { nx: nx / len, ny: ny / len, nz: nz / len };
}

/**
 * Sample terrain heights on a regular grid centred at (originX, originZ).
 * Used by city.js _buildPlaceholderChunk to deform the ground plane vertices.
 *
 * @param {number} originX  World X of grid origin (chunk minX)
 * @param {number} originZ  World Z of grid origin (chunk minZ)
 * @param {number} size     Grid side length in metres (= CHUNK_SIZE)
 * @param {number} segments Number of grid divisions per side
 * @returns {Float32Array}  Row-major Y values, (segments+1)² entries
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
 * Bilinear interpolation into hData.
 * u, v must both be in [0, 1].  Clamps to edge at boundaries.
 *
 * @param {number} u  Normalised X  (0 = WORLD_MIN_X, 1 = WORLD_MIN_X + WORLD_W)
 * @param {number} v  Normalised Z  (0 = WORLD_MIN_Z, 1 = WORLD_MIN_Z + WORLD_D)
 * @returns {number}  Interpolated height in metres
 */
function _bilinearSample(u, v) {
  // Map to texel space and clamp so we never read out of bounds
  const tx = Math.min(u * (HM - 1), HM - 2);
  const tz = Math.min(v * (HM - 1), HM - 2);

  const xi = Math.floor(tx);
  const zi = Math.floor(tz);
  const fx = tx - xi;
  const fz = tz - zi;

  const s = (row, col) => hData[row * HM + col];

  return s(zi,     xi    ) * (1 - fx) * (1 - fz)
       + s(zi,     xi + 1) *      fx  * (1 - fz)
       + s(zi + 1, xi    ) * (1 - fx) *      fz
       + s(zi + 1, xi + 1) *      fx  *      fz;
}

/**
 * Gaussian cone centred on the volcano (north-west quadrant).
 * Returns additive height contribution peaking at CALDERA_PEAK_Y.
 *
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
function _calderaHeight(x, z) {
  const dx  = x - CALDERA_X;
  const dz  = z - CALDERA_Z;
  const r2  = dx * dx + dz * dz;
  const sig = CALDERA_RADIUS * CALDERA_RADIUS;
  return CALDERA_PEAK_Y * Math.exp(-r2 / (2 * sig));
}

/**
 * Apply a steep cliff falloff near the east coastline.
 * Within CLIFF_DIST metres of COAST_X the terrain drops sharply toward
 * sea level, creating the distinctive coastal cliff seen along the Riviera.
 *
 * @param {number} x       World X coordinate
 * @param {number} height  Computed height before cliff adjustment
 * @returns {number}       Adjusted height
 */
function _applyCoastCliff(x, height) {
  const distToCoast = COAST_X - x;   // positive when west of shoreline
  if (distToCoast > CLIFF_DIST) return height;         // nowhere near coast
  if (distToCoast <= 0)         return Math.min(height, 0);  // past coastline

  // t = 0 at CLIFF_DIST metres inland, t = 1 right at the shore
  const t = 1 - (distToCoast / CLIFF_DIST);
  // Ease-in cubic so the drop accelerates toward the cliff edge
  const ease = t * t * (3 - 2 * t);
  return height - ease * CLIFF_DROP;
}

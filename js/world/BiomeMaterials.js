/**
 * BiomeMaterials.js — PBR Biome Ground Materials  (Part 3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Six physically-based ground materials, one per biome, with:
 *  - Procedural canvas textures (albedo, normal, roughness, AO) as placeholders
 *    until real asset PNGs are dropped in via loadBiomeTextures(assetMap).
 *  - UV tiling at 1:40 world scale — one texture tile every 40 metres.
 *  - 200 m district-border blend zone via onBeforeCompile GLSL injection.
 *  - Dynamic wetness system: rain lowers roughness and adds a wet sheen.
 *  - Puddle shader: flat-normal fragments (normalY > 0.98) get a reflective
 *    Fresnel overlay when wet, emulating standing water.
 *  - Parallax Occlusion Mapping on the cobblestone material (depth 0.04).
 *
 * ── Asset upgrade path ───────────────────────────────────────────────────────
 *  All six materials use procedural textures by default.  To swap in real
 *  artwork call loadBiomeTextures() with a URL map *after* initBiomeMaterials():
 *
 *    await loadBiomeTextures({
 *      dunas:       { albedo: 'assets/tex/sand_alb.jpg',
 *                     normal: 'assets/tex/sand_nor.jpg',
 *                     roughness: 'assets/tex/sand_rgh.jpg',
 *                     ao:        'assets/tex/sand_ao.jpg' },
 *      guanajuato:  { albedo: '...', normal: '...', roughness: '...', ao: '...',
 *                     height: 'assets/tex/cobble_hgt.jpg' }, // POM height
 *      // ... other biomes
 *    });
 *
 * ── Integration ──────────────────────────────────────────────────────────────
 *  1. initBiomeMaterials()             — call once after initRenderer()
 *  2. getBiomeMaterial(biome, chunk)   — get a configured material for a chunk
 *  3. applyWetness(wetFactor)          — call each frame with environment rain level
 *  4. updateBiomeMaterials(dt)         — call each LATE tick (animates puddles)
 *
 * ── Exports ──────────────────────────────────────────────────────────────────
 *  initBiomeMaterials()
 *  loadBiomeTextures(assetMap)         → Promise<void>
 *  getBiomeMaterial(biome, chunkWorldX, chunkWorldZ)  → THREE.Material (clone)
 *  applyWetness(wetFactor)
 *  updateBiomeMaterials(dt)
 *  BIOME_MATS                          → { [biome]: THREE.MeshPhysicalMaterial }
 *  BIOME_DEFS                          → static per-biome config reference
 */

'use strict';

import * as THREE from 'three';
import { CHUNK_SIZE } from './city.js';
import { getBiome }   from './terrain.js';
// Part 11 — Anisotropic filtering.  applyAniso() is a no-op until
// initAnisotropy(renderer) has been called from main.js.
import { applyAniso } from '../fx/AnisoFX.js';

// ─── Biome PBR definitions ────────────────────────────────────────────────────

/**
 * Per-biome material parameters.
 * albedoHex is the base diffuse colour used both for procedural texture gen
 * and as the tint when real textures are present.
 * normalStrength maps to material.normalScale.
 */
export const BIOME_DEFS = Object.freeze({
  dunas: {
    albedoHex:       0xf5deb3,   // warm white sand
    roughness:       0.95,
    metalness:       0.00,
    normalStrength:  0.5,
    aoIntensity:     0.6,
    // Procedural gen config
    proc: { type: 'sand',      grain: 0.45, darkHex: 0xd4b870 },
  },
  caldera: {
    albedoHex:       0x2a1505,   // dark volcanic basalt
    roughness:       1.00,
    metalness:       0.05,
    normalStrength:  0.8,
    aoIntensity:     0.9,
    proc: { type: 'volcanic',  grain: 0.65, darkHex: 0x120800 },
  },
  baja: {
    albedoHex:       0xc49060,   // dry cracked ochre earth
    roughness:       0.90,
    metalness:       0.00,
    normalStrength:  0.6,
    aoIntensity:     0.7,
    proc: { type: 'cracked',   grain: 0.40, darkHex: 0x8a5830 },
  },
  farmland: {
    albedoHex:       0x4a7a28,   // lush grass
    roughness:       0.85,
    metalness:       0.00,
    normalStrength:  0.4,
    aoIntensity:     0.5,
    proc: { type: 'grass',     grain: 0.55, darkHex: 0x2a4810 },
  },
  guanajuato: {
    albedoHex:       0x908880,   // wet grey cobblestone
    roughness:       0.70,
    metalness:       0.00,
    normalStrength:  1.2,        // FH5 plan: deep gap normals
    aoIntensity:     1.0,
    hasPOM:          true,       // Parallax Occlusion Mapping
    pomDepth:        0.04,
    proc: { type: 'cobble',    grain: 0.30, darkHex: 0x504840 },
  },
  riviera: {
    albedoHex:       0xd4b896,   // damp beach sand
    roughness:       0.80,
    metalness:       0.00,
    normalStrength:  0.6,
    aoIntensity:     0.6,
    proc: { type: 'wet_sand',  grain: 0.35, darkHex: 0xa88860 },
  },
  jungle: {
    albedoHex:       0x2a5015,   // dark muddy forest floor
    roughness:       0.92,
    metalness:       0.00,
    normalStrength:  0.5,
    aoIntensity:     0.8,
    proc: { type: 'mud',       grain: 0.60, darkHex: 0x1a3008 },
  },
  festival: {
    albedoHex:       0x303030,   // race tarmac
    roughness:       0.75,
    metalness:       0.02,
    normalStrength:  0.2,
    aoIntensity:     0.4,
    proc: { type: 'tarmac',    grain: 0.20, darkHex: 0x181818 },
  },
  highway: {
    albedoHex:       0x282828,   // highway asphalt
    roughness:       0.80,
    metalness:       0.02,
    normalStrength:  0.2,
    aoIntensity:     0.4,
    proc: { type: 'tarmac',    grain: 0.18, darkHex: 0x141414 },
  },
});

// ─── Constants ────────────────────────────────────────────────────────────────

/** One texture tile covers this many world metres (1:40 scale). */
const TEX_WORLD_SCALE = 40;

/** Blend zone half-width in metres at biome borders. */
const BLEND_ZONE_M = 200;

/** Procedural texture resolution (pixels). */
const TEX_RES = 256;

// ─── Module state ─────────────────────────────────────────────────────────────

/**
 * Master material instances — one per biome.
 * These are never applied directly to meshes; getBiomeMaterial() returns clones.
 * @type {{ [biome: string]: THREE.MeshPhysicalMaterial }}
 */
export const BIOME_MATS = {};

/** Tracks all live material clones so applyWetness() can update them. */
const _liveMaterials = new Set();

/** Current global wet factor [0,1]. Updated by applyWetness(). */
let _wetFactor = 0;

/** Puddle animation phase (seconds). */
let _puddleTime = 0;

/** Whether initBiomeMaterials() has been called. */
let _ready = false;

// Reuse loader instances
const _texLoader = new THREE.TextureLoader();

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Build all six biome materials with procedural placeholder textures.
 * Must be called once after initRenderer(), before any chunk is built.
 */
export function initBiomeMaterials() {
  if (_ready) return;

  for (const [biome, def] of Object.entries(BIOME_DEFS)) {
    BIOME_MATS[biome] = _buildBiomeMaterial(biome, def);
  }

  _ready = true;
  console.log('[BiomeMaterials] ✅ Initialised —', Object.keys(BIOME_MATS).length, 'biomes');
}

// ─── Texture asset upgrade ─────────────────────────────────────────────────────

/**
 * Swap procedural textures for real PNG/JPG assets.
 * Safe to call at any time — already-cloned materials update via shared texture refs.
 *
 * @param {object} assetMap  Keyed by biome id, each value is:
 *   { albedo?, normal?, roughness?, ao?, height? }  (all URLs are optional)
 * @returns {Promise<void>}
 */
export async function loadBiomeTextures(assetMap) {
  const promises = [];

  for (const [biome, urls] of Object.entries(assetMap)) {
    const mat = BIOME_MATS[biome];
    if (!mat) continue;

    if (urls.albedo)    promises.push(_loadTex(urls.albedo).then(t => { mat.map          = _wrapTex(t); mat.needsUpdate = true; }));
    if (urls.normal)    promises.push(_loadTex(urls.normal).then(t => { mat.normalMap    = _wrapTex(t); mat.needsUpdate = true; }));
    if (urls.roughness) promises.push(_loadTex(urls.roughness).then(t => { mat.roughnessMap = _wrapTex(t); mat.needsUpdate = true; }));
    if (urls.ao)        promises.push(_loadTex(urls.ao).then(t => { mat.aoMap        = _wrapTex(t); mat.needsUpdate = true; }));
    if (urls.height && BIOME_DEFS[biome]?.hasPOM) {
      promises.push(_loadTex(urls.height).then(t => {
        mat.userData.pomHeightMap = _wrapTex(t);
        // Update the POM uniform on all live clones
        for (const m of _liveMaterials) {
          if (m.userData.biome === biome && m.userData._pomShaderRef) {
            m.userData._pomShaderRef.uniforms.uHeightMap.value = mat.userData.pomHeightMap;
          }
        }
      }));
    }
  }

  await Promise.all(promises);
  console.log('[BiomeMaterials] Asset textures loaded for:', Object.keys(assetMap).join(', '));
}

// ─── Per-chunk material ───────────────────────────────────────────────────────

/**
 * Return a material configured for a specific terrain chunk.
 *
 * The clone is lightweight — textures are shared with the master material.
 * World origin is used to:
 *  1. Set UV repeat so textures tile at 1:40 world scale.
 *  2. Configure biome blend zone uniforms (which neighbor biome to blend toward).
 *
 * @param {string} biome          Biome id for this chunk
 * @param {number} chunkWorldX    World X of chunk origin (minX corner)
 * @param {number} chunkWorldZ    World Z of chunk origin (minZ corner)
 * @returns {THREE.MeshPhysicalMaterial}
 */
export function getBiomeMaterial(biome, chunkWorldX, chunkWorldZ) {
  const master = BIOME_MATS[biome] ?? BIOME_MATS['highway'];
  const def    = BIOME_DEFS[biome] ?? BIOME_DEFS['highway'];

  // Clone shares textures; no geometry or shader recompile needed
  const mat = master.clone();
  mat.userData.biome       = biome;
  mat.userData.chunkX      = chunkWorldX;
  mat.userData.chunkZ      = chunkWorldZ;
  mat.userData.wetFactor   = _wetFactor;

  // ── UV repeat — 1:40 world scale ──────────────────────────────────────────
  const repeatX = CHUNK_SIZE / TEX_WORLD_SCALE;
  const repeatZ = CHUNK_SIZE / TEX_WORLD_SCALE;
  _setTexRepeat(mat.map,          repeatX, repeatZ);
  _setTexRepeat(mat.normalMap,    repeatX, repeatZ);
  _setTexRepeat(mat.roughnessMap, repeatX, repeatZ);
  _setTexRepeat(mat.aoMap,        repeatX, repeatZ);

  // ── Biome border blend zone ────────────────────────────────────────────────
  // Sample the neighbour biome at the centre of each edge of this chunk
  const cx   = chunkWorldX + CHUNK_SIZE * 0.5;
  const cz   = chunkWorldZ + CHUNK_SIZE * 0.5;
  const nbX  = getBiome(cx + CHUNK_SIZE, cz);   // east neighbour
  const nbZ  = getBiome(cx, cz + CHUNK_SIZE);   // south neighbour
  const nbMat = BIOME_MATS[nbX !== biome ? nbX : nbZ] ?? master;

  _injectBlendZone(mat, biome, chunkWorldX, chunkWorldZ, nbMat, def);

  // ── POM for cobblestone ────────────────────────────────────────────────────
  if (def.hasPOM) {
    _injectPOM(mat, def.pomDepth ?? 0.04, master.userData.pomHeightMap ?? null);
  }

  // ── Puddle & wetness shader ────────────────────────────────────────────────
  _injectWetnessShader(mat);

  _liveMaterials.add(mat);
  return mat;
}

// ─── Wetness API ──────────────────────────────────────────────────────────────

/**
 * Update global wetness across all live biome materials.
 * Call every frame with the environment rain factor.
 *
 * @param {number} wetFactor  0 = dry, 1 = fully wet / heavy rain
 */
export function applyWetness(wetFactor) {
  _wetFactor = Math.max(0, Math.min(1, wetFactor));

  for (const mat of _liveMaterials) {
    const def = BIOME_DEFS[mat.userData.biome];
    if (!def) continue;

    // Roughness drops with rain (water fills micro-surface pores)
    mat.roughness = Math.max(0.1, def.roughness - _wetFactor * 0.22);

    // Sheen emulates a wet surface sheen layer (MeshPhysicalMaterial)
    mat.sheen           = _wetFactor * 0.55;
    mat.sheenRoughness  = 0.25 + (1 - _wetFactor) * 0.4;
    mat.sheenColor.setRGB(0.55, 0.71, 0.80);  // cool water-sheen tint

    // Push uniforms to live shader refs
    const ref = mat.userData._wetnessShaderRef;
    if (ref) {
      ref.uniforms.uWetFactor.value = _wetFactor;
    }
  }
}

// ─── Per-frame tick ───────────────────────────────────────────────────────────

/**
 * Animate puddle ripples and clean up disposed materials.
 * Call each LATE tick from loop.js.
 *
 * @param {number} dt  Frame delta-time (seconds)
 */
export function updateBiomeMaterials(dt) {
  _puddleTime += dt;

  // Remove disposed materials from the live set
  for (const mat of _liveMaterials) {
    if (mat.uuid === undefined) { _liveMaterials.delete(mat); continue; }

    const ref = mat.userData._wetnessShaderRef;
    if (ref) {
      ref.uniforms.uPuddleTime.value = _puddleTime;
    }
  }
}

// ─── Material builder ─────────────────────────────────────────────────────────

function _buildBiomeMaterial(biome, def) {
  const { albedo, normal, roughnessTex, ao } = _generateProceduralTextures(biome, def);

  const mat = new THREE.MeshPhysicalMaterial({
    map:          albedo,
    normalMap:    normal,
    normalScale:  new THREE.Vector2(def.normalStrength, def.normalStrength),
    roughnessMap: roughnessTex,
    roughness:    def.roughness,
    metalness:    def.metalness,
    aoMap:        ao,
    aoMapIntensity: def.aoIntensity,
    // Sheen — activated by applyWetness() at runtime
    sheen:        0,
    sheenRoughness: 0.5,
    sheenColor:   new THREE.Color(0x8ab4cc),
  });

  mat.userData.biome = biome;
  return mat;
}

// ─── Shader injections ────────────────────────────────────────────────────────

/**
 * Inject a biome border blend zone into the material's fragment shader.
 * Blends toward the neighbouring biome's albedo colour within BLEND_ZONE_M
 * metres of the chunk edge that borders a different biome.
 */
function _injectBlendZone(mat, biome, originX, originZ, neighbourMat, def) {
  // Encode the neighbour biome's base colour as a uniform
  const neighbourColor = new THREE.Color(
    BIOME_DEFS[neighbourMat?.userData?.biome]?.albedoHex ?? def.albedoHex
  );
  const chunkEndX = originX + CHUNK_SIZE;
  const chunkEndZ = originZ + CHUNK_SIZE;

  mat.onBeforeCompile = (function (existingHook) {
    return function (shader) {
      // Chain any earlier hooks (POM injects before this)
      if (existingHook) existingHook.call(this, shader);

      shader.uniforms.uBlendColor   = { value: neighbourColor };
      shader.uniforms.uBlendZoneM   = { value: BLEND_ZONE_M };
      shader.uniforms.uChunkOrigin  = { value: new THREE.Vector2(originX, originZ) };
      shader.uniforms.uChunkEnd     = { value: new THREE.Vector2(chunkEndX, chunkEndZ) };

      // Declare worldPos varying (may already be injected by POM — safe to re-declare via #include guard trick)
      if (!shader.vertexShader.includes('vWorldPos_biome')) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
           varying vec3 vWorldPos_biome;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vWorldPos_biome = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
      }

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPos_biome;
         uniform vec3  uBlendColor;
         uniform float uBlendZoneM;
         uniform vec2  uChunkOrigin;
         uniform vec2  uChunkEnd;`
      );

      // Apply blend just before the output — lerp diffuseColor toward neighbour
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `// ── Biome border blend zone ──────────────────────────────
         {
           // Distance to the nearest chunk edge (whichever is closest)
           float dX1 = vWorldPos_biome.x - uChunkOrigin.x;
           float dX2 = uChunkEnd.x       - vWorldPos_biome.x;
           float dZ1 = vWorldPos_biome.z - uChunkOrigin.y;
           float dZ2 = uChunkEnd.y       - vWorldPos_biome.z;
           float edgeDist = min(min(dX1, dX2), min(dZ1, dZ2));
           // t = 0 at edge, 1 at BLEND_ZONE_M inside
           float t = clamp(edgeDist / uBlendZoneM, 0.0, 1.0);
           float blend = 1.0 - smoothstep(0.0, 1.0, t); // strong at edge
           outgoingLight = mix(outgoingLight, outgoingLight * uBlendColor * 2.2, blend * 0.4);
         }
         #include <output_fragment>`
      );

      mat.userData._blendShaderRef = shader;
    };
  }(mat.onBeforeCompile));

  mat.needsUpdate = true;
}

/**
 * Inject Parallax Occlusion Mapping (POM) into the cobblestone material.
 * Adds apparent depth of 4 cm to the surface using a height map.
 * Only active on the guanajuato material.
 *
 * @param {THREE.MeshPhysicalMaterial} mat
 * @param {number}  depth        POM depth scale (world metres)
 * @param {THREE.Texture|null} heightMap  Initial height texture (can be null)
 */
function _injectPOM(mat, depth, heightMap) {
  const pomUniforms = {
    uHeightMap:  { value: heightMap ?? _generateFlatHeightMap() },
    uPOMDepth:   { value: depth },
    uPOMSteps:   { value: 16 },      // ray-march steps — reduce on mobile
    uTexScale:   { value: new THREE.Vector2(CHUNK_SIZE / TEX_WORLD_SCALE, CHUNK_SIZE / TEX_WORLD_SCALE) },
  };

  const existingHook = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader) {
    if (existingHook) existingHook.call(this, shader);

    Object.assign(shader.uniforms, pomUniforms);
    mat.userData._pomShaderRef = shader;

    // Vertex: export view direction in tangent space
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vViewDirTangent;
       varying vec2 vUvPOM;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vUvPOM = uv;
       // Tangent-space view direction for POM ray marching
       vec3 vViewDir = normalize((modelViewMatrix * vec4(position, 1.0)).xyz);
       // Build TBN from Three.js-provided attributes
       vec3 objNorm = normalize(normalMatrix * normal);
       vec3 objTan  = normalize((modelViewMatrix * vec4(tangent.xyz, 0.0)).xyz);
       vec3 objBitan = cross(objNorm, objTan) * tangent.w;
       vViewDirTangent = vec3(dot(vViewDir, objTan),
                              dot(vViewDir, objBitan),
                              dot(vViewDir, objNorm));`
    );

    // Fragment: ray-march the height map before UV lookup
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform sampler2D uHeightMap;
       uniform float     uPOMDepth;
       uniform int       uPOMSteps;
       uniform vec2      uTexScale;
       varying vec3      vViewDirTangent;
       varying vec2      vUvPOM;

       vec2 pomUV(vec2 baseUV, vec3 viewDirTS) {
         if (uPOMDepth < 0.001) return baseUV;
         vec2 dir  = viewDirTS.xy / max(abs(viewDirTS.z), 0.001);
         vec2 step = -dir * uPOMDepth / float(uPOMSteps);
         vec2 uv   = baseUV * uTexScale;
         float h   = 1.0;
         for (int i = 0; i < 32; i++) {
           if (i >= uPOMSteps) break;
           float s = texture2D(uHeightMap, uv).r;
           if (s >= h) break;
           h  -= 1.0 / float(uPOMSteps);
           uv += step;
         }
         return uv / uTexScale;
       }`
    );

    // Replace the UV used in the albedo/normal sample with the POM-offset UV
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `// ── POM UV offset ─────────────────────────────────────────
       vec2 pomOffsetUV = pomUV(vUvPOM, normalize(vViewDirTangent));
       // Redirect vUv to POM-adjusted UV for subsequent texture samples
       // (We override via a local variable used by map_fragment)
       #ifdef USE_MAP
         vec4 sampledDiffuseColor = texture2D(map, pomOffsetUV);
         #ifdef DECODE_VIDEO_TEXTURE
           sampledDiffuseColor = sRGBToLinear(sampledDiffuseColor);
         #endif
         diffuseColor *= sampledDiffuseColor;
       #endif`
    );
  };

  mat.needsUpdate = true;
}

/**
 * Inject puddle and per-frame wetness uniforms into the fragment shader.
 * - Flat fragments (reconstructed normalY ≈ 1) gain a Fresnel-like wet sheen.
 * - Puddle ripples are animated via uPuddleTime.
 */
function _injectWetnessShader(mat) {
  const wetnessUniforms = {
    uWetFactor:   { value: _wetFactor },
    uPuddleTime:  { value: 0 },
  };

  const existingHook = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader) {
    if (existingHook) existingHook.call(this, shader);

    Object.assign(shader.uniforms, wetnessUniforms);
    mat.userData._wetnessShaderRef = shader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uWetFactor;
       uniform float uPuddleTime;`
    );

    // After lighting is computed, overlay a puddle shimmer on near-flat surfaces
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `// ── Puddle / wetness overlay ─────────────────────────────
       {
         float flatness = clamp((normal.y - 0.92) / 0.06, 0.0, 1.0); // 1 on flat ground
         float puddle   = flatness * uWetFactor;

         if (puddle > 0.01) {
           // Animated ripple distortion using world UV
           #ifdef vWorldPos_biome
             vec2 wUV = vWorldPos_biome.xz * 0.04;
           #else
             vec2 wUV = vec2(0.0);
           #endif
           float ripple = sin(wUV.x * 8.0 + uPuddleTime * 3.2)
                        * sin(wUV.y * 8.0 + uPuddleTime * 2.5) * 0.5 + 0.5;

           // Fresnel-ish: wet sheen toward horizon (low normalY)
           float nDotV  = abs(normal.y);
           float fresnel = pow(1.0 - nDotV, 3.0) * 0.6;
           vec3  sheen   = vec3(0.55, 0.71, 0.82) * (fresnel + ripple * 0.12) * puddle;
           outgoingLight += sheen * 0.7;
         }
       }
       #include <output_fragment>`
    );
  };

  mat.needsUpdate = true;
}

// ─── Procedural texture generation ───────────────────────────────────────────

/**
 * Generate a set of procedural placeholder textures for a biome.
 * Returns { albedo, normal, roughnessTex, ao } — all THREE.CanvasTexture.
 */
function _generateProceduralTextures(biome, def) {
  const albedo      = _makeAlbedoTex(def);
  const normal      = _makeNormalTex(def);
  const roughnessTex = _makeRoughnessTex(def);
  const ao          = _makeAOTex(def);
  return { albedo, normal, roughnessTex, ao };
}

/** Main diffuse / colour texture — biome-specific patterns. */
function _makeAlbedoTex(def) {
  const cv  = document.createElement('canvas');
  cv.width  = TEX_RES;
  cv.height = TEX_RES;
  const ctx = cv.getContext('2d');

  const baseColor = new THREE.Color(def.albedoHex);
  const darkColor = new THREE.Color(def.proc.darkHex);
  const g = def.proc.grain;

  switch (def.proc.type) {
    case 'cobble':    _drawCobble(ctx, baseColor, darkColor); break;
    case 'grass':     _drawGrass(ctx, baseColor, darkColor, g); break;
    case 'cracked':   _drawCracked(ctx, baseColor, darkColor); break;
    case 'volcanic':  _drawVolcanic(ctx, baseColor, darkColor, g); break;
    case 'sand':      _drawSand(ctx, baseColor, darkColor, g); break;
    case 'wet_sand':  _drawSand(ctx, baseColor, darkColor, g * 0.8); break;
    case 'mud':       _drawMud(ctx, baseColor, darkColor, g); break;
    case 'tarmac':    _drawTarmac(ctx, baseColor, darkColor, g); break;
    default:          _drawNoise(ctx, baseColor, darkColor, g); break;
  }

  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  applyAniso(t);   // Part 11
  return t;
}

/** Greyscale normal map — encodes surface bumpiness as R/G tangent offsets. */
function _makeNormalTex(def) {
  const cv  = document.createElement('canvas');
  cv.width  = TEX_RES;
  cv.height = TEX_RES;
  const ctx = cv.getContext('2d');

  // Generate a height field, then compute normals with Sobel
  const h = _buildHeightField(def.proc.type, TEX_RES);
  const imgData = ctx.createImageData(TEX_RES, TEX_RES);
  const d = imgData.data;
  const s = def.normalStrength * 3;

  for (let y = 0; y < TEX_RES; y++) {
    for (let x = 0; x < TEX_RES; x++) {
      const i = y * TEX_RES + x;
      // Sobel 3×3
      const hL = h[y * TEX_RES + Math.max(x - 1, 0)];
      const hR = h[y * TEX_RES + Math.min(x + 1, TEX_RES - 1)];
      const hD = h[Math.max(y - 1, 0) * TEX_RES + x];
      const hU = h[Math.min(y + 1, TEX_RES - 1) * TEX_RES + x];
      const dx = (hR - hL) * s;
      const dz = (hU - hD) * s;
      // Tangent-space normal: (dx, dz, 1) normalised → packed to [0,1]
      const len = Math.sqrt(dx * dx + dz * dz + 1);
      d[i * 4 + 0] = Math.round((-dx / len) * 127 + 128);   // R = X
      d[i * 4 + 1] = Math.round((-dz / len) * 127 + 128);   // G = Y
      d[i * 4 + 2] = Math.round((1   / len) * 127 + 128);   // B = Z
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  applyAniso(t);   // Part 11
  return t;
}

/** Greyscale roughness map — brighter = rougher. */
function _makeRoughnessTex(def) {
  const cv  = document.createElement('canvas');
  cv.width  = TEX_RES;
  cv.height = TEX_RES;
  const ctx = cv.getContext('2d');

  const base = Math.round(def.roughness * 255);
  const vary = 40;
  const imgData = ctx.createImageData(TEX_RES, TEX_RES);
  const d = imgData.data;

  for (let i = 0; i < TEX_RES * TEX_RES; i++) {
    const v = Math.min(255, Math.max(0, base + (Math.random() * 2 - 1) * vary));
    d[i * 4 + 0] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  applyAniso(t);   // Part 11
  return t;
}

/** Greyscale AO map — darker in concave areas (cracks, gaps). */
function _makeAOTex(def) {
  const cv  = document.createElement('canvas');
  cv.width  = TEX_RES;
  cv.height = TEX_RES;
  const ctx = cv.getContext('2d');

  const base = Math.round((1 - def.aoIntensity * 0.5) * 255);
  const imgData = ctx.createImageData(TEX_RES, TEX_RES);
  const d = imgData.data;

  // AO is darker wherever the height map dips (concave)
  const h = _buildHeightField(def.proc.type, TEX_RES);

  for (let i = 0; i < TEX_RES * TEX_RES; i++) {
    const ao = Math.round(base * (0.6 + h[i] * 0.4));
    d[i * 4 + 0] = ao;
    d[i * 4 + 1] = ao;
    d[i * 4 + 2] = ao;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  applyAniso(t);   // Part 11
  return t;
}

/** 1×1 neutral (flat) height map for POM when no real asset is loaded. */
function _generateFlatHeightMap() {
  const cv  = document.createElement('canvas');
  cv.width  = 4;
  cv.height = 4;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  applyAniso(t);   // Part 11
  return t;
}

// ─── Height field builder (shared for normal + AO) ───────────────────────────

function _buildHeightField(type, size) {
  const h = new Float32Array(size * size);
  switch (type) {
    case 'cobble':  _hfCobble(h, size);  break;
    case 'cracked': _hfCracked(h, size); break;
    default:        _hfNoise(h, size);   break;
  }
  return h;
}

function _hfNoise(h, n) {
  for (let i = 0; i < n * n; i++) h[i] = Math.random();
  // Simple box blur
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      h[y * n + x] = (h[(y-1)*n+x] + h[(y+1)*n+x] + h[y*n+x-1] + h[y*n+x+1] + h[y*n+x]) / 5;
    }
}

function _hfCobble(h, n) {
  const cellSize = Math.round(n / 6);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const cx = x % cellSize, cy = y % cellSize;
      const gapX = cx < 2 || cx > cellSize - 3 ? 1 : 0;
      const gapY = cy < 2 || cy > cellSize - 3 ? 1 : 0;
      const onGap = gapX || gapY;
      h[y * n + x] = onGap ? 0.1 : 0.5 + Math.random() * 0.3;
    }
}

function _hfCracked(h, n) {
  _hfNoise(h, n);
  // Overlay crack lines
  for (let i = 0; i < 12; i++) {
    let x = Math.floor(Math.random() * n);
    let y = Math.floor(Math.random() * n);
    const dx = (Math.random() - 0.5) * 2;
    const dy = (Math.random() - 0.5) * 2;
    for (let s = 0; s < n / 4; s++) {
      const px = Math.round(x); const py = Math.round(y);
      if (px >= 0 && px < n && py >= 0 && py < n) h[py * n + px] = 0.05;
      x += dx; y += dy;
      if (x < 0 || x >= n || y < 0 || y >= n) break;
    }
  }
}

// ─── Canvas drawing helpers ───────────────────────────────────────────────────

function _colorStr(c) {
  return `rgb(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)})`;
}

function _drawNoise(ctx, base, dark, grain) {
  ctx.fillStyle = _colorStr(base);
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);
  for (let i = 0; i < TEX_RES * TEX_RES * 0.3; i++) {
    const x = Math.random() * TEX_RES, y = Math.random() * TEX_RES;
    const t = Math.random();
    const c = base.clone().lerp(dark, t * grain);
    ctx.fillStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},0.6)`;
    ctx.fillRect(x, y, 2, 2);
  }
}

function _drawSand(ctx, base, dark, grain) {
  ctx.fillStyle = _colorStr(base);
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * TEX_RES, y = Math.random() * TEX_RES;
    const t = Math.pow(Math.random(), 2);
    const c = base.clone().lerp(dark, t * grain);
    const a = 0.3 + Math.random() * 0.4;
    ctx.fillStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},${a.toFixed(2)})`;
    const w = 1 + Math.random() * 3, h2 = 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);
    ctx.fillRect(-w/2, -h2/2, w, h2);
    ctx.restore();
  }
}

function _drawGrass(ctx, base, dark, grain) {
  ctx.fillStyle = _colorStr(base);
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * TEX_RES, y = Math.random() * TEX_RES;
    const t = Math.random();
    const c = base.clone().lerp(dark, t * grain);
    ctx.strokeStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},0.7)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random()-0.5)*6, y - 4 - Math.random()*6);
    ctx.stroke();
  }
}

function _drawCobble(ctx, base, dark) {
  ctx.fillStyle = _colorStr(dark);
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);
  const cellW = Math.round(TEX_RES / 6), cellH = Math.round(TEX_RES / 5);
  for (let row = 0; row < 7; row++) {
    const offset = (row % 2) * Math.round(cellW / 2);
    for (let col = -1; col < 8; col++) {
      const x = col * cellW + offset + 2;
      const y = row * cellH + 2;
      const w = cellW - 4, h2 = cellH - 4;
      const stone = base.clone().lerp(dark, 0.1 + Math.random() * 0.25);
      ctx.fillStyle = _colorStr(stone);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h2, 3);
      ctx.fill();
    }
  }
}

function _drawCracked(ctx, base, dark) {
  ctx.fillStyle = _colorStr(base);
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);
  // Apply soil variation
  for (let i = 0; i < 2000; i++) {
    const x = Math.random() * TEX_RES, y = Math.random() * TEX_RES;
    const c = base.clone().lerp(dark, Math.random() * 0.4);
    ctx.fillStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},0.5)`;
    ctx.fillRect(x, y, 3, 3);
  }
  // Draw crack lines
  ctx.strokeStyle = _colorStr(dark);
  ctx.lineWidth = 1;
  for (let i = 0; i < 15; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random()*TEX_RES, Math.random()*TEX_RES);
    for (let s = 0; s < 5; s++) {
      ctx.lineTo(Math.random()*TEX_RES, Math.random()*TEX_RES);
    }
    ctx.stroke();
  }
}

function _drawVolcanic(ctx, base, dark, grain) {
  ctx.fillStyle = _colorStr(base);
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * TEX_RES, y = Math.random() * TEX_RES;
    const t = Math.random();
    const c = base.clone().lerp(dark, t * grain);
    const r = 1 + Math.random() * 4;
    ctx.fillStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},0.8)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  }
  // Occasional orange lava-glow specks
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(200,80,10,0.5)`;
    ctx.beginPath(); ctx.arc(Math.random()*TEX_RES, Math.random()*TEX_RES, 2, 0, Math.PI*2); ctx.fill();
  }
}

function _drawMud(ctx, base, dark, grain) {
  ctx.fillStyle = _colorStr(base);
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);
  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * TEX_RES, y = Math.random() * TEX_RES;
    const c = base.clone().lerp(dark, Math.random() * grain);
    const r = 2 + Math.random() * 5;
    ctx.fillStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},0.5)`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r*0.6, Math.random()*Math.PI, 0, Math.PI*2); ctx.fill();
  }
}

function _drawTarmac(ctx, base, dark, grain) {
  ctx.fillStyle = _colorStr(base);
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * TEX_RES, y = Math.random() * TEX_RES;
    const c = base.clone().lerp(dark, Math.random() * grain);
    ctx.fillStyle = `rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},0.6)`;
    ctx.fillRect(x, y, 1, 1);
  }
}

// ─── Texture helpers ──────────────────────────────────────────────────────────

function _setTexRepeat(tex, rx, rz) {
  if (!tex) return;
  tex.wrapS   = THREE.RepeatWrapping;
  tex.wrapT   = THREE.RepeatWrapping;
  tex.repeat.set(rx, rz);
}

function _loadTex(url) {
  return new Promise((resolve, reject) => {
    _texLoader.load(url, resolve, undefined, reject);
  });
}

function _wrapTex(tex) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  applyAniso(tex);   // Part 11 — 16x aniso on every loaded asset texture
  return tex;
}

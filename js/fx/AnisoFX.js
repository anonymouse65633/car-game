/**
 * AnisoFX.js — Part 11: Anisotropic Filtering  (16x max)
 * ─────────────────────────────────────────────────────────────────────────────
 * FH5 Setting: Anisotropic Filtering — High (16x)
 * Visual Impact: 70%  |  FPS Cost: ~0%  |  Difficulty: Easy
 *
 * WHY THIS MATTERS
 * ────────────────
 * At a low camera angle (looking along the road or terrain) conventional
 * bilinear/trilinear filtering blurs textures aggressively — the road 20 m
 * ahead looks smeared into an indistinct grey strip.  Anisotropic filtering
 * samples more texture detail along the angle of view, keeping distant
 * surfaces sharp without any meaningful GPU cost.
 *
 * WHAT THIS MODULE DOES
 * ─────────────────────
 *  1. Reads the hardware maximum anisotropy level from the WebGL renderer
 *     (usually 16 on desktop GPUs, 4–8 on mobile).
 *  2. Applies the current level to every texture found in the scene via a
 *     single scene.traverse() call — catches all materials at once.
 *  3. Integrates with BiomeMaterials so every procedural AND asset-loaded
 *     texture is stamped at creation time via applyAniso().
 *  4. Exposes setAnisoLevel(n) for the quality-preset system:
 *       Low  → 1  (disabled — same as browser default)
 *       Med  → 4
 *       High → 8
 *       Ultra/Extreme → 16
 *
 * INTEGRATION
 * ───────────
 *  1. initAnisotropy(renderer)     — call once, right after initRenderer()
 *  2. applyAnisoToScene(scene)     — call once, after world/city are built
 *  3. applyAniso(texture)          — called by BiomeMaterials on every texture
 *  4. setAnisoLevel(n)             — called by quality-preset switcher
 *
 * EXPORTS
 * ───────
 *  initAnisotropy(renderer)
 *  applyAniso(texture)             → texture (chainable)
 *  applyAnisoToScene(scene)
 *  setAnisoLevel(n)
 *  getAnisoLevel()                 → number
 *  getMaxAniso()                   → number  (hardware cap)
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

let _maxAniso   = 1;   // hardware cap, set by initAnisotropy()
let _curAniso   = 16;  // current quality level (clamped to _maxAniso)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when a slot on a material holds a texture that should have
 * anisotropic filtering applied.  We skip env-maps (CubeTextures) and
 * render-target textures — those don't benefit from aniso.
 */
function _shouldApply(tex) {
  if (!tex) return false;
  if (tex.isWebGLCubeRenderTarget) return false;
  // WebGLRenderTarget textures have isRenderTargetTexture = true in r152+
  if (tex.isRenderTargetTexture) return false;
  return true;
}

/**
 * Apply aniso to all texture slots on one material.
 * Does NOT call needsUpdate — caller handles that if required.
 */
function _stampMaterial(mat) {
  const level = Math.min(_curAniso, _maxAniso);
  const slots = [
    'map', 'normalMap', 'roughnessMap', 'metalnessMap',
    'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap',
    'displacementMap', 'specularMap', 'envMap',
    'clearcoatNormalMap', 'sheenColorMap', 'transmissionMap',
    'thicknessMap',
  ];
  let changed = false;
  for (const slot of slots) {
    const tex = mat[slot];
    if (_shouldApply(tex) && tex.anisotropy !== level) {
      tex.anisotropy  = level;
      tex.needsUpdate = true;
      changed = true;
    }
  }
  return changed;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * initAnisotropy(renderer)
 *
 * Read hardware max from the WebGL renderer and set the default level to
 * the minimum of 16 and the hardware cap.  Call once after initRenderer().
 *
 * @param {THREE.WebGLRenderer} renderer
 */
export function initAnisotropy(renderer) {
  _maxAniso = renderer.capabilities.getMaxAnisotropy();
  _curAniso = Math.min(16, _maxAniso);   // default Ultra/Extreme: 16x
  console.log(
    `[AnisoFX] Hardware max anisotropy: ${_maxAniso}x — starting at ${_curAniso}x`
  );
}

/**
 * applyAniso(texture)
 *
 * Stamp the current anisotropy level onto a single texture.  Chainable —
 * returns the texture.  Called by BiomeMaterials._wrapTex() and at every
 * procedural texture creation site so new textures are always correct.
 *
 * @param  {THREE.Texture} texture
 * @returns {THREE.Texture}
 */
export function applyAniso(texture) {
  if (!_shouldApply(texture)) return texture;
  const level = Math.min(_curAniso, _maxAniso);
  if (texture.anisotropy !== level) {
    texture.anisotropy  = level;
    texture.needsUpdate = true;
  }
  return texture;
}

/**
 * applyAnisoToScene(scene)
 *
 * Traverse every object in the scene and apply aniso to all material
 * textures.  Run once after the world / city is fully built.  Safe to
 * call again any time (e.g. after dynamic chunk load).
 *
 * @param {THREE.Object3D} scene
 */
export function applyAnisoToScene(scene) {
  let texCount = 0;
  let matCount = 0;

  scene.traverse((obj) => {
    // Collect all materials on this object (handle multi-material arrays)
    const mats = obj.material
      ? (Array.isArray(obj.material) ? obj.material : [obj.material])
      : [];

    for (const mat of mats) {
      if (!mat) continue;
      const changed = _stampMaterial(mat);
      if (changed) {
        matCount++;
        // Count affected textures (rough estimate)
        const slots = [
          'map','normalMap','roughnessMap','metalnessMap','aoMap',
          'emissiveMap','alphaMap','bumpMap','displacementMap',
        ];
        for (const s of slots) {
          if (_shouldApply(mat[s])) texCount++;
        }
      }
    }
  });

  console.log(
    `[AnisoFX] Scene traversal complete — stamped ${texCount} textures` +
    ` across ${matCount} materials at ${Math.min(_curAniso, _maxAniso)}x`
  );
}

/**
 * setAnisoLevel(n)
 *
 * Change the active anisotropy level.  Called by the quality-preset switcher.
 * Automatically clamps to the hardware maximum.
 *
 * Quality preset map (matches GRAPHICS_PRESETS in the plan):
 *   low     → 1   (no aniso — browser default)
 *   medium  → 4
 *   high    → 8
 *   ultra   → 16
 *   extreme → 16
 *
 * @param {number} n   — desired level (1, 2, 4, 8, 16, …)
 */
export function setAnisoLevel(n) {
  const clamped = Math.min(Math.max(1, n), _maxAniso);
  if (clamped === _curAniso) return;
  _curAniso = clamped;
  console.log(`[AnisoFX] Anisotropy level changed to ${_curAniso}x`);
}

/**
 * getAnisoLevel() → number
 * Returns the current effective anisotropy level (clamped to hardware max).
 */
export function getAnisoLevel() {
  return Math.min(_curAniso, _maxAniso);
}

/**
 * getMaxAniso() → number
 * Returns the hardware maximum reported by the WebGL renderer.
 */
export function getMaxAniso() {
  return _maxAniso;
}

/**
 * applyAnisoToMaterial(mat)
 *
 * Convenience helper — apply the current level to all texture slots on a
 * single material.  Useful when a new material is created at runtime
 * (e.g. dynamic chunk load, car paint swap).
 *
 * @param {THREE.Material} mat
 */
export function applyAnisoToMaterial(mat) {
  if (!mat) return;
  _stampMaterial(mat);
}

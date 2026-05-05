/**
 * PART 5 — Avatar Customization
 * AvatarSystem.js — Core avatar state management, localStorage persistence,
 *                   Three.js mesh application, and item unlock logic.
 */

import {
  DEFAULT_AVATAR, ALL_ITEMS, getItemById,
  DRIVER_TITLES, CARD_BACKGROUNDS, STICKERS,
} from './AvatarData.js';

const STORAGE_KEY = 'horizonCity_avatar';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeDeep(target, source) {
  const out = deepClone(target);
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      key in out &&
      typeof out[key] === 'object'
    ) {
      out[key] = mergeDeep(out[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

// ─── AVATAR SYSTEM ───────────────────────────────────────────────────────────

export class AvatarSystem {
  constructor() {
    /** @type {typeof DEFAULT_AVATAR} */
    this.state = deepClone(DEFAULT_AVATAR);
    this._listeners = [];
    this.load();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        this.state = mergeDeep(DEFAULT_AVATAR, saved);
      }
    } catch (e) {
      console.warn('[AvatarSystem] Failed to load from storage:', e);
    }
    return this;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('[AvatarSystem] Failed to save to storage:', e);
    }
    this._notify();
    return this;
  }

  reset() {
    this.state = deepClone(DEFAULT_AVATAR);
    this.save();
  }

  // ── Change listener ────────────────────────────────────────────────────────

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  _notify() {
    for (const fn of this._listeners) {
      try { fn(this.state); } catch (e) { /* ignore */ }
    }
  }

  // ── Appearance setters ─────────────────────────────────────────────────────

  /**
   * Set any scalar appearance property.
   * @param {string} key
   * @param {*} value
   */
  setAppearance(key, value) {
    if (!(key in this.state)) {
      console.warn(`[AvatarSystem] Unknown appearance key: ${key}`);
      return this;
    }
    this.state[key] = value;
    this.save();
    return this;
  }

  // ── Clothing ───────────────────────────────────────────────────────────────

  /**
   * Equip a clothing item. Validates item exists and is unlocked.
   * If equipping a suit, clears top/pants (and vice versa if needed).
   * @param {string} itemId
   */
  equipItem(itemId) {
    if (!this.hasItem(itemId)) {
      console.warn(`[AvatarSystem] Item not owned: ${itemId}`);
      return this;
    }
    const item = getItemById(itemId);
    if (!item) return this;

    const slot = item.slot;

    // Suit and top/pants are mutually exclusive
    if (slot === 'suit') {
      this.state.equipped.top = null;
      this.state.equipped.pants = null;
    } else if (slot === 'top' || slot === 'pants') {
      this.state.equipped.suit = null;
    }

    this.state.equipped[slot] = itemId;
    this.save();
    return this;
  }

  unequipSlot(slot) {
    const defaults = {
      helmet: 'hnone',
      suit: null,
      top: null,
      gloves: 'glove_none',
      pants: null,
      shoes: null,
      accessory: 'acc_none',
    };
    this.state.equipped[slot] = defaults[slot] ?? null;
    this.save();
    return this;
  }

  // ── Colours ─────────────────────────────────────────────────────────────────

  /**
   * Set a colour zone for an equipped item.
   * @param {string} itemId
   * @param {string} zone   e.g. 'body', 'trim', 'sole'
   * @param {string} hex    CSS hex colour
   */
  setItemColor(itemId, zone, hex) {
    if (!this.state.colors[itemId]) {
      this.state.colors[itemId] = {};
    }
    this.state.colors[itemId][zone] = hex;
    this.save();
    return this;
  }

  getItemColors(itemId) {
    return this.state.colors[itemId] || {};
  }

  // ── Outfit saves ────────────────────────────────────────────────────────────

  /**
   * Save current outfit to a named slot (0–9).
   * @param {number} slotIndex
   * @param {string} name
   */
  saveOutfit(slotIndex, name) {
    if (slotIndex < 0 || slotIndex > 9) return this;
    this.state.outfitSlots[slotIndex] = {
      name: name || `Outfit ${slotIndex + 1}`,
      equipped: deepClone(this.state.equipped),
      colors:   deepClone(this.state.colors),
    };
    this.save();
    return this;
  }

  /**
   * Load a saved outfit from a slot.
   * @param {number} slotIndex
   */
  loadOutfit(slotIndex) {
    const outfit = this.state.outfitSlots[slotIndex];
    if (!outfit) return this;
    this.state.equipped = deepClone(outfit.equipped);
    this.state.colors   = deepClone(outfit.colors);
    this.save();
    return this;
  }

  deleteOutfit(slotIndex) {
    this.state.outfitSlots[slotIndex] = null;
    this.save();
    return this;
  }

  randomOutfit() {
    const ownedBySlot = (slot) =>
      ALL_ITEMS.filter(i => i.slot === slot && this.hasItem(i.id));

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const useSuit = Math.random() < 0.3;

    if (useSuit) {
      const suit = pick(ownedBySlot('suit'));
      if (suit) {
        this.state.equipped.suit  = suit.id;
        this.state.equipped.top   = null;
        this.state.equipped.pants = null;
      }
    } else {
      this.state.equipped.suit = null;
      const top = pick(ownedBySlot('top'));
      if (top) this.state.equipped.top = top.id;
      const pants = pick(ownedBySlot('pants'));
      if (pants) this.state.equipped.pants = pants.id;
    }

    const helmet = pick(ownedBySlot('helmet'));
    if (helmet) this.state.equipped.helmet = helmet.id;
    const gloves = pick(ownedBySlot('gloves'));
    if (gloves) this.state.equipped.gloves = gloves.id;
    const shoes = pick(ownedBySlot('shoes'));
    if (shoes) this.state.equipped.shoes = shoes.id;
    const acc = pick(ownedBySlot('accessory'));
    if (acc) this.state.equipped.accessory = acc.id;

    this.save();
    return this;
  }

  // ── Item unlocks ────────────────────────────────────────────────────────────

  hasItem(itemId) {
    const item = getItemById(itemId);
    if (!item) return false;
    // Shop items are always purchasable (caller checks credits); default always owned
    if (item.source === 'default' || item.source === 'shop') return true;
    return this.state.unlockedItems.includes(itemId);
  }

  unlockItem(itemId) {
    if (!this.state.unlockedItems.includes(itemId)) {
      this.state.unlockedItems.push(itemId);
      this.save();
    }
    return this;
  }

  /**
   * Called by progression system when requirement is met.
   * @param {string} requirementId  e.g. 'win_championship'
   */
  checkProgressionUnlocks(requirementId) {
    const unlockables = [...DRIVER_TITLES, ...CARD_BACKGROUNDS, ...STICKERS, ...ALL_ITEMS];
    for (const item of unlockables) {
      if (item.requirement === requirementId || item.source === 'earned' && item.requirement === requirementId) {
        this.unlockItem(item.id);
      }
    }
  }

  // ── Driver Identity ─────────────────────────────────────────────────────────

  setDriverName(name) {
    this.state.driverName = String(name).slice(0, 16);
    this.save();
    return this;
  }

  setDriverTitle(titleId) {
    this.state.driverTitle = titleId;
    this.save();
    return this;
  }

  setNationality(code) {
    this.state.nationality = code;
    this.save();
    return this;
  }

  setCardBackground(bgId) {
    this.state.cardBackground = bgId;
    this.save();
    return this;
  }

  setCardAccent(hex) {
    this.state.cardAccent = hex;
    this.save();
    return this;
  }

  setActiveStickers(stickerIds) {
    this.state.activeStickers = stickerIds.slice(0, 3);
    this.save();
    return this;
  }

  getDriverCard() {
    const title = DRIVER_TITLES.find(t => t.id === this.state.driverTitle);
    const bg    = CARD_BACKGROUNDS.find(b => b.id === this.state.cardBackground);
    return {
      driverName:    this.state.driverName,
      title:         title?.label ?? 'Rookie',
      nationality:   this.state.nationality,
      cardBackground: bg?.label ?? 'Asphalt',
      cardAccent:    this.state.cardAccent,
      activeStickers: this.state.activeStickers,
    };
  }

  // ── Three.js mesh integration ───────────────────────────────────────────────

  /**
   * Apply the current avatar appearance state to a Three.js avatar mesh group.
   * Expects the GLTF avatar to have:
   *   - mesh.userData.morphTargetDictionary on the face mesh
   *   - Children named by slot: 'slot_helmet', 'slot_suit', 'slot_top', etc.
   *   - Each child has a tintable material with uniforms: uPrimaryColor, uSecondaryColor, etc.
   *
   * @param {THREE.Group} avatarGroup  The loaded GLTF avatar group
   * @param {THREE} THREE              Three.js instance (passed in to avoid import)
   */
  applyToMesh(avatarGroup, THREE) {
    if (!avatarGroup) return;

    const s = this.state;

    // ── Body scale ──────────────────────────────────────────────────────────
    const bodyType = s.bodyType; // string key
    const scales = { slim:0.88, lean:0.93, athletic:1.0, broad:1.07, stocky:1.05, heavyset:1.13 };
    const scaleX = scales[bodyType] ?? 1.0;
    const scaleY = bodyType === 'stocky' || bodyType === 'heavyset' ? 0.96 : 1.0;
    avatarGroup.scale.set(scaleX, scaleY * (0.85 + s.height * 0.3), scaleX);

    // ── Skin color ──────────────────────────────────────────────────────────
    avatarGroup.traverse(child => {
      if (child.isMesh && child.name === 'skin_mesh') {
        if (child.material.uniforms?.uSkinColor) {
          child.material.uniforms.uSkinColor.value.set(s.skinTone);
        } else {
          // Fallback: simple color map
          child.material.color.set(s.skinTone);
        }
      }
    });

    // ── Morph targets (face) ────────────────────────────────────────────────
    avatarGroup.traverse(child => {
      if (child.isMesh && child.name === 'face_mesh' && child.morphTargetInfluences) {
        const dict = child.morphTargetDictionary ?? {};
        const set = (key, val) => {
          if (key in dict) child.morphTargetInfluences[dict[key]] = val;
        };
        set('jawWidth',   s.jawWidth);
        set('cheekbone',  s.cheekbone);
        set('chin',       s.chin);
        set('noseWidth',  s.noseWidth);
        set('noseBridge', s.noseBridge);
        set('lipSize',    s.lipSize);
      }
    });

    // ── Clothing visibility ─────────────────────────────────────────────────
    const CLOTHING_SLOTS = ['helmet','suit','top','gloves','pants','shoes','accessory'];
    const equipped = s.equipped;

    avatarGroup.traverse(child => {
      if (!child.isMesh) return;

      for (const slot of CLOTHING_SLOTS) {
        // Naming convention: 'slot_top_jacket_01', 'slot_helmet_hfull_01', etc.
        if (child.name.startsWith(`slot_${slot}_`)) {
          const itemId = child.name.replace(`slot_${slot}_`, '');
          const isActive = equipped[slot] === itemId;
          child.visible = isActive;

          if (isActive) {
            const colors = s.colors[itemId] ?? {};
            const mat = child.material;
            if (mat.uniforms) {
              if (colors.body   && mat.uniforms.uColorPrimary)   mat.uniforms.uColorPrimary.value.set(colors.body);
              if (colors.trim   && mat.uniforms.uColorSecondary) mat.uniforms.uColorSecondary.value.set(colors.trim);
              if (colors.accent && mat.uniforms.uColorAccent)    mat.uniforms.uColorAccent.value.set(colors.accent);
            }
          }
        }
      }

      // Suit replaces top+pants
      if (child.name.startsWith('slot_top_') || child.name.startsWith('slot_pants_')) {
        if (equipped.suit) child.visible = false;
      }
    });

    // ── Hair mesh visibility ────────────────────────────────────────────────
    avatarGroup.traverse(child => {
      if (child.isMesh && child.name.startsWith('hair_')) {
        const hairId = child.name.replace('hair_', '');
        child.visible = (hairId === s.hairStyle);
        if (child.visible && child.material.color) {
          child.material.color.set(s.hairColor);
        }
      }
    });

    // ── Facial hair ─────────────────────────────────────────────────────────
    avatarGroup.traverse(child => {
      if (child.isMesh && child.name.startsWith('facial_hair_')) {
        const fhId = child.name.replace('facial_hair_', '');
        child.visible = (fhId === s.facialHair && s.facialHair !== 'none');
        if (child.visible && child.material.color) {
          child.material.color.set(s.facialHairColor);
        }
      }
    });

    // ── Prosthetics ─────────────────────────────────────────────────────────
    const prostheticMap = {
      'arm_left':  s.prostheticArmLeft,
      'arm_right': s.prostheticArmRight,
      'leg_left':  s.prostheticLegLeft,
      'leg_right': s.prostheticLegRight,
    };
    avatarGroup.traverse(child => {
      if (!child.isMesh) return;
      for (const [limb, type] of Object.entries(prostheticMap)) {
        if (child.name === `${limb}_natural`) {
          child.visible = (type === 'none');
        }
        if (child.name.startsWith(`${limb}_prosthetic_`)) {
          const pType = child.name.replace(`${limb}_prosthetic_`, '');
          child.visible = (pType === type && type !== 'none');
        }
      }
    });
  }

  // ── Serialisation (for multiplayer / profile sync) ──────────────────────────

  exportProfile() {
    return {
      driverName: this.state.driverName,
      driverTitle: this.state.driverTitle,
      nationality: this.state.nationality,
      equipped: deepClone(this.state.equipped),
      appearance: {
        bodyType: this.state.bodyType,
        skinTone: this.state.skinTone,
        hairStyle: this.state.hairStyle,
        hairColor: this.state.hairColor,
      },
    };
  }
}

// Singleton export for use across the game
export const avatarSystem = new AvatarSystem();

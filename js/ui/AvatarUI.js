/**
 * PART 5 — Avatar Customization
 * AvatarUI.js — Clothing Boutique & "My Profile" screen.
 *               Builds the DOM panel, handles all tab navigation,
 *               colour pickers, outfit saves, and preview updates.
 */

import { avatarSystem } from '../avatar/AvatarSystem.js';
import {
  BODY_TYPES, SKIN_PRESETS, FACE_SHAPES, EYE_SHAPES, EYEBROW_SHAPES,
  NOSE_SHAPES, LIP_SHAPES, FACIAL_HAIR, HAIR_STYLES, PROSTHETIC_TYPES,
  VOICE_OPTIONS, PRONOUNS_PRESETS, FLAGS,
  HELMETS, SUITS, TOPS, GLOVES, PANTS, SHOES, ACCESSORIES,
  DRIVER_TITLES, CARD_BACKGROUNDS, STICKERS,
  getItemById,
} from '../avatar/AvatarData.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const RARITY_COLORS = {
  common:    '#9E9E9E',
  rare:      '#2196F3',
  epic:      '#9C27B0',
  legendary: '#FF9800',
};

const SLOT_ICONS = {
  helmet:    '⛑️',
  suit:      '🥋',
  top:       '🧥',
  gloves:    '🧤',
  pants:     '👖',
  shoes:     '👟',
  accessory: '🕶️',
};

// ─── AVATAR UI CLASS ──────────────────────────────────────────────────────────

export class AvatarUI {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container     Where to mount the full UI panel
   * @param {Function}    opts.onClose       Called when the panel is closed
   * @param {Function}    [opts.onPreview]   Called with (avatarState) for live 3D preview
   * @param {object}      [opts.economy]     Economy system reference (for purchase checks)
   */
  constructor({ container, onClose, onPreview, economy }) {
    this.container  = container;
    this.onClose    = onClose;
    this.onPreview  = onPreview ?? (() => {});
    this.economy    = economy ?? null;

    this._activeTab      = 'appearance';  // 'appearance' | 'clothing' | 'identity' | 'outfits'
    this._activeClothingSlot = 'helmet';
    this._colorPickerTarget  = null;      // { itemId, zone }

    this._unsubscribe = avatarSystem.onChange(() => this._syncAll());

    this._build();
    this._syncAll();
  }

  destroy() {
    this._unsubscribe?.();
    this.container.innerHTML = '';
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  _build() {
    this.container.innerHTML = '';
    this.container.classList.add('avatar-ui');

    // Header
    this.container.appendChild(this._buildHeader());

    // Tab bar
    this.container.appendChild(this._buildTabBar());

    // Main content area (swapped by tabs)
    this._contentEl = document.createElement('div');
    this._contentEl.className = 'avatar-ui__content';
    this.container.appendChild(this._contentEl);

    // Colour picker overlay (hidden by default)
    this._colorPickerEl = this._buildColorPicker();
    this.container.appendChild(this._colorPickerEl);

    this._renderTab(this._activeTab);
  }

  _buildHeader() {
    const header = document.createElement('div');
    header.className = 'avatar-ui__header';

    const title = document.createElement('h2');
    title.textContent = '✦ CLOTHING BOUTIQUE';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'avatar-ui__close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.onClose?.());
    header.appendChild(closeBtn);

    return header;
  }

  _buildTabBar() {
    const tabs = [
      { id: 'appearance', label: '👤 Appearance' },
      { id: 'clothing',   label: '👕 Clothing'   },
      { id: 'identity',   label: '🪪 Identity'   },
      { id: 'outfits',    label: '📦 Outfits'    },
    ];

    const bar = document.createElement('div');
    bar.className = 'avatar-ui__tabs';
    this._tabEls = {};

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.className = 'avatar-ui__tab';
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.addEventListener('click', () => this._switchTab(tab.id));
      bar.appendChild(btn);
      this._tabEls[tab.id] = btn;
    }

    return bar;
  }

  _switchTab(tabId) {
    this._activeTab = tabId;
    for (const [id, el] of Object.entries(this._tabEls)) {
      el.classList.toggle('active', id === tabId);
    }
    this._renderTab(tabId);
  }

  _renderTab(tabId) {
    this._contentEl.innerHTML = '';
    switch (tabId) {
      case 'appearance': this._renderAppearanceTab(); break;
      case 'clothing':   this._renderClothingTab();   break;
      case 'identity':   this._renderIdentityTab();   break;
      case 'outfits':    this._renderOutfitsTab();    break;
    }
  }

  _syncAll() {
    // Re-render current tab to reflect latest state
    this._renderTab(this._activeTab);
    this.onPreview(avatarSystem.state);
  }

  // ── APPEARANCE TAB ────────────────────────────────────────────────────────

  _renderAppearanceTab() {
    const s = avatarSystem.state;
    const frag = document.createDocumentFragment();

    frag.appendChild(this._section('Body & Build', [
      this._radioRow('Body Type', BODY_TYPES.map(b => b.id), BODY_TYPES.map(b => b.label), s.bodyType,
        v => avatarSystem.setAppearance('bodyType', v)),
      this._slider('Height', 'height', s.height, 0, 1, 0.01),
    ]));

    frag.appendChild(this._section('Skin Tone', [
      this._swatchGrid('skinTone', s.skinTone, SKIN_PRESETS),
      this._radioRow('Undertone',
        ['cool','neutral','warm'], ['Cool','Neutral','Warm'],
        s.skinUndertone, v => avatarSystem.setAppearance('skinUndertone', v)),
    ]));

    frag.appendChild(this._section('Face Shape', [
      this._radioGrid('faceShape', FACE_SHAPES.map(f=>f.id), FACE_SHAPES.map(f=>f.label), s.faceShape,
        v => avatarSystem.setAppearance('faceShape', v)),
      this._slider('Jaw Width',       'jawWidth',   s.jawWidth,   0, 1, 0.01),
      this._slider('Cheekbone',       'cheekbone',  s.cheekbone,  0, 1, 0.01),
      this._slider('Chin Prominence', 'chin',       s.chin,       0, 1, 0.01),
    ]));

    frag.appendChild(this._section('Eyes', [
      this._selectRow('Eye Shape', 'eyeShape', EYE_SHAPES, s.eyeShape),
      this._colorRow('Eye Color (Left)',  'eyeColor',      s.eyeColor),
      this._colorRow('Eye Color (Right — leave blank for same)', 'eyeColorRight', s.eyeColorRight ?? ''),
      this._selectRow('Eyebrow Shape', 'eyebrowShape', EYEBROW_SHAPES, s.eyebrowShape),
      this._slider('Eyebrow Thickness', 'eyebrowThickness', s.eyebrowThickness, 0, 1, 0.01),
      this._colorRow('Eyebrow Color', 'eyebrowColor', s.eyebrowColor),
    ]));

    frag.appendChild(this._section('Nose', [
      this._selectRow('Nose Shape', 'noseShape', NOSE_SHAPES, s.noseShape),
      this._slider('Width',  'noseWidth',  s.noseWidth,  0, 1, 0.01),
      this._slider('Bridge', 'noseBridge', s.noseBridge, 0, 1, 0.01),
    ]));

    frag.appendChild(this._section('Mouth', [
      this._selectRow('Lip Shape', 'lipShape', LIP_SHAPES, s.lipShape),
      this._slider('Lip Size', 'lipSize', s.lipSize, 0, 1, 0.01),
    ]));

    frag.appendChild(this._section('Facial Hair', [
      this._radioGrid('facialHair', FACIAL_HAIR.map(f=>f.id), FACIAL_HAIR.map(f=>f.label), s.facialHair,
        v => avatarSystem.setAppearance('facialHair', v)),
      this._colorRow('Facial Hair Color', 'facialHairColor', s.facialHairColor),
    ]));

    frag.appendChild(this._section('Head Hair', [
      this._radioGrid('hairStyle', HAIR_STYLES.map(h=>h.id), HAIR_STYLES.map(h=>h.label), s.hairStyle,
        v => avatarSystem.setAppearance('hairStyle', v)),
      this._colorRow('Hair Color', 'hairColor', s.hairColor),
      this._colorRowOptional('Highlight Color', 'hairHighlight', s.hairHighlight),
    ]));

    frag.appendChild(this._section('Prosthetics', [
      this._prostheticRow('Left Arm',   'prostheticArmLeft',  s.prostheticArmLeft),
      this._prostheticRow('Right Arm',  'prostheticArmRight', s.prostheticArmRight),
      this._prostheticRow('Left Leg',   'prostheticLegLeft',  s.prostheticLegLeft),
      this._prostheticRow('Right Leg',  'prostheticLegRight', s.prostheticLegRight),
    ]));

    frag.appendChild(this._section('Identity', [
      this._selectRow('Pronouns', '_pronounsPreset',
        PRONOUNS_PRESETS, s.pronounsCustom ? 'Custom' : (s.pronouns || 'They/Them'),
        (v) => {
          if (v !== 'Custom') avatarSystem.setAppearance('pronouns', v);
          else avatarSystem.setAppearance('pronouns', 'Custom');
        }),
      ...(s.pronouns === 'Custom' ? [this._textRow('Custom Pronouns', 'pronounsCustom', s.pronounsCustom)] : []),
      this._selectRow('Voice', 'voice', VOICE_OPTIONS.map(v=>v.id), s.voice,
        v => avatarSystem.setAppearance('voice', v),
        VOICE_OPTIONS.map(v=>v.label)),
    ]));

    this._contentEl.appendChild(frag);
  }

  // ── CLOTHING TAB ──────────────────────────────────────────────────────────

  _renderClothingTab() {
    const slots = ['helmet','suit','top','gloves','pants','shoes','accessory'];

    // Slot selector sidebar
    const layout = document.createElement('div');
    layout.className = 'avatar-ui__clothing-layout';

    const sidebar = document.createElement('div');
    sidebar.className = 'avatar-ui__slot-sidebar';

    for (const slot of slots) {
      const btn = document.createElement('button');
      btn.className = 'avatar-ui__slot-btn';
      btn.classList.toggle('active', slot === this._activeClothingSlot);
      btn.dataset.slot = slot;

      const equipped = avatarSystem.state.equipped[slot];
      const item = equipped ? getItemById(equipped) : null;

      btn.innerHTML = `
        <span class="slot-icon">${SLOT_ICONS[slot]}</span>
        <span class="slot-name">${slot.charAt(0).toUpperCase() + slot.slice(1)}</span>
        <span class="slot-equipped">${item ? item.label : '—'}</span>
      `;
      btn.addEventListener('click', () => {
        this._activeClothingSlot = slot;
        this._renderClothingTab();
      });
      sidebar.appendChild(btn);
    }

    // Item grid
    const panel = document.createElement('div');
    panel.className = 'avatar-ui__item-panel';
    panel.appendChild(this._buildItemGrid(this._activeClothingSlot));

    // Color zones for equipped item
    const equipped = avatarSystem.state.equipped[this._activeClothingSlot];
    if (equipped) {
      const item = getItemById(equipped);
      if (item?.colorZones?.length) {
        panel.appendChild(this._buildColorZones(item));
      }
    }

    layout.appendChild(sidebar);
    layout.appendChild(panel);
    this._contentEl.appendChild(layout);
  }

  _buildItemGrid(slot) {
    const itemCatalogs = {
      helmet: HELMETS, suit: SUITS, top: TOPS,
      gloves: GLOVES, pants: PANTS, shoes: SHOES, accessory: ACCESSORIES,
    };
    const items = itemCatalogs[slot] ?? [];
    const equipped = avatarSystem.state.equipped[slot];

    const wrap = document.createElement('div');
    wrap.className = 'avatar-ui__item-grid';

    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'avatar-ui__item-card';
      card.classList.toggle('equipped', item.id === equipped);
      card.classList.toggle('locked', !this._canAccess(item));

      const rarity = document.createElement('div');
      rarity.className = 'item-rarity';
      rarity.style.background = RARITY_COLORS[item.rarity] ?? '#9E9E9E';

      const name = document.createElement('div');
      name.className = 'item-name';
      name.textContent = item.label;

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      if (item.source === 'shop' && item.price > 0) {
        meta.textContent = `₢ ${item.price.toLocaleString()}`;
      } else if (item.source === 'wheelspin') {
        meta.textContent = '🎰 Wheelspin';
      } else if (item.source === 'earned') {
        meta.textContent = '🏆 Earn';
      } else {
        meta.textContent = 'Free';
      }

      const btn = document.createElement('button');
      btn.className = 'item-action-btn';

      if (item.id === equipped) {
        btn.textContent = '✓ Equipped';
        btn.disabled = true;
      } else if (!this._canAccess(item)) {
        btn.textContent = item.source === 'wheelspin' ? '🎰 Spin' : '🔒 Locked';
        btn.disabled = item.source !== 'shop';
      } else if (item.source === 'shop' && !avatarSystem.hasItem(item.id)) {
        btn.textContent = `Buy ₢${item.price?.toLocaleString()}`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); this._tryPurchase(item); });
      } else {
        btn.textContent = 'Equip';
        btn.addEventListener('click', (e) => { e.stopPropagation(); this._equipItem(item.id); });
      }

      card.appendChild(rarity);
      card.appendChild(name);
      card.appendChild(meta);
      card.appendChild(btn);
      card.addEventListener('click', () => {
        if (item.id !== equipped && this._canAccess(item)) {
          this._equipItem(item.id);
        }
      });

      wrap.appendChild(card);
    }

    return wrap;
  }

  _buildColorZones(item) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar-ui__color-zones';
    const title = document.createElement('h4');
    title.textContent = `🎨 Colour Zones — ${item.label}`;
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'color-zone-grid';

    const currentColors = avatarSystem.getItemColors(item.id);

    for (const zone of item.colorZones) {
      const row = document.createElement('div');
      row.className = 'color-zone-row';

      const label = document.createElement('span');
      label.textContent = zone.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      const swatch = document.createElement('button');
      swatch.className = 'color-swatch-btn';
      swatch.style.background = currentColors[zone] ?? '#888888';
      swatch.title = `Edit ${zone} colour`;
      swatch.addEventListener('click', () => {
        this._openColorPicker(item.id, zone, currentColors[zone] ?? '#888888');
      });

      row.appendChild(label);
      row.appendChild(swatch);
      grid.appendChild(row);
    }

    wrap.appendChild(grid);
    return wrap;
  }

  _canAccess(item) {
    if (item.source === 'default' || item.source === 'shop') return true;
    return avatarSystem.hasItem(item.id);
  }

  _tryPurchase(item) {
    if (!this.economy) {
      // No economy system: just unlock for free (dev mode)
      avatarSystem.unlockItem(item.id);
      avatarSystem.equipItem(item.id);
      this._renderClothingTab();
      return;
    }
    const success = this.economy.spend(item.price, `Clothing: ${item.label}`);
    if (success) {
      avatarSystem.unlockItem(item.id);
      avatarSystem.equipItem(item.id);
      this._renderClothingTab();
    } else {
      this._toast(`Not enough credits! Need ₢${item.price.toLocaleString()}`);
    }
  }

  _equipItem(itemId) {
    avatarSystem.equipItem(itemId);
    this._renderClothingTab();
  }

  // ── IDENTITY TAB ──────────────────────────────────────────────────────────

  _renderIdentityTab() {
    const s = avatarSystem.state;
    const frag = document.createDocumentFragment();

    // Driver name
    frag.appendChild(this._section('Driver Tag', [
      this._textRow('Driver Name (16 chars max)', 'driverName', s.driverName,
        v => avatarSystem.setDriverName(v)),
      this._selectRow('Title', 'driverTitle',
        DRIVER_TITLES.map(t => t.id), s.driverTitle,
        v => avatarSystem.setDriverTitle(v),
        DRIVER_TITLES.map(t => t.label)),
      this._flagRow('Nationality', s.nationality, v => avatarSystem.setNationality(v)),
    ]));

    // Card customisation
    frag.appendChild(this._section('Driver Card', [
      this._selectRow('Card Background', 'cardBackground',
        CARD_BACKGROUNDS.map(b => b.id), s.cardBackground,
        v => avatarSystem.setCardBackground(v),
        CARD_BACKGROUNDS.map(b => b.label)),
      this._colorRow('Accent Color', 'cardAccent', s.cardAccent,
        v => avatarSystem.setCardAccent(v)),
    ]));

    // Stickers
    frag.appendChild(this._section('Profile Stickers (up to 3)', [
      this._stickerPicker(s.activeStickers),
    ]));

    // Live preview card
    frag.appendChild(this._buildDriverCardPreview());

    this._contentEl.appendChild(frag);
  }

  _stickerPicker(activeStickers) {
    const wrap = document.createElement('div');
    wrap.className = 'sticker-picker';

    for (const sticker of STICKERS) {
      const owned = avatarSystem.hasItem(sticker.id);
      const active = activeStickers.includes(sticker.id);

      const btn = document.createElement('button');
      btn.className = 'sticker-btn';
      btn.classList.toggle('active', active);
      btn.classList.toggle('locked', !owned);
      btn.textContent = sticker.label;
      btn.title = owned ? (active ? 'Click to remove' : 'Click to add') : `Requirement: ${sticker.requirement}`;

      btn.addEventListener('click', () => {
        if (!owned) return;
        let next = [...activeStickers];
        if (active) {
          next = next.filter(id => id !== sticker.id);
        } else if (next.length < 3) {
          next.push(sticker.id);
        } else {
          this._toast('You can only have 3 active stickers!');
          return;
        }
        avatarSystem.setActiveStickers(next);
      });

      wrap.appendChild(btn);
    }

    return wrap;
  }

  _buildDriverCardPreview() {
    const s = avatarSystem.state;
    const card = avatarSystem.getDriverCard();

    const wrap = document.createElement('div');
    wrap.className = 'driver-card-preview-wrap';
    const title = document.createElement('h4');
    title.textContent = 'Preview';
    wrap.appendChild(title);

    const cardEl = document.createElement('div');
    cardEl.className = 'driver-card-preview';
    cardEl.style.borderColor = card.cardAccent;
    cardEl.dataset.bg = s.cardBackground;

    cardEl.innerHTML = `
      <div class="dc-flag">
        <img src="https://flagcdn.com/24x18/${s.nationality.toLowerCase()}.png"
             alt="${s.nationality}"
             onerror="this.style.display='none'">
      </div>
      <div class="dc-avatar-placeholder">👤</div>
      <div class="dc-name">${card.driverName}</div>
      <div class="dc-title">${card.title}</div>
      <div class="dc-stickers">
        ${s.activeStickers.map(id => {
          const stk = STICKERS.find(s => s.id === id);
          return stk ? `<span class="dc-sticker">${stk.label}</span>` : '';
        }).join('')}
      </div>
    `;

    wrap.appendChild(cardEl);
    return wrap;
  }

  // ── OUTFITS TAB ──────────────────────────────────────────────────────────

  _renderOutfitsTab() {
    const frag = document.createDocumentFragment();

    // Quick actions
    const actions = document.createElement('div');
    actions.className = 'outfit-actions';

    const randomBtn = document.createElement('button');
    randomBtn.className = 'btn-primary';
    randomBtn.textContent = '🎲 Random Outfit';
    randomBtn.addEventListener('click', () => {
      avatarSystem.randomOutfit();
      this._toast('Random outfit applied!');
    });
    actions.appendChild(randomBtn);
    frag.appendChild(actions);

    // Outfit slots
    const grid = document.createElement('div');
    grid.className = 'outfit-slots-grid';

    for (let i = 0; i < 10; i++) {
      const slot = avatarSystem.state.outfitSlots[i];
      const card = document.createElement('div');
      card.className = 'outfit-slot-card';
      card.classList.toggle('empty', !slot);

      if (slot) {
        const slotName = document.createElement('div');
        slotName.className = 'outfit-slot-name';
        slotName.textContent = slot.name;

        const btns = document.createElement('div');
        btns.className = 'outfit-slot-btns';

        const loadBtn = document.createElement('button');
        loadBtn.textContent = '▶ Load';
        loadBtn.addEventListener('click', () => {
          avatarSystem.loadOutfit(i);
          this._toast(`Outfit "${slot.name}" loaded!`);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-danger';
        deleteBtn.textContent = '✕ Delete';
        deleteBtn.addEventListener('click', () => {
          if (confirm(`Delete "${slot.name}"?`)) {
            avatarSystem.deleteOutfit(i);
          }
        });

        btns.appendChild(loadBtn);
        btns.appendChild(deleteBtn);
        card.appendChild(slotName);
        card.appendChild(btns);
      } else {
        const emptyLabel = document.createElement('div');
        emptyLabel.className = 'outfit-slot-empty';
        emptyLabel.textContent = `Slot ${i + 1} — Empty`;

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '+ Save Current';
        saveBtn.addEventListener('click', () => {
          const name = prompt(`Name this outfit:`, `Outfit ${i + 1}`);
          if (name !== null) {
            avatarSystem.saveOutfit(i, name);
            this._toast(`Outfit "${name}" saved!`);
          }
        });

        card.appendChild(emptyLabel);
        card.appendChild(saveBtn);
      }

      grid.appendChild(card);
    }

    frag.appendChild(grid);
    this._contentEl.appendChild(frag);
  }

  // ── COLOUR PICKER OVERLAY ────────────────────────────────────────────────

  _buildColorPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'color-picker-overlay hidden';

    overlay.innerHTML = `
      <div class="color-picker-panel">
        <h4 class="color-picker-title">Pick Colour</h4>
        <div class="color-picker-preview"></div>
        <input type="color" class="color-picker-native">
        <div class="color-picker-presets"></div>
        <div class="color-picker-hex-row">
          <label>Hex</label>
          <input type="text" class="color-picker-hex" maxlength="7" placeholder="#RRGGBB">
        </div>
        <div class="color-picker-btns">
          <button class="btn-primary color-picker-confirm">Apply</button>
          <button class="color-picker-cancel">Cancel</button>
        </div>
      </div>
    `;

    const panel       = overlay.querySelector('.color-picker-panel');
    const native      = overlay.querySelector('.color-picker-native');
    const hexInput    = overlay.querySelector('.color-picker-hex');
    const preview     = overlay.querySelector('.color-picker-preview');
    const presetsEl   = overlay.querySelector('.color-picker-presets');
    const confirmBtn  = overlay.querySelector('.color-picker-confirm');
    const cancelBtn   = overlay.querySelector('.color-picker-cancel');

    // A curated swatch set for fast picks
    const SWATCHES = [
      '#FFFFFF','#E0E0E0','#9E9E9E','#424242','#121212',
      '#F44336','#E91E63','#9C27B0','#673AB7','#3F51B5',
      '#2196F3','#03A9F4','#00BCD4','#009688','#4CAF50',
      '#8BC34A','#CDDC39','#FFEB3B','#FFC107','#FF9800',
      '#FF5722','#795548','#607D8B','#FFD700','#C0C0C0',
    ];

    for (const hex of SWATCHES) {
      const sw = document.createElement('button');
      sw.className = 'cp-swatch';
      sw.style.background = hex;
      sw.title = hex;
      sw.addEventListener('click', () => {
        native.value = hex;
        hexInput.value = hex;
        preview.style.background = hex;
      });
      presetsEl.appendChild(sw);
    }

    const sync = (hex) => {
      preview.style.background = hex;
      native.value = hex;
      hexInput.value = hex;
    };

    native.addEventListener('input', () => sync(native.value));
    hexInput.addEventListener('input', () => {
      const v = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) sync(v);
    });

    confirmBtn.addEventListener('click', () => {
      if (this._colorPickerTarget) {
        const { itemId, zone } = this._colorPickerTarget;
        avatarSystem.setItemColor(itemId, zone, native.value);
        this._colorPickerTarget = null;
      }
      overlay.classList.add('hidden');
      this._renderClothingTab();
    });

    cancelBtn.addEventListener('click', () => {
      overlay.classList.add('hidden');
      this._colorPickerTarget = null;
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
        this._colorPickerTarget = null;
      }
    });

    this._colorPickerSync = sync;
    return overlay;
  }

  _openColorPicker(itemId, zone, currentHex) {
    this._colorPickerTarget = { itemId, zone };
    const title = this._colorPickerEl.querySelector('.color-picker-title');
    title.textContent = `🎨 ${zone.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} Colour`;
    this._colorPickerSync(currentHex || '#888888');
    this._colorPickerEl.classList.remove('hidden');
  }

  // ── SHARED COMPONENT BUILDERS ────────────────────────────────────────────

  _section(title, children) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar-ui__section';
    const h = document.createElement('h3');
    h.className = 'section-title';
    h.textContent = title;
    wrap.appendChild(h);
    for (const child of children.filter(Boolean)) {
      wrap.appendChild(child);
    }
    return wrap;
  }

  _slider(label, key, value, min, max, step) {
    const row = document.createElement('div');
    row.className = 'form-row slider-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = value;
    const val = document.createElement('span');
    val.className = 'slider-value';
    val.textContent = Math.round(value * 100) + '%';
    input.addEventListener('input', () => {
      val.textContent = Math.round(input.valueAsNumber * 100) + '%';
      avatarSystem.setAppearance(key, input.valueAsNumber);
    });
    row.appendChild(lbl);
    row.appendChild(input);
    row.appendChild(val);
    return row;
  }

  _radioRow(label, ids, labels, current, onChange) {
    const row = document.createElement('div');
    row.className = 'form-row radio-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const group = document.createElement('div');
    group.className = 'radio-group';
    ids.forEach((id, i) => {
      const btn = document.createElement('button');
      btn.className = 'radio-btn';
      btn.classList.toggle('active', id === current);
      btn.textContent = labels[i];
      btn.addEventListener('click', () => {
        group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(id);
      });
      group.appendChild(btn);
    });
    row.appendChild(lbl);
    row.appendChild(group);
    return row;
  }

  _radioGrid(key, ids, labels, current, onChange) {
    const grid = document.createElement('div');
    grid.className = 'radio-grid';
    ids.forEach((id, i) => {
      const btn = document.createElement('button');
      btn.className = 'radio-grid-btn';
      btn.classList.toggle('active', id === current);
      btn.textContent = labels[i];
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.radio-grid-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange ? onChange(id) : avatarSystem.setAppearance(key, id);
      });
      grid.appendChild(btn);
    });
    return grid;
  }

  _swatchGrid(key, current, hexArray) {
    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    for (const hex of hexArray) {
      const sw = document.createElement('button');
      sw.className = 'skin-swatch';
      sw.style.background = hex;
      sw.classList.toggle('active', hex === current);
      sw.title = hex;
      sw.addEventListener('click', () => {
        grid.querySelectorAll('.skin-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        avatarSystem.setAppearance(key, hex);
      });
      grid.appendChild(sw);
    }
    return grid;
  }

  _selectRow(label, key, ids, current, onChange, labels) {
    const row = document.createElement('div');
    row.className = 'form-row select-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'form-select';
    ids.forEach((id, i) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = (labels ? labels[i] : id);
      opt.selected = id === current;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      if (onChange) onChange(sel.value);
      else avatarSystem.setAppearance(key, sel.value);
    });
    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  _colorRow(label, key, current, onChange) {
    const row = document.createElement('div');
    row.className = 'form-row color-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch-btn';
    swatch.style.background = current || '#888';
    swatch.addEventListener('click', () => {
      const tmp = { itemId: '__appearance__', zone: key };
      this._colorPickerTarget = tmp;
      const title = this._colorPickerEl.querySelector('.color-picker-title');
      title.textContent = `🎨 ${label}`;
      this._colorPickerSync(current || '#888888');
      // Override confirm action
      const confirmBtn = this._colorPickerEl.querySelector('.color-picker-confirm');
      const handler = () => {
        const hex = this._colorPickerEl.querySelector('.color-picker-native').value;
        if (onChange) onChange(hex);
        else avatarSystem.setAppearance(key, hex);
        this._colorPickerEl.classList.add('hidden');
        this._colorPickerTarget = null;
        confirmBtn.removeEventListener('click', handler);
        this._renderTab(this._activeTab);
      };
      confirmBtn.addEventListener('click', handler);
      this._colorPickerEl.classList.remove('hidden');
    });
    row.appendChild(lbl);
    row.appendChild(swatch);
    return row;
  }

  _colorRowOptional(label, key, current) {
    const row = document.createElement('div');
    row.className = 'form-row color-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const tog = document.createElement('input');
    tog.type = 'checkbox';
    tog.checked = !!current;
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch-btn';
    swatch.style.background = current || '#FFD700';
    swatch.style.display = current ? '' : 'none';
    tog.addEventListener('change', () => {
      if (tog.checked) {
        swatch.style.display = '';
        avatarSystem.setAppearance(key, '#FFD700');
      } else {
        swatch.style.display = 'none';
        avatarSystem.setAppearance(key, null);
      }
    });
    swatch.addEventListener('click', () => {
      this._openColorPickerSimple(key, current || '#FFD700', (hex) => {
        swatch.style.background = hex;
        avatarSystem.setAppearance(key, hex);
      });
    });
    row.appendChild(lbl);
    row.appendChild(tog);
    row.appendChild(swatch);
    return row;
  }

  _openColorPickerSimple(key, current, cb) {
    const title = this._colorPickerEl.querySelector('.color-picker-title');
    title.textContent = `🎨 ${key}`;
    this._colorPickerSync(current || '#888888');
    const confirmBtn = this._colorPickerEl.querySelector('.color-picker-confirm');
    const handler = () => {
      const hex = this._colorPickerEl.querySelector('.color-picker-native').value;
      cb(hex);
      this._colorPickerEl.classList.add('hidden');
      confirmBtn.removeEventListener('click', handler);
    };
    confirmBtn.addEventListener('click', handler);
    this._colorPickerEl.classList.remove('hidden');
  }

  _textRow(label, key, value, onChange) {
    const row = document.createElement('div');
    row.className = 'form-row text-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.value = value || '';
    input.addEventListener('change', () => {
      if (onChange) onChange(input.value);
      else avatarSystem.setAppearance(key, input.value);
    });
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  }

  _prostheticRow(label, key, current) {
    const ids    = PROSTHETIC_TYPES.map(p => p.id);
    const labels = PROSTHETIC_TYPES.map(p => p.label);
    return this._radioRow(label, ids, labels, current,
      v => avatarSystem.setAppearance(key, v));
  }

  _flagRow(label, current, onChange) {
    const row = document.createElement('div');
    row.className = 'form-row flag-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'form-select';
    for (const code of FLAGS) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code;
      opt.selected = code === current;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  // ── Toast notifications ──────────────────────────────────────────────────

  _toast(msg) {
    let toastEl = document.querySelector('.avatar-toast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'avatar-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2500);
  }
}

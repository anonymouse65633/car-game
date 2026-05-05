/**
 * SettingsMenu.js
 * Part 8 — UI, HUD & Menus (Section 8.7)
 *
 * The Settings tab content — mounted inside PhoneMenu via:
 *   phoneMenu.mountPanel('settings', settingsMenu.element)
 *
 * Six sub-tabs, each a scrollable panel:
 *   Graphics    — render quality toggles and dropdowns
 *   Audio       — volume sliders + radio chatter on/off
 *   Controls    — full keyboard rebind table, gamepad sensitivity/deadzone
 *   Gameplay    — units, difficulty, assists, camera, minimap
 *   Accessibility — UI scale, colour blind mode, reduce motion, etc.
 *   API Key     — Gemini API key input + "Test Connection" button
 *
 * SettingsStore contract
 * ──────────────────────
 * The caller (HUDManager) passes a `settings` object (plain POJO) and an
 * `onChange(key, value)` callback.  Every control reads its initial value
 * from `settings` and writes back via `onChange` on change.
 *
 *   { ok: boolean, message: string }
 *
 * `applyPatch(patch)` lets HUDManager push external changes back into the
 * UI (e.g. if another system changes a setting programmatically).
 *
 * CSS
 * ───
 * Injects its own <style> once.  Inherits PhoneMenu's CSS custom properties
 * (--pm-accent, --pm-border, --pm-muted, etc.) — no hard-coded colours.
 */

// ─── Sub-tab definitions ──────────────────────────────────────────────────────

const SUB_TABS = [
  { id: 'graphics',      icon: '🖥',  label: 'Graphics'      },
  { id: 'audio',         icon: '🔊',  label: 'Audio'         },
  { id: 'controls',      icon: '🎮',  label: 'Controls'      },
  { id: 'gameplay',      icon: '🏎',  label: 'Gameplay'      },
  { id: 'accessibility', icon: '♿',  label: 'Accessibility' },
];

// ─── Default key bindings ─────────────────────────────────────────────────────

const DEFAULT_KEYBINDS = [
  { action: 'throttle',       label: 'Throttle / Accelerate', key: 'W'          },
  { action: 'brake',          label: 'Brake / Reverse',       key: 'S'          },
  { action: 'steerLeft',      label: 'Steer Left',            key: 'A'          },
  { action: 'steerRight',     label: 'Steer Right',           key: 'D'          },
  { action: 'handbrake',      label: 'Handbrake',             key: 'Space'      },
  { action: 'shiftUp',        label: 'Shift Up',              key: 'E'          },
  { action: 'shiftDown',      label: 'Shift Down',            key: 'Q'          },
  { action: 'horn',           label: 'Horn',                  key: 'H'          },
  { action: 'rewind',         label: 'Rewind',                key: 'Backspace'  },
  { action: 'cameraToggle',   label: 'Camera Mode',           key: 'C'          },
  { action: 'lookBack',       label: 'Look Back',             key: 'V'          },
  { action: 'openPhone',      label: 'Open Phone',            key: 'Escape'     },
  { action: 'openMap',        label: 'Open Map',              key: 'M'          },
  { action: 'leaderboard',    label: 'Leaderboard (Race)',    key: 'Tab'        },
  { action: 'exitCar',        label: 'Exit Car (On Foot)',    key: 'F'          },
  { action: 'sprint',         label: 'Sprint (On Foot)',      key: 'Shift'      },
  { action: 'interact',       label: 'Interact',              key: 'F'          },
  { action: 'photoMode',      label: 'Photo Mode',            key: 'P'          },
];

// ─── Stylesheet ───────────────────────────────────────────────────────────────

const SETTINGS_CSS = `
/* ════════════════════════════════════════════════════════════════
   Root — fills pm-settings-mount
════════════════════════════════════════════════════════════════ */
.sm-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  font-family: var(--pm-font, 'Rajdhani', 'Barlow Condensed', sans-serif);
}

/* ── Sub-tab bar ──────────────────────────────────────────────── */
.sm-subtabs {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--pm-border);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.sm-subtabs::-webkit-scrollbar { display: none; }

.sm-tab-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 18px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  font-family: var(--pm-font, sans-serif);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--pm-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: color 150ms ease, border-color 150ms ease;
  flex-shrink: 0;
}
.sm-tab-btn:hover { color: var(--pm-text); }
.sm-tab-btn.active {
  color: #fff;
  border-bottom-color: var(--pm-accent);
}
.sm-tab-icon { font-size: 15px; line-height: 1; }

/* ── Panel content ────────────────────────────────────────────── */
.sm-panels {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.sm-panel {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: none;
  flex-direction: column;
  padding: 22px 32px 32px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.10) transparent;
}
.sm-panel.active { display: flex; }
.sm-panel::-webkit-scrollbar { width: 4px; }
.sm-panel::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.12);
  border-radius: 2px;
}

/* ── Section heading ──────────────────────────────────────────── */
.sm-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--pm-muted);
  margin: 20px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--pm-border);
}
.sm-section-title:first-child { margin-top: 0; }

/* ── Setting row ──────────────────────────────────────────────── */
.sm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  min-height: 46px;
}
.sm-row:last-child { border-bottom: none; }

.sm-row-info { flex: 1; min-width: 0; }

.sm-row-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--pm-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm-row-desc {
  font-size: 11px;
  color: var(--pm-muted);
  margin-top: 2px;
  line-height: 1.4;
}

.sm-row-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── Dropdown ─────────────────────────────────────────────────── */
.sm-select {
  appearance: none;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--pm-border);
  border-radius: 6px;
  color: var(--pm-text);
  font-family: var(--pm-font, sans-serif);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 32px 7px 12px;
  cursor: pointer;
  min-width: 140px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='rgba(255,255,255,.35)'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: border-color 150ms ease;
}
.sm-select:hover, .sm-select:focus {
  border-color: rgba(255,255,255,0.28);
  outline: none;
}
.sm-select option {
  background: #141820;
  color: #fff;
}

/* ── Toggle (on/off pill) ─────────────────────────────────────── */
.sm-toggle {
  position: relative;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}
.sm-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}
.sm-toggle-track {
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,0.12);
  border-radius: 12px;
  cursor: pointer;
  transition: background 200ms ease;
}
.sm-toggle input:checked + .sm-toggle-track {
  background: var(--pm-accent);
}
.sm-toggle-track::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 200ms ease;
}
.sm-toggle input:checked + .sm-toggle-track::after {
  transform: translateX(20px);
}
.sm-toggle input:focus-visible + .sm-toggle-track {
  outline: 2px solid var(--pm-accent);
  outline-offset: 2px;
}

/* ── Volume slider ────────────────────────────────────────────── */
.sm-slider-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sm-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 160px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.12);
  cursor: pointer;
  outline: none;
  transition: background 150ms;
}
.sm-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--pm-accent);
  cursor: pointer;
  transition: transform 120ms ease;
  box-shadow: 0 0 0 2px rgba(44,156,240,0.35);
}
.sm-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
.sm-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: none;
  background: var(--pm-accent);
  cursor: pointer;
}
.sm-slider-val {
  font-size: 13px;
  font-weight: 700;
  color: var(--pm-text);
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: right;
}

/* ── Segmented control (button group) ────────────────────────── */
.sm-segment {
  display: flex;
  border: 1px solid var(--pm-border);
  border-radius: 6px;
  overflow: hidden;
}
.sm-segment-btn {
  padding: 6px 14px;
  background: transparent;
  border: none;
  border-right: 1px solid var(--pm-border);
  font-family: var(--pm-font, sans-serif);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: var(--pm-muted);
  cursor: pointer;
  transition: background 140ms, color 140ms;
  white-space: nowrap;
}
.sm-segment-btn:last-child { border-right: none; }
.sm-segment-btn:hover { background: rgba(255,255,255,0.05); color: var(--pm-text); }
.sm-segment-btn.active {
  background: var(--pm-accent);
  color: #000;
}

/* ── Key bind table ───────────────────────────────────────────── */
.sm-keybind-table {
  width: 100%;
  border-collapse: collapse;
}
.sm-keybind-table tr {
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.sm-keybind-table tr:last-child { border-bottom: none; }
.sm-keybind-table td {
  padding: 9px 4px;
  vertical-align: middle;
}
.sm-kb-action {
  font-size: 13px;
  font-weight: 600;
  color: var(--pm-text);
  width: 100%;
}
.sm-kb-key {
  min-width: 100px;
  text-align: right;
}
.sm-key-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.14);
  border-bottom-width: 2px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--pm-text);
  cursor: pointer;
  transition: background 140ms, border-color 140ms;
  font-family: var(--pm-font, sans-serif);
}
.sm-key-badge:hover {
  background: rgba(255,255,255,0.12);
  border-color: rgba(255,255,255,0.28);
}
.sm-key-badge.listening {
  background: rgba(44,156,240,0.20);
  border-color: var(--pm-accent);
  color: var(--pm-accent);
  animation: sm-key-pulse 0.8s ease-in-out infinite;
}
@keyframes sm-key-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
}


/* ── Assist icons row ─────────────────────────────────────────── */
.sm-assists-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.sm-assist-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border: 1px solid var(--pm-border);
  border-radius: 7px;
  background: transparent;
  font-family: var(--pm-font, sans-serif);
  font-size: 13px;
  font-weight: 700;
  color: var(--pm-muted);
  cursor: pointer;
  letter-spacing: 0.06em;
  transition: color 150ms, border-color 150ms, background 150ms;
}
.sm-assist-toggle.on {
  color: var(--pm-green, #34C759);
  border-color: rgba(52, 199, 89, 0.45);
  background: rgba(52, 199, 89, 0.08);
}
.sm-assist-toggle:hover { background: rgba(255,255,255,0.04); }

/* ── Reset button ─────────────────────────────────────────────── */
.sm-reset-row {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--pm-border);
  display: flex;
  gap: 10px;
  align-items: center;
}
.sm-reset-btn {
  background: transparent;
  border: 1px solid rgba(255,59,48,0.38);
  border-radius: 7px;
  padding: 8px 18px;
  font-family: var(--pm-font, sans-serif);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255,59,48,0.75);
  cursor: pointer;
  transition: background 150ms, border-color 150ms, color 150ms;
}
.sm-reset-btn:hover {
  background: rgba(255,59,48,0.10);
  border-color: rgba(255,59,48,0.65);
  color: var(--pm-red, #FF3B30);
}
.sm-reset-hint {
  font-size: 11px;
  color: var(--pm-muted);
}

/* ── Responsive ───────────────────────────────────────────────── */
@media (max-width: 900px) {
  .sm-panel         { padding: 16px 16px 24px; }
  .sm-tab-btn       { padding: 8px 12px; font-size: 12px; }
  .sm-slider        { width: 110px; }
  .sm-select        { min-width: 110px; }
}
`;

// ─── SettingsMenu ─────────────────────────────────────────────────────────────

export class SettingsMenu {
  /**
   * @param {object}   opts
   * @param {object}   opts.settings      Initial settings snapshot (from HUDManager).
   * @param {Function} opts.onChange      Called with (key, value) on every change.
   * @param {object}   [opts.keybinds]   Current key binding map: { action: keyString }.
   * @param {Function} [opts.onRebind]   Called with (action, newKey) when player rebinds.
   */
  constructor({
    settings      = {},
    onChange      = () => {},
    keybinds      = {},
    onRebind      = () => {},
  }) {
    this._settings     = { ...settings };
    this._onChange     = onChange;
    this._
    this._keybinds     = { ...Object.fromEntries(DEFAULT_KEYBINDS.map(b => [b.action, b.key])), ...keybinds };
    this._onRebind     = onRebind;

    this._activeTab    = 'graphics';
    this._panelEls     = {};
    this._tabBtnEls    = {};

    // Key rebind listener state
    this._listeningAction = null;
    this._listeningBadge  = null;
    this._boundKeyCapture = this._onKeyCapture.bind(this);

    this._injectCSS();
    this._build();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** The root DOM element to pass to phoneMenu.mountPanel('settings', ...). */
  get element() { return this._root; }

  /**
   * Sync an external settings change into the UI controls.
   * Called by HUDManager.applySettings() when something else changes a setting.
   * @param {object} patch
   */
  applyPatch(patch) {
    Object.assign(this._settings, patch);
    for (const [key, value] of Object.entries(patch)) {
      const ctrl = this._controlMap?.[key];
      if (!ctrl) continue;
      if (ctrl.type === 'select')  ctrl.el.value = String(value);
      if (ctrl.type === 'toggle')  ctrl.el.checked = !!value;
      if (ctrl.type === 'slider')  { ctrl.el.value = value; ctrl.valEl.textContent = value; }
      if (ctrl.type === 'segment') {
        ctrl.btns.forEach(b => b.classList.toggle('active', b.dataset.val === String(value)));
      }
    }
  }

  /** Clean up event listeners. */
  destroy() {
    this._stopListening();
    this._root?.remove();
  }

  // ─── DOM Construction ────────────────────────────────────────────────────────

  _build() {
    const root = document.createElement('div');
    root.className = 'sm-root';

    const tabBar = this._buildTabBar();
    const panels = document.createElement('div');
    panels.className = 'sm-panels';

    for (const tab of SUB_TABS) {
      const panel = document.createElement('div');
      panel.className = 'sm-panel';
      panel.id = `sm-panel-${tab.id}`;
      this._fillPanel(panel, tab.id);
      this._panelEls[tab.id] = panel;
      panels.appendChild(panel);
    }

    root.append(tabBar, panels);
    this._root = root;

    // Activate the default tab without animation
    this._activateTab(this._activeTab, false);
  }

  _buildTabBar() {
    const bar = document.createElement('nav');
    bar.className = 'sm-subtabs';

    for (const tab of SUB_TABS) {
      const btn = document.createElement('button');
      btn.className = 'sm-tab-btn';
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span class="sm-tab-icon">${tab.icon}</span>${tab.label}`;
      btn.addEventListener('click', () => this._activateTab(tab.id));
      this._tabBtnEls[tab.id] = btn;
      bar.appendChild(btn);
    }

    return bar;
  }

  _activateTab(tabId, focus = true) {
    // Deactivate old
    const prevPanel = this._panelEls[this._activeTab];
    const prevBtn   = this._tabBtnEls[this._activeTab];
    prevPanel?.classList.remove('active');
    prevBtn?.classList.remove('active');

    // Activate new
    this._activeTab = tabId;
    const panel = this._panelEls[tabId];
    const btn   = this._tabBtnEls[tabId];
    panel.classList.add('active');
    btn.classList.add('active');
    if (focus) btn.focus();

    // Stop any pending key rebind if the user switches tabs
    this._stopListening();
  }

  // ─── Panel content builders ──────────────────────────────────────────────────

  _fillPanel(panel, tabId) {
    // Track all controls for applyPatch() reverse-sync
    if (!this._controlMap) this._controlMap = {};

    const builders = {
      graphics:      () => this._buildGraphics(panel),
      audio:         () => this._buildAudio(panel),
      controls:      () => this._buildControls(panel),
      gameplay:      () => this._buildGameplay(panel),
      accessibility: () => this._buildAccessibility(panel),
    };
    builders[tabId]?.();
  }

  // ── Graphics ─────────────────────────────────────────────────────────────────

  _buildGraphics(panel) {
    this._sectionHeading(panel, 'Render Quality');

    this._selectRow(panel, {
      key: 'resolutionScale', label: 'Resolution Scale',
      desc: 'Scales the internal render resolution. Lower for better performance.',
      options: ['50%', '75%', '100%', '125%'], default: '100%',
    });
    this._selectRow(panel, {
      key: 'shadowQuality', label: 'Shadow Quality',
      options: ['Off', 'Low', 'Medium', 'High'], default: 'High',
    });
    this._selectRow(panel, {
      key: 'drawDistance', label: 'Draw Distance',
      options: ['Low', 'Medium', 'High', 'Ultra'], default: 'High',
    });
    this._selectRow(panel, {
      key: 'antiAliasing', label: 'Anti-Aliasing',
      options: ['Off', 'FXAA', 'MSAA 2x', 'MSAA 4x'], default: 'FXAA',
    });

    this._sectionHeading(panel, 'Effects');

    this._toggleRow(panel, {
      key: 'ambientOcclusion', label: 'Ambient Occlusion',
      desc: 'Adds subtle depth shading to corners and crevices.', default: true,
    });
    this._selectRow(panel, {
      key: 'bloom', label: 'Bloom',
      options: ['Off', 'Low', 'High'], default: 'Low',
    });
    this._selectRow(panel, {
      key: 'motionBlur', label: 'Motion Blur',
      options: ['Off', 'Low', 'High'], default: 'Low',
    });
    this._toggleRow(panel, {
      key: 'speedLines', label: 'Speed Lines',
      desc: 'Radial speed line overlay at 150+ km/h.', default: true,
    });
    this._toggleRow(panel, {
      key: 'chromaticAberration', label: 'Chromatic Aberration',
      desc: 'Screen-edge colour fringing at 200+ km/h.', default: true,
    });

    this._sectionHeading(panel, 'World');

    this._toggleRow(panel, {
      key: 'dayNightCycle', label: 'Day / Night Cycle',
      desc: 'Off locks the world to daytime.', default: true,
    });
    this._toggleRow(panel, {
      key: 'weather', label: 'Dynamic Weather',
      desc: 'Off locks to clear skies.', default: true,
    });

    this._resetRow(panel, 'graphics');
  }

  // ── Audio ─────────────────────────────────────────────────────────────────────

  _buildAudio(panel) {
    this._sectionHeading(panel, 'Volume');

    const VOLUME_ROWS = [
      { key: 'volumeMaster', label: 'Master Volume',      default: 80 },
      { key: 'volumeEngine', label: 'Engine Audio',       default: 90 },
      { key: 'volumeMusic',  label: 'Music Volume',       default: 60 },
      { key: 'volumeUI',     label: 'UI Sounds',          default: 70 },
      { key: 'volumeWorld',  label: 'NPC / World Audio',  default: 75 },
    ];

    for (const v of VOLUME_ROWS) {
      this._sliderRow(panel, { ...v, min: 0, max: 100, step: 1, unit: '' });
    }

    this._sectionHeading(panel, 'Commentary');

    this._toggleRow(panel, {
      key: 'radioChatter', label: 'AI Radio Chatter',
      desc: 'Gemini-generated commentary from AI drivers during races.', default: true,
    });

    this._resetRow(panel, 'audio');
  }

  // ── Controls ──────────────────────────────────────────────────────────────────

  _buildControls(panel) {
    this._sectionHeading(panel, 'Keyboard — Click a key to rebind');

    const table = document.createElement('table');
    table.className = 'sm-keybind-table';

    for (const bind of DEFAULT_KEYBINDS) {
      const tr = document.createElement('tr');

      const tdLabel = document.createElement('td');
      const label   = document.createElement('span');
      label.className = 'sm-kb-action';
      label.textContent = bind.label;
      tdLabel.appendChild(label);

      const tdKey = document.createElement('td');
      tdKey.className = 'sm-kb-key';
      const badge = document.createElement('button');
      badge.className = 'sm-key-badge';
      badge.textContent = this._keybinds[bind.action] ?? bind.key;
      badge.dataset.action = bind.action;
      badge.title = 'Click to rebind';
      badge.addEventListener('click', () => this._startListening(bind.action, badge));
      tdKey.appendChild(badge);

      tr.append(tdLabel, tdKey);
      table.appendChild(tr);
    }

    panel.appendChild(table);

    this._sectionHeading(panel, 'Gamepad');

    this._sliderRow(panel, {
      key: 'gamepadSteerSensitivity', label: 'Steering Sensitivity (Left Stick)',
      min: 1, max: 10, step: 1, default: 5, unit: '',
    });
    this._sliderRow(panel, {
      key: 'gamepadCameraSensitivity', label: 'Camera Sensitivity (Right Stick)',
      min: 1, max: 10, step: 1, default: 5, unit: '',
    });
    this._sliderRow(panel, {
      key: 'steeringDeadzone', label: 'Steering Deadzone',
      min: 0, max: 30, step: 1, default: 5, unit: '%',
    });
    this._sliderRow(panel, {
      key: 'triggerDeadzone', label: 'Trigger Deadzone',
      min: 0, max: 30, step: 1, default: 5, unit: '%',
    });
    this._sliderRow(panel, {
      key: 'steeringLinearity', label: 'Steering Linearity',
      desc: 'Higher values make steering more aggressive near the centre.',
      min: 1, max: 10, step: 1, default: 5, unit: '',
    });
    this._toggleRow(panel, {
      key: 'invertCameraY', label: 'Invert Camera Y-Axis', default: false,
    });

    const resetRow = this._resetRow(panel, 'controls');

    // Extra reset-keybinds button
    const resetKbBtn = document.createElement('button');
    resetKbBtn.className = 'sm-reset-btn';
    resetKbBtn.textContent = 'Reset All Keybinds';
    resetKbBtn.addEventListener('click', () => {
      DEFAULT_KEYBINDS.forEach(bind => {
        this._keybinds[bind.action] = bind.key;
        this._onRebind(bind.action, bind.key);
      });
      // Refresh all badge text in the table
      table.querySelectorAll('.sm-key-badge').forEach(badge => {
        badge.textContent = this._keybinds[badge.dataset.action] ?? '?';
        badge.classList.remove('listening');
      });
    });
    resetRow.appendChild(resetKbBtn);
  }

  // ── Gameplay ──────────────────────────────────────────────────────────────────

  _buildGameplay(panel) {
    this._sectionHeading(panel, 'General');

    this._segmentRow(panel, {
      key: 'units', label: 'Speed Units',
      values: ['km/h', 'mph'], default: 'km/h',
    });
    this._selectRow(panel, {
      key: 'difficulty', label: 'Difficulty',
      options: ['Tourist', 'Novice', 'Experienced', 'Pro', 'Unbeatable'], default: 'Experienced',
    });
    this._selectRow(panel, {
      key: 'suggestedLine', label: 'Suggested Racing Line',
      options: ['Off', 'Braking Only', 'Full Line'], default: 'Off',
    });
    this._segmentRow(panel, {
      key: 'transmission', label: 'Transmission',
      values: ['Automatic', 'Manual'], default: 'Automatic',
    });
    this._selectRow(panel, {
      key: 'camera', label: 'Default Camera',
      options: ['Chase', 'Hood', 'Cockpit'], default: 'Chase',
    });
    this._selectRow(panel, {
      key: 'cameraShake', label: 'Camera Shake',
      options: ['Off', 'Low', 'High'], default: 'Low',
    });
    this._segmentRow(panel, {
      key: 'minimapRotation', label: 'Minimap Rotation',
      values: ['rotate', 'north-up'],
      displayValues: ['Rotate with Car', 'North Up Fixed'],
      default: 'rotate',
    });

    this._sectionHeading(panel, 'Driving Assists');

    const assistDesc = document.createElement('div');
    assistDesc.style.cssText = 'font-size:12px;color:var(--pm-muted);margin-bottom:10px;line-height:1.5;';
    assistDesc.textContent = 'These can also be toggled in the Race Setup screen. Assists make driving easier but may reduce credit rewards.';
    panel.appendChild(assistDesc);

    const ASSISTS = [
      { key: 'assistABS',  label: 'ABS',  icon: '🔴' },
      { key: 'assistTC',   label: 'TC',   icon: '🟡' },
      { key: 'assistSSC',  label: 'SSC',  icon: '🟠' },
      { key: 'assistRewind', label: 'Rewind', icon: '⏪' },
    ];

    const assistsGrid = document.createElement('div');
    assistsGrid.className = 'sm-assists-grid';

    for (const a of ASSISTS) {
      const btn = document.createElement('button');
      btn.className = 'sm-assist-toggle' + (this._get(a.key, true) ? ' on' : '');
      btn.innerHTML = `${a.icon} ${a.label}`;
      btn.addEventListener('click', () => {
        const val = !this._get(a.key, true);
        this._set(a.key, val);
        btn.classList.toggle('on', val);
      });
      assistsGrid.appendChild(btn);
    }

    panel.appendChild(assistsGrid);
    this._resetRow(panel, 'gameplay');
  }

  // ── Accessibility ─────────────────────────────────────────────────────────────

  _buildAccessibility(panel) {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:12px;color:var(--pm-muted);margin-bottom:18px;line-height:1.55;';
    note.textContent = 'Accessibility settings take effect immediately. Changes are saved automatically.';
    panel.appendChild(note);

    this._sectionHeading(panel, 'Display');

    this._segmentRow(panel, {
      key: 'uiScale', label: 'UI Scale',
      values: ['80%', '100%', '120%', '150%'], default: '100%',
    });
    this._selectRow(panel, {
      key: 'colourBlindMode', label: 'Colour Blind Mode',
      desc: 'Adjusts the HUD colour palette for different types of colour vision deficiency.',
      options: ['Off', 'Deuteranopia', 'Protanopia', 'Tritanopia'], default: 'Off',
    });
    this._toggleRow(panel, {
      key: 'highContrast', label: 'High Contrast UI',
      desc: 'Increases border and text contrast across all HUD elements.', default: false,
    });

    this._sectionHeading(panel, 'Motion & Effects');

    this._toggleRow(panel, {
      key: 'reduceMotion', label: 'Reduce Motion',
      desc: 'Disables non-essential UI animations. Does not affect gameplay.', default: false,
    });
    this._toggleRow(panel, {
      key: 'speedLines', label: 'Speed Lines',
      desc: 'Radial overlay at 150+ km/h.', default: true,
    });
    this._toggleRow(panel, {
      key: 'screenFlashOnImpact', label: 'Screen Flash on Impact',
      desc: 'Brief white flash on collision. Disable if photosensitive.', default: true,
    });

    this._sectionHeading(panel, 'Subtitles');

    this._toggleRow(panel, {
      key: 'subtitles', label: 'Subtitles',
      desc: 'Coming in Phase 2 — displays captions for all spoken audio.', default: false,
    });

    this._resetRow(panel, 'accessibility');
  }


  // ─── Row helper factories ────────────────────────────────────────────────────

  /**
   * Build a labelled row with a <select> dropdown.
   * @param {HTMLElement} panel
   * @param {{ key, label, desc?, options, default }} opts
   */
  _selectRow(panel, opts) {
    const row = this._makeRow(panel, opts.label, opts.desc);
    const sel = document.createElement('select');
    sel.className = 'sm-select';
    const current = String(this._get(opts.key, opts.default));
    for (const o of opts.options) {
      const option = document.createElement('option');
      option.value = o;
      option.textContent = o;
      if (o === current) option.selected = true;
      sel.appendChild(option);
    }
    sel.addEventListener('change', () => this._set(opts.key, sel.value));
    row.appendChild(sel);
    this._controlMap[opts.key] = { type: 'select', el: sel };
  }

  /**
   * Build a row with a pill toggle.
   */
  _toggleRow(panel, opts) {
    const row = this._makeRow(panel, opts.label, opts.desc);
    const wrap = document.createElement('label');
    wrap.className = 'sm-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this._get(opts.key, opts.default);
    input.addEventListener('change', () => this._set(opts.key, input.checked));
    const track = document.createElement('div');
    track.className = 'sm-toggle-track';
    wrap.append(input, track);
    row.appendChild(wrap);
    this._controlMap[opts.key] = { type: 'toggle', el: input };
  }

  /**
   * Build a row with a range slider + live value readout.
   */
  _sliderRow(panel, opts) {
    const row = this._makeRow(panel, opts.label, opts.desc);
    const wrap = document.createElement('div');
    wrap.className = 'sm-slider-wrap';

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.className = 'sm-slider';
    slider.min   = opts.min;
    slider.max   = opts.max;
    slider.step  = opts.step ?? 1;
    slider.value = this._get(opts.key, opts.default);

    const valEl = document.createElement('span');
    valEl.className = 'sm-slider-val';
    valEl.textContent = slider.value + (opts.unit ?? '');

    slider.addEventListener('input', () => {
      valEl.textContent = slider.value + (opts.unit ?? '');
      this._set(opts.key, Number(slider.value));
    });

    wrap.append(slider, valEl);
    row.appendChild(wrap);
    this._controlMap[opts.key] = { type: 'slider', el: slider, valEl };
  }

  /**
   * Build a segmented button group (mutually exclusive options).
   */
  _segmentRow(panel, opts) {
    const row = this._makeRow(panel, opts.label, opts.desc);
    const seg = document.createElement('div');
    seg.className = 'sm-segment';
    const btns = [];
    const current = this._get(opts.key, opts.default);

    opts.values.forEach((val, i) => {
      const btn = document.createElement('button');
      btn.className = 'sm-segment-btn' + (val === current ? ' active' : '');
      btn.textContent = opts.displayValues?.[i] ?? val;
      btn.dataset.val = val;
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._set(opts.key, val);
      });
      btns.push(btn);
      seg.appendChild(btn);
    });

    row.appendChild(seg);
    this._controlMap[opts.key] = { type: 'segment', btns };
  }

  /** Append a section <h3> heading to a panel. */
  _sectionHeading(panel, text) {
    const h = document.createElement('div');
    h.className = 'sm-section-title';
    h.textContent = text;
    panel.appendChild(h);
  }

  /** Build a flex row with label+desc on the left; returns the right-side control slot. */
  _makeRow(panel, label, desc) {
    const row = document.createElement('div');
    row.className = 'sm-row';

    const info = document.createElement('div');
    info.className = 'sm-row-info';

    const labelEl = document.createElement('div');
    labelEl.className = 'sm-row-label';
    labelEl.textContent = label;
    info.appendChild(labelEl);

    if (desc) {
      const descEl = document.createElement('div');
      descEl.className = 'sm-row-desc';
      descEl.textContent = desc;
      info.appendChild(descEl);
    }

    const ctrl = document.createElement('div');
    ctrl.className = 'sm-row-control';

    row.append(info, ctrl);
    panel.appendChild(row);
    return ctrl;
  }

  /** Append a "Reset to Defaults" row at the bottom of a panel. */
  _resetRow(panel, sectionId) {
    const row = document.createElement('div');
    row.className = 'sm-reset-row';

    const btn = document.createElement('button');
    btn.className = 'sm-reset-btn';
    btn.textContent = 'Reset to Defaults';
    btn.addEventListener('click', () => this._resetSection(sectionId));

    const hint = document.createElement('span');
    hint.className = 'sm-reset-hint';
    hint.textContent = 'Resets only this section.';

    row.append(btn, hint);
    panel.appendChild(row);
    return row;  // caller may append more buttons
  }

  // ─── Key rebinding ────────────────────────────────────────────────────────────

  _startListening(action, badge) {
    // Cancel any in-progress listen
    this._stopListening();

    this._listeningAction = action;
    this._listeningBadge  = badge;
    badge.classList.add('listening');
    badge.textContent = 'Press a key…';

    window.addEventListener('keydown', this._boundKeyCapture, { capture: true });
  }

  _onKeyCapture(e) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      // Escape cancels rebind
      this._stopListening(true);
      return;
    }

    const action = this._listeningAction;
    const badge  = this._listeningBadge;
    const newKey = e.code === 'Space' ? 'Space' : (e.key.length === 1 ? e.key.toUpperCase() : e.code);

    this._keybinds[action] = newKey;
    this._onRebind(action, newKey);

    this._stopListening();
    badge.textContent = newKey;
  }

  _stopListening(cancelled = false) {
    if (!this._listeningBadge) return;
    window.removeEventListener('keydown', this._boundKeyCapture, { capture: true });
    if (cancelled) {
      // Restore old key text
      this._listeningBadge.textContent = this._keybinds[this._listeningAction] ?? '?';
    }
    this._listeningBadge?.classList.remove('listening');
    this._listeningAction = null;
    this._listeningBadge  = null;
  }

  // ─── Section reset ────────────────────────────────────────────────────────────

  /**
   * Reset all settings in a named section back to their declared defaults.
   * Uses the `opts.default` values captured during panel construction via
   * a per-section registry populated by the _*Row helpers via _registerDefault().
   */
  _resetSection(sectionId) {
    const defaults = this._sectionDefaults?.[sectionId];
    if (!defaults) return;
    for (const [key, val] of Object.entries(defaults)) {
      this._set(key, val);
      const ctrl = this._controlMap[key];
      if (!ctrl) continue;
      if (ctrl.type === 'select')  ctrl.el.value = String(val);
      if (ctrl.type === 'toggle')  ctrl.el.checked = !!val;
      if (ctrl.type === 'slider')  { ctrl.el.value = val; ctrl.valEl.textContent = String(val); }
      if (ctrl.type === 'segment') {
        ctrl.btns.forEach(b => b.classList.toggle('active', b.dataset.val === String(val)));
      }
    }
  }

  // ─── Settings read/write helpers ─────────────────────────────────────────────

  _get(key, fallback) {
    return this._settings[key] ?? fallback;
  }

  _set(key, value) {
    this._settings[key] = value;
    this._onChange(key, value);
  }

  // ─── CSS injection ────────────────────────────────────────────────────────────

  _injectCSS() {
    if (document.getElementById('sm-styles')) return;
    const style = document.createElement('style');
    style.id = 'sm-styles';
    style.textContent = SETTINGS_CSS;
    document.head.appendChild(style);
  }
}

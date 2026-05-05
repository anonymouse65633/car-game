/**
 * PhoneMenu.js
 * Part 8 — UI, HUD & Menus
 *
 * The phone UI that slides in on Escape / gamepad-Menu. Renders a left
 * sidebar with 7 tabs, swaps content panels, handles keyboard and D-pad
 * navigation, and freezes the game world while open.
 *
 * External sub-panels (SettingsMenu, etc.) are injected via mountPanel()
 * so this module never imports them — HUDManager wires everything together.
 *
 * Public API
 * ──────────
 *   open(tabId?)           Open to a specific tab (default: last active tab).
 *   close()                Close and resume the game.
 *   mountPanel(tabId, el)  Inject a sub-panel element into a tab's content area.
 *   setPlayerData(data)    Refresh profile / credit display with live values.
 *   isOpen                 Boolean getter.
 *
 * Callbacks (options)
 * ───────────────────
 *   onOpen(tabId)          Game should freeze + disable input.
 *   onClose()              Game should unfreeze + re-enable input.
 *   onTabChange(tabId)     Notifies HUDManager of the active tab (e.g. to
 *                          start rendering the full map canvas on Map tab).
 *   onFastTravel(dest)     Player pressed "Fast Travel" on a Races/Shops item.
 *   onSetActiveCar(carId)  Player confirmed a car switch from Garage.
 *
 * Tab IDs: 'map' | 'garage' | 'profile' | 'races' | 'shops' | 'festival' | 'settings'
 */

// ─── Tab definitions ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'map',      icon: '🗺',  label: 'Map',      key: '1' },
  { id: 'garage',   icon: '🚗',  label: 'Garage',   key: '2' },
  { id: 'profile',  icon: '👤',  label: 'Profile',  key: '3' },
  { id: 'races',    icon: '🏁',  label: 'Races',    key: '4' },
  { id: 'shops',    icon: '🛒',  label: 'Shops',    key: '5' },
  { id: 'festival', icon: '📋',  label: 'Festival', key: '6' },
  { id: 'settings', icon: '⚙',  label: 'Settings', key: '7' },
];

const KEY_TO_TAB = Object.fromEntries(TABS.map(t => [t.key, t.id]));

// ─── Stylesheet ───────────────────────────────────────────────────────────────

const PHONE_CSS = `
/* ── Custom font stack ───────────────────────────────────────────────────── */
.pm-root {
  --pm-bg:         rgba(9, 11, 16, 0.96);
  --pm-sidebar-w:  196px;
  --pm-accent:     #2C9CF0;
  --pm-gold:       #FFD700;
  --pm-green:      #34C759;
  --pm-red:        #FF3B30;
  --pm-border:     rgba(255,255,255,0.07);
  --pm-text:       rgba(255,255,255,0.88);
  --pm-muted:      rgba(255,255,255,0.38);
  --pm-font:       'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif;
  --pm-radius:     14px;
  --pm-dur:        320ms;
  --pm-ease:       cubic-bezier(.32, .72, 0, 1);

  position: fixed;
  inset: 0;
  z-index: 200;
  pointer-events: none;
  font-family: var(--pm-font);
}
.pm-root.open { pointer-events: auto; }

/* ── Backdrop ─────────────────────────────────────────────────────────────── */
.pm-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.54);
  backdrop-filter: blur(3px);
  opacity: 0;
  transition: opacity var(--pm-dur) ease;
}
.pm-root.open .pm-backdrop { opacity: 1; }

/* ── Phone container ──────────────────────────────────────────────────────── */
.pm-phone {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%) translateY(100%);
  transition: transform var(--pm-dur) var(--pm-ease);

  width: min(1160px, 96vw);
  height: min(88vh, 820px);
  background: var(--pm-bg);
  border-radius: var(--pm-radius) var(--pm-radius) 0 0;
  border: 1px solid var(--pm-border);
  border-bottom: none;
  display: flex;
  overflow: hidden;
  box-shadow: 0 -12px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset;
}
.pm-root.open .pm-phone {
  transform: translateX(-50%) translateY(0);
}

/* Drag handle (cosmetic) */
.pm-phone::before {
  content: '';
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 40px;
  height: 4px;
  background: rgba(255,255,255,0.15);
  border-radius: 2px;
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */
.pm-sidebar {
  width: var(--pm-sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--pm-border);
  background: rgba(0,0,0,0.22);
  padding: 28px 0 16px;
  gap: 2px;
}

.pm-tab-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--pm-muted);
  font-family: var(--pm-font);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-align: left;
  width: 100%;
  position: relative;
  transition: color 160ms ease, background 160ms ease;
  border-radius: 0;
}
.pm-tab-btn:hover {
  color: var(--pm-text);
  background: rgba(255,255,255,0.04);
}
.pm-tab-btn.active {
  color: #fff;
  background: rgba(44, 156, 240, 0.10);
}
.pm-tab-btn.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: var(--pm-accent);
  border-radius: 0 2px 2px 0;
}

.pm-tab-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  width: 22px;
  text-align: center;
}
.pm-tab-label { flex: 1; }
.pm-tab-key {
  font-size: 10px;
  font-weight: 700;
  color: rgba(255,255,255,0.18);
  letter-spacing: 0.1em;
}

/* Sidebar footer — credit balance */
.pm-sidebar-footer {
  margin-top: auto;
  padding: 14px 20px 8px;
  border-top: 1px solid var(--pm-border);
}
.pm-credit-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--pm-muted);
  text-transform: uppercase;
  margin-bottom: 3px;
}
.pm-credit-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--pm-gold);
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}

/* ── Content area ─────────────────────────────────────────────────────────── */
.pm-content {
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.pm-panel {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: none;
  flex-direction: column;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.12) transparent;
}
.pm-panel.active { display: flex; }

/* ── Panel header (shared) ────────────────────────────────────────────────── */
.pm-panel-header {
  padding: 26px 32px 18px;
  border-bottom: 1px solid var(--pm-border);
  flex-shrink: 0;
}
.pm-panel-title {
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.03em;
}
.pm-panel-sub {
  font-size: 13px;
  color: var(--pm-muted);
  margin-top: 3px;
}

/* ── Map panel ────────────────────────────────────────────────────────────── */
.pm-map-canvas-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d1017;
  position: relative;
}
#pm-map-canvas {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pm-map-filters {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pm-map-filter-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(9,11,16,0.88);
  border: 1px solid var(--pm-border);
  border-radius: 6px;
  color: var(--pm-muted);
  font-family: var(--pm-font);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: color 140ms, border-color 140ms, background 140ms;
  pointer-events: auto;
}
.pm-map-filter-btn.on {
  color: #fff;
  border-color: rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.07);
}
.pm-map-hint {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--pm-muted);
  letter-spacing: 0.12em;
  pointer-events: none;
}

/* ── Garage panel ─────────────────────────────────────────────────────────── */
.pm-garage-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 0 32px 16px;
}
.pm-filter-chip {
  padding: 5px 14px;
  border: 1px solid var(--pm-border);
  border-radius: 20px;
  background: transparent;
  color: var(--pm-muted);
  font-family: var(--pm-font);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.07em;
  cursor: pointer;
  transition: all 140ms ease;
}
.pm-filter-chip.active, .pm-filter-chip:hover {
  color: #fff;
  border-color: var(--pm-accent);
  background: rgba(44, 156, 240, 0.10);
}
.pm-garage-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  padding: 0 32px 28px;
}
.pm-car-card {
  background: rgba(255,255,255,0.035);
  border: 1px solid var(--pm-border);
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: background 160ms, border-color 160ms, transform 160ms;
  position: relative;
}
.pm-car-card:hover {
  background: rgba(255,255,255,0.065);
  border-color: rgba(255,255,255,0.14);
  transform: translateY(-2px);
}
.pm-car-card.active-car {
  border-color: var(--pm-accent);
  background: rgba(44, 156, 240, 0.07);
}
.pm-car-thumb {
  width: 100%;
  aspect-ratio: 16/9;
  background: rgba(255,255,255,0.04);
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  margin-bottom: 10px;
  overflow: hidden;
}
.pm-car-thumb img { width: 100%; height: 100%; object-fit: cover; }
.pm-car-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--pm-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pm-car-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 5px;
}
.pm-class-badge {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(255,255,255,0.1);
  color: #fff;
}
.pm-pr-value {
  font-size: 12px;
  color: var(--pm-muted);
}
.pm-fav-star {
  margin-left: auto;
  font-size: 14px;
  color: rgba(255,255,255,0.22);
  cursor: pointer;
  transition: color 140ms;
}
.pm-fav-star.starred { color: var(--pm-gold); }
.pm-empty-state {
  padding: 48px 32px;
  text-align: center;
  color: var(--pm-muted);
  font-size: 15px;
}

/* ── Profile panel ────────────────────────────────────────────────────────── */
.pm-profile-layout {
  display: flex;
  gap: 0;
  flex: 1;
}
.pm-profile-card {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--pm-border);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.pm-avatar-preview {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: rgba(255,255,255,0.06);
  border: 2px solid var(--pm-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 52px;
  overflow: hidden;
}
.pm-driver-name {
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  text-align: center;
}
.pm-level-row {
  width: 100%;
  text-align: center;
}
.pm-level-num {
  font-size: 13px;
  font-weight: 700;
  color: var(--pm-muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.pm-xp-bar-wrap {
  height: 6px;
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
  overflow: hidden;
}
.pm-xp-bar-fill {
  height: 100%;
  background: var(--pm-accent);
  border-radius: 3px;
  transition: width 600ms ease;
}
.pm-xp-label {
  font-size: 11px;
  color: var(--pm-muted);
  margin-top: 4px;
}
.pm-stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  width: 100%;
}
.pm-stat-cell {
  background: rgba(255,255,255,0.035);
  border-radius: 8px;
  padding: 10px 12px;
  text-align: center;
}
.pm-stat-val {
  font-size: 20px;
  font-weight: 700;
  color: var(--pm-gold);
}
.pm-stat-lbl {
  font-size: 10px;
  color: var(--pm-muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-top: 2px;
}

.pm-accolades-section {
  flex: 1;
  padding: 24px 28px;
  overflow-y: auto;
}
.pm-section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: var(--pm-muted);
  text-transform: uppercase;
  margin-bottom: 14px;
}
.pm-accolade-list { display: flex; flex-direction: column; gap: 8px; }
.pm-accolade-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--pm-border);
  border-radius: 8px;
}
.pm-accolade-icon { font-size: 20px; }
.pm-accolade-info { flex: 1; min-width: 0; }
.pm-accolade-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--pm-text);
}
.pm-accolade-desc {
  font-size: 11px;
  color: var(--pm-muted);
  margin-top: 2px;
}
.pm-accolade-reward {
  font-size: 12px;
  font-weight: 700;
  color: var(--pm-gold);
  flex-shrink: 0;
}

/* ── Races panel ──────────────────────────────────────────────────────────── */
.pm-races-layout { flex: 1; display: flex; overflow: hidden; }
.pm-races-list {
  width: 340px;
  flex-shrink: 0;
  border-right: 1px solid var(--pm-border);
  overflow-y: auto;
  padding: 8px 0;
}
.pm-race-item {
  padding: 13px 20px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 140ms, border-color 140ms;
}
.pm-race-item:hover { background: rgba(255,255,255,0.04); }
.pm-race-item.selected {
  background: rgba(44,156,240,0.07);
  border-left-color: var(--pm-accent);
}
.pm-race-type-tag {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--pm-accent);
  margin-bottom: 3px;
}
.pm-race-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--pm-text);
}
.pm-race-meta {
  font-size: 11px;
  color: var(--pm-muted);
  margin-top: 3px;
}
.pm-race-detail {
  flex: 1;
  padding: 28px 28px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.pm-race-detail-name {
  font-size: 28px;
  font-weight: 700;
  color: #fff;
}
.pm-race-detail-meta { display: flex; gap: 10px; flex-wrap: wrap; }
.pm-badge {
  padding: 4px 11px;
  border-radius: 5px;
  background: rgba(255,255,255,0.08);
  font-size: 11px;
  font-weight: 700;
  color: var(--pm-text);
  letter-spacing: 0.07em;
}
.pm-reward-row {
  display: flex;
  gap: 10px;
}
.pm-reward-card {
  flex: 1;
  background: rgba(255,255,255,0.035);
  border: 1px solid var(--pm-border);
  border-radius: 8px;
  padding: 12px 14px;
  text-align: center;
}
.pm-reward-pos {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.pm-reward-pos.gold   { color: var(--pm-gold); }
.pm-reward-pos.silver { color: #C0C0C0; }
.pm-reward-pos.bronze { color: #CD7F32; }
.pm-reward-val { font-size: 16px; font-weight: 700; color: var(--pm-text); }
.pm-btn {
  padding: 12px 22px;
  border: none;
  border-radius: 8px;
  font-family: var(--pm-font);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: opacity 160ms, transform 120ms;
}
.pm-btn:hover { opacity: 0.88; transform: translateY(-1px); }
.pm-btn:active { transform: translateY(0); }
.pm-btn.primary { background: var(--pm-green); color: #000; }
.pm-btn.secondary { background: rgba(255,255,255,0.08); color: var(--pm-text); }
.pm-btn:disabled { opacity: 0.36; cursor: not-allowed; transform: none; }

/* ── Shops panel ──────────────────────────────────────────────────────────── */
.pm-shops-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  padding: 0 32px 28px;
}
.pm-shop-card {
  background: rgba(255,255,255,0.035);
  border: 1px solid var(--pm-border);
  border-radius: 10px;
  padding: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: background 160ms, border-color 160ms, transform 160ms;
}
.pm-shop-card:hover {
  background: rgba(255,255,255,0.065);
  border-color: rgba(255,255,255,0.14);
  transform: translateY(-2px);
}
.pm-shop-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  flex-shrink: 0;
}
.pm-shop-info { flex: 1; min-width: 0; }
.pm-shop-name { font-size: 16px; font-weight: 700; color: var(--pm-text); }
.pm-shop-district { font-size: 12px; color: var(--pm-muted); margin-top: 2px; }
.pm-shop-travel-btn {
  font-size: 11px;
  font-weight: 700;
  color: var(--pm-accent);
  letter-spacing: 0.08em;
  flex-shrink: 0;
}

/* ── Festival panel ───────────────────────────────────────────────────────── */
.pm-season-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--pm-border);
  padding: 0 32px;
  flex-shrink: 0;
}
.pm-season-tab {
  padding: 10px 22px;
  font-size: 13px;
  font-weight: 700;
  color: var(--pm-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 160ms, border-color 160ms;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  font-family: var(--pm-font);
  letter-spacing: 0.07em;
}
.pm-season-tab.active {
  color: #fff;
  border-bottom-color: var(--pm-accent);
}
.pm-festival-content { flex: 1; overflow-y: auto; padding: 22px 32px; }
.pm-event-cards { display: flex; flex-direction: column; gap: 10px; }
.pm-event-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  background: rgba(255,255,255,0.035);
  border: 1px solid var(--pm-border);
  border-radius: 9px;
  cursor: pointer;
  transition: background 140ms, border-color 140ms;
}
.pm-event-card:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.12); }
.pm-event-card.completed { opacity: 0.52; }
.pm-event-type-icon { font-size: 22px; flex-shrink: 0; }
.pm-event-info { flex: 1; min-width: 0; }
.pm-event-name { font-size: 15px; font-weight: 700; color: var(--pm-text); }
.pm-event-class { font-size: 11px; color: var(--pm-muted); margin-top: 2px; }
.pm-event-reward { font-size: 13px; font-weight: 700; color: var(--pm-gold); flex-shrink: 0; }
.pm-event-done { font-size: 18px; color: var(--pm-green); flex-shrink: 0; }

.pm-season-track {
  margin-top: 22px;
  padding: 18px;
  background: rgba(255,255,255,0.025);
  border: 1px solid var(--pm-border);
  border-radius: 10px;
}
.pm-track-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: var(--pm-muted);
  text-transform: uppercase;
  margin-bottom: 12px;
}
.pm-track-bar-wrap { position: relative; }
.pm-track-bg {
  height: 8px;
  background: rgba(255,255,255,0.07);
  border-radius: 4px;
  overflow: hidden;
}
.pm-track-fill {
  height: 100%;
  background: var(--pm-accent);
  border-radius: 4px;
  transition: width 600ms ease;
}
.pm-track-milestones {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}
.pm-track-milestone {
  font-size: 10px;
  color: var(--pm-muted);
  text-align: center;
  max-width: 80px;
}
.pm-track-milestone.unlocked { color: var(--pm-gold); }

/* ── Settings panel mount ─────────────────────────────────────────────────── */
.pm-settings-mount {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Esc hint ─────────────────────────────────────────────────────────────── */
.pm-esc-hint {
  position: absolute;
  top: 18px;
  right: 24px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255,255,255,0.22);
}

/* ── Responsive ───────────────────────────────────────────────────────────── */
@media (max-width: 1280px) {
  .pm-phone { width: 98vw; }
  .pm-garage-grid { grid-template-columns: repeat(2, 1fr); }
  .pm-shops-grid  { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .pm-phone { width: 100vw; height: 100vh; border-radius: 0; }
  .pm-sidebar { width: 64px; }
  .pm-tab-label, .pm-tab-key { display: none; }
  .pm-tab-btn { padding: 14px; justify-content: center; }
  .pm-tab-icon { width: auto; font-size: 20px; }
  .pm-garage-grid { grid-template-columns: 1fr; }
  .pm-garage-toolbar, .pm-panel-header,
  .pm-festival-content, .pm-accolades-section { padding-left: 16px; padding-right: 16px; }
  .pm-garage-grid, .pm-shops-grid { padding-left: 16px; padding-right: 16px; }
  .pm-races-list { width: 200px; }
}
`;

// ─── PhoneMenu ────────────────────────────────────────────────────────────────

export class PhoneMenu {
  /**
   * @param {HTMLElement} container  Document body or HUD root.
   * @param {object}      options
   */
  constructor(container, {
    onOpen        = () => {},
    onClose       = () => {},
    onTabChange   = () => {},
    onFastTravel  = () => {},
    onSetActiveCar= () => {},
  } = {}) {
    this._container     = container;
    this._onOpen        = onOpen;
    this._onClose       = onClose;
    this._onTabChange   = onTabChange;
    this._onFastTravel  = onFastTravel;
    this._onSetActiveCar = onSetActiveCar;

    this._isOpen     = false;
    this._activeTab  = 'map';
    this._panelEls   = {};    // tabId → panel <div>
    this._tabBtnEls  = {};    // tabId → sidebar <button>
    this._mapFilters = { races: true, shops: true, boards: true, pois: true, fasttravel: false };
    this._activeSeason = 'summer';

    // Game data mirrors — set via setPlayerData().
    this._playerData = {
      name:         'Driver',
      level:        1,
      xpCurrent:    0,
      xpRequired:   5000,
      credits:      0,
      totalRaces:   0,
      totalWins:    0,
      accolades:    [],
      cars:         [],
      races:        [],
      shops:        [],
      festivalEvents: [],
    };

    this._injectCSS();
    this._build();
    this._bindKeys();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  get isOpen() { return this._isOpen; }

  /**
   * Open the phone menu, optionally jumping to a specific tab.
   * @param {string} [tabId]
   */
  open(tabId) {
    if (this._isOpen) {
      if (tabId && tabId !== this._activeTab) this._activateTab(tabId);
      return;
    }
    this._isOpen = true;
    this._root.classList.add('open');
    if (tabId) this._activateTab(tabId);
    else       this._activateTab(this._activeTab);
    this._onOpen(this._activeTab);
    // Focus the active tab button for keyboard nav.
    this._tabBtnEls[this._activeTab]?.focus();
  }

  /** Close the phone menu and resume the game. */
  close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    this._root.classList.remove('open');
    this._onClose();
  }

  /**
   * Inject a sub-panel element (e.g. a SettingsMenu DOM root) into a tab.
   * HUDManager calls this after constructing sub-panel instances.
   *
   * @param {string}      tabId  e.g. 'settings'
   * @param {HTMLElement} el     The sub-panel's root element.
   */
  mountPanel(tabId, el) {
    const mount = this._panelEls[tabId]?.querySelector('[data-mount]');
    if (!mount) {
      console.warn(`PhoneMenu.mountPanel: no mount point found for tab "${tabId}"`);
      return;
    }
    mount.innerHTML = '';
    mount.appendChild(el);
  }

  /**
   * Returns the <canvas> element inside the Map panel so an external
   * full-map renderer can draw into it.
   * @returns {HTMLCanvasElement}
   */
  getMapCanvas() {
    return this._root.querySelector('#pm-map-canvas');
  }

  /**
   * Feed live player data into all panels that display it.
   * Called by HUDManager whenever game state changes (level-up, credit change, etc.).
   *
   * @param {Partial<typeof this._playerData>} data
   */
  setPlayerData(data) {
    Object.assign(this._playerData, data);
    this._refreshCreditDisplay();
    if (this._activeTab === 'profile')  this._refreshProfilePanel();
    if (this._activeTab === 'garage')   this._refreshGaragePanel();
    if (this._activeTab === 'races')    this._refreshRacesPanel();
    if (this._activeTab === 'festival') this._refreshFestivalPanel();
  }

  /** Toggle a map filter layer on/off. */
  toggleMapFilter(filterKey) {
    this._mapFilters[filterKey] = !this._mapFilters[filterKey];
    this._syncMapFilterButtons();
  }

  destroy() {
    this._unbindKeys();
    if (this._root.parentNode) this._root.parentNode.removeChild(this._root);
  }

  // ─── DOM Construction ──────────────────────────────────────────────────────

  _build() {
    const root = document.createElement('div');
    root.className = 'pm-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Phone Menu');

    // Backdrop — clicking it closes.
    const backdrop = document.createElement('div');
    backdrop.className = 'pm-backdrop';
    backdrop.addEventListener('click', () => this.close());

    // Phone container.
    const phone = document.createElement('div');
    phone.className = 'pm-phone';

    // Esc hint.
    const escHint = document.createElement('div');
    escHint.className = 'pm-esc-hint';
    escHint.textContent = '[ESC] Close';

    // Sidebar.
    const sidebar = this._buildSidebar();

    // Content area.
    const content = document.createElement('div');
    content.className = 'pm-content';

    // Build all panels.
    for (const tab of TABS) {
      const panel = this._buildPanel(tab.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-label', tab.label);
      this._panelEls[tab.id] = panel;
      content.appendChild(panel);
    }

    phone.append(sidebar, content, escHint);
    root.append(backdrop, phone);
    this._container.appendChild(root);

    this._root    = root;
    this._sidebar = sidebar;
    this._content = content;
    this._phone   = phone;
  }

  _buildSidebar() {
    const sidebar = document.createElement('nav');
    sidebar.className = 'pm-sidebar';
    sidebar.setAttribute('role', 'tablist');

    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.className = 'pm-tab-btn';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `pm-panel-${tab.id}`);
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `
        <span class="pm-tab-icon">${tab.icon}</span>
        <span class="pm-tab-label">${tab.label}</span>
        <span class="pm-tab-key">${tab.key}</span>
      `;
      btn.addEventListener('click', () => this._activateTab(tab.id));
      this._tabBtnEls[tab.id] = btn;
      sidebar.appendChild(btn);
    }

    // Credit balance footer.
    const footer = document.createElement('div');
    footer.className = 'pm-sidebar-footer';
    footer.innerHTML = `
      <div class="pm-credit-label">Credits</div>
      <div class="pm-credit-value" data-credit-display>0 CR</div>
    `;
    this._creditDisplay = footer.querySelector('[data-credit-display]');
    sidebar.appendChild(footer);

    return sidebar;
  }

  _buildPanel(tabId) {
    const builders = {
      map:      this._buildMapPanel.bind(this),
      garage:   this._buildGaragePanel.bind(this),
      profile:  this._buildProfilePanel.bind(this),
      races:    this._buildRacesPanel.bind(this),
      shops:    this._buildShopsPanel.bind(this),
      festival: this._buildFestivalPanel.bind(this),
      settings: this._buildSettingsPanel.bind(this),
    };
    return (builders[tabId] ?? this._buildFallbackPanel)(tabId);
  }

  // ── Individual panel builders ─────────────────────────────────────────────

  _buildMapPanel() {
    const panel = this._makePanel('map');
    panel.style.overflow = 'hidden';

    const wrap = document.createElement('div');
    wrap.className = 'pm-map-canvas-wrap';

    const canvas = document.createElement('canvas');
    canvas.id = 'pm-map-canvas';

    // Map filter buttons.
    const filters = document.createElement('div');
    filters.className = 'pm-map-filters';

    const FILTER_DEFS = [
      { key: 'races',      icon: '🏁', label: 'Races'       },
      { key: 'shops',      icon: '🛒', label: 'Shops'       },
      { key: 'boards',     icon: '⭐', label: 'Boards'      },
      { key: 'pois',       icon: '◆',  label: 'Landmarks'   },
      { key: 'fasttravel', icon: '⬡',  label: 'Fast Travel' },
    ];

    this._mapFilterBtns = {};
    for (const def of FILTER_DEFS) {
      const btn = document.createElement('button');
      btn.className = 'pm-map-filter-btn' + (this._mapFilters[def.key] ? ' on' : '');
      btn.innerHTML = `<span>${def.icon}</span>${def.label}`;
      btn.addEventListener('click', () => this.toggleMapFilter(def.key));
      this._mapFilterBtns[def.key] = btn;
      filters.appendChild(btn);
    }

    const hint = document.createElement('div');
    hint.className = 'pm-map-hint';
    hint.textContent = 'Scroll to zoom  •  Drag to pan  •  [C] Re-centre';

    wrap.append(canvas, filters, hint);
    panel.appendChild(wrap);
    return panel;
  }

  _buildGaragePanel() {
    const panel = this._makePanel('garage');

    const header = this._makeHeader('My Garage', '');
    this._garageSubEl = header.querySelector('.pm-panel-sub');

    const toolbar = document.createElement('div');
    toolbar.className = 'pm-garage-toolbar';
    for (const [label, val] of [['All Cars','all'],['Favourites','fav'],['S Class','S'],['A Class','A'],['B Class','B']]) {
      const chip = document.createElement('button');
      chip.className = 'pm-filter-chip' + (val === 'all' ? ' active' : '');
      chip.textContent = label;
      chip.dataset.filter = val;
      chip.addEventListener('click', () => {
        toolbar.querySelectorAll('.pm-filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this._filterGarage(val);
      });
      toolbar.appendChild(chip);
    }

    const grid = document.createElement('div');
    grid.className = 'pm-garage-grid';
    this._garageGrid = grid;

    panel.append(header, toolbar, grid);
    return panel;
  }

  _buildProfilePanel() {
    const panel = this._makePanel('profile');
    panel.style.overflow = 'hidden';

    const header = this._makeHeader('My Profile', '');

    const layout = document.createElement('div');
    layout.className = 'pm-profile-layout';

    // Left card.
    const card = document.createElement('div');
    card.className = 'pm-profile-card';
    card.innerHTML = `
      <div class="pm-avatar-preview" data-avatar>👤</div>
      <div class="pm-driver-name" data-driver-name>Driver</div>
      <div class="pm-level-row">
        <div class="pm-level-num" data-level>LEVEL 1</div>
        <div class="pm-xp-bar-wrap"><div class="pm-xp-bar-fill" data-xp-fill style="width:0%"></div></div>
        <div class="pm-xp-label" data-xp-label>0 / 5,000 XP</div>
      </div>
      <div class="pm-stat-grid">
        <div class="pm-stat-cell"><div class="pm-stat-val" data-total-races>0</div><div class="pm-stat-lbl">Races</div></div>
        <div class="pm-stat-cell"><div class="pm-stat-val" data-total-wins>0</div><div class="pm-stat-lbl">Wins</div></div>
      </div>
    `;

    // Right: accolades.
    const accSection = document.createElement('div');
    accSection.className = 'pm-accolades-section';
    accSection.innerHTML = `<div class="pm-section-title">Recent Accolades</div>`;
    const accList = document.createElement('div');
    accList.className = 'pm-accolade-list';
    accList.dataset.accoladeList = '';
    accSection.appendChild(accList);

    layout.append(card, accSection);
    panel.append(header, layout);

    // Store refs for refresh.
    this._profileRefs = {
      avatar:      card.querySelector('[data-avatar]'),
      driverName:  card.querySelector('[data-driver-name]'),
      level:       card.querySelector('[data-level]'),
      xpFill:      card.querySelector('[data-xp-fill]'),
      xpLabel:     card.querySelector('[data-xp-label]'),
      totalRaces:  card.querySelector('[data-total-races]'),
      totalWins:   card.querySelector('[data-total-wins]'),
      accoladeList: accList,
    };
    return panel;
  }

  _buildRacesPanel() {
    const panel = this._makePanel('races');
    panel.style.overflow = 'hidden';

    const header = this._makeHeader('Race Events', 'Select a race to view details and fast travel to the start');

    const layout = document.createElement('div');
    layout.className = 'pm-races-layout';

    const list = document.createElement('div');
    list.className = 'pm-races-list';
    list.dataset.raceList = '';

    const detail = document.createElement('div');
    detail.className = 'pm-race-detail';
    detail.innerHTML = `
      <div style="color:var(--pm-muted);font-size:15px;margin:auto;text-align:center;opacity:0.5">
        Select a race on the left
      </div>
    `;
    this._raceDetailEl = detail;

    layout.append(list, detail);
    panel.append(header, layout);
    this._raceListEl = list;
    return panel;
  }

  _buildShopsPanel() {
    const panel = this._makePanel('shops');

    const header = this._makeHeader('Shops', 'Fast travel to any shop in Horizon City');

    const grid = document.createElement('div');
    grid.className = 'pm-shops-grid';
    this._shopsGrid = grid;

    const SHOP_DEFS = [
      { id: 'autoshow',  icon: '🚗', colour: '#2C9CF0', name: 'Autoshow',          district: 'Downtown Core'     },
      { id: 'parts',     icon: '🔧', colour: '#FF8C00', name: 'Parts Shop',         district: 'Racing District'   },
      { id: 'livery',    icon: '🎨', colour: '#A855F7', name: 'Livery & Paint',     district: 'Harbor District'   },
      { id: 'clothing',  icon: '👗', colour: '#EC4899', name: 'Clothing Boutique',  district: 'Downtown Core'     },
      { id: 'festival',  icon: '🎪', colour: '#FFD700', name: 'Festival Hub',       district: 'Hillside District' },
      { id: 'upgrade',   icon: '⚡', colour: '#34C759', name: 'Upgrade Workshop',   district: 'Industrial Zone'   },
    ];

    for (const def of SHOP_DEFS) {
      const card = document.createElement('div');
      card.className = 'pm-shop-card';
      card.innerHTML = `
        <div class="pm-shop-icon-wrap" style="background:${def.colour}22;">${def.icon}</div>
        <div class="pm-shop-info">
          <div class="pm-shop-name">${def.name}</div>
          <div class="pm-shop-district">${def.district}</div>
        </div>
        <div class="pm-shop-travel-btn">FAST TRAVEL →</div>
      `;
      card.addEventListener('click', () => {
        this._onFastTravel({ type: 'shop', id: def.id, name: def.name });
        this.close();
      });
      grid.appendChild(card);
    }

    panel.append(header, grid);
    return panel;
  }

  _buildFestivalPanel() {
    const panel = this._makePanel('festival');
    panel.style.overflow = 'hidden';

    const header = this._makeHeader('Festival Playlist', '');

    // Season tabs.
    const seasonNav = document.createElement('div');
    seasonNav.className = 'pm-season-tabs';
    this._seasonBtns = {};
    for (const s of ['Summer','Autumn','Winter','Spring']) {
      const btn = document.createElement('button');
      btn.className = 'pm-season-tab' + (s.toLowerCase() === this._activeSeason ? ' active' : '');
      btn.textContent = s;
      btn.dataset.season = s.toLowerCase();
      btn.addEventListener('click', () => {
        this._activeSeason = s.toLowerCase();
        seasonNav.querySelectorAll('.pm-season-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._refreshFestivalPanel();
      });
      this._seasonBtns[s.toLowerCase()] = btn;
      seasonNav.appendChild(btn);
    }

    const content = document.createElement('div');
    content.className = 'pm-festival-content';
    content.dataset.festivalContent = '';
    this._festivalContent = content;

    panel.append(header, seasonNav, content);
    return panel;
  }

  _buildSettingsPanel() {
    const panel = this._makePanel('settings');

    const header = this._makeHeader('Settings', '');

    // Mount point — SettingsMenu element injected here via mountPanel().
    const mount = document.createElement('div');
    mount.className = 'pm-settings-mount';
    mount.setAttribute('data-mount', '');

    panel.append(header, mount);
    return panel;
  }

  _buildFallbackPanel(tabId) {
    const panel = this._makePanel(tabId);
    const header = this._makeHeader(tabId.charAt(0).toUpperCase() + tabId.slice(1), '');
    const msg = document.createElement('div');
    msg.className = 'pm-empty-state';
    msg.textContent = 'Coming soon…';
    panel.append(header, msg);
    return panel;
  }

  // ── Panel helpers ─────────────────────────────────────────────────────────

  _makePanel(tabId) {
    const panel = document.createElement('div');
    panel.className = 'pm-panel';
    panel.id = `pm-panel-${tabId}`;
    panel.dataset.tabId = tabId;
    return panel;
  }

  _makeHeader(title, subtitle) {
    const header = document.createElement('div');
    header.className = 'pm-panel-header';
    header.innerHTML = `
      <div class="pm-panel-title">${title}</div>
      ${subtitle ? `<div class="pm-panel-sub">${subtitle}</div>` : ''}
    `;
    return header;
  }

  // ─── Tab switching ─────────────────────────────────────────────────────────

  _activateTab(tabId) {
    if (!this._panelEls[tabId]) return;

    // Deactivate current.
    const prevPanel = this._panelEls[this._activeTab];
    const prevBtn   = this._tabBtnEls[this._activeTab];
    prevPanel?.classList.remove('active');
    prevBtn?.classList.remove('active');
    prevBtn?.setAttribute('aria-selected', 'false');

    // Activate new.
    this._activeTab = tabId;
    const panel = this._panelEls[tabId];
    const btn   = this._tabBtnEls[tabId];
    panel.classList.add('active');
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    // Refresh content for data-driven panels.
    if (tabId === 'profile')  this._refreshProfilePanel();
    if (tabId === 'garage')   this._refreshGaragePanel();
    if (tabId === 'races')    this._refreshRacesPanel();
    if (tabId === 'festival') this._refreshFestivalPanel();

    this._onTabChange(tabId);
  }

  // ─── Panel refresh methods ─────────────────────────────────────────────────

  _refreshCreditDisplay() {
    if (!this._creditDisplay) return;
    this._creditDisplay.textContent = `${this._playerData.credits.toLocaleString()} CR`;
  }

  _refreshProfilePanel() {
    const refs = this._profileRefs;
    if (!refs) return;
    const d = this._playerData;
    refs.driverName.textContent = d.name;
    refs.level.textContent = `LEVEL ${d.level}`;
    const pct = d.xpRequired > 0 ? Math.min(100, (d.xpCurrent / d.xpRequired) * 100) : 0;
    refs.xpFill.style.width = `${pct}%`;
    refs.xpLabel.textContent = `${d.xpCurrent.toLocaleString()} / ${d.xpRequired.toLocaleString()} XP`;
    refs.totalRaces.textContent = d.totalRaces;
    refs.totalWins.textContent  = d.totalWins;

    // Accolades list.
    refs.accoladeList.innerHTML = '';
    const recent = (d.accolades ?? []).slice(-6).reverse();
    if (!recent.length) {
      refs.accoladeList.innerHTML = '<div style="color:var(--pm-muted);font-size:13px;">No accolades yet. Keep racing!</div>';
    }
    for (const acc of recent) {
      const item = document.createElement('div');
      item.className = 'pm-accolade-item';
      item.innerHTML = `
        <span class="pm-accolade-icon">${acc.icon ?? '🏆'}</span>
        <div class="pm-accolade-info">
          <div class="pm-accolade-name">${acc.name}</div>
          <div class="pm-accolade-desc">${acc.description ?? ''}</div>
        </div>
        <span class="pm-accolade-reward">${acc.reward ?? ''}</span>
      `;
      refs.accoladeList.appendChild(item);
    }
  }

  _refreshGaragePanel() {
    if (!this._garageGrid) return;
    const cars = this._playerData.cars ?? [];
    this._garageSubEl.textContent = `${cars.length} car${cars.length !== 1 ? 's' : ''} owned`;
    this._renderCarGrid(cars);
  }

  _filterGarage(filterVal) {
    const cars = this._playerData.cars ?? [];
    let filtered = cars;
    if (filterVal === 'fav')                filtered = cars.filter(c => c.favourite);
    else if (['S','A','B','C','D'].includes(filterVal)) filtered = cars.filter(c => c.class === filterVal);
    this._renderCarGrid(filtered);
  }

  _renderCarGrid(cars) {
    this._garageGrid.innerHTML = '';
    if (!cars.length) {
      const empty = document.createElement('div');
      empty.className = 'pm-empty-state';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = 'No cars match this filter.';
      this._garageGrid.appendChild(empty);
      return;
    }
    for (const car of cars) {
      const card = document.createElement('div');
      card.className = 'pm-car-card' + (car.isActive ? ' active-car' : '');
      card.innerHTML = `
        <div class="pm-car-thumb">
          ${car.thumbnailUrl ? `<img src="${car.thumbnailUrl}" alt="${car.name}">` : '🚗'}
        </div>
        <div class="pm-car-name">${car.name}</div>
        <div class="pm-car-meta">
          <span class="pm-class-badge">${car.class ?? '?'}</span>
          <span class="pm-pr-value">PR ${car.pr ?? 0}</span>
          <span class="pm-fav-star ${car.favourite ? 'starred' : ''}">★</span>
        </div>
      `;
      // Favourite toggle.
      card.querySelector('.pm-fav-star').addEventListener('click', (e) => {
        e.stopPropagation();
        car.favourite = !car.favourite;
        e.target.classList.toggle('starred', car.favourite);
      });
      // Set active.
      card.addEventListener('click', () => {
        this._onSetActiveCar(car.id);
        this.close();
      });
      this._garageGrid.appendChild(card);
    }
  }

  _refreshRacesPanel() {
    if (!this._raceListEl) return;
    this._raceListEl.innerHTML = '';
    const races = this._playerData.races ?? [];
    if (!races.length) {
      this._raceListEl.innerHTML = '<div style="padding:20px;color:var(--pm-muted);font-size:13px;">No races discovered yet.</div>';
      return;
    }
    for (const race of races) {
      const item = document.createElement('div');
      item.className = 'pm-race-item';
      item.innerHTML = `
        <div class="pm-race-type-tag">${race.type?.toUpperCase() ?? 'RACE'}</div>
        <div class="pm-race-name">${race.name}</div>
        <div class="pm-race-meta">${race.district ?? ''} · ${race.class ?? 'Open'}</div>
      `;
      item.addEventListener('click', () => {
        this._raceListEl.querySelectorAll('.pm-race-item').forEach(r => r.classList.remove('selected'));
        item.classList.add('selected');
        this._showRaceDetail(race);
      });
      this._raceListEl.appendChild(item);
    }
  }

  _showRaceDetail(race) {
    const el = this._raceDetailEl;
    const payout = race.payout ?? { first: 0, second: 0, third: 0 };
    el.innerHTML = `
      <div class="pm-race-detail-name">${race.name}</div>
      <div class="pm-race-detail-meta">
        <span class="pm-badge">${race.type?.toUpperCase() ?? 'RACE'}</span>
        <span class="pm-badge">${race.class ?? 'Open Class'}</span>
        ${race.laps ? `<span class="pm-badge">${race.laps} Laps</span>` : ''}
        ${race.distanceKm ? `<span class="pm-badge">${race.distanceKm} km</span>` : ''}
      </div>
      ${race.personalBest ? `<div style="font-size:13px;color:var(--pm-gold);">🏆 Your Best: ${race.personalBest}</div>` : ''}
      <div class="pm-reward-row">
        <div class="pm-reward-card">
          <div class="pm-reward-pos gold">1ST</div>
          <div class="pm-reward-val">${payout.first.toLocaleString()} CR</div>
        </div>
        <div class="pm-reward-card">
          <div class="pm-reward-pos silver">2ND</div>
          <div class="pm-reward-val">${payout.second.toLocaleString()} CR</div>
        </div>
        <div class="pm-reward-card">
          <div class="pm-reward-pos bronze">3RD</div>
          <div class="pm-reward-val">${payout.third.toLocaleString()} CR</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:auto;">
        <button class="pm-btn primary" id="pm-go-race">GO TO RACE</button>
        <button class="pm-btn secondary">VIEW ON MAP</button>
      </div>
    `;
    el.querySelector('#pm-go-race').addEventListener('click', () => {
      this._onFastTravel({ type: 'race', id: race.id, name: race.name });
      this.close();
    });
  }

  _refreshFestivalPanel() {
    if (!this._festivalContent) return;
    this._festivalContent.innerHTML = '';

    const events = (this._playerData.festivalEvents ?? [])
      .filter(e => (e.season ?? 'summer') === this._activeSeason);

    const TYPE_ICONS = {
      circuit: '🔄', sprint: '➡', drag: '⚡', drift: '〰', speedtrap: '📸', speedzone: '📏',
    };

    const cards = document.createElement('div');
    cards.className = 'pm-event-cards';
    for (const evt of events) {
      const card = document.createElement('div');
      card.className = 'pm-event-card' + (evt.completed ? ' completed' : '');
      card.innerHTML = `
        <span class="pm-event-type-icon">${TYPE_ICONS[evt.type] ?? '🏁'}</span>
        <div class="pm-event-info">
          <div class="pm-event-name">${evt.name}</div>
          <div class="pm-event-class">${evt.class ?? 'Open'} · ${evt.district ?? ''}</div>
        </div>
        <div class="pm-event-reward">${(evt.creditReward ?? 0).toLocaleString()} CR</div>
        ${evt.completed ? '<div class="pm-event-done">✓</div>' : ''}
      `;
      if (!evt.completed) {
        card.addEventListener('click', () => {
          this._onFastTravel({ type: 'festival-event', id: evt.id, name: evt.name });
          this.close();
        });
      }
      cards.appendChild(card);
    }

    if (!events.length) {
      cards.innerHTML = '<div style="color:var(--pm-muted);font-size:14px;padding:16px 0;">No events available this season.</div>';
    }

    // Season unlock track.
    const completed   = events.filter(e => e.completed).length;
    const total       = events.length || 1;
    const pct         = Math.min(100, (completed / total) * 100);
    const MILESTONES  = [
      { label: '10 events\nBonus CR',    pct: 33 },
      { label: '20 events\nLivery Set',  pct: 66 },
      { label: '30 events\nSeason Car',  pct: 100 },
    ];
    const track = document.createElement('div');
    track.className = 'pm-season-track';
    track.innerHTML = `
      <div class="pm-track-title">${this._activeSeason.toUpperCase()} SEASON REWARDS — ${completed} / ${total} events</div>
      <div class="pm-track-bar-wrap">
        <div class="pm-track-bg"><div class="pm-track-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="pm-track-milestones">
        ${MILESTONES.map(m => `
          <div class="pm-track-milestone ${pct >= m.pct ? 'unlocked' : ''}">
            ${m.label.replace('\n','<br>')}
          </div>`).join('')}
      </div>
    `;

    this._festivalContent.append(cards, track);
  }

  // ─── Map filter buttons ────────────────────────────────────────────────────

  _syncMapFilterButtons() {
    for (const [key, btn] of Object.entries(this._mapFilterBtns ?? {})) {
      btn.classList.toggle('on', !!this._mapFilters[key]);
    }
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  _bindKeys() {
    this._onKeyDown = (e) => {
      // Open on Escape (if closed).
      if (e.code === 'Escape') {
        e.preventDefault();
        this._isOpen ? this.close() : this.open();
        return;
      }
      if (!this._isOpen) return;

      // Number keys 1–7 switch tabs.
      if (KEY_TO_TAB[e.key]) {
        e.preventDefault();
        this._activateTab(KEY_TO_TAB[e.key]);
        return;
      }

      // Arrow keys navigate sidebar.
      const tabIds = TABS.map(t => t.id);
      const idx    = tabIds.indexOf(this._activeTab);
      if (e.code === 'ArrowUp' && idx > 0) {
        e.preventDefault();
        this._activateTab(tabIds[idx - 1]);
        this._tabBtnEls[tabIds[idx - 1]]?.focus();
      } else if (e.code === 'ArrowDown' && idx < tabIds.length - 1) {
        e.preventDefault();
        this._activateTab(tabIds[idx + 1]);
        this._tabBtnEls[tabIds[idx + 1]]?.focus();
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  _unbindKeys() {
    window.removeEventListener('keydown', this._onKeyDown);
  }

  // ─── CSS injection ─────────────────────────────────────────────────────────

  _injectCSS() {
    if (document.getElementById('pm-styles')) return;
    const s = document.createElement('style');
    s.id = 'pm-styles';
    s.textContent = PHONE_CSS;
    document.head.appendChild(s);
  }
}

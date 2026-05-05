/**
 * PART 5 — Avatar Customization
 * DriverCard.js — Standalone driver card renderer.
 *                 Used on leaderboards, race start screens, and profile views.
 */

import { avatarSystem } from '../avatar/AvatarSystem.js';
import { DRIVER_TITLES, CARD_BACKGROUNDS, STICKERS } from '../avatar/AvatarData.js';

// Card background visual themes (CSS class mapping)
const BG_THEMES = {
  bg_default:  'theme-asphalt',
  bg_city:     'theme-city',
  bg_sunset:   'theme-sunset',
  bg_neon:     'theme-neon',
  bg_gold:     'theme-gold',
  bg_carbon:   'theme-carbon',
  bg_podium:   'theme-podium',
  bg_legend:   'theme-legend',
  bg_dawn:     'theme-dawn',
  bg_storm:    'theme-storm',
};

/**
 * Renders a driver card element into `container`.
 * Can use current player state or a passed-in profile snapshot.
 *
 * @param {HTMLElement} container
 * @param {object} [profileSnapshot]  Optional — from avatarSystem.exportProfile()
 * @param {object} [opts]
 * @param {boolean} [opts.compact]    Render a smaller inline version
 * @param {number}  [opts.level]      Player level badge
 * @param {string}  [opts.carName]    Car name to show on card
 */
export function renderDriverCard(container, profileSnapshot, opts = {}) {
  const state = profileSnapshot
    ? _buildCardDataFromSnapshot(profileSnapshot)
    : avatarSystem.getDriverCard();

  const s = avatarSystem.state;
  const bgTheme = BG_THEMES[s.cardBackground] ?? 'theme-asphalt';

  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = `driver-card ${bgTheme}`;
  if (opts.compact) card.classList.add('driver-card--compact');
  card.style.setProperty('--card-accent', state.cardAccent ?? '#E94560');

  // Flag
  const flag = document.createElement('img');
  flag.className = 'dc-flag';
  flag.src = `https://flagcdn.com/24x18/${(s.nationality || 'us').toLowerCase()}.png`;
  flag.alt = s.nationality;
  flag.onerror = () => { flag.style.display = 'none'; };

  // Avatar preview (placeholder — Phase 2 will render actual 3D portrait)
  const avatar = document.createElement('div');
  avatar.className = 'dc-avatar';
  avatar.textContent = '👤';

  // Level badge
  if (opts.level != null) {
    const lvl = document.createElement('div');
    lvl.className = 'dc-level';
    lvl.textContent = `LVL ${opts.level}`;
    avatar.appendChild(lvl);
  }

  // Name + title block
  const info = document.createElement('div');
  info.className = 'dc-info';

  const name = document.createElement('div');
  name.className = 'dc-name';
  name.textContent = state.driverName;

  const title = document.createElement('div');
  title.className = 'dc-title';
  title.textContent = state.title;

  info.appendChild(name);
  info.appendChild(title);

  // Car name (if provided)
  if (opts.carName) {
    const carEl = document.createElement('div');
    carEl.className = 'dc-car';
    carEl.textContent = `🚗 ${opts.carName}`;
    info.appendChild(carEl);
  }

  // Stickers row
  const stickers = document.createElement('div');
  stickers.className = 'dc-stickers';

  for (const id of (s.activeStickers ?? [])) {
    const stk = STICKERS.find(s => s.id === id);
    if (!stk) continue;
    const chip = document.createElement('span');
    chip.className = 'dc-sticker-chip';
    chip.textContent = stk.label;
    stickers.appendChild(chip);
  }

  // Accent bar at bottom
  const accent = document.createElement('div');
  accent.className = 'dc-accent-bar';

  card.appendChild(flag);
  card.appendChild(avatar);
  card.appendChild(info);
  card.appendChild(stickers);
  card.appendChild(accent);

  container.appendChild(card);
  return card;
}

function _buildCardDataFromSnapshot(snap) {
  const title = DRIVER_TITLES.find(t => t.id === snap.driverTitle);
  return {
    driverName: snap.driverName,
    title:      title?.label ?? 'Rookie',
    cardAccent: '#E94560',
  };
}

/**
 * Render a race start lineup of driver cards.
 * @param {HTMLElement} container
 * @param {Array<{profile, level, carName, position}>} drivers
 */
export function renderRaceLineup(container, drivers) {
  container.innerHTML = '';
  const lineup = document.createElement('div');
  lineup.className = 'race-lineup';

  for (const driver of drivers) {
    const slot = document.createElement('div');
    slot.className = 'race-lineup-slot';

    const pos = document.createElement('div');
    pos.className = 'race-pos';
    pos.textContent = `P${driver.position}`;

    const cardWrap = document.createElement('div');
    renderDriverCard(cardWrap, driver.profile, {
      compact: true,
      level: driver.level,
      carName: driver.carName,
    });

    slot.appendChild(pos);
    slot.appendChild(cardWrap);
    lineup.appendChild(slot);
  }

  container.appendChild(lineup);
}

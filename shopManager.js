/**
 * js/shops/shopManager.js
 * Horizon City — Central Shop & Economy Coordinator.
 *
 * Responsibilities:
 *   • Single import point for all Part 6 shop systems
 *   • Unified shop location registry (for map, phone menu, world triggers)
 *   • Active shop state management (which shop is open, what tab)
 *   • Cross-shop "open shop" dispatcher (called by world entry triggers)
 *   • Global init (first-run setup — grants starter car, starter outfit, sets balance)
 *   • Global reset (new-game-plus / dev wipe — calls every module's reset)
 *   • Credit-bar update event (fires whenever balance changes, for HUD binding)
 *   • Convenience helpers used by shopUI.js and phoneMenu.js
 */

// ── Economy ────────────────────────────────────────────────────────────────────
export {
  getBalance,
  canAfford,
  earn,
  spend,
  initEconomy,
  resetEconomy,
  onBalanceChange,
  getHistory,
  calcSellBackValue,
  SELL_BACK_RATE,
  STARTING_CREDITS,
  INTRO_BONUS,
  RACE_REWARDS,
  CHAMPIONSHIP_ENTRY_FEE,
  CHAMPIONSHIP_PAYOUT_MULTIPLIER,
  attemptDailyLogin as _economyDailyLogin,  // internal — use festivalHub's wrapper
  getWheelspinCount,
  addWheelspin,
  consumeWheelspin,
  WHEELSPIN_PRIZE_POOL,
} from './Economy.js';

// ── Car data (read-only reference layer) ──────────────────────────────────────
export {
  CARS,
  getCarById,
  getCarsByClass,
  getCarsByBrand,
  getCarsByCategory,
} from '../car/carData.js';

// ── Autoshow & Garage ──────────────────────────────────────────────────────────
export {
  STARTER_CAR_ID,
  grantStarterCar,
  getGarage,
  getGarageCount,
  ownscar,
  getActiveCar,
  getActiveCarObject,
  setActiveCar,
  toggleFavourite,
  isFavourite,
  buyCar,
  sellCar,
  browseAutoshow,
  getAutoshowDetail,
  resetAutoshow,
  AUTOSHOW_LOCATIONS,
} from './AutoShow.js';

// ── Parts & Performance Shop ───────────────────────────────────────────────────
export {
  PART_CATEGORIES,
  TIERS,
  PARTS_CATALOG,
  ENGINE_SWAPS,
  ALL_PARTS,
  getInstalledParts,
  isPartInstalled,
  calcCurrentPR,
  previewPartInstall,
  buyAndInstallPart,
  getTunePresets,
  saveTunePreset,
  deleteTunePreset,
  renameTunePreset,
  TUNE_SLIDERS,
  PARTS_SHOP_LOCATION,
  TUNING_GARAGE_LOCATION,
  resetPartsShop,
} from './partsShop.js';

// ── Livery & Paint Shop ────────────────────────────────────────────────────────
export {
  PAINT_TYPES,
  PAINT_ZONES,
  DEFAULT_PAINT,
  WINDOW_TINT_LEVELS,
  HORIZON_COLORS,
  LIVERY_CATALOG,
  BODY_KITS,
  getPaintConfig,
  setPaintZone,
  setWindowTint,
  buyAndApplyPaintType,
  ownsLivery,
  buyLivery,
  grantLivery,
  browseLiveries,
  applyLivery,
  getAppliedLivery,
  getInstalledBodyKitPieces,
  buyAndInstallBodyKitPiece,
  exportLiveryCode,
  importLiveryCode,
  LIVERY_SHOP_LOCATION,
  resetLiveryShop,
} from './LiveryShop.js';

// ── Clothing Boutique ──────────────────────────────────────────────────────────
export {
  CLOTHING_SLOTS,
  CLOTHING_CATALOG,
  STARTER_OUTFIT,
  grantStarterOutfit,
  getWardrobe,
  getWardrobeBySlot,
  ownsItem,
  browseBoutique,
  buyClothingItem,
  grantClothingItem,
  getEquippedOutfit,
  isEquipped,
  equipItem,
  unequipSlot,
  getOutfitPresets,
  saveOutfitPreset,
  loadOutfitPreset,
  deleteOutfitPreset,
  renameOutfitPreset,
  randomOutfit,
  BOUTIQUE_LOCATION,
  resetClothingShop,
} from './ClothingShop.js';

// ── Race HQ ────────────────────────────────────────────────────────────────────
export {
  DISTRICTS,
  RACE_TYPES,
  EVENTS,
  getEventById,
  getEventsByType,
  getEventsByDistrict,
  browseEvents,
  getPersonalBest,
  submitPersonalBest,
  formatTime,
  getBotLeaderboard,
  signUpForEvent,
  recordRaceResult,
  getRecentResults,
  getUnclaimedRewards,
  clearUnclaimedRewards,
  RACE_HQ_LOCATION,
  resetRaceHQ,
} from './raceHQ.js';

// ── Festival Hub ───────────────────────────────────────────────────────────────
export {
  SEASONS,
  getCurrentSeason,
  PLAYLIST_CHALLENGES,
  getPlaylistProgress,
  completeChallenge,
  isChallengeComplete,
  hasClaimedReward,
  claimChallengeReward,
  getPlaylistView,
  getPlaylistStats,
  attemptDailyLogin,
  getDailyLoginState,
  doWheelspin,
  getWheelspinTokens,
  getGlobalLeaderboard,
  getDriftLeaderboards,
  GAME_NEWS,
  HUB_TILES,
  getHubTiles,
  FESTIVAL_HUB_LOCATION,
  resetFestivalHub,
} from './FestivalHub.js';

// ─────────────────────────────────────────────────────────────────────────────
// ── Shop location registry ────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

import { AUTOSHOW_LOCATIONS }    from './AutoShow.js';
import { PARTS_SHOP_LOCATION, TUNING_GARAGE_LOCATION } from './partsShop.js';
import { LIVERY_SHOP_LOCATION }  from './LiveryShop.js';
import { BOUTIQUE_LOCATION }     from './ClothingShop.js';
import { RACE_HQ_LOCATION }      from './raceHQ.js';
import { FESTIVAL_HUB_LOCATION } from './FestivalHub.js';

/**
 * Every purchasable-service location in Horizon City.
 * Consumed by:
 *  - world/poi.js   → places entry trigger volumes at the right coordinates
 *  - ui/map.js      → renders shop pins on the full-screen map
 *  - ui/phoneMenu.js → populates the "Shops" tab list
 *
 * Each entry shape:
 *  { id, label, district, description, shopKey, allClasses?, classFilter?, categoryFilter? }
 *
 * `shopKey` maps to the SHOP_KEYS constant below — used by openShop().
 */
export const ALL_SHOP_LOCATIONS = [
  // Autoshow
  ...AUTOSHOW_LOCATIONS.map(loc => ({ ...loc, shopKey: 'autoshow' })),

  // Parts
  { ...PARTS_SHOP_LOCATION,    shopKey: 'parts'   },
  { ...TUNING_GARAGE_LOCATION, shopKey: 'tuning'  },

  // Livery
  { ...LIVERY_SHOP_LOCATION,   shopKey: 'livery'  },

  // Clothing
  { ...BOUTIQUE_LOCATION,      shopKey: 'clothing' },

  // Race HQ
  { ...RACE_HQ_LOCATION,       shopKey: 'raceHQ'  },

  // Festival Hub
  { ...FESTIVAL_HUB_LOCATION,  shopKey: 'festivalHub' },
];

/** Typed string constants for all shop identifiers. */
export const SHOP_KEYS = /** @type {const} */ ({
  AUTOSHOW:     'autoshow',
  PARTS:        'parts',
  TUNING:       'tuning',
  LIVERY:       'livery',
  CLOTHING:     'clothing',
  RACE_HQ:      'raceHQ',
  FESTIVAL_HUB: 'festivalHub',
});

// ─────────────────────────────────────────────────────────────────────────────
// ── Active shop state ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal state — which shop is currently displayed.
 * Never read this directly from UI; subscribe via onShopChange().
 *
 * Shape: { shopKey: string|null, locationId: string|null, tab: string|null }
 */
let _activeShop = {
  shopKey:    null,
  locationId: null,
  tab:        null,
};

/** Listeners notified when the active shop changes. */
const _shopListeners = new Set();

/**
 * Subscribe to shop open/close events.
 * @param {function({ shopKey, locationId, tab }): void} fn
 * @returns {function} unsubscribe
 */
export function onShopChange(fn) {
  _shopListeners.add(fn);
  return () => _shopListeners.delete(fn);
}

function _notifyShop() {
  _shopListeners.forEach(fn => fn({ ..._activeShop }));
}

/** Returns the currently open shop state (or nulls if no shop is open). */
export function getActiveShop() {
  return { ..._activeShop };
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Open / close dispatcher ───────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a shop screen.
 * Called by:
 *  - world/buildings.js when the player enters a shop trigger volume
 *  - ui/phoneMenu.js when the player taps a shop in the Shops list
 *  - ui/map.js when the player taps a shop pin and hits "Enter"
 *
 * @param {string} shopKey     One of SHOP_KEYS values.
 * @param {object} [options]
 * @param {string} [options.locationId]  Which specific location was entered (for autoshow).
 * @param {string} [options.tab]         Optional initial tab / category to scroll to.
 */
export function openShop(shopKey, { locationId = null, tab = null } = {}) {
  if (!Object.values(SHOP_KEYS).includes(shopKey)) {
    console.warn(`openShop: unknown shopKey "${shopKey}"`);
    return;
  }

  // Validate locationId belongs to this shopKey
  if (locationId) {
    const match = ALL_SHOP_LOCATIONS.find(
      l => l.id === locationId && l.shopKey === shopKey
    );
    if (!match) {
      console.warn(`openShop: locationId "${locationId}" not found for shopKey "${shopKey}"`);
      locationId = null;
    }
  }

  // Fall back to first location for this shopKey if none provided
  if (!locationId) {
    const first = ALL_SHOP_LOCATIONS.find(l => l.shopKey === shopKey);
    locationId  = first?.id ?? null;
  }

  _activeShop = { shopKey, locationId, tab };
  _notifyShop();
}

/**
 * Close whatever shop is currently open.
 * Called by shopUI.js when the player hits Escape or the back button.
 */
export function closeShop() {
  _activeShop = { shopKey: null, locationId: null, tab: null };
  _notifyShop();
}

/** Convenience: check if any shop is currently open. */
export function isShopOpen() {
  return _activeShop.shopKey !== null;
}

/**
 * Switch to a different tab within the currently open shop.
 * No-op if no shop is open.
 * @param {string} tab
 */
export function setShopTab(tab) {
  if (!_activeShop.shopKey) return;
  _activeShop = { ..._activeShop, tab };
  _notifyShop();
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Global init (first launch) ────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

import { initEconomy as _initEconomy }          from './Economy.js';
import { grantStarterCar as _grantStarterCar }  from './AutoShow.js';
import { grantStarterOutfit as _grantOutfit }   from './ClothingShop.js';
import { onBalanceChange as _onBalanceChange }  from './Economy.js';

/**
 * Initialise all Part 6 systems for a new save.
 * Safe to call on every game launch — each sub-system guards its own first-run.
 *
 * Call order matters:
 *  1. Economy must init first (so spend/earn have a balance to work with)
 *  2. Autoshow grants starter car (uses earn internally — no credit cost)
 *  3. Clothing grants starter outfit (no credit cost)
 *
 * @param {object}  [options]
 * @param {boolean} [options.grantIntroBonus=false]  Also award the intro-sequence 25 000 CR.
 * @param {function} [options.onBalanceUpdate]        Shortcut to wire a HUD balance listener.
 * @returns {{ freshSave: boolean }}
 */
export function initShops({ grantIntroBonus = false, onBalanceUpdate = null } = {}) {
  // 1. Economy
  const wasNull = _initEconomy(grantIntroBonus); // returns undefined; safe always

  // 2. Starter car (guarded internally)
  const carGranted = _grantStarterCar();

  // 3. Starter outfit (guarded internally)
  _grantOutfit();

  // 4. Wire optional HUD listener
  if (typeof onBalanceUpdate === 'function') {
    _onBalanceChange(onBalanceUpdate);
  }

  // freshSave = true if the car was just granted (economy + car both new)
  return { freshSave: carGranted };
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Global reset ──────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

import { resetEconomy as _resetEconomy }        from './Economy.js';
import { resetAutoshow as _resetAutoshow }       from './AutoShow.js';
import { resetPartsShop as _resetParts }         from './partsShop.js';
import { resetLiveryShop as _resetLivery }       from './LiveryShop.js';
import { resetClothingShop as _resetClothing }   from './ClothingShop.js';
import { resetRaceHQ as _resetRace }             from './raceHQ.js';
import { resetFestivalHub as _resetFestival }    from './FestivalHub.js';

/**
 * Wipe all Part 6 localStorage data.
 * Use for new-game-plus or dev testing.
 * Always call closeShop() before this so the UI doesn't render stale state.
 */
export function resetAllShops() {
  closeShop();
  _resetEconomy();
  _resetAutoshow();
  _resetParts();
  _resetLivery();
  _resetClothing();
  _resetRace();
  _resetFestival();
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Cross-shop convenience helpers ───────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

import { getBalance as _getBalance }            from './Economy.js';
import { getGarage as _getGarage, getActiveCarObject as _getActiveCar } from './AutoShow.js';
import { calcCurrentPR as _calcPR }             from './partsShop.js';

/**
 * Returns a snapshot of the player's current in-game status.
 * Used by the phone menu header, race sign-up screen, and shop entry checks.
 *
 * @returns {{
 *   credits: number,
 *   garageCount: number,
 *   activeCar: object|null,
 *   activeCarPR: number,
 * }}
 */
export function getPlayerStatus() {
  const activeCar = _getActiveCar();
  return {
    credits:     _getBalance() ?? 0,
    garageCount: _getGarage().length,
    activeCar,
    activeCarPR: activeCar ? _calcPR(activeCar.id) : 0,
  };
}

/**
 * Checks whether the player's active car meets an event's PR requirements.
 * Convenience wrapper over signUpForEvent's internal validation.
 *
 * @param {{ minPR?: number, maxPR?: number, class?: string }} eventRequirements
 * @returns {{ eligible: boolean, reason?: string }}
 */
export function checkEventEligibility(eventRequirements) {
  const { activeCar, activeCarPR } = getPlayerStatus();

  if (!activeCar) {
    return { eligible: false, reason: 'NO_ACTIVE_CAR' };
  }

  const { minPR, maxPR, class: reqClass } = eventRequirements;

  if (minPR != null && activeCarPR < minPR) {
    return { eligible: false, reason: 'PR_TOO_LOW', needed: minPR, current: activeCarPR };
  }
  if (maxPR != null && activeCarPR > maxPR) {
    return { eligible: false, reason: 'PR_TOO_HIGH', needed: maxPR, current: activeCarPR };
  }
  if (reqClass && activeCar.class !== reqClass) {
    return { eligible: false, reason: 'WRONG_CLASS', needed: reqClass, current: activeCar.class };
  }

  return { eligible: true };
}

/**
 * Returns the location metadata for a given shop location ID.
 * @param {string} locationId
 * @returns {object|null}
 */
export function getShopLocation(locationId) {
  return ALL_SHOP_LOCATIONS.find(l => l.id === locationId) ?? null;
}

/**
 * Returns all locations belonging to a specific district.
 * Used by the map to highlight shops when the player hovers a district.
 * @param {string} districtLabel
 * @returns {Array}
 */
export function getShopsByDistrict(districtLabel) {
  return ALL_SHOP_LOCATIONS.filter(l => l.district === districtLabel);
}

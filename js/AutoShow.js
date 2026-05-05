/**
 * js/economy/autoshow.js
 * Horizon City — Autoshow & Garage logic.
 *
 * Responsibilities:
 *   • Browse / filter the car roster (delegates to carData.js for data)
 *   • Purchase cars (deducts credits via economy.js)
 *   • Manage the player's garage (localStorage)
 *   • Sell cars back at 60% value
 *   • Favourite / unfavourite cars
 *   • Track active (equipped) car
 *   • Enforce starter-car gift on first launch
 */

import { CARS, getCarById, getCarsByClass, getCarsByBrand, getCarsByCategory } from '../car/carData.js';
import { spend, earn, canAfford, calcSellBackValue } from './Economy.js';

// ── Storage keys ───────────────────────────────────────────────────────────────
const KEY_GARAGE       = 'hc_garage';        // Set of owned car IDs
const KEY_ACTIVE_CAR   = 'hc_active_car';    // ID of currently equipped car
const KEY_FAVOURITES   = 'hc_favourites';    // Set of favourite car IDs
const KEY_STARTER_DONE = 'hc_starter_given'; // Flag — starter car already awarded

// ── Starter car ────────────────────────────────────────────────────────────────
/**
 * The car gifted to every new player at first launch.
 * Uses carData id 'verano_sprint_st' (D-class hot hatch — fun, accessible).
 */
export const STARTER_CAR_ID = 'verano_sprint_st';

/**
 * Award the starter car if it hasn't been given yet.
 * Safe to call multiple times.
 * @returns {boolean} true if the car was newly granted.
 */
export function grantStarterCar() {
  if (localStorage.getItem(KEY_STARTER_DONE)) return false;
  _addToGarage(STARTER_CAR_ID);
  setActiveCar(STARTER_CAR_ID);
  localStorage.setItem(KEY_STARTER_DONE, '1');
  return true;
}

// ── Garage persistence helpers ─────────────────────────────────────────────────

function _loadGarage() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY_GARAGE) || '[]'));
  } catch { return new Set(); }
}

function _saveGarage(set) {
  localStorage.setItem(KEY_GARAGE, JSON.stringify([...set]));
}

function _addToGarage(carId) {
  const g = _loadGarage();
  g.add(carId);
  _saveGarage(g);
}

function _removeFromGarage(carId) {
  const g = _loadGarage();
  g.delete(carId);
  _saveGarage(g);
}

// ── Favourites helpers ─────────────────────────────────────────────────────────

function _loadFavourites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY_FAVOURITES) || '[]'));
  } catch { return new Set(); }
}

function _saveFavourites(set) {
  localStorage.setItem(KEY_FAVOURITES, JSON.stringify([...set]));
}

// ── Public garage queries ──────────────────────────────────────────────────────

/** Returns array of full car objects for all owned cars. */
export function getGarage() {
  const ids = _loadGarage();
  const favs = _loadFavourites();
  return [...ids]
    .map(id => {
      const car = getCarById(id);
      if (!car) return null;
      return { ...car, isFavourite: favs.has(id), isActive: id === getActiveCar() };
    })
    .filter(Boolean)
    .sort((a, b) => {
      // Favourites first, then by PR descending
      if (a.isFavourite !== b.isFavourite) return a.isFavourite ? -1 : 1;
      return b.pr - a.pr;
    });
}

/** Returns true if the player owns a given car ID. */
export function ownscar(carId) {
  return _loadGarage().has(carId);
}

/** Returns the garage count. */
export function getGarageCount() {
  return _loadGarage().size;
}

// ── Active car ─────────────────────────────────────────────────────────────────

export function getActiveCar() {
  return localStorage.getItem(KEY_ACTIVE_CAR) || null;
}

export function getActiveCarObject() {
  const id = getActiveCar();
  return id ? getCarById(id) : null;
}

/**
 * Set a car as the currently driven car.
 * Must be owned by the player.
 */
export function setActiveCar(carId) {
  if (!ownscar(carId)) {
    console.warn(`setActiveCar: player doesn't own "${carId}"`);
    return false;
  }
  localStorage.setItem(KEY_ACTIVE_CAR, carId);
  return true;
}

// ── Favourites ─────────────────────────────────────────────────────────────────

export function toggleFavourite(carId) {
  const favs = _loadFavourites();
  if (favs.has(carId)) {
    favs.delete(carId);
  } else {
    favs.add(carId);
  }
  _saveFavourites(favs);
  return favs.has(carId);
}

export function isFavourite(carId) {
  return _loadFavourites().has(carId);
}

// ── Purchase ───────────────────────────────────────────────────────────────────

/**
 * Result shape for buy / sell operations:
 * { success, reason?, car?, newBalance? }
 */

/**
 * Attempt to purchase a car from the Autoshow.
 */
export function buyCar(carId) {
  const car = getCarById(carId);

  if (!car) {
    return { success: false, reason: 'CAR_NOT_FOUND' };
  }
  if (ownscar(carId)) {
    return { success: false, reason: 'ALREADY_OWNED' };
  }
  if (!canAfford(car.price)) {
    return { success: false, reason: 'INSUFFICIENT_CREDITS' };
  }

  const result = spend(car.price, 'CAR_PURCHASE', `Bought ${car.name}`);
  if (!result.success) {
    return { success: false, reason: 'SPEND_FAILED' };
  }

  _addToGarage(carId);

  return {
    success:    true,
    car,
    newBalance: result.balance,
  };
}

// ── Sell ───────────────────────────────────────────────────────────────────────

/**
 * Sell a car back to the Autoshow for 60% of its purchase price.
 * Cannot sell the active car if it's the only car in the garage.
 */
export function sellCar(carId) {
  const car = getCarById(carId);

  if (!car) {
    return { success: false, reason: 'CAR_NOT_FOUND' };
  }
  if (!ownscar(carId)) {
    return { success: false, reason: 'NOT_OWNED' };
  }
  if (getGarageCount() <= 1) {
    return { success: false, reason: 'LAST_CAR' };
  }
  if (getActiveCar() === carId) {
    return { success: false, reason: 'CAR_IS_ACTIVE' };
  }

  const sellValue = calcSellBackValue(car.price);
  _removeFromGarage(carId);

  // Remove from favourites if it was there
  const favs = _loadFavourites();
  favs.delete(carId);
  _saveFavourites(favs);

  earn(sellValue, 'CAR_SOLD', `Sold ${car.name}`);

  return {
    success:    true,
    car,
    sellValue,
  };
}

// ── Browsing & filtering ───────────────────────────────────────────────────────

/**
 * Returns cars available to buy (not already owned), with optional filtering.
 *
 * @param {object} [filters]
 * @param {string}   [filters.class]        'D'|'C'|'B'|'A'|'S1'|'S2'
 * @param {string}   [filters.brand]        brand id string
 * @param {string}   [filters.category]     e.g. 'sport', 'muscle', 'drift'
 * @param {string}   [filters.drivetrain]   'RWD'|'FWD'|'AWD'
 * @param {string}   [filters.bodyStyle]    partial match, case-insensitive
 * @param {number}   [filters.maxPrice]
 * @param {number}   [filters.minPR]
 * @param {number}   [filters.maxPR]
 * @param {string}   [filters.search]       searches name + description
 * @param {string}   [filters.sortBy]       'price'|'pr'|'name'|'speed'|'handling'|'acceleration'
 * @param {string}   [filters.sortDir]      'asc'|'desc'
 * @param {boolean}  [filters.excludeOwned] default true
 * @returns {Array} Filtered + sorted car objects, each decorated with { owned, canAfford }
 */
export function browseAutoshow(filters = {}) {
  const {
    class:    cls,
    brand,
    category,
    drivetrain,
    bodyStyle,
    maxPrice,
    minPR,
    maxPR,
    search,
    sortBy  = 'pr',
    sortDir = 'asc',
    excludeOwned = true,
  } = filters;

  const owned   = _loadGarage();
  const balance = parseInt(localStorage.getItem('hc_credits') || '0', 10);

  let list = [...CARS];

  if (excludeOwned)          list = list.filter(c => !owned.has(c.id));
  if (cls)                   list = list.filter(c => c.class === cls);
  if (brand)                 list = list.filter(c => c.brand === brand);
  if (category)              list = list.filter(c => c.category === category);
  if (drivetrain)            list = list.filter(c => c.drivetrain === drivetrain);
  if (bodyStyle)             list = list.filter(c => c.bodyStyle.toLowerCase().includes(bodyStyle.toLowerCase()));
  if (maxPrice != null)      list = list.filter(c => c.price <= maxPrice);
  if (minPR != null)         list = list.filter(c => c.pr >= minPR);
  if (maxPR != null)         list = list.filter(c => c.pr <= maxPR);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.brand.toLowerCase().includes(q)
    );
  }

  // Sort
  const statSorts = ['speed', 'handling', 'acceleration', 'braking'];
  list.sort((a, b) => {
    let va, vb;
    if (statSorts.includes(sortBy)) {
      va = a.stats[sortBy]; vb = b.stats[sortBy];
    } else if (sortBy === 'name') {
      va = a.name; vb = b.name;
    } else {
      va = a[sortBy] ?? 0; vb = b[sortBy] ?? 0;
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // Decorate with player context
  return list.map(car => ({
    ...car,
    owned:      owned.has(car.id),
    affordable: balance >= car.price,
  }));
}

/**
 * Returns a single car's full detail object decorated with player context.
 * Used for the turntable detail view.
 */
export function getAutoshowDetail(carId) {
  const car = getCarById(carId);
  if (!car) return null;

  const balance   = parseInt(localStorage.getItem('hc_credits') || '0', 10);
  const sellValue = calcSellBackValue(car.price);

  return {
    ...car,
    owned:      ownscar(carId),
    isFavourite: isFavourite(carId),
    isActive:   getActiveCar() === carId,
    affordable: balance >= car.price,
    sellValue,
  };
}

// ── Showroom locations ─────────────────────────────────────────────────────────

export const AUTOSHOW_LOCATIONS = [
  {
    id:          'main_autoshow',
    label:       'Main Autoshow',
    district:    'Downtown Core',
    description: 'The largest showroom in Horizon City. Every car across all six classes under one roof, displayed on illuminated turntable plinths.',
    allClasses:  true,
  },
  {
    id:          'suburban_lot',
    label:       'Suburban Lot',
    district:    'Suburbs District',
    description: 'A more relaxed, open-air lot specialising in D-class, classic, and off-road vehicles. Barn-find adjacent models often appear here first.',
    classFilter: ['D', 'C'],
    categoryFilter: ['classic', 'off-road', 'muscle', 'rally'],
  },
];

// ── Reset (dev / new-game) ─────────────────────────────────────────────────────

export function resetAutoshow() {
  [KEY_GARAGE, KEY_ACTIVE_CAR, KEY_FAVOURITES, KEY_STARTER_DONE].forEach(k =>
    localStorage.removeItem(k)
  );
}

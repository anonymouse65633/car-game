/**
 * EconomyManager.js  (js/shops/economy.js)
 * ─────────────────────────────────────────────────────────────────────────────
 * All credit transactions in Horizon City flow through this module.
 * No other system writes credits directly to SaveManager — they call
 * EconomyManager, which validates, applies, and records the change.
 *
 * Responsibilities:
 *  - Credit balance read / add / deduct with reason tagging
 *  - Car purchase (Autoshow) and sell-back (60% of purchase price)
 *  - Parts, livery, body kit, and clothing purchases
 *  - Race entry fee collection and winner payout
 *  - Bonus Board and landmark credit rewards
 *  - Wheelspin and Accolade credit prize dispatch
 *  - Transaction history log (last 100 entries) for the Ledger UI
 *  - Credit-tick event feed for the animated HUD counter
 *  - Economy balance validation helpers used by all shop UIs
 *
 * Dependencies:
 *  - SaveManager        — persist credit balance and garage
 *  - NotificationSystem — low-balance warning toast
 *  - AudioManager       — credit earn / spend SFX
 *
 * Usage:
 *  economyManager.getBalance()
 *  economyManager.addCredits(5000, 'race_finish')
 *  economyManager.deductCredits(12000, 'part_purchase')
 *  economyManager.purchaseCar(carListing)        → { success, reason? }
 *  economyManager.sellCar(carId)                 → { success, value }
 *  economyManager.purchasePart(partDef, carId)   → { success, reason? }
 *  economyManager.purchaseClothing(itemDef)      → { success, reason? }
 *  economyManager.collectBoard(boardId, value)   → { success, alreadyCollected }
 *  economyManager.collectLandmark(landmarkId)    → { success, alreadyCollected }
 *  economyManager.payRaceEntry(raceId, fee)      → { success, reason? }
 *  economyManager.grantRacePayout(raceId, position, classKey, difficulty)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { saveManager } from '../save/SaveManager.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CAR_SELL_RATE        = 0.60;  // 60% of purchase price
const MAX_HISTORY_ENTRIES  = 100;
const LANDMARK_REWARD_CR   = 1000;

// ─── Race Payout Tables ───────────────────────────────────────────────────────
// Base payout per finishing position, keyed by car class.
// Multiplied by difficulty modifier before being awarded.

const RACE_PAYOUT_BY_CLASS = {
  D:  { 1: 5000,  2: 3000,  3: 2000,  other: 1000 },
  C:  { 1: 10000, 2: 6000,  3: 4000,  other: 2000 },
  B:  { 1: 18000, 2: 11000, 3: 7000,  other: 3500 },
  A:  { 1: 30000, 2: 18000, 3: 12000, other: 6000 },
  S1: { 1: 50000, 2: 30000, 3: 20000, other: 10000 },
  S2: { 1: 80000, 2: 48000, 3: 32000, other: 16000 },
};

// Difficulty multiplier on race payouts
const DIFFICULTY_PAYOUT_MULTIPLIER = {
  Casual:       0.70,
  Experienced:  1.00,
  Expert:       1.30,
  Unbeatable:   1.60,
};

// Race entry fees (from design doc 6.6)
const RACE_ENTRY_FEES = {
  standard:     0,
  championship: 1000,
  elite:        10000,
};

// ─── Transaction Categories (for history grouping in UI) ──────────────────────

const TX_CATEGORY = {
  // Earning
  race_finish:          'earn',
  race_win_bonus:       'earn',
  board_collect:        'earn',
  landmark_discover:    'earn',
  accolade_reward:      'earn',
  wheelspin_prize:      'earn',
  mastery_node:         'earn',
  playlist_reward:      'earn',
  daily_login_reward:   'earn',
  first_daily_event:    'earn',
  car_sell:             'earn',
  duplicate_car_cr:     'earn',
  barn_restoration_credit: 'earn',
  // Spending
  car_purchase:         'spend',
  part_purchase:        'spend',
  livery_purchase:      'spend',
  paint_purchase:       'spend',
  bodykit_purchase:     'spend',
  clothing_purchase:    'spend',
  race_entry_fee:       'spend',
  barn_restoration:     'spend',
  car_retrieve_fee:     'spend',
  // Internal
  starting_credits:     'earn',
  intro_bonus:          'earn',
};

// ─── EconomyManager Class ─────────────────────────────────────────────────────

class EconomyManager {
  constructor() {
    // Transaction history is kept in memory and persisted via SaveManager
    this._history = saveManager.get('inventory', 'txHistory') || [];
    console.log('[EconomyManager] Initialised — balance:', this.getBalance(), 'CR');
  }

  // ─── Balance Read ────────────────────────────────────────────────────────

  /**
   * Current credit balance.
   * @returns {number}
   */
  getBalance() {
    return saveManager.inventory.getCredits();
  }

  /**
   * Whether the player can afford a given amount.
   * @param {number} amount
   * @returns {boolean}
   */
  canAfford(amount) {
    return this.getBalance() >= amount;
  }

  // ─── Core Credit Operations ──────────────────────────────────────────────

  /**
   * Add credits to the player's balance.
   *
   * @param {number} amount   Must be positive.
   * @param {string} reason   Transaction reason key (see TX_CATEGORY).
   * @param {string} [label]  Human-readable label for history log.
   * @returns {number}  New balance.
   */
  addCredits(amount, reason = 'unknown', label = '') {
    if (amount <= 0) return this.getBalance();

    const newBalance = saveManager.inventory.addCredits(amount);
    this._logTransaction(amount, reason, label, newBalance);
    this._fireCreditTick(amount, 'earn');

    if (typeof AudioManager !== 'undefined') {
      AudioManager.play('sfx_credits_earn');
    }

    window.dispatchEvent(new CustomEvent('economy:creditsChanged', {
      detail: { delta: amount, balance: newBalance, reason },
    }));

    return newBalance;
  }

  /**
   * Deduct credits from the player's balance.
   * Does NOT validate affordability — callers should check canAfford() first,
   * or use the purchase helpers which validate internally.
   *
   * @param {number} amount
   * @param {string} reason
   * @param {string} [label]
   * @returns {number}  New balance.
   */
  deductCredits(amount, reason = 'unknown', label = '') {
    if (amount <= 0) return this.getBalance();

    const newBalance = saveManager.inventory.addCredits(-amount);
    this._logTransaction(-amount, reason, label, newBalance);
    this._fireCreditTick(-amount, 'spend');

    if (typeof AudioManager !== 'undefined') {
      AudioManager.play('sfx_credits_spend');
    }

    window.dispatchEvent(new CustomEvent('economy:creditsChanged', {
      detail: { delta: -amount, balance: newBalance, reason },
    }));

    return newBalance;
  }

  // ─── Car Purchase / Sell ─────────────────────────────────────────────────

  /**
   * Purchase a car from the Autoshow.
   *
   * @param {{ carId, make, model, year, class, pi, price, ...stats }} listing
   * @returns {{ success: boolean, reason?: string }}
   */
  purchaseCar(listing) {
    if (!listing?.carId || !listing?.price) {
      return { success: false, reason: 'Invalid car listing.' };
    }
    if (saveManager.inventory.ownsCar(listing.carId)) {
      return { success: false, reason: `You already own the ${listing.make} ${listing.model}.` };
    }
    if (!this.canAfford(listing.price)) {
      const shortfall = listing.price - this.getBalance();
      return {
        success: false,
        reason: `Not enough credits — you need ${this._fmt(shortfall)} CR more.`,
      };
    }

    this.deductCredits(
      listing.price,
      'car_purchase',
      `${listing.year} ${listing.make} ${listing.model}`
    );

    saveManager.inventory.addCar({ ...listing, id: listing.carId });

    NotificationSystem.show({
      type:     'car_purchased',
      title:    '🚗 Car Purchased!',
      body:     `${listing.year} ${listing.make} ${listing.model}`,
      subtext:  `${this._fmt(listing.price)} CR spent — ${this._fmt(this.getBalance())} CR remaining`,
      duration: 4000,
    });

    window.dispatchEvent(new CustomEvent('economy:carPurchased', {
      detail: { carId: listing.carId, price: listing.price },
    }));

    console.log(`[EconomyManager] Car purchased: ${listing.carId} for ${listing.price} CR`);
    return { success: true };
  }

  /**
   * Sell a car back at 60% of its purchase price.
   * The active car cannot be sold if it's the only car in the garage.
   *
   * @param {string} carId
   * @param {number} originalPrice  Purchase price (stored in the listing on buy).
   * @returns {{ success: boolean, value?: number, reason?: string }}
   */
  sellCar(carId, originalPrice) {
    const garage = saveManager.get('inventory', 'cars') ?? [];
    if (garage.length <= 1) {
      return { success: false, reason: 'You must keep at least one car.' };
    }
    if (!saveManager.inventory.ownsCar(carId)) {
      return { success: false, reason: 'Car not found in garage.' };
    }

    const sellValue = Math.floor(originalPrice * CAR_SELL_RATE);
    const car       = saveManager.inventory.getCarById(carId);
    const label     = `${car?.year ?? ''} ${car?.make ?? ''} ${car?.model ?? ''}`.trim();

    saveManager.inventory.removeCar(carId);
    this.addCredits(sellValue, 'car_sell', label);

    NotificationSystem.show({
      type:     'car_sold',
      title:    '💰 Car Sold',
      body:     `${label} — +${this._fmt(sellValue)} CR`,
      subtext:  `${Math.round(CAR_SELL_RATE * 100)}% of purchase price`,
      duration: 4000,
    });

    window.dispatchEvent(new CustomEvent('economy:carSold', {
      detail: { carId, sellValue },
    }));

    return { success: true, value: sellValue };
  }

  /**
   * Credit award when a Wheelspin returns a car the player already owns.
   *
   * @param {string} carId
   * @param {number} shopPrice
   * @returns {number} CR awarded (80% of shop price)
   */
  convertDuplicateCar(carId, shopPrice) {
    const cr    = Math.floor(shopPrice * 0.80);
    const car   = saveManager.inventory.getCarById(carId);
    const label = car
      ? `Duplicate: ${car.year} ${car.make} ${car.model}`
      : `Duplicate car: ${carId}`;

    this.addCredits(cr, 'duplicate_car_cr', label);
    return cr;
  }

  // ─── Parts Purchase ──────────────────────────────────────────────────────

  /**
   * Purchase a performance part and apply it to a garage car.
   *
   * @param {{ partId, name, price, category, statDeltas }} partDef
   * @param {string} carId
   * @returns {{ success: boolean, reason?: string }}
   */
  purchasePart(partDef, carId) {
    if (!this.canAfford(partDef.price)) {
      return {
        success: false,
        reason: `Not enough credits — need ${this._fmt(partDef.price)} CR.`,
      };
    }
    if (!saveManager.inventory.ownsCar(carId)) {
      return { success: false, reason: 'Car not found in garage.' };
    }

    const car = saveManager.inventory.getCarById(carId);

    // Prevent buying the same part twice
    if ((car.upgrades || []).includes(partDef.partId)) {
      return { success: false, reason: 'Part already installed on this car.' };
    }

    this.deductCredits(partDef.price, 'part_purchase', `${partDef.name} → ${carId}`);

    const updatedUpgrades = [...(car.upgrades || []), partDef.partId];
    const _carU = saveManager.inventory.getCarById(carId);
    if (_carU) { Object.assign(_carU, { upgrades: updatedUpgrades }); saveManager.markDirty(); }

    window.dispatchEvent(new CustomEvent('economy:partPurchased', {
      detail: { carId, partId: partDef.partId, price: partDef.price },
    }));

    return { success: true };
  }

  // ─── Livery / Paint / Body Kit Purchase ─────────────────────────────────

  /**
   * Purchase a premium livery design.
   *
   * @param {{ liveryId, name, price }} liveryDef
   * @param {string} carId  Car to apply to.
   * @returns {{ success: boolean, reason?: string }}
   */
  purchaseLivery(liveryDef, carId) {
    if (liveryDef.price === 0) {
      // Free livery — apply directly
      const _carL = saveManager.inventory.getCarById(carId);
      if (_carL) { Object.assign(_carL, { liveryId: liveryDef.liveryId }); saveManager.markDirty(); }
      return { success: true };
    }

    if (!this.canAfford(liveryDef.price)) {
      return {
        success: false,
        reason: `Need ${this._fmt(liveryDef.price)} CR for this livery.`,
      };
    }

    this.deductCredits(liveryDef.price, 'livery_purchase', liveryDef.name);
    const _carL2 = saveManager.inventory.getCarById(carId);
    if (_carL2) { Object.assign(_carL2, { liveryId: liveryDef.liveryId }); saveManager.markDirty(); }

    window.dispatchEvent(new CustomEvent('economy:liveryPurchased', {
      detail: { carId, liveryId: liveryDef.liveryId },
    }));

    return { success: true };
  }

  /**
   * Purchase a special paint type (matte, chrome, color-shift).
   *
   * @param {{ paintType, zone, price }} paintDef
   * @param {string} carId
   * @param {string} colorHex
   * @returns {{ success: boolean, reason?: string }}
   */
  purchasePaint(paintDef, carId, colorHex) {
    if (paintDef.price > 0 && !this.canAfford(paintDef.price)) {
      return {
        success: false,
        reason: `Need ${this._fmt(paintDef.price)} CR for this paint type.`,
      };
    }

    if (paintDef.price > 0) {
      this.deductCredits(paintDef.price, 'paint_purchase', `${paintDef.paintType} paint`);
    }

    const car      = saveManager.inventory.getCarById(carId);
    const newPaint = { ...(car?.paint || {}), type: paintDef.paintType, [paintDef.zone]: colorHex };
    const _carP = saveManager.inventory.getCarById(carId);
    if (_carP) { Object.assign(_carP, { paint: newPaint }); saveManager.markDirty(); }

    return { success: true };
  }

  /**
   * Purchase and apply a body kit or aero piece.
   *
   * @param {{ bodyKitId, name, price }} bodyKitDef
   * @param {string} carId
   * @returns {{ success: boolean, reason?: string }}
   */
  purchaseBodyKit(bodyKitDef, carId) {
    if (!this.canAfford(bodyKitDef.price)) {
      return {
        success: false,
        reason: `Need ${this._fmt(bodyKitDef.price)} CR for this body kit.`,
      };
    }

    this.deductCredits(bodyKitDef.price, 'bodykit_purchase', bodyKitDef.name);

    const car            = saveManager.inventory.getCarById(carId);
    const bodyKits       = [...(car?.bodyKits || []), bodyKitDef.bodyKitId];
    const _carB = saveManager.inventory.getCarById(carId);
    if (_carB) { Object.assign(_carB, { bodyKits }); saveManager.markDirty(); }

    window.dispatchEvent(new CustomEvent('economy:bodyKitPurchased', {
      detail: { carId, bodyKitId: bodyKitDef.bodyKitId },
    }));

    return { success: true };
  }

  // ─── Clothing Purchase ───────────────────────────────────────────────────

  /**
   * Purchase a clothing item.
   *
   * @param {{ itemId, name, price, slot }} itemDef
   * @returns {{ success: boolean, reason?: string }}
   */
  purchaseClothing(itemDef) {
    if (saveManager.inventory.ownsClothing(itemDef.itemId)) {
      return { success: false, reason: 'You already own this item.' };
    }
    if (!this.canAfford(itemDef.price)) {
      return {
        success: false,
        reason: `Need ${this._fmt(itemDef.price)} CR for this item.`,
      };
    }

    this.deductCredits(itemDef.price, 'clothing_purchase', itemDef.name);
    saveManager.inventory.addClothingItem(itemDef.itemId);

    window.dispatchEvent(new CustomEvent('economy:clothingPurchased', {
      detail: { itemId: itemDef.itemId, price: itemDef.price },
    }));

    return { success: true };
  }

  // ─── Race Economy ────────────────────────────────────────────────────────

  /**
   * Charge the race entry fee (championship / elite events).
   *
   * @param {string} raceId
   * @param {'standard'|'championship'|'elite'} feeType
   * @returns {{ success: boolean, fee: number, reason?: string }}
   */
  payRaceEntry(raceId, feeType = 'standard') {
    const fee = RACE_ENTRY_FEES[feeType] ?? 0;
    if (fee === 0) return { success: true, fee: 0 };

    if (!this.canAfford(fee)) {
      return {
        success: false,
        fee,
        reason: `Entry fee is ${this._fmt(fee)} CR — not enough credits.`,
      };
    }

    this.deductCredits(fee, 'race_entry_fee', `Entry: ${raceId} (${feeType})`);
    return { success: true, fee };
  }

  /**
   * Grant post-race credit payout.
   * Called by RaceManager after the results are finalised.
   *
   * @param {string}  raceId
   * @param {number}  position    1-based finishing position
   * @param {string}  carClass    'D' | 'C' | 'B' | 'A' | 'S1' | 'S2'
   * @param {string}  difficulty  'Casual' | 'Experienced' | 'Expert' | 'Unbeatable'
   * @param {boolean} [isClean]   +10% bonus for no rewind / no collision
   * @returns {{ basePayout: number, totalPayout: number }}
   */
  grantRacePayout(raceId, position, carClass, difficulty, isClean = false) {
    const table = RACE_PAYOUT_BY_CLASS[carClass] || RACE_PAYOUT_BY_CLASS['D'];
    const posKey = position <= 3 ? position : 'other';
    const base   = table[posKey] || table['other'];

    const diffMulti  = DIFFICULTY_PAYOUT_MULTIPLIER[difficulty] || 1.0;
    const cleanBonus = isClean ? 1.10 : 1.0;
    const total      = Math.round(base * diffMulti * cleanBonus);

    const label = `Race payout: ${raceId} — P${position} ${carClass}-class`;
    this.addCredits(total, 'race_finish', label);

    window.dispatchEvent(new CustomEvent('economy:racePayout', {
      detail: { raceId, position, carClass, difficulty, basePayout: base, totalPayout: total },
    }));

    return { basePayout: base, totalPayout: total };
  }

  /**
   * Win bonus on top of the standard payout (+500 XP is handled by ProgressionManager;
   * this grants any extra CR bonus defined for winning).
   * Currently +20% of the base payout, called by RaceManager only for P1.
   *
   * @param {string} raceId
   * @param {number} basePayout
   * @returns {number} Bonus CR awarded
   */
  grantWinBonus(raceId, basePayout) {
    const bonus = Math.round(basePayout * 0.20);
    this.addCredits(bonus, 'race_win_bonus', `Win bonus: ${raceId}`);
    return bonus;
  }

  // ─── World Reward Helpers ────────────────────────────────────────────────

  /**
   * Credit reward when the player drives into a Bonus Board.
   *
   * @param {string} boardId
   * @param {number} value     CR value of this board (500–2000)
   * @returns {{ success: boolean, alreadyCollected: boolean }}
   */
  collectBoard(boardId, value) {
    const fresh = saveManager.world.collectBoard(boardId);
    if (!fresh) return { success: false, alreadyCollected: true };

    this.addCredits(value, 'board_collect', `Board: ${boardId}`);

    window.dispatchEvent(new CustomEvent('economy:boardCollected', {
      detail: { boardId, value },
    }));

    return { success: true, alreadyCollected: false };
  }

  /**
   * Credit reward for discovering a new landmark.
   *
   * @param {string} landmarkId
   * @returns {{ success: boolean, alreadyCollected: boolean }}
   */
  collectLandmark(landmarkId) {
    const fresh = saveManager.world.discoverLandmark(landmarkId);
    if (!fresh) return { success: false, alreadyCollected: true };

    this.addCredits(LANDMARK_REWARD_CR, 'landmark_discover', `Landmark: ${landmarkId}`);

    window.dispatchEvent(new CustomEvent('economy:landmarkDiscovered', {
      detail: { landmarkId, value: LANDMARK_REWARD_CR },
    }));

    return { success: true, alreadyCollected: false };
  }

  // ─── Transaction History ─────────────────────────────────────────────────

  /**
   * Last N transactions — used by the Ledger tab in the Phone Menu.
   *
   * @param {number} [n=50]
   * @returns {Array<Object>}
   */
  getHistory(n = 50) {
    return this._history.slice(-n).reverse(); // newest first
  }

  /**
   * Grouped summary by category for the Stats panel.
   *
   * @returns {{ totalEarned: number, totalSpent: number, byReason: Object }}
   */
  getHistorySummary() {
    let totalEarned = 0;
    let totalSpent  = 0;
    const byReason  = {};

    for (const tx of this._history) {
      if (tx.delta > 0) totalEarned += tx.delta;
      else totalSpent += Math.abs(tx.delta);

      byReason[tx.reason] = (byReason[tx.reason] || 0) + tx.delta;
    }

    return { totalEarned, totalSpent, byReason };
  }

  // ─── Price Helpers for Shop UIs ─────────────────────────────────────────

  /**
   * Returns formatted "can afford" metadata for a list of items.
   * Used by shop UIs to bulk-check and grey-out items.
   *
   * @param {Array<{ id: string, price: number }>} items
   * @returns {Object}  { id → boolean }
   */
  getAffordabilityMap(items) {
    const balance = this.getBalance();
    const map     = {};
    for (const item of items) {
      map[item.id] = balance >= item.price;
    }
    return map;
  }

  /**
   * Sell value preview for any owned car (60% of purchase price).
   *
   * @param {number} purchasePrice
   * @returns {number}
   */
  getSellValue(purchasePrice) {
    return Math.floor(purchasePrice * CAR_SELL_RATE);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  _logTransaction(delta, reason, label, balanceAfter) {
    const entry = {
      ts:           Date.now(),
      delta,
      reason,
      label:        label || reason,
      category:     TX_CATEGORY[reason] || (delta > 0 ? 'earn' : 'spend'),
      balanceAfter,
    };

    this._history.push(entry);

    // Cap history length
    if (this._history.length > MAX_HISTORY_ENTRIES) {
      this._history.shift();
    }

    // Persist to SaveManager (best-effort — non-critical)
    try {
      saveManager.set('inventory', 'txHistory', this._history);
    } catch (_) {}
  }

  /**
   * Fires the credit-tick event that the HUD counter animation listens to.
   * For large amounts the UI staggers the count; for small ones it's instant.
   *
   * @param {number} delta
   * @param {'earn'|'spend'} direction
   */
  _fireCreditTick(delta, direction) {
    window.dispatchEvent(new CustomEvent('economy:creditTick', {
      detail: { delta, direction, balance: this.getBalance() },
    }));
  }

  _fmt(amount) {
    return amount.toLocaleString('en-US');
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

const economyManager = new EconomyManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EconomyManager, economyManager };
}
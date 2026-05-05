/**
 * js/economy/clothingShop.js
 * Horizon City — Clothing Boutique logic.
 *
 * Responsibilities:
 *   • Complete clothing item catalog (helmets, suits, tops, bottoms, shoes, gloves, accessories)
 *   • Purchase items (deducts credits via economy.js)
 *   • Wardrobe inventory per player (localStorage)
 *   • Outfit preset save/load (up to 10 presets)
 *   • Quick-change from phone menu
 *   • Active equipped-item tracking per slot
 *   • Wheelspin-exclusive item flags
 *   • Starter outfit grant on first launch
 */

import { spend, canAfford } from './Economy.js';

// ── Storage keys ───────────────────────────────────────────────────────────────
const KEY_WARDROBE      = 'hc_wardrobe';      // Set of owned item IDs
const KEY_EQUIPPED      = 'hc_equipped';      // { slot: itemId }
const KEY_OUTFITS       = 'hc_outfits';       // Array of outfit presets
const KEY_STARTER_DONE  = 'hc_starter_outfit';

const MAX_OUTFIT_PRESETS = 10;

// ── Clothing slots ─────────────────────────────────────────────────────────────
export const CLOTHING_SLOTS = [
  { id: 'helmet',     label: 'Helmet',      icon: '⛑️'  },
  { id: 'suit',       label: 'Suit',        icon: '🏎️' },
  { id: 'top',        label: 'Top',         icon: '👕'  },
  { id: 'bottom',     label: 'Bottom',      icon: '👖'  },
  { id: 'shoes',      label: 'Shoes',       icon: '👟'  },
  { id: 'gloves',     label: 'Gloves',      icon: '🧤'  },
  { id: 'accessory',  label: 'Accessory',   icon: '🕶️'  },
];

// Note: equipping a 'suit' automatically hides 'top' and 'bottom' slots.

// ── Clothing catalog ───────────────────────────────────────────────────────────
/**
 * Each item:
 *   id, slot, label, description, price (0 = starter / earned),
 *   colors: string[]  (named colorways available)
 *   style: string     (fashion category tag)
 *   rarity: 'common'|'rare'|'exclusive'
 *   source: 'shop'|'wheelspin'|'earned'|'starter'
 *   earnedVia?: string  (description of how to unlock if source !== 'shop')
 *   modelFile: string
 *   thumbnailFile: string
 */
export const CLOTHING_CATALOG = [

  // ── Helmets ──────────────────────────────────────────────────────────────────
  {
    id: 'helmet_open_face_classic', slot: 'helmet', style: 'classic',
    label: 'Open Face Classic Helmet',
    description: 'Retro bubble-visor open face helmet. The kind of lid rally legends wore in the 70s.',
    price: 12_000, rarity: 'common', source: 'shop',
    colors: ['Gloss White', 'Racing Red', 'Cobalt Blue', 'British Green', 'Matte Black'],
    modelFile: 'helmet_open_face_classic.glb', thumbnailFile: 'helmet_open_face_classic.jpg',
  },
  {
    id: 'helmet_full_face_race', slot: 'helmet', style: 'race',
    label: 'Full Face Racing Helmet',
    description: 'SA2020-rated full face helmet. Closed visor, FHR anchor points, and a clean profile.',
    price: 25_000, rarity: 'common', source: 'shop',
    colors: ['Gloss White', 'Matte Black', 'Horizon Silver', 'Night Blue', 'Crimson'],
    modelFile: 'helmet_full_face_race.glb', thumbnailFile: 'helmet_full_face_race.jpg',
  },
  {
    id: 'helmet_full_face_gt', slot: 'helmet', style: 'gt',
    label: 'GT Full Face Helmet',
    description: 'Sport GT-style lid with a wider visor aperture and vent channels across the crown.',
    price: 38_000, rarity: 'common', source: 'shop',
    colors: ['Gloss White', 'Carbon Weave', 'Stealth Black', 'Storm Grey', 'Solar Orange'],
    modelFile: 'helmet_full_face_gt.glb', thumbnailFile: 'helmet_full_face_gt.jpg',
  },
  {
    id: 'helmet_half_shell_moto', slot: 'helmet', style: 'moto',
    label: 'Half Shell Moto Helmet',
    description: 'Motorcycle-style half-shell with exposed face. Stripped back, rebellious look.',
    price: 10_000, rarity: 'common', source: 'shop',
    colors: ['Flat Black', 'Ivory', 'Café Racer Brown', 'Gunmetal'],
    modelFile: 'helmet_half_shell_moto.glb', thumbnailFile: 'helmet_half_shell_moto.jpg',
  },
  {
    id: 'helmet_balaclava', slot: 'helmet', style: 'minimal',
    label: 'Fireproof Balaclava',
    description: 'FIA-rated Nomex balaclava. Lightweight driver look. No shell — your face is the risk.',
    price: 5_000, rarity: 'common', source: 'shop',
    colors: ['White', 'Black', 'Dark Navy'],
    modelFile: 'helmet_balaclava.glb', thumbnailFile: 'helmet_balaclava.jpg',
  },
  {
    id: 'helmet_carbon_elite', slot: 'helmet', style: 'race',
    label: 'Carbon Fibre Elite Helmet',
    description: 'Hand-laid carbon shell with a titanium visor surround. The helmet you wear when you\'ve made it.',
    price: 50_000, rarity: 'rare', source: 'shop',
    colors: ['Carbon Black', 'Carbon Gold', 'Carbon Red'],
    modelFile: 'helmet_carbon_elite.glb', thumbnailFile: 'helmet_carbon_elite.jpg',
  },
  {
    id: 'helmet_festival_launch', slot: 'helmet', style: 'special',
    label: 'Horizon City Launch Helmet',
    description: 'Commemorative helmet issued to every driver at the opening of Horizon City Festival. Only given once.',
    price: 0, rarity: 'exclusive', source: 'starter',
    colors: ['Festival Teal'],
    modelFile: 'helmet_festival_launch.glb', thumbnailFile: 'helmet_festival_launch.jpg',
  },
  {
    id: 'helmet_viper_spin', slot: 'helmet', style: 'race',
    label: 'Viper Strike Helmet',
    description: 'A fierce angular visor and snake-scale texture paint. Wheelspin exclusive.',
    price: 0, rarity: 'exclusive', source: 'wheelspin',
    colors: ['Viper Green', 'Desert Tan'],
    modelFile: 'helmet_viper_spin.glb', thumbnailFile: 'helmet_viper_spin.jpg',
  },

  // ── Suits ─────────────────────────────────────────────────────────────────────
  {
    id: 'suit_race_entry', slot: 'suit', style: 'race',
    label: 'Entry Race Suit',
    description: 'Single-layer Nomex suit. The baseline for every serious competitor.',
    price: 15_000, rarity: 'common', source: 'shop',
    colors: ['White', 'Black', 'Racing Red', 'Horizon Blue'],
    modelFile: 'suit_race_entry.glb', thumbnailFile: 'suit_race_entry.jpg',
  },
  {
    id: 'suit_race_pro', slot: 'suit', style: 'race',
    label: 'Pro Race Suit',
    description: 'Multi-layer race suit with epaulettes and sponsor panel zones. Looks like the real thing.',
    price: 32_000, rarity: 'common', source: 'shop',
    colors: ['White/Black', 'White/Red', 'Black/Gold', 'Blue/White'],
    modelFile: 'suit_race_pro.glb', thumbnailFile: 'suit_race_pro.jpg',
  },
  {
    id: 'suit_rally_spec', slot: 'suit', style: 'rally',
    label: 'Rally Spec Suit',
    description: 'Built for the stages: robust Nomex with reinforced elbows and a baggier, more mobile cut.',
    price: 28_000, rarity: 'common', source: 'shop',
    colors: ['Stage Red', 'Ice White', 'Tarmac Blue', 'Moss Green'],
    modelFile: 'suit_rally_spec.glb', thumbnailFile: 'suit_rally_spec.jpg',
  },
  {
    id: 'suit_drift_jacket', slot: 'suit', style: 'drift',
    label: 'Drift Crew Jacket Suit',
    description: 'Street-culture meets race safety. Tailored jacket-suit with a matching trouser. Drift scene approved.',
    price: 22_000, rarity: 'common', source: 'shop',
    colors: ['Gloss Black', 'White', 'Navy', 'Acid Yellow'],
    modelFile: 'suit_drift_jacket.glb', thumbnailFile: 'suit_drift_jacket.jpg',
  },
  {
    id: 'suit_camo', slot: 'suit', style: 'novelty',
    label: 'Military Camo Race Suit',
    description: 'Full camo pattern suit. Practical? No. Intimidating? Absolutely.',
    price: 19_000, rarity: 'common', source: 'shop',
    colors: ['Desert Camo', 'Woodland Camo', 'Urban Grey Camo'],
    modelFile: 'suit_camo.glb', thumbnailFile: 'suit_camo.jpg',
  },
  {
    id: 'suit_national_flag', slot: 'suit', style: 'pride',
    label: 'National Pride Suit',
    description: 'A race suit patterned with your chosen national flag across the back and sleeves.',
    price: 24_000, rarity: 'common', source: 'shop',
    colors: ['UK', 'US', 'JP', 'DE', 'IT', 'ES', 'FR', 'BR', 'AU', 'MX'],
    modelFile: 'suit_national_flag.glb', thumbnailFile: 'suit_national_flag.jpg',
  },
  {
    id: 'suit_district_champion', slot: 'suit', style: 'special',
    label: 'District Champion Jacket',
    description: 'Awarded to drivers who win all races in a single district. The sign of a true local legend.',
    price: 0, rarity: 'exclusive', source: 'earned',
    earnedVia: 'Win all circuit races in any one district.',
    colors: ['Champion Gold'],
    modelFile: 'suit_district_champion.glb', thumbnailFile: 'suit_district_champion.jpg',
  },
  {
    id: 'suit_legend_driver', slot: 'suit', style: 'special',
    label: 'Legend Driver Suit',
    description: 'The ultimate prestige item. Only awarded to drivers who reach Player Level 100.',
    price: 0, rarity: 'exclusive', source: 'earned',
    earnedVia: 'Reach Player Level 100.',
    colors: ['Prestige Silver', 'Legend Black'],
    modelFile: 'suit_legend_driver.glb', thumbnailFile: 'suit_legend_driver.jpg',
  },
  {
    id: 'suit_chromatic_spin', slot: 'suit', style: 'special',
    label: 'Chromatic Shift Suit',
    description: 'A suit with a colour-shift fabric that shimmers through the spectrum. Wheelspin exclusive.',
    price: 0, rarity: 'exclusive', source: 'wheelspin',
    colors: ['Chromatic'],
    modelFile: 'suit_chromatic_spin.glb', thumbnailFile: 'suit_chromatic_spin.jpg',
  },

  // ── Tops ─────────────────────────────────────────────────────────────────────
  {
    id: 'top_racing_jacket', slot: 'top', style: 'race',
    label: 'Racing Jacket',
    description: 'Lightweight racing jacket in satin finish. Sponsor panel-ready and festival-appropriate.',
    price: 8_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'White', 'Navy', 'Red', 'Olive'],
    modelFile: 'top_racing_jacket.glb', thumbnailFile: 'top_racing_jacket.jpg',
  },
  {
    id: 'top_leather_jacket', slot: 'top', style: 'street',
    label: 'Leather Moto Jacket',
    description: 'Classic leather biker jacket. The uniform of the road warrior.',
    price: 12_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'Brown', 'Oxblood', 'White'],
    modelFile: 'top_leather_jacket.glb', thumbnailFile: 'top_leather_jacket.jpg',
  },
  {
    id: 'top_bomber_jacket', slot: 'top', style: 'street',
    label: 'Bomber Jacket',
    description: 'MA-1 style bomber in ripstop nylon. Laid-back style between events.',
    price: 9_000, rarity: 'common', source: 'shop',
    colors: ['Olive', 'Black', 'Sage', 'Tan', 'Orange'],
    modelFile: 'top_bomber_jacket.glb', thumbnailFile: 'top_bomber_jacket.jpg',
  },
  {
    id: 'top_hoodie', slot: 'top', style: 'casual',
    label: 'Festival Hoodie',
    description: 'Heavyweight pullover hoodie with a kangaroo pocket. Comfort above all else.',
    price: 6_000, rarity: 'common', source: 'shop',
    colors: ['Grey Marl', 'Black', 'Navy', 'Burgundy', 'Forest Green'],
    modelFile: 'top_hoodie.glb', thumbnailFile: 'top_hoodie.jpg',
  },
  {
    id: 'top_team_jersey', slot: 'top', style: 'sport',
    label: 'Racing Team Jersey',
    description: 'Moisture-wicking sport jersey. Breathable, quick-drying, and looks purpose-built.',
    price: 7_000, rarity: 'common', source: 'shop',
    colors: ['White/Blue', 'Black/Red', 'White/Green', 'Navy/Silver'],
    modelFile: 'top_team_jersey.glb', thumbnailFile: 'top_team_jersey.jpg',
  },
  {
    id: 'top_tank', slot: 'top', style: 'casual',
    label: 'Performance Tank Top',
    description: 'Keep cool between stages. Stretchy, minimal, and available in every colour imaginable.',
    price: 5_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'White', 'Heather Grey', 'Racing Blue', 'Lime'],
    modelFile: 'top_tank.glb', thumbnailFile: 'top_tank.jpg',
  },

  // ── Bottoms ───────────────────────────────────────────────────────────────────
  {
    id: 'bottom_race_trousers', slot: 'bottom', style: 'race',
    label: 'Race Trousers',
    description: 'Matching Nomex race trousers. Coordinates with the race suit family.',
    price: 9_000, rarity: 'common', source: 'shop',
    colors: ['White', 'Black', 'Racing Red', 'Horizon Blue'],
    modelFile: 'bottom_race_trousers.glb', thumbnailFile: 'bottom_race_trousers.jpg',
  },
  {
    id: 'bottom_jeans', slot: 'bottom', style: 'casual',
    label: 'Slim Fit Jeans',
    description: 'Stretch denim jeans. Because sometimes you just want to look normal.',
    price: 6_000, rarity: 'common', source: 'shop',
    colors: ['Indigo', 'Black', 'Light Wash', 'Charcoal'],
    modelFile: 'bottom_jeans.glb', thumbnailFile: 'bottom_jeans.jpg',
  },
  {
    id: 'bottom_cargo', slot: 'bottom', style: 'street',
    label: 'Cargo Pants',
    description: 'Utility cargo pants with multiple pockets. The ideal festival-goer lower half.',
    price: 7_000, rarity: 'common', source: 'shop',
    colors: ['Khaki', 'Black', 'Olive', 'Sand'],
    modelFile: 'bottom_cargo.glb', thumbnailFile: 'bottom_cargo.jpg',
  },
  {
    id: 'bottom_shorts', slot: 'bottom', style: 'casual',
    label: 'Sport Shorts',
    description: 'Lightweight board shorts with a drawstring. Warm weather driving attire.',
    price: 4_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'Navy', 'Tropical', 'Heather Grey'],
    modelFile: 'bottom_shorts.glb', thumbnailFile: 'bottom_shorts.jpg',
  },
  {
    id: 'bottom_leggings', slot: 'bottom', style: 'sport',
    label: 'Performance Leggings',
    description: 'Full-length compression leggings. Practical and increasingly fashionable on the festival scene.',
    price: 7_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'Carbon', 'Electric Blue', 'Deep Red'],
    modelFile: 'bottom_leggings.glb', thumbnailFile: 'bottom_leggings.jpg',
  },

  // ── Shoes ─────────────────────────────────────────────────────────────────────
  {
    id: 'shoes_race_boot_ankle', slot: 'shoes', style: 'race',
    label: 'Race Ankle Boots',
    description: 'Low-cut FIA race boots with a thin sole for maximum pedal feel.',
    price: 8_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'White', 'Red', 'Blue'],
    modelFile: 'shoes_race_boot_ankle.glb', thumbnailFile: 'shoes_race_boot_ankle.jpg',
  },
  {
    id: 'shoes_race_boot_high', slot: 'shoes', style: 'race',
    label: 'High-Cut Race Boots',
    description: 'Ankle-supporting race boots with a fireproof lining. Old-school rally driver look.',
    price: 14_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'White', 'Rally Blue'],
    modelFile: 'shoes_race_boot_high.glb', thumbnailFile: 'shoes_race_boot_high.jpg',
  },
  {
    id: 'shoes_sneaker_runner', slot: 'shoes', style: 'casual',
    label: 'Running Sneakers',
    description: 'Technical running shoe silhouette. Comfortable, fast, and looks right at home at a festival.',
    price: 6_000, rarity: 'common', source: 'shop',
    colors: ['White/Grey', 'Black/Red', 'Blue/White', 'Volt/Black'],
    modelFile: 'shoes_sneaker_runner.glb', thumbnailFile: 'shoes_sneaker_runner.jpg',
  },
  {
    id: 'shoes_sneaker_high', slot: 'shoes', style: 'street',
    label: 'High-Top Sneakers',
    description: 'Classic canvas high-tops. Timeless silhouette that goes with practically anything.',
    price: 7_000, rarity: 'common', source: 'shop',
    colors: ['White', 'Black', 'Red', 'Navy', 'Forest'],
    modelFile: 'shoes_sneaker_high.glb', thumbnailFile: 'shoes_sneaker_high.jpg',
  },
  {
    id: 'shoes_boot_work', slot: 'shoes', style: 'street',
    label: 'Work Boots',
    description: 'Sturdy leather work boots. Mechanic-chic. Looks great with cargo pants.',
    price: 9_000, rarity: 'common', source: 'shop',
    colors: ['Tan', 'Black', 'Oxblood'],
    modelFile: 'shoes_boot_work.glb', thumbnailFile: 'shoes_boot_work.jpg',
  },
  {
    id: 'shoes_loafer', slot: 'shoes', style: 'smart',
    label: 'Driving Loafers',
    description: 'The choice of the gentleman racer. Moccasin sole, zero-stack heel for natural pedal position.',
    price: 10_000, rarity: 'common', source: 'shop',
    colors: ['Tan Leather', 'Black Leather', 'Navy Suede'],
    modelFile: 'shoes_loafer.glb', thumbnailFile: 'shoes_loafer.jpg',
  },
  {
    id: 'shoes_rare_spin', slot: 'shoes', style: 'special',
    label: 'Chromeline Sneakers',
    description: 'Limited chrome-accent sneakers with metallic flash panels. Wheelspin exclusive.',
    price: 0, rarity: 'exclusive', source: 'wheelspin',
    colors: ['Chrome/Black', 'Chrome/White'],
    modelFile: 'shoes_rare_spin.glb', thumbnailFile: 'shoes_rare_spin.jpg',
  },

  // ── Gloves ────────────────────────────────────────────────────────────────────
  {
    id: 'gloves_none', slot: 'gloves', style: 'minimal',
    label: 'No Gloves',
    description: 'Bare hands. Purist.',
    price: 0, rarity: 'common', source: 'starter',
    colors: ['—'],
    modelFile: '', thumbnailFile: '',
  },
  {
    id: 'gloves_race_full', slot: 'gloves', style: 'race',
    label: 'Full Racing Gloves',
    description: 'FIA-rated Nomex racing gloves with a thin perforated palm for steering feel.',
    price: 4_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'White', 'Red', 'Blue'],
    modelFile: 'gloves_race_full.glb', thumbnailFile: 'gloves_race_full.jpg',
  },
  {
    id: 'gloves_fingerless', slot: 'gloves', style: 'street',
    label: 'Fingerless Gloves',
    description: 'Half-cut fingerless gloves. Style without sacrificing smartphone access.',
    price: 3_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'Brown Leather', 'Grey'],
    modelFile: 'gloves_fingerless.glb', thumbnailFile: 'gloves_fingerless.jpg',
  },
  {
    id: 'gloves_gauntlet', slot: 'gloves', style: 'moto',
    label: 'Moto Gauntlet Gloves',
    description: 'Full-wrist gauntlet motorcycle gloves. Knuckle armour and a reinforced palm.',
    price: 8_000, rarity: 'common', source: 'shop',
    colors: ['Black', 'Brown', 'Hi-Viz Yellow'],
    modelFile: 'gloves_gauntlet.glb', thumbnailFile: 'gloves_gauntlet.jpg',
  },
  {
    id: 'gloves_winter', slot: 'gloves', style: 'casual',
    label: 'Insulated Driving Gloves',
    description: 'Lined leather gloves for cold-weather events. Grip-textured palm.',
    price: 5_000, rarity: 'common', source: 'shop',
    colors: ['Camel', 'Black', 'Dark Green'],
    modelFile: 'gloves_winter.glb', thumbnailFile: 'gloves_winter.jpg',
  },

  // ── Accessories ───────────────────────────────────────────────────────────────
  {
    id: 'acc_sunglasses_aviator', slot: 'accessory', style: 'classic',
    label: 'Aviator Sunglasses',
    description: 'Timeless teardrop metal-frame aviators. Top Gun energy.',
    price: 2_500, rarity: 'common', source: 'shop',
    colors: ['Gold/Green', 'Silver/Grey', 'Black/Black'],
    modelFile: 'acc_sunglasses_aviator.glb', thumbnailFile: 'acc_sunglasses_aviator.jpg',
  },
  {
    id: 'acc_sunglasses_sport', slot: 'accessory', style: 'sport',
    label: 'Sport Wrap Sunglasses',
    description: 'High-wrap sport shield with polarised lenses. Zero wind intrusion at speed.',
    price: 4_000, rarity: 'common', source: 'shop',
    colors: ['Black/Smoke', 'White/Blue', 'Red/Red Mirror'],
    modelFile: 'acc_sunglasses_sport.glb', thumbnailFile: 'acc_sunglasses_sport.jpg',
  },
  {
    id: 'acc_goggles_rally', slot: 'accessory', style: 'rally',
    label: 'Rally Stage Goggles',
    description: 'Classic rally goggles with a wide lens and elastic strap. Retro icon.',
    price: 6_000, rarity: 'common', source: 'shop',
    colors: ['Brown/Yellow', 'Black/Clear', 'White/Red'],
    modelFile: 'acc_goggles_rally.glb', thumbnailFile: 'acc_goggles_rally.jpg',
  },
  {
    id: 'acc_watch_sport', slot: 'accessory', style: 'smart',
    label: 'Sport Chronograph Watch',
    description: 'Visible in cockpit cam. Rugged sport chrono with a tachymeter bezel. Racing heritage.',
    price: 8_000, rarity: 'common', source: 'shop',
    colors: ['Black Dial', 'White Dial', 'Blue Dial'],
    modelFile: 'acc_watch_sport.glb', thumbnailFile: 'acc_watch_sport.jpg',
  },
  {
    id: 'acc_earrings', slot: 'accessory', style: 'casual',
    label: 'Stud Earrings',
    description: 'Subtle stud earrings — the finishing touch for a polished look off the circuit.',
    price: 1_500, rarity: 'common', source: 'shop',
    colors: ['Gold', 'Silver', 'Black', 'Diamond'],
    modelFile: 'acc_earrings.glb', thumbnailFile: 'acc_earrings.jpg',
  },
  {
    id: 'acc_necklace', slot: 'accessory', style: 'casual',
    label: 'Chain Necklace',
    description: 'Simple chain necklace. Visible above race suit collars for that driver style.',
    price: 2_000, rarity: 'common', source: 'shop',
    colors: ['Gold', 'Silver', 'Rose Gold'],
    modelFile: 'acc_necklace.glb', thumbnailFile: 'acc_necklace.jpg',
  },
  {
    id: 'acc_visor_tint', slot: 'accessory', style: 'race',
    label: 'Tinted Visor Clip',
    description: 'Clip-on tinted visor for helmets with open visor designs. Five tint levels.',
    price: 3_000, rarity: 'common', source: 'shop',
    colors: ['Light Smoke', 'Dark Smoke', 'Gold Mirror', 'Blue Mirror', 'Red Mirror'],
    modelFile: 'acc_visor_tint.glb', thumbnailFile: 'acc_visor_tint.jpg',
  },
];

// ── Starter outfit ─────────────────────────────────────────────────────────────
export const STARTER_OUTFIT = {
  helmet:    'helmet_festival_launch',
  suit:      null,
  top:       'top_racing_jacket',
  bottom:    'bottom_jeans',
  shoes:     'shoes_sneaker_runner',
  gloves:    'gloves_none',
  accessory: null,
};

export function grantStarterOutfit() {
  if (localStorage.getItem(KEY_STARTER_DONE)) return false;

  const wardrobe = _loadWardrobe();
  Object.values(STARTER_OUTFIT).forEach(id => { if (id) wardrobe.add(id); });
  _saveWardrobe(wardrobe);

  // Equip starter outfit
  localStorage.setItem(KEY_EQUIPPED, JSON.stringify(STARTER_OUTFIT));
  localStorage.setItem(KEY_STARTER_DONE, '1');
  return true;
}

// ── Wardrobe helpers ───────────────────────────────────────────────────────────

function _loadWardrobe() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY_WARDROBE) || '[]')); }
  catch { return new Set(); }
}

function _saveWardrobe(set) {
  localStorage.setItem(KEY_WARDROBE, JSON.stringify([...set]));
}

export function getWardrobe() {
  const owned = _loadWardrobe();
  return CLOTHING_CATALOG
    .filter(item => owned.has(item.id))
    .map(item => ({ ...item, isEquipped: isEquipped(item.id) }));
}

export function getWardrobeBySlot(slotId) {
  return getWardrobe().filter(item => item.slot === slotId);
}

export function ownsItem(itemId) {
  return _loadWardrobe().has(itemId);
}

// ── Browse (shop view, excludes owned) ────────────────────────────────────────

/**
 * @param {object} [filters]
 * @param {string}  [filters.slot]    'helmet'|'suit'|'top'|'bottom'|'shoes'|'gloves'|'accessory'
 * @param {string}  [filters.style]   fashion style tag
 * @param {string}  [filters.rarity]  'common'|'rare'|'exclusive'
 * @param {number}  [filters.maxPrice]
 * @param {boolean} [filters.excludeOwned]  default true
 * @param {string}  [filters.search]
 */
export function browseBoutique(filters = {}) {
  const {
    slot, style, rarity, maxPrice, search,
    excludeOwned = true,
  } = filters;

  const owned   = _loadWardrobe();
  const balance = parseInt(localStorage.getItem('hc_credits') || '0', 10);

  let list = CLOTHING_CATALOG.filter(i => i.source === 'shop' || i.source === 'starter');

  if (excludeOwned) list = list.filter(i => !owned.has(i.id));
  if (slot)         list = list.filter(i => i.slot === slot);
  if (style)        list = list.filter(i => i.style === style);
  if (rarity)       list = list.filter(i => i.rarity === rarity);
  if (maxPrice != null) list = list.filter(i => i.price <= maxPrice);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(i => i.label.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  }

  return list.map(item => ({
    ...item,
    owned:      owned.has(item.id),
    affordable: balance >= item.price,
  }));
}

// ── Purchase ───────────────────────────────────────────────────────────────────

export function buyClothingItem(itemId) {
  const item = CLOTHING_CATALOG.find(i => i.id === itemId);

  if (!item)            return { success: false, reason: 'ITEM_NOT_FOUND' };
  if (ownsItem(itemId)) return { success: false, reason: 'ALREADY_OWNED' };
  if (item.source === 'earned' || item.source === 'wheelspin') {
    return { success: false, reason: 'NOT_FOR_SALE' };
  }
  if (item.price > 0 && !canAfford(item.price)) {
    return { success: false, reason: 'INSUFFICIENT_CREDITS' };
  }

  if (item.price > 0) {
    const result = spend(item.price, 'CLOTHING_PURCHASE', `Bought: ${item.label}`);
    if (!result.success) return { success: false, reason: 'SPEND_FAILED' };
  }

  const wardrobe = _loadWardrobe();
  wardrobe.add(itemId);
  _saveWardrobe(wardrobe);

  return { success: true, item };
}

/** Grant a wheelspin or earned clothing item (no credit cost, bypasses shop check). */
export function grantClothingItem(itemId) {
  const item = CLOTHING_CATALOG.find(i => i.id === itemId);
  if (!item) return false;
  const wardrobe = _loadWardrobe();
  wardrobe.add(itemId);
  _saveWardrobe(wardrobe);
  return true;
}

// ── Equip / unequip ────────────────────────────────────────────────────────────

function _loadEquipped() {
  try { return JSON.parse(localStorage.getItem(KEY_EQUIPPED) || '{}'); }
  catch { return {}; }
}

function _saveEquipped(obj) {
  localStorage.setItem(KEY_EQUIPPED, JSON.stringify(obj));
}

export function getEquippedOutfit() {
  return _loadEquipped();
}

export function isEquipped(itemId) {
  const equipped = _loadEquipped();
  return Object.values(equipped).includes(itemId);
}

/**
 * Equip an item to its appropriate slot.
 * Must be owned. Pass null to clear a slot.
 */
export function equipItem(itemId) {
  if (itemId !== null && !ownsItem(itemId)) {
    return { success: false, reason: 'NOT_OWNED' };
  }
  if (itemId === null) return { success: false, reason: 'USE_UNEQUIP_SLOT' };

  const item     = CLOTHING_CATALOG.find(i => i.id === itemId);
  if (!item) return { success: false, reason: 'ITEM_NOT_FOUND' };

  const equipped = _loadEquipped();
  equipped[item.slot] = itemId;

  // Equipping a suit unequips top & bottom
  if (item.slot === 'suit') {
    equipped.top    = null;
    equipped.bottom = null;
  }
  // Equipping a top/bottom removes suit
  if (item.slot === 'top' || item.slot === 'bottom') {
    equipped.suit = null;
  }

  _saveEquipped(equipped);
  return { success: true, slot: item.slot };
}

export function unequipSlot(slotId) {
  const equipped = _loadEquipped();
  equipped[slotId] = null;
  _saveEquipped(equipped);
}

// ── Outfit presets ─────────────────────────────────────────────────────────────

function _loadOutfits() {
  try { return JSON.parse(localStorage.getItem(KEY_OUTFITS) || '[]'); }
  catch { return []; }
}

function _saveOutfits(arr) {
  localStorage.setItem(KEY_OUTFITS, JSON.stringify(arr));
}

export function getOutfitPresets() {
  return _loadOutfits();
}

export function saveOutfitPreset(name) {
  const outfits = _loadOutfits();
  if (outfits.length >= MAX_OUTFIT_PRESETS) {
    return { success: false, reason: 'MAX_PRESETS_REACHED' };
  }

  const preset = {
    id:        `outfit_${Date.now()}`,
    name:      name.trim().slice(0, 24),
    createdAt: Date.now(),
    slots:     _loadEquipped(),
  };

  outfits.push(preset);
  _saveOutfits(outfits);
  return { success: true, preset };
}

export function loadOutfitPreset(presetId) {
  const preset = _loadOutfits().find(o => o.id === presetId);
  if (!preset) return { success: false, reason: 'NOT_FOUND' };

  // Only equip items the player still owns
  const wardrobe = _loadWardrobe();
  const safeSlots = {};
  for (const [slot, itemId] of Object.entries(preset.slots)) {
    safeSlots[slot] = (itemId && wardrobe.has(itemId)) ? itemId : null;
  }
  _saveEquipped(safeSlots);
  return { success: true, preset };
}

export function deleteOutfitPreset(presetId) {
  const outfits = _loadOutfits().filter(o => o.id !== presetId);
  _saveOutfits(outfits);
}

export function renameOutfitPreset(presetId, newName) {
  const outfits = _loadOutfits();
  const p = outfits.find(o => o.id === presetId);
  if (p) { p.name = newName.trim().slice(0, 24); _saveOutfits(outfits); }
}

export function randomOutfit() {
  const wardrobe = _loadWardrobe();
  const equipped = {};
  const hasSuit  = Math.random() > 0.5;

  if (hasSuit) {
    const suits = CLOTHING_CATALOG.filter(i => i.slot === 'suit' && wardrobe.has(i.id));
    if (suits.length) equipped.suit = suits[Math.floor(Math.random() * suits.length)].id;
  } else {
    ['top','bottom'].forEach(slot => {
      const items = CLOTHING_CATALOG.filter(i => i.slot === slot && wardrobe.has(i.id));
      if (items.length) equipped[slot] = items[Math.floor(Math.random() * items.length)].id;
    });
  }

  ['helmet','shoes','gloves','accessory'].forEach(slot => {
    const items = CLOTHING_CATALOG.filter(i => i.slot === slot && wardrobe.has(i.id));
    if (items.length) equipped[slot] = items[Math.floor(Math.random() * items.length)].id;
  });

  _saveEquipped(equipped);
  return equipped;
}

// ── Boutique location ──────────────────────────────────────────────────────────

export const BOUTIQUE_LOCATION = {
  id:          'downtown_boutique',
  label:       'Clothing Boutique',
  district:    'Downtown Core',
  description: 'A fashion-forward boutique with mannequins in the window, colourful murals on the walls, and a full range of apparel for every style of driver in Horizon City.',
};

// ── Reset ──────────────────────────────────────────────────────────────────────

export function resetClothingShop() {
  [KEY_WARDROBE, KEY_EQUIPPED, KEY_OUTFITS, KEY_STARTER_DONE].forEach(k =>
    localStorage.removeItem(k)
  );
}

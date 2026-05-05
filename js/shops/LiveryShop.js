/**
 * js/economy/liveryShop.js
 * Horizon City — Livery & Paint Shop.
 *
 * Responsibilities:
 *   • Paint zone management (primary, secondary, tertiary, caliper, interior)
 *   • Paint types: Solid, Metallic, Matte, Satin, Carbon, Chrome, Colour-Shift
 *   • Pre-made livery catalog (20 free + 30 premium + earned)
 *   • Custom vinyl placement data (Phase 2 stubs)
 *   • Window tint selection
 *   • Wide body kit / aero piece pricing
 *   • Save / load paint configs per car (localStorage)
 *   • Community livery import / export via share code
 */

import { spend, canAfford } from './Economy.js';
import { getCarById }       from '../car/carData.js';

// ── Storage key helpers ────────────────────────────────────────────────────────
const _paintKey   = carId => `hc_paint_${carId}`;
const _liveryKey  = carId => `hc_livery_${carId}`;
const KEY_OWNED_LIVERIES = 'hc_owned_liveries';

// ── Paint types ────────────────────────────────────────────────────────────────
export const PAINT_TYPES = [
  { id: 'solid',       label: 'Solid',        description: 'Classic gloss finish. Clean, timeless, zero cost.',         price: 0       },
  { id: 'metallic',    label: 'Metallic',      description: 'Metallic flake adds depth and catches light in motion.',    price: 0       },
  { id: 'matte',       label: 'Matte',         description: 'Non-reflective flat finish. Understated and aggressive.',   price: 5_000   },
  { id: 'satin',       label: 'Satin',         description: 'Between gloss and matte — subtle sheen without flash.',     price: 5_000   },
  { id: 'carbon',      label: 'Carbon Weave',  description: 'Dark carbon fibre texture across the painted zone.',        price: 10_000  },
  { id: 'chrome',      label: 'Chrome',        description: 'Full mirror chrome finish — reflects the entire city.',     price: 30_000  },
  { id: 'colorshift',  label: 'Colour-Shift',  description: 'Chameleon paint shifts hue with viewing angle.',            price: 25_000  },
];

// ── Paint zones ────────────────────────────────────────────────────────────────
export const PAINT_ZONES = [
  { id: 'primary',   label: 'Primary Body',    description: 'Main body panels — doors, fenders, quarters.' },
  { id: 'secondary', label: 'Secondary',        description: 'Roof, hood, and spoiler / wing.' },
  { id: 'tertiary',  label: 'Trim & Details',   description: 'Mirrors, door handles, side skirts, trim strips.' },
  { id: 'caliper',   label: 'Brake Calipers',   description: 'Visible calipers behind the wheel.' },
  { id: 'interior',  label: 'Interior',         description: 'Seat bolsters and dashboard accent (visible through windows).' },
];

// ── Default paint config (applied to all new cars) ────────────────────────────
export const DEFAULT_PAINT = {
  primary:   { type: 'solid',    color: '#CC2222', finish: 'gloss' },
  secondary: { type: 'solid',    color: '#111111', finish: 'gloss' },
  tertiary:  { type: 'solid',    color: '#222222', finish: 'gloss' },
  caliper:   { type: 'solid',    color: '#CC2222', finish: 'gloss' },
  interior:  { type: 'solid',    color: '#1A1A1A', finish: 'gloss' },
  windowTint: 0,   // 0 = clear → 4 = mirror
};

export const WINDOW_TINT_LEVELS = [
  { level: 0, label: 'Clear',     opacity: 0.05  },
  { level: 1, label: 'Light',     opacity: 0.20  },
  { level: 2, label: 'Dark',      opacity: 0.45  },
  { level: 3, label: 'Very Dark', opacity: 0.70  },
  { level: 4, label: 'Mirror',    opacity: 0.90  },
];

// ── Horizon preset colours (themed to city districts) ─────────────────────────
export const HORIZON_COLORS = [
  // Downtown Core
  { label: 'Neon Midnight',    hex: '#0C1A3A' },
  { label: 'Gold Rush',        hex: '#F0C040' },
  { label: 'Chrome City',      hex: '#C8D0D8' },
  // Harbor District
  { label: 'Deep Harbour',     hex: '#083050' },
  { label: 'Seafoam',          hex: '#40C8B0' },
  { label: 'Rust Dock',        hex: '#8C3020' },
  // Industrial Zone
  { label: 'Factory Grey',     hex: '#484848' },
  { label: 'Warning Orange',   hex: '#E86010' },
  { label: 'Acid Yellow',      hex: '#D4E000' },
  // Racing District
  { label: 'Racing Red',       hex: '#CC1818' },
  { label: 'Chequered White',  hex: '#F8F8F8' },
  { label: 'Podium Black',     hex: '#080808' },
  // Hillside Lookout
  { label: 'Forest Dark',      hex: '#1A3820' },
  { label: 'Sunset Orange',    hex: '#E06020' },
  { label: 'Alpine Blue',      hex: '#2040A0' },
  // Suburbs
  { label: 'Lawn Green',       hex: '#38A030' },
  { label: 'Driveway Grey',    hex: '#909098' },
  { label: 'Brick Red',        hex: '#8C3C28' },
  // Festival
  { label: 'Festival Teal',    hex: '#00C8C0' },
  { label: 'Stage Pink',       hex: '#E040A0' },
];

// ── Livery catalog ─────────────────────────────────────────────────────────────
/**
 * Each livery:
 *   id, label, description, price, source ('free'|'premium'|'earned'),
 *   earnedVia?, thumbnailFile, previewLayers: []
 *   (previewLayers is a stub for the vinyl system — array of layer descriptors)
 */
export const LIVERY_CATALOG = [

  // ── Free liveries (20) ────────────────────────────────────────────────────

  {
    id: 'lv_solid_white', label: 'Clean White',
    description: 'Simple gloss white full body. A blank canvas.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_solid_white.jpg', previewLayers: [],
  },
  {
    id: 'lv_solid_black', label: 'Stealth Black',
    description: 'Deep gloss black across all zones.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_solid_black.jpg', previewLayers: [],
  },
  {
    id: 'lv_two_tone_classic', label: 'Classic Two-Tone',
    description: 'Contrasting roof and lower body split — a retro GT racing look.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_two_tone_classic.jpg', previewLayers: [],
  },
  {
    id: 'lv_racing_stripe', label: 'Racing Stripes',
    description: 'Twin centre stripes over a white base. Simple and iconic.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_racing_stripe.jpg', previewLayers: [],
  },
  {
    id: 'lv_horizon_teal', label: 'Horizon Teal',
    description: 'The official Horizon City festival teal with a logo side graphic.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_horizon_teal.jpg', previewLayers: [],
  },
  {
    id: 'lv_sunset_fade', label: 'Sunset Fade',
    description: 'Orange-to-pink gradient fade from nose to tail. Warm and vibrant.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_sunset_fade.jpg', previewLayers: [],
  },
  {
    id: 'lv_carbon_sport', label: 'Carbon Sport',
    description: 'Carbon weave primary with colour secondary — a factory GT look.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_carbon_sport.jpg', previewLayers: [],
  },
  {
    id: 'lv_rally_white', label: 'Rally Stage White',
    description: 'Stage white base with number roundels and sponsor strips.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_rally_white.jpg', previewLayers: [],
  },
  {
    id: 'lv_night_shift', label: 'Night Shift',
    description: 'Deep navy with midnight blue accents. Built for city night runs.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_night_shift.jpg', previewLayers: [],
  },
  {
    id: 'lv_racing_red', label: 'Race Red Full',
    description: 'Saturated racing red with white contrast details.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_racing_red.jpg', previewLayers: [],
  },
  {
    id: 'lv_cobalt_silver', label: 'Cobalt & Silver',
    description: 'Cobalt blue body with silver bonnet and roof divider.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_cobalt_silver.jpg', previewLayers: [],
  },
  {
    id: 'lv_army_camo', label: 'Army Camo',
    description: 'Multi-tone military camouflage across the full body.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_army_camo.jpg', previewLayers: [],
  },
  {
    id: 'lv_acid_green', label: 'Acid Green',
    description: 'Aggressive lime-acid green. High visibility, zero subtlety.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_acid_green.jpg', previewLayers: [],
  },
  {
    id: 'lv_steel_grey', label: 'Steel Grey',
    description: 'Industrial satin steel grey. Factory floor aesthetic.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_steel_grey.jpg', previewLayers: [],
  },
  {
    id: 'lv_drift_crew', label: 'Drift Crew Black',
    description: 'Matte black with orange number plate box and crew logos.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_drift_crew.jpg', previewLayers: [],
  },
  {
    id: 'lv_national_uk', label: 'Union Jack',
    description: 'UK flag livery — roof graphic and bonnet pattern.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_national_uk.jpg', previewLayers: [],
  },
  {
    id: 'lv_national_jp', label: 'Rising Sun',
    description: 'Japanese rising sun motif on white. A motorsport classic.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_national_jp.jpg', previewLayers: [],
  },
  {
    id: 'lv_vintage_racer', label: 'Vintage Racer',
    description: 'Classic vintage racing livery — cream and British Racing Green.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_vintage_racer.jpg', previewLayers: [],
  },
  {
    id: 'lv_chrome_basic', label: 'Chrome Mirror',
    description: 'Full mirror chrome across all panels. Blinding.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_chrome_basic.jpg', previewLayers: [],
  },
  {
    id: 'lv_wood_grain', label: 'Wood Grain Estate',
    description: 'Classic American wagon wood-side trim printed across the doors. Novelty.',
    price: 0, source: 'free',
    thumbnailFile: 'lv_wood_grain.jpg', previewLayers: [],
  },

  // ── Premium liveries (30) ────────────────────────────────────────────────

  {
    id: 'lv_holographic', label: 'Holographic Spectrum',
    description: 'Full-body holographic foil that cycles through the colour spectrum with movement.',
    price: 50_000, source: 'premium',
    thumbnailFile: 'lv_holographic.jpg', previewLayers: [],
  },
  {
    id: 'lv_dragon_fire', label: 'Dragon Fire',
    description: 'Sculpted flame graphics that wrap from the front wheels and intensify toward the tail.',
    price: 20_000, source: 'premium',
    thumbnailFile: 'lv_dragon_fire.jpg', previewLayers: [],
  },
  {
    id: 'lv_circuit_map', label: 'City Circuit Map',
    description: 'Horizon City\'s racing layout etched as a line graphic across a matte black base.',
    price: 25_000, source: 'premium',
    thumbnailFile: 'lv_circuit_map.jpg', previewLayers: [],
  },
  {
    id: 'lv_galaxy', label: 'Deep Space',
    description: 'A photorealistic nebula and star field wrapped across the full body. Breathtaking.',
    price: 35_000, source: 'premium',
    thumbnailFile: 'lv_galaxy.jpg', previewLayers: [],
  },
  {
    id: 'lv_neon_grid', label: 'Neon Grid',
    description: 'Retrowave cyan-on-black grid perspective lines with sunset glow. 80s dream.',
    price: 30_000, source: 'premium',
    thumbnailFile: 'lv_neon_grid.jpg', previewLayers: [],
  },
  {
    id: 'lv_watercolour', label: 'Watercolour Splash',
    description: 'Abstract watercolour splashes on a white base. Artistic and unexpected.',
    price: 22_000, source: 'premium',
    thumbnailFile: 'lv_watercolour.jpg', previewLayers: [],
  },
  {
    id: 'lv_urban_tiger', label: 'Urban Tiger',
    description: 'Tiger stripe camo in street art style across an electric orange base.',
    price: 18_000, source: 'premium',
    thumbnailFile: 'lv_urban_tiger.jpg', previewLayers: [],
  },
  {
    id: 'lv_sponsor_mock', label: 'Factory Sponsor',
    description: 'A convincing-looking GT3-spec sponsor livery with fictional brand logos.',
    price: 15_000, source: 'premium',
    thumbnailFile: 'lv_sponsor_mock.jpg', previewLayers: [],
  },
  {
    id: 'lv_chrome_rainbow', label: 'Rainbow Chrome',
    description: 'Chrome base with a full spectral colour-shift iridescence overlay.',
    price: 45_000, source: 'premium',
    thumbnailFile: 'lv_chrome_rainbow.jpg', previewLayers: [],
  },
  {
    id: 'lv_marble', label: 'White Marble',
    description: 'Photorealistic white marble veining across every panel. Objectively impractical.',
    price: 28_000, source: 'premium',
    thumbnailFile: 'lv_marble.jpg', previewLayers: [],
  },
  {
    id: 'lv_graffiti_walls', label: 'City Graffiti',
    description: 'Street art style graffiti murals covering the lower third of the body.',
    price: 24_000, source: 'premium',
    thumbnailFile: 'lv_graffiti_walls.jpg', previewLayers: [],
  },
  {
    id: 'lv_chrome_split', label: 'Chrome Split',
    description: 'Mirror chrome top half contrasting with matte black lower body. High contrast.',
    price: 32_000, source: 'premium',
    thumbnailFile: 'lv_chrome_split.jpg', previewLayers: [],
  },
  {
    id: 'lv_digital_camo', label: 'Digital Camo',
    description: 'Pixel-perfect digital camouflage in four-colour grey scale.',
    price: 16_000, source: 'premium',
    thumbnailFile: 'lv_digital_camo.jpg', previewLayers: [],
  },
  {
    id: 'lv_tropical', label: 'Tropical Bloom',
    description: 'Vibrant tropical flowers and foliage on a sun-yellow base. Festival energy.',
    price: 20_000, source: 'premium',
    thumbnailFile: 'lv_tropical.jpg', previewLayers: [],
  },
  {
    id: 'lv_circuit_sparks', label: 'Circuit Sparks',
    description: 'Illustrated spark trail lines that follow the body contours like a speed graphic.',
    price: 22_000, source: 'premium',
    thumbnailFile: 'lv_circuit_sparks.jpg', previewLayers: [],
  },
  {
    id: 'lv_glitch', label: 'Glitch Art',
    description: 'Digital glitch art pattern — displaced pixels and scan lines across a solid base.',
    price: 26_000, source: 'premium',
    thumbnailFile: 'lv_glitch.jpg', previewLayers: [],
  },
  {
    id: 'lv_le_mans_tribute', label: 'Le Mans Tribute',
    description: 'A historically-accurate recreation of a classic 1970s Le Mans long-tail livery.',
    price: 38_000, source: 'premium',
    thumbnailFile: 'lv_le_mans_tribute.jpg', previewLayers: [],
  },
  {
    id: 'lv_stained_glass', label: 'Stained Glass',
    description: 'Cathedral-style stained glass panels across the full body. Surprisingly tasteful.',
    price: 30_000, source: 'premium',
    thumbnailFile: 'lv_stained_glass.jpg', previewLayers: [],
  },
  {
    id: 'lv_checker_fade', label: 'Checker Fade',
    description: 'Chequered flag pattern that fades from the front to a clean colour at the rear.',
    price: 18_000, source: 'premium',
    thumbnailFile: 'lv_checker_fade.jpg', previewLayers: [],
  },
  {
    id: 'lv_gold_chrome', label: 'Gold Chrome Full',
    description: 'Head-to-toe mirror gold chrome. Reserved for people who have won too much.',
    price: 50_000, source: 'premium',
    thumbnailFile: 'lv_gold_chrome.jpg', previewLayers: [],
  },
  {
    id: 'lv_carbon_gold', label: 'Carbon & Gold',
    description: 'Carbon weave base with gold chrome secondary and trim. Understated luxury.',
    price: 40_000, source: 'premium',
    thumbnailFile: 'lv_carbon_gold.jpg', previewLayers: [],
  },
  {
    id: 'lv_blueprint', label: 'Blueprint',
    description: 'Technical blueprint graphic on a midnight blue base — mechanical drawings of the engine.',
    price: 28_000, source: 'premium',
    thumbnailFile: 'lv_blueprint.jpg', previewLayers: [],
  },
  {
    id: 'lv_fire_ice', label: 'Fire & Ice',
    description: 'A dramatic split livery — volcanic red and orange on the left, icy blue on the right.',
    price: 35_000, source: 'premium',
    thumbnailFile: 'lv_fire_ice.jpg', previewLayers: [],
  },
  {
    id: 'lv_matrix', label: 'Matrix Code',
    description: 'Falling green code characters on black. Nerd credibility: maximum.',
    price: 22_000, source: 'premium',
    thumbnailFile: 'lv_matrix.jpg', previewLayers: [],
  },
  {
    id: 'lv_batik', label: 'Batik Artisan',
    description: 'Traditional Indonesian batik pattern in earth tones. Unexpected and beautiful.',
    price: 25_000, source: 'premium',
    thumbnailFile: 'lv_batik.jpg', previewLayers: [],
  },
  {
    id: 'lv_polka_chrome', label: 'Chrome Polka',
    description: 'Chrome dot pattern on a flat black base — a tribute to the famous Rothmans livery.',
    price: 32_000, source: 'premium',
    thumbnailFile: 'lv_polka_chrome.jpg', previewLayers: [],
  },
  {
    id: 'lv_lava', label: 'Volcanic Lava',
    description: 'Photorealistic lava flow texture that appears to glow from within.',
    price: 42_000, source: 'premium',
    thumbnailFile: 'lv_lava.jpg', previewLayers: [],
  },
  {
    id: 'lv_speed_blur', label: 'Speed Blur',
    description: 'Motion-blur graphic that simulates 300 km/h even when parked.',
    price: 20_000, source: 'premium',
    thumbnailFile: 'lv_speed_blur.jpg', previewLayers: [],
  },
  {
    id: 'lv_disco_floor', label: 'Disco Floor',
    description: '1970s disco mirrored tile floor pattern across the entire car. Dance.',
    price: 22_000, source: 'premium',
    thumbnailFile: 'lv_disco_floor.jpg', previewLayers: [],
  },
  {
    id: 'lv_pixel_art', label: '8-Bit Pixel Car',
    description: 'A pixelated version of the car itself painted onto the car. Recursive and excellent.',
    price: 30_000, source: 'premium',
    thumbnailFile: 'lv_pixel_art.jpg', previewLayers: [],
  },

  // ── Earned liveries ───────────────────────────────────────────────────────

  {
    id: 'lv_festival_champion', label: 'Festival Champion',
    description: 'Awarded for winning the Festival Playlist Series Championship. Gold and teal.',
    price: 0, source: 'earned',
    earnedVia: 'Complete the Festival Playlist Series Championship.',
    thumbnailFile: 'lv_festival_champion.jpg', previewLayers: [],
  },
  {
    id: 'lv_season_winter', label: 'Winter Season Exclusive',
    description: 'Frosted blue and white livery released during the Winter Seasonal Event.',
    price: 0, source: 'earned',
    earnedVia: 'Complete 4 Winter Seasonal Challenges in a single season.',
    thumbnailFile: 'lv_season_winter.jpg', previewLayers: [],
  },
  {
    id: 'lv_speed_demon', label: 'Speed Demon',
    description: 'Red-black flame demon graphic. Earned by exceeding 300 km/h on a public road.',
    price: 0, source: 'earned',
    earnedVia: 'Reach 300 km/h top speed on any road.',
    thumbnailFile: 'lv_speed_demon.jpg', previewLayers: [],
  },
];

// ── Body kit / aero piece pricing (visual purchases, no PR change) ─────────────
export const BODY_KITS = [
  {
    id: 'bk_wide_sport', label: 'Sport Wide Body Kit',
    description: 'Subtle flared arches and side skirts. Wider stance without looking excessive.',
    price: 15_000, category: 'widebody',
    compatibleClasses: ['D','C','B','A','S1'],
  },
  {
    id: 'bk_wide_race', label: 'Race Wide Body Kit',
    description: 'Maximum-width arches and full aero skirts. Adds 100mm to track width visually.',
    price: 35_000, category: 'widebody',
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'bk_wide_extreme', label: 'Extreme Wide Body',
    description: 'Over-fender bolt-on style. Massive, aggressive, and visually unmistakable.',
    price: 60_000, category: 'widebody',
    compatibleClasses: ['B','A','S1','S2'],
  },
  {
    id: 'bk_aero_splitter_visual', label: 'Front Splitter (Visual)',
    description: 'Aesthetic splitter for cars where performance aero isn\'t available.',
    price: 5_000, category: 'aero_visual',
    compatibleClasses: 'all',
  },
  {
    id: 'bk_aero_lip', label: 'Front Lip',
    description: 'Subtle front lip add-on. OEM-style addition that tidies the lower front end.',
    price: 5_000, category: 'aero_visual',
    compatibleClasses: 'all',
  },
  {
    id: 'bk_side_skirts', label: 'Side Skirt Extensions',
    description: 'Low-mounted side skirts that connect front and rear bumper styling.',
    price: 8_000, category: 'aero_visual',
    compatibleClasses: 'all',
  },
  {
    id: 'bk_ducktail', label: 'Duck Tail Spoiler',
    description: 'Classic small ducktail spoiler — low-key aero with a historic racing reference.',
    price: 7_000, category: 'aero_visual',
    compatibleClasses: 'all',
  },
  {
    id: 'bk_wing_visual_small', label: 'Street Rear Wing (Visual)',
    description: 'Cosmetic street-style wing. Not as effective as the performance shop wing but costs less.',
    price: 10_000, category: 'aero_visual',
    compatibleClasses: 'all',
  },
  {
    id: 'bk_hood_vents', label: 'Vented Bonnet',
    description: 'Bonnet with integrated heat extraction vents. Looks purposeful.',
    price: 12_000, category: 'body_panel',
    compatibleClasses: 'all',
  },
  {
    id: 'bk_carbon_hood', label: 'Carbon Fibre Bonnet',
    description: 'Unpainted exposed carbon bonnet. Saves minimal weight but looks incredible.',
    price: 20_000, category: 'body_panel',
    compatibleClasses: 'all',
  },
];

// ── Paint config persistence ───────────────────────────────────────────────────

function _loadPaintConfig(carId) {
  try {
    return JSON.parse(localStorage.getItem(_paintKey(carId)));
  } catch { return null; }
}

function _savePaintConfig(carId, config) {
  localStorage.setItem(_paintKey(carId), JSON.stringify(config));
}

/**
 * Get the paint configuration for a car.
 * Falls back to DEFAULT_PAINT if no config has been saved.
 */
export function getPaintConfig(carId) {
  return _loadPaintConfig(carId) ?? { ...DEFAULT_PAINT };
}

/**
 * Update a single paint zone.
 * @param {string} carId
 * @param {string} zone  One of PAINT_ZONES[].id
 * @param {{ type: string, color: string }} update
 */
export function setPaintZone(carId, zone, update) {
  const config = getPaintConfig(carId);
  config[zone] = { ...(config[zone] ?? {}), ...update };
  _savePaintConfig(carId, config);
  return config;
}

export function setWindowTint(carId, level) {
  const config = getPaintConfig(carId);
  config.windowTint = Math.min(4, Math.max(0, level));
  _savePaintConfig(carId, config);
  return config;
}

/**
 * Purchase a non-free paint type for a zone and apply it.
 * Free paint types (solid, metallic) can be applied via setPaintZone directly.
 */
export function buyAndApplyPaintType(carId, zone, paintTypeId, color) {
  const pt = PAINT_TYPES.find(p => p.id === paintTypeId);
  if (!pt) return { success: false, reason: 'PAINT_TYPE_NOT_FOUND' };

  if (pt.price > 0) {
    if (!canAfford(pt.price)) return { success: false, reason: 'INSUFFICIENT_CREDITS' };
    const result = spend(pt.price, 'PAINT_PURCHASE', `${paintTypeId} on ${zone} — ${carId}`);
    if (!result.success) return { success: false, reason: 'SPEND_FAILED' };
  }

  const config = setPaintZone(carId, zone, { type: paintTypeId, color });
  return { success: true, config };
}

// ── Livery ownership ───────────────────────────────────────────────────────────

function _loadOwnedLiveries() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY_OWNED_LIVERIES) || '[]')); }
  catch { return new Set(); }
}

function _saveOwnedLiveries(set) {
  localStorage.setItem(KEY_OWNED_LIVERIES, JSON.stringify([...set]));
}

export function ownsLivery(liveryId) {
  const lv = LIVERY_CATALOG.find(l => l.id === liveryId);
  if (!lv) return false;
  if (lv.source === 'free') return true; // free liveries always available
  return _loadOwnedLiveries().has(liveryId);
}

export function buyLivery(liveryId) {
  const lv = LIVERY_CATALOG.find(l => l.id === liveryId);
  if (!lv)                      return { success: false, reason: 'NOT_FOUND' };
  if (ownsLivery(liveryId))     return { success: false, reason: 'ALREADY_OWNED' };
  if (lv.source === 'earned')   return { success: false, reason: 'EARNED_ONLY' };
  if (!canAfford(lv.price))     return { success: false, reason: 'INSUFFICIENT_CREDITS' };

  const result = spend(lv.price, 'LIVERY_PURCHASE', `Livery: ${lv.label}`);
  if (!result.success) return { success: false, reason: 'SPEND_FAILED' };

  const owned = _loadOwnedLiveries();
  owned.add(liveryId);
  _saveOwnedLiveries(owned);
  return { success: true, livery: lv };
}

/** Grant an earned livery (no credit cost). */
export function grantLivery(liveryId) {
  const owned = _loadOwnedLiveries();
  owned.add(liveryId);
  _saveOwnedLiveries(owned);
}

export function browseLiveries(filters = {}) {
  const { source, search, ownedOnly } = filters;
  const owned   = _loadOwnedLiveries();
  const balance = parseInt(localStorage.getItem('hc_credits') || '0', 10);

  return LIVERY_CATALOG
    .filter(lv => !source || lv.source === source)
    .filter(lv => !search  || lv.label.toLowerCase().includes(search.toLowerCase()))
    .filter(lv => !ownedOnly || ownsLivery(lv.id))
    .map(lv => ({
      ...lv,
      owned:      ownsLivery(lv.id),
      affordable: balance >= lv.price,
    }));
}

// ── Apply livery to a car ──────────────────────────────────────────────────────

function _loadAppliedLivery(carId) {
  try { return JSON.parse(localStorage.getItem(_liveryKey(carId))); }
  catch { return null; }
}

/** Apply (or clear) a livery on a specific car. liveryId null = clear. */
export function applyLivery(carId, liveryId) {
  if (liveryId && !ownsLivery(liveryId)) {
    return { success: false, reason: 'NOT_OWNED' };
  }
  localStorage.setItem(_liveryKey(carId), JSON.stringify(liveryId ?? null));
  return { success: true };
}

export function getAppliedLivery(carId) {
  const id = _loadAppliedLivery(carId);
  return id ? LIVERY_CATALOG.find(l => l.id === id) ?? null : null;
}

// ── Body kit ownership ─────────────────────────────────────────────────────────

const _bkKey = carId => `hc_bodykit_${carId}`;

function _loadInstalledBodyKit(carId) {
  try { return JSON.parse(localStorage.getItem(_bkKey(carId)) || '[]'); }
  catch { return []; }
}

export function getInstalledBodyKitPieces(carId) {
  const ids = _loadInstalledBodyKit(carId);
  return BODY_KITS.filter(bk => ids.includes(bk.id));
}

export function buyAndInstallBodyKitPiece(carId, bodyKitId) {
  const bk  = BODY_KITS.find(b => b.id === bodyKitId);
  const car = getCarById(carId);

  if (!bk)  return { success: false, reason: 'NOT_FOUND' };
  if (!car) return { success: false, reason: 'CAR_NOT_FOUND' };

  const installed = _loadInstalledBodyKit(carId);
  if (installed.includes(bodyKitId)) return { success: false, reason: 'ALREADY_INSTALLED' };

  if (bk.compatibleClasses !== 'all' && !bk.compatibleClasses.includes(car.class)) {
    return { success: false, reason: 'INCOMPATIBLE_CLASS' };
  }
  if (!canAfford(bk.price)) return { success: false, reason: 'INSUFFICIENT_CREDITS' };

  const result = spend(bk.price, 'BODY_KIT_PURCHASE', `${car.name}: ${bk.label}`);
  if (!result.success) return { success: false, reason: 'SPEND_FAILED' };

  installed.push(bodyKitId);
  localStorage.setItem(_bkKey(carId), JSON.stringify(installed));
  return { success: true, bodyKit: bk };
}

// ── Community livery share codes ───────────────────────────────────────────────

/**
 * Export the current paint config + applied livery as a base64 share code.
 * The code is a JSON blob encoded to base64 — simple and portable.
 */
export function exportLiveryCode(carId) {
  const paint  = getPaintConfig(carId);
  const livery = getAppliedLivery(carId);
  const data   = JSON.stringify({ paint, liveryId: livery?.id ?? null, v: 1 });
  return btoa(data);
}

/**
 * Import a share code and apply it to a car.
 * Paint zones are applied for free; if the livery is premium it must be owned separately.
 */
export function importLiveryCode(carId, code) {
  try {
    const data = JSON.parse(atob(code));
    if (!data?.paint) return { success: false, reason: 'INVALID_CODE' };

    // Apply paint config
    for (const [zone, zoneData] of Object.entries(data.paint)) {
      if (zone !== 'windowTint') {
        const config = getPaintConfig(carId);
        config[zone] = zoneData;
        _savePaintConfig(carId, config);
      }
    }
    if (typeof data.paint.windowTint === 'number') {
      setWindowTint(carId, data.paint.windowTint);
    }

    // Apply livery only if owned
    if (data.liveryId) {
      if (ownsLivery(data.liveryId)) {
        applyLivery(carId, data.liveryId);
      } else {
        return { success: true, warning: 'LIVERY_NOT_OWNED', message: 'Paint applied but livery not owned — buy it first.' };
      }
    }

    return { success: true };
  } catch {
    return { success: false, reason: 'DECODE_ERROR' };
  }
}

// ── Shop location ──────────────────────────────────────────────────────────────

export const LIVERY_SHOP_LOCATION = {
  id:          'downtown_livery',
  label:       'Livery & Paint Shop',
  district:    'Downtown Core',
  description: 'A converted art gallery with murals on every wall. The place to bring your car for a complete transformation — paint, liveries, and body kits all under one roof.',
};

// ── Reset ──────────────────────────────────────────────────────────────────────

export function resetLiveryShop() {
  localStorage.removeItem(KEY_OWNED_LIVERIES);
}

/**
 * PART 5 — Avatar Customization
 * AvatarData.js — All static data: appearance options, clothing catalog, titles, stickers
 */

// ─── APPEARANCE ──────────────────────────────────────────────────────────────

export const BODY_TYPES = [
  { id: 'slim',         label: 'Slim',    scale: { x: 0.88, y: 1.00, z: 0.88 } },
  { id: 'lean',         label: 'Lean',    scale: { x: 0.93, y: 1.00, z: 0.93 } },
  { id: 'athletic',     label: 'Athletic',scale: { x: 1.00, y: 1.00, z: 1.00 } },
  { id: 'broad',        label: 'Broad',   scale: { x: 1.07, y: 0.98, z: 1.05 } },
  { id: 'stocky',       label: 'Stocky',  scale: { x: 1.05, y: 0.95, z: 1.05 } },
  { id: 'heavyset',     label: 'Heavyset',scale: { x: 1.13, y: 0.96, z: 1.13 } },
];

export const SKIN_PRESETS = [
  '#FDDBB4','#F5C895','#EEB87A','#D4956A','#C07B52',
  '#A5613C','#8B4A2A','#73351B','#5C2310','#3D1409',
  '#FDDEC8','#F8C9A0','#EFA870','#D98550','#BE6B38',
  '#A35428','#7D3818','#5E2410','#FFEBE0','#F9D4B6',
  '#EBAF84','#D4895C','#B96B3E','#9A5028','#7B3519',
  '#5D2210','#3E1108','#F4D0C0','#E8AF95','#D08A68',
  '#B56B48','#9A5030','#7D3820','#5E2411','#3F140A',
  '#FFEEE5','#FBDDD0','#F5C1A8','#EB9E80','#D87E5A',
  '#C46040','#A44428','#7E2E14','#5A1C09',
];

export const FACE_SHAPES = [
  { id: 'oval',      label: 'Oval',      morph: { jawWidth: 0.3, cheekbone: 0.5, chin: 0.4 } },
  { id: 'round',     label: 'Round',     morph: { jawWidth: 0.6, cheekbone: 0.7, chin: 0.3 } },
  { id: 'square',    label: 'Square',    morph: { jawWidth: 0.8, cheekbone: 0.5, chin: 0.6 } },
  { id: 'heart',     label: 'Heart',     morph: { jawWidth: 0.2, cheekbone: 0.8, chin: 0.2 } },
  { id: 'diamond',   label: 'Diamond',   morph: { jawWidth: 0.2, cheekbone: 0.9, chin: 0.3 } },
  { id: 'oblong',    label: 'Oblong',    morph: { jawWidth: 0.4, cheekbone: 0.4, chin: 0.5 } },
  { id: 'triangle',  label: 'Triangle',  morph: { jawWidth: 0.9, cheekbone: 0.3, chin: 0.5 } },
  { id: 'inverted',  label: 'Inv. Triangle', morph: { jawWidth: 0.2, cheekbone: 0.9, chin: 0.6 } },
];

export const EYE_SHAPES = [
  'Almond','Round','Hooded','Monolid','Upturned','Downturned',
  'Wide-Set','Close-Set','Deep-Set','Prominent','Sleepy','Bright',
];

export const EYEBROW_SHAPES = [
  'Straight','Arched','Soft Arch','S-Curve','Rounded','High Arch',
  'Flat','Angled','Natural','Bushy','Thin','Sculpted',
];

export const NOSE_SHAPES = [
  'Straight','Button','Hawk','Roman','Snub',
  'Wide','Narrow','Turned-Up','Bulbous','Flat',
];

export const LIP_SHAPES = [
  'Full','Thin','Cupid\'s Bow','Wide','Rosebud','Natural',
];

export const FACIAL_HAIR = [
  { id: 'none',          label: 'None' },
  { id: 'stubble',       label: 'Stubble' },
  { id: 'short_beard',   label: 'Short Beard' },
  { id: 'full_beard',    label: 'Full Beard' },
  { id: 'goatee',        label: 'Goatee' },
  { id: 'moustache',     label: 'Moustache' },
  { id: 'circle_beard',  label: 'Circle Beard' },
  { id: 'chin_strap',    label: 'Chin Strap' },
  { id: 'sideburns',     label: 'Sideburns' },
  { id: 'van_dyke',      label: 'Van Dyke' },
  { id: 'mutton_chops',  label: 'Mutton Chops' },
  { id: 'balbo',         label: 'Balbo' },
];

export const HAIR_STYLES = [
  { id: 'buzz',          label: 'Buzz Cut',        length: 'short' },
  { id: 'crew',          label: 'Crew Cut',         length: 'short' },
  { id: 'fade',          label: 'High Fade',        length: 'short' },
  { id: 'pompadour',     label: 'Pompadour',        length: 'short' },
  { id: 'caesar',        label: 'Caesar Cut',       length: 'short' },
  { id: 'side_part',     label: 'Side Part',        length: 'short' },
  { id: 'quiff',         label: 'Quiff',            length: 'short' },
  { id: 'undercut',      label: 'Undercut',         length: 'medium' },
  { id: 'textured_fringe',label: 'Textured Fringe', length: 'medium' },
  { id: 'slicked_back',  label: 'Slicked Back',     length: 'medium' },
  { id: 'wavy_medium',   label: 'Wavy Medium',      length: 'medium' },
  { id: 'curly_medium',  label: 'Curly Medium',     length: 'medium' },
  { id: 'afro_medium',   label: 'Afro (Medium)',    length: 'medium' },
  { id: 'locs_medium',   label: 'Locs (Medium)',    length: 'medium' },
  { id: 'twists',        label: 'Twists',           length: 'medium' },
  { id: 'cornrows',      label: 'Cornrows',         length: 'medium' },
  { id: 'braids_short',  label: 'Short Braids',     length: 'medium' },
  { id: 'long_straight', label: 'Long Straight',    length: 'long' },
  { id: 'long_wavy',     label: 'Long Wavy',        length: 'long' },
  { id: 'long_curly',    label: 'Long Curly',       length: 'long' },
  { id: 'afro_large',    label: 'Afro (Large)',     length: 'long' },
  { id: 'locs_long',     label: 'Locs (Long)',      length: 'long' },
  { id: 'braids_long',   label: 'Long Braids',      length: 'long' },
  { id: 'half_up',       label: 'Half-Up',          length: 'long' },
  { id: 'ponytail',      label: 'Ponytail',         length: 'long' },
  { id: 'bun',           label: 'Bun',              length: 'long' },
  { id: 'mohawk',        label: 'Mohawk',           length: 'short' },
  { id: 'dreadhawk',     label: 'Dreadhawk',        length: 'medium' },
  { id: 'shaved',        label: 'Shaved',           length: 'none' },
  { id: 'bald',          label: 'Bald',             length: 'none' },
];

export const PROSTHETIC_TYPES = [
  { id: 'none',           label: 'None' },
  { id: 'standard',       label: 'Standard' },
  { id: 'sport',          label: 'Sport' },
  { id: 'racing',         label: 'Racing' },
  { id: 'chrome',         label: 'Custom Chrome' },
];

export const VOICE_OPTIONS = [
  { id: 'v1', label: 'Voice 1 (Higher)' },
  { id: 'v2', label: 'Voice 2 (Higher)' },
  { id: 'v3', label: 'Voice 3 (Lower)' },
  { id: 'v4', label: 'Voice 4 (Lower)' },
];

export const PRONOUNS_PRESETS = ['He/Him','She/Her','They/Them','Custom'];

// ─── CLOTHING CATALOG ─────────────────────────────────────────────────────────

/**
 * Each item: { id, label, slot, rarity, source, colorZones: string[], price? }
 * source: 'shop' | 'wheelspin' | 'earned' | 'default'
 * rarity: 'common' | 'rare' | 'epic' | 'legendary'
 */

export const HELMETS = [
  // Full Face
  { id: 'hfull_01', label: 'Speed Shell',      slot: 'helmet', style: 'full_face',   rarity: 'common',    source: 'shop',      price: 2000, colorZones: ['body','visor','trim'] },
  { id: 'hfull_02', label: 'Vector Full',       slot: 'helmet', style: 'full_face',   rarity: 'common',    source: 'shop',      price: 2500, colorZones: ['body','visor','trim'] },
  { id: 'hfull_03', label: 'Circuit Breaker',   slot: 'helmet', style: 'full_face',   rarity: 'rare',      source: 'shop',      price: 4000, colorZones: ['body','visor','stripe'] },
  { id: 'hfull_04', label: 'Apex Predator',     slot: 'helmet', style: 'full_face',   rarity: 'epic',      source: 'shop',      price: 7500, colorZones: ['body','visor','accent'] },
  { id: 'hfull_ws', label: 'Neon Blade',        slot: 'helmet', style: 'full_face',   rarity: 'legendary', source: 'wheelspin', price: null, colorZones: ['body','visor','glow'] },
  // Open Face
  { id: 'hopen_01', label: 'Café Racer',        slot: 'helmet', style: 'open_face',   rarity: 'common',    source: 'shop',      price: 1800, colorZones: ['body','trim'] },
  { id: 'hopen_02', label: 'Retro Open',        slot: 'helmet', style: 'open_face',   rarity: 'common',    source: 'shop',      price: 2200, colorZones: ['body','band'] },
  { id: 'hopen_03', label: 'Heritage 66',       slot: 'helmet', style: 'open_face',   rarity: 'rare',      source: 'wheelspin', price: null, colorZones: ['body','band','logo'] },
  // Half Shell
  { id: 'hhalf_01', label: 'Urban Half',        slot: 'helmet', style: 'half_shell',  rarity: 'common',    source: 'shop',      price: 1500, colorZones: ['body'] },
  { id: 'hhalf_02', label: 'Street Half',       slot: 'helmet', style: 'half_shell',  rarity: 'common',    source: 'shop',      price: 1700, colorZones: ['body','stripe'] },
  // Balaclava / No Helmet
  { id: 'hbala_01', label: 'Balaclava',         slot: 'helmet', style: 'balaclava',   rarity: 'common',    source: 'shop',      price: 800,  colorZones: ['body'] },
  { id: 'hnone',    label: 'No Helmet',          slot: 'helmet', style: 'none',        rarity: 'common',    source: 'default',   price: 0,    colorZones: [] },
];

export const SUITS = [
  { id: 'suit_01', label: 'Horizon Racer',      slot: 'suit',   rarity: 'common',    source: 'default',   price: 0,    colorZones: ['body','collar','cuffs'] },
  { id: 'suit_02', label: 'Grid Start',         slot: 'suit',   rarity: 'common',    source: 'shop',      price: 3500, colorZones: ['body','collar','logos'] },
  { id: 'suit_03', label: 'National Pride',     slot: 'suit',   rarity: 'common',    source: 'shop',      price: 4000, colorZones: ['body','flag','trim'] },
  { id: 'suit_04', label: 'Urban Camo',         slot: 'suit',   rarity: 'rare',      source: 'shop',      price: 6000, colorZones: ['pattern','trim'] },
  { id: 'suit_05', label: 'Apex Team',          slot: 'suit',   rarity: 'rare',      source: 'shop',      price: 6500, colorZones: ['body','team_stripe','cuffs'] },
  { id: 'suit_06', label: 'Carbon Series',      slot: 'suit',   rarity: 'epic',      source: 'shop',      price: 9000, colorZones: ['body','accent','logos'] },
  { id: 'suit_ws', label: 'Phantom Racer',      slot: 'suit',   rarity: 'legendary', source: 'wheelspin', price: null, colorZones: ['body','glow','cuffs'] },
  { id: 'suit_champion', label: 'District Champion Jacket', slot: 'suit', rarity: 'epic', source: 'earned', price: null, colorZones: ['body','district_badge'] },
  { id: 'suit_legend', label: 'Legend Driver Suit', slot: 'suit', rarity: 'legendary', source: 'earned', price: null, colorZones: ['body','gold_trim','name'] },
];

export const TOPS = [
  { id: 'top_jacket_01', label: 'Racing Jacket',  slot: 'top', style: 'jacket',    rarity: 'common',    source: 'shop',      price: 1200, colorZones: ['body','collar'] },
  { id: 'top_jacket_02', label: 'Leather Jacket', slot: 'top', style: 'jacket',    rarity: 'rare',      source: 'shop',      price: 4500, colorZones: ['body','lining'] },
  { id: 'top_jacket_03', label: 'Bomber',         slot: 'top', style: 'jacket',    rarity: 'common',    source: 'shop',      price: 2200, colorZones: ['body','stripe','ribbing'] },
  { id: 'top_hoodie_01', label: 'City Hoodie',    slot: 'top', style: 'hoodie',    rarity: 'common',    source: 'shop',      price: 1000, colorZones: ['body','hood'] },
  { id: 'top_hoodie_02', label: 'Zip Hoodie',     slot: 'top', style: 'hoodie',    rarity: 'common',    source: 'shop',      price: 1200, colorZones: ['body','zip_panel'] },
  { id: 'top_jersey_01', label: 'Team Jersey',    slot: 'top', style: 'jersey',    rarity: 'common',    source: 'shop',      price: 1400, colorZones: ['body','number','trim'] },
  { id: 'top_tank_01',   label: 'Tank Top',       slot: 'top', style: 'tank',      rarity: 'common',    source: 'shop',      price: 600,  colorZones: ['body'] },
  { id: 'top_shirt_01',  label: 'Casual Shirt',   slot: 'top', style: 'shirt',     rarity: 'common',    source: 'shop',      price: 800,  colorZones: ['body','collar'] },
  { id: 'top_ws_01',     label: 'Neon Jersey',    slot: 'top', style: 'jersey',    rarity: 'legendary', source: 'wheelspin', price: null, colorZones: ['body','neon_stripe'] },
  // 20+ more implied; these are representative
];

export const GLOVES = [
  { id: 'glove_none',   label: 'No Gloves',       slot: 'gloves', rarity: 'common',    source: 'default',   price: 0,    colorZones: [] },
  { id: 'glove_race',   label: 'Racing Gloves',   slot: 'gloves', rarity: 'common',    source: 'shop',      price: 900,  colorZones: ['body','knuckle'] },
  { id: 'glove_finger', label: 'Fingerless',      slot: 'gloves', rarity: 'common',    source: 'shop',      price: 700,  colorZones: ['body'] },
  { id: 'glove_winter', label: 'Winter Gloves',   slot: 'gloves', rarity: 'common',    source: 'shop',      price: 850,  colorZones: ['body','cuff'] },
  { id: 'glove_gaunt',  label: 'Gauntlet',        slot: 'gloves', rarity: 'rare',      source: 'shop',      price: 2500, colorZones: ['body','plate','cuff'] },
];

export const PANTS = [
  { id: 'pants_race',   label: 'Racing Trousers', slot: 'pants', rarity: 'common',    source: 'shop',      price: 1100, colorZones: ['body','stripe'] },
  { id: 'pants_jeans',  label: 'Jeans',           slot: 'pants', rarity: 'common',    source: 'shop',      price: 800,  colorZones: ['body'] },
  { id: 'pants_cargo',  label: 'Cargo Pants',     slot: 'pants', rarity: 'common',    source: 'shop',      price: 950,  colorZones: ['body','pocket'] },
  { id: 'pants_shorts', label: 'Shorts',          slot: 'pants', rarity: 'common',    source: 'shop',      price: 600,  colorZones: ['body'] },
  { id: 'pants_perf',   label: 'Performance Leggings', slot: 'pants', rarity: 'rare', source: 'shop',      price: 1800, colorZones: ['body','panel'] },
];

export const SHOES = [
  { id: 'shoe_boot_hi',  label: 'High Race Boot',  slot: 'shoes', rarity: 'common',    source: 'shop',      price: 1500, colorZones: ['body','sole','logo'] },
  { id: 'shoe_boot_mid', label: 'Mid Race Boot',   slot: 'shoes', rarity: 'common',    source: 'shop',      price: 1200, colorZones: ['body','sole'] },
  { id: 'shoe_boot_ank', label: 'Ankle Boot',      slot: 'shoes', rarity: 'common',    source: 'shop',      price: 1000, colorZones: ['body','sole'] },
  { id: 'shoe_trainer',  label: 'Trainers',        slot: 'shoes', rarity: 'common',    source: 'shop',      price: 900,  colorZones: ['body','laces','sole'] },
  { id: 'shoe_work',     label: 'Work Boots',      slot: 'shoes', rarity: 'common',    source: 'shop',      price: 1100, colorZones: ['body','sole'] },
  { id: 'shoe_loafer',   label: 'Loafers',         slot: 'shoes', rarity: 'common',    source: 'shop',      price: 1300, colorZones: ['body'] },
  { id: 'shoe_ws_01',    label: 'Velocity Kicks',  slot: 'shoes', rarity: 'legendary', source: 'wheelspin', price: null, colorZones: ['body','glow_sole','laces'] },
];

export const ACCESSORIES = [
  // Glasses / Eyewear
  { id: 'acc_sun_01',    label: 'Aviators',        slot: 'accessory', style: 'glasses', rarity: 'common',    source: 'shop',      price: 600,  colorZones: ['frame','lens'] },
  { id: 'acc_sun_02',    label: 'Wayfarer',        slot: 'accessory', style: 'glasses', rarity: 'common',    source: 'shop',      price: 650,  colorZones: ['frame','lens'] },
  { id: 'acc_sun_03',    label: 'Sport Shield',    slot: 'accessory', style: 'glasses', rarity: 'common',    source: 'shop',      price: 700,  colorZones: ['frame','lens'] },
  { id: 'acc_goggle_01', label: 'Race Goggles',    slot: 'accessory', style: 'goggles', rarity: 'rare',      source: 'shop',      price: 1800, colorZones: ['frame','lens','strap'] },
  // Jewellery
  { id: 'acc_ear_01',    label: 'Stud Earrings',   slot: 'accessory', style: 'earring', rarity: 'common',    source: 'shop',      price: 400,  colorZones: ['gem'] },
  { id: 'acc_neck_01',   label: 'Chain Necklace',  slot: 'accessory', style: 'necklace',rarity: 'common',    source: 'shop',      price: 500,  colorZones: ['chain'] },
  { id: 'acc_watch_01',  label: 'Sport Watch',     slot: 'accessory', style: 'watch',   rarity: 'rare',      source: 'shop',      price: 2200, colorZones: ['strap','face'] },
  { id: 'acc_none',      label: 'None',            slot: 'accessory', style: 'none',    rarity: 'common',    source: 'default',   price: 0,    colorZones: [] },
];

// Combined catalog for easy lookup
export const ALL_ITEMS = [
  ...HELMETS, ...SUITS, ...TOPS, ...GLOVES,
  ...PANTS, ...SHOES, ...ACCESSORIES,
];

export function getItemById(id) {
  return ALL_ITEMS.find(item => item.id === id) || null;
}

// ─── DRIVER IDENTITY ─────────────────────────────────────────────────────────

export const DRIVER_TITLES = [
  // Default
  { id: 'rookie',       label: 'Rookie',        requirement: 'default' },
  { id: 'street_racer', label: 'Street Racer',  requirement: 'complete_tutorial' },
  // District titles
  { id: 'downtown_king',label: 'Downtown King', requirement: 'win_downtown_series' },
  { id: 'port_chaser',  label: 'Port Chaser',   requirement: 'win_port_series' },
  { id: 'ridge_runner', label: 'Ridge Runner',  requirement: 'win_ridge_series' },
  // Skill titles
  { id: 'drift_king',   label: 'Drift King',    requirement: 'drift_10000m' },
  { id: 'road_hunter',  label: 'Road Hunter',   requirement: 'win_50_races' },
  { id: 'speed_demon',  label: 'Speed Demon',   requirement: 'hit_250kmh' },
  { id: 'car_collector',label: 'Car Collector', requirement: 'own_20_cars' },
  { id: 'legend',       label: 'Legend',        requirement: 'reach_level_100' },
  { id: 'champion',     label: 'Champion',      requirement: 'win_championship' },
];

export const CARD_BACKGROUNDS = [
  { id: 'bg_default',   label: 'Asphalt',       requirement: 'default' },
  { id: 'bg_city',      label: 'City Lights',   requirement: 'complete_tutorial' },
  { id: 'bg_sunset',    label: 'Sunset Strip',  requirement: 'reach_level_10' },
  { id: 'bg_neon',      label: 'Neon Grid',     requirement: 'reach_level_25' },
  { id: 'bg_gold',      label: 'Gold Standard', requirement: 'win_50_races' },
  { id: 'bg_carbon',    label: 'Carbon Weave',  requirement: 'own_10_cars' },
  { id: 'bg_podium',    label: 'Podium Lights', requirement: 'win_championship' },
  { id: 'bg_legend',    label: 'Hall of Legends',requirement: 'reach_level_100' },
  { id: 'bg_dawn',      label: 'Dawn Patrol',   requirement: 'wheelspin' },
  { id: 'bg_storm',     label: 'Storm Circuit', requirement: 'wheelspin' },
];

export const STICKERS = [
  { id: 'stk_hotlap',   label: '🔥 Hot Lap',      requirement: 'set_lap_record' },
  { id: 'stk_speed',    label: '💨 Speed Demon',   requirement: 'hit_250kmh' },
  { id: 'stk_champ',    label: '🏆 Champion',      requirement: 'win_championship' },
  { id: 'stk_collector',label: '🚗 Car Collector', requirement: 'own_20_cars' },
  { id: 'stk_drifter',  label: '🌀 Drifter',       requirement: 'drift_5000m' },
  { id: 'stk_air',      label: '🚀 Air Time',      requirement: 'jump_100m' },
  { id: 'stk_legend',   label: '⭐ Legend',         requirement: 'reach_level_100' },
  { id: 'stk_streak',   label: '🔗 Win Streak',    requirement: 'win_5_in_row' },
  { id: 'stk_social',   label: '👥 Social Racer',  requirement: 'play_with_friends' },
  { id: 'stk_veteran',  label: '🎖️ Veteran',       requirement: 'play_30_days' },
];

export const FLAGS = [
  'AF','AL','DZ','AR','AU','AT','BE','BR','CA','CL','CN','CO','HR','CZ',
  'DK','EG','FI','FR','DE','GH','GR','GT','HU','IN','ID','IR','IQ','IE',
  'IL','IT','JM','JP','JO','KE','KR','MX','MA','NL','NZ','NG','NO','PK',
  'PE','PH','PL','PT','RO','SA','SG','ZA','ES','SE','CH','TH','TR','UA',
  'GB','US','VE','VN',
];

// ─── EMOTES ──────────────────────────────────────────────────────────────────

export const EMOTES = [
  { id: 'emote_thumbsup',  label: 'Thumbs Up',    phase: 1, requirement: 'default' },
  { id: 'emote_peace',     label: 'Peace Sign',   phase: 1, requirement: 'default' },
  { id: 'emote_fistpump',  label: 'Fist Pump',    phase: 2, requirement: 'win_10_races' },
  { id: 'emote_wave',      label: 'Wave',         phase: 2, requirement: 'default' },
  { id: 'emote_dance_01',  label: 'Victory Dance',phase: 2, requirement: 'win_championship' },
  { id: 'emote_dance_02',  label: 'Podium Shuffle',phase: 2, requirement: 'wheelspin' },
  { id: 'emote_burnout',   label: 'Burnout Mime', phase: 2, requirement: 'wheelspin' },
];

// ─── DEFAULT AVATAR STATE ────────────────────────────────────────────────────

export const DEFAULT_AVATAR = {
  // Appearance
  bodyType: 'athletic',
  height: 0.5,          // 0–1 slider
  skinTone: '#D4956A',
  skinUndertone: 'neutral', // cool | neutral | warm
  faceShape: 'oval',
  jawWidth: 0.3,
  cheekbone: 0.5,
  chin: 0.4,
  eyeShape: 'Almond',
  eyeColor: '#5C3A1E',
  eyeColorRight: null,  // null = same as left (heterochromia)
  eyebrowShape: 'Natural',
  eyebrowThickness: 0.5,
  eyebrowColor: '#3A2010',
  noseShape: 'Straight',
  noseWidth: 0.5,
  noseBridge: 0.5,
  lipShape: 'Natural',
  lipSize: 0.5,
  facialHair: 'none',
  facialHairColor: '#3A2010',
  hairStyle: 'crew',
  hairColor: '#3A2010',
  hairHighlight: null,
  prostheticArmLeft: 'none',
  prostheticArmRight: 'none',
  prostheticLegLeft: 'none',
  prostheticLegRight: 'none',
  pronouns: 'They/Them',
  pronounsCustom: '',
  voice: 'v3',

  // Clothing
  equipped: {
    helmet: 'hnone',
    suit:   null,
    top:    'top_jacket_01',
    gloves: 'glove_none',
    pants:  'pants_jeans',
    shoes:  'shoe_trainer',
    accessory: 'acc_none',
  },
  // Colors per slot: { slotId: { zone: hexColor } }
  colors: {
    top_jacket_01: { body: '#1A1A2E', collar: '#E94560' },
    pants_jeans:   { body: '#2C3E6B' },
    shoe_trainer:  { body: '#F5F5F5', laces: '#E94560', sole: '#1A1A2E' },
  },

  // Driver identity
  driverName: 'Driver',
  driverTitle: 'rookie',
  nationality: 'US',
  cardBackground: 'bg_default',
  cardAccent: '#E94560',
  activeStickers: [],

  // Outfit saves: array of 10 slots { name, equipped, colors } | null
  outfitSlots: Array(10).fill(null),

  // Unlocked items (IDs) — shop+default always available; earned/wheelspin listed here
  unlockedItems: ['suit_01','top_jacket_01','glove_none','pants_jeans','shoe_trainer','acc_none','hnone','emote_thumbsup','emote_peace'],
};

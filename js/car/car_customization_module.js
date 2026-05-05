/**
 * PART 4 — Car Customization Module
 * Visual & Performance Deep Customization System
 */

// ─────────────────────────────────────────────
// DATA DEFINITIONS
// ─────────────────────────────────────────────

export const PAINT_TYPES = [
  { id: 'solid',      label: 'Solid',       shader: 'flat' },
  { id: 'metallic',   label: 'Metallic',    shader: 'metallic' },
  { id: 'matte',      label: 'Matte',       shader: 'matte' },
  { id: 'satin',      label: 'Satin',       shader: 'satin' },
  { id: 'carbon',     label: 'Carbon',      shader: 'carbon' },
  { id: 'chrome',     label: 'Chrome',      shader: 'envmap' },
  { id: 'colorshift', label: 'Color-Shift', shader: 'chameleon' },
];

export const HORIZON_COLORS = [
  '#E63946','#F4A261','#E9C46A','#2A9D8F','#264653',
  '#6A0572','#1B4332','#E9ECEF','#212529','#F72585',
  '#7209B7','#3A0CA3','#4361EE','#4CC9F0','#06D6A0',
  '#FFBE0B','#FB5607','#FF006E','#8338EC','#3A86FF',
];

export const WINDOW_TINTS = [
  { id: 'clear',     label: 'Clear',      opacity: 0.05 },
  { id: 'light',     label: 'Light Tint', opacity: 0.25 },
  { id: 'dark',      label: 'Dark Tint',  opacity: 0.50 },
  { id: 'vdark',     label: 'Very Dark',  opacity: 0.75 },
  { id: 'mirror',    label: 'Mirror',     opacity: 0.90 },
];

export const BODY_OPTIONS = {
  frontBumper:  ['Stock', 'Sport', 'Track', 'Wide Body Front', 'Custom'],
  rearBumper:   ['Stock', 'Sport', 'Track', 'Diffuser Edition'],
  sideSkirts:   ['Stock', 'Race Skirts', 'Wide Arch Skirts'],
  hood:         ['Stock', 'Vented Hood', 'Carbon Hood', 'Race Hood'],
  roofScoop:    ['None', 'Small Scoop', 'Large Scoop', 'Full Ram Air'],
  rearWing:     ['Stock', 'Lip Spoiler', 'Sport Wing', 'Race Wing', 'GT Blade', 'No Spoiler'],
  splitter:     ['None', 'Canards', 'Full Splitter'],
  diffuser:     ['None', 'Standard', 'Race'],
  rollCage:     ['None', 'Partial', 'Full'],
  wideBody:     ['None', 'Wide Body Kit'],
};

export const WHEEL_FINISHES = [
  'Gloss Black','Silver','Gold','Bronze','Matte','Chrome',
  'Candy','Body Color','Carbon','Custom Color',
];

export const TIRE_COMPOUNDS = [
  { id: 'street',    label: 'Street',       gripDry: 0.6, gripWet: 0.7, gripDirt: 0.4 },
  { id: 'sport',     label: 'Sport',        gripDry: 0.75, gripWet: 0.55, gripDirt: 0.3 },
  { id: 'semislick', label: 'Semi-Slick',   gripDry: 0.88, gripWet: 0.35, gripDirt: 0.2 },
  { id: 'slick',     label: 'Slick',        gripDry: 0.98, gripWet: 0.10, gripDirt: 0.1 },
  { id: 'offroad',   label: 'Off-Road',     gripDry: 0.45, gripWet: 0.60, gripDirt: 0.85 },
  { id: 'mud',       label: 'Mud Terrain',  gripDry: 0.25, gripWet: 0.55, gripDirt: 0.95 },
  { id: 'drag',      label: 'Drag Radial',  gripDry: 0.85, gripWet: 0.20, gripDirt: 0.1 },
];

export const ENGINE_TIERS = [
  { id: 'stock',  label: 'Stock Block',    powerMult: 1.00, weightAdd: 0,    prPoints: 0  },
  { id: 'street', label: 'Street Engine',  powerMult: 1.05, weightAdd: 0,    prPoints: 15 },
  { id: 'sport',  label: 'Sport Engine',   powerMult: 1.12, weightAdd: -5,   prPoints: 35 },
  { id: 'race',   label: 'Race Engine',    powerMult: 1.22, weightAdd: -15,  prPoints: 60 },
  { id: 'swap',   label: 'Engine Swap',    powerMult: 1.35, weightAdd: 20,   prPoints: 90 },
];

export const ASPIRATION_OPTIONS = [
  { id: 'na',           label: 'Naturally Aspirated', lag: 0,   boostMult: 1.00, prPoints: 0  },
  { id: 'stock_turbo',  label: 'Stock Turbo',          lag: 0.6, boostMult: 1.12, prPoints: 20 },
  { id: 'sport_turbo',  label: 'Sport Turbo',          lag: 0.5, boostMult: 1.20, prPoints: 40 },
  { id: 'race_turbo',   label: 'Race Turbo',           lag: 0.4, boostMult: 1.30, prPoints: 65 },
  { id: 'twin_turbo',   label: 'Twin Turbo',           lag: 0.3, boostMult: 1.40, prPoints: 90 },
  { id: 'stock_super',  label: 'Stock Supercharger',   lag: 0,   boostMult: 1.15, prPoints: 30 },
  { id: 'sport_super',  label: 'Sport Supercharger',   lag: 0,   boostMult: 1.25, prPoints: 55 },
  { id: 'race_super',   label: 'Race Supercharger',    lag: 0,   boostMult: 1.38, prPoints: 85 },
];

export const EXHAUST_OPTIONS = [
  { id: 'stock',       label: 'Stock',       powerGain: 0,    prPoints: 0  },
  { id: 'sport',       label: 'Sport',        powerGain: 0.02, prPoints: 8  },
  { id: 'race',        label: 'Race',         powerGain: 0.04, prPoints: 18 },
  { id: 'competition', label: 'Competition',  powerGain: 0.06, prPoints: 28 },
];

export const TRANSMISSION_TIERS = [
  { id: 'stock',       label: 'Stock Gearbox',      shiftTime: 0.4, prPoints: 0  },
  { id: 'street',      label: 'Street Gearbox',     shiftTime: 0.35, prPoints: 12 },
  { id: 'sport',       label: 'Sport Gearbox',      shiftTime: 0.28, prPoints: 28 },
  { id: 'race',        label: 'Race Gearbox',       shiftTime: 0.20, prPoints: 48 },
  { id: 'sequential',  label: 'Sequential',         shiftTime: 0.12, prPoints: 65 },
];

export const DIFFERENTIAL_OPTIONS = [
  { id: 'open',  label: 'Stock (Open Diff)', tractionBonus: 0,    prPoints: 0  },
  { id: 'street',label: 'Street LSD',        tractionBonus: 0.10, prPoints: 15 },
  { id: 'race',  label: 'Race LSD',          tractionBonus: 0.20, prPoints: 35 },
  { id: 'drift', label: 'Drift Diff',        tractionBonus: -0.05,prPoints: 25 },
];

export const BRAKE_TIERS = [
  { id: 'stock',   label: 'Stock',         stopDist: 1.00, prPoints: 0  },
  { id: 'street',  label: 'Street',        stopDist: 0.93, prPoints: 10 },
  { id: 'sport',   label: 'Sport',         stopDist: 0.85, prPoints: 22 },
  { id: 'race',    label: 'Race',          stopDist: 0.75, prPoints: 38 },
  { id: 'carbon',  label: 'Carbon Ceramic',stopDist: 0.65, prPoints: 55 },
];

export const SUSPENSION_OPTIONS = [
  { id: 'stock',   label: 'Stock',    handling: 0,    prPoints: 0  },
  { id: 'street',  label: 'Street',   handling: 0.08, prPoints: 15 },
  { id: 'sport',   label: 'Sport',    handling: 0.18, prPoints: 32 },
  { id: 'race',    label: 'Race',     handling: 0.30, prPoints: 55 },
  { id: 'rally',   label: 'Rally',    handling: 0.15, prPoints: 30 },
  { id: 'drift',   label: 'Drift',    handling: 0.12, prPoints: 28 },
];

export const WEIGHT_REDUCTION = [
  { id: 'none',  label: 'Stock Weight',   weightLoss: 0,   prPoints: 0  },
  { id: 'tier1', label: 'Tier 1 (-30kg)', weightLoss: 30,  prPoints: 12 },
  { id: 'tier2', label: 'Tier 2 (-60kg)', weightLoss: 60,  prPoints: 25 },
  { id: 'tier3', label: 'Tier 3 (-100kg)',weightLoss: 100, prPoints: 40 },
];

// PR CLASS THRESHOLDS
export const PR_CLASSES = [
  { label: 'D', min: 0,   max: 99,  color: '#6c757d' },
  { label: 'C', min: 100, max: 249, color: '#fd7e14' },
  { label: 'B', min: 250, max: 449, color: '#ffc107' },
  { label: 'A', min: 450, max: 649, color: '#20c997' },
  { label: 'S', min: 650, max: 849, color: '#0dcaf0' },
  { label: 'X', min: 850, max: 999, color: '#d63384' },
];

// CAR DATABASE
export const CAR_DATABASE = [
  {
    id: 'nissan_silvia',
    name: 'Nissan Silvia S15',
    year: 1999,
    basePR: 120,
    basePower: 250,
    baseWeight: 1180,
    drivetrain: 'RWD',
    class: 'C',
    availableSwaps: ['sr20det_stock', 'rb25det', '2jz_na'],
  },
  {
    id: 'subaru_wrx',
    name: 'Subaru WRX STI',
    year: 2004,
    basePR: 180,
    basePower: 300,
    baseWeight: 1450,
    drivetrain: 'AWD',
    class: 'B',
    availableSwaps: ['ej25_built', 'ej207_group_n'],
  },
  {
    id: 'lamborghini_huracan',
    name: 'Lamborghini Huracán',
    year: 2014,
    basePR: 580,
    basePower: 610,
    baseWeight: 1422,
    drivetrain: 'AWD',
    class: 'S',
    availableSwaps: [],
  },
  {
    id: 'ford_mustang',
    name: 'Ford Mustang GT',
    year: 2020,
    basePR: 220,
    basePower: 460,
    baseWeight: 1700,
    drivetrain: 'RWD',
    class: 'B',
    availableSwaps: ['coyote_built', 'shelby_gt500'],
  },
  {
    id: 'toyota_ae86',
    name: 'Toyota AE86',
    year: 1986,
    basePR: 80,
    basePower: 128,
    baseWeight: 940,
    drivetrain: 'RWD',
    class: 'D',
    availableSwaps: ['2jz_swap', '1jz_swap', '4age_big_port'],
  },
];

// ─────────────────────────────────────────────
// DEFAULT CONFIGS
// ─────────────────────────────────────────────

export function createDefaultVisualConfig() {
  return {
    paintType: 'solid',
    primaryColor: '#e63946',
    secondaryColor: '#212529',
    tertiaryColor: '#6c757d',
    caliperColor: '#e63946',
    interiorColor: '#212529',
    windowTint: 'clear',
    bodyKit: {
      frontBumper: 'Stock',
      rearBumper: 'Stock',
      sideSkirts: 'Stock',
      hood: 'Stock',
      roofScoop: 'None',
      rearWing: 'Stock',
      splitter: 'None',
      diffuser: 'None',
      rollCage: 'None',
      wideBody: 'None',
    },
    wheels: {
      design: 'Sport 5-Spoke',
      finish: 'Gloss Black',
      diameter: 18,
      width: 225,
    },
    tires: {
      compound: 'sport',
      width: 225,
      wallStyle: 'Standard',
    },
    extras: {
      headlights: 'Stock',
      taillights: 'Stock',
      plateText: 'HORIZON',
      plateDesign: 'Default',
      neonColor: null,
      neonEnabled: false,
    },
    livery: null,
  };
}

export function createDefaultPerfConfig() {
  return {
    engine: 'stock',
    aspiration: 'na',
    exhaust: 'stock',
    transmission: 'stock',
    drivetrain: null, // null = use car's native
    differential: 'open',
    driveshaft: 'stock',
    clutch: 'stock',
    brakes: 'stock',
    weightReduction: 'none',
    rollCage: 'none',
    suspension: 'stock',
    antiRollBars: 'stock',
    aeroFront: 'none',
    aeroRear: 'none',
    underbody: 'none',
  };
}

export function createDefaultTuningConfig() {
  return {
    tirePressureFront: 32,
    tirePressureRear: 32,
    gearRatios: [3.5, 2.3, 1.7, 1.3, 1.0, 0.82],
    finalDrive: 3.73,
    camberFront: -1.0,
    camberRear: -0.5,
    toeFront: 0.0,
    toeRear: 0.1,
    caster: 6.5,
    springsFront: 12.0,
    springsRear: 10.0,
    rideHeightFront: 120,
    rideHeightRear: 120,
    dampingBumpFront: 5.0,
    dampingBumpRear: 5.0,
    dampingReboundFront: 7.0,
    dampingReboundRear: 7.0,
    arbFront: 18.0,
    arbRear: 15.0,
    brakeBias: 60,
    diffAccelLock: 25,
    diffDecelLock: 20,
    turboBoost: 1.0,
    superchargerBoost: 1.0,
  };
}

export function createDefaultMastery() {
  return {
    points: 0,
    totalEarned: 0,
    unlockedNodes: [],
    tree: [
      { id: 'credit_bonus',   label: '+10% Race Credits',      cost: 3,  unlocked: false },
      { id: 'drift_xp',       label: '+15% Drift XP',          cost: 4,  unlocked: false },
      { id: 'free_livery',    label: 'Exclusive Livery',        cost: 5,  unlocked: false },
      { id: 'hidden_color',   label: 'Hidden Color Unlocked',   cost: 6,  unlocked: false },
      { id: 'parts_discount', label: '10% Parts Discount',      cost: 7,  unlocked: false },
      { id: 'wheelspin',      label: 'Bonus Wheelspin x2',      cost: 8,  unlocked: false },
      { id: 'xp_multiplier',  label: 'XP Multiplier +20%',      cost: 10, unlocked: false },
      { id: 'max_power',      label: 'Hidden Power Boost +3%',  cost: 15, unlocked: false },
    ],
  };
}

// ─────────────────────────────────────────────
// PR CALCULATOR
// ─────────────────────────────────────────────

export function calculatePR(car, perfConfig) {
  const enginePR   = ENGINE_TIERS.find(e => e.id === perfConfig.engine)?.prPoints ?? 0;
  const aspirPR    = ASPIRATION_OPTIONS.find(a => a.id === perfConfig.aspiration)?.prPoints ?? 0;
  const exhaustPR  = EXHAUST_OPTIONS.find(e => e.id === perfConfig.exhaust)?.prPoints ?? 0;
  const transPR    = TRANSMISSION_TIERS.find(t => t.id === perfConfig.transmission)?.prPoints ?? 0;
  const diffPR     = DIFFERENTIAL_OPTIONS.find(d => d.id === perfConfig.differential)?.prPoints ?? 0;
  const brakesPR   = BRAKE_TIERS.find(b => b.id === perfConfig.brakes)?.prPoints ?? 0;
  const suspPR     = SUSPENSION_OPTIONS.find(s => s.id === perfConfig.suspension)?.prPoints ?? 0;
  const weightPR   = WEIGHT_REDUCTION.find(w => w.id === perfConfig.weightReduction)?.prPoints ?? 0;

  const totalPR = car.basePR + enginePR + aspirPR + exhaustPR + transPR
                + diffPR + brakesPR + suspPR + weightPR;

  return Math.min(999, totalPR);
}

export function getPRClass(pr) {
  return PR_CLASSES.find(c => pr >= c.min && pr <= c.max) ?? PR_CLASSES[0];
}

export function calculateStats(car, perfConfig) {
  const engineTier  = ENGINE_TIERS.find(e => e.id === perfConfig.engine);
  const aspirOpt    = ASPIRATION_OPTIONS.find(a => a.id === perfConfig.aspiration);
  const exhaustOpt  = EXHAUST_OPTIONS.find(e => e.id === perfConfig.exhaust);
  const suspOpt     = SUSPENSION_OPTIONS.find(s => s.id === perfConfig.suspension);
  const brakeOpt    = BRAKE_TIERS.find(b => b.id === perfConfig.brakes);
  const weightOpt   = WEIGHT_REDUCTION.find(w => w.id === perfConfig.weightReduction);
  const diffOpt     = DIFFERENTIAL_OPTIONS.find(d => d.id === perfConfig.differential);

  const power = Math.round(
    car.basePower
    * (engineTier?.powerMult ?? 1)
    * (aspirOpt?.boostMult ?? 1)
    * (1 + (exhaustOpt?.powerGain ?? 0))
  );

  const weight = car.baseWeight
    + (engineTier?.weightAdd ?? 0)
    - (weightOpt?.weightLoss ?? 0);

  const powerToWeight = power / weight;

  const handlingBase = 0.5 + (suspOpt?.handling ?? 0);
  const handling = Math.min(1, handlingBase + (diffOpt?.tractionBonus ?? 0));
  const braking = 1 - ((brakeOpt?.stopDist ?? 1) - 0.65) / 0.35;

  return {
    power,
    weight,
    powerToWeight: +powerToWeight.toFixed(3),
    handling: +(handling * 100).toFixed(1),
    braking: +(braking * 100).toFixed(1),
    topSpeed: Math.round(180 + powerToWeight * 120),
    acceleration: +(10 - powerToWeight * 8).toFixed(1),
    pr: calculatePR(car, perfConfig),
  };
}

// ─────────────────────────────────────────────
// CUSTOMIZATION STORE (localStorage)
// ─────────────────────────────────────────────

const STORE_KEY = 'cargame_customization_v1';

export class CustomizationStore {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('CustomizationStore: localStorage write failed', e);
    }
  }

  getCarData(carId) {
    if (!this.data[carId]) {
      this.data[carId] = {
        visual: createDefaultVisualConfig(),
        performance: createDefaultPerfConfig(),
        tuning: createDefaultTuningConfig(),
        mastery: createDefaultMastery(),
        savedTunes: [],
      };
    }
    return this.data[carId];
  }

  saveVisual(carId, visualConfig) {
    this.getCarData(carId).visual = { ...visualConfig };
    this._save();
  }

  savePerformance(carId, perfConfig) {
    this.getCarData(carId).performance = { ...perfConfig };
    this._save();
  }

  saveTuning(carId, tuningConfig) {
    this.getCarData(carId).tuning = { ...tuningConfig };
    this._save();
  }

  saveTunePreset(carId, name, tuningConfig) {
    const car = this.getCarData(carId);
    car.savedTunes = car.savedTunes ?? [];
    car.savedTunes.push({ name, config: { ...tuningConfig }, date: Date.now() });
    this._save();
  }

  loadTunePreset(carId, presetName) {
    const car = this.getCarData(carId);
    return car.savedTunes?.find(t => t.name === presetName)?.config ?? null;
  }

  addMasteryPoints(carId, points) {
    const car = this.getCarData(carId);
    car.mastery.points += points;
    car.mastery.totalEarned += points;
    this._save();
    return car.mastery;
  }

  unlockMasteryNode(carId, nodeId) {
    const car = this.getCarData(carId);
    const node = car.mastery.tree.find(n => n.id === nodeId);
    if (!node || node.unlocked || car.mastery.points < node.cost) return false;
    node.unlocked = true;
    car.mastery.points -= node.cost;
    car.mastery.unlockedNodes.push(nodeId);
    this._save();
    return true;
  }

  exportTuneCode(tuningConfig) {
    const json = JSON.stringify(tuningConfig);
    return btoa(json).slice(0, 16).toUpperCase();
  }

  importTuneCode(code, carId) {
    try {
      const json = atob(code);
      const config = JSON.parse(json);
      this.saveTuning(carId, config);
      return config;
    } catch {
      return null;
    }
  }

  reset(carId) {
    delete this.data[carId];
    this._save();
  }
}

export const store = new CustomizationStore();

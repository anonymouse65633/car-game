/**
 * js/economy/partsShop.js
 * Horizon City — Parts & Performance Shop.
 *
 * Responsibilities:
 *   • Complete parts catalog across all upgrade categories
 *   • Install / uninstall parts per car (stored per-car in localStorage)
 *   • Stat delta preview before purchasing
 *   • Tune preset save / load (up to 5 per car, free)
 *   • PR recalculation after upgrades
 *   • Drivetrain conversions (AWD swap, RWD swap)
 *   • Engine swap catalog
 */

import { spend, canAfford }                     from './Economy.js';
import { getCarById }                            from '../car/carData.js';
import { getActiveCar, getActiveCarObject }      from './AutoShow.js';

// ── Storage key helpers ────────────────────────────────────────────────────────
const _partKey  = carId => `hc_parts_${carId}`;
const _tuneKey  = carId => `hc_tunes_${carId}`;

// ── Part categories ────────────────────────────────────────────────────────────
export const PART_CATEGORIES = [
  { id: 'engine',      label: 'Engine',           icon: '⚙️'  },
  { id: 'aspiration',  label: 'Aspiration',        icon: '💨'  },
  { id: 'drivetrain',  label: 'Drivetrain',        icon: '⚡'  },
  { id: 'platform',    label: 'Platform & Handling',icon: '🔧' },
  { id: 'tires',       label: 'Tires',             icon: '🏎️' },
  { id: 'aero',        label: 'Aero & Body',       icon: '✈️'  },
  { id: 'engine_swap', label: 'Engine Swap',       icon: '🔄'  },
];

// ── Upgrade tiers ──────────────────────────────────────────────────────────────
export const TIERS = {
  street: { label: 'Street',  priceMin:  2_000, priceMax: 10_000 },
  sport:  { label: 'Sport',   priceMin: 10_000, priceMax: 35_000 },
  race:   { label: 'Race',    priceMin: 35_000, priceMax: 80_000 },
};

// ── Full parts catalog ─────────────────────────────────────────────────────────
/**
 * Each part:
 *   id, category, tier, label, description, price,
 *   statDeltas: { speed?, handling?, acceleration?, braking?, offroad? }
 *   prDelta: number  (added to car's base PR)
 *   compatibleClasses: string[] | 'all'
 *   requiresWidebody?: boolean
 *   unlocksTier?: string  (some parts gate the next tier slot)
 */
export const PARTS_CATALOG = [

  // ── Engine ──────────────────────────────────────────────────────────────────
  {
    id: 'engine_intake_street', category: 'engine', tier: 'street',
    label: 'Street Cold Air Intake',
    description: 'Replaces the stock airbox with a free-flow filter. Noticeable mid-range gains and a satisfying induction growl.',
    price: 2_500, prDelta: 6,
    statDeltas: { speed: 1, acceleration: 2 },
    compatibleClasses: 'all',
  },
  {
    id: 'engine_intake_sport', category: 'engine', tier: 'sport',
    label: 'Sport Induction Kit',
    description: 'High-flow intake with a velocity stack and heat shield. Extends the power band noticeably into the top-end.',
    price: 12_000, prDelta: 14,
    statDeltas: { speed: 2, acceleration: 3 },
    compatibleClasses: 'all',
    requires: 'engine_intake_street',
  },
  {
    id: 'engine_intake_race', category: 'engine', tier: 'race',
    label: 'Race Airbox & Plenum',
    description: 'Full race-spec intake system with individual throttle bodies on compatible engines. Maximum air charge volume.',
    price: 40_000, prDelta: 22,
    statDeltas: { speed: 3, acceleration: 4 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'engine_intake_sport',
  },
  {
    id: 'engine_exhaust_street', category: 'engine', tier: 'street',
    label: 'Street Cat-Back Exhaust',
    description: 'Mandrel-bent stainless system with freer-flowing mufflers. Sounds great and unlocks a little extra power.',
    price: 3_500, prDelta: 7,
    statDeltas: { speed: 1, acceleration: 2 },
    compatibleClasses: 'all',
  },
  {
    id: 'engine_exhaust_sport', category: 'engine', tier: 'sport',
    label: 'Sport Headers & Mid-Pipe',
    description: 'Equal-length headers replace the stock manifold, dramatically improving exhaust scavenging.',
    price: 14_000, prDelta: 16,
    statDeltas: { speed: 2, acceleration: 3 },
    compatibleClasses: 'all',
    requires: 'engine_exhaust_street',
  },
  {
    id: 'engine_exhaust_race', category: 'engine', tier: 'race',
    label: 'Race Titanium Exhaust System',
    description: 'Full lightweight titanium system with straight-through baffles. Weight saving plus maximum flow.',
    price: 45_000, prDelta: 24,
    statDeltas: { speed: 4, acceleration: 4 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'engine_exhaust_sport',
  },
  {
    id: 'engine_camshaft_sport', category: 'engine', tier: 'sport',
    label: 'Sport Camshaft Kit',
    description: 'Higher-lift, longer-duration cams broaden the power band and pull harder into the rev limiter.',
    price: 16_000, prDelta: 18,
    statDeltas: { speed: 3, acceleration: 4 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'engine_camshaft_race', category: 'engine', tier: 'race',
    label: 'Race Camshaft & Valve Train',
    description: 'Aggressive race-spec cam profiles with lightweight valves and stiff springs. Needs premium fuel.',
    price: 55_000, prDelta: 28,
    statDeltas: { speed: 5, acceleration: 5 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'engine_camshaft_sport',
  },
  {
    id: 'engine_block_street', category: 'engine', tier: 'street',
    label: 'Street Block Refresh',
    description: 'Fresh bearings, rings, and head gasket. Restores and slightly exceeds factory power.',
    price: 4_500, prDelta: 5,
    statDeltas: { acceleration: 2 },
    compatibleClasses: 'all',
  },
  {
    id: 'engine_block_sport', category: 'engine', tier: 'sport',
    label: 'Sport Forged Internals',
    description: 'Forged pistons and rods handle substantially more power than stock. Required before big-power builds.',
    price: 28_000, prDelta: 20,
    statDeltas: { speed: 2, acceleration: 4 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'engine_block_race', category: 'engine', tier: 'race',
    label: 'Race Engine Block Rebuild',
    description: 'Fully machined block with race-spec sleeves and a blueprinted crank. The foundation for 4-digit power.',
    price: 75_000, prDelta: 32,
    statDeltas: { speed: 5, acceleration: 6 },
    compatibleClasses: ['A','S1','S2'],
    requires: 'engine_block_sport',
  },

  // ── Aspiration ───────────────────────────────────────────────────────────────
  {
    id: 'asp_turbo_street', category: 'aspiration', tier: 'street',
    label: 'Street Turbo Upgrade',
    description: 'Larger compressor wheel and freer-flowing turbine. Reduces spool slightly and increases peak boost.',
    price: 8_000, prDelta: 18,
    statDeltas: { speed: 3, acceleration: 5 },
    compatibleClasses: 'all',
  },
  {
    id: 'asp_turbo_sport', category: 'aspiration', tier: 'sport',
    label: 'Sport Twin-Scroll Turbo',
    description: 'Twin-scroll design all but eliminates lag. Step-up spool with class-leading boost curve.',
    price: 22_000, prDelta: 30,
    statDeltas: { speed: 5, acceleration: 7 },
    compatibleClasses: ['C','B','A','S1','S2'],
    requires: 'asp_turbo_street',
  },
  {
    id: 'asp_turbo_race', category: 'aspiration', tier: 'race',
    label: 'Race Precision Turbocharger',
    description: 'Billet compressor wheel, ceramic bearings, anti-surge housing. The last turbo you\'ll need.',
    price: 65_000, prDelta: 45,
    statDeltas: { speed: 8, acceleration: 10 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'asp_turbo_sport',
  },
  {
    id: 'asp_supercharger_sport', category: 'aspiration', tier: 'sport',
    label: 'Sport Roots Supercharger',
    description: 'Positive-displacement blower bolted directly to the intake. Instant linear torque from idle.',
    price: 25_000, prDelta: 28,
    statDeltas: { speed: 4, acceleration: 8 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'asp_supercharger_race', category: 'aspiration', tier: 'race',
    label: 'Race Twin-Screw Supercharger',
    description: 'High-efficiency twin-screw design with an air-to-water intercooler. Brutal, linear shove.',
    price: 70_000, prDelta: 48,
    statDeltas: { speed: 9, acceleration: 11 },
    compatibleClasses: ['A','S1','S2'],
    requires: 'asp_supercharger_sport',
  },
  {
    id: 'asp_intercooler_sport', category: 'aspiration', tier: 'sport',
    label: 'Sport Front-Mount Intercooler',
    description: 'Large front-mount intercooler reduces charge temperature and allows sustained boost pressure.',
    price: 11_000, prDelta: 12,
    statDeltas: { speed: 2, acceleration: 3 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'asp_intercooler_race', category: 'aspiration', tier: 'race',
    label: 'Race Chargecooler System',
    description: 'Water-cooled chargecooler eliminates heat soak on extended runs. Consistent power every lap.',
    price: 38_000, prDelta: 20,
    statDeltas: { speed: 3, acceleration: 4 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'asp_intercooler_sport',
  },

  // ── Drivetrain ────────────────────────────────────────────────────────────────
  {
    id: 'dt_clutch_street', category: 'drivetrain', tier: 'street',
    label: 'Street Uprated Clutch',
    description: 'Higher clamping force disc handles extra power without slip.',
    price: 5_000, prDelta: 4,
    statDeltas: { acceleration: 2 },
    compatibleClasses: 'all',
  },
  {
    id: 'dt_clutch_sport', category: 'drivetrain', tier: 'sport',
    label: 'Sport Multi-Plate Clutch',
    description: 'Twin-plate ceramic clutch withstands big-power launches repeatedly.',
    price: 18_000, prDelta: 10,
    statDeltas: { acceleration: 4 },
    compatibleClasses: ['C','B','A','S1','S2'],
    requires: 'dt_clutch_street',
  },
  {
    id: 'dt_clutch_race', category: 'drivetrain', tier: 'race',
    label: 'Race Sequential Transmission',
    description: 'Straight-cut dog-leg sequential box with paddle shift. Lightning gear changes with zero torque interruption.',
    price: 80_000, prDelta: 22,
    statDeltas: { speed: 3, acceleration: 6 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'dt_clutch_sport',
  },
  {
    id: 'dt_diff_street', category: 'drivetrain', tier: 'street',
    label: 'Street Limited-Slip Differential',
    description: 'Mechanical LSD replaces the open diff. Huge improvement in traction out of corners.',
    price: 9_000, prDelta: 12,
    statDeltas: { handling: 4, acceleration: 3 },
    compatibleClasses: 'all',
  },
  {
    id: 'dt_diff_sport', category: 'drivetrain', tier: 'sport',
    label: 'Sport Plated LSD',
    description: 'Motorsport-spec plated LSD with adjustable ramp angles. Customisable in the Tuning Garage.',
    price: 20_000, prDelta: 18,
    statDeltas: { handling: 6, acceleration: 4 },
    compatibleClasses: ['C','B','A','S1','S2'],
    requires: 'dt_diff_street',
  },
  {
    id: 'dt_diff_race', category: 'drivetrain', tier: 'race',
    label: 'Race Torque-Vectoring Differential',
    description: 'Active torque vectoring applies individual wheel braking for surgical corner-exit control.',
    price: 60_000, prDelta: 26,
    statDeltas: { handling: 9, acceleration: 5 },
    compatibleClasses: ['A','S1','S2'],
    requires: 'dt_diff_sport',
  },
  {
    id: 'dt_awd_convert', category: 'drivetrain', tier: 'race',
    label: 'AWD Conversion',
    description: 'Full all-wheel-drive drivetrain transplant. Transforms RWD or FWD cars. Adjustable torque split in the Tuning Garage.',
    price: 120_000, prDelta: 35,
    statDeltas: { handling: 8, acceleration: 7, offroad: 12 },
    compatibleClasses: ['B','A','S1','S2'],
  },
  {
    id: 'dt_rwd_convert', category: 'drivetrain', tier: 'sport',
    label: 'RWD Conversion',
    description: 'Removes front drive components and installs a torque-hungry rear-drive setup. Drift-ready from the moment you leave the shop.',
    price: 50_000, prDelta: 8,
    statDeltas: { handling: 5, offroad: -5 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },

  // ── Platform & Handling ───────────────────────────────────────────────────────
  {
    id: 'plt_suspension_street', category: 'platform', tier: 'street',
    label: 'Street Sport Springs & Dampers',
    description: 'A firm but liveable lowering kit. Better roll control and a more confident turn-in.',
    price: 6_000, prDelta: 10,
    statDeltas: { handling: 5, braking: 2 },
    compatibleClasses: 'all',
  },
  {
    id: 'plt_suspension_sport', category: 'platform', tier: 'sport',
    label: 'Sport Coilover Kit',
    description: 'Height-adjustable coilovers with separate damping control. Set up for the circuit or the street.',
    price: 22_000, prDelta: 20,
    statDeltas: { handling: 9, braking: 4 },
    compatibleClasses: ['C','B','A','S1','S2'],
    requires: 'plt_suspension_street',
  },
  {
    id: 'plt_suspension_race', category: 'platform', tier: 'race',
    label: 'Race Three-Way Adjustable Suspension',
    description: 'Full three-way dampers (bump, rebound, high-speed compression). Absolute control on every surface.',
    price: 55_000, prDelta: 30,
    statDeltas: { handling: 14, braking: 6 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'plt_suspension_sport',
  },
  {
    id: 'plt_brakes_street', category: 'platform', tier: 'street',
    label: 'Street Brake Upgrade',
    description: 'Larger rotors and high-performance street pads. Massive reduction in stopping distances.',
    price: 5_500, prDelta: 8,
    statDeltas: { braking: 7 },
    compatibleClasses: 'all',
  },
  {
    id: 'plt_brakes_sport', category: 'platform', tier: 'sport',
    label: 'Sport Drilled & Slotted Brakes',
    description: 'Drilled rotors dissipate heat; slotted surface bites compound faster. Fade resistance is excellent.',
    price: 16_000, prDelta: 16,
    statDeltas: { braking: 12 },
    compatibleClasses: ['C','B','A','S1','S2'],
    requires: 'plt_brakes_street',
  },
  {
    id: 'plt_brakes_race', category: 'platform', tier: 'race',
    label: 'Race Carbon-Ceramic Brake System',
    description: 'Six-piston calipers on carbon-ceramic rotors. Featherweight, shrug-off-heat braking that never fades.',
    price: 70_000, prDelta: 24,
    statDeltas: { braking: 18 },
    compatibleClasses: ['A','S1','S2'],
    requires: 'plt_brakes_sport',
  },
  {
    id: 'plt_rollcage_sport', category: 'platform', tier: 'sport',
    label: 'Sport Roll Cage',
    description: 'Bolt-in safety cage stiffens the chassis significantly. Visible through the windows.',
    price: 24_000, prDelta: 14,
    statDeltas: { handling: 6, braking: 3 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'plt_rollcage_race', category: 'platform', tier: 'race',
    label: 'Full Race Cage (FIA Spec)',
    description: 'Welded FIA-compliant cage. Maximum rigidity. The chassis becomes a single stiff unit.',
    price: 50_000, prDelta: 20,
    statDeltas: { handling: 10, braking: 5 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'plt_rollcage_sport',
  },
  {
    id: 'plt_weight_sport', category: 'platform', tier: 'sport',
    label: 'Weight Reduction Package',
    description: 'Strips interior, replaces panels with aluminium equivalents. Lighter car, quicker everywhere.',
    price: 19_000, prDelta: 16,
    statDeltas: { acceleration: 5, handling: 4, braking: 3 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'plt_weight_race', category: 'platform', tier: 'race',
    label: 'Full Carbon Fibre Weight Reduction',
    description: 'Carbon doors, bonnet, roof, and trunk lid. Extreme diet — over 150 kg removed from select models.',
    price: 65_000, prDelta: 28,
    statDeltas: { acceleration: 8, handling: 7, braking: 5 },
    compatibleClasses: ['A','S1','S2'],
    requires: 'plt_weight_sport',
  },

  // ── Tires ────────────────────────────────────────────────────────────────────
  {
    id: 'tire_street', category: 'tires', tier: 'street',
    label: 'Street Performance Tires',
    description: 'High-quality all-season performance rubber. Balanced grip in wet and dry.',
    price: 3_000, prDelta: 8,
    statDeltas: { handling: 4, braking: 3 },
    compatibleClasses: 'all',
  },
  {
    id: 'tire_sport', category: 'tires', tier: 'sport',
    label: 'Sport Compound Tires',
    description: 'Softer dry-weather compound gives significantly more lateral grip. Wear faster in wet.',
    price: 12_000, prDelta: 16,
    statDeltas: { handling: 8, braking: 6 },
    compatibleClasses: 'all',
    requires: 'tire_street',
  },
  {
    id: 'tire_semislick', category: 'tires', tier: 'race',
    label: 'Semi-Slick Track Tires',
    description: 'Near-slick compound with a minimal tread pattern. Devastating dry grip, dangerously slippery in wet.',
    price: 38_000, prDelta: 24,
    statDeltas: { handling: 14, braking: 12 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'tire_sport',
  },
  {
    id: 'tire_drag', category: 'tires', tier: 'race',
    label: 'Drag Radials (Rear)',
    description: 'Enormous soft-compound rear slicks designed for straight-line traction. Transforms launches.',
    price: 28_000, prDelta: 14,
    statDeltas: { acceleration: 10, handling: -4 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'tire_offroad', category: 'tires', tier: 'sport',
    label: 'All-Terrain Off-Road Tires',
    description: 'Chunky tread pattern handles gravel, mud, and sand with authority. Noisier on tarmac.',
    price: 15_000, prDelta: 12,
    statDeltas: { offroad: 18, handling: -3 },
    compatibleClasses: 'all',
  },
  {
    id: 'tire_mud', category: 'tires', tier: 'race',
    label: 'Mud Terrain Tires',
    description: 'Extreme off-road compound with an open lug pattern that self-clears in deep mud.',
    price: 32_000, prDelta: 16,
    statDeltas: { offroad: 28, handling: -8 },
    compatibleClasses: 'all',
  },

  // ── Aero ─────────────────────────────────────────────────────────────────────
  {
    id: 'aero_splitter_sport', category: 'aero', tier: 'sport',
    label: 'Sport Front Splitter',
    description: 'Carbon fibre front splitter generates front-end downforce to balance the rear at speed.',
    price: 8_000, prDelta: 8,
    statDeltas: { handling: 4, speed: 1 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'aero_splitter_race', category: 'aero', tier: 'race',
    label: 'Race Front Splitter with Canards',
    description: 'Aggressive splitter with dive planes. Substantial downforce — adjustable angle in Tuning Garage.',
    price: 22_000, prDelta: 16,
    statDeltas: { handling: 8, speed: 2 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'aero_splitter_sport',
  },
  {
    id: 'aero_wing_sport', category: 'aero', tier: 'sport',
    label: 'Sport Rear Wing',
    description: 'A fixed-mount wing providing meaningful rear downforce without excessive drag.',
    price: 7_000, prDelta: 8,
    statDeltas: { handling: 5, speed: -1 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'aero_wing_race', category: 'aero', tier: 'race',
    label: 'Race GT Blade Wing',
    description: 'Enormous multi-element wing with adjustable angle of attack. Track-only levels of downforce.',
    price: 30_000, prDelta: 20,
    statDeltas: { handling: 12, speed: -2 },
    compatibleClasses: ['B','A','S1','S2'],
    requires: 'aero_wing_sport',
  },
  {
    id: 'aero_diffuser_sport', category: 'aero', tier: 'sport',
    label: 'Sport Rear Diffuser',
    description: 'Extracts air from beneath the car cleanly, reducing lift and improving rear stability.',
    price: 9_000, prDelta: 10,
    statDeltas: { handling: 5, braking: 2 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
  {
    id: 'aero_diffuser_race', category: 'aero', tier: 'race',
    label: 'Race Full Underbody Diffuser',
    description: 'Flat underbody with a full diffuser exit. Ground-effect aerodynamics at road-car speeds.',
    price: 38_000, prDelta: 22,
    statDeltas: { handling: 10, braking: 5, speed: 1 },
    compatibleClasses: ['A','S1','S2'],
    requires: 'aero_diffuser_sport',
  },
  {
    id: 'aero_widebody', category: 'aero', tier: 'sport',
    label: 'Wide Body Kit',
    description: 'Flared arches and wider sills. Required to run wider tyres. Changes the car\'s silhouette entirely.',
    price: 35_000, prDelta: 12,
    statDeltas: { handling: 3 },
    compatibleClasses: ['C','B','A','S1','S2'],
  },
];

// ── Engine swap catalog ────────────────────────────────────────────────────────
/**
 * Engine swaps available to all compatible cars.
 * Each entry: id, label, description, price, prDelta, statDeltas, powerOutput,
 *             torqueOutput, compatibleClasses, engineType
 */
export const ENGINE_SWAPS = [
  {
    id: 'swap_i4_turbo_300', category: 'engine_swap', tier: 'race',
    label: '2.0L I4 Turbo — 300 hp',
    description: 'A punchy 4-cylinder turbocharged unit from a forgotten compact homologation special. Light, revvy, and surprisingly powerful.',
    price: 150_000, prDelta: 40,
    statDeltas: { speed: 8, acceleration: 12 },
    powerOutput: 300, torqueOutput: 420,
    engineType: 'I4 Turbo',
    compatibleClasses: ['D','C','B'],
  },
  {
    id: 'swap_v6_biturbo_450', category: 'engine_swap', tier: 'race',
    label: '3.0L V6 Biturbo — 450 hp',
    description: 'A razor-sharp twin-turbo V6 that transforms any lightweight chassis into a road-legal race car.',
    price: 250_000, prDelta: 60,
    statDeltas: { speed: 12, acceleration: 16 },
    powerOutput: 450, torqueOutput: 580,
    engineType: 'V6 Biturbo',
    compatibleClasses: ['C','B','A'],
  },
  {
    id: 'swap_v8_na_500', category: 'engine_swap', tier: 'race',
    label: '5.0L V8 NA — 500 hp',
    description: 'A screaming naturally-aspirated V8 that delivers an old-school soundtrack and ferocious mid-range torque.',
    price: 300_000, prDelta: 65,
    statDeltas: { speed: 14, acceleration: 14 },
    powerOutput: 500, torqueOutput: 530,
    engineType: 'V8 NA',
    compatibleClasses: ['C','B','A','S1'],
  },
  {
    id: 'swap_v8_supercharged_650', category: 'engine_swap', tier: 'race',
    label: '6.2L V8 Supercharged — 650 hp',
    description: 'A positively deranged supercharged V8. Not for timid hands or underprepared chassis.',
    price: 400_000, prDelta: 80,
    statDeltas: { speed: 18, acceleration: 20 },
    powerOutput: 650, torqueOutput: 840,
    engineType: 'V8 Supercharged',
    compatibleClasses: ['B','A','S1'],
  },
  {
    id: 'swap_v12_na_800', category: 'engine_swap', tier: 'race',
    label: '6.5L V12 NA — 800 hp',
    description: 'A cathedral of combustion. Fitting a V12 to a compact chassis is reckless, wonderful, and very, very quick.',
    price: 500_000, prDelta: 95,
    statDeltas: { speed: 22, acceleration: 22 },
    powerOutput: 800, torqueOutput: 730,
    engineType: 'V12 NA',
    compatibleClasses: ['A','S1','S2'],
  },
  {
    id: 'swap_electric_quad_1000', category: 'engine_swap', tier: 'race',
    label: 'Quad-Motor Electric — 1,000 hp',
    description: 'An experimental electric drivetrain with four motors and a flat torque curve. Instant, relentless, silent.',
    price: 500_000, prDelta: 100,
    statDeltas: { speed: 20, acceleration: 30 },
    powerOutput: 1000, torqueOutput: 1400,
    engineType: 'Quad-Motor Electric',
    compatibleClasses: ['A','S1','S2'],
  },
];

export const ALL_PARTS = [...PARTS_CATALOG, ...ENGINE_SWAPS];

// ── Per-car installed parts (localStorage) ────────────────────────────────────

function _loadInstalledParts(carId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(_partKey(carId)) || '[]'));
  } catch { return new Set(); }
}

function _saveInstalledParts(carId, set) {
  localStorage.setItem(_partKey(carId), JSON.stringify([...set]));
}

export function getInstalledParts(carId) {
  const ids = _loadInstalledParts(carId);
  return ALL_PARTS.filter(p => ids.has(p.id));
}

export function isPartInstalled(carId, partId) {
  return _loadInstalledParts(carId).has(partId);
}

// ── PR recalculation ───────────────────────────────────────────────────────────

export function calcCurrentPR(carId) {
  const car = getCarById(carId);
  if (!car) return 0;
  const installed = getInstalledParts(carId);
  const bonus = installed.reduce((sum, p) => sum + (p.prDelta || 0), 0);
  return Math.min(car.pr + bonus, 999);
}

// ── Stat preview ───────────────────────────────────────────────────────────────

/**
 * Returns current stats + projected stats after installing a part.
 * @returns {{ current, projected, deltas }}
 */
export function previewPartInstall(carId, partId) {
  const car  = getCarById(carId);
  const part = ALL_PARTS.find(p => p.id === partId);
  if (!car || !part) return null;

  const installedParts = getInstalledParts(carId);
  const current = _accumulateStats(car.stats, installedParts);
  const projected = { ...current };
  const deltas = part.statDeltas || {};

  for (const [stat, delta] of Object.entries(deltas)) {
    projected[stat] = Math.min(100, Math.max(0, (projected[stat] || 0) + delta));
  }

  return { current, projected, deltas };
}

function _accumulateStats(baseStats, parts) {
  const stats = { ...baseStats };
  for (const p of parts) {
    for (const [stat, delta] of Object.entries(p.statDeltas || {})) {
      stats[stat] = Math.min(100, Math.max(0, (stats[stat] || 0) + delta));
    }
  }
  return stats;
}

// ── Purchase & install ────────────────────────────────────────────────────────

/**
 * @returns {{ success, reason?, part?, newPR?, newBalance? }}
 */
export function buyAndInstallPart(carId, partId) {
  const car  = getCarById(carId);
  const part = ALL_PARTS.find(p => p.id === partId);

  if (!car)  return { success: false, reason: 'CAR_NOT_FOUND' };
  if (!part) return { success: false, reason: 'PART_NOT_FOUND' };
  if (isPartInstalled(carId, partId)) return { success: false, reason: 'ALREADY_INSTALLED' };
  if (!canAfford(part.price)) return { success: false, reason: 'INSUFFICIENT_CREDITS' };

  // Check class compatibility
  if (part.compatibleClasses !== 'all' && !part.compatibleClasses.includes(car.class)) {
    return { success: false, reason: 'INCOMPATIBLE_CLASS' };
  }

  // Check prerequisite
  if (part.requires && !isPartInstalled(carId, part.requires)) {
    return { success: false, reason: 'REQUIRES_PREREQUISITE', prerequisite: part.requires };
  }

  const spendResult = spend(part.price, 'PART_PURCHASE', `${car.name}: ${part.label}`);
  if (!spendResult.success) return { success: false, reason: 'SPEND_FAILED' };

  const installed = _loadInstalledParts(carId);
  installed.add(partId);
  _saveInstalledParts(carId, installed);

  return {
    success:    true,
    part,
    newPR:      calcCurrentPR(carId),
    newBalance: spendResult.balance,
  };
}

// ── Tune presets ───────────────────────────────────────────────────────────────

const MAX_PRESETS = 5;

/**
 * Tune preset structure:
 * { id, name, carId, createdAt, values: { ... } }
 */

function _loadTunes(carId) {
  try {
    return JSON.parse(localStorage.getItem(_tuneKey(carId)) || '[]');
  } catch { return []; }
}

function _saveTunes(carId, tunes) {
  localStorage.setItem(_tuneKey(carId), JSON.stringify(tunes));
}

export function getTunePresets(carId) {
  return _loadTunes(carId);
}

/**
 * Save a tune preset for a car (free — no credit cost).
 * @param {string} carId
 * @param {string} name
 * @param {object} values  — tune slider values
 * @returns {{ success, preset?, reason? }}
 */
export function saveTunePreset(carId, name, values) {
  const tunes = _loadTunes(carId);
  if (tunes.length >= MAX_PRESETS) {
    return { success: false, reason: 'MAX_PRESETS_REACHED' };
  }

  const preset = {
    id:        `tune_${Date.now()}`,
    name:      name.trim().slice(0, 32),
    carId,
    createdAt: Date.now(),
    values,
  };

  tunes.push(preset);
  _saveTunes(carId, tunes);
  return { success: true, preset };
}

export function deleteTunePreset(carId, presetId) {
  const tunes = _loadTunes(carId).filter(t => t.id !== presetId);
  _saveTunes(carId, tunes);
}

export function renameTunePreset(carId, presetId, newName) {
  const tunes = _loadTunes(carId);
  const t = tunes.find(x => x.id === presetId);
  if (t) { t.name = newName.trim().slice(0, 32); _saveTunes(carId, tunes); }
}

// ── Tune slider definitions ────────────────────────────────────────────────────
/**
 * Used by the Tuning Garage UI to render sliders.
 * All values are percentages (0–100) or numeric ranges.
 */
export const TUNE_SLIDERS = [
  {
    id: 'suspension_front_stiffness', category: 'suspension',
    label: 'Front Stiffness', min: 0, max: 100, default: 50,
    description: 'Higher = stiffer front end. Improves precision but reduces bump absorption.',
  },
  {
    id: 'suspension_rear_stiffness', category: 'suspension',
    label: 'Rear Stiffness', min: 0, max: 100, default: 50,
    description: 'Higher = stiffer rear. More oversteer tendency; better high-speed stability.',
  },
  {
    id: 'suspension_ride_height_f', category: 'suspension',
    label: 'Ride Height (Front)', min: 0, max: 100, default: 40,
    description: 'Lower = less body roll, better aero. Too low risks bottoming out on uneven roads.',
  },
  {
    id: 'suspension_ride_height_r', category: 'suspension',
    label: 'Ride Height (Rear)', min: 0, max: 100, default: 40,
    description: 'Balance with front ride height. Rear higher than front adds rake for aerodynamic benefit.',
  },
  {
    id: 'antiroll_front', category: 'suspension',
    label: 'Anti-Roll Bar (Front)', min: 0, max: 100, default: 50,
    description: 'Stiffer = less front roll. Improves turn-in sharpness but can cause understeer.',
  },
  {
    id: 'antiroll_rear', category: 'suspension',
    label: 'Anti-Roll Bar (Rear)', min: 0, max: 100, default: 50,
    description: 'Stiffer rear ARB encourages rotation. Too stiff = snap oversteer.',
  },
  {
    id: 'alignment_camber_f', category: 'alignment',
    label: 'Front Camber', min: -5, max: 2, default: -1.5, step: 0.1, unit: '°',
    description: 'Negative camber improves cornering contact patch. Too much causes uneven tyre wear.',
  },
  {
    id: 'alignment_camber_r', category: 'alignment',
    label: 'Rear Camber', min: -4, max: 1, default: -1.0, step: 0.1, unit: '°',
    description: 'Slight negative rear camber aids cornering stability.',
  },
  {
    id: 'alignment_toe_f', category: 'alignment',
    label: 'Front Toe', min: -2, max: 2, default: 0, step: 0.1, unit: '°',
    description: 'Toe-in (positive) adds stability. Toe-out (negative) sharpens initial turn-in response.',
  },
  {
    id: 'alignment_toe_r', category: 'alignment',
    label: 'Rear Toe', min: -1, max: 2, default: 0.2, step: 0.1, unit: '°',
    description: 'Slight rear toe-in is the typical road car setting for straight-line stability.',
  },
  {
    id: 'brakes_bias', category: 'brakes',
    label: 'Brake Bias (Front %)', min: 40, max: 75, default: 58, step: 1, unit: '%',
    description: 'Higher front bias gives stronger braking. Too high = front lock-up. Too low = rear spin.',
  },
  {
    id: 'brakes_pressure', category: 'brakes',
    label: 'Brake Pressure', min: 50, max: 130, default: 100, step: 1, unit: '%',
    description: 'Increases effective braking force. Lower if you\'re experiencing premature lock-up.',
  },
  {
    id: 'diff_accel_lock', category: 'differential',
    label: 'Diff Accel Locking', min: 0, max: 100, default: 30,
    description: 'On-throttle locking. Higher = more traction, less rotation on exit.',
  },
  {
    id: 'diff_decel_lock', category: 'differential',
    label: 'Diff Decel Locking', min: 0, max: 100, default: 15,
    description: 'Off-throttle locking. Higher = more understeer on trail-brake entry.',
  },
  {
    id: 'awd_front_torque', category: 'awd',
    label: 'AWD Front Torque Split', min: 0, max: 50, default: 30, step: 1, unit: '%',
    description: 'Percentage of torque sent to front wheels. AWD cars only.',
    drivetrainRequired: 'AWD',
  },
  {
    id: 'boost_pressure', category: 'engine',
    label: 'Boost Pressure', min: 0, max: 100, default: 50,
    description: 'Turbo/supercharger boost level. Higher = more power and heat. Requires forged internals at extremes.',
    aspirationType: 'forced',
  },
  {
    id: 'tire_pressure_f', category: 'tires',
    label: 'Tyre Pressure (Front)', min: 20, max: 50, default: 32, step: 0.5, unit: 'psi',
    description: 'Lower pressure increases contact patch but slows response. Higher pressure = sharper feel, less grip.',
  },
  {
    id: 'tire_pressure_r', category: 'tires',
    label: 'Tyre Pressure (Rear)', min: 20, max: 50, default: 30, step: 0.5, unit: 'psi',
    description: 'Rear pressure affects oversteer/understeer balance. Raise for more stability; lower for rotation.',
  },
];

// ── Shop location ──────────────────────────────────────────────────────────────

export const PARTS_SHOP_LOCATION = {
  id:       'industrial_parts',
  label:    'Performance Parts Shop',
  district: 'Industrial District',
  description: 'The one-stop workshop for anything that makes your car faster, sharper, or more powerful. Adjacent to the Tuning Garage.',
};

export const TUNING_GARAGE_LOCATION = {
  id:       'industrial_tuning',
  label:    'Tuning Garage',
  district: 'Industrial District',
  description: 'Fine-tune every aspect of your setup for free. Save up to 5 presets per car.',
};

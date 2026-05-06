/**
 * js/car/carData.js
 * Horizon City — Master Car Roster.
 *
 * 40 cars across D / C / B / A / S1 / S2 classes.
 * All brands and models are fictional to avoid licensing.
 * Each car: id, brand, name, year, class, category, drivetrain,
 *           bodyStyle, pr, price, stats, description, modelFile, thumbnailFile
 *
 * Stats are 0–100 values: speed, handling, acceleration, braking, offroad
 */

/** @type {CarDefinition[]} */
export const CARS = [

  // ── D CLASS ────────────────────────────────────────────────────────────────

  {
    id: 'verano_sprint_st', brand: 'Verano', name: 'Sprint ST', year: 2012,
    class: 'D', category: 'sport', drivetrain: 'FWD', bodyStyle: 'Hatchback',
    pr: 220, price: 20_000,
    stats: { speed: 28, handling: 42, acceleration: 35, braking: 38, offroad: 18 },
    description: 'The little hot hatch that proved you don\'t need a big engine to have a big smile. Nimble, cheerful, and surprisingly hard to shake off a twisty road.',
    modelFile: 'verano_sprint_st.glb', thumbnailFile: 'verano_sprint_st.jpg',
  },
  {
    id: 'aldridge_coupe_mk2', brand: 'Aldridge', name: 'Coupe Mk2', year: 2004,
    class: 'D', category: 'classic', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 195, price: 15_000,
    stats: { speed: 30, handling: 36, acceleration: 30, braking: 33, offroad: 14 },
    description: 'An old-school rear-drive compact coupe from the early 2000s. Lacks modern refinement but rewards drivers who learn its limits.',
    modelFile: 'aldridge_coupe_mk2.glb', thumbnailFile: 'aldridge_coupe_mk2.jpg',
  },
  {
    id: 'karsten_rally_200', brand: 'Karsten', name: 'Rally 200', year: 2009,
    class: 'D', category: 'rally', drivetrain: 'AWD', bodyStyle: 'Estate',
    pr: 250, price: 35_000,
    stats: { speed: 32, handling: 44, acceleration: 38, braking: 36, offroad: 62 },
    description: 'A cult-status AWD estate that made its name on forest stages. Unmatched off-road traction for its class.',
    modelFile: 'karsten_rally_200.glb', thumbnailFile: 'karsten_rally_200.jpg',
  },
  {
    id: 'thornfield_pickup_base', brand: 'Thornfield', name: 'Ranger Base', year: 2015,
    class: 'D', category: 'truck', drivetrain: 'RWD', bodyStyle: 'Pickup Truck',
    pr: 185, price: 18_000,
    stats: { speed: 24, handling: 30, acceleration: 28, braking: 28, offroad: 55 },
    description: 'A workhorse pickup that seems out of place at a racing festival — until you see what it can do on a dirt track.',
    modelFile: 'thornfield_pickup_base.glb', thumbnailFile: 'thornfield_pickup_base.jpg',
  },
  {
    id: 'seiko_kei_rs', brand: 'Seiko', name: 'Kei RS', year: 2018,
    class: 'D', category: 'sport', drivetrain: 'RWD', bodyStyle: 'Kei Car',
    pr: 210, price: 22_000,
    stats: { speed: 26, handling: 46, acceleration: 33, braking: 40, offroad: 12 },
    description: 'A miniature rear-drive sports kei with a turbocharged 660cc engine. Tiny, incredibly light, and embarrassingly fun.',
    modelFile: 'seiko_kei_rs.glb', thumbnailFile: 'seiko_kei_rs.jpg',
  },
  {
    id: 'madrigal_van_350', brand: 'Madrigal', name: 'Cargo 350', year: 2011,
    class: 'D', category: 'van', drivetrain: 'FWD', bodyStyle: 'Van',
    pr: 170, price: 12_000,
    stats: { speed: 22, handling: 28, acceleration: 24, braking: 26, offroad: 30 },
    description: 'It\'s a delivery van. What are you doing? Incredibly, it can be tuned into something genuinely competitive — but it will always look silly doing it.',
    modelFile: 'madrigal_van_350.glb', thumbnailFile: 'madrigal_van_350.jpg',
  },
  {
    id: 'revello_targa_70', brand: 'Revello', name: 'Targa 70', year: 1972,
    class: 'D', category: 'classic', drivetrain: 'RWD', bodyStyle: 'Targa',
    pr: 240, price: 45_000,
    stats: { speed: 33, handling: 38, acceleration: 34, braking: 31, offroad: 10 },
    description: 'A gorgeous 1970s Italian targa with a singing inline-four and absolutely no driver aids. Classic beauty with classic vices.',
    modelFile: 'revello_targa_70.glb', thumbnailFile: 'revello_targa_70.jpg',
  },

  // ── C CLASS ────────────────────────────────────────────────────────────────

  {
    id: 'ashford_heritage_20', brand: 'Ashford', name: 'Heritage 2.0', year: 1986,
    class: 'C', category: 'classic', drivetrain: 'RWD', bodyStyle: 'Saloon',
    pr: 360, price: 80_000,
    stats: { speed: 44, handling: 50, acceleration: 46, braking: 42, offroad: 14 },
    description: 'A legendary 1980s sports saloon with a twin-cam engine and a driver-focused cockpit. Helped redefine what a family car could be.',
    modelFile: 'ashford_heritage_20.glb', thumbnailFile: 'ashford_heritage_20.jpg',
  },
  {
    id: 'delta_turismo_coupe', brand: 'Delta', name: 'Turismo Coupe', year: 2020,
    class: 'C', category: 'sport', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 390, price: 115_000,
    stats: { speed: 50, handling: 54, acceleration: 52, braking: 48, offroad: 12 },
    description: 'A sharp-looking front-engined coupe with a twin-scroll turbo. Accessible performance wrapped in Italian-inspired bodywork.',
    modelFile: 'delta_turismo_coupe.glb', thumbnailFile: 'delta_turismo_coupe.jpg',
  },
  {
    id: 'ironside_muscle_67', brand: 'Ironside', name: 'Storm 427', year: 1967,
    class: 'C', category: 'muscle', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 420, price: 160_000,
    stats: { speed: 52, handling: 38, acceleration: 60, braking: 34, offroad: 16 },
    description: 'A thundering 1960s V8 muscle coupe with more torque than sense. Takes a firm hand but nothing accelerates from a stoplight with quite the same drama.',
    modelFile: 'ironside_muscle_67.glb', thumbnailFile: 'ironside_muscle_67.jpg',
  },
  {
    id: 'nakamoto_sr4', brand: 'Nakamoto', name: 'SR4 Coupe', year: 1996,
    class: 'C', category: 'sport', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 400, price: 130_000,
    stats: { speed: 48, handling: 58, acceleration: 54, braking: 52, offroad: 11 },
    description: 'The 90s JDM coupe that launched a thousand bedroom posters. A high-revving inline-four in a light, perfectly balanced chassis.',
    modelFile: 'nakamoto_sr4.glb', thumbnailFile: 'nakamoto_sr4.jpg',
  },
  {
    id: 'thornfield_desert_pro', brand: 'Thornfield', name: 'Desert Pro', year: 2019,
    class: 'C', category: 'off-road', drivetrain: 'AWD', bodyStyle: 'SUV',
    pr: 375, price: 95_000,
    stats: { speed: 40, handling: 44, acceleration: 48, braking: 40, offroad: 78 },
    description: 'A pre-runner-inspired SUV built for long desert stages. Factory-lifted, wide-tired, and ready for whatever surface the city serves up.',
    modelFile: 'thornfield_desert_pro.glb', thumbnailFile: 'thornfield_desert_pro.jpg',
  },
  {
    id: 'verano_drift_spec', brand: 'Verano', name: 'Drift Spec FD', year: 2014,
    class: 'C', category: 'drift', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 410, price: 145_000,
    stats: { speed: 46, handling: 60, acceleration: 50, braking: 50, offroad: 10 },
    description: 'Pulled straight from a drift event build. Wide body, coilovers, limited-slip diff, and an engine that wants to spin its rear wheels at all times.',
    modelFile: 'verano_drift_spec.glb', thumbnailFile: 'verano_drift_spec.jpg',
  },

  // ── B CLASS ────────────────────────────────────────────────────────────────

  {
    id: 'delta_stretto_r', brand: 'Delta', name: 'Stretto R', year: 2022,
    class: 'B', category: 'sport', drivetrain: 'RWD', bodyStyle: 'Roadster',
    pr: 570, price: 220_000,
    stats: { speed: 64, handling: 70, acceleration: 66, braking: 65, offroad: 10 },
    description: 'An open-top mid-engined roadster that rewards precision and punishes sloppiness. The connection between driver and road is exceptional.',
    modelFile: 'delta_stretto_r.glb', thumbnailFile: 'delta_stretto_r.jpg',
  },
  {
    id: 'ashford_cosworth_r', brand: 'Ashford', name: 'Heritage RS Cosworth', year: 1992,
    class: 'B', category: 'classic', drivetrain: 'AWD', bodyStyle: 'Saloon',
    pr: 610, price: 310_000,
    stats: { speed: 66, handling: 72, acceleration: 72, braking: 64, offroad: 32 },
    description: 'The AWD evolution of the Heritage. Created to win touring car championships and terrorise wet rally stages. An icon.',
    modelFile: 'ashford_cosworth_r.glb', thumbnailFile: 'ashford_cosworth_r.jpg',
  },
  {
    id: 'nakamoto_gtr_v6', brand: 'Nakamoto', name: 'GTR V6 Biturbo', year: 2008,
    class: 'B', category: 'sport', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 640, price: 380_000,
    stats: { speed: 68, handling: 68, acceleration: 74, braking: 66, offroad: 24 },
    description: 'A twin-turbo AWD coupe with a famously sophisticated electronic torque-splitting system. Surgically fast in any condition.',
    modelFile: 'nakamoto_gtr_v6.glb', thumbnailFile: 'nakamoto_gtr_v6.jpg',
  },
  {
    id: 'ironside_pony_302', brand: 'Ironside', name: 'Pony 302', year: 2018,
    class: 'B', category: 'muscle', drivetrain: 'RWD', bodyStyle: 'Fastback',
    pr: 580, price: 240_000,
    stats: { speed: 66, handling: 58, acceleration: 70, braking: 60, offroad: 15 },
    description: 'A modern muscle fastback with a naturally aspirated V8 under a long hood. Thunderous straight-line speed and a chassis that\'s finally shed its pig-iron reputation.',
    modelFile: 'ironside_pony_302.glb', thumbnailFile: 'ironside_pony_302.jpg',
  },
  {
    id: 'karsten_wrc_300', brand: 'Karsten', name: 'WRC 300', year: 2005,
    class: 'B', category: 'rally', drivetrain: 'AWD', bodyStyle: 'Hatchback',
    pr: 620, price: 340_000,
    stats: { speed: 60, handling: 74, acceleration: 68, braking: 66, offroad: 80 },
    description: 'A hatchback-bodied WRC homologation car. Stiff, loud, understeery until the diff bites, then absolutely wild.',
    modelFile: 'karsten_wrc_300.glb', thumbnailFile: 'karsten_wrc_300.jpg',
  },
  {
    id: 'seiko_tsx_turbo', brand: 'Seiko', name: 'TSX Turbo', year: 2016,
    class: 'B', category: 'sport', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 595, price: 265_000,
    stats: { speed: 62, handling: 68, acceleration: 64, braking: 62, offroad: 12 },
    description: 'An understated coupe hiding a punchy turbocharged flat-four. Drives lighter than it looks and holds its value at every corner.',
    modelFile: 'seiko_tsx_turbo.glb', thumbnailFile: 'seiko_tsx_turbo.jpg',
  },

  // ── A CLASS ────────────────────────────────────────────────────────────────

  {
    id: 'revello_supersport_v8', brand: 'Revello', name: 'Supersport V8', year: 2020,
    class: 'A', category: 'supercar', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 750, price: 550_000,
    stats: { speed: 80, handling: 76, acceleration: 78, braking: 75, offroad: 8 },
    description: 'A 4.5-litre naturally aspirated V8 mid-engine supercar with a screaming 8,400 RPM redline. A modern classic in the making.',
    modelFile: 'revello_supersport_v8.glb', thumbnailFile: 'revello_supersport_v8.jpg',
  },
  {
    id: 'delta_turismo_gt3', brand: 'Delta', name: 'Turismo GT3', year: 2021,
    class: 'A', category: 'supercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 780, price: 680_000,
    stats: { speed: 82, handling: 80, acceleration: 80, braking: 78, offroad: 14 },
    description: 'The GT3-spec evolution of the Turismo. Now with a wider track, massive carbon ceramic brakes, and an active aero system.',
    modelFile: 'delta_turismo_gt3.glb', thumbnailFile: 'delta_turismo_gt3.jpg',
  },
  {
    id: 'monarch_apex_gt', brand: 'Monarch', name: 'Apex GT', year: 2017,
    class: 'A', category: 'supercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 760, price: 620_000,
    stats: { speed: 82, handling: 74, acceleration: 82, braking: 76, offroad: 12 },
    description: 'A mid-engined masterpiece built to challenge the best of Europe. Lightweight carbon body, flat-plane V8, and a pushrod suspension setup from motorsport.',
    modelFile: 'monarch_apex_gt.glb', thumbnailFile: 'monarch_apex_gt.jpg',
  },
  {
    id: 'ashford_touring_amg', brand: 'Ashford', name: 'Touring AMG Edition', year: 2023,
    class: 'A', category: 'sport', drivetrain: 'RWD', bodyStyle: 'Saloon',
    pr: 720, price: 500_000,
    stats: { speed: 78, handling: 72, acceleration: 76, braking: 72, offroad: 16 },
    description: 'A hand-built performance saloon with a naturally aspirated straight-six and a manual gearbox. The last of a dying breed.',
    modelFile: 'ashford_touring_amg.glb', thumbnailFile: 'ashford_touring_amg.jpg',
  },
  {
    id: 'nakamoto_supergt', brand: 'Nakamoto', name: 'Super GT-X', year: 2019,
    class: 'A', category: 'supercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 790, price: 720_000,
    stats: { speed: 84, handling: 82, acceleration: 84, braking: 80, offroad: 18 },
    description: 'Nakamoto\'s flagship supercar. Hybrid AWD with torque vectoring on all four corners, an active rear wing, and 600 combined horsepower.',
    modelFile: 'nakamoto_supergt.glb', thumbnailFile: 'nakamoto_supergt.jpg',
  },
  {
    id: 'ironside_cobra_800', brand: 'Ironside', name: 'Cobra 800', year: 1966,
    class: 'A', category: 'classic', drivetrain: 'RWD', bodyStyle: 'Roadster',
    pr: 700, price: 480_000,
    stats: { speed: 76, handling: 58, acceleration: 84, braking: 56, offroad: 8 },
    description: 'A barely-legal 1960s V8 roadster with a chassis that\'s too light for the engine fitted to it. No wings, no aids, no compromise.',
    modelFile: 'ironside_cobra_800.glb', thumbnailFile: 'ironside_cobra_800.jpg',
  },

  // ── S1 CLASS ───────────────────────────────────────────────────────────────

  {
    id: 'kurai_typhoon_v10', brand: 'Kurai', name: 'Typhoon V10', year: 2022,
    class: 'S1', category: 'hypercar', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 880, price: 1_400_000,
    stats: { speed: 92, handling: 84, acceleration: 88, braking: 85, offroad: 6 },
    description: 'A naturally aspirated V10 mid-engine hypercar that revs to 9,000 RPM and sounds like the end of the world. The engine is the main event.',
    modelFile: 'kurai_typhoon_v10.glb', thumbnailFile: 'kurai_typhoon_v10.jpg',
  },
  {
    id: 'monarch_storm_turbo', brand: 'Monarch', name: 'Storm 1000TT', year: 2023,
    class: 'S1', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 910, price: 2_200_000,
    stats: { speed: 94, handling: 86, acceleration: 92, braking: 88, offroad: 10 },
    description: 'Twin-turbocharged all-wheel drive. 1,000 bhp. 2.6 seconds to 100 km/h. Every surface its equal.',
    modelFile: 'monarch_storm_turbo.glb', thumbnailFile: 'monarch_storm_turbo.jpg',
  },
  {
    id: 'delta_corsa_rs', brand: 'Delta', name: 'Corsa RS', year: 2021,
    class: 'S1', category: 'supercar', drivetrain: 'AWD', bodyStyle: 'Spider',
    pr: 860, price: 1_100_000,
    stats: { speed: 90, handling: 88, acceleration: 86, braking: 84, offroad: 8 },
    description: 'An open-roof spider with a V8 biturbo and active aerodynamics. Violent straight-line performance matched by a chassis refined at Nürburgring.',
    modelFile: 'delta_corsa_rs.glb', thumbnailFile: 'delta_corsa_rs.jpg',
  },
  {
    id: 'seiko_electra_s', brand: 'Seiko', name: 'Electra S EV', year: 2024,
    class: 'S1', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 895, price: 1_800_000,
    stats: { speed: 90, handling: 82, acceleration: 96, braking: 86, offroad: 14 },
    description: 'A tri-motor electric hypercar with 1,400 Nm of instant torque. Devastatingly fast off the line, with regenerative braking that charges through corners.',
    modelFile: 'seiko_electra_s.glb', thumbnailFile: 'seiko_electra_s.jpg',
  },
  {
    id: 'karsten_pikes_special', brand: 'Karsten', name: 'Pikes Special', year: 2018,
    class: 'S1', category: 'rally', drivetrain: 'AWD', bodyStyle: 'Open Wheel',
    pr: 875, price: 1_500_000,
    stats: { speed: 88, handling: 90, acceleration: 88, braking: 88, offroad: 72 },
    description: 'A purpose-built hillclimb special with a 900 bhp hybrid system and a downforce figure that would embarrass most Le Mans prototypes.',
    modelFile: 'karsten_pikes_special.glb', thumbnailFile: 'karsten_pikes_special.jpg',
  },

  // ── S2 CLASS ───────────────────────────────────────────────────────────────

  {
    id: 'kurai_absoluto', brand: 'Kurai', name: 'Absoluto Finale', year: 2023,
    class: 'S2', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 970, price: 5_000_000,
    stats: { speed: 98, handling: 92, acceleration: 96, braking: 94, offroad: 8 },
    description: 'The culmination of Kurai\'s hypercar program. A 1,500 bhp hybrid V12 with active ground-effect aerodynamics and a seven-figure price tag.',
    modelFile: 'kurai_absoluto.glb', thumbnailFile: 'kurai_absoluto.jpg',
  },
  {
    id: 'monarch_ultravector', brand: 'Monarch', name: 'Ultra Vector X', year: 2024,
    class: 'S2', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 990, price: 7_500_000,
    stats: { speed: 99, handling: 94, acceleration: 98, braking: 96, offroad: 10 },
    description: 'The fastest car in Horizon City. 1,800 hp. Active suspension. Full ground effect. Built by a small British team with absolutely no regard for convention.',
    modelFile: 'monarch_ultravector.glb', thumbnailFile: 'monarch_ultravector.jpg',
  },
  {
    id: 'revello_xx_program', brand: 'Revello', name: 'XX Program', year: 2022,
    class: 'S2', category: 'hypercar', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 955, price: 4_200_000,
    stats: { speed: 96, handling: 90, acceleration: 92, braking: 92, offroad: 6 },
    description: 'A limited track-only hypercar that has been street-registered for Horizon City. V12, rear-drive, 1,100 bhp. Intended for experts only.',
    modelFile: 'revello_xx_program.glb', thumbnailFile: 'revello_xx_program.jpg',
  },
  {
    id: 'nakamoto_arrowhead', brand: 'Nakamoto', name: 'Arrowhead R', year: 2023,
    class: 'S2', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 962, price: 4_800_000,
    stats: { speed: 97, handling: 93, acceleration: 94, braking: 93, offroad: 12 },
    description: 'Japan\'s answer to the European hypercar formula. A quad-motor electric/combustion hybrid with torque vectoring precision that borders on telepathic.',
    modelFile: 'nakamoto_arrowhead.glb', thumbnailFile: 'nakamoto_arrowhead.jpg',
  },
  {
    id: 'delta_corsa_xx_lm', brand: 'Delta', name: 'Corsa XX LM', year: 2019,
    class: 'S2', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Coupe',
    pr: 945, price: 3_500_000,
    stats: { speed: 95, handling: 88, acceleration: 90, braking: 90, offroad: 9 },
    description: 'A Le Mans prototype that\'s been given number plates and sent to the city. Street legal by the absolute minimum margin. Wings, splitters, and slicks optional.',
    modelFile: 'delta_corsa_xx_lm.glb', thumbnailFile: 'delta_corsa_xx_lm.jpg',
  },
];

// ── Lookup helpers ─────────────────────────────────────────────────────────────

/** @param {string} id */
export function getCarById(id) {
  return CARS.find(c => c.id === id) ?? null;
}

/** @param {string} cls 'D'|'C'|'B'|'A'|'S1'|'S2' */
export function getCarsByClass(cls) {
  return CARS.filter(c => c.class === cls);
}

/** @param {string} brand */
export function getCarsByBrand(brand) {
  return CARS.filter(c => c.brand.toLowerCase() === brand.toLowerCase());
}

/** @param {string} category e.g. 'sport', 'muscle', 'rally' */
export function getCarsByCategory(category) {
  return CARS.filter(c => c.category === category);
}

/** All unique brand names, sorted. */
export function getAllBrands() {
  return [...new Set(CARS.map(c => c.brand))].sort();
}

/** All unique categories. */
export function getAllCategories() {
  return [...new Set(CARS.map(c => c.category))].sort();
}

/** All unique drivetrain types. */
export function getAllDrivetrains() {
  return [...new Set(CARS.map(c => c.drivetrain))

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPANSION PACK — FH5 Mexico Recreation additions
  // 20 new cars: offroad/truck, classic muscle, hypercars, buggies
  // ═══════════════════════════════════════════════════════════════════════════

  // ── OFFROAD / BAJA TRUCKS (D/C class) ─────────────────────────────────────

  {
    id: 'thornfield_baja_racer', brand: 'Thornfield', name: 'Baja Racer Pro', year: 2019,
    class: 'C', category: 'truck', drivetrain: 'RWD', bodyStyle: 'Baja Truck',
    pr: 420, price: 65_000,
    stats: { speed: 46, handling: 52, acceleration: 55, braking: 48, offroad: 90 },
    description: 'A purpose-built Baja racing truck. Long travel suspension, enormous tyres, and a supercharged V8 that loves dirt more than tarmac.',
    modelFile: 'thornfield_baja_racer.glb', thumbnailFile: 'thornfield_baja_racer.jpg',
  },
  {
    id: 'sandstorm_buggy_rs', brand: 'Sandstorm', name: 'Desert Buggy RS', year: 2021,
    class: 'C', category: 'buggy', drivetrain: 'RWD', bodyStyle: 'Buggy',
    pr: 395, price: 55_000,
    stats: { speed: 48, handling: 58, acceleration: 60, braking: 45, offroad: 88 },
    description: 'An open-wheel desert buggy with motorcycle DNA. Featherlight and planted in deep sand.',
    modelFile: 'sandstorm_buggy_rs.glb', thumbnailFile: 'sandstorm_buggy_rs.jpg',
  },
  {
    id: 'karsten_rally_xt', brand: 'Karsten', name: 'Rally XT', year: 2016,
    class: 'B', category: 'rally', drivetrain: 'AWD', bodyStyle: 'Estate',
    pr: 560, price: 95_000,
    stats: { speed: 55, handling: 68, acceleration: 62, braking: 60, offroad: 78 },
    description: 'A turbocharged AWD estate that dominates every surface. Stage winner in the Dunas Blancas rally series.',
    modelFile: 'karsten_rally_xt.glb', thumbnailFile: 'karsten_rally_xt.jpg',
  },
  {
    id: 'conquistador_pickup_v8', brand: 'Conquistador', name: 'Maverick V8', year: 2014,
    class: 'D', category: 'truck', drivetrain: '4WD', bodyStyle: 'Pickup Truck',
    pr: 270, price: 28_000,
    stats: { speed: 35, handling: 38, acceleration: 40, braking: 32, offroad: 72 },
    description: 'A lifted V8 pickup with off-road tyres that\'s equally happy on sand dunes and highway ring roads.',
    modelFile: 'conquistador_pickup_v8.glb', thumbnailFile: 'conquistador_pickup_v8.jpg',
  },
  {
    id: 'duna_crawler_4x4', brand: 'Duna', name: 'Crawler 4×4', year: 2018,
    class: 'D', category: 'offroad', drivetrain: '4WD', bodyStyle: 'SUV',
    pr: 245, price: 32_000,
    stats: { speed: 30, handling: 40, acceleration: 36, braking: 34, offroad: 85 },
    description: 'A slow-moving off-road SUV that can climb anything the Caldera throws at it. Not fast. Unstoppable.',
    modelFile: 'duna_crawler_4x4.glb', thumbnailFile: 'duna_crawler_4x4.jpg',
  },

  // ── CLASSIC MUSCLE (C/B class) ─────────────────────────────────────────────

  {
    id: 'ironhorse_wildcat_427', brand: 'Ironhorse', name: 'Wildcat 427', year: 1969,
    class: 'B', category: 'classic_muscle', drivetrain: 'RWD', bodyStyle: 'Muscle Car',
    pr: 580, price: 120_000,
    stats: { speed: 58, handling: 44, acceleration: 65, braking: 50, offroad: 20 },
    description: 'A fire-breathing 1969 muscle car with a 427 cubic inch V8. More character than sense. Perfect on the festival airstrip.',
    modelFile: 'ironhorse_wildcat_427.glb', thumbnailFile: 'ironhorse_wildcat_427.jpg',
  },
  {
    id: 'aldridge_stallion_ss', brand: 'Aldridge', name: 'Stallion SS', year: 1970,
    class: 'C', category: 'classic_muscle', drivetrain: 'RWD', bodyStyle: 'Muscle Car',
    pr: 460, price: 75_000,
    stats: { speed: 50, handling: 40, acceleration: 58, braking: 46, offroad: 18 },
    description: 'The original pony car icon from 1970. Oversteers early, forgives late, and sounds like the apocalypse.',
    modelFile: 'aldridge_stallion_ss.glb', thumbnailFile: 'aldridge_stallion_ss.jpg',
  },
  {
    id: 'verano_torino_v8', brand: 'Verano', name: 'Torino V8', year: 1972,
    class: 'C', category: 'classic_muscle', drivetrain: 'RWD', bodyStyle: 'Fastback',
    pr: 440, price: 68_000,
    stats: { speed: 48, handling: 42, acceleration: 55, braking: 44, offroad: 15 },
    description: 'A big-block fastback that makes up for modest handling with sheer, brutish forward thrust.',
    modelFile: 'verano_torino_v8.glb', thumbnailFile: 'verano_torino_v8.jpg',
  },
  {
    id: 'frontier_charger_440', brand: 'Frontier', name: 'Charger 440', year: 1968,
    class: 'B', category: 'classic_muscle', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 590, price: 130_000,
    stats: { speed: 60, handling: 46, acceleration: 68, braking: 52, offroad: 16 },
    description: 'Wide, menacing, and historically significant. This Charger has the signature fastback roofline and a 440 that screams at 6500rpm.',
    modelFile: 'frontier_charger_440.glb', thumbnailFile: 'frontier_charger_440.jpg',
  },
  {
    id: 'meridian_boss_hemi', brand: 'Meridian', name: 'Boss Hemi', year: 1971,
    class: 'B', category: 'classic_muscle', drivetrain: 'RWD', bodyStyle: 'Muscle Car',
    pr: 610, price: 145_000,
    stats: { speed: 62, handling: 48, acceleration: 70, braking: 54, offroad: 18 },
    description: 'The heaviest hitter in classic muscle. A 426 Hemi that has no business being this fast and all the authority in the world.',
    modelFile: 'meridian_boss_hemi.glb', thumbnailFile: 'meridian_boss_hemi.jpg',
  },

  // ── HYPERCARS (S1/S2 class) ────────────────────────────────────────────────

  {
    id: 'voltex_apex_gtr', brand: 'Voltex', name: 'Apex GTR', year: 2023,
    class: 'S1', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Hypercar',
    pr: 870, price: 1_200_000,
    stats: { speed: 88, handling: 90, acceleration: 92, braking: 90, offroad: 20 },
    description: 'A Japanese hypercar of the modern era. Sequential twin-turbo V6 hybrid producing 1,100bhp. Built for the Caldera summit run.',
    modelFile: 'voltex_apex_gtr.glb', thumbnailFile: 'voltex_apex_gtr.jpg',
  },
  {
    id: 'delta_caldera_s', brand: 'Delta', name: 'Caldera S', year: 2022,
    class: 'S2', category: 'hypercar', drivetrain: 'RWD', bodyStyle: 'Hypercar',
    pr: 940, price: 2_800_000,
    stats: { speed: 96, handling: 88, acceleration: 96, braking: 94, offroad: 12 },
    description: 'Named after the volcano it was designed to conquer. A mid-engine V12 track car with 1,350bhp — only 30 made.',
    modelFile: 'delta_caldera_s.glb', thumbnailFile: 'delta_caldera_s.jpg',
  },
  {
    id: 'rexon_phantom_ev', brand: 'Rexon', name: 'Phantom EV', year: 2024,
    class: 'S1', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Hypercar',
    pr: 850, price: 980_000,
    stats: { speed: 90, handling: 86, acceleration: 98, braking: 92, offroad: 22 },
    description: 'A 1,900bhp all-electric hypercar. 0-100kph in 1.7 seconds. The torque delivery is either terrifying or exhilarating depending on your constitution.',
    modelFile: 'rexon_phantom_ev.glb', thumbnailFile: 'rexon_phantom_ev.jpg',
  },
  {
    id: 'stratos_velocity_t', brand: 'Stratos', name: 'Velocity T', year: 2021,
    class: 'S2', category: 'hypercar', drivetrain: 'RWD', bodyStyle: 'Track Car',
    pr: 950, price: 3_200_000,
    stats: { speed: 98, handling: 92, acceleration: 95, braking: 96, offroad: 8 },
    description: 'The fastest production car on the Riviera coastal sprint leaderboard. A naturally aspirated V10 shrieking to 9,200rpm.',
    modelFile: 'stratos_velocity_t.glb', thumbnailFile: 'stratos_velocity_t.jpg',
  },
  {
    id: 'obsidian_mach_x', brand: 'Obsidian', name: 'Mach X', year: 2020,
    class: 'S1', category: 'hypercar', drivetrain: 'AWD', bodyStyle: 'Hypercar',
    pr: 820, price: 850_000,
    stats: { speed: 86, handling: 84, acceleration: 90, braking: 88, offroad: 28 },
    description: 'An American hypercar built to conquer both Baja desert and track. Hybrid V8, carbon everything, surprisingly livable.',
    modelFile: 'obsidian_mach_x.glb', thumbnailFile: 'obsidian_mach_x.jpg',
  },

  // ── BUGGIES / OPEN WHEEL (C class) ─────────────────────────────────────────

  {
    id: 'tropico_buggy_xt', brand: 'Tropico', name: 'Jungle Buggy XT', year: 2017,
    class: 'C', category: 'buggy', drivetrain: 'RWD', bodyStyle: 'Buggy',
    pr: 430, price: 58_000,
    stats: { speed: 50, handling: 65, acceleration: 62, braking: 52, offroad: 82 },
    description: 'Stripped back, wide-arched, and built for the jungle trail. Light enough that it skips over roots and ruts.',
    modelFile: 'tropico_buggy_xt.glb', thumbnailFile: 'tropico_buggy_xt.jpg',
  },
  {
    id: 'caldera_dune_racer', brand: 'Caldera', name: 'Dune Racer 800', year: 2023,
    class: 'B', category: 'buggy', drivetrain: 'RWD', bodyStyle: 'Buggy',
    pr: 550, price: 88_000,
    stats: { speed: 62, handling: 70, acceleration: 72, braking: 60, offroad: 86 },
    description: 'A high-horsepower off-road racer with long-travel suspension. At home going 160kph across the Dunas.',
    modelFile: 'caldera_dune_racer.glb', thumbnailFile: 'caldera_dune_racer.jpg',
  },

  // ── ADDITIONAL ROAD CARS ────────────────────────────────────────────────────

  {
    id: 'verano_grand_turismo', brand: 'Verano', name: 'Grand Turismo', year: 2020,
    class: 'A', category: 'gran_tourer', drivetrain: 'AWD', bodyStyle: 'Grand Tourer',
    pr: 750, price: 320_000,
    stats: { speed: 78, handling: 76, acceleration: 78, braking: 80, offroad: 30 },
    description: 'A long-legged GT that\'s as comfortable crossing a continent as it is on a race circuit. The ideal Riviera car.',
    modelFile: 'verano_grand_turismo.glb', thumbnailFile: 'verano_grand_turismo.jpg',
  },
  {
    id: 'meridian_sprint_rs', brand: 'Meridian', name: 'Sprint RS', year: 2019,
    class: 'A', category: 'sport', drivetrain: 'RWD', bodyStyle: 'Coupe',
    pr: 720, price: 280_000,
    stats: { speed: 76, handling: 84, acceleration: 80, braking: 84, offroad: 22 },
    description: 'A finely tuned rear-drive sports coupe with a naturally aspirated flat-six. The Guanajuato streets were made for this car.',
    modelFile: 'meridian_sprint_rs.glb', thumbnailFile: 'meridian_sprint_rs.jpg',
  },
];
}

/** Minimum price in the catalog. */
export const MIN_PRICE = Math.min(...CARS.map(c => c.price));
/** Maximum price in the catalog. */
export const MAX_PRICE = Math.max(...CARS.map(c => c.price));

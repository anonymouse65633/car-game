/* ============================================================
   Horizon City — js/main.js
   Boot sequence. Imports every system, initialises them in
   dependency order, then starts the game loop.
   This is the only file that touches everything — no other
   file should import from main.js.
   ============================================================ */

import { initFirebase }                          from './firebase/firebase.js';
import { saveManager }                           from './save/SaveManager.js';
import { initRenderer, scene, camera, renderFrame }      from './engine/renderer.js';
import { initPhysics, stepPhysics, world }                    from './engine/physics.js';
import { initInput, inputState }                 from './engine/input.js';
import { audioManager }                          from './engine/audio.js';
import { startLoop, onTick, LOOP_PHASE }         from './engine/loop.js';
import { initCity }                              from './world/city.js';
import { initEnvironment }                       from './world/environment.js';
import { initBuildings }                         from './world/buildings.js';
import { initPOI }                               from './world/poi.js';
import { initNPCs, tickNPCs }                    from './world/npc.js';
import { CARS }                                  from './car/carData.js';
import { createCar }                             from './car/car.js';
import { DrivingController }                     from './car/driving.js';
import { shopManager }                           from './shops/shopManager.js';
import { NotificationSystem }                    from './ui/NotificationSystem.js';
import { HUDManager }                            from './ui/HUDManager.js';
import { PhoneMenu }                             from './ui/PhoneMenu.js';
import { createFullscreenMap }                   from './ui/Map.js';
import { ProgressionManager }                    from './progression/ProgressionManager.js';
import { AccoladeManager }                       from './progression/AccoladeManager.js';
import { CarMasteryManager }                     from './progression/CarMasteryManager.js';
import { BarnFindManager }                       from './progression/BarnFindManager.js';
import { DailyRewardManager }                    from './progression/DailyRewardManager.js';
import { FestivalPlaylistManager }               from './progression/FestivalPlaylistManager.js';
import { RaceManager }                           from './race/RaceManager.js';

// ─── Boot sequence ───────────────────────────────────────────

async function boot() {
  // ----------------------------------------------------------
  // Step 1 — Firebase
  // Resolves auth state; if the user is already signed in,
  // pulls the cloud save and imports it before anything else.
  // ----------------------------------------------------------
  await initFirebase();

  // ----------------------------------------------------------
  // Step 2 — Local save
  // Cloud save (if any) was already imported by initFirebase's
  // onAuthStateChanged bridge, so a plain load is enough here.
  // ----------------------------------------------------------
  saveManager.load();

  // ----------------------------------------------------------
  // Step 3 — Renderer
  // Attaches Three.js to #game-canvas. Must happen before any
  // Three.js scenes or meshes are created.
  // ----------------------------------------------------------
  initRenderer();

  // ----------------------------------------------------------
  // Step 4 — Physics
  // Rapier WASM init is async — must await before creating
  // any physics bodies.
  // ----------------------------------------------------------
  await initPhysics();

  // ----------------------------------------------------------
  // Step 5 — Input
  // Sets up keyboard and gamepad listeners.
  // ----------------------------------------------------------
  initInput();

  // ----------------------------------------------------------
  // Step 6 — Audio
  // Howler context setup. Some browsers block autoplay until
  // a user gesture; we attempt init immediately and retry on
  // the first interaction if the context is suspended.
  // ----------------------------------------------------------
  try {
    audioManager.init();
  } catch {
    const resumeAudio = () => {
      audioManager.init();
      window.removeEventListener('click',   resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
    };
    window.addEventListener('click',   resumeAudio, { once: true });
    window.addEventListener('keydown', resumeAudio, { once: true });
  }

  // ----------------------------------------------------------
  // Step 7 — World layer
  // Build the city geometry, environment, buildings, points of
  // interest, and NPC traffic. Order matters — city first.
  // ----------------------------------------------------------
  await initCity(scene);
  initEnvironment(camera);
  await initBuildings(scene, world);
  initPOI(scene, world, saveManager);
  initNPCs(scene, world);

  // ----------------------------------------------------------
  // Step 8 — Progression & economy singletons
  // ----------------------------------------------------------
  const notificationSystem = new NotificationSystem();

  const progressionManager = new ProgressionManager(saveManager, notificationSystem);

  shopManager.init(saveManager);   // wires all shop singletons

  // ----------------------------------------------------------
  // Step 9 — Player car
  // Load from save; fall back to the first car in carData.
  // ----------------------------------------------------------
  const playerCarDef = saveManager.get('player', 'activeCar') ?? CARS[0];
  const playerCar    = await createCar(playerCarDef, { scene, world, isPlayer: true });

  // ----------------------------------------------------------
  // Step 10 — Driving controller
  // ----------------------------------------------------------
  const drivingController = new DrivingController(playerCar, inputState);

  // ----------------------------------------------------------
  // Step 11 — Accolade & mastery managers
  // Both depend on progressionManager being ready.
  // ----------------------------------------------------------
  const accoladeManager = new AccoladeManager({ saveManager, progressionManager, notificationSystem });
  const carMasteryManager  = new CarMasteryManager(saveManager, progressionManager, notificationSystem);

  // ----------------------------------------------------------
  // Step 12 — Remaining managers
  // ----------------------------------------------------------
  const barnFindManager         = new BarnFindManager();
  const dailyRewardManager      = new DailyRewardManager();
  dailyRewardManager.checkOnStartup();

  const festivalPlaylistManager = new FestivalPlaylistManager(saveManager);
  const raceManager             = new RaceManager(
    saveManager,
    progressionManager,
    accoladeManager,
    notificationSystem
  );

  // ----------------------------------------------------------
  // Step 13 — HUD layer
  // Mount the persistent HUD, phone menu, and fullscreen map.
  // ----------------------------------------------------------
  const hudManager = new HUDManager();
  hudManager.mount(document.getElementById('hc-hud-root'));

  const phoneMenu = new PhoneMenu();
  phoneMenu.mount(document.getElementById('hc-phone-menu'));

  const fullscreenMap = createFullscreenMap({
    container: document.getElementById('hc-map-container')
  });

  // ----------------------------------------------------------
  // Step 14 — Per-frame callbacks
  // Register everything that needs to run every tick.
  // ----------------------------------------------------------
  onTick((dt) => {
    stepPhysics(dt);                        // physics world step
    drivingController.update(dt);           // player input → forces
    playerCar.update(dt);                   // car state update
    barnFindManager.tick(playerCar.position);
    tickNPCs(dt);
    hudManager.update(playerCar.getHUDState());
    renderFrame();                          // Three.js render
  }, LOOP_PHASE.UPDATE);

  // ----------------------------------------------------------
  // Step 15 — Go
  // Hide the loading screen and start the game loop.
  // ----------------------------------------------------------
  document.getElementById('hc-loading-screen').style.display = 'none';
  startLoop();
}

// Kick everything off.
boot().catch((err) => {
  console.error('[Horizon City] Boot failed:', err);
});

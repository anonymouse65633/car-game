/* ============================================================
   Horizon City — js/main.js
   ============================================================ */

import { initFirebase }                                    from './firebase/firebase.js';
import { saveManager }                                     from './save/SaveManager.js';
import { initRenderer, scene, camera, renderer, renderFrame } from './engine/renderer.js';
import { initPhysics, stepPhysics, world }                 from './engine/physics.js';
import { initInput, inputState }                           from './engine/input.js';
import { audioManager }                                    from './engine/audio.js';
import { startLoop, onTick, LOOP_PHASE }                   from './engine/loop.js';
import { initCity }                                        from './world/city.js';
import { initEnvironment }                                 from './world/environment.js';
import { initBuildings }                                   from './world/buildings.js';
import { initPOI }                                         from './world/poi.js';
import { initNPCs, tickNPCs }                              from './world/npc.js';
import { CARS }                                            from './car/carData.js';
import { createCar }                                       from './car/car.js';
import { DrivingController }                               from './car/driving.js';
import { shopManager }                                     from './shops/shopManager.js';
import { initEconomy }                                     from './shops/Economy.js';
import { NotificationSystem }                              from './ui/NotificationSystem.js';
import { HUDManager }                                      from './ui/HUDManager.js';
import { ProgressionManager }                              from './progression/ProgressionManager.js';
import { AccoladeManager }                                 from './progression/AccoladeManager.js';
import { CarMasteryManager }                               from './progression/CarMasteryManager.js';
import { BarnFindManager }                                 from './progression/BarnFindManager.js';
import { DailyRewardManager }                              from './progression/DailyRewardManager.js';
import { FestivalPlaylistManager }                         from './progression/FestivalPlaylistManager.js';

async function boot() {
  await initFirebase();
  saveManager.load();
  initRenderer();
  await initPhysics();
  initInput();

  // Initialise economy (grants intro bonus on first run)
  initEconomy();

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

  await initCity(scene);
  initEnvironment(camera);
  await initBuildings(scene, world);
  initPOI(scene, world, saveManager);
  initNPCs(scene, world);

  const notificationSystem = new NotificationSystem();

  const progressionManager = new ProgressionManager(saveManager, notificationSystem);

  shopManager.init(saveManager);

  const playerCarDef = saveManager.get('player', 'activeCar') ?? CARS[0];
  const playerCar    = await createCar(playerCarDef, { scene, world, isPlayer: true });

  const drivingController = new DrivingController(playerCar, inputState);

  const accoladeManager   = new AccoladeManager({ saveManager, progressionManager, notificationSystem });
  const carMasteryManager = new CarMasteryManager({ saveManager, progressionManager, accoladeManager, notificationSystem });

  // BarnFindManager now receives all its dependencies via injection
  const barnFindManager = new BarnFindManager({
    saveManager,
    progressionManager,
    accoladeManager,
    notificationSystem,
  });

  const dailyRewardManager = new DailyRewardManager({ progressionManager, notificationSystem });
  dailyRewardManager.checkOnStartup();

  const festivalPlaylistManager = new FestivalPlaylistManager({ saveManager, progressionManager, accoladeManager, notificationSystem });

  // NOTE: RaceManager is created per-race, not at boot.

  // HUDManager needs the Three.js canvas — pass it via the options object.
  // init() is async and builds the full DOM overlay + child modules.
  const hudManager = new HUDManager({
    canvas:       renderer.domElement,
    saveManager,
    onPauseGame:  () => { /* pause physics / input if needed */ },
    onResumeGame: () => { /* resume physics / input if needed */ },
  });
  await hudManager.init();

  onTick((dt) => {
    stepPhysics(dt);
    drivingController.update(dt);
    playerCar.update(dt);
    barnFindManager.tick(playerCar.position);
    tickNPCs(dt);
    hudManager.update(playerCar.getHUDState());
    renderFrame();
  }, LOOP_PHASE.UPDATE);

  document.getElementById('hc-loading-screen').style.display = 'none';
  startLoop();
}

boot().catch((err) => {
  console.error('[Horizon City] Boot failed:', err);
});

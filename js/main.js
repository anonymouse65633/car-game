/* ============================================================
   Horizon City — js/main.js
   ============================================================ */

import { initFirebase }                          from './firebase/firebase.js';
import { saveManager }                           from './save/SaveManager.js';
import { initRenderer, scene, camera, renderFrame }      from './engine/renderer.js';
import { initPhysics, stepPhysics, world }       from './engine/physics.js';
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

async function boot() {
  await initFirebase();
  saveManager.load();
  initRenderer();
  await initPhysics();
  initInput();

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

  const barnFindManager    = new BarnFindManager();
  const dailyRewardManager = new DailyRewardManager();
  dailyRewardManager.checkOnStartup();

  const festivalPlaylistManager = new FestivalPlaylistManager({ saveManager, progressionManager, accoladeManager, notificationSystem });

  // NOTE: RaceManager is created per-race, not at boot.

  const hudManager = new HUDManager();
  hudManager.mount(document.getElementById('hc-hud-root'));

  const phoneMenu = new PhoneMenu();
  phoneMenu.mount(document.getElementById('hc-phone-menu'));

  const fullscreenMap = createFullscreenMap({
    container: document.getElementById('hc-map-container')
  });

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

/* ============================================================
   Horizon City — js/main.js
   ============================================================ */

import { initFirebase }                                    from './firebase/firebase.js';
import { saveManager }                                     from './save/SaveManager.js';
import { initRenderer, scene, camera, renderer, renderFrame, hookPostFX } from './engine/renderer.js';
import { initPhysics, stepPhysics, world }                 from './engine/physics.js';
import { initInput, inputState }                           from './engine/input.js';
import { audioManager }                                    from './engine/audio.js';
import { startLoop, onTick, LOOP_PHASE }                   from './engine/loop.js';
import { initCity }                                        from './world/city.js';
import { initEnvironment, connectSkySystem, isNight, getHour, getWeather } from './world/environment.js';
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
import { getTerrainHeight, getBiome }                      from './world/terrain.js';
import * as THREE                                          from 'three';

// Part 4 — SkySystem
import { initSkySystem, updateSky, updateStars, ensureStars } from './world/SkySystem.js';

// Part 5 — PostFX
import {
  initPostFX, renderPostFX, resizePostFX,
  updatePostFX, applyPostSettings, getComposer,
} from './engine/PostFX.js';

// Part 18 — Lens Effects: dirt, heat haze, speed lines, headlight flare, grain, vignette
import { initLensEffects, updateLensEffects, disposeLensEffects } from './engine/LensEffects.js';

// Part 6 — CSM + God Rays
import {
  initCSM, updateCSM, setupMaterialForCSM,
  spawnStreetLamps, spawnLavaGlow,
  updateLavaGlow, finaliseLampIntensities,
  createCarHeadlights, updateHeadlights,
} from './engine/CSMSystem.js';
import { initLightShafts, updateLightShafts } from './world/LightShafts.js';
import { getSunDirection }                    from './world/SkySystem.js';
import {
  initParticleFX, updateParticleFX, setParticleQuality,
} from './fx/ParticleFX.js';
import {
  initWaterFX, updateWaterFX,
} from './fx/WaterFX.js';
import {
  initSmokeFX, updateSmokeFX,
} from './fx/SmokeFX.js';
// Part 11 — Anisotropic filtering
import {
  initAnisotropy, applyAnisoToScene, setAnisoLevel,
} from './fx/AnisoFX.js';
// Part 12 — Surface Audio
import {
  initSurfaceAudio, updateSurfaceAudio, stopSurfaceAudio,
} from './audio/SurfaceAudio.js';
// Part 13 — Camera Shake & G-Force Feedback
import {
  initCameraFX, updateCameraFX, setCameraFXEnabled,
} from './engine/CameraFX.js';

// Part 14 — Road Network splines, kerbs, markings, getRoadSurface
import {
  initRoadNetwork, updateRoadMarkings, getRoadSurface, getRoadY, getRoadSplines,
} from './world/RoadNetwork.js';

// Part 15 — Vegetation: wind-animated instanced trees, grass LOD
import {
  initVegetation, updateVegetation, disposeVegetation,
} from './world/Vegetation.js';

// Part 16 — Water System: ocean, lakes, rivers, foam, bow waves, underwater
import {
  initWaterSystem, updateWaterSystem, getWaterDragFactor, isInWater,
} from './world/WaterSystem.js';

// Part 17 — Day/Night Cycle: moon, street lights, NPC headlight SpotLights, lens flare
import {
  initDayNight, updateDayNight, getMoonLight,
  getStreetLightPositions, isStreetLightsActive,
} from './world/DayNightSystem.js';

// Part 7 — PBR Car Paint
import {
  initCarPaintSystem, updateCarReflection,
  updateBrakeThermal, applyReflectionPreset,
} from './car/CarPaintSystem.js';

async function boot() {
  await initFirebase();
  saveManager.load();
  initRenderer();
  initAnisotropy(renderer);   // Part 11 — read hardware max aniso immediately
  await initPhysics();
  initInput();

  // Part 4 — HDR sky dome (must be after initRenderer, before first frame)
  initSkySystem(scene, renderer, camera);

  // Part 5 — Full post-processing stack (replaces legacy bloom+FXAA)
  initPostFX(renderer, scene, camera);
  hookPostFX(renderPostFX, resizePostFX);

  // Part 11 / Preset — apply saved graphics preset (defaults to 'low' for
  // compatibility; player can raise it in Settings → Graphics).
  const _savedPreset = (() => {
    try { return localStorage.getItem('graphicsPreset') ?? 'low'; } catch (_) { return 'low'; }
  })();
  applyPostSettings(_savedPreset);

  // Part 18 — Lens effects: splice into composer after PostFX is built
  initLensEffects(getComposer(), renderer.domElement);

  // Anisotropy follows the saved preset (low=1, medium=4, high=8, ultra/extreme=16)
  const _anisoMap = { low: 1, medium: 4, high: 8, ultra: 16, extreme: 16 };
  setAnisoLevel(_anisoMap[_savedPreset] ?? 1);

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

  // Part 12 — Surface audio: preloads tarmac loop + ping transient
  initSurfaceAudio().catch(err => console.warn('[SurfaceAudio] init error:', err));

  // Part 7 — PBR Car Paint (must be after initRenderer so WebGL is ready)
  initCarPaintSystem(scene, renderer);
  applyReflectionPreset('ultra');

  // Part 6 — Cascaded Shadow Maps (init before city geometry so materials get registered)
  await initCSM(scene, camera, renderer);

  await initCity(scene);
  initEnvironment(camera);
  connectSkySystem(updateSky, updateStars, ensureStars);  // Part 4 wire-up
  await initBuildings(scene, world);

  // Part 11 — Anisotropic filtering: stamp every texture in the fully-built scene.
  // Buildings, terrain chunks, biome ground, road decals — all get 16x aniso in
  // one traverse.  BiomeMaterials already stamps new textures at creation time;
  // this call catches anything created before initAnisotropy() was available.
  applyAnisoToScene(scene);

  // Part 6 — God rays (inserted into the existing PostFX composer)
  initLightShafts(renderer, scene, camera, getComposer());

  // Part 6 — World lights
  const streetLamps = spawnStreetLamps(scene);
  finaliseLampIntensities(streetLamps);
  const lavaGroup   = spawnLavaGlow(scene);
  // Part 14 — Road Network: spline extrusion, kerbs, markings, surface query
  await initRoadNetwork(scene, getTerrainHeight);

  // Part 15 — Vegetation: biome-placed instanced trees, grass, cacti
  await initVegetation(scene, {
    getTerrainHeight,
    getBiome,
    getRoadSurface,
  });

  // Part 16 — Water System
  await initWaterSystem(scene, renderer, {
    getTerrainHeight,
    getSunDirection: typeof getSunDirection !== 'undefined' ? getSunDirection : undefined,
    getWeather:      typeof getWeather      !== 'undefined' ? getWeather      : undefined,
  });

  initPOI(scene, world, saveManager);
  initNPCs(scene, world, getRoadSplines());

  // Part 17 — Day/Night: moon, street lights, NPC SpotLight headlights, lens flares
  initDayNight(scene, renderer);

  const notificationSystem = new NotificationSystem();

  const progressionManager = new ProgressionManager(saveManager, notificationSystem);

  shopManager.init(saveManager);

  const playerCarDef = saveManager.get('player', 'activeCar') ?? CARS[0];

  // ── Spawn position: Festival Grounds airstrip (FH5 style — game starts at the festival) ──
  // X: -1800 (airstrip centre), Z: 1000 (mid-runway), Y: terrain height + car half-height
  const SPAWN_X = -1800;
  const SPAWN_Z =  1000;
  const SPAWN_Y = 1.5; // ground chunks are flat at y=0 — wire getTerrainHeight once chunk geo uses it
  const playerSpawnPos = new THREE.Vector3(SPAWN_X, SPAWN_Y, SPAWN_Z);

  const playerCar    = await createCar(playerCarDef, { scene, world, isPlayer: true, spawnPos: playerSpawnPos });

  // Part 6 — headlight rig
  const headlights = createCarHeadlights(scene, playerCar.mesh ?? playerCar.group ?? null);

  // Part 8 — Dirt & Dust particle system
  const particleFX = initParticleFX(scene);
  window.__particleFXHandle = particleFX;   // exposed for SettingsMenu applyPreset

  // Part 9 — Water & Mud splash
  const waterFX = initWaterFX(scene, renderer);

  // Part 10 — Tyre smoke, brake sparks & exhaust
  const smokeFX = initSmokeFX(scene, camera);

  const drivingController = new DrivingController(playerCar, inputState);

  // Part 13 — Camera Shake & G-Force Feedback
  initCameraFX(camera, getTerrainHeight);

  const accoladeManager   = new AccoladeManager({ saveManager, progressionManager, notificationSystem });
  const carMasteryManager = new CarMasteryManager({ saveManager, progressionManager, accoladeManager, notificationSystem });

  // BarnFindManager now receives all its dependencies via injection
  const barnFindManager = new BarnFindManager({
    saveManager,
    progressionManager,
    accoladeManager,
    notificationSystem,
  });

  const dailyRewardManager = new DailyRewardManager();
  dailyRewardManager.checkOnStartup();

  const festivalPlaylistManager = new FestivalPlaylistManager({ saveManager, progressionManager, accoladeManager, notificationSystem });

  // NOTE: RaceManager is created per-race, not at boot.

  // HUDManager needs the Three.js canvas — pass it via the options object.
  // init() is async and builds the full DOM overlay + child modules.
  const hudManager = new HUDManager({
    canvas:       renderer.domElement,
    onPauseGame:  () => { /* pause physics / input if needed */ },
    onResumeGame: () => { /* resume physics / input if needed */ },
  });
  await hudManager.init();

  onTick((dt) => {
    stepPhysics(dt);
    // Part 16 — Water drag: slow car when tyres are below water surface
    {
      const carPos = playerCar.position;
      const drag   = typeof getWaterDragFactor !== 'undefined'
        ? getWaterDragFactor(carPos.x, carPos.z, carPos.y)
        : 1.0;
      if (drag > 1.0 && drivingController._throttleSmooth !== undefined) {
        // Bleed velocity — apply drag as velocity multiplier this frame
        if (playerCar.body?.velocity) {
          playerCar.body.velocity.scale(Math.max(0, 1 - (drag - 1) * dt * 3));
        }
      }
    }
    drivingController.update(dt);
    playerCar.update(dt);
    barnFindManager.tick(playerCar.position);
    tickNPCs(dt, playerCar.position);
    hudManager.update(playerCar.getHUDState());

    // Part 6 — CSM, headlights, lava pulse
    updateCSM();
    updateHeadlights(headlights, { isNight: typeof isNight !== 'undefined' ? isNight() : false, speedKmh: playerCar.speedKmh ?? 0 });
    updateLavaGlow(lavaGroup, performance.now() * 0.001);

    // Part 7 — live paint reflections + brake thermal
    updateCarReflection(playerCar.mesh, playerCar.position, frame++);
    updateBrakeThermal(
      playerCar._calliperMats ?? [],
      playerCar.brake   ?? 0,
      playerCar.speedKmh ?? 0,
      dt,
    );

    // Part 8 — dirt & dust particles
    updateParticleFX(particleFX, playerCar, {
      throttle:    drivingController._throttleSmooth ?? 0,
      brake:       playerCar.brake ?? 0,
      surfaceType: drivingController.surfaceType ?? 'tarmac',
    }, dt);

    // Part 9 — water spray, puddle splash, bow wave, mud splats, rain ripples
    updateWaterFX(waterFX, playerCar, {
      throttle:    drivingController._throttleSmooth ?? 0,
      brake:       playerCar.brake ?? 0,
      surfaceType: drivingController.surfaceType ?? 'tarmac',
    }, typeof getWeather !== 'undefined' ? getWeather() : { isRain: false, blend: 0 }, dt);

    // Part 10 — tyre smoke, brake sparks, exhaust puffs, backfire
    updateSmokeFX(smokeFX, playerCar, drivingController, dt);

    // Part 12 — Surface audio: crossfade loops, speed volume, gravel pings
    {
      const weather = typeof getWeather !== 'undefined' ? getWeather() : { isRain: false, blend: 0 };
      updateSurfaceAudio({
        surfaceType: drivingController.surfaceType ?? 'tarmac',
        speedKmh:    playerCar.speedKmh ?? 0,
        steerNorm:   inputState.steer   ?? 0,
        isRain:      weather.isRain     ?? false,
        rainBlend:   weather.blend      ?? 0,
      }, dt);
    }

    // Part 13 — Camera shake & G-force feedback (runs last so camera position
    // from driving.js is already set before we apply the FX layer on top)
    updateCameraFX(camera, playerCar, drivingController, dt);

    // Part 16 — Water System: animate ocean/lakes/rivers, foam, bow waves, underwater fog
    updateWaterSystem(performance.now() * 0.001, camera, playerCar, drivingController);

    // Part 15 — Vegetation wind + grass LOD
    updateVegetation(performance.now() * 0.001, camera);

    // Part 17 — Day/Night: moon arc, street light glow, NPC SpotLights + lens flares
    {
      const _dnHour = typeof getHour !== 'undefined' ? getHour() : 12;
      updateDayNight(_dnHour, camera, window.__npcTrafficPool ?? []);
    }

    // Part 14 — Road markings UV scroll + surface type override from road splines
    {
      const roadSurface = getRoadSurface(playerCar.position.x, playerCar.position.z);
      if (roadSurface && drivingController.surfaceType !== roadSurface) {
        // Road spline overrides terrain-derived surface type when on a paved road
        drivingController.surfaceType = roadSurface;
      }
      updateRoadMarkings(performance.now() * 0.001);
    }

    renderFrame();
  }, LOOP_PHASE.UPDATE);

  // Part 5 — drive speed-reactive post-processing uniforms (LATE phase,
  // after physics so car.speedKmh is already updated for this frame)
  onTick((dt) => {
    const night = typeof isNight !== 'undefined' ? isNight() : false;
    const hour  = typeof getHour !== 'undefined' ? getHour() : 12;

    updatePostFX(dt, {
      speedKph:    playerCar.speedKmh   ?? 0,
      lateralG:    playerCar.lateralG   ?? 0,
      isNight:     night,
    });

    // Part 18 — Lens effects: dirt, haze, grain, vignette, speed lines, flare
    updateLensEffects(dt, {
      speedKph: playerCar.speedKmh ?? 0,
      isNight:  night,
      biome:    typeof getBiome !== 'undefined'
                  ? getBiome(playerCar.position?.x ?? 0, playerCar.position?.z ?? 0)
                  : '',
    });

    // Part 6 — god ray sun shaft update
    const sunDir = getSunDirection ? getSunDirection() : new THREE.Vector3(0.5, 0.8, 0.2);
    updateLightShafts(sunDir, hour, dt);
  }, LOOP_PHASE.LATE);

  document.getElementById('hc-loading-screen').style.display = 'none';

  // Part 7 — frame counter for cube-camera interval
  let frame = 0;

  startLoop();
}

boot().catch((err) => {
  console.error('[Horizon City] Boot failed:', err);
});

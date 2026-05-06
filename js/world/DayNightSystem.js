/**
 * DayNightSystem.js  —  Part 17: Full Day/Night Cycle
 * ─────────────────────────────────────────────────────────────────────────────
 * Enhances the existing environment.js time-of-day system with the lighting
 * elements that make nights feel genuinely alive:
 *
 *   • Moon  — secondary DirectionalLight (0.15 intensity, soft blue cast,
 *             shadow enabled, positioned opposite the sun)
 *   • Street lights — 80 visual poles spread across Guanajuato + Riviera,
 *             driven by 16 actual PointLights (5-pole clusters) to keep GPU
 *             draw calls manageable.  All auto-activate at dusk.
 *   • NPC headlights — pool of 8 SpotLights dynamically assigned to the
 *             closest active NPC cars when night flag is on.
 *   • Lens flare sprites — 2 per NPC car (one per headlight), procedural
 *             CanvasTexture glow, alpha-fades when pointing away from camera.
 *   • updateDayNight(gameHour, camera, npcCars) — single update call
 *             integrates all of the above with the environment.js clock.
 *
 * Exports:
 *   initDayNight(scene, renderer)         — call once after initEnvironment()
 *   updateDayNight(gameHour, camera, npcCars) — call each UPDATE tick
 *   getMoonLight()                        — THREE.DirectionalLight ref
 *   getStreetLightPositions()             — [{x,y,z}] for minimap
 *   getStreetLightCount()                 — number of visual poles
 *   isStreetLightsActive()                — true when lights are on
 *
 * FH5 Settings targeted:
 *   Night Shadows  —  On
 *   Dynamic Lights —  Ultra
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Moon angular offset from the sun (radians). Almost opposite, slightly off. */
const MOON_OFFSET = Math.PI * 0.94;

/** Moon light maximum intensity (when fully overhead). */
const MOON_MAX_INTENSITY = 0.18;

/** Moon light colour — cool silver-blue. */
const MOON_COLOR = 0xb8cce8;

/** Number of PointLight clusters per district. */
const CLUSTERS_PER_DISTRICT = 8;

/** Visual poles per cluster (only 1 real PointLight per cluster). */
const POLES_PER_CLUSTER = 5;

/** Street light PointLight range (metres). */
const STREET_LIGHT_RANGE = 28;

/** Street light maximum intensity at night. */
const STREET_LIGHT_MAX = 2.8;

/** Height of lamp poles (metres). */
const LAMP_POLE_HEIGHT = 6.5;

/** NPC SpotLight pool size. */
const NPC_SPOTLIGHT_POOL = 8;

/** SpotLight cone angle (radians). */
const HEADLIGHT_ANGLE = Math.PI / 9;     // 20°
const HEADLIGHT_PENUMBRA = 0.35;
const HEADLIGHT_DISTANCE = 55;
const HEADLIGHT_INTENSITY = 3.5;

/** How many metres in front of the NPC the headlight target sits. */
const HEADLIGHT_TARGET_DIST = 22;

/** Lens flare sprite sizes. */
const FLARE_SCALE_INNER = 1.6;   // bright core
const FLARE_SCALE_HALO  = 4.0;   // soft glow halo

/** Hours at which lights switch on / off. */
const LIGHTS_ON_HOUR  = 18.5;   // 6:30 PM
const LIGHTS_OFF_HOUR =  6.5;   // 6:30 AM

// ─── Street-light placement data ──────────────────────────────────────────────
// Two districts: Guanajuato (city, hilly) and Riviera (coastal).
// Each entry is the centre of a cluster; poles are scattered around it.

const DISTRICT_CLUSTERS = [
  // ── Guanajuato ────────────────────────────────────────────────────────────
  { x:  1300, z: -1600, color: 0xffe0a0 },   // South approach
  { x:  1700, z: -2000, color: 0xffe8b0 },   // Plaza mayor
  { x:  2000, z: -2300, color: 0xffd880 },   // Market street
  { x:  2200, z: -2600, color: 0xffe090 },   // Upper town
  { x:  1500, z: -2800, color: 0xffd870 },   // Cathedral hill
  { x:  2500, z: -2100, color: 0xffe8a0 },   // East quarter
  { x:  2800, z: -2500, color: 0xffd060 },   // Caldera road
  { x:  1900, z: -1700, color: 0xffe0b0 },   // Entry roundabout

  // ── Riviera ───────────────────────────────────────────────────────────────
  { x:  3800, z:  -600, color: 0xfff0c0 },   // Beachfront promenade
  { x:  4200, z:  -200, color: 0xfff4d0 },   // Marina north
  { x:  4500, z:   100, color: 0xfff2c0 },   // Marina south
  { x:  4000, z: -1000, color: 0xffe8a0 },   // Hill terraces
  { x:  3500, z:  -400, color: 0xfff0b0 },   // Coastal highway
  { x:  3200, z:   200, color: 0xffe890 },   // Festival edge
  { x:  4700, z:  -800, color: 0xfff4c0 },   // Lighthouse road
  { x:  3900, z:  -400, color: 0xffe0a0 },   // Town centre
];

// ─── Module state ──────────────────────────────────────────────────────────────

let _scene          = null;
let _ready          = false;

/** The moon DirectionalLight. */
let _moonLight      = null;
let _moonTarget     = null;

/** Street light data: { light: PointLight, poles: [Mesh], pos: {x,y,z} }[] */
const _clusters     = [];

/** Flat array of {x,y,z} for minimap. */
const _polePosArr   = [];

/** Whether street lights are currently on. */
let _lightsOn       = false;

/** NPC SpotLight pool: { spot, target, flareInner, flareHalo, npcRef }[] */
const _spotPool     = [];

/** Shared lens flare texture (lazy-built). */
let _flareTex       = null;

// ─── Initialisation ────────────────────────────────────────────────────────────

/**
 * Set up moon, street lights, and NPC spotlight pool.
 * @param {THREE.Scene}         scene
 * @param {THREE.WebGLRenderer} renderer  (unused for now, reserved for future RT)
 */
export function initDayNight(scene, renderer) {
  _scene = scene;

  _buildMoon(scene);
  _buildStreetLights(scene);
  _buildNPCSpotlightPool(scene);

  _ready = true;
  console.log(
    `[DayNightSystem] init — ${_clusters.length} light clusters, ` +
    `${_polePosArr.length} poles, ${NPC_SPOTLIGHT_POOL} NPC spotlights`,
  );
}

// ─── Per-frame update ─────────────────────────────────────────────────────────

/**
 * Drive the day/night system each frame.
 *
 * @param {number}        gameHour  — float 0–24 from environment.getHour()
 * @param {THREE.Camera}  camera    — used for lens-flare facing
 * @param {object[]}      npcCars   — active NPC traffic objects with .group
 *                                    (from npc.js _trafficPool filter)
 */
export function updateDayNight(gameHour, camera, npcCars) {
  if (!_ready) return;

  const nightFactor = _nightFactor(gameHour);   // 0 = day, 1 = full night

  _updateMoon(gameHour);
  _updateStreetLights(nightFactor);
  _updateNPCHeadlights(nightFactor, npcCars, camera);
}

// ─── Public getters ───────────────────────────────────────────────────────────

/** Returns the moon DirectionalLight for CSM or SkySystem integration. */
export function getMoonLight()              { return _moonLight; }

/** Flat array of {x,y,z} world positions of every lamp pole (minimap use). */
export function getStreetLightPositions()   { return _polePosArr; }

/** Total number of visual lamp poles in the scene. */
export function getStreetLightCount()       { return _polePosArr.length; }

/** True when street lights are actively illuminated. */
export function isStreetLightsActive()      { return _lightsOn; }

// ─── Moon ─────────────────────────────────────────────────────────────────────

function _buildMoon(scene) {
  _moonLight = new THREE.DirectionalLight(MOON_COLOR, 0);
  _moonLight.name = 'moonLight';
  _moonLight.castShadow = true;

  // Soft, low-resolution moon shadows — visible but not performance-heavy
  const ms = _moonLight.shadow;
  ms.mapSize.set(1024, 1024);
  ms.camera.near   = 10;
  ms.camera.far    = 1200;
  ms.camera.left   = ms.camera.bottom = -400;
  ms.camera.right  = ms.camera.top    =  400;
  ms.radius        = 4;   // PCF soft shadows
  ms.bias          = -0.0008;

  _moonTarget = new THREE.Object3D();
  _moonTarget.position.set(0, 0, 0);
  scene.add(_moonTarget);
  _moonLight.target = _moonTarget;

  scene.add(_moonLight);
}

function _updateMoon(gameHour) {
  if (!_moonLight) return;

  // Moon arc is offset from sun arc by MOON_OFFSET radians
  const sunAngle  = ((gameHour - 6) / 24) * Math.PI * 2;
  const moonAngle = sunAngle + MOON_OFFSET;
  const el        = Math.sin(moonAngle);  // elevation
  const az        = Math.cos(moonAngle);

  _moonLight.position.set(az * 500, el * 500, 100);
  _moonLight.position.normalize().multiplyScalar(500);

  // Intensity: only when above the horizon, gentle ramp
  const aboveHorizon = Math.max(0, el);
  _moonLight.intensity = aboveHorizon * MOON_MAX_INTENSITY;

  // Colour temperature shifts slightly orange at moonrise/set (atmospheric
  // scattering) and back to cool silver overhead
  const risetFactor = Math.max(0, 1 - aboveHorizon * 3); // 1 at horizon, 0 overhead
  _moonLight.color.setRGB(
    0.72 + risetFactor * 0.20,
    0.80 + risetFactor * 0.04,
    0.91 - risetFactor * 0.10,
  );
}

// ─── Street lights ────────────────────────────────────────────────────────────

function _buildStreetLights(scene) {
  // Build procedural lamp geometry once
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, LAMP_POLE_HEIGHT, 6);
  const armGeo  = new THREE.CylinderGeometry(0.05, 0.05, 1.8, 5);
  const headGeo = new THREE.BoxGeometry(0.6, 0.2, 0.4);

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff0b0,
    roughness: 0.4,
    metalness: 0.2,
    emissive: new THREE.Color(0xffe880),
    emissiveIntensity: 0.0,  // toggled at night
  });

  for (const cluster of DISTRICT_CLUSTERS) {
    // One actual PointLight per cluster
    const light = new THREE.PointLight(cluster.color, 0, STREET_LIGHT_RANGE, 2.0);
    light.position.set(cluster.x, LAMP_POLE_HEIGHT + 0.5, cluster.z);
    scene.add(light);

    const poles = [];

    for (let p = 0; p < POLES_PER_CLUSTER; p++) {
      // Scatter poles within ±20 m of cluster centre along a road-like strip
      const angle  = (p / POLES_PER_CLUSTER) * Math.PI * 2;
      const radius = 8 + Math.random() * 12;
      const px     = cluster.x + Math.cos(angle) * radius;
      const pz     = cluster.z + Math.sin(angle) * radius * 0.4; // elongated along x

      // Build lamp assembly
      const group = new THREE.Group();

      const poleMesh = new THREE.Mesh(poleGeo, poleMat);
      poleMesh.position.y = LAMP_POLE_HEIGHT * 0.5;
      poleMesh.castShadow = true;

      // Horizontal arm at top
      const armMesh = new THREE.Mesh(armGeo, poleMat);
      armMesh.rotation.z = Math.PI / 2;
      armMesh.position.set(0.9, LAMP_POLE_HEIGHT, 0);

      // Lamp head
      const headMesh = new THREE.Mesh(headGeo, headMat.clone());
      headMesh.position.set(1.8, LAMP_POLE_HEIGHT - 0.05, 0);

      group.add(poleMesh, armMesh, headMesh);
      group.position.set(px, 0, pz);
      scene.add(group);

      poles.push({ group, headMesh, pos: { x: px, y: LAMP_POLE_HEIGHT, z: pz } });
      _polePosArr.push({ x: px, y: LAMP_POLE_HEIGHT, z: pz });
    }

    _clusters.push({ light, poles, pos: cluster });
  }
}

function _updateStreetLights(nightFactor) {
  const wasOn = _lightsOn;
  _lightsOn   = nightFactor > 0.05;

  for (const cl of _clusters) {
    const targetI = nightFactor * STREET_LIGHT_MAX;

    // Smooth transition to avoid sudden pop
    cl.light.intensity = THREE.MathUtils.lerp(cl.light.intensity, targetI, 0.04);

    // Emissive glow on the lamp head meshes
    for (const pole of cl.poles) {
      const em = pole.headMesh.material;
      em.emissiveIntensity = THREE.MathUtils.lerp(
        em.emissiveIntensity, nightFactor * 2.5, 0.04,
      );
    }
  }
}

// ─── NPC headlight SpotLights + lens flares ───────────────────────────────────

function _buildNPCSpotlightPool(scene) {
  _flareTex = _buildFlareTexture();

  for (let i = 0; i < NPC_SPOTLIGHT_POOL; i++) {
    // Left + right headlight spots (two per slot, shared target)
    const makeSpot = (offsetX) => {
      const spot = new THREE.SpotLight(0xfff8e8, 0, HEADLIGHT_DISTANCE, HEADLIGHT_ANGLE, HEADLIGHT_PENUMBRA, 1.5);
      spot.castShadow = false;  // NPC shadows off for performance
      const tgt = new THREE.Object3D();
      spot.target = tgt;
      scene.add(spot, tgt);
      return { spot, target: tgt };
    };

    const left  = makeSpot(-0.55);
    const right = makeSpot( 0.55);

    // Lens flare sprites: inner bright core
    const mkFlare = (scale) => {
      const mat  = new THREE.SpriteMaterial({
        map: _flareTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(scale, scale, 1);
      scene.add(sprite);
      return sprite;
    };

    _spotPool.push({
      left,
      right,
      flareInnerL: mkFlare(FLARE_SCALE_INNER),
      flareHaloL:  mkFlare(FLARE_SCALE_HALO),
      flareInnerR: mkFlare(FLARE_SCALE_INNER),
      flareHaloR:  mkFlare(FLARE_SCALE_HALO),
      npcRef:      null,
    });
  }
}

/** Build a procedural lens flare texture (256×256, radial gradient). */
function _buildFlareTexture() {
  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx     = canvas.getContext('2d');
  const cx      = SIZE / 2;

  // Multi-stop glow gradient
  const grd = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grd.addColorStop(0.00, 'rgba(255,255,220,1.0)');
  grd.addColorStop(0.08, 'rgba(255,248,200,0.90)');
  grd.addColorStop(0.25, 'rgba(200,220,255,0.55)');
  grd.addColorStop(0.50, 'rgba(150,180,255,0.20)');
  grd.addColorStop(0.80, 'rgba(100,140,255,0.05)');
  grd.addColorStop(1.00, 'rgba(0,0,0,0.0)');

  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Temp vectors to avoid allocations in the hot path
const _v3    = new THREE.Vector3();
const _fwd   = new THREE.Vector3();
const _camDir = new THREE.Vector3();

function _updateNPCHeadlights(nightFactor, npcCars, camera) {
  const on = nightFactor > 0.15;

  if (!on) {
    // Ensure all pool slots are invisible during daytime
    for (const slot of _spotPool) _deactivateSlot(slot);
    return;
  }

  // Sort NPC cars by distance to camera (closest get the real SpotLights)
  if (!npcCars || npcCars.length === 0) {
    for (const slot of _spotPool) _deactivateSlot(slot);
    return;
  }

  const camPos = camera.position;
  const sorted = npcCars
    .filter(c => c.active && c.group)
    .map(c => ({ c, dist: c.group.position.distanceToSquared(camPos) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, NPC_SPOTLIGHT_POOL);

  // Assign pool slots
  for (let i = 0; i < _spotPool.length; i++) {
    const slot = _spotPool[i];
    if (i >= sorted.length) {
      _deactivateSlot(slot);
      continue;
    }

    const npc  = sorted[i].c;
    const gpos = npc.group.position;

    // Forward direction from NPC rotation
    _fwd.set(
      Math.sin(npc.group.rotation.y),
      0,
      Math.cos(npc.group.rotation.y),
    );

    // Left headlight
    _v3.copy(gpos).addScaledVector(_fwd, 0.8);
    _v3.x -= _fwd.z * 0.55;
    _v3.y  = gpos.y + 0.55;
    slot.left.spot.position.copy(_v3);
    slot.left.spot.intensity = HEADLIGHT_INTENSITY * nightFactor;
    slot.left.target.position.copy(_v3).addScaledVector(_fwd, HEADLIGHT_TARGET_DIST);

    // Right headlight
    _v3.copy(gpos).addScaledVector(_fwd, 0.8);
    _v3.x += _fwd.z * 0.55;
    _v3.y  = gpos.y + 0.55;
    slot.right.spot.position.copy(_v3);
    slot.right.spot.intensity = HEADLIGHT_INTENSITY * nightFactor;
    slot.right.target.position.copy(_v3).addScaledVector(_fwd, HEADLIGHT_TARGET_DIST);

    slot.npcRef = npc;

    // ── Lens flare visibility ─────────────────────────────────────────────
    // Facing factor: only show flare when NPC is heading towards camera
    camera.getWorldDirection(_camDir);
    const dot = _fwd.dot(_camDir);  // -1 = oncoming, +1 = driving away

    // Flare is most visible when NPC is coming straight at us
    const flareOpacity = Math.max(0, -dot) * nightFactor;

    // Left flare
    _positionFlare(slot.flareInnerL, slot.left.spot.position, flareOpacity);
    _positionFlare(slot.flareHaloL,  slot.left.spot.position, flareOpacity * 0.65);

    // Right flare
    _positionFlare(slot.flareInnerR, slot.right.spot.position, flareOpacity);
    _positionFlare(slot.flareHaloR,  slot.right.spot.position, flareOpacity * 0.65);
  }
}

function _positionFlare(sprite, pos, opacity) {
  sprite.position.copy(pos);
  sprite.material.opacity = THREE.MathUtils.lerp(sprite.material.opacity, Math.min(1, opacity), 0.12);
  sprite.visible = sprite.material.opacity > 0.01;
}

function _deactivateSlot(slot) {
  slot.left.spot.intensity  = 0;
  slot.right.spot.intensity = 0;
  slot.flareInnerL.visible  = false;
  slot.flareHaloL.visible   = false;
  slot.flareInnerR.visible  = false;
  slot.flareHaloR.visible   = false;
  slot.npcRef               = null;
}

// ─── Night factor ─────────────────────────────────────────────────────────────

/**
 * Returns 0.0 at noon, 1.0 at midnight, with smooth ramps at dusk/dawn.
 * LIGHTS_ON_HOUR and LIGHTS_OFF_HOUR define the transition window.
 */
function _nightFactor(hour) {
  // Wrap hour to [0,24]
  const h = ((hour % 24) + 24) % 24;

  // Daytime band: LIGHTS_OFF_HOUR → LIGHTS_ON_HOUR
  if (h >= LIGHTS_OFF_HOUR && h <= LIGHTS_ON_HOUR) {
    // Smooth ramp at each end (1h transition window)
    const dawn = THREE.MathUtils.smoothstep(h, LIGHTS_OFF_HOUR, LIGHTS_OFF_HOUR + 1.2);
    const dusk = THREE.MathUtils.smoothstep(h, LIGHTS_ON_HOUR  - 1.2, LIGHTS_ON_HOUR);
    // Full day = dawn has faded in but dusk hasn't started
    if (h > LIGHTS_OFF_HOUR + 1.2 && h < LIGHTS_ON_HOUR - 1.2) return 0;
    // Near dawn: transitioning off
    if (h <= LIGHTS_OFF_HOUR + 1.2) return 1.0 - dawn;
    // Near dusk: transitioning on
    return dusk;
  }

  // Nighttime: fully on
  return 1.0;
}

// ─── Dispose ─────────────────────────────────────────────────────────────────

/** Clean up all lights and geometry (called on scene unload). */
export function disposeDayNight() {
  if (_moonLight) {
    _scene.remove(_moonLight);
    _scene.remove(_moonTarget);
  }
  for (const cl of _clusters) {
    _scene.remove(cl.light);
    for (const pole of cl.poles) _scene.remove(pole.group);
  }
  for (const slot of _spotPool) {
    _scene.remove(slot.left.spot, slot.left.target);
    _scene.remove(slot.right.spot, slot.right.target);
    _scene.remove(slot.flareInnerL, slot.flareHaloL);
    _scene.remove(slot.flareInnerR, slot.flareHaloR);
  }
  _flareTex?.dispose();
  _clusters.length  = 0;
  _spotPool.length  = 0;
  _polePosArr.length = 0;
  _ready = false;
}

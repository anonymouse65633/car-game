/**
 * DayNightSystem.js  —  Part 5 Rebuild: Sun Arc + Full Day/Night Cycle
 * ─────────────────────────────────────────────────────────────────────────────
 * Drives the complete lighting environment each frame:
 *
 *   • Sun arc  — directly controls renderer's SUN DirectionalLight:
 *                position, color, intensity across the full 24-hour cycle.
 *                Dawn/dusk warm orange → noon cool white → night off.
 *                Also drives AMBIENT light intensity/color to match sky mood.
 *
 *   • getSunDirection() — exported THREE.Vector3, used by WaterSystem and CSM.
 *
 *   • Moon  — secondary DirectionalLight (0.18 max intensity, silver-blue cast,
 *             shadow enabled, positioned opposite the sun arc).
 *
 *   • Street lights — 16 PointLight clusters (5 visual poles each) across
 *             Guanajuato + Riviera. Auto-activate at LIGHTS_ON_HOUR (18:30).
 *             Smooth fade over ~1h window. Emissive lamp head glow matches.
 *
 *   • NPC headlights — pool of 8 SpotLights assigned to nearest active traffic
 *             cars at night. Lens flare sprites (CanvasTexture, additive) fade
 *             in when NPCs approach camera head-on.
 *
 * Exports:
 *   initDayNight(scene, renderer)              — call once after renderer init
 *   updateDayNight(gameHour, camera, npcCars)  — call every UPDATE tick
 *   getSunDirection()                          — THREE.Vector3 (normalised)
 *   getSunPosition()                           — THREE.Vector3 (world-space)
 *   getMoonLight()                             — THREE.DirectionalLight ref
 *   getStreetLightPositions()                  — [{x,y,z}] for minimap
 *   getStreetLightCount()                      — number of visual poles
 *   isStreetLightsActive()                     — true while lights are on
 *   isNight(hour?)                             — true between 19:00 and 06:00
 */

import * as THREE from 'three';
import { SUN, AMBIENT } from '../engine/renderer.js';

// ─── Sun arc colour keyframes ─────────────────────────────────────────────────
// { h, sun:[r,g,b], amb:[r,g,b], sunI, ambI }  — interpolated between entries
const SUN_KEYS = [
  { h:  0, sun:[0.02,0.03,0.08], amb:[0.03,0.04,0.10], sunI:0.00, ambI:0.04 },
  { h:  4, sun:[0.04,0.04,0.10], amb:[0.04,0.06,0.14], sunI:0.00, ambI:0.05 },
  { h:  5, sun:[0.60,0.20,0.05], amb:[0.20,0.12,0.08], sunI:0.30, ambI:0.12 },
  { h:  6, sun:[0.95,0.50,0.20], amb:[0.50,0.35,0.20], sunI:1.20, ambI:0.28 },
  { h:  7, sun:[1.00,0.75,0.45], amb:[0.70,0.60,0.45], sunI:1.80, ambI:0.40 },
  { h:  9, sun:[1.00,0.92,0.80], amb:[0.80,0.80,0.80], sunI:2.20, ambI:0.55 },
  { h: 12, sun:[1.00,0.98,0.92], amb:[0.85,0.88,0.92], sunI:2.50, ambI:0.62 },
  { h: 15, sun:[1.00,0.95,0.85], amb:[0.82,0.80,0.78], sunI:2.30, ambI:0.58 },
  { h: 17, sun:[1.00,0.80,0.45], amb:[0.70,0.55,0.38], sunI:1.60, ambI:0.42 },
  { h: 18, sun:[0.95,0.55,0.20], amb:[0.45,0.30,0.18], sunI:0.90, ambI:0.28 },
  { h: 19, sun:[0.80,0.35,0.10], amb:[0.25,0.16,0.12], sunI:0.30, ambI:0.14 },
  { h: 20, sun:[0.20,0.10,0.08], amb:[0.08,0.07,0.10], sunI:0.05, ambI:0.06 },
  { h: 21, sun:[0.02,0.03,0.08], amb:[0.03,0.04,0.10], sunI:0.00, ambI:0.04 },
  { h: 24, sun:[0.02,0.03,0.08], amb:[0.03,0.04,0.10], sunI:0.00, ambI:0.04 },
];

const SUN_ORBIT_R        = 800;

// ─── Moon ─────────────────────────────────────────────────────────────────────
const MOON_OFFSET        = Math.PI * 0.94;
const MOON_MAX_INTENSITY = 0.18;
const MOON_COLOR         = 0xb8cce8;

// ─── Street lights ────────────────────────────────────────────────────────────
const POLES_PER_CLUSTER  = 5;
const STREET_LIGHT_RANGE = 28;
const STREET_LIGHT_MAX   = 2.8;
const LAMP_POLE_HEIGHT   = 6.5;
const LIGHTS_ON_HOUR     = 18.5;
const LIGHTS_OFF_HOUR    =  6.5;

// ─── NPC headlights ───────────────────────────────────────────────────────────
const NPC_SPOTLIGHT_POOL    = 8;
const HEADLIGHT_ANGLE       = Math.PI / 9;
const HEADLIGHT_PENUMBRA    = 0.35;
const HEADLIGHT_DISTANCE    = 55;
const HEADLIGHT_INTENSITY   = 3.5;
const HEADLIGHT_TARGET_DIST = 22;
const FLARE_SCALE_INNER     = 1.6;
const FLARE_SCALE_HALO      = 4.0;

// ─── District clusters ────────────────────────────────────────────────────────
const DISTRICT_CLUSTERS = [
  { x:  1300, z: -1600, color: 0xffe0a0 },
  { x:  1700, z: -2000, color: 0xffe8b0 },
  { x:  2000, z: -2300, color: 0xffd880 },
  { x:  2200, z: -2600, color: 0xffe090 },
  { x:  1500, z: -2800, color: 0xffd870 },
  { x:  2500, z: -2100, color: 0xffe8a0 },
  { x:  2800, z: -2500, color: 0xffd060 },
  { x:  1900, z: -1700, color: 0xffe0b0 },
  { x:  3800, z:  -600, color: 0xfff0c0 },
  { x:  4200, z:  -200, color: 0xfff4d0 },
  { x:  4500, z:   100, color: 0xfff2c0 },
  { x:  4000, z: -1000, color: 0xffe8a0 },
  { x:  3500, z:  -400, color: 0xfff0b0 },
  { x:  3200, z:   200, color: 0xffe890 },
  { x:  4700, z:  -800, color: 0xfff4c0 },
  { x:  3900, z:  -400, color: 0xffe0a0 },
];

// ─── Module state ─────────────────────────────────────────────────────────────
let _scene    = null;
let _ready    = false;
let _lastHour = 12;

const _sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
const _sunPos = new THREE.Vector3(200, 400, 150);

let _moonLight  = null;
let _moonTarget = null;

const _clusters   = [];
const _polePosArr = [];
let   _lightsOn   = false;

const _spotPool = [];
let   _flareTex = null;

// Temp vectors — allocated once to avoid GC in the hot path
const _v3     = new THREE.Vector3();
const _fwd    = new THREE.Vector3();
const _camDir = new THREE.Vector3();

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initDayNight(scene, renderer) {
  _scene = scene;
  _buildMoon(scene);
  _buildStreetLights(scene);
  _buildNPCSpotlightPool(scene);
  _ready = true;
  console.log(
    `[DayNightSystem] ready — ${_clusters.length} clusters, ` +
    `${_polePosArr.length} poles, ${NPC_SPOTLIGHT_POOL} NPC spotlights`,
  );
}

// ─── Per-frame ────────────────────────────────────────────────────────────────

export function updateDayNight(gameHour, camera, npcCars) {
  if (!_ready) return;
  const h = ((gameHour % 24) + 24) % 24;
  _lastHour = h;
  _updateSunArc(h);
  _updateMoon(h);
  _updateStreetLights(_nightFactor(h));
  _updateNPCHeadlights(_nightFactor(h), npcCars, camera);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSunDirection()         { return _sunDir; }
export function getSunPosition()          { return _sunPos; }
export function getMoonLight()            { return _moonLight; }
export function getStreetLightPositions() { return _polePosArr; }
export function getStreetLightCount()     { return _polePosArr.length; }
export function isStreetLightsActive()    { return _lightsOn; }
export function isNight(hour)             {
  const h = hour !== undefined ? ((hour % 24) + 24) % 24 : _lastHour;
  return h >= LIGHTS_ON_HOUR || h <= LIGHTS_OFF_HOUR;
}

// ─── Sun arc ──────────────────────────────────────────────────────────────────

function _updateSunArc(h) {
  // Find surrounding keyframes
  let ka = SUN_KEYS[0];
  let kb = SUN_KEYS[SUN_KEYS.length - 1];
  for (let i = 0; i < SUN_KEYS.length - 1; i++) {
    if (h >= SUN_KEYS[i].h && h < SUN_KEYS[i + 1].h) {
      ka = SUN_KEYS[i];
      kb = SUN_KEYS[i + 1];
      break;
    }
  }
  const t = (kb.h === ka.h) ? 0 : (h - ka.h) / (kb.h - ka.h);
  const L = (a, b) => a + (b - a) * t;

  // Sun position on arc — 6am east, 12pm zenith, 6pm west
  const sunAngle = ((h - 6) / 24) * Math.PI * 2;
  const elev     = Math.sin(sunAngle);
  const azim     = Math.cos(sunAngle);

  _sunPos.set(azim * SUN_ORBIT_R, elev * SUN_ORBIT_R, 80 + Math.sin(sunAngle * 0.5) * 60);
  _sunDir.copy(_sunPos).normalize();

  if (SUN) {
    SUN.position.copy(_sunPos);
    SUN.color.setRGB(L(ka.sun[0], kb.sun[0]), L(ka.sun[1], kb.sun[1]), L(ka.sun[2], kb.sun[2]));
    SUN.intensity = L(ka.sunI, kb.sunI);
  }

  if (AMBIENT) {
    AMBIENT.color.setRGB(L(ka.amb[0], kb.amb[0]), L(ka.amb[1], kb.amb[1]), L(ka.amb[2], kb.amb[2]));
    AMBIENT.intensity = L(ka.ambI, kb.ambI);
  }
}

// ─── Moon ─────────────────────────────────────────────────────────────────────

function _buildMoon(scene) {
  _moonLight = new THREE.DirectionalLight(MOON_COLOR, 0);
  _moonLight.name = 'moonLight';
  _moonLight.castShadow = true;
  const ms = _moonLight.shadow;
  ms.mapSize.set(1024, 1024);
  ms.camera.near   = 10;  ms.camera.far    = 1200;
  ms.camera.left   = ms.camera.bottom = -400;
  ms.camera.right  = ms.camera.top    =  400;
  ms.radius = 4;  ms.bias = -0.0008;

  _moonTarget = new THREE.Object3D();
  scene.add(_moonTarget);
  _moonLight.target = _moonTarget;
  scene.add(_moonLight);
}

function _updateMoon(h) {
  if (!_moonLight) return;
  const moonAngle    = ((h - 6) / 24) * Math.PI * 2 + MOON_OFFSET;
  const el           = Math.sin(moonAngle);
  const az           = Math.cos(moonAngle);
  _moonLight.position.set(az * 500, el * 500, 100).normalize().multiplyScalar(500);
  _moonLight.intensity = Math.max(0, el) * MOON_MAX_INTENSITY;
  const rise = Math.max(0, 1 - Math.max(0, el) * 3);
  _moonLight.color.setRGB(0.72 + rise * 0.20, 0.80 + rise * 0.04, 0.91 - rise * 0.10);
}

// ─── Street lights ────────────────────────────────────────────────────────────

function _buildStreetLights(scene) {
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, LAMP_POLE_HEIGHT, 6);
  const armGeo  = new THREE.CylinderGeometry(0.05, 0.05, 1.8, 5);
  const headGeo = new THREE.BoxGeometry(0.6, 0.2, 0.4);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8, metalness: 0.6 });

  for (const cluster of DISTRICT_CLUSTERS) {
    const light = new THREE.PointLight(cluster.color, 0, STREET_LIGHT_RANGE, 2.0);
    light.position.set(cluster.x, LAMP_POLE_HEIGHT + 0.5, cluster.z);
    scene.add(light);

    const poles = [];
    for (let p = 0; p < POLES_PER_CLUSTER; p++) {
      const angle = (p / POLES_PER_CLUSTER) * Math.PI * 2;
      const r     = 8 + Math.random() * 12;
      const px    = cluster.x + Math.cos(angle) * r;
      const pz    = cluster.z + Math.sin(angle) * r * 0.4;

      const headMat  = new THREE.MeshStandardMaterial({
        color: 0xfff0b0, roughness: 0.4, metalness: 0.2,
        emissive: new THREE.Color(0xffe880), emissiveIntensity: 0,
      });
      const group    = new THREE.Group();
      const poleMesh = new THREE.Mesh(poleGeo, poleMat);
      poleMesh.position.y = LAMP_POLE_HEIGHT * 0.5;
      poleMesh.castShadow = true;

      const armMesh = new THREE.Mesh(armGeo, poleMat);
      armMesh.rotation.z = Math.PI / 2;
      armMesh.position.set(0.9, LAMP_POLE_HEIGHT, 0);

      const headMesh = new THREE.Mesh(headGeo, headMat);
      headMesh.position.set(1.8, LAMP_POLE_HEIGHT - 0.05, 0);

      group.add(poleMesh, armMesh, headMesh);
      group.position.set(px, 0, pz);
      scene.add(group);

      poles.push({ group, headMesh });
      _polePosArr.push({ x: px, y: LAMP_POLE_HEIGHT, z: pz });
    }
    _clusters.push({ light, poles });
  }
}

function _updateStreetLights(nightFactor) {
  _lightsOn = nightFactor > 0.05;
  for (const cl of _clusters) {
    cl.light.intensity = THREE.MathUtils.lerp(cl.light.intensity, nightFactor * STREET_LIGHT_MAX, 0.04);
    for (const pole of cl.poles) {
      const em = pole.headMesh.material;
      em.emissiveIntensity = THREE.MathUtils.lerp(em.emissiveIntensity, nightFactor * 2.5, 0.04);
    }
  }
}

// ─── NPC headlights ───────────────────────────────────────────────────────────

function _buildNPCSpotlightPool(scene) {
  _flareTex = _buildFlareTexture();
  for (let i = 0; i < NPC_SPOTLIGHT_POOL; i++) {
    const makeSpot = () => {
      const spot = new THREE.SpotLight(
        0xfff8e8, 0, HEADLIGHT_DISTANCE, HEADLIGHT_ANGLE, HEADLIGHT_PENUMBRA, 1.5,
      );
      spot.castShadow = false;
      const tgt = new THREE.Object3D();
      spot.target = tgt;
      scene.add(spot, tgt);
      return { spot, target: tgt };
    };
    const mkFlare = (scale) => {
      const mat = new THREE.SpriteMaterial({
        map: _flareTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(scale, scale, 1);
      scene.add(s);
      return s;
    };
    _spotPool.push({
      left:        makeSpot(), right:       makeSpot(),
      flareInnerL: mkFlare(FLARE_SCALE_INNER), flareHaloL:  mkFlare(FLARE_SCALE_HALO),
      flareInnerR: mkFlare(FLARE_SCALE_INNER), flareHaloR:  mkFlare(FLARE_SCALE_HALO),
      npcRef: null,
    });
  }
}

function _buildFlareTexture() {
  const SIZE = 256, c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d'), cx = SIZE / 2;
  const grd = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grd.addColorStop(0.00, 'rgba(255,255,220,1.0)');
  grd.addColorStop(0.08, 'rgba(255,248,200,0.90)');
  grd.addColorStop(0.25, 'rgba(200,220,255,0.55)');
  grd.addColorStop(0.50, 'rgba(150,180,255,0.20)');
  grd.addColorStop(0.80, 'rgba(100,140,255,0.05)');
  grd.addColorStop(1.00, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function _updateNPCHeadlights(nightFactor, npcCars, camera) {
  if (nightFactor <= 0.15 || !npcCars?.length) {
    for (const slot of _spotPool) _deactivateSlot(slot);
    return;
  }
  const camPos = camera.position;
  const sorted = npcCars
    .filter(c => c.active && c.group)
    .map(c => ({ c, dist: c.group.position.distanceToSquared(camPos) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, NPC_SPOTLIGHT_POOL);

  camera.getWorldDirection(_camDir);

  for (let i = 0; i < _spotPool.length; i++) {
    const slot = _spotPool[i];
    if (i >= sorted.length) { _deactivateSlot(slot); continue; }

    const npc  = sorted[i].c;
    const gpos = npc.group.position;
    _fwd.set(Math.sin(npc.group.rotation.y), 0, Math.cos(npc.group.rotation.y));

    _v3.copy(gpos).addScaledVector(_fwd, 0.8);
    _v3.x -= _fwd.z * 0.55; _v3.y = gpos.y + 0.55;
    slot.left.spot.position.copy(_v3);
    slot.left.spot.intensity = HEADLIGHT_INTENSITY * nightFactor;
    slot.left.target.position.copy(_v3).addScaledVector(_fwd, HEADLIGHT_TARGET_DIST);

    _v3.copy(gpos).addScaledVector(_fwd, 0.8);
    _v3.x += _fwd.z * 0.55; _v3.y = gpos.y + 0.55;
    slot.right.spot.position.copy(_v3);
    slot.right.spot.intensity = HEADLIGHT_INTENSITY * nightFactor;
    slot.right.target.position.copy(_v3).addScaledVector(_fwd, HEADLIGHT_TARGET_DIST);

    slot.npcRef = npc;

    const flareOpacity = Math.max(0, -_fwd.dot(_camDir)) * nightFactor;
    _positionFlare(slot.flareInnerL, slot.left.spot.position,  flareOpacity);
    _positionFlare(slot.flareHaloL,  slot.left.spot.position,  flareOpacity * 0.65);
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
  slot.left.spot.intensity = slot.right.spot.intensity = 0;
  slot.flareInnerL.visible = slot.flareHaloL.visible = false;
  slot.flareInnerR.visible = slot.flareHaloR.visible = false;
  slot.npcRef = null;
}

// ─── Night factor ─────────────────────────────────────────────────────────────

function _nightFactor(h) {
  if (h >= LIGHTS_OFF_HOUR && h <= LIGHTS_ON_HOUR) {
    if (h > LIGHTS_OFF_HOUR + 1.2 && h < LIGHTS_ON_HOUR - 1.2) return 0;
    const dawn = THREE.MathUtils.smoothstep(h, LIGHTS_OFF_HOUR, LIGHTS_OFF_HOUR + 1.2);
    const dusk = THREE.MathUtils.smoothstep(h, LIGHTS_ON_HOUR - 1.2, LIGHTS_ON_HOUR);
    return h <= LIGHTS_OFF_HOUR + 1.2 ? 1 - dawn : dusk;
  }
  return 1;
}

// ─── Dispose ──────────────────────────────────────────────────────────────────

export function disposeDayNight() {
  if (_moonLight) { _scene.remove(_moonLight, _moonTarget); }
  for (const cl of _clusters) {
    _scene.remove(cl.light);
    for (const p of cl.poles) _scene.remove(p.group);
  }
  for (const slot of _spotPool) {
    _scene.remove(slot.left.spot, slot.left.target, slot.right.spot, slot.right.target);
    _scene.remove(slot.flareInnerL, slot.flareHaloL, slot.flareInnerR, slot.flareHaloR);
  }
  _flareTex?.dispose();
  _clusters.length = _spotPool.length = _polePosArr.length = 0;
  _ready = false;
}

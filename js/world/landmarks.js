/**
 * landmarks.js — FH5 Mexico Landmark Geometry
 * ─────────────────────────────────────────────────────────────────────────────
 * Procedural geometry for the most recognisable FH5 landmarks:
 *  - Gran Caldera volcano cone (visible from the entire map)
 *  - Dunas Blancas sand dunes (white hemisphere grid)
 *  - Horizon Festival airstrip (1200m tarmac strip with centre lines)
 *  - Mayan temple ruins in La Selva (stepped pyramid stacks)
 *  - Sierra Verde Dam (concrete span across river gorge)
 *  - Guanajuato tunnel (the most recognisable FH5 road feature)
 *
 * Call initLandmarks(scene) once after initCity().
 */

import * as THREE from 'three';

// ─── Material pool ────────────────────────────────────────────────────────────
const _mats = new Map();
function _mat(hex, roughness = 0.85, metalness = 0.0) {
  const key = `${hex}_${roughness}`;
  if (_mats.has(key)) return _mats.get(key);
  const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) });
  _mats.set(key, m);
  return m;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Add all FH5 Mexico landmarks to the scene.
 * @param {THREE.Scene} scene
 */
export function initLandmarks(scene) {
  _buildVolcano(scene);
  _buildDunas(scene);
  _buildAirstrip(scene);
  _buildMayanTemples(scene);
  _buildDam(scene);
  _buildGuanajuatoTunnel(scene);
  console.log('[landmarks] ✅ FH5 Mexico landmarks built');
}

// ─── Gran Caldera Volcano ─────────────────────────────────────────────────────
// The most recognisable FH5 landmark — visible from anywhere on the map.
// ConeGeometry (600 base radius, 800m tall) positioned at NW quadrant.

function _buildVolcano(scene) {
  // Main dark cone body
  const coneGeo = new THREE.ConeGeometry(600, 800, 16, 1);
  const coneMat = _mat('#1a1a1a'); // near-black volcanic rock
  const cone    = new THREE.Mesh(coneGeo, coneMat);
  cone.name     = 'volcano_cone';
  cone.position.set(-3500, 400, -4000); // centre at caldera coords, base at Y=0
  cone.castShadow    = true;
  cone.receiveShadow = true;
  scene.add(cone);

  // Orange glow crater rim at the top
  const craterGeo = new THREE.CylinderGeometry(40, 80, 30, 12);
  const craterMat = new THREE.MeshLambertMaterial({ color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 0.6 });
  const crater    = new THREE.Mesh(craterGeo, craterMat);
  crater.name     = 'volcano_crater';
  crater.position.set(-3500, 804, -4000);
  scene.add(crater);

  // Lava glow light — point light at the crater
  const lavaLight = new THREE.PointLight(0xff4400, 6.0, 800);
  lavaLight.position.set(-3500, 820, -4000);
  scene.add(lavaLight);

  // Secondary caldera rim ridges (smaller cones around the main peak)
  const rimOffsets = [
    { dx: 180,  dz: -90,  h: 520, r: 280 },
    { dx: -150, dz: 200,  h: 480, r: 260 },
    { dx: 220,  dz: 180,  h: 450, r: 240 },
  ];
  for (const r of rimOffsets) {
    const rGeo  = new THREE.ConeGeometry(r.r, r.h, 10);
    const rMesh = new THREE.Mesh(rGeo, _mat('#252018'));
    rMesh.position.set(-3500 + r.dx, r.h / 2, -4000 + r.dz);
    rMesh.castShadow = true;
    scene.add(rMesh);
  }
}

// ─── Dunas Blancas Sand Dunes ─────────────────────────────────────────────────
// White sand dunes — the most distinctive non-city landmark in FH5.
// Grid of 10 gently rounded hemisphere meshes.

function _buildDunas(scene) {
  const duneMat = _mat('#e8dcc0'); // Dunas Blancas white sand

  // Dune cluster centres within the Dunas district bounds (-5000 to -1000, X / -4000 to -1000 Z)
  const dunes = [
    { x: -3800, z: -2800, r: 80,  h: 40  },
    { x: -3400, z: -2400, r: 65,  h: 32  },
    { x: -4100, z: -3100, r: 55,  h: 28  },
    { x: -3600, z: -3400, r: 70,  h: 36  },
    { x: -2800, z: -2700, r: 60,  h: 30  },
    { x: -3200, z: -1800, r: 50,  h: 25  },
    { x: -4300, z: -2100, r: 75,  h: 38  },
    { x: -2500, z: -3200, r: 45,  h: 22  },
    { x: -3900, z: -1500, r: 58,  h: 29  },
    { x: -1800, z: -2500, r: 40,  h: 20  },
  ];

  for (const d of dunes) {
    // Hemisphere (SphereGeometry, upper half only via phiLength)
    const geo  = new THREE.SphereGeometry(d.r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const mesh = new THREE.Mesh(geo, duneMat);
    mesh.name  = 'dune';
    mesh.position.set(d.x, 0, d.z);
    mesh.scale.set(1, d.h / d.r, 1); // flatten slightly for dune shape
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// ─── Horizon Festival Airstrip ────────────────────────────────────────────────
// The opening scene of FH5 and player spawn point.
// 1200m × 40m flat tarmac strip with white centre-line markings.

function _buildAirstrip(scene) {
  // Airstrip tarmac — light grey tarmac colour #404040
  const stripGeo  = new THREE.PlaneGeometry(1200, 40, 1, 1);
  stripGeo.rotateX(-Math.PI / 2);
  const stripMat  = _mat('#404040', 0.9);
  const strip     = new THREE.Mesh(stripGeo, stripMat);
  strip.name      = 'airstrip';
  strip.position.set(-2000, 0.05, 1600); // festival district coords
  strip.receiveShadow = true;
  scene.add(strip);

  // White centre-line dashes (PlaneGeometry 3m × 0.15m, spaced every 20m)
  const dashMat  = _mat('#f8f8f0', 0.8);
  const dashLen  = 3;
  const dashGap  = 20;
  const totalLen = 1200;
  for (let x = -totalLen / 2 + dashGap; x < totalLen / 2; x += dashGap) {
    const dashGeo  = new THREE.PlaneGeometry(dashLen, 0.2);
    dashGeo.rotateX(-Math.PI / 2);
    const dash     = new THREE.Mesh(dashGeo, dashMat);
    dash.position.set(-2000 + x, 0.06, 1600);
    scene.add(dash);
  }

  // Airstrip threshold markings (wider bars at each end)
  const threshMat = _mat('#ffffff', 0.8);
  for (let i = -3; i <= 3; i++) {
    const bar    = new THREE.PlaneGeometry(10, 1.5);
    bar.rotateX(-Math.PI / 2);
    const m1     = new THREE.Mesh(bar.clone(), threshMat);
    const m2     = new THREE.Mesh(bar.clone(), threshMat);
    m1.position.set(-2000 - 580, 0.07, 1600 + i * 4);
    m2.position.set(-2000 + 580, 0.07, 1600 + i * 4);
    scene.add(m1);
    scene.add(m2);
    bar.dispose();
  }

  // Control tower stub
  const towerGeo  = new THREE.BoxGeometry(10, 25, 10);
  const towerMesh = new THREE.Mesh(towerGeo, _mat('#c8c0b0'));
  towerMesh.name  = 'airstrip_tower';
  towerMesh.position.set(-2000 - 620, 12.5, 1600 + 25);
  towerMesh.castShadow = true;
  scene.add(towerMesh);

  // Tower cab (wider top section)
  const cabGeo  = new THREE.BoxGeometry(14, 5, 14);
  const cabMesh = new THREE.Mesh(cabGeo, _mat('#9ab0c0'));
  cabMesh.position.set(-2000 - 620, 27.5, 1600 + 25);
  scene.add(cabMesh);
}

// ─── Mayan Temple Ruins ───────────────────────────────────────────────────────
// Teotihuacan-style stepped pyramids in the La Selva jungle.
// 3 stepped pyramid stacks (3–4 decreasing boxes).

function _buildMayanTemples(scene) {
  const templeMat = _mat('#9a8870'); // stone grey

  const temples = [
    { x: 1200, z: 2800, scale: 1.0 },
    { x: 1800, z: 3200, scale: 0.7 },
    { x: 2400, z: 2500, scale: 0.85 },
  ];

  for (const t of temples) {
    // Each temple = 4 stacked boxes, each smaller and taller
    const steps = [
      { w: 60 * t.scale, h: 8,  d: 60 * t.scale },
      { w: 45 * t.scale, h: 10, d: 45 * t.scale },
      { w: 30 * t.scale, h: 12, d: 30 * t.scale },
      { w: 15 * t.scale, h: 8,  d: 15 * t.scale },
    ];

    let yBase = 0;
    for (const step of steps) {
      const geo  = new THREE.BoxGeometry(step.w, step.h, step.d);
      const mesh = new THREE.Mesh(geo, templeMat);
      mesh.name  = 'mayan_temple_step';
      mesh.position.set(t.x, yBase + step.h / 2, t.z);
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      yBase += step.h;
    }
  }
}

// ─── Sierra Verde Dam ─────────────────────────────────────────────────────────
// Wide flat concrete span (300m × 15m × 40m) across a river gorge.

function _buildDam(scene) {
  // Dam wall — light concrete colour
  const damGeo  = new THREE.BoxGeometry(300, 40, 15);
  const damMesh = new THREE.Mesh(damGeo, _mat('#c8c0b0'));
  damMesh.name  = 'sierra_dam';
  damMesh.position.set(2800, 0, -600); // canyon area at Riviera/Caldera edge
  damMesh.castShadow    = true;
  damMesh.receiveShadow = true;
  scene.add(damMesh);

  // Dam road surface on top
  const roadGeo  = new THREE.PlaneGeometry(300, 15, 1, 1);
  roadGeo.rotateX(-Math.PI / 2);
  const roadMesh = new THREE.Mesh(roadGeo, _mat('#888070', 0.9));
  roadMesh.position.set(2800, 20.05, -600);
  scene.add(roadMesh);

  // Buttresses on the downstream face
  for (let i = -120; i <= 120; i += 60) {
    const buttGeo  = new THREE.BoxGeometry(12, 40, 25);
    const buttMesh = new THREE.Mesh(buttGeo, _mat('#b8b0a0'));
    buttMesh.position.set(2800 + i, 0, -600 + 18);
    buttMesh.castShadow = true;
    scene.add(buttMesh);
  }
}

// ─── Guanajuato Tunnel ────────────────────────────────────────────────────────
// The single most recognisable FH5 road feature.
// A long box tunnel running east-west under the city hill.

function _buildGuanajuatoTunnel(scene) {
  const tunnelLen = 200;
  const tunnelW   = 8;
  const tunnelH   = 6;

  // Tunnel outer shell (dark grey concrete)
  const outerGeo  = new THREE.BoxGeometry(tunnelLen, tunnelH + 2, tunnelW + 2);
  const outerMesh = new THREE.Mesh(outerGeo, _mat('#303030'));
  outerMesh.name  = 'guanajuato_tunnel';
  outerMesh.position.set(1800, tunnelH / 2 - 0.5, -2000);
  outerMesh.castShadow    = true;
  outerMesh.receiveShadow = true;
  scene.add(outerMesh);

  // Tunnel floor (dark tarmac inside)
  const floorGeo  = new THREE.PlaneGeometry(tunnelLen, tunnelW);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMesh = new THREE.Mesh(floorGeo, _mat('#1a1a1a', 0.95));
  floorMesh.position.set(1800, 0.05, -2000);
  scene.add(floorMesh);

  // Yellow tunnel lights (small emissive boxes along ceiling)
  const lightMat = new THREE.MeshLambertMaterial({
    color: 0xffcc44, emissive: 0xffaa00, emissiveIntensity: 0.8,
  });
  for (let lx = -90; lx <= 90; lx += 20) {
    const lGeo  = new THREE.BoxGeometry(1.5, 0.3, 0.5);
    const lMesh = new THREE.Mesh(lGeo, lightMat);
    lMesh.position.set(1800 + lx, tunnelH - 0.5, -2000);
    scene.add(lMesh);

    // Actual point light every 40m for atmosphere
    if (Math.abs(lx % 40) < 1) {
      const ptLight = new THREE.PointLight(0xffaa44, 1.5, 25);
      ptLight.position.set(1800 + lx, tunnelH - 1.5, -2000);
      scene.add(ptLight);
    }
  }

  // Portal frames at each end
  for (const endX of [-1800 + 1800 - tunnelLen / 2, 1800 + tunnelLen / 2]) {
    const portalGeo  = new THREE.BoxGeometry(2, tunnelH + 4, tunnelW + 4);
    const portalMesh = new THREE.Mesh(portalGeo, _mat('#404040'));
    portalMesh.position.set(endX, tunnelH / 2, -2000);
    scene.add(portalMesh);
  }
}

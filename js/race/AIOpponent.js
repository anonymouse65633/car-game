/**
 * AIOpponent.js
 * Part 8 — Race System & AI (3-D rewrite)
 *
 * Upgraded for the 3-D world:
 *  - Waypoints now use {pos: THREE.Vector3, targetSpeedKmh, …} from Waypoints.js
 *  - Navigation happens in the XZ plane; Y is snapped to terrain each frame
 *  - createMesh(scene) spawns a visible placeholder car in the scene
 *  - updateMesh(getTerrainHeight) moves and orients the mesh each frame
 *  - Look-ahead curvature drives pre-corner braking (calls lookAheadCurvature)
 *  - All legacy archetype/Gemini/slipstream/rubber-band API is preserved
 */

import * as THREE from 'three';
import { lookAheadCurvature } from './Waypoints.js';

// ─── Personality Archetypes ────────────────────────────────────────────────
export const ARCHETYPES = {
  PUSHER:     'Pusher',
  PACER:      'Pacer',
  SPRINTER:   'Sprinter',
  HUNTER:     'Hunter',
  WILDCARD:   'Wildcard',
  TECHNICIAN: 'Technician',
};

const ARCHETYPE_DEFAULTS = {
  Pusher:     { aggression: 8,  speedBias:  0.02, lineDeviation: 0.15 },
  Pacer:      { aggression: 2,  speedBias:  0.00, lineDeviation: 0.05 },
  Sprinter:   { aggression: 5,  speedBias:  0.05, lineDeviation: 0.10 },
  Hunter:     { aggression: 3,  speedBias: -0.04, lineDeviation: 0.08 },
  Wildcard:   { aggression: 5,  speedBias:  0.00, lineDeviation: 0.20 },
  Technician: { aggression: 1,  speedBias:  0.01, lineDeviation: 0.02 },
};

const SURFACE_SPEED = { tarmac: 1.00, gravel: 0.82, wet: 0.88, dirt: 0.75 };

const DRIVER_NAMES = [
  'Vega','Cruz','Nomad','Blaze','Rook','Apex','Dusk','Kira',
  'Torque','Slate','Mira','Hawk','Zane','Fynn','Lyra','Bolt',
  'Crest','Flint','Nova','Stride','Echo','Wren','Dash','Riven',
  'Pax','Vera','Cole','Sable','Jace','Nixe','Arc','Tyne',
  'Orion','Vale','Reeve','Dax','Sora','Mace','Lux','Asher',
];

export function pickDriverName(usedNames = []) {
  const available = DRIVER_NAMES.filter(n => !usedNames.includes(n));
  if (!available.length) return `Driver${Math.floor(Math.random() * 999)}`;
  return available[Math.floor(Math.random() * available.length)];
}

const AI_MESH_COLOURS = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12,
  0x9b59b6, 0x1abc9c, 0xe67e22, 0xecf0f1,
];
let _colourIdx = 0;

let _sharedBodyGeo = null, _sharedRoofGeo = null, _sharedWheelGeo = null;
function _getSharedGeo() {
  if (!_sharedBodyGeo) {
    _sharedBodyGeo  = new THREE.BoxGeometry(1.8, 0.65, 4.2);
    _sharedRoofGeo  = new THREE.BoxGeometry(1.5, 0.55, 2.2);
    _sharedWheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 10);
  }
  return { body: _sharedBodyGeo, roof: _sharedRoofGeo, wheel: _sharedWheelGeo };
}

export class AIOpponent {
  constructor({ name, archetype, difficultySpeed, waypoints, startOffsetX = 0 }) {
    this.name      = name;
    this.archetype = archetype;
    this.waypoints = waypoints;
    this.waypointIndex  = 0;
    this.lapsCompleted  = 0;
    this.finished       = false;
    this.finishTime     = 0;
    this.racePosition   = 0;

    const startWP = waypoints[0];
    this.position = startWP
      ? new THREE.Vector3(startWP.pos.x + startOffsetX, startWP.pos.y, startWP.pos.z)
      : new THREE.Vector3();

    this.heading  = 0;
    this.speedMs  = 0;

    const def = ARCHETYPE_DEFAULTS[archetype] ?? ARCHETYPE_DEFAULTS.Pacer;
    this.aggression    = def.aggression;
    this.lineDeviation = def.lineDeviation;

    this.difficultySpeed       = difficultySpeed;
    this.speedModifier         = 1.0 + def.speedBias;
    this.effectiveSpeedFraction = difficultySpeed * this.speedModifier;

    this.inSlipstream    = false;
    this.slipstreamBonus = 0;
    this.currentSurface  = 'tarmac';

    this.geminiDecision   = null;
    this.geminiCommentary = '';
    this.lapStartTime     = 0;
    this.bestLapTime      = Infinity;
    this.currentLapTime   = 0;
    this._elapsedRaceTime = 0;

    this.mesh = null;
    this._meshColour = AI_MESH_COLOURS[_colourIdx % AI_MESH_COLOURS.length];
    _colourIdx++;
  }

  // ─── Getters (legacy RaceManager compat) ──────────────────────────────────
  get waypointProgress() { return this.lapsCompleted * this.waypoints.length + this.waypointIndex; }
  get targetWaypoint()   { return this.waypoints[this.waypointIndex] ?? null; }
  // RaceManager slipstream uses .x / .y for horizontal pos
  get x() { return this.position.x; }
  get y() { return this.position.z; }

  // ─── 3-D Mesh ──────────────────────────────────────────────────────────────
  createMesh(scene) {
    const geo = _getSharedGeo();
    const bodyMat  = new THREE.MeshLambertMaterial({ color: this._meshColour });
    const roofMat  = new THREE.MeshLambertMaterial({ color: this._meshColour });
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

    const body = new THREE.Mesh(geo.body, bodyMat);
    body.position.y = 0.65;
    body.castShadow = true;

    const roof = new THREE.Mesh(geo.roof, roofMat);
    roof.position.set(0, 1.25, -0.3);

    const wheelOffsets = [[ 0.95, 0.35, 1.35], [-0.95, 0.35, 1.35],
                          [ 0.95, 0.35,-1.35], [-0.95, 0.35,-1.35]];
    const wheels = wheelOffsets.map(([wx,wy,wz]) => {
      const w = new THREE.Mesh(geo.wheel, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, wy, wz);
      w.castShadow = true;
      return w;
    });

    const group = new THREE.Group();
    group.add(body, roof, ...wheels);
    group.position.copy(this.position);
    group.name = `ai_${this.name}`;
    scene.add(group);
    this.mesh = group;
    return group;
  }

  updateMesh(getTerrainHeight) {
    if (!this.mesh) return;
    if (getTerrainHeight) {
      this.position.y = (getTerrainHeight(this.position.x, this.position.z) ?? 0) + 0.35;
    }
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = -(this.heading - Math.PI / 2);
  }

  disposeMesh(scene) {
    if (this.mesh) { scene.remove(this.mesh); this.mesh = null; }
  }

  // ─── Gemini ───────────────────────────────────────────────────────────────
  applyGeminiUpdate(data) {
    if (!data) return;
    if (typeof data.aggression === 'number')     this.aggression    = Math.max(0, Math.min(10, data.aggression));
    if (typeof data.speed_modifier === 'number') this.speedModifier = Math.max(0.90, Math.min(1.10, data.speed_modifier));
    if (data.commentary) this.geminiCommentary = data.commentary;
    this.geminiDecision = data.decision ?? null;
    this.effectiveSpeedFraction = this.difficultySpeed * this.speedModifier;
  }

  // ─── Per-frame update ──────────────────────────────────────────────────────
  update(dt, others = [], playerState = null, totalLaps = 3, getTerrainHeight = null) {
    if (this.finished) return;

    this._elapsedRaceTime += dt;
    this.currentLapTime   += dt;

    const target = this.targetWaypoint;
    if (!target) { this.finished = true; return; }

    const tp   = target.pos;
    const dxRaw = tp.x - this.position.x;
    const dzRaw = tp.z - this.position.z;
    const dist  = Math.sqrt(dxRaw * dxRaw + dzRaw * dzRaw);

    // Heading in XZ (atan2 with swapped args = clockwise from +Z)
    const desiredHeading = Math.atan2(dxRaw, dzRaw);
    const noise = (Math.random() - 0.5) * 2 * this.lineDeviation * 0.05;
    this.heading = desiredHeading + noise + this._collisionAvoidAngle(others);

    // Speed
    const curveBrake  = this._curvatureBrake();
    const speedFrac   = this._archetypeSpeedFraction();
    const surfMul     = SURFACE_SPEED[this.currentSurface] ?? 1.0;
    const wpSpeed     = (target.targetSpeedKmh ?? 100) / 3.6;
    this.slipstreamBonus = this._checkSlipstream(others);
    const targetSpd   = wpSpeed * speedFrac * surfMul * (1 + this.slipstreamBonus) * curveBrake;

    this.speedMs += (targetSpd - this.speedMs) * Math.min(1, dt * 3);
    this.speedMs  = Math.max(0, this.speedMs);

    // Move
    this.position.x += Math.sin(this.heading) * this.speedMs * dt;
    this.position.z += Math.cos(this.heading) * this.speedMs * dt;

    this.updateMesh(getTerrainHeight);

    // Advance waypoint
    if (dist < 12) {
      this.waypointIndex++;
      if (this.waypointIndex >= this.waypoints.length) {
        this.waypointIndex = 0;
        this.lapsCompleted++;
        const lapT = this.currentLapTime;
        if (lapT < this.bestLapTime) this.bestLapTime = lapT;
        this.currentLapTime = 0;
        if (this.lapsCompleted >= totalLaps) {
          this.finished   = true;
          this.finishTime = this._elapsedRaceTime;
        }
      }
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────
  _curvatureBrake() {
    try {
      const curv = lookAheadCurvature(this.waypoints, this.waypointIndex, 5);
      return 1.0 - Math.min(1, curv / Math.PI) * 0.55;
    } catch { return 1.0; }
  }

  _archetypeSpeedFraction() {
    const t = this._elapsedRaceTime;
    switch (this.archetype) {
      case 'Sprinter': return this.speedModifier + Math.max(-0.05, 0.05 - (t / 180) * 0.10);
      case 'Hunter':   return this.speedModifier + Math.min(0.03, -0.06 + (t / 120) * 0.09);
      case 'Wildcard': return this.speedModifier + (Math.random() - 0.5) * 0.08;
      default:         return this.speedModifier;
    }
  }

  _checkSlipstream(others) {
    for (const other of others) {
      if (other === this) continue;
      const dx = other.position.x - this.position.x;
      const dz = other.position.z - this.position.z;
      const d  = Math.sqrt(dx*dx + dz*dz);
      if (d < 15 && Math.abs(Math.atan2(dx,dz) - this.heading) < 0.45) return 0.08;
    }
    return 0;
  }

  _collisionAvoidAngle(others) {
    let c = 0;
    for (const other of others) {
      if (other === this) continue;
      const dx = other.position.x - this.position.x;
      const dz = other.position.z - this.position.z;
      const d  = Math.sqrt(dx*dx + dz*dz);
      if (d < 10) {
        const rel = Math.atan2(dx, dz) - this.heading;
        if (Math.abs(rel) < Math.PI / 3) c += rel > 0 ? -0.07 : 0.07;
      }
    }
    return Math.max(-0.25, Math.min(0.25, c));
  }

  getRaceStateSnapshot(playerPosition, totalCars) {
    return {
      name: this.name, archetype: this.archetype,
      position: this.racePosition, totalCars, playerPosition,
      lapsCompleted: this.lapsCompleted,
      speed: Math.round(this.speedMs * 3.6),
      aggression: this.aggression, inSlipstream: this.inSlipstream,
    };
  }
}

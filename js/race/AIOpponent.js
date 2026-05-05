/**
 * AIOpponent.js
 * Part 7 — Race System & AI
 *
 * Handles a single AI opponent car in a race.
 * Responsibilities:
 *  - Waypoint path-following (local, no API)
 *  - Personality archetype behaviour
 *  - Receiving and applying Gemini behavioural updates
 *  - Collision avoidance (simple forward raycast approximation)
 *  - Surface-aware speed profiles
 */

// ─── Personality Archetypes ────────────────────────────────────────────────
export const ARCHETYPES = {
  PUSHER: 'Pusher',
  PACER: 'Pacer',
  SPRINTER: 'Sprinter',
  HUNTER: 'Hunter',
  WILDCARD: 'Wildcard',
  TECHNICIAN: 'Technician',
};

/**
 * Base behavioural tendencies per archetype.
 * These act as priors before Gemini overrides them.
 *
 * aggression    : 0-10  – how hard they block / nudge
 * speedBias     : 0-1   – fraction added on top of difficulty base speed
 * lineDeviation : 0-1   – how much they wander from the ideal racing line
 */
const ARCHETYPE_DEFAULTS = {
  [ARCHETYPES.PUSHER]:     { aggression: 8,  speedBias: 0.02, lineDeviation: 0.15 },
  [ARCHETYPES.PACER]:      { aggression: 2,  speedBias: 0.00, lineDeviation: 0.05 },
  [ARCHETYPES.SPRINTER]:   { aggression: 5,  speedBias: 0.05, lineDeviation: 0.10 },
  [ARCHETYPES.HUNTER]:     { aggression: 3,  speedBias: -0.04, lineDeviation: 0.08 },
  [ARCHETYPES.WILDCARD]:   { aggression: 5,  speedBias: 0.00, lineDeviation: 0.20 },
  [ARCHETYPES.TECHNICIAN]: { aggression: 1,  speedBias: 0.01, lineDeviation: 0.02 },
};

// Surface speed multipliers (tarmac = baseline)
const SURFACE_SPEED = {
  tarmac: 1.00,
  gravel: 0.82,
  wet:    0.88,
  dirt:   0.75,
};

// ─── Driver Name Pool ──────────────────────────────────────────────────────
const DRIVER_NAMES = [
  'Vega', 'Cruz', 'Nomad', 'Blaze', 'Rook', 'Apex', 'Dusk', 'Kira',
  'Torque', 'Slate', 'Mira', 'Hawk', 'Zane', 'Fynn', 'Lyra', 'Bolt',
  'Crest', 'Flint', 'Nova', 'Stride', 'Echo', 'Wren', 'Dash', 'Riven',
  'Pax', 'Vera', 'Cole', 'Sable', 'Jace', 'Nixe', 'Arc', 'Tyne',
  'Orion', 'Vale', 'Reeve', 'Dax', 'Sora', 'Mace', 'Lux', 'Asher',
];

/** Return a random name that isn't already used by another opponent. */
export function pickDriverName(usedNames = []) {
  const available = DRIVER_NAMES.filter(n => !usedNames.includes(n));
  if (!available.length) return `Driver${Math.floor(Math.random() * 999)}`;
  return available[Math.floor(Math.random() * available.length)];
}

// ─── AIOpponent Class ──────────────────────────────────────────────────────
export class AIOpponent {
  /**
   * @param {object} opts
   * @param {string}   opts.name          - Driver name
   * @param {string}   opts.archetype     - One of ARCHETYPES values
   * @param {number}   opts.difficultySpeed - Base speed fraction from difficulty table (0-1.05)
   * @param {object[]} opts.waypoints      - Array of {x, y, z, speed} objects from Waypoint.js
   * @param {string}   [opts.carColor]    - CSS colour string for rendering
   */
  constructor({ name, archetype, difficultySpeed, waypoints, carColor = '#e55' }) {
    this.name = name;
    this.archetype = archetype;
    this.carColor = carColor;

    // Navigation state
    this.waypoints = waypoints;
    this.waypointIndex = 0;        // which waypoint we're heading toward
    this.lapsCompleted = 0;
    this.finished = false;
    this.racePosition = 0;         // filled in by RaceManager

    // Physics approximation (2-D top-down friendly)
    this.x = waypoints[0]?.x ?? 0;
    this.y = waypoints[0]?.y ?? 0;
    this.z = waypoints[0]?.z ?? 0;
    this.speed = 0;                // current speed (units/s)
    this.heading = 0;              // radians

    // Behaviour state
    const defaults = ARCHETYPE_DEFAULTS[archetype] ?? ARCHETYPE_DEFAULTS[ARCHETYPES.PACER];
    this.aggression = defaults.aggression;
    this.lineDeviation = defaults.lineDeviation;

    // Speed calculation
    this.difficultySpeed = difficultySpeed;   // e.g. 0.88 for Experienced
    this.speedModifier = 1.0 + defaults.speedBias; // Gemini updates this
    this.effectiveSpeedFraction = difficultySpeed * this.speedModifier;

    // Surface
    this.currentSurface = 'tarmac';

    // Slipstream
    this.inSlipstream = false;
    this.slipstreamBonus = 0;

    // Gemini state
    this.geminiDecision = null;    // last decision received: 'A' | 'B' | 'C'
    this.geminiCommentary = '';    // broadcast to race UI
    this.lastGeminiUpdate = -Infinity; // elapsed seconds

    // Lap timing
    this.lapStartTime = 0;
    this.bestLapTime = Infinity;
    this.currentLapTime = 0;

    // For Sprinter/Hunter archetype — phase tracking
    this._elapsedRaceTime = 0;
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  /** How many waypoints has this car cleared? Used for gap calculation. */
  get waypointProgress() {
    return this.lapsCompleted * this.waypoints.length + this.waypointIndex;
  }

  /** Current waypoint target */
  get targetWaypoint() {
    return this.waypoints[this.waypointIndex];
  }

  // ─── Gemini Integration ───────────────────────────────────────────────────

  /**
   * Called by RaceManager after a Gemini response arrives.
   * @param {object} data  – { decision, aggression, speed_modifier, commentary }
   */
  applyGeminiUpdate(data) {
    if (!data) return;

    if (typeof data.aggression === 'number') {
      this.aggression = Math.max(0, Math.min(10, data.aggression));
    }
    if (typeof data.speed_modifier === 'number') {
      this.speedModifier = Math.max(0.90, Math.min(1.10, data.speed_modifier));
    }
    if (data.commentary) {
      this.geminiCommentary = data.commentary;
    }
    this.geminiDecision = data.decision ?? null;

    // Re-derive effective speed
    this.effectiveSpeedFraction = this.difficultySpeed * this.speedModifier;
  }

  // ─── Per-frame Update ────────────────────────────────────────────────────

  /**
   * Update AI car position.
   * @param {number} dt          – delta time in seconds
   * @param {AIOpponent[]} others – other cars for collision avoidance
   * @param {object}  playerState – { x, y, z } for rubber-band awareness
   * @param {number}  totalLaps   – total laps in this race
   */
  update(dt, others = [], playerState = null, totalLaps = 3) {
    if (this.finished) return;

    this._elapsedRaceTime += dt;
    this.currentLapTime += dt;

    // Archetype phase modifications
    const speedFrac = this._archetypeSpeedFraction();

    // Target waypoint
    const target = this.targetWaypoint;
    if (!target) { this.finished = true; return; }

    // Direction to waypoint
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Desired heading
    const desiredHeading = Math.atan2(dy, dx);

    // Add line deviation noise (lower-skill AIs wander from ideal line)
    const deviationNoise = (Math.random() - 0.5) * 2 * this.lineDeviation * 0.05;
    this.heading = desiredHeading + deviationNoise;

    // Slipstream bonus
    this.slipstreamBonus = this._checkSlipstream(others);

    // Collision avoidance – soft steer if another car is very close ahead
    const avoidAngle = this._collisionAvoidAngle(others);
    this.heading += avoidAngle;

    // Surface-adjusted target speed
    const surfaceMul = SURFACE_SPEED[this.currentSurface] ?? 1.0;
    const waypointSpeed = target.speed ?? 60; // units/s
    const targetSpeed = waypointSpeed * speedFrac * surfaceMul * (1 + this.slipstreamBonus);

    // Simple velocity lerp (no real physics engine needed for AI)
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 3);

    // Move
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;

    // Advance waypoint when close enough
    const arrivalThreshold = 8; // units
    if (dist < arrivalThreshold) {
      this.waypointIndex++;
      if (this.waypointIndex >= this.waypoints.length) {
        // Completed a lap
        this.waypointIndex = 0;
        this.lapsCompleted++;

        const lapTime = this.currentLapTime;
        if (lapTime < this.bestLapTime) this.bestLapTime = lapTime;
        this.currentLapTime = 0;

        if (this.lapsCompleted >= totalLaps) {
          this.finished = true;
          this.finishTime = this._elapsedRaceTime;
        }
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Archetype-specific speed fraction applied on top of difficultySpeed.
   * Sprinters start fast and fade; Hunters start slow and accelerate late.
   */
  _archetypeSpeedFraction() {
    const t = this._elapsedRaceTime;
    switch (this.archetype) {
      case ARCHETYPES.SPRINTER:
        // Fast first 60s, linearly fades to -5% by 180s
        return this.speedModifier + Math.max(-0.05, 0.05 - (t / 180) * 0.10);
      case ARCHETYPES.HUNTER:
        // Starts -6%, ramps to +3% after 120s
        return this.speedModifier + Math.min(0.03, -0.06 + (t / 120) * 0.09);
      case ARCHETYPES.WILDCARD:
        // Random ±4% each call – chaotic
        return this.speedModifier + (Math.random() - 0.5) * 0.08;
      default:
        return this.speedModifier;
    }
  }

  /**
   * Check if this car is in the slipstream of another car.
   * Returns a speed bonus fraction (0 or 0.08).
   */
  _checkSlipstream(others) {
    const DRAFT_DIST = 12;     // units – ~1.5 car lengths
    const DRAFT_ANGLE = 0.4;   // radians – narrow cone ahead
    for (const other of others) {
      if (other === this) continue;
      const dx = other.x - this.x;
      const dy = other.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DRAFT_DIST) {
        const angle = Math.abs(Math.atan2(dy, dx) - this.heading);
        if (angle < DRAFT_ANGLE) return 0.08;
      }
    }
    return 0;
  }

  /**
   * Returns a heading correction angle to avoid nearby cars ahead.
   * Simulates a short forward raycast.
   */
  _collisionAvoidAngle(others) {
    const AVOID_DIST = 14;
    let correction = 0;
    for (const other of others) {
      if (other === this) continue;
      const dx = other.x - this.x;
      const dy = other.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < AVOID_DIST) {
        // Only avoid cars roughly ahead of us
        const relAngle = Math.atan2(dy, dx) - this.heading;
        if (Math.abs(relAngle) < Math.PI / 3) {
          // Steer away: positive if other is to our left, negative if right
          correction += relAngle > 0 ? -0.08 : 0.08;
        }
      }
    }
    return Math.max(-0.3, Math.min(0.3, correction)); // clamp to avoid wild swerves
  }

  // ─── Snapshot for Gemini Prompt ──────────────────────────────────────────

  /**
   * Returns a plain object describing this AI's current race state.
   * Used by GeminiRaceAI to build the prompt.
   */
  getRaceStateSnapshot(playerPosition, totalCars) {
    return {
      name:          this.name,
      archetype:     this.archetype,
      position:      this.racePosition,
      totalCars,
      playerPosition,
      lapsCompleted: this.lapsCompleted,
      speed:         Math.round(this.speed),
      aggression:    this.aggression,
      inSlipstream:  this.inSlipstream,
    };
  }

  // ─── Serialisation ────────────────────────────────────────────────────────

  toDebugString() {
    return (
      `[${this.name}/${this.archetype}] ` +
      `pos(${this.x.toFixed(1)},${this.y.toFixed(1)}) ` +
      `spd:${this.speed.toFixed(1)} ` +
      `wp:${this.waypointIndex}/${this.waypoints.length} ` +
      `lap:${this.lapsCompleted} ` +
      `agg:${this.aggression}`
    );
  }
}

/**
 * RaceSession.js
 * Part 8 — Race Session Orchestrator
 *
 * Bridges the gap between:
 *   • RaceManager   (race logic, AI timing, results)
 *   • AIOpponent    (3-D mesh + physics)
 *   • RaceHUD       (live position / lap / radio UI)
 *   • RaceResultsScreen (post-race overlay)
 *   • Waypoints.js  (inline waypoint tables + helpers)
 *   • Racedata.js   (race event definitions)
 *
 * Usage:
 *   const session = new RaceSession({ scene, getTerrainHeight, hudManager,
 *                                     playerCarRef, onEnd });
 *   session.getRaceConfig(raceId);          // called by RaceSetupScreen
 *   await session.start({ raceId, difficulty, assists });
 *   session.update(dt);                     // called from game loop
 *   session.stop();                         // called on cancel / cleanup
 */

import { RaceManager, DIFFICULTY, RACE_STATE } from './RaceManager.js';
import { AIOpponent, pickDriverName, ARCHETYPES } from './AIOpponent.js';
import { getInlineWaypoints } from './Waypoints.js';
import { getRaceById }        from './Racedata.js';

// ── Difficulty key mapping (RaceSetupScreen uses lowercase keys) ───────────
const DIFF_KEY_MAP = {
  tourist:     'Tourist',
  novice:      'Novice',
  experienced: 'Experienced',
  pro:         'Pro',
  unbeatable:  'Unbeatable',
};

export class RaceSession {
  /**
   * @param {object} opts
   * @param {THREE.Scene}   opts.scene
   * @param {function}      opts.getTerrainHeight   (x, z) → y
   * @param {object}        opts.hudManager          HUDManager instance
   * @param {object}        opts.playerCarRef        { position: THREE.Vector3, speedKmh, lapsCompleted, waypointIndex }
   * @param {function}      [opts.onEnd]             called with adapted results object
   */
  constructor({ scene, getTerrainHeight, hudManager, playerCarRef, onEnd = () => {} }) {
    this._scene            = scene;
    this._getTerrainHeight = getTerrainHeight;
    this._hudManager       = hudManager;
    this._playerCarRef     = playerCarRef;
    this._onEnd            = onEnd;

    this._raceManager  = null;
    this._opponents    = [];     // AIOpponent instances with meshes
    this._active       = false;
    this._raceId       = null;
    this._raceData     = null;
    this._waypoints    = null;

    // Live player state proxy handed to RaceManager
    this._playerState = {
      x: 0, y: 0, z: 0,
      speed: 0,
      heading: 0,
      lapsCompleted: 0,
      waypointIndex: 0,
      inSlipstream: false,
      slipstreamBonus: 0,
    };

    // Race HUD reference (obtained from hudManager)
    this._raceHUD = hudManager?.raceHUD ?? null;
  }

  // ─── RaceSetupScreen compatibility ───────────────────────────────────────

  /**
   * Returns the race config shape expected by RaceSetupScreen._fetchRaceConfig().
   * Also called before start() to validate.
   */
  getRaceConfig(raceId) {
    const data = getRaceById(raceId);
    if (!data) return null;

    return {
      name:        data.name,
      type:        data.type,
      class:       data.classFilter?.[0] ?? 'A',
      distanceKm:  data.distanceKm  ?? 0,
      laps:        data.laps        ?? 1,
      estimatedMs: Math.round(((data.distanceKm ?? 2) / 100) * 60_000 * 3),
      waypoints:   this._normaliseWaypointsForDiagram(raceId),
      rewards: {
        p1: { cr: data.basePayout ?? 0,           xp: (data.basePayout ?? 0) / 10 },
        p2: { cr: Math.round((data.basePayout ?? 0) * 0.6), xp: (data.basePayout ?? 0) / 17 },
        p3: { cr: Math.round((data.basePayout ?? 0) * 0.35),xp: (data.basePayout ?? 0) / 29 },
      },
    };
  }

  /** Returns normalised [{x,y}] waypoints (0-1) for the route diagram canvas. */
  _normaliseWaypointsForDiagram(raceId) {
    const wps = getInlineWaypoints(raceId);
    if (!wps?.length) return [];

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const wp of wps) {
      minX = Math.min(minX, wp.pos.x); maxX = Math.max(maxX, wp.pos.x);
      minZ = Math.min(minZ, wp.pos.z); maxZ = Math.max(maxZ, wp.pos.z);
    }
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    return wps.map(wp => ({
      x: (wp.pos.x - minX) / rangeX,
      y: (wp.pos.z - minZ) / rangeZ,
    }));
  }

  /**
   * spawnOpponents: called by RaceSetupScreen to preview the opponent list.
   * Returns lightweight opponent descriptors (no meshes yet).
   */
  async spawnOpponents(raceId, difficultyKey) {
    const data = getRaceById(raceId);
    if (!data) return [];

    const count      = data.aiCount ?? 5;
    const archetypes = Object.values(ARCHETYPES);
    const usedNames  = [];
    const result     = [];

    for (let i = 0; i < count; i++) {
      const name      = pickDriverName(usedNames);
      usedNames.push(name);
      const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];
      result.push({
        name,
        archetype,
        car:   'AI Vehicle',
        class: data.classFilter?.[0] ?? 'A',
        pr:    Math.round(300 + Math.random() * 400),
      });
    }
    return result;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Build opponents with 3-D meshes, create RaceManager, begin countdown.
   * @param {object} opts
   * @param {string} opts.raceId
   * @param {string} opts.difficulty   – lowercase key: 'novice', 'pro', etc.
   * @param {object} opts.assists      – { abs, tc, sc, rewind }
   */
  async start({ raceId, difficulty, assists = {} }) {
    this._raceId   = raceId;
    this._raceData = getRaceById(raceId);
    if (!this._raceData) {
      console.warn(`[RaceSession] Unknown race id: ${raceId}`);
      return;
    }

    this._waypoints = getInlineWaypoints(raceId) ?? [];
    if (!this._waypoints.length) {
      console.warn(`[RaceSession] No waypoints for race: ${raceId}`);
      return;
    }

    const diffKey   = DIFF_KEY_MAP[difficulty] ?? 'Experienced';
    const diffCfg   = DIFFICULTY[diffKey] ?? DIFFICULTY.Experienced;
    const count     = this._raceData.aiCount ?? 5;
    const archetypes = Object.values(ARCHETYPES);
    const usedNames = [];

    // ── Spawn AI opponents with visible meshes ──
    this._opponents = [];
    for (let i = 0; i < count; i++) {
      const name      = pickDriverName(usedNames);
      usedNames.push(name);
      const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];
      const opp = new AIOpponent({
        name,
        archetype,
        difficultySpeed: diffCfg.speedFraction,
        waypoints:       this._waypoints,
        startOffsetX:    (i + 1) * 4,   // stagger cars on the start line
      });
      opp.createMesh(this._scene);
      this._opponents.push(opp);
    }

    // ── Sync player proxy ──
    this._syncPlayerState();

    // ── Create RaceManager ──
    const assistsMap = {
      ABS:             assists.abs ?? true,
      TractionControl: assists.tc  ?? true,
      StabilityControl:assists.sc  ?? true,
      AutomaticGears:  true,
    };

    this._raceManager = new RaceManager({
      raceData:    this._raceData,
      waypoints:   this._waypoints,
      difficulty:  diffKey,
      playerState: this._playerState,
      assists:     assistsMap,

      onCountdown:      (n) => this._onCountdown(n),
      onPositionUpdate: (positions) => this._onPositionUpdate(positions),
      onCommentary:     (name, text) => this._onCommentary(name, text),
      onOvertake:       (type, pos) => this._onOvertake(type, pos),
      onRaceEnd:        (results) => this._onRaceEnd(results),
      onOutOfBounds:    (secs) => this._onOutOfBounds(secs),
    });

    // Inject our pre-built opponents
    this._raceManager.opponents = this._opponents;

    this._active = true;

    // Show race HUD
    if (this._raceHUD) {
      this._raceHUD.show({ raceType: this._raceData.type });
    } else {
      this._hudManager?.showRaceHUD?.({ raceType: this._raceData.type });
    }

    // Start countdown
    this._raceManager.beginCountdown();
  }

  /** Call every game loop frame while a race is active. */
  update(dt) {
    if (!this._active || !this._raceManager) return;
    if (this._raceManager.state !== RACE_STATE.RACING) return;

    // Sync player position into the proxy
    this._syncPlayerState();

    // Update all AI meshes
    for (const opp of this._opponents) {
      opp.update(dt, this._opponents, this._playerState,
                 this._raceData?.laps ?? 3, this._getTerrainHeight);
    }

    // Push live data to RaceHUD
    const hud = this._raceManager.getPlayerHUDData();
    const raceHUD = this._raceHUD ?? this._hudManager?.raceHUD;
    if (raceHUD?.update) {
      raceHUD.update({
        position:     hud.position,
        totalRacers:  hud.totalCars,
        gapAhead:     hud.gapAhead ? parseFloat(hud.gapAhead) : null,
        raceType:     this._raceData?.type ?? 'circuit',
        currentLap:   (this._playerCarRef?.lapsCompleted ?? 0) + 1,
        totalLaps:    this._raceData?.laps ?? 1,
        currentLapMs: (this._raceManager.elapsedTime - (this._raceManager._playerLapStart ?? 0)) * 1000,
        bestLapMs:    this._raceManager._playerBestLap < Infinity
                        ? this._raceManager._playerBestLap * 1000 : null,
        isNewPB:      false,
        racers:       this._buildRacerList(),
      });
    }
  }

  /** Cancel / teardown the race session. */
  stop() {
    this._active = false;
    if (this._raceManager) {
      this._raceManager._stopLoop?.();
      this._raceManager = null;
    }
    this._removeOpponentMeshes();
    const raceHUD = this._raceHUD ?? this._hudManager?.raceHUD;
    raceHUD?.hide?.();
  }

  get isActive() { return this._active; }

  // ─── Private helpers ──────────────────────────────────────────────────────

  _syncPlayerState() {
    const car = this._playerCarRef;
    if (!car) return;
    const pos = car.position ?? car.getPosition?.();
    if (pos) {
      this._playerState.x = pos.x;
      this._playerState.y = pos.z;  // RaceManager uses y as the 2nd horiz axis
      this._playerState.z = pos.y;
    }
    this._playerState.speed         = (car.speedKmh ?? 0) / 3.6;
    this._playerState.lapsCompleted = car.lapsCompleted ?? 0;
    this._playerState.waypointIndex = car.waypointIndex ?? 0;
  }

  _removeOpponentMeshes() {
    for (const opp of this._opponents) opp.disposeMesh(this._scene);
    this._opponents = [];
  }

  _buildRacerList() {
    const positions = this._raceManager?.positions ?? [];
    return positions.map(p => ({
      name:      p.name,
      isPlayer:  p.isPlayer,
      position:  p.position,
      gapMs:     Math.max(0, (positions[0]?.progress - p.progress) ?? 0) * 2000,
      archetype: p.isPlayer ? null
        : (this._opponents.find(o => o.name === p.name)?.archetype ?? null),
    }));
  }

  // ── Callbacks from RaceManager ──────────────────────────────────────────

  _onCountdown(n) {
    if (n <= 0) {
      this._hudManager?.showNotification?.({ text: 'GO!', colour: '#22c55e', duration: 1200 });
    } else {
      this._hudManager?.showNotification?.({ text: String(n), colour: '#fff', duration: 900 });
    }
  }

  _onPositionUpdate(positions) {
    // Positions are pushed to RaceHUD live in update(), so nothing extra needed here.
  }

  _onCommentary(name, text) {
    const raceHUD = this._raceHUD ?? this._hudManager?.raceHUD;
    raceHUD?.showRadioChatter?.(`${name}: ${text}`);
  }

  _onOvertake(type, position) {
    const msg = type === 'gained'
      ? `P${position} — Overtake!`
      : `P${position} — Overtaken!`;
    this._hudManager?.showNotification?.({ text: msg, duration: 2000 });
  }

  _onOutOfBounds(secondsLeft) {
    if (secondsLeft > 0) {
      this._hudManager?.showNotification?.({
        text: `Out of bounds — reset in ${Math.ceil(secondsLeft)}s`,
        colour: '#f59e0b',
        duration: 1100,
      });
    }
  }

  _onRaceEnd(results) {
    this._active = false;
    this._removeOpponentMeshes();

    const raceHUD = this._raceHUD ?? this._hudManager?.raceHUD;
    raceHUD?.hide?.();

    // ── Adapt RaceManager results → RaceResultsScreen format ──
    const adapted = this._adaptResults(results);
    this._onEnd(adapted);

    // Show via HUDManager if it has a showResults method
    this._hudManager?.showResults?.(adapted, {
      onRaceAgain:    () => { /* caller handles */ },
      onNextEvent:    () => { /* caller handles */ },
      onReturnToCity: () => { /* caller handles */ },
      onWheelspin:    () => { /* caller handles */ },
    });
  }

  /**
   * Converts RaceManager's results shape to RaceResultsScreen's expected shape.
   */
  _adaptResults(rm) {
    const playerEntry = rm.positions?.find(p => p.isPlayer);
    const winner      = rm.positions?.find(p => p.position === 1);

    const racers = (rm.positions ?? []).map(p => {
      const isWinner    = p.position === 1;
      const gapProgress = (winner?.progress ?? 0) - (p.progress ?? 0);
      // Very rough gap → ms conversion (2 s per waypoint gap)
      const gapMs       = isWinner ? 0 : Math.max(0, gapProgress * 2000);
      const opp         = this._opponents.find(o => o.name === p.name);
      return {
        name:       p.name,
        isPlayer:   p.isPlayer ?? false,
        position:   p.position,
        raceTimeMs: Math.round(rm.finishTime * 1000) + gapMs,
        gapMs,
        archetype:  opp?.archetype ?? null,
      };
    });

    // Build credit multipliers from assists bonus
    const multipliers = [];
    if (rm.assistsOffBonus > 0) {
      multipliers.push({
        label: 'Assists Off Bonus',
        value: Math.round(rm.creditEarned * rm.assistsOffBonus / (1 + rm.assistsOffBonus)),
      });
    }
    for (const b of (rm.bonusXP ?? [])) {
      multipliers.push({ label: b.label, value: b.xp });
    }

    return {
      position:           rm.playerPosition,
      totalRacers:        rm.totalCars,
      raceTimeMs:         Math.round(rm.finishTime * 1000),
      bestLapMs:          rm.bestLapTime != null ? Math.round(rm.bestLapTime * 1000) : null,
      isNewPB:            false,
      newPBText:          null,
      racers,
      creditsBase:        rm.creditEarned,
      creditsMultipliers: multipliers,
      creditsTotal:       rm.creditEarned,
      xpEarned:           rm.xpEarned,
      xpBefore:           0,
      xpAfter:            rm.xpEarned,
      xpToNextLevel:      10_000,
      levelBefore:        1,
      levelAfter:         1,
      wheelspinCount:     rm.wheelspin ? 1 : 0,
      accolades:          (rm.bonusXP ?? []).map(b => b.label),
      geminiFlavourText:  rm.geminiFlavourText ?? '',
    };
  }
}

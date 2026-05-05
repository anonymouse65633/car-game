/**
 * RaceManager.js
 * Part 7 — Race System & AI (Sections 7.3 – 7.8)
 *
 * Orchestrates a single race event from countdown to results screen.
 *
 * Responsibilities:
 *  - Race start sequence (countdown, grid formation)
 *  - Live position tracking for player + all AI
 *  - 30-second Gemini update scheduling
 *  - Overtake event detection
 *  - Slipstream tracking for player
 *  - Out-of-bounds / reset logic
 *  - Difficulty modifiers (rubber band, speed table)
 *  - Credit / XP payout calculation
 *  - Lap timing
 *  - Results packaging
 *
 * Dependencies:
 *  - AIOpponent.js   (AIOpponent class)
 *  - GeminiRaceAI.js (geminiRaceAI singleton)
 *  - RaceData.js     (race definitions — imported by caller)
 *  - Waypoint.js     (waypoint arrays — imported by caller)
 */

import { AIOpponent, ARCHETYPES, pickDriverName } from './AIOpponent.js';
import { geminiRaceAI } from './GeminiRaceAI.js';

// ─── Difficulty Table (Section 7.7.1) ─────────────────────────────────────
export const DIFFICULTY = {
  Tourist:    { speedFraction: 0.60, aggression: 'Low',      rubberBand: true,  rubberStrength: 0.12, rewind: true,  creditMul: 0.5  },
  Novice:     { speedFraction: 0.75, aggression: 'Low-Med',  rubberBand: true,  rubberStrength: 0.07, rewind: true,  creditMul: 0.75 },
  Experienced:{ speedFraction: 0.88, aggression: 'Medium',   rubberBand: true,  rubberStrength: 0.03, rewind: true,  creditMul: 1.0  },
  Pro:        { speedFraction: 0.97, aggression: 'High',     rubberBand: false, rubberStrength: 0,    rewind: false, creditMul: 1.5  },
  Unbeatable: { speedFraction: 1.05, aggression: 'Very High',rubberBand: false, rubberStrength: 0,    rewind: false, creditMul: 2.0  },
};

// ─── Assist XP Bonuses (Section 7.7.2) ────────────────────────────────────
const ASSIST_XP_BONUS = {
  ABS:            0.10,
  TractionControl:0.10,
  StabilityControl:0.15,
  SteeringAssist: 0.10,
  BrakingAssist:  0.20,
  ManualGears:    0.15,  // bonus when NOT using automatic
};

// ─── Position Credit Modifiers (Section 7.8) ──────────────────────────────
const POSITION_CREDIT_MOD = [1.00, 0.60, 0.35, 0.15]; // index 0 = 1st

// ─── Race States ──────────────────────────────────────────────────────────
export const RACE_STATE = {
  IDLE:        'idle',
  COUNTDOWN:   'countdown',
  RACING:      'racing',
  FINISHED:    'finished',
};

// ─── RaceManager ──────────────────────────────────────────────────────────
export class RaceManager {
  /**
   * @param {object} opts
   * @param {object}   opts.raceData      – from RaceData.js: { id, name, type, laps, basePayout, baseXP, ... }
   * @param {object[]} opts.waypoints     – from Waypoint.js: [{ x, y, z, speed }, ...]
   * @param {string}   opts.difficulty    – key from DIFFICULTY table
   * @param {object}   opts.playerState   – live player state reference: { x, y, z, speed, lapsCompleted }
   * @param {object}   opts.assists       – { ABS, TractionControl, StabilityControl, ... } boolean flags
   * @param {Function} opts.onCountdown   – callback(secondsLeft) for countdown UI
   * @param {Function} opts.onPositionUpdate – callback(positions[]) each frame
   * @param {Function} opts.onCommentary  – callback(driverName, text) for radio chatter UI
   * @param {Function} opts.onOvertake    – callback(type: 'gained'|'lost', position) 
   * @param {Function} opts.onRaceEnd     – callback(results) when race is fully resolved
   * @param {Function} opts.onOutOfBounds – callback(secondsLeft) when player is out of bounds
   */
  constructor({
    raceData,
    waypoints,
    difficulty = 'Experienced',
    playerState,
    assists = {},
    onCountdown       = () => {},
    onPositionUpdate  = () => {},
    onCommentary      = () => {},
    onOvertake        = () => {},
    onRaceEnd         = () => {},
    onOutOfBounds     = () => {},
  }) {
    this.raceData   = raceData;
    this.waypoints  = waypoints;
    this.difficulty = difficulty;
    this.diffConfig = DIFFICULTY[difficulty] ?? DIFFICULTY.Experienced;

    this.playerState = playerState;   // external mutable reference
    this.assists     = assists;

    // Callbacks
    this.onCountdown      = onCountdown;
    this.onPositionUpdate = onPositionUpdate;
    this.onCommentary     = onCommentary;
    this.onOvertake       = onOvertake;
    this.onRaceEnd        = onRaceEnd;
    this.onOutOfBounds    = onOutOfBounds;

    // Race state
    this.state          = RACE_STATE.IDLE;
    this.elapsedTime    = 0;
    this.countdownTimer = 0;

    // AI opponents
    this.opponents = [];

    // Positions array – sorted each frame: [{ name, lapsCompleted, waypointProgress, isPlayer }]
    this.positions = [];

    // Slipstream
    this.playerSlipstream        = false;
    this.playerSlipstreamSeconds = 0;

    // Out-of-bounds
    this._outOfBoundsTimer   = 0;
    this._playerInBounds     = true;
    this._lastValidCheckpoint = null;

    // Gemini scheduling: { [aiName]: lastCallTime }
    this._geminiSchedule = {};
    this._GEMINI_INTERVAL = 30; // seconds between per-AI calls

    // Overtake tracking
    this._lastPlayerPosition = 0;

    // Rewind buffer (only when enabled)
    this._rewindBuffer = [];
    this._MAX_REWIND   = 10; // seconds

    // Lap tracking for player
    this._playerLapTimes = [];
    this._playerLapStart = 0;
    this._playerBestLap  = Infinity;

    // Scheduled callbacks
    this._countdownInterval = null;
    this._updateLoop        = null;
  }

  // ─── Setup ───────────────────────────────────────────────────────────────

  /**
   * Spawn AI opponents for this race.
   * @param {number} count  – how many (from raceData.opponentCount or caller override)
   * @param {string[]} [archetypeOverrides]  – optional fixed archetypes, else random
   */
  spawnOpponents(count, archetypeOverrides = []) {
    const archetypeList = Object.values(ARCHETYPES);
    const usedNames = [];

    this.opponents = [];
    for (let i = 0; i < count; i++) {
      const name = pickDriverName(usedNames);
      usedNames.push(name);

      const archetype = archetypeOverrides[i]
        ?? archetypeList[Math.floor(Math.random() * archetypeList.length)];

      // Stagger start positions along first waypoint so they're not stacked
      const startWaypoint = { ...this.waypoints[0] };
      startWaypoint.x += (i + 1) * 6; // offset each car by 6 units

      const waypointsForOpp = [startWaypoint, ...this.waypoints.slice(1)];

      this.opponents.push(new AIOpponent({
        name,
        archetype,
        difficultySpeed: this.diffConfig.speedFraction,
        waypoints:       waypointsForOpp,
        carColor:        this._randomCarColor(),
      }));
    }

    return this.opponents;
  }

  // ─── Race Lifecycle ───────────────────────────────────────────────────────

  /**
   * Begin the pre-race countdown.
   * Calls onCountdown(n) for n = 3, 2, 1, 0 (GO).
   * Then calls startRace().
   */
  beginCountdown() {
    this.state = RACE_STATE.COUNTDOWN;
    let count = 3;

    this.onCountdown(count);

    this._countdownInterval = setInterval(() => {
      count--;
      this.onCountdown(count);
      if (count <= 0) {
        clearInterval(this._countdownInterval);
        this._startRace();
      }
    }, 1000);
  }

  /** Internal: transition from countdown into live racing. */
  _startRace() {
    this.state            = RACE_STATE.RACING;
    this.elapsedTime      = 0;
    this._playerLapStart  = 0;
    this._lastPlayerPosition = 1;

    // Ask Gemini to profile all opponents (async, non-blocking)
    // Gemini key is loaded from config.js at module init — no loadApiKey() needed.
    geminiRaceAI.generatePersonalityProfiles(this.opponents, {
      raceType:   this.raceData.type,
      difficulty: this.difficulty,
      totalLaps:  this.raceData.laps,
    }).then(profiles => {
      for (const opp of this.opponents) {
        const profile = profiles.get(opp.name);
        if (profile) {
          opp.applyGeminiUpdate(profile);
          if (profile.commentary) {
            this.onCommentary(opp.name, profile.commentary);
          }
        }
      }
    });

    // Start update loop (60fps target)
    let lastTime = performance.now();
    const loop = (now) => {
      if (this.state !== RACE_STATE.RACING) return;
      const dt = Math.min((now - lastTime) / 1000, 0.1); // cap dt at 100ms
      lastTime = now;
      this._update(dt);
      this._updateLoop = requestAnimationFrame(loop);
    };
    this._updateLoop = requestAnimationFrame(loop);
  }

  /** Stop the race loop (e.g., player pauses or race ends). */
  _stopLoop() {
    if (this._updateLoop) {
      cancelAnimationFrame(this._updateLoop);
      this._updateLoop = null;
    }
  }

  // ─── Per-Frame Update ─────────────────────────────────────────────────────

  _update(dt) {
    this.elapsedTime += dt;

    const playerPos = this._calcPlayerWaypointProgress();

    // Update all AI opponents
    for (const opp of this.opponents) {
      opp.update(dt, this.opponents, this.playerState, this.raceData.laps);
      this._scheduleGeminiUpdate(opp, dt);
    }

    // Apply rubber band to AI if enabled
    if (this.diffConfig.rubberBand) {
      this._applyRubberBand(playerPos);
    }

    // Recalculate positions
    this._recalcPositions(playerPos);

    // Check player out-of-bounds
    this._checkPlayerBounds(dt);

    // Track player slipstream
    this._updatePlayerSlipstream(dt);

    // Check for overtakes
    this._detectOvertakeEvents();

    // Rewind buffer
    if (this.diffConfig.rewind) {
      this._recordRewindFrame(dt);
    }

    // Lap tracking for player
    this._trackPlayerLap();

    // Check race completion
    this._checkRaceComplete();

    // Fire position update callback every frame
    this.onPositionUpdate(this.positions);
  }

  // ─── Position Calculation ─────────────────────────────────────────────────

  _calcPlayerWaypointProgress() {
    const p = this.playerState;
    if (!p) return 0;
    // RaceData/Waypoint system should expose this; we approximate here
    const laps = p.lapsCompleted ?? 0;
    const wpIdx = p.waypointIndex ?? 0;
    return laps * this.waypoints.length + wpIdx;
  }

  _recalcPositions(playerProgress) {
    const entries = [
      { name: 'Player', progress: playerProgress, isPlayer: true,
        lapsCompleted: this.playerState?.lapsCompleted ?? 0, finished: false },
      ...this.opponents.map(o => ({
        name: o.name, progress: o.waypointProgress,
        isPlayer: false, lapsCompleted: o.lapsCompleted,
        finished: o.finished,
      })),
    ];

    // Sort: more progress = higher (lower position number)
    entries.sort((a, b) => b.progress - a.progress);

    this.positions = entries.map((e, i) => ({ ...e, position: i + 1 }));

    // Write position back into each AI opponent
    for (const opp of this.opponents) {
      const entry = this.positions.find(p => p.name === opp.name);
      if (entry) opp.racePosition = entry.position;
    }
  }

  _getPlayerPosition() {
    return this.positions.find(p => p.isPlayer)?.position ?? 1;
  }

  // ─── Rubber Band ──────────────────────────────────────────────────────────

  _applyRubberBand(playerProgress) {
    const playerPos = this._getPlayerPosition();
    const totalCars = this.opponents.length + 1;
    const strength  = this.diffConfig.rubberStrength;

    for (const opp of this.opponents) {
      const gap = playerProgress - opp.waypointProgress;

      if (playerPos > 3 && gap > 0) {
        // Player is losing — AI slightly slows to let them catch up
        opp.speedModifier = Math.max(0.90, opp.speedModifier - strength * 0.01);
      } else if (playerPos === 1 && gap < -20) {
        // Player is way ahead — AI gets a nudge
        opp.speedModifier = Math.min(1.10, opp.speedModifier + strength * 0.01);
      }
    }
  }

  // ─── Gemini Scheduling ────────────────────────────────────────────────────

  _scheduleGeminiUpdate(opp, dt) {
    if (!geminiRaceAI.hasApiKey) return;

    const last = this._geminiSchedule[opp.name] ?? -Infinity;
    if (this.elapsedTime - last < this._GEMINI_INTERVAL) return;

    // Mark as scheduled immediately to avoid duplicate calls
    this._geminiSchedule[opp.name] = this.elapsedTime;

    const lapsRemaining = this.raceData.laps - opp.lapsCompleted;

    geminiRaceAI.getMidRaceDecision(opp, {
      raceType:       this.raceData.type,
      difficulty:     this.difficulty,
      playerPosition: this._getPlayerPosition(),
      totalCars:      this.opponents.length + 1,
      lapsRemaining,
      totalLaps:      this.raceData.laps,
    }).then(data => {
      opp.applyGeminiUpdate(data);
      if (data.commentary) {
        this.onCommentary(opp.name, data.commentary);
      }
    }).catch(err => {
      console.warn(`[RaceManager] Gemini mid-race update failed for ${opp.name}:`, err);
    });
  }

  // ─── Overtake Detection ───────────────────────────────────────────────────

  _detectOvertakeEvents() {
    const currentPosition = this._getPlayerPosition();
    if (currentPosition !== this._lastPlayerPosition) {
      const gained = currentPosition < this._lastPlayerPosition;
      this.onOvertake(gained ? 'gained' : 'lost', currentPosition);

      // Trigger Gemini overtake response for adjacent AI car
      const adjacentOpp = this._findAdjacentOpponent(currentPosition, gained);
      if (adjacentOpp) {
        geminiRaceAI.getOvertakeResponse(adjacentOpp, gained).then(data => {
          adjacentOpp.applyGeminiUpdate(data);
          if (data.commentary) {
            this.onCommentary(adjacentOpp.name, data.commentary);
          }
        });
      }

      this._lastPlayerPosition = currentPosition;
    }
  }

  _findAdjacentOpponent(playerPosition, gained) {
    const targetPosition = gained ? playerPosition + 1 : playerPosition - 1;
    const entry = this.positions.find(p => !p.isPlayer && p.position === targetPosition);
    if (!entry) return null;
    return this.opponents.find(o => o.name === entry.name) ?? null;
  }

  // ─── Player Slipstream ────────────────────────────────────────────────────

  _updatePlayerSlipstream(dt) {
    const p = this.playerState;
    if (!p) return;

    const DRAFT_DIST  = 14;
    const DRAFT_ANGLE = 0.5; // radians

    let inDraft = false;
    for (const opp of this.opponents) {
      const dx = opp.x - p.x;
      const dy = opp.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DRAFT_DIST) {
        const angle = Math.abs(Math.atan2(dy, dx) - (p.heading ?? 0));
        if (angle < DRAFT_ANGLE) { inDraft = true; break; }
      }
    }

    if (inDraft) {
      this.playerSlipstreamSeconds += dt;
      this.playerSlipstream = this.playerSlipstreamSeconds >= 0.5;
    } else {
      this.playerSlipstreamSeconds = 0;
      this.playerSlipstream = false;
    }

    // Write back so driving physics can read it
    if (this.playerState) {
      this.playerState.inSlipstream = this.playerSlipstream;
      this.playerState.slipstreamBonus = this.playerSlipstream ? 0.08 : 0;
    }
  }

  // ─── Out-of-Bounds ────────────────────────────────────────────────────────

  checkPlayerInBounds(inBounds, checkpointPos) {
    if (checkpointPos) this._lastValidCheckpoint = checkpointPos;
    this._playerInBounds = inBounds;
  }

  _checkPlayerBounds(dt) {
    if (this._playerInBounds) {
      this._outOfBoundsTimer = 0;
      return;
    }
    this._outOfBoundsTimer += dt;
    const remaining = Math.max(0, 5 - this._outOfBoundsTimer);
    this.onOutOfBounds(remaining);

    if (this._outOfBoundsTimer >= 5) {
      this._resetPlayerToCheckpoint();
    }
  }

  _resetPlayerToCheckpoint() {
    if (!this._lastValidCheckpoint || !this.playerState) return;
    this.playerState.x = this._lastValidCheckpoint.x;
    this.playerState.y = this._lastValidCheckpoint.y;
    this.playerState.z = this._lastValidCheckpoint.z ?? 0;
    this.playerState.speed = 0;
    this._outOfBoundsTimer = 0;
    this._playerInBounds   = true;
  }

  // ─── Rewind ───────────────────────────────────────────────────────────────

  _recordRewindFrame(dt) {
    if (!this.playerState) return;
    this._rewindBuffer.push({
      x:             this.playerState.x,
      y:             this.playerState.y,
      z:             this.playerState.z,
      heading:       this.playerState.heading,
      speed:         this.playerState.speed,
      lapsCompleted: this.playerState.lapsCompleted,
      waypointIndex: this.playerState.waypointIndex,
      time:          this.elapsedTime,
    });

    // Prune buffer older than MAX_REWIND seconds
    while (
      this._rewindBuffer.length > 1 &&
      this.elapsedTime - this._rewindBuffer[0].time > this._MAX_REWIND
    ) {
      this._rewindBuffer.shift();
    }
  }

  /**
   * Called externally when player holds the rewind button.
   * Pops frames from the buffer and applies them to playerState.
   */
  applyRewind() {
    if (!this.diffConfig.rewind) return; // not available on Pro/Unbeatable
    if (!this._rewindBuffer.length)      return;

    const frame = this._rewindBuffer.pop();
    if (!frame || !this.playerState) return;

    Object.assign(this.playerState, frame);
  }

  // ─── Lap Tracking ─────────────────────────────────────────────────────────

  _trackPlayerLap() {
    const p = this.playerState;
    if (!p) return;

    const lapCount = p.lapsCompleted ?? 0;

    if (lapCount > this._playerLapTimes.length) {
      const lapTime = this.elapsedTime - this._playerLapStart;
      this._playerLapTimes.push(lapTime);
      if (lapTime < this._playerBestLap) this._playerBestLap = lapTime;
      this._playerLapStart = this.elapsedTime;
    }
  }

  // ─── Race Completion ──────────────────────────────────────────────────────

  _checkRaceComplete() {
    const p = this.playerState;
    if (!p) return;

    const playerDone = (p.lapsCompleted ?? 0) >= this.raceData.laps;
    const allDone    = playerDone && this.opponents.every(o => o.finished);

    if (playerDone && this.state === RACE_STATE.RACING) {
      this.state = RACE_STATE.FINISHED;
      this._stopLoop();
      this._finaliseRace();
    }
  }

  async _finaliseRace() {
    const playerPosition = this._getPlayerPosition();
    const results = this._buildResults(playerPosition);

    // Async: get Gemini race summary (non-blocking on results display)
    geminiRaceAI.generateRaceSummary({
      positions:  results.positions,
      bestLap:    this._playerBestLap === Infinity ? null : this._playerBestLap,
      raceType:   this.raceData.type,
      difficulty: this.difficulty,
    }).then(summary => {
      results.geminiFlavourText = summary;
      this.onRaceEnd(results);
    }).catch(() => {
      results.geminiFlavourText = '';
      this.onRaceEnd(results);
    });
  }

  // ─── Results & Rewards ────────────────────────────────────────────────────

  /**
   * Build the full results object sent to onRaceEnd.
   * Includes credit + XP payouts per Section 7.8.
   */
  _buildResults(playerPosition) {
    const diff   = this.diffConfig;
    const data   = this.raceData;

    // Assists-off XP bonus
    const assistsOffBonus = this._calcAssistsOffBonus();

    // Position credit modifier (cap at last slot)
    const posIdx     = Math.min(playerPosition - 1, POSITION_CREDIT_MOD.length - 1);
    const posMod     = POSITION_CREDIT_MOD[posIdx];

    const creditEarned = Math.round(data.basePayout * diff.creditMul * posMod * (1 + assistsOffBonus));
    const xpEarned     = Math.round(data.baseXP     * diff.creditMul * (1 + assistsOffBonus));

    // Check for bonus XP events
    const bonusXP = [];
    if (playerPosition === 1 && !this._hasWonBefore()) {
      bonusXP.push({ label: 'First time winning this race', xp: 500 });
    }
    if (!this._usedRewind) {
      bonusXP.push({ label: 'Clean race — no rewinds', xp: 200 });
    }
    const totalBonusXP = bonusXP.reduce((s, b) => s + b.xp, 0);

    // Sorted final positions (all cars)
    const sortedPositions = [...this.positions].sort((a, b) => a.position - b.position);

    return {
      raceId:         data.id,
      raceName:       data.name,
      raceType:       data.type,
      difficulty:     this.difficulty,
      playerPosition,
      totalCars:      this.opponents.length + 1,
      finishTime:     this.elapsedTime,
      bestLapTime:    this._playerBestLap === Infinity ? null : this._playerBestLap,
      lapTimes:       this._playerLapTimes,
      creditEarned,
      xpEarned:       xpEarned + totalBonusXP,
      bonusXP,
      assistsOffBonus,
      positions:      sortedPositions,
      wheelspin:      this._shouldAwardWheelspin(playerPosition),
      geminiFlavourText: '', // filled in async after this returns
    };
  }

  _calcAssistsOffBonus() {
    let bonus = 0;
    const a = this.assists;
    if (!a.ABS)             bonus += ASSIST_XP_BONUS.ABS;
    if (!a.TractionControl) bonus += ASSIST_XP_BONUS.TractionControl;
    if (!a.StabilityControl)bonus += ASSIST_XP_BONUS.StabilityControl;
    if (!a.SteeringAssist)  bonus += ASSIST_XP_BONUS.SteeringAssist;
    if (!a.BrakingAssist)   bonus += ASSIST_XP_BONUS.BrakingAssist;
    if (!a.AutomaticGears)  bonus += ASSIST_XP_BONUS.ManualGears;
    return bonus;
  }

  _shouldAwardWheelspin(position) {
    // Award wheelspin for top 3 finishes; higher difficulty = higher chance on lower positions
    if (position === 1) return true;
    if (position === 2 && Math.random() < 0.5) return true;
    if (position === 3 && Math.random() < 0.2) return true;
    return false;
  }

  _hasWonBefore() {
    try {
      const key = `race_won_${this.raceData.id}`;
      return localStorage.getItem(key) === '1';
    } catch { return false; }
  }

  _markAsWon() {
    try { localStorage.setItem(`race_won_${this.raceData.id}`, '1'); } catch { /* ignore */ }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  _randomCarColor() {
    const colours = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#ecf0f1'];
    return colours[Math.floor(Math.random() * colours.length)];
  }

  /** Track whether rewind was used this race (affects clean race bonus). */
  get _usedRewind() {
    return this._rewindBuffer.length === 0; // if we cleared it we never recorded
  }

  // ─── Public helpers for external systems ──────────────────────────────────

  /** Returns { position, gapAhead, gapBehind } for the player HUD. */
  getPlayerHUDData() {
    const pos  = this._getPlayerPosition();
    const all  = this.positions;
    const idx  = all.findIndex(p => p.isPlayer);

    const progressOf = (entry) => entry?.progress ?? 0;
    const playerProgress = progressOf(all[idx]);

    const ahead  = all[idx - 1];
    const behind = all[idx + 1];

    // Approximate gap as waypoint difference × 2 seconds per waypoint (rough)
    const gapAhead  = ahead  ? ((progressOf(ahead)  - playerProgress) * 2).toFixed(1) : null;
    const gapBehind = behind ? ((playerProgress - progressOf(behind)) * 2).toFixed(1) : null;

    return {
      position:   pos,
      totalCars:  all.length,
      gapAhead:   gapAhead  ? `+${gapAhead}s`  : null,
      gapBehind:  gapBehind ? `-${gapBehind}s` : null,
      slipstream: this.playerSlipstream,
      elapsed:    this.elapsedTime,
    };
  }

  /** Return all opponent positions for the expandable leaderboard HUD. */
  getLeaderboard() {
    return [...this.positions].sort((a, b) => a.position - b.position);
  }
}

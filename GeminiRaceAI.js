/**
 * GeminiRaceAI.js
 * Part 7 — Race System & AI (Section 7.6.3)
 *
 * Handles all Google Gemini API calls for the race's AI behaviour layer.
 *
 * Design rules (from game plan):
 *  - Called at SPECIFIC MOMENTS only (not per-frame)
 *  - Async — game never pauses to wait
 *  - Falls back to static modifiers on failure
 *  - One call per AI per 30-second window
 *  - Prompts are short + structured: JSON in, JSON out
 *
 * API key storage:
 *  - Injected at deploy time via GitHub Actions secret GEMINI_API_KEY → config.js
 *  - Sent only to api.generativelanguage.googleapis.com
 */

import { GEMINI_API_KEY } from '../config.js';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';


// ─── Fallback Static Decisions ────────────────────────────────────────────
// Used when no API key is present or a call fails.

const STATIC_FALLBACKS = {
  race_start: (archetype) => {
    const map = {
      Pusher:     { aggression: 8,  speed_modifier: 1.02, commentary: `${archetype} is ready to push.` },
      Pacer:      { aggression: 2,  speed_modifier: 1.00, commentary: 'Running a clean, consistent pace.' },
      Sprinter:   { aggression: 5,  speed_modifier: 1.05, commentary: 'Off the line like a shot.' },
      Hunter:     { aggression: 3,  speed_modifier: 0.96, commentary: 'Holding back — for now.' },
      Wildcard:   { aggression: 5,  speed_modifier: 1.00, commentary: 'Anything could happen.' },
      Technician: { aggression: 1,  speed_modifier: 1.01, commentary: 'Smooth and precise.' },
    };
    return map[archetype] ?? { aggression: 5, speed_modifier: 1.0, commentary: '' };
  },

  mid_race: (position, totalCars) => {
    if (position === 1)    return { decision: 'C', aggression: 4, speed_modifier: 1.00, commentary: 'Controlling the gap up front.' };
    if (position <= 3)     return { decision: 'B', aggression: 7, speed_modifier: 1.02, commentary: 'Defending hard.' };
    return                        { decision: 'A', aggression: 6, speed_modifier: 1.03, commentary: 'Pushing to get through.' };
  },

  overtake: (isBeingOvertaken) => {
    if (isBeingOvertaken) return { decision: 'B', aggression: 9, speed_modifier: 1.03, commentary: 'Not letting through without a fight.' };
    return                       { decision: 'A', aggression: 7, speed_modifier: 1.04, commentary: 'Making the move.' };
  },

  race_end: () => ({
    summary: 'A hard-fought race from start to finish. Every position was earned.',
  }),
};

// ─── GeminiRaceAI ─────────────────────────────────────────────────────────
export class GeminiRaceAI {
  constructor() {
    // Key injected at build time via GitHub Actions → config.js.
    // Falls back to static AI if not set (local dev / missing secret).
    this._apiKey = (GEMINI_API_KEY && GEMINI_API_KEY !== 'PLACEHOLDER')
      ? GEMINI_API_KEY : null;
  }

  get hasApiKey() { return !!this._apiKey; }

  // ─── Public Call Methods ───────────────────────────────────────────────

  /**
   * Called at race start to generate personality profiles for all AI opponents.
   * @param {import('./AIOpponent.js').AIOpponent[]} opponents
   * @param {object} raceContext  – { raceType, difficulty, totalLaps }
   * @returns {Promise<Map<string, object>>}  name → Gemini data
   */
  async generatePersonalityProfiles(opponents, raceContext) {
    const results = new Map();

    if (!this._apiKey) {
      // Fallback: generate static profile per archetype
      for (const opp of opponents) {
        results.set(opp.name, STATIC_FALLBACKS.race_start(opp.archetype));
      }
      return results;
    }

    // Build a single batch prompt to minimise API calls
    const promptData = opponents.map(o => ({
      name:      o.name,
      archetype: o.archetype,
    }));

    const prompt = `
You are generating AI driver personalities for a racing game.
Race type: ${raceContext.raceType}
Difficulty: ${raceContext.difficulty}
Total laps: ${raceContext.totalLaps}

For each driver below, return ONLY a JSON array (no markdown, no extra text).
Each element must have: name, aggression (0-10), speed_modifier (0.95-1.05), commentary (short string).

Drivers: ${JSON.stringify(promptData)}
`.trim();

    try {
      const raw = await this._callGemini(prompt);
      // Strip any accidental markdown fences
      const clean = raw.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.name) results.set(item.name, item);
        }
      }
    } catch (err) {
      console.warn('[GeminiRaceAI] Personality profile call failed, using fallback.', err);
      for (const opp of opponents) {
        results.set(opp.name, STATIC_FALLBACKS.race_start(opp.archetype));
      }
    }

    // Fill any gaps from partial parse
    for (const opp of opponents) {
      if (!results.has(opp.name)) {
        results.set(opp.name, STATIC_FALLBACKS.race_start(opp.archetype));
      }
    }

    return results;
  }

  /**
   * Called every ~30 seconds per AI car during a race.
   * Returns a single behavioural decision object.
   *
   * @param {import('./AIOpponent.js').AIOpponent} opponent
   * @param {object} raceState
   *   { raceType, difficulty, playerPosition, totalCars, lapsRemaining, totalLaps }
   * @returns {Promise<object>}  { decision, aggression, speed_modifier, commentary }
   */
  async getMidRaceDecision(opponent, raceState) {
    if (!this._apiKey) {
      return STATIC_FALLBACKS.mid_race(opponent.racePosition, raceState.totalCars);
    }

    const snap = opponent.getRaceStateSnapshot(raceState.playerPosition, raceState.totalCars);

    const prompt = `
Race state update — racing game AI behaviour system.
Race Type: ${raceState.raceType}
Difficulty: ${raceState.difficulty}
Laps Remaining: ${raceState.lapsRemaining} of ${raceState.totalLaps}
Player Position: ${raceState.playerPosition} of ${raceState.totalCars}

AI Driver: ${snap.name} (${snap.archetype})
Current Position: ${snap.position} of ${snap.totalCars}
Current Aggression: ${snap.aggression}

Given this race state, should ${snap.name}:
A) Push hard to attack the car ahead
B) Defend current position against the car behind
C) Maintain pace and play it safe

Respond ONLY with a JSON object — no markdown, no extra text:
{ "decision": "A" | "B" | "C", "aggression": 0-10, "speed_modifier": 0.95-1.05, "commentary": "short string" }
`.trim();

    try {
      const raw = await this._callGemini(prompt);
      const clean = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch (err) {
      console.warn(`[GeminiRaceAI] Mid-race decision failed for ${opponent.name}, using fallback.`, err);
      return STATIC_FALLBACKS.mid_race(opponent.racePosition, raceState.totalCars);
    }
  }

  /**
   * Called when an overtake event is triggered (player passes or is passed by AI).
   * @param {import('./AIOpponent.js').AIOpponent} opponent
   * @param {boolean} isBeingOvertaken  – true if player is passing this AI
   * @returns {Promise<object>}
   */
  async getOvertakeResponse(opponent, isBeingOvertaken) {
    if (!this._apiKey) {
      return STATIC_FALLBACKS.overtake(isBeingOvertaken);
    }

    const context = isBeingOvertaken
      ? `The player is attempting to overtake ${opponent.name}.`
      : `${opponent.name} is attempting to overtake the player.`;

    const prompt = `
${context}
Driver archetype: ${opponent.archetype}
Current aggression: ${opponent.aggression}

Respond with how ${opponent.name} reacts. ONLY return JSON — no markdown:
{ "decision": "A" | "B" | "C", "aggression": 0-10, "speed_modifier": 0.95-1.05, "commentary": "short string" }
A = press the attack / fight back hard
B = hold position / defensive move
C = concede / back off
`.trim();

    try {
      const raw = await this._callGemini(prompt);
      const clean = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch (err) {
      console.warn(`[GeminiRaceAI] Overtake response failed for ${opponent.name}.`, err);
      return STATIC_FALLBACKS.overtake(isBeingOvertaken);
    }
  }

  /**
   * Called at race end to generate a flavour summary for the results screen.
   * @param {object} resultData  – { positions, bestLap, raceType, difficulty }
   * @returns {Promise<string>}  Summary text
   */
  async generateRaceSummary(resultData) {
    if (!this._apiKey) {
      return STATIC_FALLBACKS.race_end().summary;
    }

    const { positions, bestLap, raceType, difficulty } = resultData;
    const podium = positions.slice(0, 3).map((p, i) => `${i + 1}. ${p.name}`).join(', ');

    const prompt = `
Write a 1-2 sentence exciting race commentary for a racing game results screen.
Race type: ${raceType}
Difficulty: ${difficulty}
Podium: ${podium}
Best lap: ${bestLap ? bestLap.toFixed(2) + 's' : 'unknown'}

Keep it energetic and under 30 words. No quotation marks. No markdown.
`.trim();

    try {
      const raw = await this._callGemini(prompt);
      return raw.trim();
    } catch {
      return STATIC_FALLBACKS.race_end().summary;
    }
  }

  // ─── Core API Call ────────────────────────────────────────────────────

  /**
   * Low-level Gemini API call.
   * Returns the first text content from the response.
   * Throws on network/API error.
   *
   * @param {string} userPrompt
   * @returns {Promise<string>}
   */
  async _callGemini(userPrompt) {
    const url = `${GEMINI_ENDPOINT}?key=${this._apiKey}`;

    const body = {
      contents: [
        {
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature:     0.7,
        maxOutputTokens: 200,
      },
    };

    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Gemini API ${response.status}: ${errBody}`);
    }

    const data = await response.json();

    // Navigate the Gemini response structure
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty content.');

    return text;
  }
}

// ─── Singleton export ──────────────────────────────────────────────────────
// One GeminiRaceAI instance is shared across the whole game session.
export const geminiRaceAI = new GeminiRaceAI();

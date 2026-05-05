/**
 * PART 3 — On-Foot Mechanics
 * Horizon City — On-Foot System
 *
 * Covers:
 *  - GameStateManager (DRIVING / EXIT_ANIM / ON_FOOT / ENTRY_ANIM / BUILDING)
 *  - AvatarController  (movement, sprint, jump, animations)
 *  - AvatarPhysics     (Rapier rigid body + collider)
 *  - CameraTransition  (smooth lerp between car cam and avatar cam)
 *  - BuildingInteraction (proximity prompt, fade, shop UI overlay)
 *  - WorldInteraction   (collectibles, NPCs, photo mode)
 *  - PhoneMenu          (pause overlay)
 *  - CarPersistence     (parked car, green outline, retrieve fee)
 *
 * Dependencies: Three.js, Rapier.js (already initialised by Part 2)
 * Entry point:  OnFootSystem.init(scene, world, carController, camera, domRoot)
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GameState = Object.freeze({
  DRIVING:     'DRIVING',
  EXIT_ANIM:   'EXIT_ANIM',
  ON_FOOT:     'ON_FOOT',
  ENTRY_ANIM:  'ENTRY_ANIM',
  BUILDING:    'BUILDING',
  PHOTO_MODE:  'PHOTO_MODE',
});

const AVATAR_WALK_SPEED   = 1.39;   // m/s ≈ 5 km/h
const AVATAR_SPRINT_SPEED = 4.17;   // m/s ≈ 15 km/h
const AVATAR_JUMP_FORCE   = 5.0;    // Rapier impulse (upward)
const EXIT_SPEED_LIMIT    = 5.56;   // m/s ≈ 20 km/h
const CAR_ENTER_RADIUS    = 8.0;    // metres
const BUILDING_PROMPT_RADIUS = 3.0; // metres
const NPC_INTERACT_RADIUS = 2.5;    // metres
const COLLECTIBLE_RADIUS  = 1.5;    // metres
const CAM_TRANSITION_TIME = 0.8;    // seconds
const FADE_DURATION       = 0.5;    // seconds
const CAR_RETRIEVE_COST   = 50;     // credits

// Animation state labels — map to your animation clip names
const AnimState = Object.freeze({
  IDLE:        'idle',
  WALK:        'walk',
  SPRINT:      'sprint',
  JUMP:        'jump',
  INTERACT:    'interact',
  ENTER_CAR:   'enter_car',
  EXIT_CAR:    'exit_car',
});

// ---------------------------------------------------------------------------
// GameStateManager
// ---------------------------------------------------------------------------

export class GameStateManager extends EventTarget {
  constructor() {
    super();
    this._state = GameState.DRIVING;
  }

  get state() { return this._state; }

  transition(next) {
    const prev = this._state;
    this._state = next;
    this.dispatchEvent(new CustomEvent('statechange', { detail: { prev, next } }));
  }

  is(s) { return this._state === s; }
}

// ---------------------------------------------------------------------------
// AvatarPhysics  —  Rapier-backed rigid body for the avatar
// ---------------------------------------------------------------------------

export class AvatarPhysics {
  /**
   * @param {RAPIER.World}  rapierWorld
   * @param {THREE.Vector3} spawnPos
   */
  constructor(rapierWorld, spawnPos) {
    this._world = rapierWorld;
    this._isGrounded = false;
    this._body = null;
    this._collider = null;
    this._init(spawnPos);
  }

  _init(pos) {
    const RAPIER = this._world.RAPIER ?? window.RAPIER;

    // Kinematic / dynamic?  We use a dynamic body + locking rotations.
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + 1.0, pos.z)
      .lockRotations();          // prevent tipping
    this._body = this._world.createRigidBody(bodyDesc);

    // Capsule collider — radius 0.35 m, half-height 0.55 m  (total ~1.8 m)
    const collDesc = RAPIER.ColliderDesc.capsule(0.55, 0.35)
      .setFriction(0.7)
      .setRestitution(0.0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this._collider = this._world.createCollider(collDesc, this._body);
  }

  /** Call once per frame with the desired velocity (XZ plane only). */
  setDesiredVelocity(vx, vz) {
    const current = this._body.linvel();
    this._body.setLinvel({ x: vx, y: current.y, z: vz }, true);
  }

  jump() {
    if (!this._isGrounded) return;
    const v = this._body.linvel();
    this._body.setLinvel({ x: v.x, y: AVATAR_JUMP_FORCE, z: v.z }, true);
    this._isGrounded = false;
  }

  /** Inform physics about ground contact (from collision events or raycast). */
  setGrounded(grounded) { this._isGrounded = grounded; }
  get isGrounded() { return this._isGrounded; }

  get position() {
    const t = this._body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get linvel() {
    const v = this._body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  /** Teleport (used during car-exit / car-entry). */
  setPosition(pos) {
    this._body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this._body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Disable physics (while driving). */
  sleep() { this._body.sleep(); }

  /** Re-enable physics (when going on foot). */
  wake() { this._body.wakeUp(); }

  destroy() {
    this._world.removeCollider(this._collider, false);
    this._world.removeRigidBody(this._body);
  }
}

// ---------------------------------------------------------------------------
// AvatarController  —  input → movement → animation
// ---------------------------------------------------------------------------

export class AvatarController {
  /**
   * @param {THREE.Object3D}  avatarMesh   — your skinned avatar mesh
   * @param {AvatarPhysics}   physics
   * @param {THREE.Camera}    camera
   * @param {InputState}      input        — shared input snapshot (see below)
   * @param {AnimationMixer}  mixer        — THREE.AnimationMixer
   * @param {Object}          clips        — { idle, walk, sprint, jump, interact, enter_car, exit_car }
   */
  constructor(avatarMesh, physics, camera, input, mixer, clips) {
    this.mesh    = avatarMesh;
    this.physics = physics;
    this.camera  = camera;
    this.input   = input;
    this.mixer   = mixer;
    this.clips   = clips;

    this._animState   = null;
    this._currentAction = null;
    this._yaw         = 0;  // avatar facing angle (radians)
    this._active      = false;
  }

  activate(position) {
    this.mesh.visible = true;
    this.physics.wake();
    this.physics.setPosition(position);
    this._active = true;
    this._playAnim(AnimState.IDLE);
  }

  deactivate() {
    this.mesh.visible = false;
    this.physics.sleep();
    this._active = false;
  }

  /**
   * Call every frame while ON_FOOT.
   * @param {number} dt — delta time in seconds
   * @returns {{ wantsInteract: boolean, wantsPhone: boolean }}
   */
  update(dt) {
    if (!this._active) return { wantsInteract: false, wantsPhone: false };

    // Sync mesh to physics body
    const pos = this.physics.position;
    // Offset so mesh feet land at physics capsule bottom
    this.mesh.position.set(pos.x, pos.y - 1.1, pos.z);

    // --- Determine move direction relative to camera ---
    const inp = this.input;
    const camYaw = Math.atan2(
      this.camera.position.x - pos.x,
      this.camera.position.z - pos.z,
    ) + Math.PI;

    let moveX = 0, moveZ = 0;
    if (inp.forward)  { moveX -= Math.sin(camYaw); moveZ -= Math.cos(camYaw); }
    if (inp.backward) { moveX += Math.sin(camYaw); moveZ += Math.cos(camYaw); }
    if (inp.left)     { moveX -= Math.cos(camYaw); moveZ += Math.sin(camYaw); }
    if (inp.right)    { moveX += Math.cos(camYaw); moveZ -= Math.sin(camYaw); }

    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    const isMoving = len > 0.01;
    const isSprinting = inp.sprint && isMoving;
    const speed = isSprinting ? AVATAR_SPRINT_SPEED : AVATAR_WALK_SPEED;

    if (isMoving) {
      const nx = moveX / len, nz = moveZ / len;
      this.physics.setDesiredVelocity(nx * speed, nz * speed);
      // Rotate avatar to face movement direction
      this._yaw = Math.atan2(nx, nz);
      this.mesh.rotation.y = this._yaw;
    } else {
      this.physics.setDesiredVelocity(0, 0);
    }

    // --- Jump ---
    if (inp.jumpPressed) {
      this.physics.jump();
      this._playAnim(AnimState.JUMP);
    }

    // --- Determine grounded state via tiny downward raycast ---
    // (In a real Rapier project you'd use a rapier ray or onCollisionEvent)
    // We approximate: if the vertical velocity is near zero and has been falling.
    const vy = this.physics.linvel.y;
    if (Math.abs(vy) < 0.3) this.physics.setGrounded(true);
    else                     this.physics.setGrounded(false);

    // --- Animation state machine ---
    if (!inp.jumpPressed) {
      if (!isMoving)     this._playAnim(AnimState.IDLE);
      else if (isSprinting) this._playAnim(AnimState.SPRINT);
      else               this._playAnim(AnimState.WALK);
    }

    this.mixer.update(dt);

    return {
      wantsInteract: inp.interactPressed,
      wantsPhone:    inp.phonePressed,
    };
  }

  // --- Animation helpers ---

  _playAnim(state) {
    if (this._animState === state) return;
    this._animState = state;

    const clip = this.clips[state];
    if (!clip) return;

    const prev = this._currentAction;
    this._currentAction = this.mixer.clipAction(clip);

    if (prev && prev !== this._currentAction) {
      prev.fadeOut(0.2);
    }
    this._currentAction.reset().fadeIn(0.2).play();
  }

  /** Play a one-shot animation (exit/entry car). Returns duration. */
  playOneShotAnim(state, onDone) {
    const clip = this.clips[state];
    if (!clip) { setTimeout(onDone, 800); return 0.8; }

    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();

    const duration = clip.duration;
    this.mixer.addEventListener('finished', function handler(e) {
      if (e.action === action) {
        onDone();
        this.removeEventListener('finished', handler);
      }
    }.bind(this.mixer));

    return duration;
  }
}

// ---------------------------------------------------------------------------
// CameraTransition
// ---------------------------------------------------------------------------

export class CameraTransition {
  constructor(camera) {
    this._camera = camera;
    this._running = false;
  }

  /**
   * Smoothly move camera from current position/target to a new one.
   * @param {THREE.Vector3} targetPos
   * @param {THREE.Quaternion} targetQuat
   * @param {number} duration  seconds
   * @param {Function} onDone
   */
  start(targetPos, targetQuat, duration, onDone) {
    this._startPos  = this._camera.position.clone();
    this._startQuat = this._camera.quaternion.clone();
    this._endPos    = targetPos.clone();
    this._endQuat   = targetQuat.clone();
    this._duration  = duration;
    this._elapsed   = 0;
    this._onDone    = onDone;
    this._running   = true;
  }

  update(dt) {
    if (!this._running) return;
    this._elapsed += dt;
    const t = Math.min(this._elapsed / this._duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out

    this._camera.position.lerpVectors(this._startPos, this._endPos, ease);
    this._camera.quaternion.slerpQuaternions(this._startQuat, this._endQuat, ease);

    if (t >= 1) {
      this._running = false;
      if (this._onDone) this._onDone();
    }
  }

  get isRunning() { return this._running; }
}

// ---------------------------------------------------------------------------
// FadeOverlay  —  full-screen black fade
// ---------------------------------------------------------------------------

export class FadeOverlay {
  constructor(domRoot) {
    this._el = document.createElement('div');
    Object.assign(this._el.style, {
      position:        'fixed',
      inset:           '0',
      background:      '#000',
      opacity:         '0',
      pointerEvents:   'none',
      transition:      `opacity ${FADE_DURATION}s ease`,
      zIndex:          '9999',
    });
    domRoot.appendChild(this._el);
  }

  fadeIn(onPeak) {
    this._el.style.opacity = '1';
    setTimeout(onPeak, FADE_DURATION * 1000);
  }

  fadeOut() {
    this._el.style.opacity = '0';
  }
}

// ---------------------------------------------------------------------------
// ProximityPrompt  —  "[ F ] Enter Car" floating label
// ---------------------------------------------------------------------------

export class ProximityPrompt {
  constructor(domRoot) {
    this._el = document.createElement('div');
    Object.assign(this._el.style, {
      position:        'fixed',
      bottom:          '25%',
      left:            '50%',
      transform:       'translateX(-50%)',
      padding:         '8px 18px',
      background:      'rgba(0,0,0,0.75)',
      color:           '#fff',
      fontSize:        '15px',
      fontFamily:      'monospace',
      borderRadius:    '4px',
      border:          '1px solid rgba(255,255,255,0.3)',
      display:         'none',
      zIndex:          '1000',
    });
    domRoot.appendChild(this._el);
  }

  show(text) {
    this._el.textContent = text;
    this._el.style.display = 'block';
  }

  hide() {
    this._el.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// OutlineEffect  —  simple glow on a Three.js mesh (scale trick)
// ---------------------------------------------------------------------------

export class GlowOutline {
  /**
   * @param {THREE.Object3D} targetMesh
   * @param {THREE.Scene} scene
   * @param {number} color  hex
   */
  constructor(targetMesh, scene, color = 0x00ff88) {
    // Clone mesh, invert normals, scale up slightly → cheap outline
    this._outlineMesh = null;
    this._scene = scene;
    this._target = targetMesh;

    targetMesh.traverse(child => {
      if (child.isMesh && !this._outlineMesh) {
        const mat = new THREE.MeshBasicMaterial({
          color,
          side: THREE.BackSide,
          transparent: true,
          opacity: 0.6,
        });
        this._outlineMesh = new THREE.Mesh(child.geometry, mat);
        this._outlineMesh.scale.multiplyScalar(1.04);
        this._outlineMesh.visible = false;
        scene.add(this._outlineMesh);
      }
    });
  }

  show() {
    if (this._outlineMesh) this._outlineMesh.visible = true;
  }

  hide() {
    if (this._outlineMesh) this._outlineMesh.visible = false;
  }

  update() {
    if (!this._outlineMesh) return;
    // Keep outline in sync with target
    this._outlineMesh.position.copy(this._target.position);
    this._outlineMesh.quaternion.copy(this._target.quaternion);
    this._outlineMesh.scale.copy(this._target.scale).multiplyScalar(1.04);
  }
}

// ---------------------------------------------------------------------------
// Building  —  data structure describing one enterable building
// ---------------------------------------------------------------------------

export class Building {
  /**
   * @param {Object} opts
   * @param {string}          opts.id
   * @param {string}          opts.name
   * @param {THREE.Vector3}   opts.doorPosition
   * @param {string}          opts.shopType    — 'autoshow' | 'parts' | 'livery' | etc.
   * @param {THREE.Object3D}  opts.doorMesh
   */
  constructor(opts) {
    Object.assign(this, opts);
  }
}

// ---------------------------------------------------------------------------
// BuildingInteraction
// ---------------------------------------------------------------------------

export class BuildingInteraction {
  /**
   * @param {Building[]}      buildings
   * @param {FadeOverlay}     fade
   * @param {ProximityPrompt} prompt
   * @param {Function}        openShopUI  — (building) => void
   * @param {Function}        closeShopUI — () => void
   */
  constructor(buildings, fade, prompt, openShopUI, closeShopUI) {
    this.buildings    = buildings;
    this.fade         = fade;
    this.prompt       = prompt;
    this.openShopUI   = openShopUI;
    this.closeShopUI  = closeShopUI;
    this._nearBuilding = null;
    this._insideBuilding = null;
  }

  /**
   * Check proximity. Call every frame while ON_FOOT.
   * @param {THREE.Vector3} avatarPos
   * @param {boolean}       wantsInteract
   * @returns {boolean}  true if now entering a building
   */
  update(avatarPos, wantsInteract) {
    if (this._insideBuilding) return false;

    let nearest = null;
    let nearestDist = Infinity;

    for (const b of this.buildings) {
      const d = avatarPos.distanceTo(b.doorPosition);
      if (d < BUILDING_PROMPT_RADIUS && d < nearestDist) {
        nearest = b;
        nearestDist = d;
      }
    }

    if (nearest !== this._nearBuilding) {
      this._nearBuilding = nearest;
      if (nearest) {
        this.prompt.show(`[ F ]  Enter ${nearest.name}`);
      } else {
        this.prompt.hide();
      }
    }

    if (nearest && wantsInteract) {
      this._enterBuilding(nearest);
      return true;
    }
    return false;
  }

  _enterBuilding(building) {
    this._insideBuilding = building;
    this.prompt.hide();
    this.fade.fadeIn(() => {
      this.openShopUI(building);
      this.fade.fadeOut();
    });
  }

  exitBuilding() {
    if (!this._insideBuilding) return;
    this.fade.fadeIn(() => {
      this.closeShopUI();
      this._insideBuilding = null;
      this.fade.fadeOut();
    });
  }

  get insideBuilding() { return this._insideBuilding; }
}

// ---------------------------------------------------------------------------
// ParkedCar  —  car becomes a static prop while player is on foot
// ---------------------------------------------------------------------------

export class ParkedCar {
  /**
   * @param {THREE.Object3D}  carMesh
   * @param {THREE.Vector3}   position
   * @param {THREE.Quaternion} quaternion
   * @param {THREE.Scene}     scene
   * @param {RAPIER.World}    rapierWorld
   * @param {ProximityPrompt} prompt
   * @param {Object}          playerCredits  — { value: number }
   */
  constructor(carMesh, position, quaternion, scene, rapierWorld, prompt, playerCredits) {
    this.mesh     = carMesh;
    this.scene    = scene;
    this._world   = rapierWorld;
    this.prompt   = prompt;
    this._credits = playerCredits;
    this._outline = new GlowOutline(carMesh, scene, 0x00ff88);
    this._nearPlayer = false;

    // Teleport car mesh
    this.mesh.position.copy(position);
    this.mesh.quaternion.copy(quaternion);

    // Freeze physics body (assumed to be attached to carMesh.userData.rigidBody)
    const body = carMesh.userData.rigidBody;
    if (body) body.sleep();
  }

  /**
   * Call every frame while on foot.
   * @param {THREE.Vector3} avatarPos
   * @param {boolean} wantsInteract
   * @returns {boolean}  true if player wants to re-enter
   */
  update(avatarPos, wantsInteract) {
    const dist = avatarPos.distanceTo(this.mesh.position);
    const near = dist < CAR_ENTER_RADIUS;

    if (near !== this._nearPlayer) {
      this._nearPlayer = near;
      if (near) {
        this._outline.show();
        this.prompt.show('[ F ]  Enter Car');
      } else {
        this._outline.hide();
        this.prompt.hide();
      }
    }

    this._outline.update();

    return near && wantsInteract;
  }

  /** Retrieve car to player location — costs credits. */
  retrieveRemotely(avatarPos) {
    if (this._credits.value < CAR_RETRIEVE_COST) {
      console.warn('[ParkedCar] Not enough credits to retrieve car.');
      return false;
    }
    this._credits.value -= CAR_RETRIEVE_COST;
    this.mesh.position.copy(avatarPos).add(new THREE.Vector3(0, 0, -4));
    console.log(`[ParkedCar] Car retrieved. Cost: ${CAR_RETRIEVE_COST} credits.`);
    return true;
  }

  /** Wake physics when re-entering. */
  wake() {
    const body = this.mesh.userData.rigidBody;
    if (body) body.wakeUp();
  }

  /** Entry point offset — where avatar spawns when exiting the car door. */
  get exitPosition() {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);
    return this.mesh.position.clone().add(right.multiplyScalar(1.5)).add(new THREE.Vector3(0, 0.1, 0));
  }

  get enterPosition() { return this.exitPosition; }
}

// ---------------------------------------------------------------------------
// NPCManager
// ---------------------------------------------------------------------------

export class NPCManager {
  /**
   * @param {Array<{mesh: THREE.Object3D, dialogue: string[], position: THREE.Vector3}>} npcs
   * @param {ProximityPrompt} prompt
   */
  constructor(npcs, prompt) {
    this.npcs = npcs;
    this.prompt = prompt;
    this._nearNpc = null;
  }

  update(avatarPos, wantsInteract) {
    let nearest = null, nearestDist = Infinity;

    for (const npc of this.npcs) {
      const d = avatarPos.distanceTo(npc.mesh.position);
      if (d < NPC_INTERACT_RADIUS && d < nearestDist) {
        nearest = npc;
        nearestDist = d;
      }
    }

    if (nearest !== this._nearNpc) {
      this._nearNpc = nearest;
      if (nearest) this.prompt.show('[ F ]  Talk');
      else         this.prompt.hide();
    }

    if (nearest && wantsInteract) {
      const line = nearest.dialogue[Math.floor(Math.random() * nearest.dialogue.length)];
      console.log(`[NPC] "${line}"`);
      // TODO: pipe to HUD dialogue bubble
      return { spoke: true, line };
    }

    return { spoke: false };
  }
}

// ---------------------------------------------------------------------------
// CollectibleManager  —  bonus boards, barn finds, stickers
// ---------------------------------------------------------------------------

export class CollectibleManager {
  /**
   * @param {Array<{id: string, type: 'board'|'barn'|'sticker', mesh: THREE.Object3D, position: THREE.Vector3}>} collectibles
   * @param {THREE.Scene} scene
   */
  constructor(collectibles, scene) {
    this.collectibles = collectibles;
    this.scene = scene;
    this._collected = new Set();
  }

  /** Call every frame while on foot. */
  update(avatarPos) {
    for (const c of this.collectibles) {
      if (this._collected.has(c.id)) continue;
      const d = avatarPos.distanceTo(c.position);
      if (d < COLLECTIBLE_RADIUS) {
        this._collect(c);
      }
    }
  }

  _collect(c) {
    this._collected.add(c.id);
    this.scene.remove(c.mesh);
    console.log(`[Collectibles] Collected ${c.type}: ${c.id}`);
    this.dispatchEvent?.(new CustomEvent('collected', { detail: c }));
    // TODO: award XP / credits, play pickup sound, show HUD toast
  }

  get collectedCount()  { return this._collected.size; }
  get totalCount()      { return this.collectibles.length; }
}

// ---------------------------------------------------------------------------
// PhoneMenu  —  pause overlay
// ---------------------------------------------------------------------------

export class PhoneMenu {
  constructor(domRoot, gameStateManager, playerCredits) {
    this._gsm    = gameStateManager;
    this._credits = playerCredits;

    this._overlay = document.createElement('div');
    Object.assign(this._overlay.style, {
      position:   'fixed',
      inset:      '0',
      display:    'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.85)',
      zIndex:     '2000',
      fontFamily: 'monospace',
      color:      '#fff',
    });

    this._overlay.innerHTML = `
      <div style="text-align:center;max-width:320px;width:100%">
        <h2 style="letter-spacing:.2em;margin-bottom:24px">📱 PHONE</h2>
        <ul id="phone-menu-list" style="list-style:none;padding:0;margin:0">
          ${[
            ['🚗', 'My Garage',     'garage'],
            ['🗺️', 'Map',           'map'],
            ['👤', 'My Profile',    'profile'],
            ['🏁', 'Race Events',   'races'],
            ['⚙️',  'Settings',     'settings'],
            ['📰', 'Festival News', 'news'],
          ].map(([icon, label, id]) =>
            `<li data-id="${id}" style="padding:12px 0;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.15)">
              ${icon}&nbsp;&nbsp;${label}
            </li>`
          ).join('')}
        </ul>
        <p style="margin-top:18px;opacity:.5;font-size:12px">[ ESC ]  Close</p>
      </div>
    `;
    domRoot.appendChild(this._overlay);

    this._overlay.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => this._onSelect(li.dataset.id));
    });
  }

  open() {
    this._overlay.style.display = 'flex';
  }

  close() {
    this._overlay.style.display = 'none';
  }

  get isOpen() { return this._overlay.style.display !== 'none'; }

  _onSelect(id) {
    console.log(`[PhoneMenu] Selected: ${id}`);
    // TODO: route to actual sub-screens
    // e.g. 'garage' → open garage modal, 'map' → open map, etc.
    this.close();
  }
}

// ---------------------------------------------------------------------------
// PhotoMode
// ---------------------------------------------------------------------------

export class PhotoMode {
  constructor(camera, scene, domRoot) {
    this._camera  = camera;
    this._scene   = scene;
    this._active  = false;
    this._freeCam = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    this._overlay = this._buildOverlay(domRoot);
  }

  _buildOverlay(root) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position:   'fixed',
      inset:      '0',
      display:    'none',
      pointerEvents: 'none',
      zIndex:     '500',
    });
    el.innerHTML = `
      <div style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%);
                  background:rgba(0,0,0,.6);padding:8px 16px;color:#fff;
                  font-family:monospace;border-radius:4px;pointer-events:auto">
        📷 PHOTO MODE &nbsp;|&nbsp;
        <button id="photo-snap">Snap</button>
        <button id="photo-exit" style="margin-left:8px">Exit</button>
      </div>`;
    root.appendChild(el);
    el.querySelector('#photo-snap').addEventListener('click', () => this._snap());
    el.querySelector('#photo-exit').addEventListener('click', () => this.deactivate());
    return el;
  }

  activate(avatarOrCarPos) {
    this._active = true;
    this._freeCam.position.copy(avatarOrCarPos).add(new THREE.Vector3(0, 2, 5));
    this._freeCam.lookAt(avatarOrCarPos);
    this._overlay.style.display = 'block';
    // TODO: freeze game time, hook free-cam into renderer
  }

  deactivate() {
    this._active = false;
    this._overlay.style.display = 'none';
    // TODO: restore main camera
  }

  _snap() {
    // Grab canvas and trigger download
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url, download: `horizon_city_${Date.now()}.png`,
      });
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  get isActive() { return this._active; }
}

// ---------------------------------------------------------------------------
// InputState  —  thin abstraction over keyboard/gamepad
// ---------------------------------------------------------------------------

export class InputState {
  constructor() {
    this.forward       = false;
    this.backward      = false;
    this.left          = false;
    this.right         = false;
    this.sprint        = false;
    this.jumpPressed   = false;   // true for one frame
    this.interactPressed = false; // true for one frame
    this.phonePressed  = false;   // true for one frame

    this._keys = {};
    this._justPressed = new Set();

    window.addEventListener('keydown', e => {
      if (!this._keys[e.code]) this._justPressed.add(e.code);
      this._keys[e.code] = true;
    });
    window.addEventListener('keyup', e => {
      this._keys[e.code] = false;
    });
  }

  /** Call ONCE per frame to snapshot state. */
  poll() {
    const k = this._keys;
    this.forward   = !!(k['KeyW'] || k['ArrowUp']);
    this.backward  = !!(k['KeyS'] || k['ArrowDown']);
    this.left      = !!(k['KeyA'] || k['ArrowLeft']);
    this.right     = !!(k['KeyD'] || k['ArrowRight']);
    this.sprint    = !!(k['ShiftLeft'] || k['ShiftRight']);

    this.jumpPressed     = this._justPressed.has('Space');
    this.interactPressed = this._justPressed.has('KeyF');
    this.phonePressed    = this._justPressed.has('Escape');

    this._justPressed.clear();
  }

  /** Override interact (used during EXIT_ANIM / ENTRY_ANIM to suppress input). */
  suppressAll() {
    this.forward = this.backward = this.left = this.right = false;
    this.sprint = this.jumpPressed = this.interactPressed = this.phonePressed = false;
  }
}

// ---------------------------------------------------------------------------
// OnFootSystem  —  top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Main entry point for Part 3.
 *
 * Usage:
 *   const onFoot = await OnFootSystem.init({
 *     scene, rapierWorld, carController, camera, domRoot,
 *     avatarMesh, animMixer, animClips,
 *     buildings, npcs, collectibles,
 *     playerCredits, openShopUI, closeShopUI,
 *   });
 *
 *   // In your game loop:
 *   onFoot.update(dt);
 */
export class OnFootSystem {
  /**
   * @param {Object} opts
   * @param {THREE.Scene}        opts.scene
   * @param {RAPIER.World}       opts.rapierWorld
   * @param {Object}             opts.carController   — must expose: mesh, speed, rigidBody, camera
   * @param {THREE.Camera}       opts.camera          — main renderer camera
   * @param {HTMLElement}        opts.domRoot
   * @param {THREE.SkinnedMesh}  opts.avatarMesh
   * @param {THREE.AnimationMixer} opts.animMixer
   * @param {Object}             opts.animClips       — keyed by AnimState
   * @param {Building[]}         opts.buildings
   * @param {Object[]}           opts.npcs
   * @param {Object[]}           opts.collectibles
   * @param {Object}             opts.playerCredits   — { value: number }
   * @param {Function}           opts.openShopUI
   * @param {Function}           opts.closeShopUI
   */
  constructor(opts) {
    this._opts    = opts;
    this._gsm     = new GameStateManager();
    this._input   = new InputState();
    this._fade    = new FadeOverlay(opts.domRoot);
    this._prompt  = new ProximityPrompt(opts.domRoot);

    this._physics = new AvatarPhysics(
      opts.rapierWorld,
      new THREE.Vector3(0, 1, 0),
    );

    this._avatar  = new AvatarController(
      opts.avatarMesh,
      this._physics,
      opts.camera,
      this._input,
      opts.animMixer,
      opts.animClips,
    );
    this._avatar.deactivate(); // start hidden

    this._camTransition = new CameraTransition(opts.camera);

    this._buildings = new BuildingInteraction(
      opts.buildings,
      this._fade,
      this._prompt,
      opts.openShopUI,
      opts.closeShopUI,
    );

    this._npcs = new NPCManager(opts.npcs ?? [], this._prompt);
    this._collectibles = new CollectibleManager(opts.collectibles ?? [], opts.scene);

    this._phone = new PhoneMenu(opts.domRoot, this._gsm, opts.playerCredits);
    this._photo = new PhotoMode(opts.camera, opts.scene, opts.domRoot);

    this._parkedCar = null;

    // Listen for state transitions
    this._gsm.addEventListener('statechange', e => this._onStateChange(e.detail));

    // Expose state for external code
    this.state = this._gsm;
  }

  // ---------------------------------------------------------------------------
  // Main update — call every frame
  // ---------------------------------------------------------------------------

  update(dt) {
    this._input.poll();
    this._camTransition.update(dt);

    const s = this._gsm.state;

    if (s === GameState.DRIVING) {
      this._updateDriving();
    } else if (s === GameState.ON_FOOT) {
      this._updateOnFoot(dt);
    } else if (s === GameState.EXIT_ANIM || s === GameState.ENTRY_ANIM) {
      this._input.suppressAll();
      this._avatar.mixer.update(dt);
    }
    // BUILDING, PHOTO_MODE — handled via event callbacks
  }

  // ---------------------------------------------------------------------------
  // State-specific updates
  // ---------------------------------------------------------------------------

  _updateDriving() {
    const car = this._opts.carController;
    const speed = car.speed ?? 0;           // m/s

    // F key → try to exit car
    if (this._input.interactPressed) {
      if (speed > EXIT_SPEED_LIMIT) {
        // TODO: show HUD warning "Slow down to exit"
        console.warn('[OnFoot] Slow down to exit! Current speed:', (speed * 3.6).toFixed(0), 'km/h');
      } else {
        this._beginExitCar();
      }
    }

    // ESC → phone menu while driving
    if (this._input.phonePressed) {
      this._phone.open();
    }
  }

  _updateOnFoot(dt) {
    if (this._phone.isOpen) {
      if (this._input.phonePressed) this._phone.close();
      return;
    }

    if (this._photo.isActive) return;

    const { wantsInteract, wantsPhone } = this._avatar.update(dt);
    const avatarPos = this._physics.position;

    if (wantsPhone) {
      this._phone.open();
      return;
    }

    // Building interaction
    const enteringBuilding = this._buildings.update(avatarPos, wantsInteract);
    if (enteringBuilding) {
      this._gsm.transition(GameState.BUILDING);
      return;
    }

    // Car re-entry
    if (this._parkedCar) {
      const wantsEnter = this._parkedCar.update(avatarPos, wantsInteract);
      if (wantsEnter) {
        this._beginEnterCar();
        return;
      }
    }

    // NPCs
    this._npcs.update(avatarPos, wantsInteract);

    // Collectibles
    this._collectibles.update(avatarPos);
  }

  // ---------------------------------------------------------------------------
  // Car exit / entry sequences
  // ---------------------------------------------------------------------------

  _beginExitCar() {
    this._gsm.transition(GameState.EXIT_ANIM);
    const car = this._opts.carController;

    // Park the car
    this._parkedCar = new ParkedCar(
      car.mesh,
      car.mesh.position.clone(),
      car.mesh.quaternion.clone(),
      this._opts.scene,
      this._opts.rapierWorld,
      this._prompt,
      this._opts.playerCredits,
    );

    // Spawn avatar at door position
    const spawnPos = this._parkedCar.exitPosition;
    this._avatar.activate(spawnPos);

    // Play exit animation, then switch cameras
    this._avatar.playOneShotAnim(AnimState.EXIT_CAR, () => {
      this._transitionCamToAvatar(() => {
        this._gsm.transition(GameState.ON_FOOT);
      });
    });
  }

  _beginEnterCar() {
    this._gsm.transition(GameState.ENTRY_ANIM);

    this._avatar.playOneShotAnim(AnimState.ENTER_CAR, () => {
      this._transitionCamToCar(() => {
        this._avatar.deactivate();
        this._parkedCar.wake();
        this._parkedCar = null;
        this._gsm.transition(GameState.DRIVING);
      });
    });
  }

  _transitionCamToAvatar(onDone) {
    const avatarPos = this._physics.position;
    const targetPos = avatarPos.clone().add(new THREE.Vector3(0, 1.7, 3.5));
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), Math.PI,
    );
    this._camTransition.start(targetPos, targetQuat, CAM_TRANSITION_TIME, onDone);
  }

  _transitionCamToCar(onDone) {
    // Resume car camera controller — let car controller reclaim the camera
    const car = this._opts.carController;
    const targetPos = car.mesh.position.clone().add(new THREE.Vector3(0, 3, -7));
    const q = new THREE.Quaternion();
    this._camTransition.start(targetPos, q, CAM_TRANSITION_TIME, onDone);
  }

  // ---------------------------------------------------------------------------
  // State change handler
  // ---------------------------------------------------------------------------

  _onStateChange({ prev, next }) {
    console.log(`[GameState] ${prev} → ${next}`);

    if (next === GameState.BUILDING) {
      // Shop is open; listen for exit
    }
    if (prev === GameState.BUILDING && next === GameState.ON_FOOT) {
      // Returned from shop
    }
  }

  // ---------------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------------

  /** Retrieve parked car to avatar location (costs credits). */
  retrieveCar() {
    if (!this._parkedCar) return;
    const pos = this._physics.position;
    this._parkedCar.retrieveRemotely(pos);
  }

  /** Exit building (call from shop UI close button). */
  exitBuilding() {
    this._buildings.exitBuilding();
    this._gsm.transition(GameState.ON_FOOT);
  }

  /** Activate photo mode. */
  activatePhotoMode() {
    const pos = this._gsm.is(GameState.ON_FOOT)
      ? this._physics.position
      : this._opts.carController.mesh.position;
    this._photo.activate(pos);
  }

  get gameStateManager() { return this._gsm; }
  get avatarPosition()   { return this._physics.position; }
}

// ---------------------------------------------------------------------------
// Factory / convenience init
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper — mirrors the docstring on OnFootSystem above.
 *
 * @example
 * const onFoot = createOnFootSystem({ scene, rapierWorld, ... });
 * // In render loop:
 * onFoot.update(clock.getDelta());
 */
export function createOnFootSystem(opts) {
  return new OnFootSystem(opts);
}

/**
 * Tactical Game Engine Coordinator (Client Core)
 * Fixed Timestep + Interpolation Loop (64Hz Physics / 60+ Hz Render Loop)
 * Client-Side Prediction, Server Reconciliation, and Entity Interpolation
 */

class TacticalGameEngine {
  constructor({ renderer, input, ui, network }) {
    this.renderer = renderer;
    this.input = input;
    this.ui = ui;
    this.network = network;

    // Fixed 64Hz Physics Timestep
    this.tickRate = (typeof CONSTANTS !== 'undefined' && CONSTANTS.TICK_RATE) ? CONSTANTS.TICK_RATE : 64;
    this.fixedDt = 1 / this.tickRate; // 0.015625s
    this.accumulator = 0;
    this.lastFrameTime = performance.now();

    // Client Spatial Indexing (Quadtree)
    if (typeof Quadtree !== 'undefined' && typeof MAP_DATA !== 'undefined') {
      this.spatialIndex = new Quadtree(new AABB(0, 0, MAP_DATA.width, MAP_DATA.height), 8, 6);
      for (let i = 0; i < MAP_DATA.walls.length; i++) {
        this.spatialIndex.insert(MAP_DATA.walls[i]);
      }
      console.log('[GameEngine] Client Quadtree spatial index initialized with', MAP_DATA.walls.length, 'walls.');
    } else {
      this.spatialIndex = null;
    }

    // Client Prediction State — start at attacker spawn (will be overridden on first reconcile)
    this.predictedLocalPlayer = {
      x: 1100,
      y: 1400,
      vx: 0,
      vy: 0,
      angle: 0
    };
    this.prevPredictedState = { x: 1100, y: 1400, angle: 0 };
    this.currPredictedState = { x: 1100, y: 1400, angle: 0 };
    this.lastProcessedInput = 0;
    this.isPredicting = false;
    this._predictedInitialized = false;

    // Antigravity & Custom Physics Engine Settings
    this.gravitySystem = new AntigravityPhysicsSystem();

    // Setup Server Reconciliation Hook
    this.network.onServerReconcile = (authoritativePlayer, pendingInputs) => {
      if (!this._predictedInitialized) {
        this.snapToAuthoritative(authoritativePlayer);
        this._predictedInitialized = true;
      }
      this.reconcileServerState(authoritativePlayer, pendingInputs);
    };

    // Spike Detonation Blast Wave Event
    this.network.onSpikeDetonated = (data) => {
      this.renderer.addSpikeBlast(data.x, data.y, data.radius || 1350, data.duration || 4.0);
    };

    // Spike Audio Timer
    this.spikeBeepTimer = 0;
  }

  snapToAuthoritative(authPlayer) {
    if (!authPlayer) return;
    this.predictedLocalPlayer.x = authPlayer.x;
    this.predictedLocalPlayer.y = authPlayer.y;
    this.predictedLocalPlayer.vx = authPlayer.vx || 0;
    this.predictedLocalPlayer.vy = authPlayer.vy || 0;
    this.predictedLocalPlayer.angle = authPlayer.angle || 0;
    this.prevPredictedState = { x: authPlayer.x, y: authPlayer.y, angle: authPlayer.angle || 0 };
    this.currPredictedState = { x: authPlayer.x, y: authPlayer.y, angle: authPlayer.angle || 0 };
    this.isPredicting = true;
  }

  onRoundStarted(data) {
    const localPlayer = this.getLocalPlayer();
    if (localPlayer) {
      this.snapToAuthoritative(localPlayer);
    }
  }

  getLocalPlayer() {
    if (!this.network || !this.network.latestState || !this.network.latestState.players) return null;
    return this.network.latestState.players.find(p => p.id === this.network.playerId) || null;
  }

  // 1. Client-Side Prediction: Simulate local movement immediately with spatial wall collision
  predictLocalMovement(dt) {
    if (!this.network.latestState) return;
    const localPlayer = this.network.latestState.players.find(p => p.id === this.network.playerId);
    if (!localPlayer || !localPlayer.isAlive) return;

    if (!this.isPredicting) {
      this.predictedLocalPlayer.x = localPlayer.x;
      this.predictedLocalPlayer.y = localPlayer.y;
      this.isPredicting = true;
    }

    // Determine speed modifiers
    let speed = CONSTANTS.BASE_SPEED;
    if (this.input.keys.crouch) {
      speed = CONSTANTS.CROUCH_SPEED;
    } else if (this.input.keys.shift) {
      speed = CONSTANTS.SHIFT_SPEED;
    }

    // Weapon weight modifier
    const curWeapon = localPlayer.weapons[localPlayer.currentSlot];
    if (curWeapon && curWeapon.slot === 'melee') {
      speed *= 1.1;
    }

    // Movement vector
    let moveX = 0;
    let moveY = 0;
    if (this.input.keys.up) moveY -= 1;
    if (this.input.keys.down) moveY += 1;
    if (this.input.keys.left) moveX -= 1;
    if (this.input.keys.right) moveX += 1;

    if (moveX !== 0 && moveY !== 0) {
      const invLen = 1 / Math.SQRT2;
      moveX *= invLen;
      moveY *= invLen;
    }

    this.predictedLocalPlayer.vx = moveX * speed;
    this.predictedLocalPlayer.vy = moveY * speed;

    this.predictedLocalPlayer.x += this.predictedLocalPlayer.vx * dt;
    this.predictedLocalPlayer.y += this.predictedLocalPlayer.vy * dt;

    // Resolve collision against Quadtree walls
    this.resolvePredictedCollisions(this.predictedLocalPlayer);

    // Aim Angle
    const screenCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.predictedLocalPlayer.angle = Math.atan2(
      this.input.mouse.screenY - screenCenter.y,
      this.input.mouse.screenX - screenCenter.x
    );

    // Synchronize to local player in latestState for instantaneous local rendering
    localPlayer.x = this.predictedLocalPlayer.x;
    localPlayer.y = this.predictedLocalPlayer.y;
    localPlayer.angle = this.predictedLocalPlayer.angle;
  }

  resolvePredictedCollisions(player) {
    const r = CONSTANTS.PLAYER_RADIUS;

    // Query candidate walls from Quadtree
    let candidateWalls = MAP_DATA.walls;
    if (this.spatialIndex) {
      candidateWalls = this.spatialIndex.queryCircle(player.x, player.y, r + 24);
    }

    // Include buy phase spawn barriers if active
    const isBuyPhase = this.network.latestState && this.network.latestState.state === 'buyPhase';
    if (isBuyPhase && MAP_DATA.barriers) {
      candidateWalls = [...candidateWalls, ...MAP_DATA.barriers];
    }

    for (let i = 0; i < candidateWalls.length; i++) {
      const w = candidateWalls[i];
      const closestX = Math.max(w.x, Math.min(player.x, w.x + w.w));
      const closestY = Math.max(w.y, Math.min(player.y, w.y + w.h));

      const dx = player.x - closestX;
      const dy = player.y - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < r * r && distSq > 0.00001) {
        const distance = Math.sqrt(distSq);
        const overlap = r - distance;
        player.x += (dx / distance) * overlap;
        player.y += (dy / distance) * overlap;
      }
    }

    // Map bounds clamping
    player.x = Math.max(r + 40, Math.min(MAP_DATA.width - r - 40, player.x));
    player.y = Math.max(r + 40, Math.min(MAP_DATA.height - r - 40, player.y));
  }

  // 2. Server Reconciliation: Check authoritative server pos and correct without rubber-banding
  reconcileServerState(authPlayer, pendingInputs) {
    if (!authPlayer) return;

    const dx = authPlayer.x - this.predictedLocalPlayer.x;
    const dy = authPlayer.y - this.predictedLocalPlayer.y;
    const errorDist = Math.hypot(dx, dy);

    // Ensure the local player's position and aim angle are never hard-overwritten by incoming server state.
    // The local player trusts its own immediate inputs.
    // Server reconciliation only gently corrects minor drift if the distance exceeds 15 pixels, rather than snapping every frame.
    if (errorDist > 15 && errorDist < 180) {
      // Gentle 12% drift correction towards authoritative state to eliminate snapping
      this.predictedLocalPlayer.x += dx * 0.12;
      this.predictedLocalPlayer.y += dy * 0.12;
    } else if (errorDist >= 180) {
      // Hard correction only on extreme teleport/knockback/wall-clip
      this.predictedLocalPlayer.x = authPlayer.x;
      this.predictedLocalPlayer.y = authPlayer.y;
    }
    // Aim angle is 100% locally controlled by mouse input; never altered by reconciliation!
  }

  // 3. Fixed Timestep Physics Update Tick
  fixedUpdate(dt) {
    // Save previous physics state for sub-frame visual interpolation
    this.prevPredictedState = {
      x: this.predictedLocalPlayer.x,
      y: this.predictedLocalPlayer.y,
      angle: this.predictedLocalPlayer.angle
    };

    // Predict local movement in fixed 64Hz steps
    this.predictLocalMovement(dt);

    // Save current physics state
    this.currPredictedState = {
      x: this.predictedLocalPlayer.x,
      y: this.predictedLocalPlayer.y,
      angle: this.predictedLocalPlayer.angle
    };
  }

  // 4. Decoupled Frame Render Step with Precise Mathematical Interpolation (144Hz+)
  renderFrame(alpha, frameDt) {
    const gameState = this.network.latestState;
    if (!gameState || !this.ui.screenGame.classList.contains('active')) return;

    const localPlayer = gameState.players.find(p => p.id === this.network.playerId);

    // Sub-frame Hermite / Lerp visual interpolation for buttery smooth 144Hz+ rendering
    if (localPlayer && this.isPredicting && this.prevPredictedState && this.currPredictedState) {
      localPlayer.x = this.prevPredictedState.x + (this.currPredictedState.x - this.prevPredictedState.x) * alpha;
      localPlayer.y = this.prevPredictedState.y + (this.currPredictedState.y - this.prevPredictedState.y) * alpha;

      // Shortest-arc angular interpolation
      let angleDiff = this.currPredictedState.angle - this.prevPredictedState.angle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      localPlayer.angle = this.prevPredictedState.angle + angleDiff * alpha;
    } else if (localPlayer && this.isPredicting) {
      localPlayer.x = this.predictedLocalPlayer.x;
      localPlayer.y = this.predictedLocalPlayer.y;
      localPlayer.angle = this.predictedLocalPlayer.angle;
    }

    // Interpolate remote players & bots using snapshot buffer
    for (let i = 0; i < gameState.players.length; i++) {
      const p = gameState.players[i];
      if (p.id !== this.network.playerId) {
        const interpolated = this.network.getInterpolatedPlayer(p.id);
        if (interpolated) {
          p.x = interpolated.x;
          p.y = interpolated.y;
          p.angle = interpolated.angle;
        }
      }
    }

    // Update FX (tracers, particles)
    this.renderer.updateFX(frameDt);

    // Render Canvas with spatial viewport culling & framerate-independent camera smoothing
    this.renderer.render(gameState, this.network.playerId, this.input.mouse, frameDt);

    // Update HUD
    this.ui.updateHUD(gameState, localPlayer);

    // Spike Beep Audio
    if (gameState.spike && gameState.spike.planted && !gameState.spike.defused) {
      this.spikeBeepTimer -= frameDt;
      if (this.spikeBeepTimer <= 0) {
        const detonateTime = gameState.spike.detonateTimer;
        let interval = 1.0;
        let urgency = 1;
        if (detonateTime < 10) {
          interval = 0.2;
          urgency = 3;
        } else if (detonateTime < 25) {
          interval = 0.45;
          urgency = 2;
        }
        this.spikeBeepTimer = interval;
        if (typeof soundFx !== 'undefined') soundFx.playSpikeBeep(urgency);
      }
    }
  }

  // 5. High-Performance Decoupled Main Game Loop
  run(currentTime) {
    const frameDt = Math.min((currentTime - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = currentTime;

    // Accumulate time for fixed 64Hz physics updates
    this.accumulator += frameDt;
    while (this.accumulator >= this.fixedDt) {
      this.fixedUpdate(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }

    // Interpolation factor between previous and current physics ticks
    const alpha = this.accumulator / this.fixedDt;

    // Render at native display refresh rate (60Hz, 144Hz, 240Hz+)
    this.renderFrame(alpha, frameDt);

    requestAnimationFrame((t) => this.run(t));
  }
}

// Universal export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TacticalGameEngine };
} else {
  window.TacticalGameEngine = TacticalGameEngine;
}

/**
 * =========================================================================
 * SENIOR AAA GAMEPLAY PROGRAMMER: ANTIGRAVITY & CAMERA SUBSYSTEM
 * =========================================================================
 * Strict Architectural Decoupling:
 *  1. Constant-Tick Physics Loop (accumulator/fixedDt)
 *  2. Explicit Vector Forces for arbitrary Gravity Vector g
 *  3. Visual Mesh Interpolation via fractional alpha coefficient
 *  4. Asynchronous Damped Spring-Arm Camera following Custom Up-Vector
 */
class AntigravityPhysicsSystem {
  constructor() {
    // Arbitrary Gravity Vector in 3D/2D space (Default standard down)
    this.gravityDirection = { x: 0, y: 1, z: 0 };
    this.gravityMagnitude = 980; // px/s^2 or cm/s^2
    this.customUpVector = { x: 0, y: -1, z: 0 };
    
    // Quaternion orientation [x, y, z, w] representing current body alignment
    this.currentRotation = [0, 0, 0, 1];
    this.targetRotation = [0, 0, 0, 1];
    this.angularVelocity = [0, 0, 0];

    // Camera Spring-Arm Parameters
    this.cameraPosition = { x: 0, y: 0, z: 0 };
    this.cameraVelocity = { x: 0, y: 0, z: 0 };
    this.springStiffness = 180;  // Angular frequency (k)
    this.springDamping = 24;     // Critical damping factor (2 * sqrt(k))
  }

  /**
   * Set dynamic gravity vector (invert, zero-g, or orient toward point/surface normal)
   */
  setGravity(gx, gy, gz = 0) {
    const mag = Math.hypot(gx, gy, gz);
    if (mag > 0.0001) {
      this.gravityDirection = { x: gx / mag, y: gy / mag, z: gz / mag };
      this.gravityMagnitude = mag;
      // Character Up-Vector is strictly opposite to gravity direction
      this.customUpVector = { x: -this.gravityDirection.x, y: -this.gravityDirection.y, z: -this.gravityDirection.z };
      this.computeTargetOrientation();
    } else {
      // Neutralized / Zero-G
      this.gravityMagnitude = 0;
    }
  }

  /**
   * Calculate Target Quaternion from standard Up [0, 1, 0] to Custom Up
   * Uses half-angle angle-axis quaternion formulation to prevent gimbal lock
   */
  computeTargetOrientation() {
    const u1 = { x: 0, y: -1, z: 0 }; // Standard reference up
    const u2 = this.customUpVector;

    const dot = u1.x * u2.x + u1.y * u2.y + u1.z * u2.z;
    if (dot > 0.99999) {
      this.targetRotation = [0, 0, 0, 1]; // Identity
      return;
    }
    if (dot < -0.99999) {
      // 180-degree flip (inverted gravity) - rotate around orthogonal axis [1, 0, 0]
      this.targetRotation = [1, 0, 0, 0];
      return;
    }

    // Cross product axis = u1 x u2
    const ax = u1.y * u2.z - u1.z * u2.y;
    const ay = u1.z * u2.x - u1.x * u2.z;
    const az = u1.x * u2.y - u1.y * u2.x;
    const qw = Math.sqrt((1 + dot) * 2);
    const inv = 1 / qw;

    this.targetRotation = [ax * inv, ay * inv, az * inv, qw * 0.5];
  }

  /**
   * Slerp / Spherical Linear Interpolation between quaternions for flawless rotation without clipping
   */
  slerpOrientation(dt, slerpSpeed = 16.0) {
    const t = Math.min(1.0, dt * slerpSpeed);
    const q1 = this.currentRotation;
    const q2 = this.targetRotation;

    let dot = q1[0]*q2[0] + q1[1]*q2[1] + q1[2]*q2[2] + q1[3]*q2[3];
    let sign = 1.0;
    if (dot < 0) {
      dot = -dot;
      sign = -1.0;
    }

    if (dot > 0.9995) {
      // Normalized Lerp for very close orientations
      for (let i = 0; i < 4; i++) {
        this.currentRotation[i] = q1[i] + t * (q2[i] * sign - q1[i]);
      }
    } else {
      const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
      const sinTheta = Math.sin(theta);
      const w1 = Math.sin((1 - t) * theta) / sinTheta;
      const w2 = Math.sin(t * theta) / sinTheta * sign;
      for (let i = 0; i < 4; i++) {
        this.currentRotation[i] = q1[i] * w1 + q2[i] * w2;
      }
    }

    // Normalize quaternion
    const norm = Math.hypot(...this.currentRotation);
    if (norm > 0) {
      for (let i = 0; i < 4; i++) this.currentRotation[i] /= norm;
    }
  }

  /**
   * Apply explicit gravity force to linear velocity (Physics Tick)
   */
  integrateVelocity(velocity, dt) {
    if (this.gravityMagnitude > 0) {
      velocity.x += this.gravityDirection.x * this.gravityMagnitude * dt;
      velocity.y += this.gravityDirection.y * this.gravityMagnitude * dt;
    }
  }

  /**
   * Asynchronous 2nd-order damped spring-arm camera solver
   * Position camera following character with custom up-vector preservation
   */
  updateSpringArmCamera(targetX, targetY, targetZ, dt) {
    // Spring acceleration = -k * (x - target) - d * v
    const errorX = this.cameraPosition.x - targetX;
    const errorY = this.cameraPosition.y - targetY;
    const errorZ = this.cameraPosition.z - targetZ;

    const accelX = -this.springStiffness * errorX - this.springDamping * this.cameraVelocity.x;
    const accelY = -this.springStiffness * errorY - this.springDamping * this.cameraVelocity.y;
    const accelZ = -this.springStiffness * errorZ - this.springDamping * this.cameraVelocity.z;

    this.cameraVelocity.x += accelX * dt;
    this.cameraVelocity.y += accelY * dt;
    this.cameraVelocity.z += accelZ * dt;

    this.cameraPosition.x += this.cameraVelocity.x * dt;
    this.cameraPosition.y += this.cameraVelocity.y * dt;
    this.cameraPosition.z += this.cameraVelocity.z * dt;

    return { ...this.cameraPosition, up: this.customUpVector };
  }
}

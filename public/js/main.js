// Main Application Entry Point & Game Loop Coordinator

let renderer;
let input;
let ui;
let network;

let lastFrameTime = performance.now();
let lastInputSendTime = 0;
let spikeBeepTimer = 0;
let autoFireInterval = null;

window.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Managers
  const canvas = document.getElementById('game-canvas');
  renderer = new GameRenderer(canvas);
  input = new InputManager();
  ui = new UIManager();
  network = new NetworkManager();
  window.network = network; // expose for ui.js match-state checks

  // Initialize Fog of War
  fogOfWar.init(MAP_DATA.width, MAP_DATA.height);

  // 2. Connect Lobby UI Actions
  ui.btnCreateRoom.addEventListener('click', () => {
    soundFx.ensureContext();
    const name = ui.inputPlayerName.value.trim() || 'Agent';
    network.createRoom(name, ui.selectedAgent);
  });

  ui.btnJoinRoom.addEventListener('click', () => {
    soundFx.ensureContext();
    const name = ui.inputPlayerName.value.trim() || 'Agent';
    const code = ui.inputRoomCode.value.trim().toUpperCase();
    if (!code) {
      alert('Please enter a room code');
      return;
    }
    network.joinRoom(code, name, ui.selectedAgent);
  });

  ui.btnAddBot.addEventListener('click', () => {
    network.addBot('defenders');
  });

  ui.btnStartMatch.addEventListener('click', () => {
    network.startMatch();
  });

  ui.onSelectAgent = (agentId) => {
    network.selectAgent(agentId);
  };

  ui.onSwitchTeam = (team) => {
    network.switchTeam(team);
  };

  ui.onBuyItem = (category, itemId) => {
    network.buyItem(category, itemId);
  };

  ui.onSkipBuy = () => {
    network.skipBuyPhase();
  };

  // Bot team switching (party leader only)
  ui.onSwitchBotTeam = (botId, team) => {
    network.switchBotTeam(botId, team);
  };

  // Bot removal (party leader only)
  ui.onRemoveBot = (botId) => {
    network.removeBot(botId);
  };

  // FIX 6: Kick human player (host only)
  ui.onKickPlayer = (targetId) => {
    network.kickPlayer(targetId);
  };

  // FIX 7: Switch human player team (host only)
  ui.onSwitchHumanTeam = (targetId, team) => {
    network.switchHumanTeam(targetId, team);
  };

  // Confirm abandon match (after leaver warning modal)
  ui.onConfirmAbandon = () => {
    network.abandonMatch();
  };

  // 3. Connect Input Manager Actions
  input.onInputChanged = () => {
    sendLocalInput();
  };

  input.onFire = (isDown) => {
    if (!network.latestState) return;
    const localPlayer = network.latestState.players.find(p => p.id === network.playerId);
    if (!localPlayer || !localPlayer.isAlive) return;

    const curWeapon = localPlayer.weapons[localPlayer.currentSlot];
    if (!curWeapon) return;

    if (isDown) {
      soundFx.ensureContext();
      const angle = input.getAimAngle(localPlayer);
      network.fireWeapon(angle);

      // Automatic weapons hold-to-fire loop
      if (curWeapon.automatic) {
        clearInterval(autoFireInterval);
        const intervalMs = 1000 / curWeapon.fireRate;
        autoFireInterval = setInterval(() => {
          if (!input.mouse.leftDown) {
            clearInterval(autoFireInterval);
            return;
          }
          const currentAngle = input.getAimAngle(localPlayer);
          network.fireWeapon(currentAngle);
        }, intervalMs);
      }
    } else {
      clearInterval(autoFireInterval);
    }
  };

  input.onReload = () => {
    if (!network.latestState) return;
    const localPlayer = network.latestState.players.find(p => p.id === network.playerId);
    if (!localPlayer || !localPlayer.isAlive) return;

    // Knife cannot reload!
    if (localPlayer.currentSlot === 'melee') return;
    const curWeapon = localPlayer.weapons[localPlayer.currentSlot];
    if (!curWeapon || curWeapon.slot === 'melee' || curWeapon.curAmmo === curWeapon.magSize || curWeapon.reserveAmmo <= 0) return;

    network.reloadWeapon();
  };

  input.onSwitchSlot = (slot) => {
    network.switchSlot(slot);
  };

  input.onToggleShop = () => {
    if (network.latestState && network.latestState.state === 'buyPhase') {
      ui.toggleShop();
    }
  };

  input.onUseAbility = (abilityKey) => {
    if (!network.latestState) return;
    const localPlayer = network.latestState.players.find(p => p.id === network.playerId);
    if (!localPlayer || !localPlayer.isAlive) return;

    soundFx.ensureContext();
    // Convert screen mouse to world coordinates for ability target
    const target = renderer.screenToWorld(input.mouse.screenX, input.mouse.screenY);
    network.useAbility(abilityKey, target.x, target.y);
  };

  // Unified Spike Plant & Defuse on Key 4
  input.onSpikeActionStart = () => {
    if (!network.latestState) return;
    const localPlayer = network.latestState.players.find(p => p.id === network.playerId);
    if (!localPlayer || !localPlayer.isAlive) return;

    // If Defender and Spike is planted, defuse!
    if (localPlayer.team === 'defenders' && network.latestState.spike.planted) {
      const sp = network.latestState.spike;
      const d = Math.hypot(localPlayer.x - sp.x, localPlayer.y - sp.y);
      if (d < 110) {
        network.startSpikeAction('defuse');
      }
    } 
    // If Attacker, plant spike in site!
    else if (localPlayer.team === 'attackers') {
      network.switchSlot('spike');
      network.startSpikeAction('plant');
    }
  };

  input.onSpikeActionStop = () => {
    network.stopSpikeAction();
  };

  input.onKeybindsChanged = () => {
    if (network.latestState) {
      const localPlayer = network.latestState.players.find(p => p.id === network.playerId);
      if (localPlayer) {
        ui.renderAbilitiesHUD(localPlayer);
      }
    }
    ui.initLobbyAgents();
  };

  ui.onLeaveRoom = () => {
    network.leaveRoom();
  };

  ui.onLeaveMatch = () => {
    network.returnToLobby();
    ui.showLobbyScreen();
  };

  // 4. Connect Network Callbacks
  network.onBulletFired = (tracer) => {
    renderer.addTracer(tracer.from, tracer.to, tracer.weapon, tracer.headshot);
  };

  // 5. Connect to Socket.io Server
  network.connect();

  // 6. Start High-Performance Fixed Timestep + Interpolated Render Loop
  if (typeof TacticalGameEngine !== 'undefined') {
    const engine = new TacticalGameEngine({ renderer, input, ui, network });
    window.gameEngine = engine;
    requestAnimationFrame((t) => engine.run(t));
  } else {
    requestAnimationFrame(gameLoop);
  }
});

// Helper: Send local input packet to server
function sendLocalInput() {
  if (!network.latestState) return;
  const localPlayer = network.latestState.players.find(p => p.id === network.playerId);
  if (!localPlayer) return;

  // Calculate mouse world coordinates
  const worldPos = renderer.screenToWorld(input.mouse.screenX, input.mouse.screenY);
  input.mouse.worldX = worldPos.x;
  input.mouse.worldY = worldPos.y;

  const angle = input.getAimAngle(localPlayer);

  network.sendInput({
    up: input.keys.up,
    down: input.keys.down,
    left: input.keys.left,
    right: input.keys.right,
    shift: input.keys.shift,
    crouch: input.keys.crouch,
    angle: angle
  });
}

// Main 60 FPS Game Loop
function gameLoop(currentTime) {
  const dt = Math.min((currentTime - lastFrameTime) / 1000, 0.1);
  lastFrameTime = currentTime;

  const gameState = network.latestState;

  if (gameState && ui.screenGame.classList.contains('active')) {
    const localPlayer = gameState.players.find(p => p.id === network.playerId);

    // Send input update periodically (every 50ms) to sync mouse aim angle
    if (currentTime - lastInputSendTime > 50) {
      lastInputSendTime = currentTime;
      sendLocalInput();
    }

    // Update Visual FX (Tracers, Particles, Muzzle Flashes)
    renderer.updateFX(dt);

    // Render Canvas
    renderer.render(gameState, network.playerId, input.mouse);

    // Update HUD
    ui.updateHUD(gameState, localPlayer);

    // Spike Beeping Audio Logic
    if (gameState.spike && gameState.spike.planted && !gameState.spike.defused) {
      spikeBeepTimer -= dt;
      if (spikeBeepTimer <= 0) {
        const detonateTime = gameState.spike.detonateTimer;
        // Interval speeds up from 1.0s down to 0.15s
        let interval = 1.0;
        let urgency = 1;
        if (detonateTime < 10) {
          interval = 0.2;
          urgency = 3;
        } else if (detonateTime < 25) {
          interval = 0.45;
          urgency = 2;
        }
        spikeBeepTimer = interval;
        soundFx.playSpikeBeep(urgency);
      }
    }
  }

  requestAnimationFrame(gameLoop);
}

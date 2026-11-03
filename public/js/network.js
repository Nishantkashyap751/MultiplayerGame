// Socket.io Network Communication Layer for Tactical 2D Shooter

class NetworkManager {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.roomCode = null;
    this.latestState = null;
    this.isHost = false;

    // Netcode, Prediction & Interpolation Buffers
    this.inputSeq = 0;
    this.pendingInputs = [];
    this.snapshotBuffer = [];
    this.interpolationDelayMs = 60; // 60ms interpolation delay for remote entities
    this.lastProcessedInput = 0;
    this.onServerReconcile = null;

    // Callbacks hooked by main coordinator
    this.onStateUpdate = null;
    this.onBulletFired = null;
    this.onPlayerKilled = null;
    this.onRoundEnded = null;
    this.onRoundStarted = null;
    this.onMatchEnded = null;
    this.onSpikePlanted = null;
    this.onAbilityUsed = null;
    this.onAbilityDetonated = null;
  }

  connect() {
    this.socket = io();

    this.socket.on('connect', () => {
      console.log('Connected to game server. Socket ID:', this.socket.id);
      this.playerId = this.socket.id;
    });

    // 1. Room Joined
    this.socket.on('room_joined', (data) => {
      this.roomCode = data.roomCode;
      this.playerId = data.playerId;
      this.isHost = data.isHost;
      this.latestState = data.roomState;

      ui.updateLobbyRoom(data.roomState, this.playerId);
    });

    // 2. Player Updates in Lobby
    this.socket.on('player_joined', ({ player }) => {
      if (this.latestState) {
        // FIX 5: Deduplicate — remove any existing entry with same id before pushing
        this.latestState.players = this.latestState.players.filter(p => p.id !== player.id);
        this.latestState.players.push(player);
        ui.updateLobbyRoom(this.latestState, this.playerId);
      }
    });

    // FIX 1: room_updated — full authoritative roster from server
    this.socket.on('room_updated', (roomState) => {
      this.latestState = roomState;
      if (ui && ui.panelRoom && !ui.panelRoom.classList.contains('hidden')) {
        ui.updateLobbyRoom(roomState, this.playerId);
      }
    });

    this.socket.on('player_updated', ({ player }) => {
      if (this.latestState) {
        const idx = this.latestState.players.findIndex(p => p.id === player.id);
        if (idx !== -1) {
          this.latestState.players[idx] = player;
          ui.updateLobbyRoom(this.latestState, this.playerId);
        }
      }
    });

    this.socket.on('player_left', ({ playerId }) => {
      if (this.latestState) {
        this.latestState.players = this.latestState.players.filter(p => p.id !== playerId);
        ui.updateLobbyRoom(this.latestState, this.playerId);
      }
    });

    // 3. Match Started
    this.socket.on('game_started', (gameState) => {
      this.latestState = gameState;
      ui.showGameScreen();
      ui.showAnnouncement('MATCH COMMENCED', 'BUY PHASE ACTIVE', 3000);
      soundFx.playRoundWin();
    });

    // 4. Tick State Updates with Delta Decompression & Interpolation
    this.socket.on('game_state_update', (payload) => {
      this.handleIncomingState(payload);
    });

    // 5. Round Events
    this.socket.on('round_started', (data) => {
      const isBuyPhase = !!data.isBuyPhase;
      if (this.latestState) {
        this.latestState.state = isBuyPhase ? 'buyPhase' : 'inRound';
        if (data.roundNumber) this.latestState.roundNumber = data.roundNumber;
        if (data.roundTimer !== undefined) this.latestState.roundTimer = data.roundTimer;
      }
      if (isBuyPhase) {
        ui.showAnnouncement(`ROUND ${data.roundNumber || 1}`, 'BUY PHASE ACTIVE', 2500);
      } else {
        ui.showAnnouncement(`ROUND ${data.roundNumber || 1}`, 'ENGAGE TARGETS', 2500);
        if (ui.modalShop) ui.modalShop.classList.add('hidden');
        if (ui.buyPhaseBanner) ui.buyPhaseBanner.classList.add('hidden');
      }
      if (window.gameEngine && window.gameEngine.onRoundStarted) {
        window.gameEngine.onRoundStarted(data);
      }
      if (this.onRoundStarted) this.onRoundStarted(data);
    });

    this.socket.on('halftime_switch', (data) => {
      ui.showAnnouncement('HALFTIME // SWITCHING SIDES', 'ROLES SWAPPED: ATTACKERS ARE NOW DEFENDERS!', 6500);
      if (typeof soundFx !== 'undefined') soundFx.playRoundWon();
    });

    this.socket.on('spike_defused', (data) => {
      if (this.latestState && this.latestState.spike) {
        this.latestState.spike.defused = true;
        this.latestState.spike.planted = false;
      }
      if (typeof soundFx !== 'undefined') soundFx.playSpikeDefuse();
    });

    this.socket.on('round_ended', (data) => {
      if (this.latestState) {
        this.latestState.state = 'roundEnded';
        if (data.score) this.latestState.score = data.score;
      }
      if (ui.buyPhaseBanner) ui.buyPhaseBanner.classList.add('hidden');
      if (ui.modalShop) ui.modalShop.classList.add('hidden');

      const localPlayer = this.latestState?.players.find(p => p.id === this.playerId);
      const isWinner = localPlayer && localPlayer.team === data.winner;
      
      const title = isWinner ? 'ROUND WON' : 'ROUND LOST';
      ui.showAnnouncement(title, data.reason, 4500);

      if (isWinner) {
        soundFx.playRoundWin();
      } else {
        soundFx.playRoundLoss();
      }

      if (this.onRoundEnded) this.onRoundEnded(data);
    });

    this.socket.on('match_ended', (data) => {
      const localPlayer = this.latestState?.players.find(p => p.id === this.playerId);
      const isWinner = localPlayer && localPlayer.team === data.winner;
      ui.showAnnouncement(isWinner ? 'VICTORY' : 'DEFEAT', `FINAL SCORE: ${data.score.attackers} - ${data.score.defenders}`, 5500, true);
      if (this.onMatchEnded) this.onMatchEnded(data);
    });

    // Reset back to room lobby dashboard after match ends
    this.socket.on('match_reset', (gameState) => {
      this.latestState = gameState;
      ui.showLobbyScreen();
      ui.updateLobbyRoom(gameState, this.playerId);
    });

    // FIX 6: Kicked by host — return to dashboard
    this.socket.on('kicked_from_room', ({ reason }) => {
      this.roomCode = null;
      this.latestState = null;
      ui.showAnnouncement('REMOVED FROM ROOM', reason || 'Host removed you from the room.', 4000);
      setTimeout(() => {
        ui.showEntryPanel();
        ui.showLobbyScreen();
      }, 1500);
    });

    // Successfully left room, return to room code entry
    this.socket.on('left_room_success', () => {
      this.roomCode = null;
      this.latestState = null;
      ui.showEntryPanel();
      ui.showLobbyScreen();
      ui.checkPenaltyState();
    });

    // Abandon match penalized callback
    this.socket.on('abandon_penalized', ({ penaltySeconds, penaltyUntil }) => {
      localStorage.setItem('tactical_penalty_until', penaltyUntil.toString());
      this.roomCode = null;
      this.latestState = null;
      ui.showEntryPanel();
      ui.showLobbyScreen();
      ui.checkPenaltyState();
    });

    // 6. Combat & Sound Events
    this.socket.on('bullet_fired', (tracer) => {
      soundFx.playShoot(tracer.weapon);
      if (tracer.headshot) {
        soundFx.playHeadshot();
      } else if (tracer.hit) {
        soundFx.playHit();
      }
      if (this.onBulletFired) this.onBulletFired(tracer);
    });

    this.socket.on('player_killed', (killInfo) => {
      ui.addKillFeed(killInfo);
      if (this.onPlayerKilled) this.onPlayerKilled(killInfo);
    });

    this.socket.on('weapon_reloading', ({ playerId }) => {
      if (playerId === this.playerId) {
        soundFx.playReload();
      }
    });

    // 7. Spike Events
    this.socket.on('spike_planted', (data) => {
      ui.showAnnouncement('SPIKE PLANTED', `ARMED AT ${data.site}`, 3000);
      soundFx.playSpikePlant();

      // If local player planted, automatically switch slot back to gun so they can shoot immediately!
      if (data.planterId === this.playerId) {
        const nextSlot = data.newSlot || 'primary';
        this.switchSlot(nextSlot);
      }

      if (this.onSpikePlanted) this.onSpikePlanted(data);
    });

    this.socket.on('spike_detonated', (data) => {
      ui.showAnnouncement('SPIKE DETONATED', 'TACTICAL BLAST OBLITERATED SECTOR', 4500);
      soundFx.playSpikeExplosion();
      if (this.onSpikeDetonated) this.onSpikeDetonated(data);
    });

    // Spike hidden from map immediately after detonation
    this.socket.on('spike_hidden', () => {
      if (window.gameState && window.gameState.spike) {
        window.gameState.spike.planted = false;
        window.gameState.spike.x = null;
        window.gameState.spike.y = null;
      }
    });

    // Defuse cancelled (defuser was eliminated)
    this.socket.on('defuse_interrupted', (data) => {
      if (window.gameState && window.gameState.spike) {
        window.gameState.spike.defuseProgress = 0;
        window.gameState.spike.defuserId = null;
      }
      ui.showAnnouncement('DEFUSE CANCELLED', data.reason || 'Defuser eliminated!', 2500);
    });

    // AFK events
    this.socket.on('afk_warning', (data) => {
      if (window.ui) window.ui.showAfkWarning(data.afkRounds, data.maxRounds);
    });

    this.socket.on('afk_spawn_skipped', (data) => {
      if (window.ui) window.ui.showAfkSpawnSkipped(data.afkRounds, data.roundsUntilKick);
    });

    this.socket.on('afk_returned', () => {
      if (window.ui) window.ui.hideAfkWarning();
    });

    this.socket.on('afk_kicked', (data) => {
      try { localStorage.setItem('penaltyUntil', String(data.penaltyUntil)); } catch(e) {}
      if (window.ui) window.ui.showAfkKickScreen(data.penaltySeconds);
      setTimeout(() => {
        if (this.socket) this.socket.disconnect();
        if (window.ui) window.ui.returnToDashboard({ penaltyUntil: data.penaltyUntil, penaltySeconds: data.penaltySeconds });
      }, 3000);
    });

    this.socket.on('spike_picked_up', (data) => {
      if (data.playerId === this.playerId) {
        ui.showAnnouncement('SPIKE ACQUIRED', 'PLANT AT SITE A OR B', 2000);
      }
    });

    // 7b. Public Rooms / Lobbies List
    this.socket.on('public_rooms_update', (rooms) => {
      if (this.onPublicRoomsUpdate) this.onPublicRoomsUpdate(rooms);
      if (window.ui && window.ui.renderPublicRooms) {
        window.ui.renderPublicRooms(rooms);
      }
    });

    // 8. Ability Events
    this.socket.on('ability_used', (data) => {
      if (data.type === 'smoke') {
        soundFx.playSmoke();
      } else if (data.type === 'arrow_fired') {
        soundFx.playLightningArrow();
        if (window.game && window.game.renderer) {
          window.game.renderer.addFlyingArrow(data);
        }
      }
      if (this.onAbilityUsed) this.onAbilityUsed(data);
    });

    this.socket.on('ability_detonated', (data) => {
      if (data.type === 'flash') {
        soundFx.playFlash();
      } else if (data.type === 'shock_burst') {
        soundFx.playShockBurst();
        if (window.game && window.game.renderer) {
          window.game.renderer.addShockBurst(data.x, data.y, data.radius || 110);
        }
      } else if (data.type === 'recon_landed') {
        if (window.game && window.game.renderer) {
          window.game.renderer.onReconLanded(data);
        }
      }
      if (this.onAbilityDetonated) this.onAbilityDetonated(data);
    });

    // Screen flash / blind event (targeted to individual player)
    this.socket.on('screen_flash', (data) => {
      if (window.game && window.game.renderer) {
        window.game.renderer.triggerScreenBlind(data.duration, data.type || 'white');
      }
    });

    // Projectile visual tracking (Paranoia wave beam)
    this.socket.on('projectile_move', (data) => {
      if (window.game && window.game.renderer) {
        window.game.renderer.updateProjectile(data);
      }
    });

    // Sova Recon Bolt events (Navy Sonar Wave: 2 pulses with 1s delay)
    this.socket.on('recon_pulse', (data) => {
      soundFx.playSonarPing();
      if (window.game && window.game.renderer) {
        window.game.renderer.addReconSonarWave(data.boltX, data.boltY, data.radius || 520, data.pulseNumber || 1, data.totalPulses || 2);
      }
    });

    this.socket.on('recon_revealed', (data) => {
      if (window.game && window.game.renderer) {
        window.game.renderer.setReconRevealed(data.revealed, data.duration || 3.5, data.ownerTeam);
      }
    });

    this.socket.on('recon_bolt_destroyed', (data) => {
      if (window.game && window.game.renderer) {
        window.game.renderer.removeReconBolt(data.boltId, data.x, data.y);
      }
    });

    // Error messages
    this.socket.on('error_message', ({ message }) => {
      alert(message);
    });
  }

  // --- Client Emits ---
  createRoom(playerName, agent) {
    const penaltyUntil = parseInt(localStorage.getItem('tactical_penalty_until') || '0', 10);
    this.socket.emit('create_room', { playerName, agent, penaltyUntil });
  }

  joinRoom(roomCode, playerName, agent) {
    const penaltyUntil = parseInt(localStorage.getItem('tactical_penalty_until') || '0', 10);
    this.socket.emit('join_room', { roomCode, playerName, agent, penaltyUntil });
  }

  switchTeam(team) {
    this.socket.emit('switch_team', { team });
  }

  selectAgent(agent) {
    this.socket.emit('select_agent', { agent });
  }

  addBot(team) {
    this.socket.emit('add_bot', { team });
  }

  switchBotTeam(botId, team) {
    if (this.socket && this.roomCode) {
      this.socket.emit('switch_bot_team', { botId, team });
    }
  }

  removeBot(botId) {
    if (this.socket && this.roomCode) {
      this.socket.emit('remove_bot', { botId });
    }
  }

  // FIX 6: Kick a human player (host only)
  kickPlayer(targetId) {
    if (this.socket && this.roomCode) {
      this.socket.emit('kick_player', { targetId });
    }
  }

  // FIX 7: Switch human player's team (host only)
  switchHumanTeam(targetId, team) {
    if (this.socket && this.roomCode) {
      this.socket.emit('switch_human_team', { targetId, team });
    }
  }

  startMatch() {
    this.socket.emit('start_game');
  }

  abandonMatch() {
    if (this.socket && this.roomCode) {
      this.socket.emit('abandon_match');
    }
  }

  requestPublicRooms() {
    if (this.socket) {
      this.socket.emit('get_public_rooms');
    }
  }

  handleIncomingState(payload) {
    let state = payload;
    if (payload && payload.type === 'delta') {
      if (!this.latestState) {
        this.latestState = payload.state;
      } else {
        const delta = payload.state;
        this.latestState.roomCode = delta.roomCode;
        this.latestState.state = delta.state;
        this.latestState.roundNumber = delta.roundNumber;
        this.latestState.score = delta.score;
        this.latestState.roundTimer = delta.roundTimer;
        this.latestState.spike = delta.spike;
        this.latestState.activeSmokes = delta.activeSmokes;
        this.latestState.activeMolotovs = delta.activeMolotovs;
        this.latestState.killFeed = delta.killFeed;

        if (delta.players) {
          for (let i = 0; i < delta.players.length; i++) {
            const dp = delta.players[i];
            const existing = this.latestState.players.find(p => p.id === dp.id);
            if (existing) {
              if (existing.id === this.playerId && window.game && window.game.isPredicting) {
                // Keep authoritative attributes like hp, armor, alive, currentSlot, etc.
                // but DO NOT hard-overwrite local predicted position and aim angle!
                const curX = existing.x;
                const curY = existing.y;
                const curAngle = existing.angle;
                Object.assign(existing, dp);
                existing.x = curX;
                existing.y = curY;
                existing.angle = curAngle;
              } else {
                Object.assign(existing, dp);
              }
            } else {
              this.latestState.players.push(dp);
            }
          }
        }
      }
      state = this.latestState;
    } else if (payload && payload.type === 'full') {
      const existingLocal = (this.latestState && this.latestState.players) 
        ? this.latestState.players.find(p => p.id === this.playerId) 
        : null;
      this.latestState = payload.state;
      state = payload.state;
      if (existingLocal && window.game && window.game.isPredicting) {
        const newLocal = this.latestState.players.find(p => p.id === this.playerId);
        if (newLocal) {
          newLocal.x = existingLocal.x;
          newLocal.y = existingLocal.y;
          newLocal.angle = existingLocal.angle;
        }
      }
    } else {
      this.latestState = payload;
      state = payload;
    }

    if (!state || !state.players) return;

    // Record snapshot in circular buffer for remote entity interpolation
    const now = performance.now();
    this.snapshotBuffer.push({
      time: now,
      players: state.players.map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: p.vx || 0,
        vy: p.vy || 0,
        angle: p.angle,
        hp: p.hp,
        armor: p.armor,
        isAlive: p.isAlive,
        isCrouched: p.isCrouched,
        isWalking: p.isWalking,
        currentSlot: p.currentSlot
      }))
    });

    if (this.snapshotBuffer.length > 64) {
      this.snapshotBuffer.shift();
    }

    // Authoritative check & Server Reconciliation for local player
    const localPlayer = state.players.find(p => p.id === this.playerId);
    if (localPlayer && localPlayer.lastProcessedInput) {
      this.lastProcessedInput = localPlayer.lastProcessedInput;
      // Discard acknowledged inputs
      this.pendingInputs = this.pendingInputs.filter(item => item.seq > localPlayer.lastProcessedInput);
      if (this.onServerReconcile) {
        this.onServerReconcile(localPlayer, this.pendingInputs);
      }
    }

    if (this.onStateUpdate) {
      this.onStateUpdate(state);
    }
  }

  getInterpolatedPlayer(playerId) {
    if (this.snapshotBuffer.length < 2) return null;

    const renderTime = performance.now() - this.interpolationDelayMs;
    let older = null;
    let newer = null;

    for (let i = this.snapshotBuffer.length - 1; i >= 0; i--) {
      if (this.snapshotBuffer[i].time <= renderTime) {
        older = this.snapshotBuffer[i];
        newer = this.snapshotBuffer[i + 1] || older;
        break;
      }
    }

    if (!older || !newer || older === newer) {
      const latest = this.snapshotBuffer[this.snapshotBuffer.length - 1];
      return latest.players.find(p => p.id === playerId) || null;
    }

    const pOlder = older.players.find(p => p.id === playerId);
    const pNewer = newer.players.find(p => p.id === playerId);
    if (!pOlder || !pNewer) return pNewer || pOlder || null;

    const total = newer.time - older.time;
    const factor = total > 0 ? Math.min(1, Math.max(0, (renderTime - older.time) / total)) : 1;

    return {
      ...pNewer,
      x: pOlder.x + (pNewer.x - pOlder.x) * factor,
      y: pOlder.y + (pNewer.y - pOlder.y) * factor,
      angle: pOlder.angle + (pNewer.angle - pOlder.angle) * factor
    };
  }

  sendInput(inputData) {
    if (this.socket && this.roomCode) {
      const seq = ++this.inputSeq;
      const packet = { ...inputData, seq };
      this.pendingInputs.push({ ...packet, timestamp: performance.now() });
      this.socket.emit('player_input', packet);
      return seq;
    }
    return 0;
  }

  fireWeapon(angle) {
    if (this.socket && this.roomCode) {
      this.socket.emit('fire_weapon', { angle });
    }
  }

  reloadWeapon() {
    if (this.socket && this.roomCode) {
      this.socket.emit('reload_weapon');
    }
  }

  switchSlot(slot) {
    if (this.socket && this.roomCode) {
      this.socket.emit('switch_slot', { slot });
    }
  }

  buyItem(category, itemId) {
    if (this.socket && this.roomCode) {
      this.socket.emit('buy_item', { category, itemId });
    }
  }

  useAbility(abilityKey, targetX, targetY) {
    if (this.socket && this.roomCode) {
      this.socket.emit('use_ability', { abilityKey, targetX, targetY });
    }
  }

  startSpikeAction(action) {
    if (this.socket && this.roomCode) {
      this.socket.emit('spike_action_start', { action });
    }
  }

  stopSpikeAction() {
    if (this.socket && this.roomCode) {
      this.socket.emit('spike_action_stop');
    }
  }

  leaveRoom() {
    if (this.socket) {
      this.socket.emit('leave_room');
    }
  }

  returnToLobby() {
    if (this.socket && this.roomCode) {
      this.socket.emit('return_to_lobby');
    }
  }
}

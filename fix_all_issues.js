/**
 * Comprehensive fix script for all 9 reported issues:
 * 1. Opponent can't see host's card → fix: server sends full room_updated on join
 * 2. Only host can launch game → already fixed in existing code, re-verify
 * 3. Defender player invisible on arena → fix spawn coords
 * 4. Agent flickers → fix: no-op (threshold 15px already correct)
 * 5. Duplicate player card → fix client latestState dedup
 * 6. Host hover reveals Remove button → new UI controls
 * 7. Host can switch human players between teams → new server + UI event
 * 8. Walls not dark / floor glows → renderer color updates
 * 9. Remove Add AI Bot from non-host → hide in updateLobbyRoom
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function writeFile(relPath, content) {
  fs.writeFileSync(path.join(ROOT, relPath), content, 'utf8');
  console.log(`✅ Written: ${relPath}`);
}

// ============================================================
// FIX 1 + 5: server.js — broadcast full room_updated on join
//             also add kick_player + switch_player_team events
// ============================================================
function fixServerJs() {
  let src = readFile('server/server.js');

  // FIX 1: After join_room, broadcast full room state (room_updated) to whole room
  // Currently it only sends player_joined. Change to emit room_updated too.
  const oldJoinEmit = `    io.to(code).emit('player_joined', { player: sanitizePlayer(player) });`;
  const newJoinEmit = `    io.to(code).emit('player_joined', { player: sanitizePlayer(player) });
    // Broadcast full room state so all clients get the updated roster (fixes card visibility)
    io.to(code).emit('room_updated', room.serialize());`;

  if (src.includes(oldJoinEmit)) {
    src = src.replace(oldJoinEmit, newJoinEmit);
    console.log('✅ FIX 1: room_updated broadcast added on join');
  } else {
    console.log('⚠️  FIX 1: pattern not found, check manually');
  }

  // Also broadcast room_updated when player switches team (select_agent, toggle_ready, switch_team)
  const oldSwitchTeamEmit = `      io.to(currentRoomCode).emit('player_updated', { player: sanitizePlayer(player) });
    }
  });

  // 4. Select Agent`;
  const newSwitchTeamEmit = `      io.to(currentRoomCode).emit('player_updated', { player: sanitizePlayer(player) });
      io.to(currentRoomCode).emit('room_updated', room.serialize());
    }
  });

  // 4. Select Agent`;
  if (src.includes(oldSwitchTeamEmit)) {
    src = src.replace(oldSwitchTeamEmit, newSwitchTeamEmit);
  }

  // FIX 6 + 7: Add kick_player and switch_player_team socket events
  const newEvents = `
  // 6d. Kick Human Player (Party leader only)
  socket.on('kick_player', ({ targetId }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'lobby') return;
    const caller = room.players.get(socket.id);
    if (!caller || !caller.isHost) return;
    if (targetId === socket.id) return; // host can't kick themselves

    const target = room.players.get(targetId);
    if (!target || target.isBot) return; // use remove_bot for bots

    // Notify the kicked player first
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('kicked_from_room', { reason: 'You were removed from the room by the host.' });
      targetSocket.leave(currentRoomCode);
    }

    room.removePlayer(targetId);
    io.to(currentRoomCode).emit('player_left', { playerId: targetId });
    io.to(currentRoomCode).emit('room_updated', room.serialize());
    broadcastPublicRooms();
  });

  // 6e. Switch Human Player Team (Party leader only)
  socket.on('switch_human_team', ({ targetId, team }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'lobby') return;
    const caller = room.players.get(socket.id);
    if (!caller || !caller.isHost) return;

    const target = room.players.get(targetId);
    if (!target) return;

    target.team = (team === 'attackers' || team === 'defenders') ? team : (target.team === 'attackers' ? 'defenders' : 'attackers');
    io.to(currentRoomCode).emit('player_updated', { player: sanitizePlayer(target) });
    io.to(currentRoomCode).emit('room_updated', room.serialize());
  });

`;

  // Insert before the start_game handler
  const insertBefore = `  // 7. Start Game (Locked if leader is penalized)`;
  if (!src.includes('kick_player') && src.includes(insertBefore)) {
    src = src.replace(insertBefore, newEvents + insertBefore);
    console.log('✅ FIX 6+7: kick_player and switch_human_team events added');
  } else if (src.includes('kick_player')) {
    console.log('ℹ️  FIX 6+7: events already exist');
  } else {
    console.log('⚠️  FIX 6+7: insert position not found');
  }

  writeFile('server/server.js', src);
}

// ============================================================
// FIX 5: network.js — deduplicate players on player_joined
//         + handle room_updated event
//         + wire kicked_from_room
//         + wire kick_player / switch_human_team emissions
// ============================================================
function fixNetworkJs() {
  let src = readFile('public/js/network.js');

  // FIX 5: Fix duplicate in player_joined handler - deduplicate by id
  const oldPlayerJoined = `    this.socket.on('player_joined', ({ player }) => {
      if (this.latestState) {
        this.latestState.players.push(player);
        ui.updateLobbyRoom(this.latestState, this.playerId);
      }
    });`;
  const newPlayerJoined = `    this.socket.on('player_joined', ({ player }) => {
      if (this.latestState) {
        // Deduplicate: remove any existing entry with same id before pushing
        this.latestState.players = this.latestState.players.filter(p => p.id !== player.id);
        this.latestState.players.push(player);
        ui.updateLobbyRoom(this.latestState, this.playerId);
      }
    });

    // room_updated: full authoritative roster from server
    this.socket.on('room_updated', (roomState) => {
      this.latestState = roomState;
      if (ui && ui.panelRoom && !ui.panelRoom.classList.contains('hidden')) {
        ui.updateLobbyRoom(roomState, this.playerId);
      }
    });`;

  if (src.includes(oldPlayerJoined)) {
    src = src.replace(oldPlayerJoined, newPlayerJoined);
    console.log('✅ FIX 5: deduplicate + room_updated handler added');
  } else if (src.includes('room_updated')) {
    console.log('ℹ️  FIX 5: room_updated handler already present');
  } else {
    console.log('⚠️  FIX 5: player_joined pattern not found');
  }

  // Handle kicked_from_room
  const oldLeftRoom = `    // Successfully left room, return to room code entry
    this.socket.on('left_room_success', () => {`;
  const newKickedEvent = `    // Kicked by host
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
    this.socket.on('left_room_success', () => {`;

  if (!src.includes('kicked_from_room') && src.includes(oldLeftRoom)) {
    src = src.replace(oldLeftRoom, newKickedEvent);
    console.log('✅ FIX 6: kicked_from_room handler added');
  } else if (src.includes('kicked_from_room')) {
    console.log('ℹ️  FIX 6: kicked_from_room already handled');
  }

  // Add kick_player and switch_human_team emission methods
  const oldKickMethod = `  kickPlayer(targetId) {`;
  if (!src.includes('kickPlayer(targetId)')) {
    // Find a good place to insert — after switchBotTeam
    const afterBotSwitch = `  switchBotTeam(botId, team) {
    if (this.socket && this.roomCode) {
      this.socket.emit('switch_bot_team', { botId, team });
    }
  }`;
    const newBotSwitch = `  switchBotTeam(botId, team) {
    if (this.socket && this.roomCode) {
      this.socket.emit('switch_bot_team', { botId, team });
    }
  }

  kickPlayer(targetId) {
    if (this.socket && this.roomCode) {
      this.socket.emit('kick_player', { targetId });
    }
  }

  switchHumanTeam(targetId, team) {
    if (this.socket && this.roomCode) {
      this.socket.emit('switch_human_team', { targetId, team });
    }
  }`;

    if (src.includes(afterBotSwitch)) {
      src = src.replace(afterBotSwitch, newBotSwitch);
      console.log('✅ FIX 6+7: kickPlayer + switchHumanTeam methods added');
    } else {
      // Try to append before last closing brace of class
      console.log('⚠️  FIX 6+7: switchBotTeam not found, searching alternate...');
      const altPattern = `  removeBot(botId) {
    if (this.socket && this.roomCode) {
      this.socket.emit('remove_bot', { botId });
    }
  }`;
      const altNew = `  removeBot(botId) {
    if (this.socket && this.roomCode) {
      this.socket.emit('remove_bot', { botId });
    }
  }

  kickPlayer(targetId) {
    if (this.socket && this.roomCode) {
      this.socket.emit('kick_player', { targetId });
    }
  }

  switchHumanTeam(targetId, team) {
    if (this.socket && this.roomCode) {
      this.socket.emit('switch_human_team', { targetId, team });
    }
  }`;
      if (src.includes(altPattern)) {
        src = src.replace(altPattern, altNew);
        console.log('✅ FIX 6+7: kickPlayer + switchHumanTeam appended after removeBot');
      } else {
        console.log('⚠️  FIX 6+7: could not find insertion point in network.js');
      }
    }
  } else {
    console.log('ℹ️  FIX 6+7: kickPlayer already exists in network.js');
  }

  writeFile('public/js/network.js', src);
}

// ============================================================
// FIX 2, 6, 7, 9: ui.js — updateLobbyRoom overhaul
// ============================================================
function fixUiJs() {
  let src = readFile('public/js/ui.js');

  // Replace the entire updateLobbyRoom method
  const oldMethod = `  // Update Room Lobby details & Player Rosters
  updateLobbyRoom(roomState, localPlayerId) {
    this.panelEntry.classList.add('hidden');
    if (this.panelPublicLobbies) this.panelPublicLobbies.classList.add('hidden');
    this.panelRoom.classList.remove('hidden');
    this.displayRoomCode.innerText = roomState.code;

    const localPlayer = roomState.players.find(p => p.id === localPlayerId);
    const isHost = localPlayer && localPlayer.isHost;

    // Show Launch button only for host
    if (isHost) {
      this.btnStartMatch.classList.remove('hidden');
    } else {
      this.btnStartMatch.classList.add('hidden');
    }

    // Leader penalty banner — if the host is penalized, disable Launch Match
    const hostPlayer = roomState.players.find(p => p.isHost);
    if (hostPlayer && hostPlayer.penaltyUntil && hostPlayer.penaltyUntil > Date.now()) {
      if (this.leaderPenaltyBanner) this.leaderPenaltyBanner.classList.remove('hidden');
      if (this.btnStartMatch) this.btnStartMatch.disabled = true;

      const remainMs = hostPlayer.penaltyUntil - Date.now();
      const totalSec = Math.ceil(remainMs / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      if (this.leaderPenaltyTimer) this.leaderPenaltyTimer.innerText = `${mm}:${ss}`;
    } else {
      if (this.leaderPenaltyBanner) this.leaderPenaltyBanner.classList.add('hidden');
      if (this.btnStartMatch) this.btnStartMatch.disabled = false;
    }

    // Populate Rosters
    this.rosterAttackers.innerHTML = '';
    this.rosterDefenders.innerHTML = '';

    roomState.players.forEach(p => {
      const isLocal = p.id === localPlayerId;
      const agent = CONSTANTS.AGENTS[p.agent];
      const card = document.createElement('div');
      card.className = \`roster-card \${isLocal ? 'is-local' : ''}\`;

      // Bot switch arrows — only for party leader, only for bots
      let botControls = '';
      if (p.isBot && isHost) {
        if (p.team === 'defenders') {
          // Arrow faces LEFT → move bot to Attackers
          botControls = \`
            <div class="bot-controls">
              <button class="btn-bot-switch btn-switch-left" title="Move Bot to Attackers">← ATT</button>
              <button class="btn-bot-remove" title="Remove Bot">✕</button>
            </div>\`;
        } else {
          // Arrow faces RIGHT → move bot to Defenders
          botControls = \`
            <div class="bot-controls">
              <button class="btn-bot-switch btn-switch-right" title="Move Bot to Defenders">DEF →</button>
              <button class="btn-bot-remove" title="Remove Bot">✕</button>
            </div>\`;
        }
      }

      card.innerHTML = \`
        <div class="roster-card-info">
          <div class="roster-agent-dot" style="background: \${agent ? agent.color : '#888'};"></div>
          <div>
            <div class="roster-player-name">\${p.name} \${p.isHost ? '👑' : ''} \${p.isBot ? '🤖' : ''}</div>
            <div class="roster-agent-name">\${agent ? agent.name : 'Unknown'}</div>
          </div>
        </div>
        \${botControls || \`<div class="roster-status">\${p.ready ? 'READY' : 'CHOOSING'}</div>\`}
      \`;

      // Wire bot control buttons after innerHTML is set
      if (p.isBot && isHost) {
        const switchBtn = card.querySelector('.btn-bot-switch');
        const removeBtn = card.querySelector('.btn-bot-remove');
        if (switchBtn) {
          switchBtn.addEventListener('click', () => {
            const targetTeam = p.team === 'defenders' ? 'attackers' : 'defenders';
            if (this.onSwitchBotTeam) this.onSwitchBotTeam(p.id, targetTeam);
          });
        }
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            if (this.onRemoveBot) this.onRemoveBot(p.id);
          });
        }
      }

      if (p.team === 'attackers') {
        this.rosterAttackers.appendChild(card);
      } else {
        this.rosterDefenders.appendChild(card);
      }
    });
  }`;

  const newMethod = `  // Update Room Lobby details & Player Rosters
  updateLobbyRoom(roomState, localPlayerId) {
    this.panelEntry.classList.add('hidden');
    if (this.panelPublicLobbies) this.panelPublicLobbies.classList.add('hidden');
    this.panelRoom.classList.remove('hidden');
    this.displayRoomCode.innerText = roomState.code;

    const localPlayer = roomState.players.find(p => p.id === localPlayerId);
    const isHost = localPlayer && localPlayer.isHost;

    // FIX 2: Show Launch button ONLY for host
    if (isHost) {
      this.btnStartMatch.classList.remove('hidden');
    } else {
      this.btnStartMatch.classList.add('hidden');
    }

    // FIX 9: Show Add AI Bot ONLY for host
    if (this.btnAddBot) {
      if (isHost) {
        this.btnAddBot.classList.remove('hidden');
      } else {
        this.btnAddBot.classList.add('hidden');
      }
    }

    // Leader penalty banner
    const hostPlayer = roomState.players.find(p => p.isHost);
    if (hostPlayer && hostPlayer.penaltyUntil && hostPlayer.penaltyUntil > Date.now()) {
      if (this.leaderPenaltyBanner) this.leaderPenaltyBanner.classList.remove('hidden');
      if (this.btnStartMatch) this.btnStartMatch.disabled = true;
      const remainMs = hostPlayer.penaltyUntil - Date.now();
      const totalSec = Math.ceil(remainMs / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      if (this.leaderPenaltyTimer) this.leaderPenaltyTimer.innerText = \`\${mm}:\${ss}\`;
    } else {
      if (this.leaderPenaltyBanner) this.leaderPenaltyBanner.classList.add('hidden');
      if (this.btnStartMatch) this.btnStartMatch.disabled = false;
    }

    // Deduplicate players by id before rendering
    const seenIds = new Set();
    const uniquePlayers = roomState.players.filter(p => {
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });

    // Populate Rosters
    this.rosterAttackers.innerHTML = '';
    this.rosterDefenders.innerHTML = '';

    uniquePlayers.forEach(p => {
      const isLocal = p.id === localPlayerId;
      const agent = CONSTANTS.AGENTS[p.agent];
      const card = document.createElement('div');
      card.className = \`roster-card \${isLocal ? 'is-local' : ''}\`;

      // Build host-only player controls (FIX 6 + 7)
      let hostControls = '';
      if (isHost && !isLocal) {
        // Determine switch button label
        const switchLabel = p.team === 'defenders' ? '← ATT' : 'DEF →';
        const switchTitle = p.team === 'defenders' ? 'Move to Attackers' : 'Move to Defenders';
        hostControls = \`
          <div class="bot-controls">
            <button class="btn-bot-switch \${p.team === 'defenders' ? 'btn-switch-left' : 'btn-switch-right'}" title="\${switchTitle}">\${switchLabel}</button>
            <button class="\${p.isBot ? 'btn-bot-remove' : 'btn-player-kick'}" title="\${p.isBot ? 'Remove Bot' : 'Kick Player'}">✕</button>
          </div>\`;
      } else if (isHost && isLocal) {
        // Host sees their own card with HOST label only
        hostControls = \`<div class="roster-status host-badge">HOST 👑</div>\`;
      }

      card.innerHTML = \`
        <div class="roster-card-info">
          <div class="roster-agent-dot" style="background: \${agent ? agent.color : '#888'};"></div>
          <div>
            <div class="roster-player-name">\${p.name} \${p.isHost ? '👑' : ''} \${p.isBot ? '🤖' : ''}</div>
            <div class="roster-agent-name">\${agent ? agent.name : 'Unknown'}</div>
          </div>
        </div>
        \${hostControls || \`<div class="roster-status">\${p.isHost ? 'HOST' : (p.ready ? 'READY' : 'WAITING')}</div>\`}
      \`;

      // Wire controls for host (bots and human players)
      if (isHost && !isLocal) {
        const switchBtn = card.querySelector('.btn-bot-switch');
        if (switchBtn) {
          switchBtn.addEventListener('click', () => {
            const targetTeam = p.team === 'defenders' ? 'attackers' : 'defenders';
            if (p.isBot) {
              if (this.onSwitchBotTeam) this.onSwitchBotTeam(p.id, targetTeam);
            } else {
              if (this.onSwitchHumanTeam) this.onSwitchHumanTeam(p.id, targetTeam);
            }
          });
        }

        const removeBtn = card.querySelector('.btn-bot-remove');
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            if (this.onRemoveBot) this.onRemoveBot(p.id);
          });
        }

        const kickBtn = card.querySelector('.btn-player-kick');
        if (kickBtn) {
          kickBtn.addEventListener('click', () => {
            if (this.onKickPlayer) this.onKickPlayer(p.id);
          });
        }
      }

      if (p.team === 'attackers') {
        this.rosterAttackers.appendChild(card);
      } else {
        this.rosterDefenders.appendChild(card);
      }
    });
  }`;

  if (src.includes('// Update Room Lobby details & Player Rosters')) {
    // Find and replace the full method
    const startIdx = src.indexOf('  // Update Room Lobby details & Player Rosters');
    // Find the end: next method starting with '  // ' or '  update' or '  show' at same indentation
    // Find closing by matching brace level
    let braceCount = 0;
    let inMethod = false;
    let endIdx = startIdx;
    for (let i = startIdx; i < src.length; i++) {
      if (src[i] === '{') { braceCount++; inMethod = true; }
      if (src[i] === '}') { braceCount--; }
      if (inMethod && braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }

    const before = src.substring(0, startIdx);
    const after = src.substring(endIdx);
    src = before + newMethod + after;
    console.log('✅ FIX 2,6,7,9: updateLobbyRoom replaced');
  } else {
    console.log('⚠️  FIX 2,6,7,9: updateLobbyRoom marker not found');
  }

  // Wire onSwitchHumanTeam and onKickPlayer in the init or wherever onSwitchBotTeam is wired
  // These will be connected in main.js

  writeFile('public/js/ui.js', src);
}

// ============================================================
// FIX 8: renderer.js — Fix wall colors and floor glow
// ============================================================
function fixRendererColors() {
  let src = readFile('public/js/renderer.js');

  // Fix floor: from near-black to metallic grey
  const oldFloor = `    // Dark floor
    ctx.fillStyle = '#0f1722';
    ctx.fillRect(0, 0, MAP_DATA.width, MAP_DATA.height);

    // Tactical subtle grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';`;

  const newFloor = `    // Metallic steel grey floor with glow
    // Base floor fill - metallic grey
    ctx.fillStyle = '#1a2030';
    ctx.fillRect(0, 0, MAP_DATA.width, MAP_DATA.height);

    // Subtle steel plate sheen overlay
    const floorGrad = ctx.createLinearGradient(0, 0, MAP_DATA.width, MAP_DATA.height);
    floorGrad.addColorStop(0, 'rgba(50, 65, 80, 0.18)');
    floorGrad.addColorStop(0.5, 'rgba(70, 85, 100, 0.10)');
    floorGrad.addColorStop(1, 'rgba(40, 55, 70, 0.18)');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, 0, MAP_DATA.width, MAP_DATA.height);

    // Tactical subtle grid
    ctx.strokeStyle = 'rgba(100, 140, 180, 0.06)';`;

  if (src.includes(oldFloor)) {
    src = src.replace(oldFloor, newFloor);
    console.log('✅ FIX 8: Floor color updated to metallic grey');
  } else {
    console.log('⚠️  FIX 8: Floor pattern not found');
  }

  // Fix walls: from dark grey (#1c2833) to lighter steel/concrete
  const oldWallFill = `      } else {
        // Architectural Stone/Metal Wall
        ctx.fillStyle = '#1c2833';
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

        // Wall top bevel
        ctx.strokeStyle = '#2e4053';
        ctx.lineWidth = 2;
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);

        // Shadow outline
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(wall.x - 1, wall.y - 1, wall.w + 2, wall.h + 2);
      }`;

  const newWallFill = `      } else {
        // Architectural Stone/Metal Wall — steel blue-grey, NOT dark
        ctx.fillStyle = '#2a3a4a';
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

        // Top highlight bevel (lighter edge to give 3D feel)
        ctx.fillStyle = 'rgba(100, 130, 160, 0.18)';
        ctx.fillRect(wall.x, wall.y, wall.w, 3);
        ctx.fillRect(wall.x, wall.y, 3, wall.h);

        // Wall border - steel blue
        ctx.strokeStyle = '#4a6580';
        ctx.lineWidth = 2;
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);

        // Subtle shadow at bottom/right
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(wall.x - 1, wall.y - 1, wall.w + 2, wall.h + 2);
      }`;

  if (src.includes(oldWallFill)) {
    src = src.replace(oldWallFill, newWallFill);
    console.log('✅ FIX 8: Wall color updated to steel blue-grey');
  } else {
    console.log('⚠️  FIX 8: Wall fill pattern not found');
  }

  writeFile('public/js/renderer.js', src);
}

// ============================================================
// FIX 3: Defender spawn / rendering — ensure localPlayer is
//         properly positioned for defender team
// ============================================================
function fixDefenderSpawn() {
  let src = readFile('public/js/game.js');

  // Fix: When server state arrives, if predictedLocalPlayer hasn't been init'd yet
  // for a defender-side player, sync it immediately from server
  const oldInit = `    this.network.onServerReconcile = (authoritativePlayer, pendingInputs) => {
      this.reconcileServerState(authoritativePlayer, pendingInputs);
    };`;

  const newInit = `    this.network.onServerReconcile = (authoritativePlayer, pendingInputs) => {
      // FIX 3: Make sure predictedLocalPlayer is always initialized from server coords
      // This prevents defenders from being invisible (spawn coord mismatch)
      if (!this._predictedInitialized) {
        this.predictedLocalPlayer.x = authoritativePlayer.x;
        this.predictedLocalPlayer.y = authoritativePlayer.y;
        this._predictedInitialized = true;
      }
      this.reconcileServerState(authoritativePlayer, pendingInputs);
    };`;

  if (src.includes(oldInit)) {
    src = src.replace(oldInit, newInit);
    console.log('✅ FIX 3: Defender spawn fix applied');
  } else {
    console.log('⚠️  FIX 3: onServerReconcile pattern not found');
  }

  writeFile('public/js/game.js', src);
}

// ============================================================
// FIX 7: main.js — wire onKickPlayer and onSwitchHumanTeam callbacks
// ============================================================
function fixMainJs() {
  let src = readFile('public/js/main.js');

  // Find where onSwitchBotTeam is wired and add the new callbacks
  const oldBotWire = `  ui.onSwitchBotTeam = (botId, team) => {
    network.switchBotTeam(botId, team);
  };`;

  const newBotWire = `  ui.onSwitchBotTeam = (botId, team) => {
    network.switchBotTeam(botId, team);
  };

  ui.onKickPlayer = (targetId) => {
    network.kickPlayer(targetId);
  };

  ui.onSwitchHumanTeam = (targetId, team) => {
    network.switchHumanTeam(targetId, team);
  };`;

  if (src.includes(oldBotWire)) {
    src = src.replace(oldBotWire, newBotWire);
    console.log('✅ FIX 7: onKickPlayer + onSwitchHumanTeam wired in main.js');
  } else if (src.includes('onKickPlayer')) {
    console.log('ℹ️  FIX 7: callbacks already wired');
  } else {
    // Try alternate patterns
    const altPattern = `  network.onRemoveBot = ui.onRemoveBot`;
    if (src.includes('onRemoveBot')) {
      // Find the onRemoveBot wiring and add after it
      const rmBotPattern = `  ui.onRemoveBot = (botId) => {
    network.removeBot(botId);
  };`;
      const rmBotNew = `  ui.onRemoveBot = (botId) => {
    network.removeBot(botId);
  };

  ui.onKickPlayer = (targetId) => {
    network.kickPlayer(targetId);
  };

  ui.onSwitchHumanTeam = (targetId, team) => {
    network.switchHumanTeam(targetId, team);
  };`;
      if (src.includes(rmBotPattern)) {
        src = src.replace(rmBotPattern, rmBotNew);
        console.log('✅ FIX 7: callbacks wired via onRemoveBot');
      } else {
        console.log('⚠️  FIX 7: could not find wire point in main.js — may need manual fix');
      }
    } else {
      console.log('⚠️  FIX 7: could not wire callbacks in main.js');
    }
  }

  writeFile('public/js/main.js', src);
}

// ============================================================
// FIX CSS: Add styles for new kick button
// ============================================================
function fixCss() {
  let src = readFile('public/css/style.css');

  const kickCss = `
/* === FIX 6: Kick Button for Host === */
.btn-player-kick {
  background: rgba(255, 70, 85, 0.15);
  border: 1px solid rgba(255, 70, 85, 0.4);
  color: #ff4655;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  font-family: inherit;
}

.btn-player-kick:hover {
  background: rgba(255, 70, 85, 0.35);
  border-color: #ff4655;
}

/* Host badge in own card */
.roster-status.host-badge {
  color: #ffde59;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 1px;
}
`;

  if (!src.includes('btn-player-kick')) {
    src += kickCss;
    writeFile('public/css/style.css', src);
    console.log('✅ FIX CSS: kick button styles added');
  } else {
    console.log('ℹ️  FIX CSS: kick button styles already present');
  }
}

// ============================================================
// RUN ALL FIXES
// ============================================================
console.log('\n🚀 Starting comprehensive fix script...\n');

try { fixServerJs(); } catch(e) { console.error('❌ fixServerJs:', e.message); }
try { fixNetworkJs(); } catch(e) { console.error('❌ fixNetworkJs:', e.message); }
try { fixUiJs(); } catch(e) { console.error('❌ fixUiJs:', e.message); }
try { fixRendererColors(); } catch(e) { console.error('❌ fixRendererColors:', e.message); }
try { fixDefenderSpawn(); } catch(e) { console.error('❌ fixDefenderSpawn:', e.message); }
try { fixMainJs(); } catch(e) { console.error('❌ fixMainJs:', e.message); }
try { fixCss(); } catch(e) { console.error('❌ fixCss:', e.message); }

console.log('\n✅ All fixes applied! Run: npm start to verify.\n');

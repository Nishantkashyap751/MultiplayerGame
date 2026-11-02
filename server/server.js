const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const CONSTANTS = require('../shared/constants');
const {
  GameRoom,
  rooms,
  playerPenalties,
  getPlayerPenalty,
  generateRoomCode,
  setRoomsIO
} = require('./rooms');
const { initGameLoop } = require('./gameLoop');

const app = express();
const server = http.createServer(app);

// Optimized Socket.io configuration for minimal packet overhead
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  perMessageDeflate: {
    threshold: 1024 // Only compress packets larger than 1KB to minimize CPU latency on fast ticks
  },
  pingInterval: 10000,
  pingTimeout: 5000
});

// Pass io instance to rooms module for room-level event broadcasting
setRoomsIO(io);

const PORT = process.env.PORT || 3000;

// Helper: Get list of active public lobbies / sectors for matchmaking dashboard
function getPublicRooms() {
  const list = [];
  for (const [code, room] of rooms.entries()) {
    let humanCount = 0;
    let botCount = 0;
    for (const [, p] of room.players) {
      if (p.isBot) botCount++;
      else humanCount++;
    }
    list.push({
      code,
      state: room.state, // 'lobby', 'buyPhase', 'inRound', 'roundEnded'
      playerCount: room.players.size,
      humanCount,
      botCount,
      maxPlayers: 8,
      roundNumber: room.roundNumber || 1,
      score: room.score || { attackers: 0, defenders: 0 }
    });
  }
  return list;
}

function broadcastPublicRooms() {
  io.emit('public_rooms_update', getPublicRooms());
}


// Helper: Sanitize player object for socket.io emission (strips non-serializable internals)
function sanitizePlayer(p) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    agent: p.agent,
    ready: p.ready,
    isHost: p.isHost,
    isBot: p.isBot,
    x: p.x !== undefined ? Math.round(p.x) : 0,
    y: p.y !== undefined ? Math.round(p.y) : 0,
    vx: p.vx !== undefined ? Number(Number(p.vx).toFixed(1)) : 0,
    vy: p.vy !== undefined ? Number(Number(p.vy).toFixed(1)) : 0,
    angle: p.angle !== undefined ? Number(Number(p.angle).toFixed(3)) : 0,
    health: p.health !== undefined ? Math.round(p.health) : 0,
    armor: p.armor !== undefined ? Math.round(p.armor) : 0,
    isAlive: p.isAlive,
    credits: p.credits || 0,
    currentSlot: p.currentSlot,
    weapons: p.weapons,
    abilityCharges: p.abilityCharges,
    blindTimer: p.blindTimer !== undefined ? Number(Number(p.blindTimer).toFixed(2)) : 0,
    paranoiaBlind: !!p.paranoiaBlind,
    reconRevealed: (p.reconRevealed && p.reconRevealed > Date.now()) ? true : false,
    reloading: p.reloading || false,
    stats: p.stats || { kills: 0, deaths: 0, assists: 0, score: 0 },
    penaltyUntil: p.penaltyUntil || 0,
    lastProcessedInput: p.lastProcessedInput || 0
  };
}
// Static routes
app.use(express.static(path.join(__dirname, '../public')));
app.use('/shared', express.static(path.join(__dirname, '../shared')));

// Initialize high-precision 64Hz physics and netcode game loop
const gameLoop = initGameLoop(io);

// Socket.io Connection & Events
io.on('connection', (socket) => {
  let currentRoomCode = null;

  // Immediately send public rooms list to newly connected operative
  socket.emit('public_rooms_update', getPublicRooms());

  // Request refreshed public rooms list
  socket.on('get_public_rooms', () => {
    socket.emit('public_rooms_update', getPublicRooms());
  });

  // 1. Create Room (Blocks if penalized)
  socket.on('create_room', ({ playerName, agent, penaltyUntil }) => {
    const serverPenalty = getPlayerPenalty(socket.id);
    const clientPenalty = (penaltyUntil && penaltyUntil > Date.now()) ? penaltyUntil : 0;
    const activePenalty = Math.max(serverPenalty, clientPenalty);

    if (activePenalty > Date.now()) {
      playerPenalties.set(socket.id, activePenalty);
      const remainingMin = Math.ceil((activePenalty - Date.now()) / 60000);
      socket.emit('error_message', { 
        message: `Matchmaking suspended: You are serving an abandon penalty (${remainingMin}m remaining). You cannot create a room, but you may still join a friend's room via code.` 
      });
      return;
    }

    let code = generateRoomCode();
    while (rooms.has(code)) {
      code = generateRoomCode();
    }

    const room = new GameRoom(code);
    rooms.set(code, room);

    socket.join(code);
    currentRoomCode = code;

    const player = room.addPlayer(socket.id, playerName, 'attackers', agent || 'omen');
    socket.emit('room_joined', {
      roomCode: code,
      playerId: socket.id,
      player: player,
      isHost: true,
      roomState: room.serialize()
    });

    broadcastPublicRooms();
  });

  // 2. Join Room (Allowed even if penalized, but transfers penalty status to party)
  socket.on('join_room', ({ roomCode, playerName, agent, penaltyUntil }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('error_message', { message: `Room "${code}" not found.` });
      return;
    }

    if (room.players.size >= 8) {
      socket.emit('error_message', { message: `Room "${code}" is full (max 8 players).` });
      return;
    }

    // Auto-balance teams
    let attCount = 0;
    let defCount = 0;
    for (const [, p] of room.players) {
      if (p.team === 'attackers') attCount++;
      else defCount++;
    }
    const team = attCount <= defCount ? 'attackers' : 'defenders';

    socket.join(code);
    currentRoomCode = code;

    const player = room.addPlayer(socket.id, playerName, team, agent || 'phoenix');
    if (penaltyUntil && penaltyUntil > Date.now()) {
      player.penaltyUntil = penaltyUntil;
      playerPenalties.set(socket.id, penaltyUntil);
    }

    socket.emit('room_joined', {
      roomCode: code,
      playerId: socket.id,
      player: player,
      isHost: player.isHost,
      roomState: room.serialize()
    });

    io.to(code).emit('player_joined', { player: sanitizePlayer(player) });
    // FIX 1: Broadcast full room state so all clients see updated roster (fixes card visibility)
    io.to(code).emit('room_updated', room.serialize());
    broadcastPublicRooms();
  });

  // 3. Switch Team
  socket.on('switch_team', ({ team }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'lobby') return;
    const player = room.players.get(socket.id);
    if (player) {
      player.team = team;
      io.to(currentRoomCode).emit('player_updated', { player: sanitizePlayer(player) });
    }
  });

  // 4. Select Agent
  socket.on('select_agent', ({ agent }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player && CONSTANTS.AGENTS[agent]) {
      player.agent = agent;
      io.to(currentRoomCode).emit('player_updated', { player: sanitizePlayer(player) });
    }
  });

  // 5. Toggle Ready
  socket.on('toggle_ready', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'lobby') return;
    const player = room.players.get(socket.id);
    if (player) {
      player.ready = !player.ready;
      io.to(currentRoomCode).emit('player_updated', { player: sanitizePlayer(player) });
    }
  });

  // 6. Add AI Bot (Party leader only)
  socket.on('add_bot', ({ team }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.isHost) return;

    const bot = room.addBot(team || 'defenders');
    io.to(currentRoomCode).emit('player_joined', { player: sanitizePlayer(bot) });
    broadcastPublicRooms();
  });

  // 6b. Switch Bot Team (Party leader only)
  socket.on('switch_bot_team', ({ botId, team }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'lobby') return;
    const player = room.players.get(socket.id);
    if (!player || !player.isHost) return; // Only party leader can control bots!

    const bot = room.players.get(botId);
    if (bot && bot.isBot) {
      bot.team = (team === 'attackers' || team === 'defenders') ? team : 'defenders';
      io.to(currentRoomCode).emit('player_updated', { player: sanitizePlayer(bot) });
    }
  });

  // 6c. Remove Bot (Party leader only)
  socket.on('remove_bot', ({ botId }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'lobby') return;
    const player = room.players.get(socket.id);
    if (!player || !player.isHost) return;

    const bot = room.players.get(botId);
    if (bot && bot.isBot) {
      room.removePlayer(botId);
      io.to(currentRoomCode).emit('player_left', { playerId: botId });
      broadcastPublicRooms();
    }
  });

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

    // Notify the kicked player, then remove them
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

  // 7. Start Game (Locked if leader is penalized)
  socket.on('start_game', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.isHost) return;

    // Check if leader is penalized
    const serverPenalty = getPlayerPenalty(socket.id);
    const clientPenalty = (player.penaltyUntil && player.penaltyUntil > Date.now()) ? player.penaltyUntil : 0;
    const activePenalty = Math.max(serverPenalty, clientPenalty);

    if (activePenalty > Date.now()) {
      const remainingMin = Math.ceil((activePenalty - Date.now()) / 60000);
      socket.emit('error_message', {
        message: `Party leader is penalized (${remainingMin}m remaining). Matchmaking locked for team until penalty expires.`
      });
      return;
    }

    room.startMatch();
    io.to(currentRoomCode).emit('game_started', room.serialize());
    broadcastPublicRooms();
  });

  // 7b. Abandon Match & Incur Leaver Penalty
  socket.on('abandon_match', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    // Calculate penalty based on game progression
    let penaltyMinutes = 10;
    if (room.roundNumber >= 4) {
      penaltyMinutes = 4;
    } else if (room.roundNumber >= 2) {
      penaltyMinutes = 7;
    }

    const penaltySeconds = penaltyMinutes * 60;
    const penaltyUntil = Date.now() + (penaltySeconds * 1000);
    playerPenalties.set(socket.id, penaltyUntil);

    room.removePlayer(socket.id);
    socket.leave(currentRoomCode);
    io.to(currentRoomCode).emit('player_left', { playerId: socket.id });

    if (room.players.size === 0) {
      rooms.delete(currentRoomCode);
    }

    currentRoomCode = null;
    socket.emit('abandon_penalized', { penaltySeconds, penaltyUntil });
    broadcastPublicRooms();
  });

  // 8. Player Movement Input with Client-Side Sequence Tracking
  socket.on('player_input', (inputData) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      player.input = { ...player.input, ...inputData };
      if (inputData.seq) {
        player.lastProcessedInput = inputData.seq;
      }
    }
  });

  // 9. Fire Weapon
  socket.on('fire_weapon', ({ angle }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      room.fireWeapon(player, player.currentSlot, angle);
    }
  });

  // 10. Reload Weapon
  socket.on('reload_weapon', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      room.reloadWeapon(player);
    }
  });

  // 11. Switch Weapon Slot ('primary', 'secondary', 'melee', 'spike')
  socket.on('switch_slot', ({ slot }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player && (player.weapons[slot] || (slot === 'spike' && room.spike.carrierId === player.id))) {
      player.currentSlot = slot;
    }
  });

  // 12. Buy Item (Weapons, Armor, Abilities)
  socket.on('buy_item', ({ category, itemId }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'buyPhase') return;
    const player = room.players.get(socket.id);
    if (!player) return;

    if (category === 'weapon') {
      const weaponDef = CONSTANTS.WEAPONS[itemId];
      if (weaponDef && player.credits >= weaponDef.cost) {
        player.credits -= weaponDef.cost;
        player.weapons[weaponDef.slot] = {
          ...weaponDef,
          curAmmo: weaponDef.magSize,
          reserveAmmo: weaponDef.reserve
        };
        player.currentSlot = weaponDef.slot;
        socket.emit('buy_success', { credits: player.credits, weapons: player.weapons });
      }
    } else if (category === 'armor') {
      const armorDef = CONSTANTS.ARMOR[itemId];
      if (armorDef && player.credits >= armorDef.cost && player.armor < armorDef.armor) {
        player.credits -= armorDef.cost;
        player.armor = armorDef.armor;
        socket.emit('buy_success', { credits: player.credits, armor: player.armor });
      }
    } else if (category === 'ability') {
      const agentDef = CONSTANTS.AGENTS[player.agent];
      if (agentDef && agentDef.abilities[itemId]) {
        const ab = agentDef.abilities[itemId];
        const curCharges = player.abilityCharges[itemId] || 0;
        if (curCharges < ab.maxCharges && player.credits >= ab.cost) {
          player.credits -= ab.cost;
          player.abilityCharges[itemId] = curCharges + 1;
          socket.emit('buy_success', { credits: player.credits, abilityCharges: player.abilityCharges });
        }
      }
    }
  });

  // 13. Use Agent Ability
  socket.on('use_ability', ({ abilityKey, targetX, targetY }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      room.useAbility(player, abilityKey, targetX, targetY);
    }
  });

  // 14. Plant / Defuse Spike
  socket.on('spike_action_start', ({ action }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'inRound') return;
    const player = room.players.get(socket.id);
    if (!player || !player.isAlive) return;

    if (action === 'plant' && player.team === 'attackers' && room.spike.carrierId === player.id) {
      room.spike.planterId = player.id;
    } else if (action === 'defuse' && player.team === 'defenders' && room.spike.planted) {
      room.spike.defuserId = player.id;
    }
  });

  socket.on('spike_action_stop', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    if (room.spike.planterId === socket.id) {
      room.spike.planterId = null;
      const player = room.players.get(socket.id);
      if (player && player.currentSlot === 'spike') {
        player.currentSlot = player.weapons.primary ? 'primary' : (player.weapons.secondary ? 'secondary' : 'melee');
      }
    }
    if (room.spike.defuserId === socket.id) room.spike.defuserId = null;
  });

  // 15. Fast Forward / Skip Buy Phase (convenience for testing)
  socket.on('skip_buy_phase', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.state !== 'buyPhase') return;
    room.roundTimer = 0.5;
  });

  // 16. Leave Room / Return to Dashboard
  socket.on('leave_room', () => {
    if (currentRoomCode) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        room.removePlayer(socket.id);
        socket.leave(currentRoomCode);
        io.to(currentRoomCode).emit('player_left', { playerId: socket.id });
        if (room.players.size === 0) {
          rooms.delete(currentRoomCode);
        }
      }
      currentRoomCode = null;
      socket.emit('left_room_success');
      broadcastPublicRooms();
    }
  });

  // 17. Return Room to Lobby Dashboard
  socket.on('return_to_lobby', () => {
    if (currentRoomCode) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        room.resetToLobby();
        broadcastPublicRooms();
      }
    }
  });

  // 18. Disconnect
  socket.on('disconnect', () => {
    if (currentRoomCode) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        room.removePlayer(socket.id);
        io.to(currentRoomCode).emit('player_left', { playerId: socket.id });
        if (room.players.size === 0) {
          rooms.delete(currentRoomCode);
        }
      }
      broadcastPublicRooms();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`  TACTICAL CORE ENGINE (64Hz) RUNNING ON:      `);
  console.log(`  http://localhost:${PORT}                     `);
  console.log(`===============================================`);
});

module.exports = { app, server, io, gameLoop };

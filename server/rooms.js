const CONSTANTS = require('../shared/constants');
const { MAP_DATA, getWallSegments } = require('../shared/mapData');
const { AABB, Quadtree } = require('./quadtree');
const { EliteTacticalAI } = require('./tacticalAI');
const MatchHistory = require('./models/MatchHistory');

let io = null;
function setRoomsIO(ioInstance) {
  io = ioInstance;
}

const rooms = new Map();

// Store active leaver matchmaking penalties (socketId / client -> penaltyUntil timestamp)
const playerPenalties = new Map();

function getPlayerPenalty(id) {
  const expiry = playerPenalties.get(id);
  if (expiry && expiry > Date.now()) {
    return expiry;
  }
  playerPenalties.delete(id);
  return 0;
}

// Helper: Generate random 5-letter room code
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Helper: Distance between two points
function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

// Helper: Line intersection with wall segment
function lineIntersectsWall(p1, p2, wall) {
  // Check against 4 segments of rectangle
  const segments = [
    { a: { x: wall.x, y: wall.y }, b: { x: wall.x + wall.w, y: wall.y } },
    { a: { x: wall.x + wall.w, y: wall.y }, b: { x: wall.x + wall.w, y: wall.y + wall.h } },
    { a: { x: wall.x + wall.w, y: wall.y + wall.h }, b: { x: wall.x, y: wall.y + wall.h } },
    { a: { x: wall.x, y: wall.y + wall.h }, b: { x: wall.x, y: wall.y } }
  ];

  let closestHit = null;
  let minFraction = 1.0;

  for (const seg of segments) {
    const hit = getLineSegmentIntersection(p1, p2, seg.a, seg.b);
    if (hit && hit.t < minFraction) {
      minFraction = hit.t;
      closestHit = hit;
    }
  }

  return closestHit;
}

function getLineSegmentIntersection(p1, p2, p3, p4) {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 0.0001) return null;

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return {
      x: x1 + ua * (x2 - x1),
      y: y1 + ua * (y2 - y1),
      t: ua
    };
  }
  return null;
}

// Circle to AABB collision test & resolution
function resolvePlayerWallCollision(player, walls) {
  const r = CONSTANTS.PLAYER_RADIUS;

  for (const w of walls) {
    // Find closest point on rectangle to circle
    const closestX = Math.max(w.x, Math.min(player.x, w.x + w.w));
    const closestY = Math.max(w.y, Math.min(player.y, w.y + w.h));

    const dx = player.x - closestX;
    const dy = player.y - closestY;
    const distanceSq = dx * dx + dy * dy;

    if (distanceSq < r * r && distanceSq > 0.00001) {
      const distance = Math.sqrt(distanceSq);
      const overlap = r - distance;
      const nx = dx / distance;
      const ny = dy / distance;
      player.x += nx * overlap;
      player.y += ny * overlap;
    } else if (distanceSq <= 0.00001) {
      // Inside box, push out towards nearest edge
      player.y -= r;
    }
  }

  // Constrain to map boundaries
  player.x = Math.max(r + 40, Math.min(MAP_DATA.width - r - 40, player.x));
  player.y = Math.max(r + 40, Math.min(MAP_DATA.height - r - 40, player.y));
}

// Room Management Class
class GameRoom {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.wallQuadtree = new Quadtree(new AABB(0, 0, MAP_DATA.width, MAP_DATA.height), 8, 6);
    for (const wall of MAP_DATA.walls) {
      this.wallQuadtree.insert(wall);
    }
    this.stateSequence = 0;
    this.lastSerializedState = null; // socketId -> player object
    this.state = 'lobby'; // 'lobby', 'buyPhase', 'inRound', 'roundEnded', 'matchEnded'
    this.roundNumber = 0;
    this.score = { attackers: 0, defenders: 0 };
    this.roundTimer = CONSTANTS.BUY_PHASE_TIME;
    this.timerInterval = null;
    this.lastTick = Date.now();
    
    this.spike = {
      carrierId: null, // socketId of carrier
      planted: false,
      x: null,
      y: null,
      site: null,
      planterId: null,
      defuserId: null,
      plantProgress: 0,
      defuseProgress: 0,
      detonateTimer: 0
    };

    this.droppedSpike = null; // { x, y } if dropped on ground
    this.droppedItems = []; // weapons dropped
    this.activeSmokes = []; // { id, x, y, radius, expiresAt, color }
    this.activeMolotovs = []; // { id, x, y, radius, expiresAt, dps, ownerId }
    this.activeReconBolts = []; // { id, x, y, pulsesLeft, nextPulse, radius, team }
    this.tracers = []; // visual bullet rays to broadcast { from, to, headshot }
    this.killFeed = [];

    this.isBotMatch = false;
    this.botCounter = 1;

    // Separate map for bot AI instances to prevent circular refs in socket.io serialization
    this.botAIs = new Map(); // botId -> EliteTacticalAI instance

    // AFK tracking: socketId -> { lastX, lastY, afkRounds, warned }
    this.playerAfkData = new Map();
  }

  addPlayer(socketId, name, team = 'attackers', agent = 'omen') {
    const existingCount = this.players.size;
    const isHost = existingCount === 0;

    const player = {
      id: socketId,
      name: name || `Agent ${existingCount + 1}`,
      team: team,
      agent: agent,
      isHost: isHost,
      isBot: false,
      
      // Gameplay state
      x: 1100,
      y: 1450,
      vx: 0,
      vy: 0,
      angle: 0,
      health: 100,
      armor: 0,
      isAlive: true,
      credits: CONSTANTS.STARTING_CREDITS,
      
      // Weapon inventory
      currentSlot: 'secondary', // 'primary', 'secondary', 'melee', 'spike'
      weapons: {
        secondary: { ...CONSTANTS.WEAPONS.classic, curAmmo: CONSTANTS.WEAPONS.classic.magSize, reserveAmmo: CONSTANTS.WEAPONS.classic.reserve },
        primary: null,
        melee: { ...CONSTANTS.WEAPONS.knife }
      },
      
      // Ability charges
      abilityCharges: {
        ability1: CONSTANTS.AGENTS[agent]?.abilities.ability1.maxCharges || 1,
        ability2: CONSTANTS.AGENTS[agent]?.abilities.ability2.maxCharges || 1
      },

      // Status effects
      blindTimer: 0,
      reloading: false,
      reloadTimer: 0,
      lastFireTime: 0,
      ping: 0,
      penaltyUntil: getPlayerPenalty(socketId) || 0,

      // Stats
      stats: { kills: 0, deaths: 0, assists: 0, score: 0 },

      // Inputs
      input: {
        up: false,
        down: false,
        left: false,
        right: false,
        shift: false,
        crouch: false,
        angle: 0
      }
    };

    this.players.set(socketId, player);
    return player;
  }

  addBot(team = 'defenders') {
    const botId = `bot_${this.botCounter++}`;
    const agentKeys = Object.keys(CONSTANTS.AGENTS);
    const randomAgent = agentKeys[Math.floor(Math.random() * agentKeys.length)];

    const bot = {
      id: botId,
      name: `Bot ${botId.replace('bot_', '')}`,
      team: team,
      agent: randomAgent,
      isHost: false,
      isBot: true,

      x: 1100,
      y: 150,
      vx: 0,
      vy: 0,
      angle: Math.PI / 2,
      health: 100,
      armor: 50,
      isAlive: true,
      credits: 9000,

      currentSlot: 'primary',
      weapons: {
        primary: { ...CONSTANTS.WEAPONS.vandal, curAmmo: CONSTANTS.WEAPONS.vandal.magSize, reserveAmmo: CONSTANTS.WEAPONS.vandal.reserve },
        secondary: { ...CONSTANTS.WEAPONS.ghost, curAmmo: CONSTANTS.WEAPONS.ghost.magSize, reserveAmmo: CONSTANTS.WEAPONS.ghost.reserve },
        melee: { ...CONSTANTS.WEAPONS.knife }
      },

      abilityCharges: { ability1: 1, ability2: 1 },
      blindTimer: 0,
      reloading: false,
      reloadTimer: 0,
      lastFireTime: 0,
      ping: 5,
      stats: { kills: 0, deaths: 0, assists: 0, score: 0 },
      input: { up: false, down: false, left: false, right: false, shift: false, crouch: false, angle: Math.PI / 2 }
    };

    this.botAIs.set(botId, new EliteTacticalAI(bot));

    this.players.set(botId, bot);
    return bot;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;

    // If carrying spike, drop it
    if (this.spike.carrierId === socketId && !this.spike.planted) {
      this.droppedSpike = { x: player.x, y: player.y };
      this.spike.carrierId = null;
    }

    const wasHost = player.isHost;
    this.players.delete(socketId);
    // Clean up AI instance if this was a bot
    this.botAIs.delete(socketId);
    // Clean up AFK tracking
    this.playerAfkData.delete(socketId);

    // If host left, elect new host
    if (wasHost && this.players.size > 0) {
      for (const [, p] of this.players) {
        if (!p.isBot) {
          p.isHost = true;
          break;
        }
      }
    }
  }

  // AFK System: evaluate players who haven't moved at round boundary
  _processAfkRoundStart() {
    const AFK_KICK_ROUNDS = 3;
    const AFK_KICK_PENALTY_MS = 10 * 60 * 1000; // 10 minutes

    const toKick = [];

    for (const [socketId, p] of this.players) {
      if (p.isBot) continue;

      const afk = this.playerAfkData.get(socketId) || { lastX: p.x, lastY: p.y, afkRounds: 0, warned: false };
      const moved = Math.hypot(p.x - afk.lastX, p.y - afk.lastY) > 30;

      if (!moved) {
        afk.afkRounds++;

        if (afk.afkRounds >= AFK_KICK_ROUNDS) {
          // Schedule kick
          const penaltyUntil = Date.now() + AFK_KICK_PENALTY_MS;
          playerPenalties.set(socketId, penaltyUntil);
          if (io) io.to(socketId).emit('afk_kicked', { penaltyUntil, penaltySeconds: AFK_KICK_PENALTY_MS / 1000 });
          toKick.push(socketId);
          this.playerAfkData.delete(socketId);
          continue;
        }

        // Warn on first AFK round
        if (afk.afkRounds === 1 && io) {
          io.to(socketId).emit('afk_warning', { afkRounds: afk.afkRounds, maxRounds: AFK_KICK_ROUNDS });
        }

        // Mark player as spectator for this round (will not spawn)
        p.isAfkThisRound = true;

        if (io) {
          io.to(socketId).emit('afk_spawn_skipped', {
            afkRounds: afk.afkRounds,
            roundsUntilKick: AFK_KICK_ROUNDS - afk.afkRounds
          });
        }
      } else {
        // Player came back — reset counter
        if (afk.afkRounds > 0 && io) {
          io.to(socketId).emit('afk_returned');
        }
        afk.afkRounds = 0;
        afk.warned = false;
        p.isAfkThisRound = false;
      }

      // Snapshot position for next round comparison
      afk.lastX = p.x;
      afk.lastY = p.y;
      this.playerAfkData.set(socketId, afk);
    }

    // Execute kicks after iteration (avoid modifying map while iterating)
    setTimeout(() => {
      for (const sid of toKick) {
        if (this.players.has(sid)) {
          this.removePlayer(sid);
          if (io) {
            io.to(this.code).emit('player_left', { playerId: sid });
          }
        }
      }
    }, 600);
  }
  startMatch() {
    this.roundNumber = 0;
    this.score = { attackers: 0, defenders: 0 };
    for (const [, p] of this.players) {
      p.credits = CONSTANTS.STARTING_CREDITS;
      p.stats = { kills: 0, deaths: 0, assists: 0, score: 0 };
      p.weapons.primary = null;
      p.weapons.secondary = { ...CONSTANTS.WEAPONS.classic, curAmmo: CONSTANTS.WEAPONS.classic.magSize, reserveAmmo: CONSTANTS.WEAPONS.classic.reserve };
      p.armor = 0;
    }
    this.startRound();
  }

  startRound() {
    this.roundNumber++;
    this.state = 'buyPhase';
    this.roundTimer = CONSTANTS.BUY_PHASE_TIME;

    // AFK check: evaluate players who haven't moved during previous round
    if (this.roundNumber > 1) this._processAfkRoundStart();

    this.activeSmokes = [];
    this.activeMolotovs = [];
    this.activeReconBolts = [];
    this.tracers = [];
    this.droppedItems = [];
    this.activeProjectiles = [];

    // Reset Spike
    this.spike = {
      carrierId: null,
      planted: false,
      x: null,
      y: null,
      site: null,
      planterId: null,
      defuserId: null,
      plantProgress: 0,
      defuseProgress: 0,
      detonateTimer: 0
    };
    this.droppedSpike = null;

    // Position players at spawns
    let attIdx = 0;
    let defIdx = 0;
    let designatedAttacker = null;

    for (const [socketId, p] of this.players) {
      const isAfkThisRound = !p.isBot && p.isAfkThisRound;
      // AFK players don't spawn this round (watched as ghost)
      p.isAlive = !isAfkThisRound;
      p.health = isAfkThisRound ? 0 : 100;
      p.blindTimer = 0;
      p.reloading = false;

      // Refill ammo of equipped weapons
      for (const slot of ['primary', 'secondary']) {
        if (p.weapons[slot]) {
          p.weapons[slot].curAmmo = p.weapons[slot].magSize;
          p.weapons[slot].reserveAmmo = p.weapons[slot].reserve;
        }
      }

      // Restore ability charges up to max
      const agentDef = CONSTANTS.AGENTS[p.agent];
      if (agentDef) {
        p.abilityCharges.ability1 = Math.max(1, p.abilityCharges.ability1 || 1);
        p.abilityCharges.ability2 = Math.max(1, p.abilityCharges.ability2 || 1);
      }

      if (p.team === 'attackers') {
        const spawn = MAP_DATA.spawns.attackers[attIdx % MAP_DATA.spawns.attackers.length];
        p.x = spawn.x;
        p.y = spawn.y;
        p.angle = -Math.PI / 2; // Facing up
        attIdx++;
        if (!designatedAttacker) designatedAttacker = p;
      } else {
        const spawn = MAP_DATA.spawns.defenders[defIdx % MAP_DATA.spawns.defenders.length];
        p.x = spawn.x;
        p.y = spawn.y;
        p.angle = Math.PI / 2; // Facing down
        defIdx++;
      }
    }

    // Give spike to first attacker
    if (designatedAttacker) {
      this.spike.carrierId = designatedAttacker.id;
    }
  }

  checkRoundWinConditions() {
    if (this.state !== 'inRound') return;

    let attackersAlive = 0;
    let defendersAlive = 0;

    for (const [, p] of this.players) {
      if (p.isAlive) {
        if (p.team === 'attackers') attackersAlive++;
        else defendersAlive++;
      }
    }

    // 1. Spike detonated - Massive Valorant-style Lethal Radianite Blast Wave
    if (this.spike.planted && this.spike.detonateTimer <= 0) {
      const blastX = this.spike.x;
      const blastY = this.spike.y;
      const blastRadius = 1350; // Massive lethal blast sphere

      // Eliminate all players caught within the detonation radius
      for (const [, p] of this.players) {
        if (p.isAlive) {
          const distToSpike = Math.hypot(p.x - blastX, p.y - blastY);
          if (distToSpike <= blastRadius) {
            p.health = 0;
            p.armor = 0;
            p.isAlive = false;
            p.stats.deaths++;
            this.killFeed.unshift({
              killerName: 'SPIKE DETONATION',
              killerTeam: 'attackers',
              victimName: p.name,
              victimTeam: p.team,
              weapon: 'Blast Wave',
              headshot: false,
              timestamp: Date.now()
            });
          }
        }
      }

      // Immediately clear spike from map (Valorant behavior)
      this.spike.planted = false;
      this.spike.x = null;
      this.spike.y = null;
      this.droppedSpike = null;

      if (io) {
        io.to(this.code).emit('spike_detonated', {
          x: blastX,
          y: blastY,
          radius: blastRadius,
          duration: 4.0
        });
        io.to(this.code).emit('spike_hidden');
      }

      this.endRound('attackers', 'Spike Detonated! Massive blast wave obliterated the sector.');
      return;
    }

    // 2. Spike defused
    if (this.spike.planted && this.spike.defuseProgress >= CONSTANTS.SPIKE_DEFUSE_TIME) {
      this.endRound('defenders', 'Spike Defused! Defenders win the round.');
      return;
    }

    // 3. Spike not planted and Defenders eliminated
    if (!this.spike.planted && defendersAlive === 0 && this.players.size > 0) {
      this.endRound('attackers', 'Defenders eliminated! Attackers win the round.');
      return;
    }

    // 4. Attackers eliminated
    if (attackersAlive === 0 && this.players.size > 0) {
      if (!this.spike.planted) {
        this.endRound('defenders', 'Attackers eliminated! Defenders win the round.');
        return;
      }
      // Spike planted — defenders still alive can defuse
    }

    // 4b. All defenders eliminated while spike is planted → attackers win (site cleared!)
    if (this.spike.planted && defendersAlive === 0 && this.players.size > 0) {
      this.endRound('attackers', 'Site cleared! All defenders eliminated — spike detonation imminent!');
      return;
    }

    // 5. Time ran out without spike planted
    if (!this.spike.planted && this.roundTimer <= 0) {
      this.endRound('defenders', 'Time ran out! Defenders win the round.');
      return;
    }
  }

  endRound(winnerTeam, reason) {
    this.state = 'roundEnded';
    this.score[winnerTeam]++;

    // Distribute Credits
    for (const [, p] of this.players) {
      if (p.team === winnerTeam) {
        p.credits = Math.min(CONSTANTS.MAX_CREDITS, p.credits + CONSTANTS.WIN_CREDITS);
      } else {
        p.credits = Math.min(CONSTANTS.MAX_CREDITS, p.credits + CONSTANTS.LOSS_CREDITS);
      }
    }

    io.to(this.code).emit('round_ended', {
      winner: winnerTeam,
      reason: reason,
      score: this.score,
      roundNumber: this.roundNumber
    });

    // Check Match Win (first team to 5 rounds total wins match)
    if (this.score[winnerTeam] >= CONSTANTS.ROUNDS_TO_WIN) {
      this.state = 'matchEnded';

      // Save match history to MongoDB for all players
      this.saveMatchHistory(winnerTeam);

      io.to(this.code).emit('match_ended', {
        winner: winnerTeam,
        score: this.score
      });

      // After match ends, return entire squad back to the room lobby (panel-room)
      setTimeout(() => {
        if (this.state === 'matchEnded') {
          this.resetToLobby();
        }
      }, 5500);
      return;
    }

    // Check Halftime Side Swap (after round 4 completes)
    if (this.roundNumber === (CONSTANTS.FIRST_HALF_ROUNDS || 4)) {
      this.isHalftime = true;

      // Swap all player team assignments and reset round weapons & economy for second half
      for (const [, p] of this.players) {
        p.team = (p.team === 'attackers') ? 'defenders' : 'attackers';
        p.weapons.primary = null;
        p.weapons.secondary = {
          ...CONSTANTS.WEAPONS.classic,
          curAmmo: CONSTANTS.WEAPONS.classic.magSize,
          reserveAmmo: CONSTANTS.WEAPONS.classic.reserve
        };
        p.currentSlot = 'secondary';
        p.armor = 0;
        p.credits = CONSTANTS.STARTING_CREDITS;
      }

      io.to(this.code).emit('halftime_switch', {
        roundNumber: this.roundNumber,
        score: this.score,
        message: 'HALFTIME // SWITCHING SIDES! Roles swapped: Attackers are now Defenders, Defenders are now Attackers.'
      });

      // Pause for 7 seconds to let players see the Halftime announcement before starting Round 5
      setTimeout(() => {
        if (this.state === 'roundEnded') {
          this.startRound();
        }
      }, 7000);
      return;
    }

    // Delay before starting next round
    setTimeout(() => {
      if (this.state === 'roundEnded') {
        this.startRound();
      }
    }, CONSTANTS.ROUND_END_DELAY * 1000);
  }

  // Save match history to MongoDB for career tracking
  async saveMatchHistory(winnerTeam) {
    try {
      for (const [, p] of this.players) {
        if (p.isBot) continue; // Skip bots

        const matchRecord = new MatchHistory({
          playerId: p.id,
          playerName: p.name,
          agent: p.agent,
          team: p.team,
          isVictory: p.team === winnerTeam,
          kills: p.stats.kills || 0,
          deaths: p.stats.deaths || 0,
          assists: p.stats.assists || 0,
          score: p.stats.score || 0,
          finalScore: this.score,
          roundNumber: this.roundNumber,
          roomCode: this.code
        });

        await matchRecord.save();
      }
      console.log(`✅ Match history saved for room ${this.code}`);
    } catch (error) {
      console.error('❌ Error saving match history:', error);
    }
  }

  resetToLobby() {
    this.state = 'lobby';
    this.roundNumber = 0;
    this.score = { attackers: 0, defenders: 0 };
    for (const [, p] of this.players) {
      p.health = 100;
      p.isAlive = true;
      p.credits = CONSTANTS.STARTING_CREDITS;
      p.stats = { kills: 0, deaths: 0, assists: 0, score: 0 };
      p.weapons.primary = null;
      p.weapons.secondary = { ...CONSTANTS.WEAPONS.classic, curAmmo: CONSTANTS.WEAPONS.classic.magSize, reserveAmmo: CONSTANTS.WEAPONS.classic.reserve };
      p.armor = 0;
    }
    io.to(this.code).emit('match_reset', this.serialize());
  }

  // Update Game Logic per tick (movement, physics, timers, bots)
  update(dt) {
    const now = Date.now();

    // 1. Update Timers
    if (this.state === 'buyPhase') {
      this.roundTimer -= dt;
      if (this.roundTimer <= 0) {
        this.state = 'inRound';
        this.roundTimer = CONSTANTS.ROUND_TIME;
        io.to(this.code).emit('round_started', {
          roundTimer: this.roundTimer,
          roundNumber: this.roundNumber
        });
      }
    } else if (this.state === 'inRound') {
      if (!this.spike.planted) {
        this.roundTimer -= dt;
      } else {
        this.spike.detonateTimer -= dt;
      }
      this.checkRoundWinConditions();
    }

    // 2. Active Utilities Timers
    this.activeSmokes = this.activeSmokes.filter(s => s.expiresAt > now);
    
    // Molotov damage ticks
    this.activeMolotovs = this.activeMolotovs.filter(m => {
      if (m.expiresAt <= now) return false;
      // Check players standing in molotov
      for (const [, p] of this.players) {
        if (p.isAlive && dist(p.x, p.y, m.x, m.y) <= m.radius) {
          const dmg = m.dps * dt;
          this.damagePlayer(p, dmg, m.ownerId, 'molotov', false);
        }
      }
      return true;
    });

    // 3. Update Players & Bots
    // 2b. Active Projectiles (Paranoia beam + Shock bolt)
    if (this.activeProjectiles && this.activeProjectiles.length > 0) {
      const PROJ_DT = dt;
      this.activeProjectiles = this.activeProjectiles.filter(proj => {
        if (!proj.alive) return false;

        // Move projectile
        const stepX = proj.vx * PROJ_DT;
        const stepY = proj.vy * PROJ_DT;
        proj.x += stepX;
        proj.y += stepY;

        // Wall collision
        let hitWall = false;
        for (const w of MAP_DATA.walls) {
          if (proj.x >= w.x && proj.x <= w.x + w.w && proj.y >= w.y && proj.y <= w.y + w.h) {
            hitWall = true; break;
          }
        }

        // Map boundary
        if (proj.x < 0 || proj.x > MAP_DATA.width || proj.y < 0 || proj.y > MAP_DATA.height) hitWall = true;

        // ── PARANOIA: travels through walls, blinds on touch ──
        if (proj.type === 'paranoia') {
          proj.travelLeft -= Math.hypot(stepX, stepY);
          if (hitWall || proj.travelLeft <= 0) { proj.alive = false; return false; }

          // Check all enemies for contact (within 120px of beam path)
          for (const [, other] of this.players) {
            if (!other.isAlive || other.id === proj.ownerId) continue;
            if (other.team === proj.ownerTeam) continue; // only hits enemies
            const d = dist(other.x, other.y, proj.x, proj.y);
            if (d < 120 && other.blindTimer < proj.duration) {
              other.blindTimer = proj.duration;
              other.paranoiaBlind = true; // special dark-void flag
              if (!other.isBot) {
                io.to(other.id).emit('screen_flash', { duration: proj.duration, type: 'paranoia' });
              }
            }
          }
          // Broadcast position each tick
          io.to(this.code).emit('projectile_move', { id: proj.id, x: proj.x, y: proj.y, type: 'paranoia' });
          return true;
        }

        // ── SHOCK BOLT: crackling electric lightning arrow travels to surface then bursts ──
        if (proj.type === 'shock') {
          const dToTarget = dist(proj.x, proj.y, proj.targetX, proj.targetY);
          if (hitWall || dToTarget <= Math.hypot(stepX, stepY) * 1.6) {
            proj.alive = false;
            const burstX = hitWall ? proj.x : proj.targetX;
            const burstY = hitWall ? proj.y : proj.targetY;
            // AoE electric shock burst damage
            for (const [, other] of this.players) {
              if (!other.isAlive) continue;
              const d = dist(other.x, other.y, burstX, burstY);
              if (d <= proj.radius) {
                this.damagePlayer(other, proj.damage * (1 - d / proj.radius * 0.4), proj.ownerId, 'Shock Bolt', false);
              }
            }
            io.to(this.code).emit('ability_detonated', {
              type: 'shock_burst', x: burstX, y: burstY, radius: proj.radius, id: proj.id
            });
            return false;
          }
          return true;
        }

        // ── RECON BOLT: travels forward with lightning, lands on surface, starts 2 navy sonar pulses ──
        if (proj.type === 'recon') {
          const dToTarget = dist(proj.x, proj.y, proj.targetX, proj.targetY);
          if (hitWall || dToTarget <= Math.hypot(stepX, stepY) * 1.6) {
            proj.alive = false;
            const landX = hitWall ? proj.x : proj.targetX;
            const landY = hitWall ? proj.y : proj.targetY;
            // Embed recon bolt into surface
            const bolt = {
              id: proj.id,
              x: landX,
              y: landY,
              radius: proj.radius || 520,
              ownerId: proj.ownerId,
              ownerTeam: proj.ownerTeam,
              pulsesLeft: 2, // Exactly 2 pulses!
              pulseInterval: 1.0, // Exactly 1-second delay between 1st and 2nd pulse!
              nextPulse: 0.05, // 1st pulse fires immediately upon landing!
              revealDuration: 3.5,
              health: 1,
              alive: true
            };
            this.activeReconBolts.push(bolt);
            io.to(this.code).emit('ability_detonated', {
              type: 'recon_landed', id: bolt.id, x: bolt.x, y: bolt.y, radius: bolt.radius, ownerTeam: bolt.ownerTeam
            });
            return false;
          }
          return true;
        }

        if (hitWall) { proj.alive = false; return false; }
        return true;
      });
    }

    // 2c. Recon Bolt Pulses (Navy Sonar Wave: exactly 2 pulses with 1s delay)
    this.activeReconBolts = this.activeReconBolts.filter(bolt => {
      if (!bolt.alive) return false;

      bolt.nextPulse -= dt;
      if (bolt.nextPulse <= 0 && bolt.pulsesLeft > 0) {
        const pulseNum = 3 - bolt.pulsesLeft; // Pulse 1 then Pulse 2
        bolt.pulsesLeft--;
        // 1-second delay before Pulse 2; after Pulse 2, stop pulsing
        bolt.nextPulse = (bolt.pulsesLeft > 0) ? (bolt.pulseInterval || 1.0) : 999999;

        // Reveal enemies near bolt with line-of-sight
        const revealedEnemies = [];
        for (const [, other] of this.players) {
          if (!other.isAlive) continue;
          if (other.team === bolt.ownerTeam) continue;
          const d = dist(other.x, other.y, bolt.x, bolt.y);
          if (d <= bolt.radius) {
            // Must have line of sight from bolt to enemy
            let los = true;
            for (const w of MAP_DATA.walls) {
              if (lineIntersectsWall({ x: bolt.x, y: bolt.y }, { x: other.x, y: other.y }, w)) {
                los = false; break;
              }
            }
            if (los) {
              revealedEnemies.push({ id: other.id, x: other.x, y: other.y });
              // Mark enemy as revealed for revealDuration seconds
              other.reconRevealed = now + ((bolt.revealDuration || 3.5) * 1000);
              other.revealedByTeam = bolt.ownerTeam;
            }
          }
        }

        // Emit navy sonar pulse wave to all clients so the expanding sonar wave visual & ping audio trigger
        io.to(this.code).emit('recon_pulse', {
          boltId: bolt.id,
          boltX: bolt.x,
          boltY: bolt.y,
          radius: bolt.radius,
          pulseNumber: pulseNum,
          totalPulses: 2,
          ownerTeam: bolt.ownerTeam,
          revealed: revealedEnemies
        });

        // Also emit highlight event to everyone to show the glow on enemies
        io.to(this.code).emit('recon_revealed', {
          revealed: revealedEnemies, duration: bolt.revealDuration || 3.5, boltId: bolt.id, ownerTeam: bolt.ownerTeam
        });
      }

      return bolt.alive;
    });

    const wallsWithBarriers = (this.state === 'buyPhase')
      ? [...MAP_DATA.walls, ...MAP_DATA.barriers]
      : MAP_DATA.walls;

    for (const [, p] of this.players) {
      if (!p.isAlive) continue;

      // Status effects (Blindness, Reloading)
      if (p.blindTimer > 0) {
        p.blindTimer = Math.max(0, p.blindTimer - dt);
        if (p.blindTimer <= 0) p.paranoiaBlind = false;
      }

      if (p.reloading) {
        p.reloadTimer -= dt;
        if (p.reloadTimer <= 0) {
          p.reloading = false;
          const w = p.weapons[p.currentSlot];
          if (w) {
            const needed = w.magSize - w.curAmmo;
            const toLoad = Math.min(needed, w.reserveAmmo);
            w.curAmmo += toLoad;
            w.reserveAmmo -= toLoad;
          }
        }
      }

      // Bot tactical movement and behavior
      if (p.isBot) {
        this.updateBotAI(p, dt);
      }

      // Movement calculation
      let speed = CONSTANTS.BASE_SPEED;
      if (p.input.shift) speed = CONSTANTS.SHIFT_SPEED;
      if (p.input.crouch) speed = CONSTANTS.CROUCH_SPEED;

      let moveX = 0;
      let moveY = 0;
      if (p.input.up) moveY -= 1;
      if (p.input.down) moveY += 1;
      if (p.input.left) moveX -= 1;
      if (p.input.right) moveX += 1;

      if (moveX !== 0 && moveY !== 0) {
        const len = Math.SQRT2;
        moveX /= len;
        moveY /= len;
      }

      p.vx = moveX * speed;
      p.vy = moveY * speed;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      p.angle = p.input.angle;

      // Collision with map walls & barriers
      resolvePlayerWallCollision(p, wallsWithBarriers);

      // Strictly confine players to their spawn area during Buy Phase!
      if (this.state === 'buyPhase' && MAP_DATA.spawnBounds) {
        const bounds = p.team === 'attackers' ? MAP_DATA.spawnBounds.attackers : MAP_DATA.spawnBounds.defenders;
        if (bounds) {
          p.x = Math.max(bounds.minX, Math.min(bounds.maxX, p.x));
          p.y = Math.max(bounds.minY, Math.min(bounds.maxY, p.y));
        }
      }

      // Dropped Spike pickup
      if (this.droppedSpike && p.team === 'attackers' && !this.spike.carrierId) {
        if (dist(p.x, p.y, this.droppedSpike.x, this.droppedSpike.y) < CONSTANTS.PLAYER_RADIUS + 25) {
          this.spike.carrierId = p.id;
          this.droppedSpike = null;
          io.to(this.code).emit('spike_picked_up', { playerId: p.id, playerName: p.name });
        }
      }
    }

    // 4. Update Spike Plant & Defuse Interactions
    this.updateSpikeInteraction(dt);
  }

  updateSpikeInteraction(dt) {
    if (this.state !== 'inRound') return;

    // Planting logic
    if (!this.spike.planted && this.spike.planterId) {
      const planter = this.players.get(this.spike.planterId);
      if (planter && planter.isAlive && this.spike.carrierId === planter.id) {
        // Check if inside site
        const inSite = MAP_DATA.plantSites.find(site =>
          planter.x >= site.x && planter.x <= site.x + site.w &&
          planter.y >= site.y && planter.y <= site.y + site.h
        );

        if (inSite) {
          this.spike.plantProgress += dt;
          if (this.spike.plantProgress >= CONSTANTS.SPIKE_PLANT_TIME) {
            // Spike Planted!
            this.spike.planted = true;
            this.spike.carrierId = null;
            this.spike.x = planter.x;
            this.spike.y = planter.y;
            this.spike.site = inSite.name;
            this.spike.detonateTimer = CONSTANTS.SPIKE_DETONATE_TIME;
            this.spike.plantProgress = 0;
            this.spike.planterId = null;

            // Automatically equip gun so planter can shoot enemies coming to defuse!
            if (planter.weapons.primary) {
              planter.currentSlot = 'primary';
            } else if (planter.weapons.secondary) {
              planter.currentSlot = 'secondary';
            } else {
              planter.currentSlot = 'melee';
            }

            if (io) {
              io.to(this.code).emit('spike_planted', {
                site: inSite.name,
                x: this.spike.x,
                y: this.spike.y,
                planterName: planter.name,
                planterId: planter.id,
                newSlot: planter.currentSlot
              });
            }
          }
        } else {
          this.spike.plantProgress = 0;
          this.spike.planterId = null;
        }
      } else {
        this.spike.plantProgress = 0;
        this.spike.planterId = null;
      }
    }

    // Defusing logic
    if (this.spike.planted && this.spike.defuserId) {
      const defuser = this.players.get(this.spike.defuserId);
      if (defuser && defuser.isAlive && defuser.team === 'defenders') {
        const d = dist(defuser.x, defuser.y, this.spike.x, this.spike.y);
        if (d < 90) {
          this.spike.defuseProgress += dt;
          if (this.spike.defuseProgress >= CONSTANTS.SPIKE_DEFUSE_TIME) {
            this.spike.defuseProgress = CONSTANTS.SPIKE_DEFUSE_TIME;
            this.checkRoundWinConditions();
          }
        } else {
          // Reset only to half checkpoint (3.5s) if reached!
          if (this.spike.defuseProgress >= CONSTANTS.SPIKE_DEFUSE_TIME / 2) {
            this.spike.defuseProgress = CONSTANTS.SPIKE_DEFUSE_TIME / 2;
          } else {
            this.spike.defuseProgress = 0;
          }
          this.spike.defuserId = null;
        }
      } else {
        if (this.spike.defuseProgress >= CONSTANTS.SPIKE_DEFUSE_TIME / 2) {
          this.spike.defuseProgress = CONSTANTS.SPIKE_DEFUSE_TIME / 2;
        } else {
          this.spike.defuseProgress = 0;
        }
        this.spike.defuserId = null;
      }
    }
  }

  // Elite Tactical Bot AI Logic (A* Navigation, FSM Behavior Tree, Predictive Aim, Smart Utilities)
  updateBotAI(bot, dt) {
    if (this.state === 'buyPhase') {
      bot.input.up = false;
      bot.input.down = false;
      bot.input.left = false;
      bot.input.right = false;
      return;
    }

    const ai = this.botAIs.get(bot.id);
    if (!ai) {
      // Re-create AI if missing (shouldn't happen normally)
      const newAI = new EliteTacticalAI(bot);
      this.botAIs.set(bot.id, newAI);
      newAI.update(this, dt);
      return;
    }
    ai.update(this, dt);
  }

  // Weapon Firing & Hit Detection
  fireWeapon(player, slot, aimAngle) {
    if (!player.isAlive || this.state === 'buyPhase' || player.reloading) return false;

    const weapon = player.weapons[slot] || player.weapons[player.currentSlot];
    if (!weapon) return false;

    // Melee attack
    if (weapon.slot === 'melee') {
      return this.executeKnifeAttack(player, aimAngle);
    }

    // Check ammo
    if (weapon.curAmmo <= 0) {
      this.reloadWeapon(player);
      return false;
    }

    const now = Date.now();
    const minFireDelay = 1000 / weapon.fireRate;
    if (now - player.lastFireTime < minFireDelay) return false;

    player.lastFireTime = now;
    weapon.curAmmo--;

    // Spread calculation: higher if moving, lower if crouched
    const isMoving = Math.hypot(player.vx, player.vy) > 20;
    let spreadAngle = weapon.spread;
    if (isMoving) spreadAngle += weapon.moveSpreadPenalty;
    if (player.input.crouch) spreadAngle *= 0.65;

    const shotAngle = aimAngle + (Math.random() - 0.5) * spreadAngle * 2;
    const maxRange = weapon.range;

    const rayStart = {
      x: player.x + Math.cos(shotAngle) * (CONSTANTS.PLAYER_RADIUS + 5),
      y: player.y + Math.sin(shotAngle) * (CONSTANTS.PLAYER_RADIUS + 5)
    };
    const rayEnd = {
      x: rayStart.x + Math.cos(shotAngle) * maxRange,
      y: rayStart.y + Math.sin(shotAngle) * maxRange
    };

    // 1. Raycast vs Map Walls
    let closestWallHit = null;
    let minDistance = maxRange;

    for (const w of MAP_DATA.walls) {
      const hit = lineIntersectsWall(rayStart, rayEnd, w);
      if (hit) {
        const d = dist(rayStart.x, rayStart.y, hit.x, hit.y);
        if (d < minDistance) {
          minDistance = d;
          closestWallHit = hit;
        }
      }
    }

    let actualEnd = closestWallHit ? { x: closestWallHit.x, y: closestWallHit.y } : rayEnd;

    // 1b. Check Hit against Active Recon Bolts along Ray (destroyed by 1 bullet!)
    if (this.activeReconBolts && this.activeReconBolts.length > 0) {
      for (const bolt of this.activeReconBolts) {
        if (!bolt.alive) continue;
        // Don't shoot own team's recon bolt
        if (bolt.ownerTeam === player.team) continue;
        const distToBolt = distToSegment(bolt, rayStart, actualEnd);
        if (distToBolt <= 24) {
          bolt.alive = false;
          if (io) {
            io.to(this.code).emit('recon_bolt_destroyed', { boltId: bolt.id, x: bolt.x, y: bolt.y });
          }
        }
      }
    }

    // 2. Check Hit against Enemy Players along Ray
    let hitPlayer = null;
    let isHeadshot = false;
    let closestEnemyDist = minDistance;

    for (const [, target] of this.players) {
      if (target.id === player.id || target.team === player.team || !target.isAlive) continue;

      // Circle-to-segment distance check
      const d = distToSegment(target, rayStart, actualEnd);
      if (d <= CONSTANTS.PLAYER_RADIUS + 4) {
        const distFromShooter = dist(player.x, player.y, target.x, target.y);
        if (distFromShooter < closestEnemyDist) {
          closestEnemyDist = distFromShooter;
          hitPlayer = target;

          // Headshot calculation: closer to target's facing direction or top half of hitbox
          const targetFacingDx = Math.cos(target.angle);
          const targetFacingDy = Math.sin(target.angle);
          const bulletDx = Math.cos(shotAngle);
          const bulletDy = Math.sin(shotAngle);
          // High precision center-body ray hit gives headshot
          isHeadshot = d < (CONSTANTS.PLAYER_RADIUS * 0.45);
        }
      }
    }

    if (hitPlayer) {
      const damage = isHeadshot ? weapon.damage.head : weapon.damage.body;
      const killed = this.damagePlayer(hitPlayer, damage, player.id, weapon.name, isHeadshot);
      actualEnd = {
        x: hitPlayer.x,
        y: hitPlayer.y
      };
    }

    // Broadcast tracer event
    const tracer = {
      from: { x: rayStart.x, y: rayStart.y },
      to: { x: actualEnd.x, y: actualEnd.y },
      weapon: weapon.name,
      shooterId: player.id,
      headshot: isHeadshot,
      hit: !!hitPlayer
    };
    
    io.to(this.code).emit('bullet_fired', tracer);
    return true;
  }

  executeKnifeAttack(player, aimAngle) {
    const range = CONSTANTS.WEAPONS.knife.range;
    for (const [, target] of this.players) {
      if (target.id === player.id || target.team === player.team || !target.isAlive) continue;
      const d = dist(player.x, player.y, target.x, target.y);
      if (d <= range + CONSTANTS.PLAYER_RADIUS) {
        // Check angle
        const angleToTarget = Math.atan2(target.y - player.y, target.x - player.x);
        const angleDiff = Math.abs(normalizeAngle(angleToTarget - aimAngle));
        if (angleDiff < Math.PI / 3) {
          // Backstab check
          const targetFacingDiff = Math.abs(normalizeAngle(aimAngle - target.angle));
          const isBackstab = targetFacingDiff < Math.PI / 4;
          const dmg = isBackstab ? 100 : CONSTANTS.WEAPONS.knife.damage.body;
          this.damagePlayer(target, dmg, player.id, 'Knife', isBackstab);
          io.to(this.code).emit('knife_slashed', { shooterId: player.id, targetId: target.id });
          return true;
        }
      }
    }
    io.to(this.code).emit('knife_slashed', { shooterId: player.id, targetId: null });
    return true;
  }

  damagePlayer(target, damage, attackerId, weaponName, isHeadshot = false) {
    if (!target.isAlive) return false;

    // Apply to armor first
    if (target.armor > 0) {
      const armorAbsorb = Math.min(target.armor, Math.floor(damage * 0.66));
      const remainingDmg = damage - armorAbsorb;
      target.armor -= armorAbsorb;
      target.health -= remainingDmg;
    } else {
      target.health -= damage;
    }

    // Check Death
    if (target.health <= 0) {
      target.health = 0;
      target.isAlive = false;
      target.stats.deaths++;

      const attacker = this.players.get(attackerId);
      if (attacker) {
        attacker.stats.kills++;
        attacker.stats.score += isHeadshot ? 150 : 100;
        attacker.credits = Math.min(CONSTANTS.MAX_CREDITS, attacker.credits + CONSTANTS.KILL_CREDITS);
      }

      // If target carried Spike, drop it
      if (this.spike.carrierId === target.id) {
        this.droppedSpike = { x: target.x, y: target.y };
        this.spike.carrierId = null;
        io.to(this.code).emit('spike_dropped', { x: target.x, y: target.y });
      }

      // Add to kill feed
      const killInfo = {
        killerName: attacker ? attacker.name : 'Tactical Hazards',
        killerTeam: attacker ? attacker.team : 'neutral',
        victimName: target.name,
        victimTeam: target.team,
        weapon: weaponName,
        headshot: isHeadshot
      };

      this.killFeed.unshift(killInfo);
      if (this.killFeed.length > 5) this.killFeed.pop();

      io.to(this.code).emit('player_killed', killInfo);

      // If killed player was actively defusing → cancel defuse immediately
      if (this.spike.planted && this.spike.defuserId === target.id) {
        this.spike.defuserId = null;
        this.spike.defuseProgress = 0;
        io.to(this.code).emit('defuse_interrupted', { reason: 'Defuser eliminated! Spike still active.' });
      }

      this.checkRoundWinConditions();
      return true;
    }

    return false;
  }

  reloadWeapon(player) {
    if (player.reloading) return;
    const w = player.weapons[player.currentSlot];
    if (!w || w.slot === 'melee' || w.curAmmo === w.magSize || w.reserveAmmo <= 0) return;

    player.reloading = true;
    player.reloadTimer = w.reloadTime;
    io.to(this.code).emit('weapon_reloading', { playerId: player.id, reloadTime: w.reloadTime });
  }

  useAbility(player, abilityKey, mouseX, mouseY) {
    if (!player.isAlive || this.state === 'buyPhase') return;

    const agentDef = CONSTANTS.AGENTS[player.agent];
    if (!agentDef) return;

    const abilityDef = agentDef.abilities[abilityKey];
    if (!abilityDef) return;

    if (player.abilityCharges[abilityKey] <= 0) return;
    player.abilityCharges[abilityKey]--;

    const now = Date.now();

    // ─────────────────────────────────────────────────────────────
    // 1. SMOKE  (Omen Dark Cover / Jett Cloudburst)
    // ─────────────────────────────────────────────────────────────
    if (abilityDef.type === 'smoke') {
      const smoke = {
        id: `smoke_${now}_${Math.random()}`,
        x: mouseX,
        y: mouseY,
        radius: abilityDef.radius,
        color: agentDef.color,
        expiresAt: now + (abilityDef.duration * 1000)
      };
      this.activeSmokes.push(smoke);
      io.to(this.code).emit('ability_used', {
        type: 'smoke',
        smoke: smoke,
        playerName: player.name,
        agent: player.agent
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. FLASH  (Phoenix Curveball) — only blinds if FACING flash
    // ─────────────────────────────────────────────────────────────
    else if (abilityDef.type === 'flash') {
      setTimeout(() => {
        const flashX = mouseX;
        const flashY = mouseY;

        for (const [, other] of this.players) {
          if (!other.isAlive) continue;
          const d = dist(other.x, other.y, flashX, flashY);
          if (d > 900) continue;

          // Wall occlusion check
          let blocked = false;
          for (const w of MAP_DATA.walls) {
            if (lineIntersectsWall({ x: other.x, y: other.y }, { x: flashX, y: flashY }, w)) {
              blocked = true; break;
            }
          }
          if (blocked) continue;

          // *** DIRECTION CHECK: player must be FACING the flash ***
          const angleToFlash = Math.atan2(flashY - other.y, flashX - other.x);
          const angleDiff = Math.abs(normalizeAngle(other.angle - angleToFlash));
          // Only blind if within 90° forward cone (PI/2 on each side = PI total)
          if (angleDiff > Math.PI / 2) continue;

          // Full blind if looking straight at it, reduced toward edge of cone
          const blindFactor = 1.0 - (angleDiff / (Math.PI / 2)) * 0.45;
          other.blindTimer = Math.max(other.blindTimer, abilityDef.duration * blindFactor);
          if (!other.isBot) {
            io.to(other.id).emit('screen_flash', { duration: abilityDef.duration * blindFactor, type: 'white' });
          }
        }

        io.to(this.code).emit('ability_detonated', { type: 'flash', x: flashX, y: flashY });
      }, (abilityDef.detonationDelay || 0.5) * 1000);
    }

    // ─────────────────────────────────────────────────────────────
    // 3. OMEN PARANOIA — dark void vision (travels through walls)
    // ─────────────────────────────────────────────────────────────
    else if (abilityDef.type === 'projectile_blind') {
      const projId = `paranoia_${now}`;
      const dirAngle = Math.atan2(mouseY - player.y, mouseX - player.x);
      const proj = {
        id: projId,
        x: player.x, y: player.y,
        vx: Math.cos(dirAngle) * abilityDef.speed,
        vy: Math.sin(dirAngle) * abilityDef.speed,
        ownerId: player.id,
        ownerTeam: player.team,
        duration: abilityDef.duration,
        travelLeft: abilityDef.range,
        speed: abilityDef.speed,
        type: 'paranoia'
      };
      if (!this.activeProjectiles) this.activeProjectiles = [];
      this.activeProjectiles.push(proj);
      io.to(this.code).emit('ability_used', {
        type: 'paranoia_start',
        proj: { id: proj.id, x: proj.x, y: proj.y, vx: proj.vx, vy: proj.vy },
        playerName: player.name
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. MOLOTOV  (Phoenix Hot Hands / area damage)
    // ─────────────────────────────────────────────────────────────
    else if (abilityDef.type === 'molotov') {
      const molotov = {
        id: `molo_${now}`,
        x: mouseX,
        y: mouseY,
        radius: abilityDef.radius,
        dps: abilityDef.dps,
        ownerId: player.id,
        expiresAt: now + (abilityDef.duration * 1000)
      };
      this.activeMolotovs.push(molotov);
      io.to(this.code).emit('ability_used', {
        type: 'molotov', molotov: molotov, playerName: player.name
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5. DASH  (Jett Tailwind)
    // ─────────────────────────────────────────────────────────────
    else if (abilityDef.type === 'dash') {
      const hasMoveInput = (player.input.up || player.input.down || player.input.left || player.input.right);
      const moveAngle = (hasMoveInput && (player.vx !== 0 || player.vy !== 0))
        ? Math.atan2(player.vy, player.vx)
        : player.angle;

      const totalDashDist = 220;
      const stepDist = 4; // 4px micro-steps for continuous collision check
      const steps = Math.floor(totalDashDist / stepDist);
      const cosA = Math.cos(moveAngle);
      const sinA = Math.sin(moveAngle);
      const r = CONSTANTS.PLAYER_RADIUS;

      const activeWalls = (this.state === 'buyPhase')
        ? [...MAP_DATA.walls, ...(MAP_DATA.barriers || [])]
        : MAP_DATA.walls;

      for (let s = 0; s < steps; s++) {
        const nextX = player.x + cosA * stepDist;
        const nextY = player.y + sinA * stepDist;

        // Check if next step collides with any wall or barrier
        let hitWall = false;
        for (const w of activeWalls) {
          const closestX = Math.max(w.x, Math.min(nextX, w.x + w.w));
          const closestY = Math.max(w.y, Math.min(nextY, w.y + w.h));
          const dx = nextX - closestX;
          const dy = nextY - closestY;
          if (dx * dx + dy * dy < r * r) {
            hitWall = true;
            break;
          }
        }

        if (hitWall) {
          // Dash hits the wall and stops immediately at the surface!
          resolvePlayerWallCollision(player, activeWalls);
          break;
        }

        player.x = nextX;
        player.y = nextY;
      }

      resolvePlayerWallCollision(player, activeWalls);

      io.to(this.code).emit('ability_used', {
        type: 'dash', playerId: player.id, x: player.x, y: player.y
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 6. SOVA RECON BOLT — crackling lightning arrow sticks to surface, pulses 2 times
    // ─────────────────────────────────────────────────────────────
    else if (abilityDef.type === 'recon') {
      const dirAngle = Math.atan2(mouseY - player.y, mouseX - player.x);
      const maxRange = 1800;
      const rayStart = { x: player.x, y: player.y };
      const rayEnd = { x: player.x + Math.cos(dirAngle) * maxRange, y: player.y + Math.sin(dirAngle) * maxRange };

      // Find exact surface/wall hit or target location
      let targetX = mouseX, targetY = mouseY;
      let minD = dist(player.x, player.y, mouseX, mouseY);
      for (const w of MAP_DATA.walls) {
        const hit = lineIntersectsWall(rayStart, rayEnd, w);
        if (hit) {
          const d = dist(rayStart.x, rayStart.y, hit.x, hit.y);
          if (d < minD) {
            minD = d;
            targetX = hit.x;
            targetY = hit.y;
          }
        }
      }
      targetX = Math.max(60, Math.min(MAP_DATA.width - 60, targetX));
      targetY = Math.max(60, Math.min(MAP_DATA.height - 60, targetY));

      const boltId = `recon_${now}`;
      const speed = 1200;
      const reconProj = {
        id: boltId,
        type: 'recon',
        x: player.x,
        y: player.y,
        targetX: targetX,
        targetY: targetY,
        vx: Math.cos(dirAngle) * speed,
        vy: Math.sin(dirAngle) * speed,
        ownerId: player.id,
        ownerTeam: player.team,
        radius: abilityDef.radius || 520,
        alive: true
      };
      if (!this.activeProjectiles) this.activeProjectiles = [];
      this.activeProjectiles.push(reconProj);

      io.to(this.code).emit('ability_used', {
        type: 'arrow_fired',
        arrowType: 'recon',
        id: boltId,
        startX: player.x,
        startY: player.y,
        targetX: targetX,
        targetY: targetY,
        angle: dirAngle,
        speed: speed,
        playerName: player.name
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 7. SOVA SHOCK BOLT — crackling lightning arrow, AoE electric burst
    // ─────────────────────────────────────────────────────────────
    else if (abilityDef.type === 'shock') {
      const dirAngle = Math.atan2(mouseY - player.y, mouseX - player.x);
      const maxRange = 1800;
      const rayStart = { x: player.x, y: player.y };
      const rayEnd = { x: player.x + Math.cos(dirAngle) * maxRange, y: player.y + Math.sin(dirAngle) * maxRange };

      let targetX = mouseX, targetY = mouseY;
      let minD = dist(player.x, player.y, mouseX, mouseY);
      for (const w of MAP_DATA.walls) {
        const hit = lineIntersectsWall(rayStart, rayEnd, w);
        if (hit) {
          const d = dist(rayStart.x, rayStart.y, hit.x, hit.y);
          if (d < minD) {
            minD = d;
            targetX = hit.x;
            targetY = hit.y;
          }
        }
      }
      targetX = Math.max(60, Math.min(MAP_DATA.width - 60, targetX));
      targetY = Math.max(60, Math.min(MAP_DATA.height - 60, targetY));

      const shockId = `shock_${now}`;
      const speed = 1200;
      const shockProj = {
        id: shockId,
        type: 'shock',
        x: player.x,
        y: player.y,
        targetX: targetX,
        targetY: targetY,
        vx: Math.cos(dirAngle) * speed,
        vy: Math.sin(dirAngle) * speed,
        ownerId: player.id,
        ownerTeam: player.team,
        damage: abilityDef.damage || 75,
        radius: abilityDef.radius || 110,
        alive: true
      };
      if (!this.activeProjectiles) this.activeProjectiles = [];
      this.activeProjectiles.push(shockProj);

      io.to(this.code).emit('ability_used', {
        type: 'arrow_fired',
        arrowType: 'shock',
        id: shockId,
        startX: player.x,
        startY: player.y,
        targetX: targetX,
        targetY: targetY,
        angle: dirAngle,
        speed: speed,
        playerName: player.name
      });
    }
  }

  // Pack Room State for Client Broadcast
  serialize() {
    const playersArr = [];
    for (const [, p] of this.players) {
      playersArr.push({
        id: p.id,
        name: p.name,
        team: p.team,
        agent: p.agent,
        isHost: p.isHost,
        isBot: p.isBot,
        x: Math.round(p.x),
        y: Math.round(p.y),
        vx: p.vx !== undefined ? Number(p.vx.toFixed(1)) : 0,
        vy: p.vy !== undefined ? Number(p.vy.toFixed(1)) : 0,
        angle: Number(p.angle.toFixed(3)),
        health: Math.round(p.health),
        armor: Math.round(p.armor),
        isAlive: p.isAlive,
        credits: p.credits,
        blindTimer: Number(p.blindTimer.toFixed(2)),
        paranoiaBlind: !!p.paranoiaBlind,
        reconRevealed: (p.reconRevealed && p.reconRevealed > Date.now()) ? true : false,
        revealedByTeam: p.revealedByTeam || null,
        reloading: p.reloading,
        currentSlot: p.currentSlot,
        weapons: p.weapons,
        abilityCharges: p.abilityCharges,
        stats: p.stats,
        penaltyUntil: p.penaltyUntil || 0,
        lastProcessedInput: p.lastProcessedInput || 0
      });
    }

    return {
      code: this.code,
      roomCode: this.code,
      state: this.state,
      roundNumber: this.roundNumber,
      score: this.score,
      roundTimer: Math.max(0, Math.ceil(this.roundTimer)),
      spike: {
        carrierId: this.spike.carrierId,
        planted: this.spike.planted,
        defused: !!this.spike.defused,
        x: this.spike.x,
        y: this.spike.y,
        site: this.spike.site,
        planterId: this.spike.planterId,
        defuserId: this.spike.defuserId,
        plantProgress: Number(this.spike.plantProgress.toFixed(2)),
        defuseProgress: Number(this.spike.defuseProgress.toFixed(2)),
        detonateTimer: Math.max(0, Math.ceil(this.spike.detonateTimer))
      },
      droppedSpike: this.droppedSpike,
      activeSmokes: this.activeSmokes,
      activeMolotovs: this.activeMolotovs,
      activeReconBolts: (this.activeReconBolts || []).filter(b => b.alive).map(b => ({ id: b.id, x: b.x, y: b.y, radius: b.radius, ownerTeam: b.ownerTeam })),
      killFeed: this.killFeed,
      players: playersArr
    };
  }
}

// Math Utility Helpers
function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function distToSegment(p, a, b) {
  const l2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
  if (l2 === 0) return dist(p.x, p.y, a.x, a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p.x, p.y, a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));
}


// Delta Compression Helper
function computeStateDelta(prev, curr, seq) {
  if (!prev) {
    return { type: 'full', seq, state: curr };
  }

  // Delta player states (safe numerical precision)
  const playerDeltas = [];
  for (const p of curr.players) {
    playerDeltas.push({
      ...p,
      x: Number((p.x || 0).toFixed(1)),
      y: Number((p.y || 0).toFixed(1)),
      vx: Number((p.vx || 0).toFixed(1)),
      vy: Number((p.vy || 0).toFixed(1)),
      angle: Number((p.angle || 0).toFixed(3)),
      health: p.health,
      armor: p.armor,
      isAlive: p.isAlive,
      currentSlot: p.currentSlot,
      lastProcessedInput: p.lastProcessedInput || 0
    });
  }

  return {
    type: 'delta',
    seq,
    state: {
      code: curr.code,
      roomCode: curr.code,
      state: curr.state,
      roundNumber: curr.roundNumber,
      score: curr.score,
      roundTimer: curr.roundTimer,
      spike: curr.spike,
      activeSmokes: curr.activeSmokes,
      activeMolotovs: curr.activeMolotovs,
      activeReconBolts: curr.activeReconBolts,
      killFeed: curr.killFeed,
      players: playerDeltas
    }
  };
}

GameRoom.prototype.serializeOptimized = function(forceFull = false) {
  const current = this.serialize();
  const seq = ++this.stateSequence;
  
  // Send full state every 64 ticks (~1 second) or when forced
  if (forceFull || seq % 64 === 1 || !this.lastSerializedState) {
    this.lastSerializedState = current;
    return { type: 'full', seq, state: current };
  }

  const delta = computeStateDelta(this.lastSerializedState, current, seq);
  this.lastSerializedState = current;
  return delta;
};

module.exports = {
  GameRoom,
  rooms,
  playerPenalties,
  getPlayerPenalty,
  generateRoomCode,
  setRoomsIO,
  dist,
  normalizeAngle,
  distToSegment,
  lineIntersectsWall,
  getLineSegmentIntersection,
  resolvePlayerWallCollision
};


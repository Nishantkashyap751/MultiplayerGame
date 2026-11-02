/**
 * Elite Tactical AI Engine for Tactical 2D Multiplayer Shooter
 * Features:
 * 1. A* Pathfinding Grid with obstacle clearance & path smoothing
 * 2. Behavior Tree / FSM (PATROL, INVESTIGATE, COMBAT, RETREAT, OBJECTIVE)
 * 3. Predictive Lead Targeting & Sub-100ms Reaction Time
 * 4. Smart Tactical Utility Usage (Smokes on Chokepoints, Flashes on Rush)
 */

const CONSTANTS = require('../shared/constants');
const { MAP_DATA } = require('../shared/mapData');

const CELL_SIZE = 50;
const COLS = Math.ceil(MAP_DATA.width / CELL_SIZE);  // 44
const ROWS = Math.ceil(MAP_DATA.height / CELL_SIZE); // 32

// Precompute Walkability Grid
const walkGrid = new Uint8Array(COLS * ROWS); // 1 = walkable, 0 = blocked

function initNavGrid(walls) {
  walkGrid.fill(1);
  const clearance = CONSTANTS.PLAYER_RADIUS + 8; // 26px padding around walls

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cx = c * CELL_SIZE + CELL_SIZE / 2;
      const cy = r * CELL_SIZE + CELL_SIZE / 2;

      // Check against map borders
      if (cx < 60 || cx > MAP_DATA.width - 60 || cy < 60 || cy > MAP_DATA.height - 60) {
        walkGrid[r * COLS + c] = 0;
        continue;
      }

      // Check collision against walls with clearance
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (
          cx + clearance >= w.x &&
          cx - clearance <= w.x + w.w &&
          cy + clearance >= w.y &&
          cy - clearance <= w.y + w.h
        ) {
          walkGrid[r * COLS + c] = 0;
          break;
        }
      }
    }
  }
}

// Initialize grid with static walls
initNavGrid(MAP_DATA.walls);

// Priority Queue for A*
class MinHeap {
  constructor() {
    this.heap = [];
  }
  push(node) {
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }
  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._bubbleDown(0);
    }
    return top;
  }
  size() {
    return this.heap.length;
  }
  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].f < this.heap[parent].f) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[parent];
        this.heap[parent] = tmp;
        i = parent;
      } else break;
    }
  }
  _bubbleDown(i) {
    const len = this.heap.length;
    while (true) {
      let left = (i << 1) + 1;
      let right = left + 1;
      let smallest = i;
      if (left < len && this.heap[left].f < this.heap[smallest].f) smallest = left;
      if (right < len && this.heap[right].f < this.heap[smallest].f) smallest = right;
      if (smallest !== i) {
        const tmp = this.heap[i];
        this.heap[i] = this.heap[smallest];
        this.heap[smallest] = tmp;
        i = smallest;
      } else break;
    }
  }
}

function findAStarPath(startX, startY, targetX, targetY) {
  let sc = Math.max(0, Math.min(COLS - 1, Math.floor(startX / CELL_SIZE)));
  let sr = Math.max(0, Math.min(ROWS - 1, Math.floor(startY / CELL_SIZE)));
  let tc = Math.max(0, Math.min(COLS - 1, Math.floor(targetX / CELL_SIZE)));
  let tr = Math.max(0, Math.min(ROWS - 1, Math.floor(targetY / CELL_SIZE)));

  // If start or target is inside a blocked cell, find closest walkable neighbor
  if (!walkGrid[sr * COLS + sc]) {
    const n = findClosestWalkableCell(sc, sr);
    sc = n.c; sr = n.r;
  }
  if (!walkGrid[tr * COLS + tc]) {
    const n = findClosestWalkableCell(tc, tr);
    tc = n.c; tr = n.r;
  }

  const startIdx = sr * COLS + sc;
  const targetIdx = tr * COLS + tc;
  if (startIdx === targetIdx) {
    return [{ x: targetX, y: targetY }];
  }

  const openSet = new MinHeap();
  const gScore = new Float32Array(COLS * ROWS).fill(1e9);
  const cameFrom = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);

  gScore[startIdx] = 0;
  openSet.push({ idx: startIdx, c: sc, r: sr, f: heuristic(sc, sr, tc, tr) });

  const neighbors = [
    { dc: 0, dr: -1, cost: 1 },
    { dc: 0, dr: 1, cost: 1 },
    { dc: -1, dr: 0, cost: 1 },
    { dc: 1, dr: 0, cost: 1 },
    { dc: -1, dr: -1, cost: 1.414 },
    { dc: 1, dr: -1, cost: 1.414 },
    { dc: -1, dr: 1, cost: 1.414 },
    { dc: 1, dr: 1, cost: 1.414 }
  ];

  let iterations = 0;
  while (openSet.size() > 0 && iterations < 800) {
    iterations++;
    const current = openSet.pop();
    if (current.idx === targetIdx) {
      // Reconstruct Path
      const path = [];
      let curr = targetIdx;
      while (curr !== -1) {
        const c = curr % COLS;
        const r = Math.floor(curr / COLS);
        path.push({ x: c * CELL_SIZE + CELL_SIZE / 2, y: r * CELL_SIZE + CELL_SIZE / 2 });
        curr = cameFrom[curr];
      }
      path.reverse();
      // Replace last node with exact target
      if (path.length > 0) {
        path[path.length - 1] = { x: targetX, y: targetY };
      }
      return smoothPath(path);
    }

    closed[current.idx] = 1;

    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      const nc = current.c + n.dc;
      const nr = current.r + n.dr;

      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const nIdx = nr * COLS + nc;
      if (!walkGrid[nIdx] || closed[nIdx]) continue;

      // Diagonal obstacle cutting check
      if (n.dc !== 0 && n.dr !== 0) {
        if (!walkGrid[current.r * COLS + nc] || !walkGrid[nr * COLS + current.c]) {
          continue; // Prevent cutting through solid corners
        }
      }

      const tentativeG = gScore[current.idx] + n.cost * CELL_SIZE;
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current.idx;
        gScore[nIdx] = tentativeG;
        const f = tentativeG + heuristic(nc, nr, tc, tr) * CELL_SIZE;
        openSet.push({ idx: nIdx, c: nc, r: nr, f });
      }
    }
  }

  // Fallback: direct line to target
  return [{ x: targetX, y: targetY }];
}

function findClosestWalkableCell(c, r) {
  for (let rad = 1; rad < 6; rad++) {
    for (let dc = -rad; dc <= rad; dc++) {
      for (let dr = -rad; dr <= rad; dr++) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS && walkGrid[nr * COLS + nc]) {
          return { c: nc, r: nr };
        }
      }
    }
  }
  return { c, r };
}

function heuristic(c1, r1, c2, r2) {
  const dx = Math.abs(c1 - c2);
  const dy = Math.abs(r1 - r2);
  return dx + dy + (1.414 - 2) * Math.min(dx, dy);
}

// Line of sight raycast against walls
function hasLineOfSight(x1, y1, x2, y2, walls) {
  const p1 = { x: x1, y: y1 };
  const p2 = { x: x2, y: y2 };
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    // Fast bounding box intersection test
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    if (w.x + w.w < minX || w.x > maxX || w.y + w.h < minY || w.y > maxY) continue;

    // Check line segment with 4 box edges
    if (lineIntersectsAABB(p1, p2, w)) return false;
  }
  return true;
}

function lineIntersectsAABB(p1, p2, box) {
  const left = box.x, right = box.x + box.w, top = box.y, bottom = box.y + box.h;
  return (
    lineIntersectsSegment(p1, p2, { x: left, y: top }, { x: right, y: top }) ||
    lineIntersectsSegment(p1, p2, { x: right, y: top }, { x: right, y: bottom }) ||
    lineIntersectsSegment(p1, p2, { x: right, y: bottom }, { x: left, y: bottom }) ||
    lineIntersectsSegment(p1, p2, { x: left, y: bottom }, { x: left, y: top })
  );
}

function lineIntersectsSegment(p1, p2, p3, p4) {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(denom) < 0.0001) return false;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

// String-pulling path smoother
function smoothPath(path) {
  if (path.length <= 2) return path;
  const smoothed = [path[0]];
  let curr = 0;

  while (curr < path.length - 1) {
    let farthest = curr + 1;
    for (let test = path.length - 1; test > curr + 1; test--) {
      if (hasLineOfSight(path[curr].x, path[curr].y, path[test].x, path[test].y, MAP_DATA.walls)) {
        farthest = test;
        break;
      }
    }
    smoothed.push(path[farthest]);
    curr = farthest;
  }
  return smoothed;
}

/**
 * Tactical Behavior Tree & FSM Controller for Bots
 */
class EliteTacticalAI {
  constructor(bot) {
    this.bot = bot;
    this.state = 'PATROL'; // 'PATROL', 'INVESTIGATE', 'COMBAT', 'RETREAT', 'OBJECTIVE'
    this.path = [];
    this.currentWaypointIndex = 0;
    this.pathRepathTimer = 0;

    // Tactical Target & Awareness
    this.targetPlayer = null;
    this.lastKnownEnemyPos = null;
    this.reactionTimer = 0; // sub-100ms reaction delay
    this.strafeTimer = 0;
    this.strafeDirection = 1; // 1 = right, -1 = left
    this.utilityCooldown = 2.0; // initial prep cooldown
    this.shootBurstTimer = 0;
    this.shootDelayTimer = 0;

    // Tactical Waypoints
    this.tacticalWaypoints = [
      { name: 'Site A', x: 1730, y: 500 },
      { name: 'A Heaven', x: 1600, y: 310 },
      { name: 'A Main', x: 1850, y: 950 },
      { name: 'Site B', x: 470, y: 500 },
      { name: 'B Heaven', x: 600, y: 310 },
      { name: 'B Main', x: 330, y: 950 },
      { name: 'Mid Courtyard', x: 1100, y: 680 },
      { name: 'Mid Bottom', x: 1100, y: 1000 }
    ];
  }

  update(room, dt) {
    const bot = this.bot;
    if (!bot.isAlive || room.state === 'buyPhase') {
      bot.input.up = false;
      bot.input.down = false;
      bot.input.left = false;
      bot.input.right = false;
      return;
    }

    this.pathRepathTimer -= dt;
    this.reactionTimer -= dt;
    this.strafeTimer -= dt;
    this.utilityCooldown -= dt;
    this.shootDelayTimer -= dt;
    this.shootBurstTimer -= dt;

    // 1. Sensory Perception (Line of Sight Enemy Detection)
    const visibleEnemy = this.findVisibleEnemy(room);

    // 2. State Machine Transitions
    if (visibleEnemy) {
      if (this.state !== 'COMBAT') {
        this.state = 'COMBAT';
        this.reactionTimer = 0.06 + Math.random() * 0.04; // 60-100ms Elite reaction
      }
      this.targetPlayer = visibleEnemy;
      this.lastKnownEnemyPos = { x: visibleEnemy.x, y: visibleEnemy.y };
    } else if (this.targetPlayer && !this.targetPlayer.isAlive) {
      this.targetPlayer = null;
      this.state = this.lastKnownEnemyPos ? 'INVESTIGATE' : 'PATROL';
    } else if (this.state === 'COMBAT' && !visibleEnemy) {
      this.state = 'INVESTIGATE';
      this.path = [];
    }

    // Health-based Retreat Trigger (<35 HP and actively challenged)
    if (bot.health < 35 && visibleEnemy && Math.hypot(bot.x - visibleEnemy.x, bot.y - visibleEnemy.y) < 320) {
      this.state = 'RETREAT';
    }

    // Objective Override (Defenders defusing or Attackers planting)
    if (room.spike.planted && bot.team === 'defenders') {
      this.state = 'OBJECTIVE';
    } else if (!room.spike.planted && bot.team === 'attackers' && room.spike.carrierId === bot.id) {
      this.state = 'OBJECTIVE';
    }

    // 3. State Execution
    switch (this.state) {
      case 'COMBAT':
        this.executeCombatState(room, visibleEnemy, dt);
        break;
      case 'RETREAT':
        this.executeRetreatState(room, visibleEnemy, dt);
        break;
      case 'INVESTIGATE':
        this.executeInvestigateState(room, dt);
        break;
      case 'OBJECTIVE':
        this.executeObjectiveState(room, dt);
        break;
      case 'PATROL':
      default:
        this.executePatrolState(room, dt);
        break;
    }

    // 4. Follow Path towards current target waypoint
    this.followPath(bot);
  }

  findVisibleEnemy(room) {
    const bot = this.bot;
    let closestEnemy = null;
    let minDist = 1200; // Increased vision range

    for (const [, other] of room.players) {
      if (other.team !== bot.team && other.isAlive) {
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (d < minDist) {
          // Bot only sees where it is facing (cannot see behind backside unless touching)
          const angleToOther = Math.atan2(other.y - bot.y, other.x - bot.x);
          let angleDiff = Math.abs(angleToOther - bot.angle);
          while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - 2 * Math.PI);
          if (d > 35 && angleDiff > (CONSTANTS.FOV_ANGLE / 2)) continue;

          // Multi-ray check: center + offsets for partial cover detection
          const losCenter = hasLineOfSight(bot.x, bot.y, other.x, other.y, MAP_DATA.walls);
          const losTop    = hasLineOfSight(bot.x, bot.y, other.x, other.y - 14, MAP_DATA.walls);
          const losBottom = hasLineOfSight(bot.x, bot.y, other.x, other.y + 14, MAP_DATA.walls);
          if (losCenter || losTop || losBottom) {
            minDist = d;
            closestEnemy = other;
          }
        }
      }
    }
    return closestEnemy;
  }

  // State: COMBAT (Predictive Aim + Counter-Strafing + Utility)
  executeCombatState(room, enemy, dt) {
    const bot = this.bot;
    if (!enemy) return;

    const distToEnemy = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);

    // Predictive Lead Targeting
    // Calculate bullet flight time and predict position
    const bulletSpeed = 5200; // px/sec
    const travelTime = distToEnemy / bulletSpeed;
    const targetVx = enemy.vx || 0;
    const targetVy = enemy.vy || 0;

    const leadX = enemy.x + targetVx * travelTime * 1.25;
    const leadY = enemy.y + targetVy * travelTime * 1.25;

    const aimAngle = Math.atan2(leadY - bot.y, leadX - bot.x);
    bot.angle = aimAngle;
    bot.input.angle = aimAngle;

    // Tactical Utility Usage: Throw flash/smoke before engaging if available
    if (this.utilityCooldown <= 0 && distToEnemy > 280) {
      this.tryUseTacticalUtility(room, enemy);
    }

    // Sub-100ms reaction delay has passed -> Fire!
    if (this.reactionTimer <= 0) {
      if (this.shootDelayTimer <= 0) {
        // Aggressive burst fire — faster rate, tighter spread
        this.shootDelayTimer = 0.08 + Math.random() * 0.08; // 80-160ms (was 120-260ms)
        const spread = (Math.random() - 0.5) * 0.025; // Tighter accuracy
        // Direct LOS check right before firing to maximize hit chance
        const canFire = hasLineOfSight(bot.x, bot.y, enemy.x, enemy.y, MAP_DATA.walls)
          || hasLineOfSight(bot.x, bot.y, enemy.x, enemy.y - 14, MAP_DATA.walls)
          || hasLineOfSight(bot.x, bot.y, enemy.x, enemy.y + 14, MAP_DATA.walls);
        if (canFire) {
          room.fireWeapon(bot, bot.currentSlot, aimAngle + spread);
        }
      }
    }

    // Combat Movement: Counter-strafing (Strafe left-right & crouch control)
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 0.4 + Math.random() * 0.5;
      this.strafeDirection = Math.random() < 0.5 ? 1 : -1;
    }

    // Move perpendicular to aim direction for evasive strafing
    const strafeAngle = aimAngle + (Math.PI / 2) * this.strafeDirection;
    const desiredDist = 280;

    // Aggressive positioning — chase harder, hold closer range
    let moveAngle = strafeAngle;
    if (distToEnemy < 150) {
      moveAngle = aimAngle + Math.PI; // back up to create distance
    } else if (distToEnemy > 420) {
      moveAngle = aimAngle; // close in aggressively
    }

    bot.input.up = Math.sin(moveAngle) < -0.3;
    bot.input.down = Math.sin(moveAngle) > 0.3;
    bot.input.left = Math.cos(moveAngle) < -0.3;
    bot.input.right = Math.cos(moveAngle) > 0.3;
    bot.input.shift = false;
    bot.input.crouch = Math.random() < 0.35; // occasional recoil crouching

    // Clear path since combat movement takes direct control
    this.path = [];
  }

  // State: RETREAT (Flee behind nearest cover)
  executeRetreatState(room, enemy, dt) {
    const bot = this.bot;
    if (!enemy) {
      this.state = 'PATROL';
      return;
    }

    // Move away from enemy towards nearest tactical cover
    if (this.pathRepathTimer <= 0) {
      this.pathRepathTimer = 0.8;
      const awayAngle = Math.atan2(bot.y - enemy.y, bot.x - enemy.x);
      const targetX = Math.max(100, Math.min(MAP_DATA.width - 100, bot.x + Math.cos(awayAngle) * 350));
      const targetY = Math.max(100, Math.min(MAP_DATA.height - 100, bot.y + Math.sin(awayAngle) * 350));
      this.path = findAStarPath(bot.x, bot.y, targetX, targetY);
      this.currentWaypointIndex = 0;
    }
  }

  // State: INVESTIGATE (Pathfind to last known enemy position)
  executeInvestigateState(room, dt) {
    const bot = this.bot;
    if (!this.lastKnownEnemyPos) {
      this.state = 'PATROL';
      return;
    }

    const distToLast = Math.hypot(bot.x - this.lastKnownEnemyPos.x, bot.y - this.lastKnownEnemyPos.y);
    if (distToLast < 60) {
      this.lastKnownEnemyPos = null;
      this.state = 'PATROL';
      return;
    }

    if (this.path.length === 0 || this.pathRepathTimer <= 0) {
      this.pathRepathTimer = 1.5;
      this.path = findAStarPath(bot.x, bot.y, this.lastKnownEnemyPos.x, this.lastKnownEnemyPos.y);
      this.currentWaypointIndex = 0;
    }
  }

  // State: OBJECTIVE (Plant / Defuse Spike)
  executeObjectiveState(room, dt) {
    const bot = this.bot;
    const spike = room.spike;

    // Defender: Defuse Spike
    if (spike.planted && bot.team === 'defenders') {
      const d = Math.hypot(bot.x - spike.x, bot.y - spike.y);
      if (d <= 75) {
        // Stop and Defuse!
        bot.input.up = false;
        bot.input.down = false;
        bot.input.left = false;
        bot.input.right = false;
        bot.input.crouch = true;
        spike.defuserId = bot.id;
        return;
      }

      if (this.path.length === 0 || this.pathRepathTimer <= 0) {
        this.pathRepathTimer = 1.0;
        this.path = findAStarPath(bot.x, bot.y, spike.x, spike.y);
        this.currentWaypointIndex = 0;
      }
    }

    // Attacker: Plant Spike at nearest site
    else if (!spike.planted && bot.team === 'attackers' && spike.carrierId === bot.id) {
      const site = MAP_DATA.plantSites[0]; // Site A or B
      const inSite = bot.x >= site.x && bot.x <= site.x + site.w && bot.y >= site.y && bot.y <= site.y + site.h;
      if (inSite) {
        // Plant Spike!
        bot.input.up = false;
        bot.input.down = false;
        bot.input.left = false;
        bot.input.right = false;
        spike.planterId = bot.id;
        return;
      }

      if (this.path.length === 0 || this.pathRepathTimer <= 0) {
        this.pathRepathTimer = 2.0;
        this.path = findAStarPath(bot.x, bot.y, site.x + site.w / 2, site.y + site.h / 2);
        this.currentWaypointIndex = 0;
      }
    }
  }

  // State: PATROL (Tactical choke point & site rotation)
  executePatrolState(room, dt) {
    const bot = this.bot;
    if (this.path.length === 0 || this.pathRepathTimer <= 0) {
      this.pathRepathTimer = 4.0 + Math.random() * 3.0;

      // Select high-priority tactical site based on team
      let wpPool = this.tacticalWaypoints;
      if (bot.team === 'attackers') {
        wpPool = this.tacticalWaypoints.filter(w => w.name.includes('Site') || w.name.includes('Main'));
      } else {
        wpPool = this.tacticalWaypoints.filter(w => w.name.includes('Site') || w.name.includes('Heaven') || w.name.includes('Mid'));
      }

      const wp = wpPool[Math.floor(Math.random() * wpPool.length)];
      this.path = findAStarPath(bot.x, bot.y, wp.x, wp.y);
      this.currentWaypointIndex = 0;
    }
  }

  followPath(bot) {
    if (!this.path || this.currentWaypointIndex >= this.path.length) {
      return;
    }

    const target = this.path[this.currentWaypointIndex];
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 40) {
      this.currentWaypointIndex++;
      if (this.currentWaypointIndex >= this.path.length) {
        bot.input.up = false;
        bot.input.down = false;
        bot.input.left = false;
        bot.input.right = false;
        return;
      }
    }

    const moveAngle = Math.atan2(dy, dx);
    bot.input.up = dy < -16;
    bot.input.down = dy > 16;
    bot.input.left = dx < -16;
    bot.input.right = dx > 16;
    bot.input.shift = false;

    // Look towards movement direction when patrolling/investigating
    if (this.state !== 'COMBAT') {
      bot.angle = moveAngle;
      bot.input.angle = moveAngle;
    }
  }

  tryUseTacticalUtility(room, enemy) {
    const bot = this.bot;
    const charges1 = bot.abilityCharges.ability1 || 0;
    const charges2 = bot.abilityCharges.ability2 || 0;

    if (charges1 > 0) {
      // Throw smoke/flash towards enemy corridor
      room.useAbility(bot, 'ability1', enemy.x + (Math.random() - 0.5) * 60, enemy.y + (Math.random() - 0.5) * 60);
      this.utilityCooldown = 4.0;
    } else if (charges2 > 0) {
      room.useAbility(bot, 'ability2', enemy.x, enemy.y);
      this.utilityCooldown = 5.0;
    }
  }
}

module.exports = {
  findAStarPath,
  EliteTacticalAI,
  hasLineOfSight,
  initNavGrid
};

/**
 * High-Precision Fixed Timestep 64Hz Game Loop
 * Strictly separates physics/network update ticks from arbitrary timers.
 * Utilizes high-resolution process.hrtime.bigint() for zero-drift 64Hz execution.
 */

const CONSTANTS = require('../shared/constants');
const { rooms } = require('./rooms');

class GameLoop {
  constructor(io) {
    this.io = io;
    this.tickRate = CONSTANTS.TICK_RATE || 64; // 64 Hz
    this.fixedDt = 1 / this.tickRate; // 0.015625 seconds per tick
    this.tickIntervalNs = BigInt(Math.round(1e9 / this.tickRate)); // nanoseconds per tick

    this.isRunning = false;
    this.lastTimeNs = 0n;
    this.accumulatorNs = 0n;
    this.loopTimer = null;
    this.currentTick = 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTimeNs = process.hrtime.bigint();
    this.accumulatorNs = 0n;

    console.log(`[GameEngine] Fixed 64Hz physics and netcode loop initialized (${this.tickRate} ticks/sec).`);

    // High frequency interval loop (~4ms) that consumes fixed 15.625ms steps
    this.loopTimer = setInterval(() => {
      this.tick();
    }, 4);
  }

  tick() {
    if (!this.isRunning) return;

    const nowNs = process.hrtime.bigint();
    let elapsedNs = nowNs - this.lastTimeNs;
    this.lastTimeNs = nowNs;

    // Prevent spiral of death if system hitches (cap at 100ms)
    const maxElapsedNs = BigInt(100000000); // 100ms
    if (elapsedNs > maxElapsedNs) {
      elapsedNs = maxElapsedNs;
    }

    this.accumulatorNs += elapsedNs;

    // Execute physics updates in fixed 64Hz steps
    while (this.accumulatorNs >= this.tickIntervalNs) {
      this.fixedUpdate(this.fixedDt);
      this.accumulatorNs -= this.tickIntervalNs;
      this.currentTick++;
    }
  }

  fixedUpdate(dt) {
    for (const [code, room] of rooms) {
      if (room.players.size === 0) {
        rooms.delete(code);
        continue;
      }

      // Step room physics, AI, abilities, spike, and round logic
      room.update(dt);

      // Delta compressed / full state broadcast via Socket.io
      const statePayload = room.serializeOptimized ? room.serializeOptimized() : { type: 'full', state: room.serialize() };
      this.io.to(code).emit('game_state_update', statePayload);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
    console.log('[GameEngine] Fixed loop stopped.');
  }
}

let instance = null;

function initGameLoop(io) {
  if (!instance) {
    instance = new GameLoop(io);
    instance.start();
  }
  return instance;
}

module.exports = {
  GameLoop,
  initGameLoop
};

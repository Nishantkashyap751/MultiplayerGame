// Tactical Canvas 2D Renderer for Valorant-style 2D Top-Down Shooter

class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    // Mini-map
    this.miniCanvas = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCanvas ? this.miniCanvas.getContext('2d') : null;

    // Camera
    this.camera = {
      x: 1100,
      y: 1400,
      zoom: 1.0,
      targetX: 1100,
      targetY: 1400
    };

    // Visual FX & Particles
    this.particles = [];
    this.tracers = [];
    this.muzzleFlashes = [];
    this.spikeBlasts = [];
    this.screenShake = 0;

    // Ability Visuals
    this.screenBlind = { timer: 0, maxDuration: 0, type: 'white' };
    this.projectiles = new Map(); // id -> { id, x, y, type, life }
    this.flyingArrows = []; // active lightning arrows: { id, type, startX, startY, x, y, targetX, targetY, angle, speed, elapsed, duration, trail }
    this.reconSonarWaves = []; // authentic navy sonar wave pulses (pulsing exactly 2 times with 1s delay)
    this.shockBursts = []; // { x, y, radius, timer, maxTimer }
    this.reconPulses = []; // { x, y, radius, currentRadius, timer, maxTimer }
    this.reconRevealed = new Map(); // playerId -> expiry timestamp
    this.reconBolts = new Map(); // boltId -> { id, x, y, radius, ownerTeam }

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // Camera update with smooth damping & aim peek offset
  updateCamera(player, mouseX, mouseY) {
    if (!player) return;

    // Small camera look-ahead towards crosshair for tactical feel
    const screenCenterX = this.canvas.width / 2;
    const screenCenterY = this.canvas.height / 2;
    const offsetX = (mouseX - screenCenterX) * 0.22;
    const offsetY = (mouseY - screenCenterY) * 0.22;

    this.camera.targetX = player.x + offsetX;
    this.camera.targetY = player.y + offsetY;

    // Smooth Lerp
    this.camera.x += (this.camera.targetX - this.camera.x) * 0.12;
    this.camera.y += (this.camera.targetY - this.camera.y) * 0.12;

    // Camera shake (from spike detonation / heavy blasts)
    if (this.screenShake > 0) {
      this.camera.x += (Math.random() - 0.5) * this.screenShake;
      this.camera.y += (Math.random() - 0.5) * this.screenShake;
    }

    // Clamp camera within map bounds
    const halfW = (this.canvas.width / 2) / this.camera.zoom;
    const halfH = (this.canvas.height / 2) / this.camera.zoom;
    this.camera.x = Math.max(halfW, Math.min(MAP_DATA.width - halfW, this.camera.x));
    this.camera.y = Math.max(halfH, Math.min(MAP_DATA.height - halfH, this.camera.y));
  }

  // World to Screen coordinates
  worldToScreen(wx, wy) {
    const sx = (wx - this.camera.x) * this.camera.zoom + this.canvas.width / 2;
    const sy = (wy - this.camera.y) * this.camera.zoom + this.canvas.height / 2;
    return { x: sx, y: sy };
  }

  // Screen to World coordinates
  screenToWorld(sx, sy) {
    const wx = (sx - this.canvas.width / 2) / this.camera.zoom + this.camera.x;
    const wy = (sy - this.canvas.height / 2) / this.camera.zoom + this.camera.y;
    return { x: wx, y: wy };
  }

  addTracer(from, to, weapon, isHeadshot) {
    this.tracers.push({
      from: { ...from },
      to: { ...to },
      weapon: weapon,
      isHeadshot: isHeadshot,
      life: 0.18, // seconds
      maxLife: 0.18
    });

    // Add impact spark particles at target
    for (let i = 0; i < 7; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      this.particles.push({
        x: to.x,
        y: to.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 2,
        color: isHeadshot ? '#ff4655' : '#ffde59',
        life: 0.25,
        maxLife: 0.25
      });
    }
  }

  addMuzzleFlash(x, y, angle) {
    this.muzzleFlashes.push({
      x: x + Math.cos(angle) * 28,
      y: y + Math.sin(angle) * 28,
      angle: angle,
      life: 0.06
    });
  }

  // Massive Valorant-Style Spike Blast Wave
  addSpikeBlast(x, y, radius = 1350, duration = 4.0) {
    this.spikeBlasts.push({
      x: x,
      y: y,
      maxRadius: radius,
      currentRadius: 15,
      duration: duration,
      elapsed: 0
    });
    this.screenShake = 35; // Dramatic initial rumble

    // Radial radianite blast debris sparks
    for (let i = 0; i < 45; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 150 + Math.random() * 450;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 3 + Math.random() * 4,
        color: Math.random() > 0.45 ? '#ff4655' : '#00f0ff',
        life: 2.2 + Math.random() * 1.5,
        maxLife: 3.7
      });
    }
  }


  // Ability FX Helpers
  triggerScreenBlind(duration, type = 'white') {
    this.screenBlind.timer = duration;
    this.screenBlind.maxDuration = duration;
    this.screenBlind.type = type;
  }

  updateProjectile(data) {
    this.projectiles.set(data.id, {
      id: data.id,
      x: data.x,
      y: data.y,
      type: data.type,
      updatedAt: Date.now()
    });
  }

  // Sova In-Flight Lightning Arrow
  addFlyingArrow(data) {
    const startX = data.startX;
    const startY = data.startY;
    const targetX = data.targetX;
    const targetY = data.targetY;
    const dx = targetX - startX;
    const dy = targetY - startY;
    const totalDist = Math.max(1, Math.hypot(dx, dy));
    const speed = data.speed || 1200;
    const duration = totalDist / speed;
    const angle = data.angle !== undefined ? data.angle : Math.atan2(dy, dx);

    this.flyingArrows.push({
      id: data.id,
      type: data.arrowType || 'shock', // 'shock' or 'recon'
      startX: startX,
      startY: startY,
      x: startX,
      y: startY,
      targetX: targetX,
      targetY: targetY,
      angle: angle,
      speed: speed,
      totalDist: totalDist,
      duration: duration,
      elapsed: 0,
      trail: []
    });

    // Muzzle / bow release sparks
    for (let i = 0; i < 12; i++) {
      const a = angle + (Math.random() - 0.5) * 0.9;
      const spd = 60 + Math.random() * 120;
      this.particles.push({
        x: startX,
        y: startY,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        radius: 2 + Math.random() * 2,
        color: data.arrowType === 'shock' ? '#00f0ff' : '#3498db',
        life: 0.25,
        maxLife: 0.25
      });
    }
  }

  // Sova Recon Bolt landed on surface
  onReconLanded(data) {
    this.reconBolts.set(data.id, {
      id: data.id,
      x: data.x,
      y: data.y,
      radius: data.radius || 520,
      ownerTeam: data.ownerTeam
    });

    // Impact debris & sparks
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 50 + Math.random() * 140;
      this.particles.push({
        x: data.x,
        y: data.y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        radius: 2 + Math.random() * 2,
        color: '#00f0ff',
        life: 0.45,
        maxLife: 0.45
      });
    }
  }

  // Sova Recon Bolt Navy Sonar Wave Pulse (pulsing 2 times with 1s delay)
  addReconSonarWave(boltX, boltY, radius = 520, pulseNum = 1, totalPulses = 2) {
    this.reconSonarWaves.push({
      x: boltX,
      y: boltY,
      radius: radius,
      currentRadius: 10,
      timer: 0.95, // 0.95s expansion time across full radius
      maxTimer: 0.95,
      pulseNum: pulseNum,
      totalPulses: totalPulses,
      sweepAngle: 0
    });
    this.screenShake = Math.max(this.screenShake, 5);
  }

  addShockBurst(x, y, radius = 110) {
    this.shockBursts.push({
      x: x,
      y: y,
      radius: radius,
      timer: 1.0, // bursts for 1s
      maxTimer: 1.0
    });
    this.screenShake = Math.max(this.screenShake, 16);

    // High-voltage lightning discharge sparks
    for (let i = 0; i < 35; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 70 + Math.random() * 220;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        radius: 2.5 + Math.random() * 2.5,
        color: Math.random() > 0.35 ? '#00f0ff' : '#ffffff',
        life: 0.7 + Math.random() * 0.3,
        maxLife: 1.0
      });
    }
  }

  addReconPulse(x, y, radius = 500) {
    this.reconPulses.push({
      x: x,
      y: y,
      radius: radius,
      currentRadius: 10,
      timer: 0.8,
      maxTimer: 0.8
    });
  }

  setReconRevealed(revealedList, duration = 3.5, ownerTeam = null) {
    const expiresAt = Date.now() + (duration * 1000);
    for (const r of revealedList) {
      this.reconRevealed.set(r.id, { expiresAt, ownerTeam });
    }
  }

  removeReconBolt(boltId, x, y) {
    this.reconBolts.delete(boltId);
    if (x !== undefined && y !== undefined) {
      // Destruction debris sparks
      for (let i = 0; i < 15; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 40 + Math.random() * 100;
        this.particles.push({
          x: x, y: y,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          radius: 2, color: '#3498db',
          life: 0.4, maxLife: 0.4
        });
      }
    }
  }

  updateFX(dt) {
    // Update Tracers
    this.tracers = this.tracers.filter(t => {
      t.life -= dt;
      return t.life > 0;
    });

    // Update Muzzle flashes
    this.muzzleFlashes = this.muzzleFlashes.filter(mf => {
      mf.life -= dt;
      return mf.life > 0;
    });

    // Update Particles
    this.particles = this.particles.filter(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.life > 0;
    });

    // Update Spike Blast Spheres
    this.spikeBlasts = this.spikeBlasts.filter(b => {
      b.elapsed += dt;
      const progress = Math.min(1.0, b.elapsed / b.duration);
      // High-impact ease-out expansion: quick burst then smooth deceleration
      b.currentRadius = b.maxRadius * Math.sin(progress * Math.PI / 2);
      return b.elapsed < b.duration;
    });

    // Update Screen Blind timer
    if (this.screenBlind.timer > 0) {
      this.screenBlind.timer = Math.max(0, this.screenBlind.timer - dt);
    }

    // Clean stale projectiles (older than 400ms without update)
    const nowTs = Date.now();
    for (const [id, p] of this.projectiles) {
      if (nowTs - p.updatedAt > 400) {
        this.projectiles.delete(id);
      }
    }

    // Update Flying Lightning Arrows
    this.flyingArrows = this.flyingArrows.filter(arrow => {
      arrow.elapsed += dt;
      const progress = Math.min(1.0, arrow.elapsed / arrow.duration);
      arrow.x = arrow.startX + (arrow.targetX - arrow.startX) * progress;
      arrow.y = arrow.startY + (arrow.targetY - arrow.startY) * progress;

      // Store trail points for crackling lightning arcs
      arrow.trail.unshift({ x: arrow.x, y: arrow.y });
      if (arrow.trail.length > 10) arrow.trail.pop();

      // Emit crackling electric sparks in flight
      if (Math.random() < 0.75) {
        const sparkAngle = arrow.angle + Math.PI + (Math.random() - 0.5) * 1.4;
        const spd = 40 + Math.random() * 110;
        this.particles.push({
          x: arrow.x,
          y: arrow.y,
          vx: Math.cos(sparkAngle) * spd,
          vy: Math.sin(sparkAngle) * spd,
          radius: 2 + Math.random() * 2,
          color: arrow.type === 'shock' ? (Math.random() > 0.35 ? '#00f0ff' : '#ffffff') : '#3498db',
          life: 0.25 + Math.random() * 0.15,
          maxLife: 0.4
        });
      }

      if (progress >= 1.0) {
        if (arrow.type === 'shock') {
          this.addShockBurst(arrow.targetX, arrow.targetY, 110);
        }
        return false;
      }
      return true;
    });

    // Update Navy Sonar Wave Pulses (pulsing 2 times with 1s delay)
    this.reconSonarWaves = this.reconSonarWaves.filter(sw => {
      sw.timer -= dt;
      const prog = Math.min(1.0, 1 - (sw.timer / sw.maxTimer));
      sw.currentRadius = sw.radius * Math.sin(prog * Math.PI / 2);
      sw.sweepAngle += dt * Math.PI * 4; // rotating radar sweep line
      return sw.timer > 0;
    });

    // Update Shock Bursts
    this.shockBursts = this.shockBursts.filter(sb => {
      sb.timer -= dt;
      return sb.timer > 0;
    });

    // Update Recon Pulses
    this.reconPulses = this.reconPulses.filter(rp => {
      rp.timer -= dt;
      const prog = 1 - (rp.timer / rp.maxTimer);
      rp.currentRadius = rp.radius * prog;
      return rp.timer > 0;
    });

    // Clean expired recon reveals
    for (const [id, data] of this.reconRevealed) {
      const exp = (typeof data === 'object') ? data.expiresAt : data;
      if (nowTs > exp) this.reconRevealed.delete(id);
    }

        // Smoothly decay screen rumble
    if (this.screenShake > 0.05) {
      this.screenShake *= 0.92;
    } else {
      this.screenShake = 0;
    }
  }

  // Main Render Frame
  render(gameState, localPlayerId, mousePos) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const localPlayer = gameState.players.find(p => p.id === localPlayerId);
    if (localPlayer) {
      this.updateCamera(localPlayer, mousePos.screenX, mousePos.screenY);
    }

    // Apply Camera Transform
    ctx.save();
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Render Map Floor & Grid
    this.renderMapFloor(ctx);

    // 2. Render Plant Sites (A and B)
    this.renderPlantSites(ctx);

    // 3. Render Ground Items & Dropped Spike
    this.renderGroundItems(ctx, gameState);

    // 4. Render Active Molotovs
    this.renderMolotovs(ctx, gameState.activeMolotovs);

    // 5. Render Active Smokes
    this.renderSmokes(ctx, gameState.activeSmokes);

    // 6. Render Map Walls, Crates & Barriers
    this.renderMapArchitecture(ctx, gameState.state === 'buyPhase');

    // 7. Calculate & Render Line of Sight Fog of War
    if (localPlayer) {
      fogOfWar.updateSegments(gameState.state === 'buyPhase');
      const visibility = fogOfWar.calculateVisibility(localPlayer, gameState.activeSmokes);
      
      // Render Players only if visible
      this.renderPlayers(ctx, gameState.players, localPlayer, gameState.activeSmokes);

      // Render Tracers & FX
      this.renderTracers(ctx);
      this.renderParticles(ctx);

      // Render Fog of War Overlay
      fogOfWar.renderFog(ctx, localPlayer, visibility, gameState.activeSmokes);

      // 7a. Sova Recon Wallhack: render revealed enemies through walls & fog
      this.renderRevealedEnemiesThroughWalls(ctx, gameState.players, localPlayer);
    } else {
      // Spectating / Overview: render all players
      this.renderPlayers(ctx, gameState.players, null, []);
      this.renderTracers(ctx);
      this.renderParticles(ctx);
    }

    // 6b. Render Active Sova Recon Bolts
    this.renderReconBolts(ctx, gameState.activeReconBolts);

    // 6c. Render Navy Sonar Wave Pulses (Authentic Submarine/Navy Radar Wave)
    this.renderReconSonarWaves(ctx);

    // 6d. Render Flying Lightning Arrows (Sova Shock Bolt & Recon Bolt)
    this.renderFlyingArrows(ctx);

    // 6e. Render Flying Projectiles (Paranoia dark beam)
    this.renderProjectiles(ctx);

    // 6f. Render Shock Bursts
    this.renderShockEffects(ctx);

    // 7b. Render Valorant Spike Detonation Dome & Shockwave
    this.renderSpikeBlasts(ctx);

    ctx.restore();

    // 7c. Render Screen Blind Overlay (Flash Whiteout or Omen Paranoia Darkness)
    this.renderScreenBlindOverlay(ctx, localPlayer);

    // 8. Render Dynamic Crosshair on top of canvas (Screen Space)
    if (localPlayer && localPlayer.isAlive) {
      this.renderCrosshair(ctx, mousePos.screenX, mousePos.screenY, localPlayer);
    }

    // 9. Render Tactical Mini-Map
    this.renderMiniMap(gameState, localPlayer);
  }


  // Render Sova Recon Bolts stuck to walls/ground with blue blinking beacon animation
  renderReconBolts(ctx, activeBolts) {
    if (!activeBolts) return;
    for (const bolt of activeBolts) {
      ctx.save();
      ctx.translate(bolt.x, bolt.y);

      // 1. Blue blinking animation (just like spike blinks) without altering recon bolt shape
      const blinkPhase = (Date.now() % 900) / 900; // repeating 0 to 1 blink cycle
      const beaconRadius = blinkPhase * 56;
      const beaconAlpha = Math.max(0, 1.0 - blinkPhase);

      // Expanding cyan/blue radar ring
      ctx.strokeStyle = `rgba(0, 240, 255, ${beaconAlpha * 0.75})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, beaconRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Pulsating soft blue halo around bolt
      const haloGlow = 18 + Math.sin(Date.now() * 0.009) * 5;
      const glowGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, haloGlow);
      glowGrad.addColorStop(0, 'rgba(0, 240, 255, 0.45)');
      glowGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(0, 0, haloGlow, 0, Math.PI * 2);
      ctx.fill();

      // 2. Recon Bolt Arrow Shape (preserved cleanly without distortion)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-2, -12, 4, 24);
      ctx.fillRect(-12, -2, 24, 4);

      // Outer sonar ring
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.stroke();

      // Glowing sonar core node
      ctx.fillStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // Render Sova Recon Wallhack: highlighted enemies through walls whether facing them or not!
  renderRevealedEnemiesThroughWalls(ctx, players, localPlayer) {
    if (!players || !localPlayer) return;

    for (const player of players) {
      if (!player.isAlive || player.id === localPlayer.id) continue;
      if (player.team === localPlayer.team) continue; // Only enemies

      const reconData = this.reconRevealed.get(player.id);
      const isReconRevealed = (player.reconRevealed && (!player.revealedByTeam || player.revealedByTeam === localPlayer.team)) ||
        (reconData && (!reconData.ownerTeam || reconData.ownerTeam === localPlayer.team));

      if (isReconRevealed) {
        ctx.save();
        ctx.translate(player.x, player.y);

        // 1. High-contrast wallhack glowing silhouette ring
        const pulse = 22 + Math.sin(Date.now() * 0.012) * 3;
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.arc(0, 0, pulse, 0, Math.PI * 2);
        ctx.stroke();

        // Inner glowing core
        ctx.fillStyle = 'rgba(255, 0, 85, 0.25)';
        ctx.beginPath();
        ctx.arc(0, 0, CONSTANTS.PLAYER_RADIUS || 18, 0, Math.PI * 2);
        ctx.fill();

        // 2. Tactical "REVEALED" Diamond Marker above player's head through walls
        const markerY = -34;
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#00f0ff';
        ctx.fillStyle = '#ff0055';
        ctx.beginPath();
        ctx.moveTo(0, markerY - 7);
        ctx.lineTo(6, markerY);
        ctx.lineTo(0, markerY + 7);
        ctx.lineTo(-6, markerY);
        ctx.closePath();
        ctx.fill();

        // Label: REVEALED
        ctx.font = 'bold 10px "Rajdhani", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#000';
        ctx.fillText('REVEALED', 0, markerY - 9);

        // Health bar through wall
        const hpBarW = 32;
        const hpBarH = 4;
        const hpRatio = Math.max(0, Math.min(1, player.health / 100));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(-hpBarW / 2, markerY + 9, hpBarW, hpBarH);
        ctx.fillStyle = '#ff4655';
        ctx.fillRect(-hpBarW / 2, markerY + 9, hpBarW * hpRatio, hpBarH);

        ctx.restore();
      }
    }
  }

  // Render Sova Navy Sonar Wave (Authentic Submarine/Navy Radar Sonar Wave: 2 pulses with 1s delay)
  renderReconSonarWaves(ctx) {
    for (const sw of this.reconSonarWaves) {
      const progress = Math.min(1.0, 1 - (sw.timer / sw.maxTimer));
      const alpha = Math.max(0, 1.0 - progress);

      ctx.save();
      ctx.translate(sw.x, sw.y);

      // 1. Primary Navy Sonar Wavefront Ring (Main expanding pressure wave crest)
      ctx.strokeStyle = `rgba(0, 240, 255, ${alpha * 0.95})`;
      ctx.lineWidth = 4.5;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(0, 0, sw.currentRadius, 0, Math.PI * 2);
      ctx.stroke();

      // 2. Harmonic Acoustic Ripple Rings trailing inside the main wavefront (sound wave propagation)
      const rippleOffsets = [32, 64, 96];
      for (let i = 0; i < rippleOffsets.length; i++) {
        const rippleR = sw.currentRadius - rippleOffsets[i];
        if (rippleR > 8) {
          const rippleAlpha = alpha * (0.65 - i * 0.18);
          ctx.strokeStyle = `rgba(52, 152, 219, ${rippleAlpha})`;
          ctx.lineWidth = 2.5 - i * 0.5;
          ctx.shadowColor = '#3498db';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(0, 0, rippleR, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 3. Rotating Navy Radar / Sonar Sweep Line (P-Scope clock-hand sweep)
      const sweepR = Math.min(sw.currentRadius, sw.radius);
      const sweepX = Math.cos(sw.sweepAngle) * sweepR;
      const sweepY = Math.sin(sw.sweepAngle) * sweepR;
      ctx.strokeStyle = `rgba(0, 240, 255, ${alpha * 0.85})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sweepX, sweepY);
      ctx.stroke();

      // 4. Subtle Radial Sonar Acoustic Gradient Fill
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, sw.currentRadius);
      grad.addColorStop(0, `rgba(0, 240, 255, ${alpha * 0.22})`);
      grad.addColorStop(0.75, `rgba(52, 152, 219, ${alpha * 0.10})`);
      grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, sw.currentRadius, 0, Math.PI * 2);
      ctx.fill();

      // 5. Tactical Sonar Scan Badge (Pulse 1/2 or Pulse 2/2)
      ctx.font = 'bold 11px "Inter", monospace';
      ctx.fillStyle = `rgba(0, 240, 255, ${alpha * 0.95})`;
      ctx.textAlign = 'center';
      ctx.fillText(`SONAR SCAN [${sw.pulseNum || 1}/2]`, 0, -sw.currentRadius - 10);

      ctx.restore();
    }
  }

  // Render Sova In-Flight Lightning Arrows (Surrounded by crackling dynamic electric bolts)
  renderFlyingArrows(ctx) {
    for (const arrow of this.flyingArrows) {
      ctx.save();
      ctx.translate(arrow.x, arrow.y);
      ctx.rotate(arrow.angle);

      const isShock = arrow.type === 'shock';
      const mainColor = isShock ? '#00f0ff' : '#3498db';
      const coreColor = '#ffffff';

      // 1. Arrow Head & Sleek Shaft
      ctx.shadowColor = mainColor;
      ctx.shadowBlur = 24;

      // Arrow head
      ctx.fillStyle = coreColor;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-6, -6);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();

      // Arrow shaft
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.lineTo(-34, 0);
      ctx.stroke();

      // 2. Crackling Multi-Segmented Jagged Lightning Bolts dancing around arrow
      const boltCount = 4;
      for (let b = 0; b < boltCount; b++) {
        ctx.beginPath();
        ctx.strokeStyle = (b % 2 === 0) ? coreColor : mainColor;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = mainColor;
        ctx.shadowBlur = 18;

        let lx = 12;
        let ly = 0;
        ctx.moveTo(lx, ly);

        const segments = 6;
        const segLen = 14;
        for (let s = 0; s < segments; s++) {
          lx -= segLen;
          ly += (Math.random() - 0.5) * 16;
          ctx.lineTo(lx, ly);

          // Branching secondary electric discharge fork
          if (Math.random() < 0.45) {
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            const branchX = lx - 8 + (Math.random() - 0.5) * 6;
            const branchY = ly + (Math.random() - 0.5) * 18;
            ctx.lineTo(branchX, branchY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(lx, ly);
          }
        }
        ctx.stroke();
      }

      // 3. Glowing ion aura core
      const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
      aura.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      aura.addColorStop(0.4, isShock ? 'rgba(0, 240, 255, 0.75)' : 'rgba(52, 152, 219, 0.75)');
      aura.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // Render Shock Bolt in-flight lightning & ground electric bursts
  renderShockEffects(ctx) {
    for (const sb of this.shockBursts) {
      const alpha = Math.max(0, sb.timer / sb.maxTimer);
      ctx.save();

      // Inner electric core
      const grad = ctx.createRadialGradient(sb.x, sb.y, 0, sb.x, sb.y, sb.radius);
      grad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.95})`);
      grad.addColorStop(0.35, `rgba(0, 240, 255, ${alpha * 0.85})`);
      grad.addColorStop(0.7, `rgba(52, 152, 219, ${alpha * 0.5})`);
      grad.addColorStop(1, 'rgba(0, 240, 255, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sb.x, sb.y, sb.radius, 0, Math.PI * 2);
      ctx.fill();

      // Crackling lightning arcs
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 / 5) * i + Math.random() * 0.3;
        ctx.beginPath();
        ctx.moveTo(sb.x, sb.y);
        const midX = sb.x + Math.cos(angle) * (sb.radius * 0.5) + (Math.random() - 0.5) * 15;
        const midY = sb.y + Math.sin(angle) * (sb.radius * 0.5) + (Math.random() - 0.5) * 15;
        const endX = sb.x + Math.cos(angle) * sb.radius;
        const endY = sb.y + Math.sin(angle) * sb.radius;
        ctx.lineTo(midX, midY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // Render Flying Projectiles (Paranoia dark beam & Shock Arrow lightning)
  renderProjectiles(ctx) {
    for (const [, proj] of this.projectiles) {
      ctx.save();
      ctx.translate(proj.x, proj.y);

      if (proj.type === 'paranoia') {
        // Omen Paranoia: Dark shadowy mist sphere with purple tentacles
        const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, 48);
        grad.addColorStop(0, 'rgba(10, 5, 20, 0.95)');
        grad.addColorStop(0.5, 'rgba(123, 94, 234, 0.7)');
        grad.addColorStop(0.85, 'rgba(255, 70, 85, 0.4)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.shadowColor = '#7b5eea';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.arc(0, 0, 48, 0, Math.PI * 2);
        ctx.fill();

        // Paranoia core eye
        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
      } else if (proj.type === 'shock') {
        // Sova Shock Arrow: Lightning trail
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();

        // Electricity tail
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-20 + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // Screen Blind Overlay: Full White Flash VS Omen Paranoia Void
  renderScreenBlindOverlay(ctx, localPlayer) {
    const isParanoiaFromState = localPlayer && localPlayer.paranoiaBlind && localPlayer.blindTimer > 0;
    const isBlindFromState = localPlayer && localPlayer.blindTimer > 0;

    let blindTimer = this.screenBlind.timer;
    let blindType = this.screenBlind.type;
    let maxDur = this.screenBlind.maxDuration || 2.5;

    // Sync with server authoritative state if local timer not active
    if (blindTimer <= 0 && isBlindFromState) {
      blindTimer = localPlayer.blindTimer;
      maxDur = 2.5;
      blindType = isParanoiaFromState ? 'paranoia' : 'white';
    }

    if (blindTimer <= 0) return;

    const alpha = Math.min(1.0, blindTimer / (maxDur * 0.4));

    ctx.save();
    if (blindType === 'paranoia' || isParanoiaFromState) {
      // OMEN PARANOIA: The player only sees themselves! Everything else is pitch darkness with dark blue, purple, light pink/red vignette
      const cx = this.canvas.width / 2;
      const cy = this.canvas.height / 2;

      // Radial vignette: clear center around player (radius 55), transition into darkness mixed with black, dark blue, purple, and hints of red/pink
      const innerClear = 55;
      const outerDark = Math.max(this.canvas.width, this.canvas.height) * 0.85;

      const grad = ctx.createRadialGradient(cx, cy, innerClear, cx, cy, outerDark);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)'); // Center around player is clear
      grad.addColorStop(0.12, 'rgba(25, 12, 45, 0.85)'); // Dark purple ring
      grad.addColorStop(0.35, 'rgba(10, 18, 55, 0.96)'); // Deep dark blue
      grad.addColorStop(0.65, 'rgba(35, 8, 25, 0.98)'); // Very light hint of dark pink/red
      grad.addColorStop(1, 'rgba(5, 5, 8, 1.0)'); // Pitch black void covering walls, sites, opponents

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // Heavy edge blackout
      ctx.fillStyle = `rgba(3, 4, 8, ${alpha * 0.94})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // Red/purple shadowy mist overlay
      const mistGrad = ctx.createRadialGradient(cx, cy, innerClear * 0.8, cx, cy, 320);
      mistGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      mistGrad.addColorStop(0.7, 'rgba(123, 94, 234, 0.22)');
      mistGrad.addColorStop(1, 'rgba(255, 70, 85, 0.15)');
      ctx.fillStyle = mistGrad;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    } else {
      // PHOENIX FLASH: Pure white screen blinding out everything
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.98})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.restore();
  }

    // Render Valorant-Style Expanding Dark-Matter Dome and Shockwave
  renderSpikeBlasts(ctx) {
    for (const b of this.spikeBlasts) {
      const progress = b.elapsed / b.duration;
      const alpha = Math.max(0, 1.0 - Math.pow(progress, 3));

      ctx.save();

      // 1. Inner lethal Radianite Dark Matter dome (black core expanding outwards)
      const grad = ctx.createRadialGradient(b.x, b.y, b.currentRadius * 0.15, b.x, b.y, b.currentRadius);
      grad.addColorStop(0, `rgba(5, 7, 12, ${alpha * 0.96})`);
      grad.addColorStop(0.75, `rgba(16, 12, 28, ${alpha * 0.90})`);
      grad.addColorStop(0.92, `rgba(0, 240, 255, ${alpha * 0.85})`);
      grad.addColorStop(1, `rgba(255, 70, 85, ${alpha})`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
      ctx.fill();

      // 2. High-energy outer shockwave perimeter ring
      ctx.strokeStyle = `rgba(0, 240, 255, ${alpha * 0.95})`;
      ctx.lineWidth = 8;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 32;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
      ctx.stroke();

      // 3. Secondary inner compression wave ring
      if (b.currentRadius > 80) {
        ctx.strokeStyle = `rgba(255, 70, 85, ${alpha * 0.65})`;
        ctx.lineWidth = 4;
        ctx.shadowColor = '#ff4655';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(b.x, b.y, Math.max(0, b.currentRadius - 35), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // Floor Grid & Tiles
  renderMapFloor(ctx) {
    // FIX 8: Metallic steel-grey floor with subtle glow (not pitch black)
    ctx.fillStyle = '#1a2030';
    ctx.fillRect(0, 0, MAP_DATA.width, MAP_DATA.height);

    // Steel plate sheen overlay
    const floorGrad = ctx.createLinearGradient(0, 0, MAP_DATA.width, MAP_DATA.height);
    floorGrad.addColorStop(0, 'rgba(50, 65, 80, 0.18)');
    floorGrad.addColorStop(0.5, 'rgba(70, 85, 100, 0.10)');
    floorGrad.addColorStop(1, 'rgba(40, 55, 70, 0.18)');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, 0, MAP_DATA.width, MAP_DATA.height);

    // Tactical subtle grid (slightly more visible on lighter floor)
    ctx.strokeStyle = 'rgba(100, 140, 180, 0.06)';
    ctx.lineWidth = 1;
    const gridSize = 100;
    ctx.beginPath();
    for (let x = 0; x <= MAP_DATA.width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAP_DATA.height);
    }
    for (let y = 0; y <= MAP_DATA.height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(MAP_DATA.width, y);
    }
    ctx.stroke();

    // Floor Callout Text
    ctx.font = 'bold 36px "Teko", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const callout of MAP_DATA.callouts) {
      ctx.fillText(callout.text, callout.x, callout.y);
    }
  }

  // Plant Sites
  renderPlantSites(ctx) {
    for (const site of MAP_DATA.plantSites) {
      // Site zone fill
      ctx.fillStyle = site.color;
      ctx.fillRect(site.x, site.y, site.w, site.h);

      // Dashed boundary
      ctx.strokeStyle = site.id === 'A' ? '#ff4655' : '#00f0ff';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 8]);
      ctx.strokeRect(site.x, site.y, site.w, site.h);
      ctx.setLineDash([]);

      // Site letter watermark
      ctx.font = 'bold 120px "Teko", sans-serif';
      ctx.fillStyle = site.id === 'A' ? 'rgba(255, 70, 85, 0.12)' : 'rgba(0, 240, 255, 0.12)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(site.id, site.x + site.w / 2, site.y + site.h / 2);
    }
  }

  // Spatial Viewport Culling Helper
  isBoxInViewport(x, y, w, h) {
    const halfW = (this.canvas.width / 2) / (this.camera.zoom || 1.0) + 100;
    const halfH = (this.canvas.height / 2) / (this.camera.zoom || 1.0) + 100;
    return (
      x + w >= this.camera.x - halfW &&
      x <= this.camera.x + halfW &&
      y + h >= this.camera.y - halfH &&
      y <= this.camera.y + halfH
    );
  }

  // Map Walls, Crates & Barriers with Spatial Frustum Culling
  renderMapArchitecture(ctx, isBuyPhase) {
    // 1. Solid Walls
    for (const wall of MAP_DATA.walls) {
      // Spatial culling: skip drawing walls outside viewport
      if (!this.isBoxInViewport(wall.x, wall.y, wall.w, wall.h)) {
        continue;
      }
      if (wall.type === 'crate') {
        // Tactical Radianite Crate
        ctx.fillStyle = '#223843';
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

        // Radianite glowing core
        ctx.fillStyle = '#00f0ff';
        const radMargin = 12;
        ctx.fillRect(wall.x + radMargin, wall.y + radMargin, wall.w - radMargin * 2, wall.h - radMargin * 2);

        // Metal crate border
        ctx.strokeStyle = '#4a6572';
        ctx.lineWidth = 4;
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
      } else {
        // FIX 8: Architectural Stone/Metal Wall — steel blue-grey (NOT dark grey)
        ctx.fillStyle = '#2a3a4a';
        ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

        // Top highlight bevel — gives 3D lifted look
        ctx.fillStyle = 'rgba(100, 130, 160, 0.20)';
        ctx.fillRect(wall.x, wall.y, wall.w, 3);
        ctx.fillRect(wall.x, wall.y, 3, wall.h);

        // Wall border — steel blue
        ctx.strokeStyle = '#4a6580';
        ctx.lineWidth = 2;
        ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);

        // Subtle shadow at bottom/right
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(wall.x - 1, wall.y - 1, wall.w + 2, wall.h + 2);
      }
    }

    // 2. Buy Phase Laser Barriers (Pulsing energy line)
    if (isBuyPhase) {
      const time = Date.now() * 0.005;
      const alpha = 0.5 + Math.sin(time) * 0.25;

      for (const b of MAP_DATA.barriers) {
        const isAtt = b.team === 'attackers';
        const color = isAtt ? `rgba(255, 70, 85, ${alpha})` : `rgba(0, 240, 255, ${alpha})`;

        ctx.fillStyle = color;
        ctx.fillRect(b.x, b.y, b.w, b.h);

        // Laser edge line
        ctx.strokeStyle = isAtt ? '#ff4655' : '#00f0ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);

        // Barrier text
        ctx.font = 'bold 11px "Inter", sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('// BUY BARRIER //', b.x + b.w / 2, b.y + b.h / 2);
      }
    }
  }

  // Dropped Spike & Ground Items
  renderGroundItems(ctx, gameState) {
    // Dropped Spike on ground
    if (gameState.droppedSpike) {
      const sp = gameState.droppedSpike;
      ctx.save();
      ctx.translate(sp.x, sp.y);

      // Flashing orange beacon
      ctx.fillStyle = '#ff9800';
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();

      // Spike symbol
      ctx.fillStyle = '#000';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💣', 0, 0);

      ctx.restore();
    }

    // Planted Spike (Active Blinking vs Defused Inert)
    if (gameState.spike && (gameState.spike.planted || gameState.spike.defused)) {
      const sp = gameState.spike;
      ctx.save();
      ctx.translate(sp.x, sp.y);

      if (sp.defused) {
        // Spike is defused: STOP BLINKING! Render inert deactivated casing
        ctx.fillStyle = '#3a4a58';
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#1c2833';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Active Planted Spike: blinks red with pulsating core and expanding beacon ring
        const time = Date.now() * 0.01;
        const pulse = 14 + Math.sin(time * 3) * 4;

        // Expanding radar beacon ring
        ctx.strokeStyle = 'rgba(255, 70, 85, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, (Date.now() % 1000) / 1000 * 60, 0, Math.PI * 2);
        ctx.stroke();

        // Spike core
        ctx.fillStyle = '#ff4655';
        ctx.beginPath();
        ctx.arc(0, 0, pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // Active Smokes
  renderSmokes(ctx, smokes) {
    for (const smoke of smokes) {
      ctx.save();
      const grad = ctx.createRadialGradient(smoke.x, smoke.y, smoke.radius * 0.2, smoke.x, smoke.y, smoke.radius);
      grad.addColorStop(0, 'rgba(20, 28, 38, 0.95)');
      grad.addColorStop(0.75, 'rgba(25, 36, 48, 0.9)');
      grad.addColorStop(1, 'rgba(35, 50, 68, 0.4)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(smoke.x, smoke.y, smoke.radius, 0, Math.PI * 2);
      ctx.fill();

      // Smoke boundary ring
      ctx.strokeStyle = smoke.color || '#7b5eea';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Active Molotovs
  renderMolotovs(ctx, molotovs) {
    const time = Date.now() * 0.005;
    for (const m of molotovs) {
      ctx.save();
      const grad = ctx.createRadialGradient(m.x, m.y, 10, m.x, m.y, m.radius);
      grad.addColorStop(0, 'rgba(255, 105, 52, 0.75)');
      grad.addColorStop(0.6, 'rgba(255, 70, 0, 0.4)');
      grad.addColorStop(1, 'rgba(255, 0, 0, 0.05)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      ctx.fill();

      // Dancing fire sparks inside pool
      ctx.fillStyle = '#ffde59';
      for (let i = 0; i < 5; i++) {
        const offsetAngle = time * 2 + i * 1.3;
        const dist = (m.radius * 0.6) * ((Math.sin(time + i) + 1) / 2);
        const fx = m.x + Math.cos(offsetAngle) * dist;
        const fy = m.y + Math.sin(offsetAngle) * dist;
        ctx.beginPath();
        ctx.arc(fx, fy, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // Players Rendering with Sight Occlusion Check
  renderPlayers(ctx, players, localPlayer, activeSmokes) {
    for (const player of players) {
      if (!player.isAlive) {
        // Render dead player skull indicator
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✖', 0, 0);
        ctx.restore();
        continue;
      }

      // Check visibility if local player is alive
      if (localPlayer && localPlayer.isAlive && player.id !== localPlayer.id) {
        const isReconRevealed = player.reconRevealed || this.reconRevealed.has(player.id);
        const visible = isReconRevealed || fogOfWar.isTargetVisible(localPlayer, player, activeSmokes);
        if (!visible) continue; // Hidden in Fog of War / behind walls!
      }

      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);

      const isLocal = localPlayer && player.id === localPlayer.id;
      const isAttacker = player.team === 'attackers';
      const teamColor = isAttacker ? '#ff4655' : '#00f0ff';
      const agentDef = CONSTANTS.AGENTS[player.agent];

      // 1. Weapon Barrel / Model
      ctx.fillStyle = '#111';
      ctx.fillRect(10, -3, 20, 6);

      // 2. Operative Body Circle
      ctx.fillStyle = agentDef ? agentDef.color : '#555';
      ctx.beginPath();
      ctx.arc(0, 0, CONSTANTS.PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // 3. Team Outline Ring
      const isReconned = player.reconRevealed || this.reconRevealed.has(player.id);
      if (isReconned) {
        // Red glowing sonar reveal outline
        ctx.strokeStyle = '#ff0055';
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 18;
      } else {
        ctx.strokeStyle = teamColor;
      }
      ctx.lineWidth = isLocal ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, CONSTANTS.PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();

      // 4. Tactical Vest / Visor
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(6, 0, 4, 0, Math.PI * 2);
      ctx.fill();

      // 5. Spike Backpack indicator if carrying Spike
      // (Spike carrier is shown on back)
      ctx.restore();

      // 6. Player Name & Health Bar (Upright, not rotated)
      ctx.save();
      ctx.translate(player.x, player.y);

      // Name
      ctx.font = 'bold 12px "Inter", sans-serif';
      ctx.fillStyle = isLocal ? '#ffde59' : '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(player.name, 0, -CONSTANTS.PLAYER_RADIUS - 16);

      // Health Bar
      const barW = 36;
      const barH = 4;
      const barX = -barW / 2;
      const barY = -CONSTANTS.PLAYER_RADIUS - 10;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(barX, barY, barW, barH);

      const hpPercent = Math.max(0, player.health / 100);
      ctx.fillStyle = teamColor;
      ctx.fillRect(barX, barY, barW * hpPercent, barH);

      // Armor sliver
      if (player.armor > 0) {
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(barX, barY - 2, barW * (player.armor / 50), 2);
      }

      ctx.restore();
    }
  }

  // Bullet Tracers
  renderTracers(ctx) {
    for (const t of this.tracers) {
      const alpha = t.life / t.maxLife;
      ctx.strokeStyle = t.isHeadshot ? `rgba(255, 70, 85, ${alpha})` : `rgba(255, 222, 89, ${alpha})`;
      ctx.lineWidth = t.isHeadshot ? 3.5 : 2.0;

      ctx.beginPath();
      ctx.moveTo(t.from.x, t.from.y);
      ctx.lineTo(t.to.x, t.to.y);
      ctx.stroke();
    }
  }

  // Particles with Spatial Frustum Culling
  renderParticles(ctx) {
    for (const p of this.particles) {
      if (!this.isBoxInViewport(p.x - 12, p.y - 12, 24, 24)) continue;
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  // Dynamic Crosshair (Rendered in Screen Coordinates)
  renderCrosshair(ctx, mouseX, mouseY, player) {
    const isMoving = Math.hypot(player.vx, player.vy) > 20;
    const baseGap = isMoving ? 8 : (player.input && player.input.crouch ? 2 : 4);
    const lineLen = 6;
    const thickness = 2;

    ctx.save();
    ctx.translate(mouseX, mouseY);
    ctx.fillStyle = '#00f0ff';

    // Center dot
    ctx.fillRect(-1, -1, 2, 2);

    // 4 crosshair ticks
    ctx.fillRect(-thickness / 2, -baseGap - lineLen, thickness, lineLen); // Top
    ctx.fillRect(-thickness / 2, baseGap, thickness, lineLen); // Bottom
    ctx.fillRect(-baseGap - lineLen, -thickness / 2, lineLen, thickness); // Left
    ctx.fillRect(baseGap, -thickness / 2, lineLen, thickness); // Right

    ctx.restore();
  }

  // Mini-Map Overview Renderer
  renderMiniMap(gameState, localPlayer) {
    if (!this.miniCtx) return;
    const mCtx = this.miniCtx;
    const mW = this.miniCanvas.width;
    const mH = this.miniCanvas.height;

    const scaleX = mW / MAP_DATA.width;
    const scaleY = mH / MAP_DATA.height;

    mCtx.fillStyle = '#090e14';
    mCtx.fillRect(0, 0, mW, mH);

    // Walls
    mCtx.fillStyle = '#223242';
    for (const w of MAP_DATA.walls) {
      mCtx.fillRect(w.x * scaleX, w.y * scaleY, w.w * scaleX, w.h * scaleY);
    }

    // Plant Sites
    for (const site of MAP_DATA.plantSites) {
      mCtx.fillStyle = site.id === 'A' ? 'rgba(255, 70, 85, 0.4)' : 'rgba(0, 240, 255, 0.4)';
      mCtx.fillRect(site.x * scaleX, site.y * scaleY, site.w * scaleX, site.h * scaleY);

      mCtx.font = 'bold 10px sans-serif';
      mCtx.fillStyle = '#fff';
      mCtx.fillText(site.id, (site.x + site.w / 2) * scaleX - 3, (site.y + site.h / 2) * scaleY + 3);
    }

    // Active Smokes on Mini-Map
    for (const smoke of gameState.activeSmokes) {
      mCtx.fillStyle = 'rgba(123, 94, 234, 0.5)';
      mCtx.beginPath();
      mCtx.arc(smoke.x * scaleX, smoke.y * scaleY, smoke.radius * scaleX, 0, Math.PI * 2);
      mCtx.fill();
    }

    // Planted Spike on Mini-Map
    if (gameState.spike && gameState.spike.planted && !gameState.spike.defused) {
      mCtx.fillStyle = '#ff4655';
      mCtx.beginPath();
      mCtx.arc(gameState.spike.x * scaleX, gameState.spike.y * scaleY, 5, 0, Math.PI * 2);
      mCtx.fill();
    }

    // Players on Mini-Map
    for (const p of gameState.players) {
      if (!p.isAlive) continue;

      const isTeammate = localPlayer && p.team === localPlayer.team;
      const isSelf = localPlayer && p.id === localPlayer.id;
      
      // Enemies only show on minimap if visible in Fog of War!
      if (!isTeammate && localPlayer) {
        if (!fogOfWar.isTargetVisible(localPlayer, p, gameState.activeSmokes)) {
          continue;
        }
      }

      mCtx.save();
      mCtx.translate(p.x * scaleX, p.y * scaleY);

      // Vision cone on minimap for self
      if (isSelf) {
        mCtx.fillStyle = 'rgba(0, 240, 255, 0.15)';
        mCtx.beginPath();
        mCtx.moveTo(0, 0);
        mCtx.arc(0, 0, 30, p.angle - CONSTANTS.FOV_ANGLE / 2, p.angle + CONSTANTS.FOV_ANGLE / 2);
        mCtx.closePath();
        mCtx.fill();
      }

      // Player Dot
      mCtx.fillStyle = isSelf ? '#ffde59' : (p.team === 'attackers' ? '#ff4655' : '#00f0ff');
      mCtx.beginPath();
      mCtx.arc(0, 0, isSelf ? 4.5 : 3.5, 0, Math.PI * 2);
      mCtx.fill();

      mCtx.restore();
    }
  }
}

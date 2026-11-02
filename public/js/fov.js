// 2D Raycasting Field-of-View (FOV) and Fog of War Engine

class FogOfWar {
  constructor() {
    this.segments = [];
    this.exploredCanvas = document.createElement('canvas');
    this.exploredCtx = this.exploredCanvas.getContext('2d');
    this.initialized = false;
  }

  init(width, height) {
    this.exploredCanvas.width = width;
    this.exploredCanvas.height = height;
    this.exploredCtx.fillStyle = '#060a0f';
    this.exploredCtx.fillRect(0, 0, width, height);
    this.initialized = true;
  }

  updateSegments(includeBarriers = false) {
    this.segments = getWallSegments(includeBarriers);
  }

  // Cast ray from (px, py) along given angle and find closest intersection
  castRay(px, py, angle, maxDist, segments) {
    const rx = px + Math.cos(angle) * maxDist;
    const ry = py + Math.sin(angle) * maxDist;

    let closestHit = { x: rx, y: ry, dist: maxDist, angle: angle };

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const hit = this.getLineIntersection(px, py, rx, ry, seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y);
      if (hit && hit.dist < closestHit.dist) {
        closestHit = {
          x: hit.x,
          y: hit.y,
          dist: hit.dist,
          angle: angle
        };
      }
    }

    return closestHit;
  }

  getLineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return null;

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
      const ix = x1 + ua * (x2 - x1);
      const iy = y1 + ua * (y2 - y1);
      const d = Math.hypot(ix - x1, iy - y1);
      return { x: ix, y: iy, dist: d };
    }
    return null;
  }

  // Calculate Visibility Polygon within Vision Cone + Close Peripheral Circle
  calculateVisibility(player, activeSmokes = []) {
    const px = player.x;
    const py = player.y;
    const facingAngle = player.angle;
    const fovHalf = (CONSTANTS.FOV_ANGLE || (130 * Math.PI / 180)) / 2;
    const maxDist = CONSTANTS.VISION_DISTANCE || 2800; // Naked eye long-range horizon
    const periphDist = CONSTANTS.PERIPHERAL_RADIUS || 110; // Clear immediate tactical awareness area around player

    // Filter segments within reasonable distance
    const nearbySegments = this.segments.filter(seg => {
      const midX = (seg.p1.x + seg.p2.x) / 2;
      const midY = (seg.p1.y + seg.p2.y) / 2;
      return Math.hypot(midX - px, midY - py) < maxDist + 200;
    });

    // 1. Vision Cone Polygon points (Forward field of view where player is facing)
    const minConeAngle = facingAngle - fovHalf;
    const maxConeAngle = facingAngle + fovHalf;

    // Sample vertices of segments that fall near the cone
    const angles = [];
    for (let i = 0; i < nearbySegments.length; i++) {
      const seg = nearbySegments[i];
      for (const pt of [seg.p1, seg.p2]) {
        const a = Math.atan2(pt.y - py, pt.x - px);
        // Normalize relative to facing angle
        let diff = a - facingAngle;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        while (diff > Math.PI) diff -= 2 * Math.PI;

        if (Math.abs(diff) <= fovHalf + 0.08) {
          angles.push(a - 0.0002, a, a + 0.0002);
        }
      }
    }

    // Add arc steps for smooth circular cone arc (naked eye long-range horizon)
    const arcSteps = 32;
    for (let i = 0; i <= arcSteps; i++) {
      angles.push(minConeAngle + (maxConeAngle - minConeAngle) * (i / arcSteps));
    }

    // Sort angles
    angles.sort((a, b) => {
      let diffA = a - facingAngle;
      while (diffA < -Math.PI) diffA += 2 * Math.PI;
      while (diffA > Math.PI) diffA -= 2 * Math.PI;

      let diffB = b - facingAngle;
      while (diffB < -Math.PI) diffB += 2 * Math.PI;
      while (diffB > Math.PI) diffB -= 2 * Math.PI;

      return diffA - diffB;
    });

    // Cast rays for cone
    const conePoints = [];
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      let diff = a - facingAngle;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      while (diff > Math.PI) diff -= 2 * Math.PI;

      if (Math.abs(diff) <= fovHalf + 0.0001) {
        const hit = this.castRay(px, py, a, maxDist, nearbySegments);
        conePoints.push(hit);
      }
    }

    // 2. Immediate tactical surroundings circle (clear visibility area around player, raycast-stopped by walls)
    const periphPoints = [];
    const periphSteps = 24;
    for (let i = 0; i < periphSteps; i++) {
      const a = (i / periphSteps) * Math.PI * 2;
      const hit = this.castRay(px, py, a, periphDist, nearbySegments);
      periphPoints.push(hit);
    }

    return {
      playerPos: { x: px, y: py },
      conePoints: conePoints,
      periphPoints: periphPoints
    };
  }

  // Draw Fog of War over Map Canvas directly in World Coordinates using evenodd rule
  renderFog(ctx, player, visibilityData, activeSmokes = []) {
    if (!visibilityData || !player.isAlive) return;

    ctx.save();

    // 1. World Bounds covering entire viewport and surrounding areas
    const viewW = (ctx.canvas.width || 1920) * 2;
    const viewH = (ctx.canvas.height || 1080) * 2;
    const left = player.x - viewW;
    const top = player.y - viewH;
    const width = viewW * 2;
    const height = viewH * 2;

    ctx.beginPath();
    // Outer bounding rectangle (covers full screen & map)
    ctx.rect(left, top, width, height);

    // Cutout 1: Forward vision cone where player is facing (illuminated area)
    if (visibilityData.conePoints && visibilityData.conePoints.length > 0) {
      ctx.moveTo(visibilityData.playerPos.x, visibilityData.playerPos.y);
      for (let i = 0; i < visibilityData.conePoints.length; i++) {
        ctx.lineTo(visibilityData.conePoints[i].x, visibilityData.conePoints[i].y);
      }
      ctx.closePath();
    }

    // Cutout 2: Immediate body radius (player can see their own character model)
    if (visibilityData.periphPoints && visibilityData.periphPoints.length > 0) {
      ctx.moveTo(visibilityData.periphPoints[0].x, visibilityData.periphPoints[0].y);
      for (let i = 1; i < visibilityData.periphPoints.length; i++) {
        ctx.lineTo(visibilityData.periphPoints[i].x, visibilityData.periphPoints[i].y);
      }
      ctx.closePath();
    }

    // Everything outside the cutouts (backside, behind walls, unlooked areas) is dark fog!
    ctx.fillStyle = 'rgba(6, 9, 15, 0.94)';
    ctx.fill('evenodd');

    // 2. Subtle soft vision illumination edge lines
    if (visibilityData.conePoints && visibilityData.conePoints.length > 1) {
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(visibilityData.playerPos.x, visibilityData.playerPos.y);
      ctx.lineTo(visibilityData.conePoints[0].x, visibilityData.conePoints[0].y);
      ctx.moveTo(visibilityData.playerPos.x, visibilityData.playerPos.y);
      ctx.lineTo(visibilityData.conePoints[visibilityData.conePoints.length - 1].x, visibilityData.conePoints[visibilityData.conePoints.length - 1].y);
      ctx.stroke();
    }

    // 3. Smoke occlusion: Smokes completely black out sight inside them
    for (const smoke of activeSmokes) {
      const grad = ctx.createRadialGradient(smoke.x, smoke.y, 10, smoke.x, smoke.y, smoke.radius);
      grad.addColorStop(0, 'rgba(15, 20, 28, 0.98)');
      grad.addColorStop(0.85, 'rgba(15, 20, 28, 0.95)');
      grad.addColorStop(1, 'rgba(15, 20, 28, 0.85)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(smoke.x, smoke.y, smoke.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // Check if target entity (e.g. enemy player) is directly visible to local player
  isTargetVisible(localPlayer, target, activeSmokes = []) {
    if (!localPlayer.isAlive) return true; // Dead players can spectate
    if (target.team === localPlayer.team) return true; // Teammates always visible to friendly radar

    // Sova Recon Bolt reveal: friendly team can see revealed enemies through walls regardless of facing!
    if (target.reconRevealed && (!target.revealedByTeam || target.revealedByTeam === localPlayer.team)) {
      return true;
    }

    const px = localPlayer.x;
    const py = localPlayer.y;
    const tx = target.x;
    const ty = target.y;

    const d = Math.hypot(tx - px, ty - py);

    // 1. Immediate personal body contact only (cannot see behind backside!)
    const isImmediateContact = d <= (CONSTANTS.PERIPHERAL_RADIUS || 110);

    // 2. Check if within forward vision cone (where player is facing)
    let inCone = false;
    if (d <= (CONSTANTS.VISION_DISTANCE || 2800)) {
      const angleToTarget = Math.atan2(ty - py, tx - px);
      let angleDiff = Math.abs(angleToTarget - localPlayer.angle);
      while (angleDiff > Math.PI) angleDiff = Math.abs(angleDiff - 2 * Math.PI);
      inCone = angleDiff <= (CONSTANTS.FOV_ANGLE / 2);
    }

    // If outside forward vision cone and not touching immediate body -> strictly hidden!
    if (!isImmediateContact && !inCone) return false;

    // 3. Check Wall Occlusion (Raycast from localPlayer to target)
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (this.getLineIntersection(px, py, tx, ty, seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y)) {
        return false; // Wall blocks line of sight
      }
    }

    // 4. Check Smoke Occlusion: does line of sight pass through any active smoke?
    for (const smoke of activeSmokes) {
      // Circle-segment intersection
      const distToSmokeCenter = distToSegment({ x: smoke.x, y: smoke.y }, { x: px, y: py }, { x: tx, y: ty });
      if (distToSmokeCenter < smoke.radius) {
        // Line passes through smoke: only visible if BOTH are inside the same smoke and within point blank distance
        const pInSmoke = Math.hypot(px - smoke.x, py - smoke.y) < smoke.radius;
        const tInSmoke = Math.hypot(tx - smoke.x, ty - smoke.y) < smoke.radius;
        if (!pInSmoke || !tInSmoke || d > 65) {
          return false;
        }
      }
    }

    return true;
  }
}

// Distance point to segment helper
function distToSegment(p, a, b) {
  const l2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

const fogOfWar = new FogOfWar();
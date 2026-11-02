/**
 * High-Performance 2D Quadtree for Spatial Indexing, Fast Collision Culling,
 * and Raycasting. Usable on both Node.js (Server) and Browser (Client).
 */

class AABB {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  contains(point) {
    return (
      point.x >= this.x &&
      point.x <= this.x + this.w &&
      point.y >= this.y &&
      point.y <= this.y + this.h
    );
  }

  intersects(range) {
    return !(
      range.x > this.x + this.w ||
      range.x + range.w < this.x ||
      range.y > this.y + this.h ||
      range.y + range.h < this.y
    );
  }

  intersectsCircle(cx, cy, r) {
    const closestX = Math.max(this.x, Math.min(cx, this.x + this.w));
    const closestY = Math.max(this.y, Math.min(cy, this.y + this.h));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx * dx + dy * dy) <= (r * r);
  }
}

class Quadtree {
  constructor(boundary, capacity = 8, maxDepth = 6, depth = 0) {
    this.boundary = boundary; // AABB
    this.capacity = capacity;
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.items = []; // { x, y, w, h, data }
    this.divided = false;

    this.northwest = null;
    this.northeast = null;
    this.southwest = null;
    this.southeast = null;
  }

  subdivide() {
    const x = this.boundary.x;
    const y = this.boundary.y;
    const halfW = this.boundary.w / 2;
    const halfH = this.boundary.h / 2;

    this.northwest = new Quadtree(new AABB(x, y, halfW, halfH), this.capacity, this.maxDepth, this.depth + 1);
    this.northeast = new Quadtree(new AABB(x + halfW, y, halfW, halfH), this.capacity, this.maxDepth, this.depth + 1);
    this.southwest = new Quadtree(new AABB(x, y + halfH, halfW, halfH), this.capacity, this.maxDepth, this.depth + 1);
    this.southeast = new Quadtree(new AABB(x + halfW, y + halfH, halfW, halfH), this.capacity, this.maxDepth, this.depth + 1);

    this.divided = true;

    // Distribute existing items into children
    const oldItems = this.items;
    this.items = [];
    for (let i = 0; i < oldItems.length; i++) {
      this.insert(oldItems[i]);
    }
  }

  insert(item) {
    // Item should have x, y or x, y, w, h
    const itemW = item.w || 0;
    const itemH = item.h || 0;
    const itemBox = new AABB(item.x, item.y, itemW, itemH);

    if (!this.boundary.intersects(itemBox)) {
      return false;
    }

    if (!this.divided) {
      if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
        this.items.push(item);
        return true;
      }
      this.subdivide();
    }

    let inserted = false;
    if (this.northwest.insert(item)) inserted = true;
    if (this.northeast.insert(item)) inserted = true;
    if (this.southwest.insert(item)) inserted = true;
    if (this.southeast.insert(item)) inserted = true;

    return inserted;
  }

  /**
   * Query all items intersecting with an AABB range
   */
  queryRange(range, found = [], seen = new Set()) {
    if (!this.boundary.intersects(range)) {
      return found;
    }

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const itemW = item.w || 0;
      const itemH = item.h || 0;
      const itemBox = new AABB(item.x, item.y, itemW, itemH);

      if (range.intersects(itemBox)) {
        if (!seen.has(item)) {
          seen.add(item);
          found.push(item);
        }
      }
    }

    if (this.divided) {
      this.northwest.queryRange(range, found, seen);
      this.northeast.queryRange(range, found, seen);
      this.southwest.queryRange(range, found, seen);
      this.southeast.queryRange(range, found, seen);
    }

    return found;
  }

  /**
   * Fast spatial query around a circle (e.g. player proximity, explosions)
   */
  queryCircle(cx, cy, radius, found = [], seen = new Set()) {
    if (!this.boundary.intersectsCircle(cx, cy, radius)) {
      return found;
    }

    const r2 = radius * radius;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      // Check distance to center or item bounds
      const closestX = Math.max(item.x, Math.min(cx, item.x + (item.w || 0)));
      const closestY = Math.max(item.y, Math.min(cy, item.y + (item.h || 0)));
      const dx = cx - closestX;
      const dy = cy - closestY;

      if ((dx * dx + dy * dy) <= r2) {
        if (!seen.has(item)) {
          seen.add(item);
          found.push(item);
        }
      }
    }

    if (this.divided) {
      this.northwest.queryCircle(cx, cy, radius, found, seen);
      this.northeast.queryCircle(cx, cy, radius, found, seen);
      this.southwest.queryCircle(cx, cy, radius, found, seen);
      this.southeast.queryCircle(cx, cy, radius, found, seen);
    }

    return found;
  }

  clear() {
    this.items = [];
    if (this.divided) {
      this.northwest.clear();
      this.northeast.clear();
      this.southwest.clear();
      this.southeast.clear();
      this.northwest = null;
      this.northeast = null;
      this.southwest = null;
      this.southeast = null;
      this.divided = false;
    }
  }
}

// Universal export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AABB, Quadtree };
} else {
  window.AABB = AABB;
  window.Quadtree = Quadtree;
}

// Tactical Map Layout for Valorant-style 2D Top-Down Shooter
// Map Bounds: 2200 x 1600

const MAP_DATA = {
  width: 2200,
  height: 1600,
  name: 'ASCENT 2D',
  
  spawns: {
    attackers: [
      { x: 1000, y: 1450 },
      { x: 1100, y: 1450 },
      { x: 1200, y: 1450 },
      { x: 1050, y: 1510 },
      { x: 1150, y: 1510 },
      { x: 1250, y: 1510 }
    ],
    defenders: [
      { x: 1000, y: 150 },
      { x: 1100, y: 150 },
      { x: 1200, y: 150 },
      { x: 1050, y: 90 },
      { x: 1150, y: 90 },
      { x: 1250, y: 90 }
    ]
  },

  plantSites: [
    {
      id: 'A',
      name: 'Site A',
      x: 1620,
      y: 400,
      w: 220,
      h: 200,
      color: 'rgba(255, 70, 85, 0.25)'
    },
    {
      id: 'B',
      name: 'Site B',
      x: 360,
      y: 400,
      w: 220,
      h: 200,
      color: 'rgba(0, 240, 255, 0.25)'
    }
  ],

  // Bounding boxes of spawn zones to strictly confine players during Buy Phase
  spawnBounds: {
    attackers: { minX: 740, maxX: 1460, minY: 1320, maxY: 1550 },
    defenders: { minX: 690, maxX: 1510, minY: 40, maxY: 235 }
  },

  // Barriers active during Buy Phase - airtight gates sealing the spawn exits
  barriers: [
    // Attacker spawn exit gates
    { id: 'b_att_left', x: 740, y: 1300, w: 140, h: 40, label: 'Attacker Left Gate', team: 'attackers' },
    { id: 'b_att_right', x: 1320, y: 1300, w: 140, h: 40, label: 'Attacker Right Gate', team: 'attackers' },
    // Defender spawn exit gates
    { id: 'b_def_left', x: 690, y: 240, w: 110, h: 40, label: 'Defender Left Gate', team: 'defenders' },
    { id: 'b_def_right', x: 1400, y: 240, w: 110, h: 40, label: 'Defender Right Gate', team: 'defenders' }
  ],

  // Solid walls & tactical crates (AABBs)
  walls: [
    // Outer Border Walls
    { x: 0, y: 0, w: 2200, h: 40 }, // top
    { x: 0, y: 1560, w: 2200, h: 40 }, // bottom
    { x: 0, y: 0, w: 40, h: 1600 }, // left
    { x: 2160, y: 0, w: 40, h: 1600 }, // right

    // === DEFENDER SPAWN & HEAVEN CORRIDORS ===
    { x: 650, y: 40, w: 40, h: 240 },
    { x: 1510, y: 40, w: 40, h: 240 },
    { x: 800, y: 240, w: 600, h: 40 }, // Defender spawn back wall

    // === SITE B REGION (Left Side) ===
    // B Outer corridor & B Long
    { x: 240, y: 240, w: 40, h: 600 }, // B Long left wall
    { x: 240, y: 240, w: 450, h: 40 }, // B Top wall
    { x: 650, y: 280, w: 40, h: 200 }, // B Heaven wall
    // B Site interior cover
    { x: 420, y: 460, w: 70, h: 70, type: 'crate' }, // Green rad crate
    { x: 510, y: 460, w: 50, h: 70, type: 'crate' },
    { x: 380, y: 320, w: 90, h: 40, type: 'crate' },
    // B Main / Chokepoint & Hookah
    { x: 240, y: 840, w: 260, h: 40 },
    { x: 580, y: 720, w: 140, h: 40 },
    { x: 580, y: 760, w: 40, h: 260 },
    { x: 400, y: 960, w: 180, h: 40 }, // B Connector

    // === MID COURTYARD & MARKET ===
    // Mid Courtyard walls
    { x: 860, y: 400, w: 40, h: 320 }, // Mid left wall
    { x: 1300, y: 400, w: 40, h: 320 }, // Mid right wall
    // Mid Arch & Center cover
    { x: 1040, y: 760, w: 120, h: 70, type: 'crate' }, // Mid Pizza box cover
    { x: 860, y: 880, w: 120, h: 40 }, // Mid to B connector
    { x: 1220, y: 880, w: 120, h: 40 }, // Mid to A connector
    // Mid Link chokepoints
    { x: 740, y: 1100, w: 240, h: 40 },
    { x: 1220, y: 1100, w: 240, h: 40 },

    // === SITE A REGION (Right Side) ===
    // A Outer corridor & A Long
    { x: 1920, y: 240, w: 40, h: 600 }, // A Long right wall
    { x: 1510, y: 240, w: 450, h: 40 }, // A Top wall
    { x: 1510, y: 280, w: 40, h: 200 }, // A Heaven wall
    // A Site interior cover & Radianite boxes
    { x: 1680, y: 460, w: 80, h: 80, type: 'crate' }, // Radianite stack A
    { x: 1780, y: 340, w: 60, h: 60, type: 'crate' }, // Default plant cover
    // A Main & A Short
    { x: 1700, y: 840, w: 260, h: 40 },
    { x: 1480, y: 720, w: 140, h: 40 },
    { x: 1580, y: 760, w: 40, h: 260 },
    { x: 1620, y: 960, w: 180, h: 40 },

    // === ATTACKER SPAWN & LOBBY ===
    { x: 700, y: 1300, w: 40, h: 260 },
    { x: 1460, y: 1300, w: 40, h: 260 },
    { x: 880, y: 1300, w: 440, h: 40 }
  ],

  // Callout labels for mini-map and HUD
  callouts: [
    { text: 'DEFENDER SPAWN', x: 1100, y: 120 },
    { text: 'A HEAVEN', x: 1600, y: 310 },
    { text: 'A SITE', x: 1730, y: 500 },
    { text: 'A MAIN', x: 1850, y: 950 },
    { text: 'B HEAVEN', x: 600, y: 310 },
    { text: 'B SITE', x: 470, y: 500 },
    { text: 'B MAIN', x: 330, y: 950 },
    { text: 'MID COURTYARD', x: 1100, y: 680 },
    { text: 'MID BOTTOM', x: 1100, y: 1000 },
    { text: 'ATTACKER SPAWN', x: 1100, y: 1480 }
  ]
};

// Generate segment lines for raycasting
function getWallSegments(includeBarriers = false) {
  const segments = [];
  const allWalls = [...MAP_DATA.walls];
  
  if (includeBarriers) {
    allWalls.push(...MAP_DATA.barriers);
  }

  for (const wall of allWalls) {
    // 4 edges per rectangle
    segments.push({ p1: { x: wall.x, y: wall.y }, p2: { x: wall.x + wall.w, y: wall.y } });
    segments.push({ p1: { x: wall.x + wall.w, y: wall.y }, p2: { x: wall.x + wall.w, y: wall.y + wall.h } });
    segments.push({ p1: { x: wall.x + wall.w, y: wall.y + wall.h }, p2: { x: wall.x, y: wall.y + wall.h } });
    segments.push({ p1: { x: wall.x, y: wall.y + wall.h }, p2: { x: wall.x, y: wall.y } });
  }

  return segments;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAP_DATA,
    getWallSegments
  };
}

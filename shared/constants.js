// Shared Game Constants for Tactical 2D Shooter
const CONSTANTS = {
  CANVAS_WIDTH: 1280,
  CANVAS_HEIGHT: 720,
  MAP_WIDTH: 2200,
  MAP_HEIGHT: 1600,
  TICK_RATE: 64, // 64Hz fixed physics/network tick rate
  
  PLAYER_RADIUS: 18,
  BASE_SPEED: 210, // px per sec
  SHIFT_SPEED: 120, // silent walk
  CROUCH_SPEED: 95,
  
  FOV_ANGLE: 130 * (Math.PI / 180), // 130 degrees forward field of view (full forward tactical cone)
  PERIPHERAL_RADIUS: 110, // clear immediate tactical awareness radius around player (no suffocating darkness)
  VISION_DISTANCE: 2800, // long-range naked eye vision across entire viewport/map until walls block
  
  BUY_PHASE_TIME: 15, // seconds
  ROUND_TIME: 100, // seconds
  SPIKE_PLANT_TIME: 4.0, // seconds
  SPIKE_DEFUSE_TIME: 7.0, // seconds
  SPIKE_DETONATE_TIME: 45, // seconds
  ROUND_END_DELAY: 5, // seconds before next round
  ROUNDS_TO_WIN: 5,
  FIRST_HALF_ROUNDS: 4, // 1st half is 4 rounds, then teams swap sides
  
  STARTING_CREDITS: 800,
  WIN_CREDITS: 3000,
  LOSS_CREDITS: 1900,
  KILL_CREDITS: 200,
  MAX_CREDITS: 9000,

  WEAPONS: {
    knife: {
      name: 'Tactical Knife',
      slot: 'melee',
      cost: 0,
      damage: { head: 75, body: 50, leg: 40 },
      fireRate: 2.0, // attacks per second
      range: 55,
      magSize: 0,
      reserve: 0,
      reloadTime: 0,
      spread: 0,
      moveSpreadPenalty: 0,
      automatic: false
    },
    classic: {
      name: 'Classic',
      slot: 'secondary',
      cost: 0,
      damage: { head: 78, body: 26, leg: 22 },
      fireRate: 4.0, // shots per sec
      range: 900,
      magSize: 12,
      reserve: 36,
      reloadTime: 1.5,
      spread: 0.02,
      moveSpreadPenalty: 0.08,
      automatic: false
    },
    ghost: {
      name: 'Ghost',
      slot: 'secondary',
      cost: 500,
      damage: { head: 105, body: 30, leg: 25 },
      fireRate: 5.5,
      range: 1000,
      magSize: 15,
      reserve: 45,
      reloadTime: 1.5,
      spread: 0.015,
      moveSpreadPenalty: 0.07,
      automatic: false,
      silenced: true
    },
    spectre: {
      name: 'Spectre',
      slot: 'primary',
      cost: 1600,
      damage: { head: 78, body: 26, leg: 22 },
      fireRate: 13.3,
      range: 850,
      magSize: 30,
      reserve: 90,
      reloadTime: 2.2,
      spread: 0.04,
      moveSpreadPenalty: 0.09,
      automatic: true,
      silenced: true
    },
    vandal: {
      name: 'Vandal',
      slot: 'primary',
      cost: 2900,
      damage: { head: 160, body: 40, leg: 34 }, // 1-tap headshot
      fireRate: 9.75,
      range: 1200,
      magSize: 25,
      reserve: 75,
      reloadTime: 2.5,
      spread: 0.018,
      moveSpreadPenalty: 0.16,
      automatic: true
    },
    phantom: {
      name: 'Phantom',
      slot: 'primary',
      cost: 2900,
      damage: { head: 156, body: 39, leg: 33 },
      fireRate: 11.0,
      range: 1050,
      magSize: 30,
      reserve: 90,
      reloadTime: 2.5,
      spread: 0.016,
      moveSpreadPenalty: 0.14,
      automatic: true,
      silenced: true
    },
    operator: {
      name: 'Operator',
      slot: 'primary',
      cost: 4700,
      damage: { head: 255, body: 150, leg: 120 }, // 1-shot body/head
      fireRate: 0.75,
      range: 1500,
      magSize: 5,
      reserve: 15,
      reloadTime: 3.5,
      spread: 0.005,
      moveSpreadPenalty: 0.35,
      automatic: false,
      isSniper: true
    }
  },

  ARMOR: {
    light: { name: 'Light Shields', cost: 400, armor: 25 },
    heavy: { name: 'Heavy Shields', cost: 1000, armor: 50 }
  },

  AGENTS: {
    omen: {
      id: 'omen',
      name: 'Shadow (Omen)',
      role: 'Controller',
      description: 'Master of shadows who blocks enemy vision with long-lasting dark smokes and blinds enemies.',
      color: '#7b5eea',
      abilities: {
        ability1: {
          id: 'dark_cover',
          name: 'Dark Cover',
          key: 'Q',
          cost: 150,
          maxCharges: 2,
          type: 'smoke',
          radius: 110,
          duration: 14.0, // seconds
          description: 'Hollow vision-blocking smoke sphere placed at target location.'
        },
        ability2: {
          id: 'paranoia',
          name: 'Paranoia',
          key: 'E',
          cost: 250,
          maxCharges: 1,
          type: 'projectile_blind',
          duration: 2.5,
          speed: 480,
          range: 650,
          description: 'Fires a shadow beam straight ahead through walls, blinding and deafening caught enemies.'
        }
      }
    },
    phoenix: {
      id: 'phoenix',
      name: 'Blaze (Phoenix)',
      role: 'Duelist',
      color: '#ff6934',
      description: 'Fiery duelist with a pop flash flare and a damaging fire molotov pool.',
      abilities: {
        ability1: {
          id: 'curveball',
          name: 'Curveball',
          key: 'Q',
          cost: 250,
          maxCharges: 2,
          type: 'flash',
          detonationDelay: 0.6, // seconds
          duration: 2.3, // blind duration
          description: 'Throws a curving flare around corners that detonates with blinding light.'
        },
        ability2: {
          id: 'hot_hands',
          name: 'Hot Hands',
          key: 'E',
          cost: 200,
          maxCharges: 1,
          type: 'molotov',
          duration: 6.0,
          dps: 45,
          radius: 85,
          description: 'Throws a fireball that explodes into a lingering damaging fire zone.'
        }
      }
    },
    jett: {
      id: 'jett',
      name: 'Specter (Jett)',
      role: 'Duelist',
      color: '#00f0ff',
      description: 'Agile skirmisher with instantaneous burst dash and quick cloudburst smokes.',
      abilities: {
        ability1: {
          id: 'cloudburst',
          name: 'Cloudburst',
          key: 'Q',
          cost: 150,
          maxCharges: 2,
          type: 'smoke',
          radius: 85,
          duration: 7.0,
          description: 'Fast-deploying cloud of fog that instantly obscures sight lines.'
        },
        ability2: {
          id: 'tailwind',
          name: 'Tailwind (Dash)',
          key: 'E',
          cost: 200,
          maxCharges: 1,
          type: 'dash',
          dashSpeed: 820,
          dashDuration: 0.22,
          description: 'Instantly propels player in their moving direction with burst speed.'
        }
      }
    },
    sova: {
      id: 'sova',
      name: 'Hunter (Sova)',
      role: 'Initiator',
      color: '#3498db',
      description: 'Tactical archer who reveals enemy positions with a radar recon bolt.',
      abilities: {
        ability1: {
          id: 'recon_bolt',
          name: 'Recon Bolt',
          key: 'Q',
          cost: 200,
          maxCharges: 1,
          type: 'recon',
          pulses: 2,
          pulseInterval: 1.0,
          revealDuration: 3.5, // 3-4 seconds enemy wallhack highlight
          radius: 520,
          speed: 950,
          description: 'Fires a crackling lightning sonar arrow that sticks to surface and emits 2 navy sonar wave pulses with a 1-second delay.'
        },
        ability2: {
          id: 'shock_dart',
          name: 'Shock Bolt',
          key: 'E',
          cost: 200,
          maxCharges: 2,
          type: 'shock',
          damage: 75,
          radius: 110,
          speed: 950,
          description: 'Fires an electric shock arrow surrounded by crackling lightning that bursts into electricity on impact.'
        }
      }
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONSTANTS;
}

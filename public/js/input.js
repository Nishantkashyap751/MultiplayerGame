// Keyboard & Mouse Input Manager for Tactical 2D Shooter with Custom Keybinds

const DEFAULT_KEYBINDS = {
  moveUp: { label: 'Move Forward', key: 'w', display: 'W' },
  moveDown: { label: 'Move Backward', key: 's', display: 'S' },
  moveLeft: { label: 'Move Left', key: 'a', display: 'A' },
  moveRight: { label: 'Move Right', key: 'd', display: 'D' },
  shiftWalk: { label: 'Silent Walk', key: 'shift', display: 'SHIFT' },
  crouch: { label: 'Crouch (Accuracy)', key: 'control', display: 'CTRL' },
  slotPrimary: { label: 'Equip Primary', key: '1', display: '1' },
  slotSecondary: { label: 'Equip Secondary', key: '2', display: '2' },
  slotMelee: { label: 'Equip Knife', key: '3', display: '3' },
  spikeAction: { label: 'Plant / Defuse Spike', key: '4', display: '4' },
  reload: { label: 'Reload Gun', key: 'r', display: 'R' },
  openShop: { label: 'Arsenal / Shop', key: 'b', display: 'B' },
  ability1: { label: 'Agent Ability 1', key: 'q', display: 'Q' },
  ability2: { label: 'Agent Ability 2', key: 'e', display: 'E' },
  scoreboard: { label: 'Scoreboard', key: 'tab', display: 'TAB' }
};

class InputManager {
  constructor() {
    this.keybinds = this.loadKeybinds();
    this.activeRebindAction = null; // action name if currently awaiting key press

    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false,
      shift: false,
      crouch: false
    };

    this.mouse = {
      screenX: window.innerWidth / 2,
      screenY: window.innerHeight / 2,
      worldX: 1100,
      worldY: 1400,
      leftDown: false,
      rightDown: false
    };

    this.spikeHolding = false;
    this.scoreboardOpen = false;

    // Callbacks hooked by main coordinator
    this.onFire = null;
    this.onReload = null;
    this.onSwitchSlot = null;
    this.onUseAbility = null;
    this.onToggleShop = null;
    this.onSpikeActionStart = null;
    this.onSpikeActionStop = null;
    this.onInputChanged = null;
    this.onKeybindsChanged = null;

    this.setupListeners();
  }

  loadKeybinds() {
    try {
      const saved = localStorage.getItem('tactical_keybinds_v2');
      if (saved) {
        return { ...DEFAULT_KEYBINDS, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load keybinds from localStorage', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_KEYBINDS));
  }

  saveKeybinds() {
    try {
      localStorage.setItem('tactical_keybinds_v2', JSON.stringify(this.keybinds));
    } catch (e) {
      console.warn('Failed to save keybinds to localStorage', e);
    }
    if (this.onKeybindsChanged) {
      this.onKeybindsChanged(this.keybinds);
    }
  }

  resetKeybinds() {
    this.keybinds = JSON.parse(JSON.stringify(DEFAULT_KEYBINDS));
    this.saveKeybinds();
  }

  rebindKey(action, key, display) {
    if (this.keybinds[action]) {
      this.keybinds[action].key = key.toLowerCase();
      this.keybinds[action].display = display.toUpperCase();
      this.saveKeybinds();
    }
  }

  // Format key for human-readable display
  formatKeyDisplay(e) {
    if (e.code === 'Space' || e.key === ' ') return 'SPACE';
    if (e.key === 'Control') return 'CTRL';
    if (e.key === 'Shift') return 'SHIFT';
    if (e.key === 'Alt') return 'ALT';
    if (e.key === 'Tab') return 'TAB';
    if (e.key === 'ArrowUp') return 'UP';
    if (e.key === 'ArrowDown') return 'DOWN';
    if (e.key === 'ArrowLeft') return 'LEFT';
    if (e.key === 'ArrowRight') return 'RIGHT';
    if (e.key.length === 1) return e.key.toUpperCase();
    return e.key.toUpperCase();
  }

  // Helper: check if keyboard event matches an action's bound key
  matchesKey(e, action) {
    const bound = this.keybinds[action];
    if (!bound) return false;
    const targetKey = bound.key.toLowerCase();
    const pressedKey = e.key.toLowerCase();

    if (targetKey === 'shift') return e.shiftKey || pressedKey === 'shift';
    if (targetKey === 'control' || targetKey === 'ctrl') return e.ctrlKey || pressedKey === 'control';
    if (targetKey === 'alt') return e.altKey || pressedKey === 'alt';
    if (targetKey === 'tab') return pressedKey === 'tab';

    return pressedKey === targetKey;
  }

  setupListeners() {
    // 1. Mouse movement
    window.addEventListener('mousemove', (e) => {
      this.mouse.screenX = e.clientX;
      this.mouse.screenY = e.clientY;
    });

    // 2. Mouse buttons (Shooting / Knife)
    window.addEventListener('mousedown', (e) => {
      // Don't capture when clicking inside UI modals or buttons
      if (e.target.closest('.modal-overlay') || e.target.closest('.panel') || e.target.closest('button') || e.target.closest('input')) {
        return;
      }

      if (e.button === 0) {
        this.mouse.leftDown = true;
        if (this.onFire) this.onFire(true);
      } else if (e.button === 2) {
        this.mouse.rightDown = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.leftDown = false;
        if (this.onFire) this.onFire(false);
      } else if (e.button === 2) {
        this.mouse.rightDown = false;
      }
    });

    // Prevent default context menu on right click in game
    window.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('input')) {
        e.preventDefault();
      }
    });

    // 3. Keyboard Down
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;

      // Check if user is currently rebinding a keybind
      if (this.activeRebindAction) {
        e.preventDefault();
        e.stopPropagation();
        const display = this.formatKeyDisplay(e);
        this.rebindKey(this.activeRebindAction, e.key.toLowerCase(), display);
        this.activeRebindAction = null;
        if (ui && ui.renderKeybindsList) {
          ui.renderKeybindsList();
        }
        return;
      }

      let stateChanged = false;

      // Movement
      if (this.matchesKey(e, 'moveUp') || e.key === 'ArrowUp') {
        if (!this.keys.up) stateChanged = true;
        this.keys.up = true;
      }
      if (this.matchesKey(e, 'moveDown') || e.key === 'ArrowDown') {
        if (!this.keys.down) stateChanged = true;
        this.keys.down = true;
      }
      if (this.matchesKey(e, 'moveLeft') || e.key === 'ArrowLeft') {
        if (!this.keys.left) stateChanged = true;
        this.keys.left = true;
      }
      if (this.matchesKey(e, 'moveRight') || e.key === 'ArrowRight') {
        if (!this.keys.right) stateChanged = true;
        this.keys.right = true;
      }

      // Silent Walk & Crouch
      if (this.matchesKey(e, 'shiftWalk') || e.shiftKey) {
        if (!this.keys.shift) stateChanged = true;
        this.keys.shift = true;
      }
      if (this.matchesKey(e, 'crouch') || e.ctrlKey) {
        if (!this.keys.crouch) stateChanged = true;
        this.keys.crouch = true;
      }

      if (stateChanged && this.onInputChanged) {
        this.onInputChanged();
      }

      // Weapon Slots
      if (this.matchesKey(e, 'slotPrimary') && this.onSwitchSlot) this.onSwitchSlot('primary');
      if (this.matchesKey(e, 'slotSecondary') && this.onSwitchSlot) this.onSwitchSlot('secondary');
      if (this.matchesKey(e, 'slotMelee') && this.onSwitchSlot) this.onSwitchSlot('melee');

      // Spike Plant & Defuse (Both bound to spikeAction - Key 4 by default)
      if (this.matchesKey(e, 'spikeAction')) {
        if (!this.spikeHolding) {
          this.spikeHolding = true;
          // Main coordinator determines whether to plant or defuse based on team & spike proximity
          if (this.onSpikeActionStart) {
            this.onSpikeActionStart('auto');
          }
        }
      }

      // Reload Gun (Guns only, knifes cannot reload)
      if (this.matchesKey(e, 'reload') && this.onReload) {
        this.onReload();
      }

      // Buy Phase Shop
      if (this.matchesKey(e, 'openShop') && this.onToggleShop) {
        this.onToggleShop();
      }

      // Agent Abilities (Ability 1 and Ability 2)
      if (this.matchesKey(e, 'ability1') && this.onUseAbility) this.onUseAbility('ability1');
      if (this.matchesKey(e, 'ability2') && this.onUseAbility) this.onUseAbility('ability2');

      // Scoreboard (Tab)
      if (this.matchesKey(e, 'scoreboard')) {
        e.preventDefault();
        this.scoreboardOpen = true;
        const sb = document.getElementById('modal-scoreboard');
        if (sb) sb.classList.remove('hidden');
      }
    });

    // 4. Keyboard Up
    window.addEventListener('keyup', (e) => {
      if (e.target.tagName === 'INPUT') return;

      let stateChanged = false;

      if (this.matchesKey(e, 'moveUp') || e.key === 'ArrowUp') {
        this.keys.up = false;
        stateChanged = true;
      }
      if (this.matchesKey(e, 'moveDown') || e.key === 'ArrowDown') {
        this.keys.down = false;
        stateChanged = true;
      }
      if (this.matchesKey(e, 'moveLeft') || e.key === 'ArrowLeft') {
        this.keys.left = false;
        stateChanged = true;
      }
      if (this.matchesKey(e, 'moveRight') || e.key === 'ArrowRight') {
        this.keys.right = false;
        stateChanged = true;
      }

      if (this.matchesKey(e, 'shiftWalk') || !e.shiftKey) {
        this.keys.shift = false;
        stateChanged = true;
      }
      if (this.matchesKey(e, 'crouch') || !e.ctrlKey) {
        this.keys.crouch = false;
        stateChanged = true;
      }

      if (stateChanged && this.onInputChanged) {
        this.onInputChanged();
      }

      // Release Spike Action (Plant or Defuse)
      if (this.matchesKey(e, 'spikeAction')) {
        if (this.spikeHolding) {
          this.spikeHolding = false;
          if (this.onSpikeActionStop) this.onSpikeActionStop();
        }
      }

      // Scoreboard (Tab)
      if (this.matchesKey(e, 'scoreboard')) {
        this.scoreboardOpen = false;
        const sb = document.getElementById('modal-scoreboard');
        if (sb) sb.classList.add('hidden');
      }
    });
  }

  // Calculate aim angle from local player to mouse in world space
  getAimAngle(player) {
    if (!player) return 0;
    return Math.atan2(this.mouse.worldY - player.y, this.mouse.worldX - player.x);
  }
}

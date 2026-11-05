// UI Controller & HUD Manager for Tactical 2D Shooter with Custom Keybinds & Menu

class UIManager {
  constructor() {
    // Screen Elements
    this.screenLobby = document.getElementById('screen-lobby');
    this.screenGame = document.getElementById('screen-game');
    this.panelEntry = document.getElementById('panel-entry');
    this.panelRoom = document.getElementById('panel-room');
    this.panelPublicLobbies = document.getElementById('panel-public-lobbies');
    this.publicRoomsList = document.getElementById('public-rooms-list');
    this.btnRefreshLobbies = document.getElementById('btn-refresh-lobbies');
    this.boxQuickTips = document.getElementById('box-quick-tips');
    this.boxPenaltyWarning = document.getElementById('box-penalty-warning');
    
    // Lobby UI Elements
    this.inputPlayerName = document.getElementById('input-player-name');
    this.inputRoomCode = document.getElementById('input-room-code');
    this.btnCreateRoom = document.getElementById('btn-create-room');
    this.btnJoinRoom = document.getElementById('btn-join-room');
    this.displayRoomCode = document.getElementById('display-room-code');
    this.btnAddBot = document.getElementById('btn-add-bot');
    this.btnStartMatch = document.getElementById('btn-start-match');
    this.btnRoomBack = document.getElementById('btn-room-back');
    this.btnJoinAttackers = document.getElementById('btn-join-attackers');
    this.btnJoinDefenders = document.getElementById('btn-join-defenders');
    this.agentCardsContainer = document.getElementById('agent-cards-container');
    this.rosterAttackers = document.getElementById('roster-attackers');
    this.rosterDefenders = document.getElementById('roster-defenders');

    // In-game HUD Elements
    this.hudScoreAtt = document.getElementById('hud-score-att');
    this.hudScoreDef = document.getElementById('hud-score-def');
    this.hudPhaseLabel = document.getElementById('hud-phase-label');
    this.hudTimerDisplay = document.getElementById('hud-timer-display');
    this.hudSpikeStatus = document.getElementById('hud-spike-status');
    this.hudSpikeText = document.getElementById('hud-spike-text');
    this.hudHpVal = document.getElementById('hud-hp-val');
    this.hudHpBar = document.getElementById('hud-hp-bar');
    this.hudArmorVal = document.getElementById('hud-armor-val');
    this.hudArmorBar = document.getElementById('hud-armor-bar');
    this.hudAmmoCur = document.getElementById('hud-ammo-cur');
    this.hudAmmoRes = document.getElementById('hud-ammo-res');
    this.hudReloadTag = document.getElementById('hud-reload-tag');
    this.hudAbilitiesContainer = document.getElementById('hud-abilities-container');
    this.currentCallout = document.getElementById('current-callout');
    this.killFeed = document.getElementById('kill-feed');

    // Announcements & Interactions
    this.centerAnnouncement = document.getElementById('center-announcement');
    this.announcementTitle = document.getElementById('announcement-title');
    this.announcementSubtitle = document.getElementById('announcement-subtitle');
    this.btnReturnLobbyAnnouncement = document.getElementById('btn-return-lobby-announcement');
    this.interactionPrompt = document.getElementById('interaction-prompt');
    this.interactionProgressCircle = document.getElementById('interaction-progress-circle');
    this.interactionKeyBadge = document.getElementById('interaction-key-badge');
    this.interactionLabel = document.getElementById('interaction-label');
    this.buyPhaseBanner = document.getElementById('buy-phase-banner');
    this.buyCreditsDisplay = document.getElementById('buy-credits-display');

    // Flash & Blind Overlays
    this.flashOverlay = document.getElementById('flash-overlay');
    this.nearSightOverlay = document.getElementById('near-sight-overlay');

    // Top Right Menu & Settings
    this.btnHamburger = document.getElementById('btn-hamburger');
    this.dropdownMenu = document.getElementById('dropdown-menu');
    this.btnCareerHeader = document.getElementById('btn-career-header');
    this.menuOptSettings = document.getElementById('menu-opt-settings');
    this.menuOptLeave = document.getElementById('menu-opt-leave');
    this.modalSettings = document.getElementById('modal-settings');
    this.btnCloseSettings = document.getElementById('btn-close-settings');
    this.btnSaveKeybinds = document.getElementById('btn-save-keybinds');
    this.btnResetKeybinds = document.getElementById('btn-reset-keybinds');
    this.keybindsList = document.getElementById('keybinds-list');

    // Career Modal
    this.modalCareer = document.getElementById('modal-career');
    this.btnCloseCareer = document.getElementById('btn-close-career');
    this.careerStatsSummary = document.getElementById('career-stats-summary');
    this.careerHistoryList = document.getElementById('career-history-list');

    // Modals
    this.modalShop = document.getElementById('modal-shop');
    this.btnCloseShop = document.getElementById('btn-close-shop');
    this.shopTimer = document.getElementById('shop-timer');
    this.shopCurrentCredits = document.getElementById('shop-current-credits');
    this.shopSidearms = document.getElementById('shop-sidearms');
    this.shopPrimaries = document.getElementById('shop-primaries');
    this.shopUtilities = document.getElementById('shop-utilities');

    // Scoreboard
    this.modalScoreboard = document.getElementById('modal-scoreboard');
    this.sbScoreAtt = document.getElementById('sb-score-att');
    this.sbScoreDef = document.getElementById('sb-score-def');
    this.sbBodyAttackers = document.getElementById('sb-body-attackers');
    this.sbBodyDefenders = document.getElementById('sb-body-defenders');

    // Leaver Warning & Penalty Elements
    this.modalLeaverWarning = document.getElementById('modal-leaver-warning');
    this.warningPenaltyDuration = document.getElementById('warning-penalty-duration');
    this.warningPenaltyDesc = document.getElementById('warning-penalty-desc');
    this.btnCancelLeave = document.getElementById('btn-cancel-leave');
    this.btnConfirmLeave = document.getElementById('btn-confirm-leave');
    this.penaltyBannerEntry = document.getElementById('penalty-banner-entry');
    this.penaltyCountdownEntry = document.getElementById('penalty-countdown-entry');
    this.leaderPenaltyBanner = document.getElementById('leader-penalty-banner');
    this.leaderPenaltyTimer = document.getElementById('leader-penalty-timer');

    // Callbacks
    this.onSelectAgent = null;
    this.onSwitchTeam = null;
    this.onBuyItem = null;
    this.onLeaveRoom = null;
    this.onLeaveMatch = null;
    this.onSwitchBotTeam = null;
    this.onRemoveBot = null;
    this.onConfirmAbandon = null;

    this.selectedAgent = 'omen';
    this.initLobbyAgents();
    this.initShopCatalog();
    this.setupListeners();

    // Check penalty state on load and start 1-sec countdown interval
    this.checkPenaltyState();
    setInterval(() => this.checkPenaltyState(), 1000);
  }

  setupListeners() {
    // Shop close button
    if (this.btnCloseShop) {
      this.btnCloseShop.addEventListener('click', () => {
        this.modalShop.classList.add('hidden');
      });
    }

    // Leave room back button in lobby room dashboard
    if (this.btnRoomBack) {
      this.btnRoomBack.addEventListener('click', () => {
        if (this.onLeaveRoom) this.onLeaveRoom();
      });
    }

    // Switch teams buttons in lobby
    if (this.btnJoinAttackers) {
      this.btnJoinAttackers.addEventListener('click', () => {
        if (this.onSwitchTeam) this.onSwitchTeam('attackers');
      });
    }
    if (this.btnJoinDefenders) {
      this.btnJoinDefenders.addEventListener('click', () => {
        if (this.onSwitchTeam) this.onSwitchTeam('defenders');
      });
    }

    // Refresh Public Lobbies
    if (this.btnRefreshLobbies) {
      this.btnRefreshLobbies.addEventListener('click', () => {
        if (window.network) window.network.requestPublicRooms();
      });
    }

    // Top right Hamburger Menu toggle
    if (this.btnHamburger) {
      this.btnHamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dropdownMenu.classList.toggle('hidden');
      });
      // Prevent long-press context menu when tapping and holding
      this.btnHamburger.addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });
    }

    // Close dropdown when clicking anywhere outside
    window.addEventListener('click', (e) => {
      if (this.dropdownMenu && !this.dropdownMenu.contains(e.target) && e.target !== this.btnHamburger) {
        this.dropdownMenu.classList.add('hidden');
      }
    });

    // Settings option click
    if (this.menuOptSettings) {
      this.menuOptSettings.addEventListener('click', () => {
        this.dropdownMenu.classList.add('hidden');
        this.openSettings();
      });
    }

    // Return to dashboard option click — check if in active match first
    if (this.menuOptLeave) {
      this.menuOptLeave.addEventListener('click', () => {
        this.dropdownMenu.classList.add('hidden');
        // If we are in an active match, show leaver warning modal
        if (window.network && window.network.latestState &&
            ['buyPhase', 'inRound', 'roundOver'].includes(window.network.latestState.state)) {
          this.openLeaverWarning(window.network.latestState);
        } else {
          if (this.onLeaveMatch) this.onLeaveMatch();
        }
      });
    }

    // Leaver warning: cancel (stay in match)
    if (this.btnCancelLeave) {
      this.btnCancelLeave.addEventListener('click', () => {
        this.modalLeaverWarning.classList.add('hidden');
      });
    }

    // Leaver warning: confirm abandon
    if (this.btnConfirmLeave) {
      this.btnConfirmLeave.addEventListener('click', () => {
        this.modalLeaverWarning.classList.add('hidden');
        if (this.onConfirmAbandon) this.onConfirmAbandon();
      });
    }

    // Return to squad room lobby from match end announcement
    if (this.btnReturnLobbyAnnouncement) {
      this.btnReturnLobbyAnnouncement.addEventListener('click', () => {
        this.centerAnnouncement.classList.add('hidden');
        this.showLobbyScreen();
        if (window.network && window.network.latestState) {
          this.updateLobbyRoom(window.network.latestState, window.network.playerId);
        }
      });
    }

    // Career Modal - header button
    if (this.btnCareerHeader) {
      this.btnCareerHeader.addEventListener('click', () => {
        this.showCareerModal();
      });
    }
    if (this.btnCloseCareer) {
      this.btnCloseCareer.addEventListener('click', () => {
        this.modalCareer.classList.add('hidden');
      });
    }

    // Settings Modal close & save
    if (this.btnCloseSettings) {
      this.btnCloseSettings.addEventListener('click', () => {
        this.modalSettings.classList.add('hidden');
        if (input) input.activeRebindAction = null;
      });
    }
    if (this.btnSaveKeybinds) {
      this.btnSaveKeybinds.addEventListener('click', () => {
        this.modalSettings.classList.add('hidden');
        if (input) input.activeRebindAction = null;
      });
    }

    // Reset keybinds to defaults
    if (this.btnResetKeybinds) {
      this.btnResetKeybinds.addEventListener('click', () => {
        if (input) {
          input.resetKeybinds();
          this.renderKeybindsList();
        }
      });
    }
  }

  // Show the leaver penalty warning modal, with dynamic penalty text
  openLeaverWarning(gameState) {
    const round = gameState ? gameState.roundNumber : 1;
    let penaltyMins = 10;
    let desc = 'Leaving right after the match started carries the maximum penalty.';

    if (round <= 1) {
      penaltyMins = 10;
      desc = 'You just joined — leaving this early carries the maximum penalty.';
    } else if (round <= 3) {
      penaltyMins = 7;
      desc = 'Leaving mid-match carries a 7-minute matchmaking penalty.';
    } else {
      penaltyMins = 4;
      desc = 'Leaving late in the match carries a reduced 4-minute penalty.';
    }

    if (this.warningPenaltyDuration) {
      this.warningPenaltyDuration.innerText = `${penaltyMins} MINUTES`;
    }
    if (this.warningPenaltyDesc) {
      this.warningPenaltyDesc.innerText =
        `${desc} You will NOT be able to create a new room for ${penaltyMins} minutes. ` +
        `You can still join a friend's game via room code.`;
    }

    this.modalLeaverWarning.classList.remove('hidden');
  }

  // Check local penalty state and update CREATE ROOM button + swap quick tips with red penalty box
  checkPenaltyState() {
    const raw = localStorage.getItem('tactical_penalty_until');
    if (!raw) {
      // No penalty — ensure create room is enabled and tactical controls visible
      if (this.btnCreateRoom) this.btnCreateRoom.disabled = false;
      if (this.boxQuickTips) this.boxQuickTips.classList.remove('hidden');
      if (this.boxPenaltyWarning) this.boxPenaltyWarning.classList.add('hidden');
      return;
    }

    const penaltyUntil = parseInt(raw, 10);
    const now = Date.now();
    if (penaltyUntil <= now) {
      // Expired
      localStorage.removeItem('tactical_penalty_until');
      if (this.btnCreateRoom) this.btnCreateRoom.disabled = false;
      if (this.boxQuickTips) this.boxQuickTips.classList.remove('hidden');
      if (this.boxPenaltyWarning) this.boxPenaltyWarning.classList.add('hidden');
      return;
    }

    // Still penalized: Disable create room, hide tactical controls, and show red penalty box in place
    if (this.btnCreateRoom) this.btnCreateRoom.disabled = true;
    if (this.boxQuickTips) this.boxQuickTips.classList.add('hidden');
    if (this.boxPenaltyWarning) this.boxPenaltyWarning.classList.remove('hidden');

    const remainMs = penaltyUntil - now;
    const totalSec = Math.ceil(remainMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    if (this.penaltyCountdownEntry) {
      this.penaltyCountdownEntry.innerText = `${mm}:${ss}`;
    }
  }

  // Open & Render Keybinds Settings Modal
  openSettings() {
    this.modalSettings.classList.remove('hidden');
    this.renderKeybindsList();
  }

  renderKeybindsList() {
    if (!this.keybindsList || !input) return;
    this.keybindsList.innerHTML = '';

    Object.entries(input.keybinds).forEach(([action, data]) => {
      const row = document.createElement('div');
      row.className = 'keybind-row';

      const isListening = input.activeRebindAction === action;

      row.innerHTML = `
        <span class="keybind-label">${data.label}</span>
        <button class="keybind-key-btn ${isListening ? 'listening' : ''}" data-action="${action}">
          ${isListening ? 'PRESS KEY...' : `[${data.display}]`}
        </button>
      `;

      const btn = row.querySelector('.keybind-key-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.activeRebindAction = action;
        this.renderKeybindsList();
      });

      this.keybindsList.appendChild(row);
    });
  }

  // Populate Agent Selection Cards in Lobby
  initLobbyAgents() {
    this.agentCardsContainer.innerHTML = '';
    const agents = Object.values(CONSTANTS.AGENTS);

    agents.forEach(agent => {
      const card = document.createElement('div');
      card.className = `agent-card ${agent.id === this.selectedAgent ? 'selected' : ''}`;
      card.dataset.agentId = agent.id;

      const ab1 = agent.abilities.ability1;
      const ab2 = agent.abilities.ability2;

      card.innerHTML = `
        <div class="agent-card-header">
          <span class="agent-name" style="color: ${agent.color};">${agent.name}</span>
          <span class="agent-role">${agent.role}</span>
        </div>
        <div class="agent-desc">${agent.description}</div>
        <div class="agent-abilities-preview">
          <div class="ab-preview-item">
            <span class="ab-key-badge">[${input?.keybinds?.ability1?.display || 'Q'}]</span>
            <span>${ab1.name}</span>
          </div>
          <div class="ab-preview-item">
            <span class="ab-key-badge">[${input?.keybinds?.ability2?.display || 'E'}]</span>
            <span>${ab2.name}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedAgent = agent.id;
        if (this.onSelectAgent) this.onSelectAgent(agent.id);
      });

      this.agentCardsContainer.appendChild(card);
    });
  }

  // Switch between Lobby and Combat screens
  showGameScreen() {
    this.screenLobby.classList.remove('active');
    this.screenGame.classList.add('active');
    this.menuOptLeave.classList.remove('hidden');
    this.centerAnnouncement.classList.add('hidden');
    this.btnReturnLobbyAnnouncement.classList.add('hidden');
  }

  showLobbyScreen() {
    this.screenGame.classList.remove('active');
    this.screenLobby.classList.add('active');
    this.menuOptLeave.classList.add('hidden');
    this.modalShop.classList.add('hidden');
    this.modalScoreboard.classList.add('hidden');
    this.centerAnnouncement.classList.add('hidden');
    this.btnReturnLobbyAnnouncement.classList.add('hidden');
  }

  showEntryPanel() {
    this.panelRoom.classList.add('hidden');
    this.panelEntry.classList.remove('hidden');
    if (this.panelPublicLobbies) this.panelPublicLobbies.classList.remove('hidden');
    this.checkPenaltyState();
  }

  // Render Public Lobbies List
  renderPublicRooms(rooms) {
    if (!this.publicRoomsList) return;
    this.publicRoomsList.innerHTML = '';

    if (!rooms || rooms.length === 0) {
      this.publicRoomsList.innerHTML = `
        <div class="empty-lobbies-msg">
          <span style="font-size: 28px; opacity: 0.6;">📡</span>
          <span style="font-weight: 600; letter-spacing: 1px;">NO ACTIVE SQUADS FOUND</span>
          <span style="font-size: 12px; color: var(--text-muted);">Create a new room on the left to start a match</span>
        </div>
      `;
      return;
    }

    rooms.forEach(r => {
      const card = document.createElement('div');
      card.className = 'lobby-room-card';

      const isLobby = r.state === 'lobby';
      const stateBadge = isLobby
        ? `<span class="room-card-state-tag lobby">LOBBY // OPEN</span>`
        : `<span class="room-card-state-tag in-game">LIVE MATCH (R${r.roundNumber || 1})</span>`;

      card.innerHTML = `
        <div class="room-card-info">
          <div class="room-card-code">${r.code}</div>
          <div class="room-card-details">
            <div class="room-card-badges">
              ${stateBadge}
              <span class="room-card-players">👥 ${r.humanCount} Players ${r.botCount ? `+ 🤖 ${r.botCount} Bots` : ''} (${r.playerCount}/${r.maxPlayers})</span>
            </div>
          </div>
        </div>
        <button class="btn btn-sm btn-primary btn-quick-join" data-code="${r.code}">QUICK JOIN →</button>
      `;

      const btnJoin = card.querySelector('.btn-quick-join');
      btnJoin.addEventListener('click', () => {
        if (this.inputRoomCode) {
          this.inputRoomCode.value = r.code;
        }
        if (this.btnJoinRoom) {
          this.btnJoinRoom.click();
        }
      });

      this.publicRoomsList.appendChild(card);
    });
  }

  // Update Room Lobby details & Player Rosters
  updateLobbyRoom(roomState, localPlayerId) {
    this.panelEntry.classList.add('hidden');
    if (this.panelPublicLobbies) this.panelPublicLobbies.classList.add('hidden');
    this.panelRoom.classList.remove('hidden');
    this.displayRoomCode.innerText = roomState.code;

    const localPlayer = roomState.players.find(p => p.id === localPlayerId);
    const isHost = localPlayer && localPlayer.isHost;

    // FIX 2: Show Launch button ONLY for host
    if (isHost) {
      this.btnStartMatch.classList.remove('hidden');
    } else {
      this.btnStartMatch.classList.add('hidden');
    }

    // FIX 9: Show Add AI Bot ONLY for host
    if (this.btnAddBot) {
      if (isHost) {
        this.btnAddBot.classList.remove('hidden');
      } else {
        this.btnAddBot.classList.add('hidden');
      }
    }

    // Leader penalty banner — if the host is penalized, disable Launch Match
    const hostPlayer = roomState.players.find(p => p.isHost);
    if (hostPlayer && hostPlayer.penaltyUntil && hostPlayer.penaltyUntil > Date.now()) {
      if (this.leaderPenaltyBanner) this.leaderPenaltyBanner.classList.remove('hidden');
      if (this.btnStartMatch) this.btnStartMatch.disabled = true;

      const remainMs = hostPlayer.penaltyUntil - Date.now();
      const totalSec = Math.ceil(remainMs / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      if (this.leaderPenaltyTimer) this.leaderPenaltyTimer.innerText = `${mm}:${ss}`;
    } else {
      if (this.leaderPenaltyBanner) this.leaderPenaltyBanner.classList.add('hidden');
      if (this.btnStartMatch) this.btnStartMatch.disabled = false;
    }

    // FIX 5: Deduplicate players by id before rendering
    const seenIds = new Set();
    const uniquePlayers = roomState.players.filter(p => {
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });

    // Populate Rosters
    this.rosterAttackers.innerHTML = '';
    this.rosterDefenders.innerHTML = '';

    uniquePlayers.forEach(p => {
      const isLocal = p.id === localPlayerId;
      const agent = CONSTANTS.AGENTS[p.agent];
      const card = document.createElement('div');
      card.className = `roster-card ${isLocal ? 'is-local' : ''}`;

      // FIX 6+7: Build host-only controls for ALL players (bots + humans)
      let hostControls = '';
      if (isHost && !isLocal) {
        // Switch arrow: bot & human alike
        const switchLabel = p.team === 'defenders' ? '← ATT' : 'DEF →';
        const switchCls = p.team === 'defenders' ? 'btn-switch-left' : 'btn-switch-right';
        const removeCls = p.isBot ? 'btn-bot-remove' : 'btn-player-kick';
        const removeTitle = p.isBot ? 'Remove Bot' : 'Kick Player';
        hostControls = `
          <div class="bot-controls">
            <button class="btn-bot-switch ${switchCls}" title="Switch Team">${switchLabel}</button>
            <button class="${removeCls}" title="${removeTitle}">✕</button>
          </div>`;
      } else if (isHost && isLocal) {
        hostControls = `<div class="roster-status host-badge">HOST 👑</div>`;
      }

      card.innerHTML = `
        <div class="roster-card-info">
          <div class="roster-agent-dot" style="background: ${agent ? agent.color : '#888'};"></div>
          <div>
            <div class="roster-player-name">${p.name} ${p.isHost ? '👑' : ''} ${p.isBot ? '🤖' : ''}</div>
            <div class="roster-agent-name">${agent ? agent.name : 'Unknown'}</div>
          </div>
        </div>
        ${hostControls || `<div class="roster-status">${p.isHost ? 'HOST' : 'WAITING'}</div>`}
      `;

      // Wire control buttons (host only, for others)
      if (isHost && !isLocal) {
        const switchBtn = card.querySelector('.btn-bot-switch');
        if (switchBtn) {
          switchBtn.addEventListener('click', () => {
            const targetTeam = p.team === 'defenders' ? 'attackers' : 'defenders';
            if (p.isBot) {
              if (this.onSwitchBotTeam) this.onSwitchBotTeam(p.id, targetTeam);
            } else {
              if (this.onSwitchHumanTeam) this.onSwitchHumanTeam(p.id, targetTeam);
            }
          });
        }

        // Bot remove button
        const removeBtn = card.querySelector('.btn-bot-remove');
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            if (this.onRemoveBot) this.onRemoveBot(p.id);
          });
        }

        // Human kick button
        const kickBtn = card.querySelector('.btn-player-kick');
        if (kickBtn) {
          kickBtn.addEventListener('click', () => {
            if (this.onKickPlayer) this.onKickPlayer(p.id);
          });
        }
      }

      if (p.team === 'attackers') {
        this.rosterAttackers.appendChild(card);
      } else {
        this.rosterDefenders.appendChild(card);
      }
    });
  }

  // Update HUD every frame/tick
  updateHUD(gameState, localPlayer) {
    if (!localPlayer) return;

    // Scores
    this.hudScoreAtt.innerText = gameState.score.attackers;
    this.hudScoreDef.innerText = gameState.score.defenders;

    // Round Timer & Phase
    if (gameState.state === 'buyPhase') {
      this.hudPhaseLabel.innerText = 'BUY PHASE';
      this.hudPhaseLabel.style.color = '#ffde59';
      this.hudTimerDisplay.innerText = gameState.roundTimer;
      this.buyPhaseBanner.classList.remove('hidden');
      this.buyCreditsDisplay.innerText = `$${localPlayer.credits}`;
      this.shopTimer.innerText = gameState.roundTimer;
    } else if (gameState.state === 'inRound') {
      this.buyPhaseBanner.classList.add('hidden');
      if (gameState.spike.planted) {
        this.hudPhaseLabel.innerText = 'SPIKE DETONATION';
        this.hudPhaseLabel.style.color = '#ff4655';
        this.hudTimerDisplay.innerText = gameState.spike.detonateTimer;
        this.hudSpikeStatus.classList.remove('hidden');
        this.hudSpikeText.innerText = `SITE ${gameState.spike.site || ''} ARMED`;
      } else {
        this.hudPhaseLabel.innerText = `ROUND ${gameState.roundNumber}`;
        this.hudPhaseLabel.style.color = '#00f0ff';
        this.hudTimerDisplay.innerText = gameState.roundTimer;
        this.hudSpikeStatus.classList.remove('hidden');
        this.hudSpikeText.innerText = gameState.spike.carrierId ? 'CARRIED' : 'DROPPED';
      }
    } else {
      this.buyPhaseBanner.classList.add('hidden');
      this.hudPhaseLabel.innerText = 'ROUND OVER';
    }

    // Health & Armor
    this.hudHpVal.innerText = Math.max(0, localPlayer.health);
    this.hudHpBar.style.width = `${Math.max(0, localPlayer.health)}%`;
    this.hudArmorVal.innerText = localPlayer.armor;
    this.hudArmorBar.style.width = `${(localPlayer.armor / 50) * 100}%`;

    // Active Weapon & Ammo
    const curWeapon = localPlayer.weapons[localPlayer.currentSlot];
    if (curWeapon) {
      if (curWeapon.slot === 'melee') {
        this.hudAmmoCur.innerText = '∞';
        this.hudAmmoRes.innerText = '';
      } else {
        this.hudAmmoCur.innerText = curWeapon.curAmmo;
        this.hudAmmoRes.innerText = curWeapon.reserveAmmo;
      }
    }

    // Reload tag
    if (localPlayer.reloading) {
      this.hudReloadTag.classList.remove('hidden');
    } else {
      this.hudReloadTag.classList.add('hidden');
    }

    // Weapon Slots strip highlight
    ['primary', 'secondary', 'melee', 'spike'].forEach(slot => {
      const el = document.getElementById(`slot-${slot}`);
      if (el) {
        if (slot === localPlayer.currentSlot) el.classList.add('active');
        else el.classList.remove('active');

        // Update slot name
        const nameEl = el.querySelector('.slot-name');
        if (nameEl) {
          if (slot === 'spike') {
            nameEl.innerText = gameState.spike.carrierId === localPlayer.id ? 'SPIKE' : '-';
          } else {
            nameEl.innerText = localPlayer.weapons[slot] ? localPlayer.weapons[slot].name.toUpperCase() : 'EMPTY';
          }
        }
      }
    });

    // Abilities HUD Slots (strictly 2 abilities with custom keybinds displayed!)
    this.renderAbilitiesHUD(localPlayer);

    // Spike Interaction Progress Ring (Planting / Defusing)
    this.updateInteractionPrompt(gameState, localPlayer);

    // Blindness / Flash Overlay update
    if (localPlayer.blindTimer > 0) {
      const opacity = Math.min(1.0, localPlayer.blindTimer / 1.5);
      this.flashOverlay.style.opacity = opacity;
    } else {
      this.flashOverlay.style.opacity = 0;
    }

    // Shop modal credits
    this.shopCurrentCredits.innerText = `$${localPlayer.credits}`;

    // Update Scoreboard data
    this.updateScoreboard(gameState);
  }

  // Render strictly the 2 abilities with active keybind display
  renderAbilitiesHUD(player) {
    const agentDef = CONSTANTS.AGENTS[player.agent];
    if (!agentDef) return;

    this.hudAbilitiesContainer.innerHTML = '';
    const abKeys = ['ability1', 'ability2'];

    abKeys.forEach(key => {
      const ab = agentDef.abilities[key];
      if (!ab) return;
      const charges = player.abilityCharges[key] || 0;
      const isReady = charges > 0;
      const displayKey = input?.keybinds?.[key]?.display || ab.key;

      const slotEl = document.createElement('div');
      slotEl.className = `ability-hud-slot ${isReady ? 'ready' : 'depleted'}`;
      slotEl.innerHTML = `
        <span class="ab-slot-key">[${displayKey}]</span>
        <span class="ab-slot-name">${ab.name}</span>
        <span class="ab-slot-charges">${charges}/${ab.maxCharges}</span>
      `;
      this.hudAbilitiesContainer.appendChild(slotEl);
    });
  }

  // Interaction prompt for Spike Plant & Defuse (Both using key 4 / spikeAction)
  updateInteractionPrompt(gameState, player) {
    const totalCircumference = 213.6; // 2 * PI * 34
    const spikeKeyDisplay = input?.keybinds?.spikeAction?.display || '4';

    // 1. In active planting progress
    if (gameState.spike.planterId === player.id) {
      this.interactionPrompt.classList.remove('hidden');
      this.interactionKeyBadge.innerText = spikeKeyDisplay;
      this.interactionLabel.innerText = 'PLANTING SPIKE...';
      const progress = gameState.spike.plantProgress / CONSTANTS.SPIKE_PLANT_TIME;
      const offset = totalCircumference * (1 - Math.min(1.0, progress));
      this.interactionProgressCircle.style.strokeDashoffset = offset;
      this.interactionProgressCircle.style.stroke = '#ff4655';
      return;
    }

    // 2. In active defusing progress
    if (gameState.spike.defuserId === player.id) {
      this.interactionPrompt.classList.remove('hidden');
      this.interactionKeyBadge.innerText = spikeKeyDisplay;
      this.interactionLabel.innerText = 'DEFUSING SPIKE...';
      const progress = gameState.spike.defuseProgress / CONSTANTS.SPIKE_DEFUSE_TIME;
      const offset = totalCircumference * (1 - Math.min(1.0, progress));
      this.interactionProgressCircle.style.strokeDashoffset = offset;
      this.interactionProgressCircle.style.stroke = '#00f0ff';
      return;
    }

    // 3. Proximity hint to defuse for Defender near planted spike
    if (gameState.spike.planted && player.team === 'defenders' && !gameState.spike.defuserId) {
      const d = Math.hypot(player.x - gameState.spike.x, player.y - gameState.spike.y);
      if (d < 100) {
        this.interactionPrompt.classList.remove('hidden');
        this.interactionKeyBadge.innerText = spikeKeyDisplay;
        this.interactionLabel.innerText = `HOLD [${spikeKeyDisplay}] TO DEFUSE`;
        this.interactionProgressCircle.style.strokeDashoffset = totalCircumference;
        this.interactionProgressCircle.style.stroke = '#00f0ff';
        return;
      }
    }

    // 4. Proximity hint to plant for Attacker inside site carrying spike
    if (!gameState.spike.planted && player.team === 'attackers' && gameState.spike.carrierId === player.id && !gameState.spike.planterId) {
      const inSite = MAP_DATA.plantSites.find(site =>
        player.x >= site.x && player.x <= site.x + site.w &&
        player.y >= site.y && player.y <= site.y + site.h
      );
      if (inSite) {
        this.interactionPrompt.classList.remove('hidden');
        this.interactionKeyBadge.innerText = spikeKeyDisplay;
        this.interactionLabel.innerText = `HOLD [${spikeKeyDisplay}] TO PLANT SPIKE`;
        this.interactionProgressCircle.style.strokeDashoffset = totalCircumference;
        this.interactionProgressCircle.style.stroke = '#ff4655';
        return;
      }
    }

    // Otherwise hide prompt
    this.interactionPrompt.classList.add('hidden');
  }

  // Tactical Arsenal / Shop Catalog Setup
  initShopCatalog() {
    // 1. Sidearms
    this.shopSidearms.innerHTML = '';
    ['classic', 'ghost'].forEach(id => {
      const w = CONSTANTS.WEAPONS[id];
      const card = this.createShopCard('weapon', id, w.name, `$${w.cost}`, `Dmg: ${w.damage.body} | Mag: ${w.magSize}`);
      this.shopSidearms.appendChild(card);
    });

    // 2. Primaries
    this.shopPrimaries.innerHTML = '';
    ['spectre', 'vandal', 'phantom', 'operator'].forEach(id => {
      const w = CONSTANTS.WEAPONS[id];
      const card = this.createShopCard('weapon', id, w.name, `$${w.cost}`, `Dmg: ${w.damage.body} | Rate: ${w.fireRate}/s`);
      this.shopPrimaries.appendChild(card);
    });

    // 3. Armor & Utilities (Strictly 2 abilities)
    this.shopUtilities.innerHTML = '';
    Object.keys(CONSTANTS.ARMOR).forEach(id => {
      const arm = CONSTANTS.ARMOR[id];
      const card = this.createShopCard('armor', id, arm.name, `$${arm.cost}`, `+${arm.armor} Shield Absorbs 66% Dmg`);
      this.shopUtilities.appendChild(card);
    });

    // Ability Charges
    const cardAb1 = this.createShopCard('ability', 'ability1', 'Ability 1 Charge', '$150', '+1 Tactical Charge');
    const cardAb2 = this.createShopCard('ability', 'ability2', 'Ability 2 Charge', '$250', '+1 Tactical Charge');
    this.shopUtilities.appendChild(cardAb1);
    this.shopUtilities.appendChild(cardAb2);
  }

  createShopCard(category, id, title, price, subtitle) {
    const card = document.createElement('div');
    card.className = 'shop-card';
    card.dataset.category = category;
    card.dataset.itemId = id;

    card.innerHTML = `
      <div class="shop-card-left">
        <span class="shop-item-name">${title}</span>
        <span class="shop-item-sub">${subtitle}</span>
      </div>
      <div class="shop-item-cost">${price}</div>
    `;

    card.addEventListener('click', () => {
      if (this.onBuyItem) {
        this.onBuyItem(category, id);
      }
    });

    return card;
  }

  toggleShop() {
    this.modalShop.classList.toggle('hidden');
  }

  // Kill Feed Notification
  addKillFeed(kill) {
    const item = document.createElement('div');
    item.className = 'kill-item';

    const killerColor = kill.killerTeam === 'attackers' ? '#ff4655' : '#00f0ff';
    const victimColor = kill.victimTeam === 'attackers' ? '#ff4655' : '#00f0ff';

    item.innerHTML = `
      <span class="kill-killer" style="color: ${killerColor};">${kill.killerName}</span>
      <span class="kill-weapon">[${kill.weapon}]</span>
      ${kill.headshot ? '<span class="kill-headshot">💥 HEADSHOT</span>' : ''}
      <span class="kill-victim" style="color: ${victimColor};">${kill.victimName}</span>
    `;

    this.killFeed.appendChild(item);

    // Remove after 5 seconds
    setTimeout(() => {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 5000);
  }

  // Center Screen Announcements
  showAnnouncement(title, subtitle, duration = 3000, showReturnButton = false) {
    this.announcementTitle.innerText = title;
    this.announcementSubtitle.innerText = subtitle;
    this.centerAnnouncement.classList.remove('hidden');

    if (showReturnButton) {
      this.btnReturnLobbyAnnouncement.classList.remove('hidden');
    } else {
      this.btnReturnLobbyAnnouncement.classList.add('hidden');
    }

    // Always hide after duration (server handles the actual game state transition)
    if (duration > 0) {
      setTimeout(() => {
        this.centerAnnouncement.classList.add('hidden');
      }, duration);
    }
  }

  // Career / Match History Modal
  async showCareerModal() {
    this.modalCareer.classList.remove('hidden');
    this.careerHistoryList.innerHTML = '<div class="loading-message">Retrieving operative career logs from Atlas...</div>';

    const playerName = (this.inputPlayerName?.value?.trim()) || localStorage.getItem('tactical_codename') || 'Viper_99';

    // Use playerName for persistent history across sessions
    const fetchUrl = `/api/match-history/${encodeURIComponent(playerName)}?limit=25`;

    try {
      const response = await fetch(fetchUrl);
      const data = await response.json();

      if (data.success && data.data && data.data.length > 0) {
        this.renderCareerHistory(data.data);
      } else {
        this.careerHistoryList.innerHTML = `
          <div class="empty-career-msg">
            <span style="font-size: 36px;">📡</span>
            <span style="font-weight: 700; letter-spacing: 1px;">NO RECENT COMBAT LOGS FOUND</span>
            <span style="font-size: 13px; color: var(--text-muted);">Complete a match in active sector to record performance to MongoDB Atlas.</span>
          </div>
        `;
        this.careerStatsSummary.innerHTML = '';
      }
    } catch (error) {
      console.error('Career fetch error:', error);
      this.careerHistoryList.innerHTML = '<div class="error-message">Database syncing. Play a match to log career history.</div>';
    }
  }

  renderCareerHistory(matches) {
    if (!matches || matches.length === 0) {
      this.careerHistoryList.innerHTML = '<div class="empty-message">No match history available</div>';
      this.careerStatsSummary.innerHTML = '';
      return;
    }

    const totalMatches = matches.length;
    const wins = matches.filter(m => m.isVictory).length;
    const losses = totalMatches - wins;
    const totalKills = matches.reduce((sum, m) => sum + (m.kills || 0), 0);
    const totalDeaths = matches.reduce((sum, m) => sum + (m.deaths || 0), 0);
    const totalAssists = matches.reduce((sum, m) => sum + (m.assists || 0), 0);
    const winRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 100) : 0;
    const kdRatio = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills.toFixed(2);

    // Summary Top Cards
    this.careerStatsSummary.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${totalMatches}</div>
        <div class="stat-label">MATCHES</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #00f0ff;">${wins}</div>
        <div class="stat-label">VICTORIES</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #ff4655;">${losses}</div>
        <div class="stat-label">DEFEATS</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #ffde59;">${winRate}%</div>
        <div class="stat-label">WIN RATE</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #5eff8b;">${kdRatio}</div>
        <div class="stat-label">K/D RATIO</div>
      </div>
    `;

    // Valorant-Style Career Cards matching Image 3
    this.careerHistoryList.innerHTML = matches.map(m => {
      const isVic = m.isVictory;
      const resultClass = isVic ? 'is-victory' : 'is-defeat';
      const resultText = isVic ? 'VICTORY' : 'DEFEAT';
      const agent = CONSTANTS.AGENTS[m.agent] || { name: m.agent || 'Agent', color: '#00f0ff' };
      const attScore = m.finalScore ? (m.finalScore.attackers ?? 0) : 0;
      const defScore = m.finalScore ? (m.finalScore.defenders ?? 0) : 0;
      const myTeamScore = m.team === 'attackers' ? attScore : defScore;
      const enemyScore = m.team === 'attackers' ? defScore : attScore;
      const scoreDisplay = `${myTeamScore} - ${enemyScore}`;
      const dateStr = m.matchDate ? new Date(m.matchDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recent';

      // Agent avatar initials or glyph
      const agentInitial = (agent.name || 'A').charAt(0).toUpperCase();

      return `
        <div class="valorant-career-card ${resultClass}">
          <div class="career-card-left">
            <div class="agent-avatar-badge" style="border-color: ${agent.color || '#00f0ff'}; background: rgba(0,0,0,0.4);">
              <span class="avatar-glyph" style="color: ${agent.color || '#fff'};">${agentInitial}</span>
            </div>
            <div class="player-agent-meta">
              <div class="career-agent-name" style="color: ${agent.color || '#fff'};">${agent.name}</div>
              <div class="career-player-name">${m.playerName || 'Operative'}</div>
            </div>
          </div>

          <div class="career-card-kda">
            <div class="kda-label">KDA <span class="kda-numbers">${m.kills || 0} / ${m.deaths || 0} / ${m.assists || 0}</span></div>
            <div class="career-score-tag">SCORE ${m.score ? m.score.toLocaleString() : (m.kills || 0) * 150}</div>
          </div>

          <div class="career-card-result">
            <div class="outcome-title ${resultClass}">${resultText}</div>
            <div class="outcome-rounds">${scoreDisplay}</div>
          </div>

          <div class="career-card-right">
            <div class="map-badge">ASCENT // MID</div>
            <div class="date-badge">${dateStr}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Tab Scoreboard Data
  updateScoreboard(gameState) {
    this.sbScoreAtt.innerText = gameState.score.attackers;
    this.sbScoreDef.innerText = gameState.score.defenders;

    this.sbBodyAttackers.innerHTML = '';
    this.sbBodyDefenders.innerHTML = '';

    // In Valorant tactical rules, you can only see teammate credits, never opponent credits!
    const localId = window.network?.playerId;
    const localPlayer = gameState.players.find(p => p.id === localId);
    const localTeam = localPlayer ? localPlayer.team : null;

    gameState.players.forEach(p => {
      const agent = CONSTANTS.AGENTS[p.agent];
      const isTeammate = !localTeam || p.team === localTeam;
      const creditsDisplay = isTeammate ? `$${p.credits}` : '---';
      const creditsColor = isTeammate ? '#5eff8b' : '#738294';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color: ${agent ? agent.color : '#fff'}; font-weight: bold;">${agent ? agent.name : 'Unknown'}</td>
        <td>${p.name} ${p.isBot ? '🤖' : ''}</td>
        <td>${p.stats.kills}</td>
        <td>${p.stats.deaths}</td>
        <td>${p.stats.score}</td>
        <td style="color: ${creditsColor}; font-weight: 600;">${creditsDisplay}</td>
      `;

      if (p.team === 'attackers') {
        this.sbBodyAttackers.appendChild(tr);
      } else {
        this.sbBodyDefenders.appendChild(tr);
      }
    });
  }
  // ===================== AFK Warning UI =====================

  showAfkWarning(afkRounds, maxRounds) {
    let el = document.getElementById('afk-warning-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'afk-warning-overlay';
      el.className = 'afk-warning-overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="afk-warning-box">
        <div class="afk-icon">⚠️</div>
        <div class="afk-title">AFK WARNING</div>
        <div class="afk-desc">
          You have been inactive for <strong>${afkRounds}</strong> round(s).<br>
          Move to cancel. Auto-kick in <strong>${maxRounds - afkRounds}</strong> more round(s).
        </div>
      </div>`;
    el.classList.remove('hidden');
  }

  showAfkSpawnSkipped(afkRounds, roundsUntilKick) {
    let el = document.getElementById('afk-spawn-msg');
    if (!el) {
      el = document.createElement('div');
      el.id = 'afk-spawn-msg';
      el.className = 'afk-spawn-skipped-msg';
      document.body.appendChild(el);
    }
    el.textContent = `⚠ You will spawn in the next round — return to spawn area now! (${roundsUntilKick} round(s) until kick)`;
    el.classList.remove('hidden');
    clearTimeout(this._afkSpawnMsgTimer);
    this._afkSpawnMsgTimer = setTimeout(() => { el.classList.add('hidden'); }, 7000);
  }

  hideAfkWarning() {
    const el = document.getElementById('afk-warning-overlay');
    if (el) el.classList.add('hidden');
    const msg = document.getElementById('afk-spawn-msg');
    if (msg) msg.classList.add('hidden');
  }

  showAfkKickScreen(penaltySeconds) {
    let el = document.getElementById('afk-kick-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'afk-kick-overlay';
      el.className = 'afk-kick-overlay';
      document.body.appendChild(el);
    }
    const mins = Math.ceil(penaltySeconds / 60);
    el.innerHTML = `
      <div class="afk-kick-box">
        <div class="afk-kick-icon">🚫</div>
        <div class="afk-kick-title">REMOVED FOR AFK</div>
        <div class="afk-kick-desc">
          You were removed from the match for being AFK.<br>
          <span class="afk-kick-penalty">Matchmaking penalty: ${mins} minute(s)</span>
        </div>
        <div class="afk-kick-sub">Returning to dashboard...</div>
      </div>`;
    el.classList.remove('hidden');
  }

  returnToDashboard(penaltyData) {
    const canvas = document.getElementById('game-canvas');
    if (canvas) canvas.style.display = 'none';
    const gameHud = document.getElementById('game-hud');
    if (gameHud) gameHud.style.display = 'none';
    setTimeout(() => {
      const kick = document.getElementById('afk-kick-overlay');
      if (kick) kick.classList.add('hidden');
    }, 500);
    this.showEntryPanel();
    if (penaltyData && penaltyData.penaltyUntil) {
      if (!this.localPlayer) this.localPlayer = {};
      this.localPlayer.penaltyUntil = penaltyData.penaltyUntil;
      this.checkPenaltyState();
    }
  }
}
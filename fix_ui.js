// Fix ui.js updateLobbyRoom method
const fs = require('fs');

let src = fs.readFileSync('public/js/ui.js', 'utf8');

// ===== FIX 9: Hide Add AI Bot for non-host =====
// Insert after the show/hide of btnStartMatch
const oldHostCheck = `    // Show Launch button only for host
    if (isHost) {
      this.btnStartMatch.classList.remove('hidden');
    } else {
      this.btnStartMatch.classList.add('hidden');
    }`;

const newHostCheck = `    // FIX 2: Show Launch button ONLY for host
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
    }`;

if (src.includes(oldHostCheck)) {
  src = src.replace(oldHostCheck, newHostCheck);
  console.log('✅ FIX 9: Hide AI Bot for non-host added');
} else {
  console.log('⚠️ FIX 9: pattern not found');
}

// ===== FIX 5: Deduplicate + FIX 6,7: host controls for human players =====
// Replace the players.forEach loop in updateLobbyRoom

const oldLoop = `    // Populate Rosters
    this.rosterAttackers.innerHTML = '';
    this.rosterDefenders.innerHTML = '';

    roomState.players.forEach(p => {
      const isLocal = p.id === localPlayerId;
      const agent = CONSTANTS.AGENTS[p.agent];
      const card = document.createElement('div');
      card.className = \`roster-card \${isLocal ? 'is-local' : ''}\`;

      // Bot switch arrows — only for party leader, only for bots
      let botControls = '';
      if (p.isBot && isHost) {
        if (p.team === 'defenders') {
          // Arrow faces LEFT → move bot to Attackers
          botControls = \`
            <div class="bot-controls">
              <button class="btn-bot-switch btn-switch-left" title="Move Bot to Attackers">← ATT</button>
              <button class="btn-bot-remove" title="Remove Bot">✕</button>
            </div>\`;
        } else {
          // Arrow faces RIGHT → move bot to Defenders
          botControls = \`
            <div class="bot-controls">
              <button class="btn-bot-switch btn-switch-right" title="Move Bot to Defenders">DEF →</button>
              <button class="btn-bot-remove" title="Remove Bot">✕</button>
            </div>\`;
        }
      }

      card.innerHTML = \`
        <div class="roster-card-info">
          <div class="roster-agent-dot" style="background: \${agent ? agent.color : '#888'};"></div>
          <div>
            <div class="roster-player-name">\${p.name} \${p.isHost ? '👑' : ''} \${p.isBot ? '🤖' : ''}</div>
            <div class="roster-agent-name">\${agent ? agent.name : 'Unknown'}</div>
          </div>
        </div>
        \${botControls || \`<div class="roster-status">\${p.ready ? 'READY' : 'CHOOSING'}</div>\`}
      \`;

      // Wire bot control buttons after innerHTML is set
      if (p.isBot && isHost) {
        const switchBtn = card.querySelector('.btn-bot-switch');
        const removeBtn = card.querySelector('.btn-bot-remove');
        if (switchBtn) {
          switchBtn.addEventListener('click', () => {
            const targetTeam = p.team === 'defenders' ? 'attackers' : 'defenders';
            if (this.onSwitchBotTeam) this.onSwitchBotTeam(p.id, targetTeam);
          });
        }
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            if (this.onRemoveBot) this.onRemoveBot(p.id);
          });
        }
      }

      if (p.team === 'attackers') {
        this.rosterAttackers.appendChild(card);
      } else {
        this.rosterDefenders.appendChild(card);
      }
    });
  }`;

const newLoop = `    // FIX 5: Deduplicate players by id before rendering
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
      card.className = \`roster-card \${isLocal ? 'is-local' : ''}\`;

      // FIX 6+7: Build host-only controls for ALL players (bots + humans)
      let hostControls = '';
      if (isHost && !isLocal) {
        // Switch arrow: bot & human alike
        const switchLabel = p.team === 'defenders' ? '← ATT' : 'DEF →';
        const switchCls = p.team === 'defenders' ? 'btn-switch-left' : 'btn-switch-right';
        const removeCls = p.isBot ? 'btn-bot-remove' : 'btn-player-kick';
        const removeTitle = p.isBot ? 'Remove Bot' : 'Kick Player';
        hostControls = \`
          <div class="bot-controls">
            <button class="btn-bot-switch \${switchCls}" title="Switch Team">\${switchLabel}</button>
            <button class="\${removeCls}" title="\${removeTitle}">✕</button>
          </div>\`;
      } else if (isHost && isLocal) {
        hostControls = \`<div class="roster-status host-badge">HOST 👑</div>\`;
      }

      card.innerHTML = \`
        <div class="roster-card-info">
          <div class="roster-agent-dot" style="background: \${agent ? agent.color : '#888'};"></div>
          <div>
            <div class="roster-player-name">\${p.name} \${p.isHost ? '👑' : ''} \${p.isBot ? '🤖' : ''}</div>
            <div class="roster-agent-name">\${agent ? agent.name : 'Unknown'}</div>
          </div>
        </div>
        \${hostControls || \`<div class="roster-status">\${p.isHost ? 'HOST' : (p.ready ? 'READY' : 'WAITING')}</div>\`}
      \`;

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
  }`;

if (src.includes(oldLoop)) {
  src = src.replace(oldLoop, newLoop);
  console.log('✅ FIX 5,6,7: updateLobbyRoom loop replaced');
} else {
  // Try a partial match — the forEach start
  console.log('⚠️ Full loop pattern not matched — checking for partial match...');
  const hasForEach = src.includes('roomState.players.forEach(p => {');
  console.log('Has forEach:', hasForEach);
}

fs.writeFileSync('public/js/ui.js', src, 'utf8');
console.log('Saved ui.js');

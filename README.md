# TACTICAL // PROTOCOL (Valorant 2D Top-Down Shooter)

A fast-paced 2D top-down multiplayer tactical browser shooter inspired by Valorant, built using Node.js, Express, Socket.io, HTML5 Canvas, and the Web Audio API.

---

## 🌟 Key Updates & Features

1. **Customizable Keybinds & Settings Modal (Hamburger Menu `☰`)**:
   - Access the gear settings menu anytime via the **hamburger menu (`☰`)** in the top-right corner.
   - Click on any action to customize its keybind (e.g. Movement, Gun Reload, Abilities, Spike Plant/Defuse, Arsenal Shop, Scoreboard).
   - **Personalized & Local**: Controls are saved strictly to each player's local browser (`localStorage`), allowing everyone to choose their own favorite keys without affecting other players.
   - Includes a **"RESET TO DEFAULTS"** button.

2. **Strict Spawn Containment During Buy Phase**:
   - Players are physically blocked by laser gates and authoritatively clamped to their spawn zones during the 15-second Buy Phase.
   - Roaming the map is strictly forbidden until the Buy Phase countdown reaches zero!

3. **Reload Behavior**:
   - Pressing <kbd>R</kbd> reloads firearms from reserve ammo.
   - Knives **cannot** reload and ignore reload triggers.

4. **Unified Spike Plant & Defuse (<kbd>4</kbd>)**:
   - Attackers hold <kbd>4</kbd> inside Site A or Site B to plant the Spike (4 seconds).
   - Defenders hold <kbd>4</kbd> near the planted Spike to defuse (7 seconds with 3.5s half-defuse checkpoint).
   - On-screen HUD interaction prompt automatically shows `HOLD [4] TO PLANT` or `HOLD [4] TO DEFUSE`.

5. **Dashboard Navigation & Match End Transition**:
   - **Back Button**: The room dashboard includes a `← LEAVE ROOM` button to easily return to the room entry screen.
   - **Match End Auto-Return**: When a match concludes (5 round wins), victory/defeat is displayed, and players are automatically returned to their room dashboard.
   - Players can also click **"RETURN TO DASHBOARD"** in the top-right hamburger menu at any time.

6. **Agent Abilities (2 Abilities per Agent)**:
   - Each agent possesses exactly 2 specialized abilities (Ability 1 and Ability 2), mapped by default to <kbd>Q</kbd> and <kbd>E</kbd> (or your custom bound keys).
   - **Shadow (Omen)**: `[Q]` Dark Cover (Smoke), `[E]` Paranoia (Blind)
   - **Blaze (Phoenix)**: `[Q]` Curveball (Flash), `[E]` Hot Hands (Molotov)
   - **Specter (Jett)**: `[Q]` Cloudburst (Smoke), `[E]` Tailwind (Dash)
   - **Hunter (Sova)**: `[Q]` Recon Bolt (Sonar), `[E]` Shock Bolt (Kinetic)

---

## 🎮 Default Controls

| Key / Input | Action |
| :--- | :--- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Move Operative |
| <kbd>Mouse Move</kbd> | Aim Crosshair / Direction |
| <kbd>Left Click</kbd> | Fire Weapon / Slash Knife |
| <kbd>Shift</kbd> | Walk Silently (Reduces Footsteps & Spread) |
| <kbd>Ctrl</kbd> | Crouch (Maximum Aim Precision) |
| <kbd>1</kbd> | Equip Primary Weapon |
| <kbd>2</kbd> | Equip Secondary Weapon |
| <kbd>3</kbd> | Equip Tactical Knife |
| <kbd>4</kbd> | Equip / Hold to Plant or Defuse Spike |
| <kbd>R</kbd> | Reload Gun (Knives cannot reload) |
| <kbd>B</kbd> | Toggle Arsenal Shop |
| <kbd>Q</kbd> | Agent Ability 1 |
| <kbd>E</kbd> | Agent Ability 2 |
| <kbd>Tab</kbd> | View Match Scoreboard |
| <kbd>☰</kbd> (Top-Right) | Menu & Keybinds Settings |

---

## 🚀 Running the Project

```bash
# 1. Install dependencies
npm install

# 2. Start the game server
npm start

# 3. Open browser at
http://localhost:3000
```

---

## ☁️ Deploying to Render (Cloud Hosting)

This project is fully configured and ready for 1-click deployment on [Render](https://render.com/).

### Method 1: Connect via GitHub (Standard Web Service)
1. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** → **Web Service**.
2. Connect your GitHub repository: `Nishantkashyap751/MultiplayerGame`.
3. Configure the service settings:
   - **Name**: `tactical-multiplayer-game` (or your preferred name)
   - **Region**: Choose the closest region (e.g. Oregon, Frankfurt, Singapore)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
4. Click **Create Web Service**. Render will clone the repository, run `npm install`, and launch the 64Hz WebSocket game server automatically!

### Method 2: Render Blueprint (`render.yaml`)
Render will automatically detect the included [`render.yaml`](render.yaml) file when using **New +** → **Blueprint**. All environment variables and build/start parameters will be configured automatically.


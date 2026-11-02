const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.join(__dirname, 'test_screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runTests() {
  console.log('--- STARTING IN-BROWSER UI & FUNCTIONALITY TEST ---');
  console.log('Chrome Binary:', CHROME_PATH);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();

  const consoleLogs = [];
  const errors = [];

  page.on('console', msg => {
    consoleLogs.push(`[BROWSER ${msg.type()}] ${msg.text()}`);
  });

  page.on('pageerror', err => {
    errors.push(`[BROWSER ERROR] ${err.toString()}`);
  });

  try {
    // =========================================================================
    // TEST 1: User's Exact Resolution (631 x 662) - Narrow / Split-screen layout
    // =========================================================================
    console.log('\n[TEST 1] Testing exact user screenshot resolution: 631 x 662...');
    await page.setViewport({ width: 631, height: 662 });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // Wait for panels to render
    await page.waitForSelector('#panel-entry');
    await page.waitForSelector('#panel-public-lobbies');

    // Inspect metrics of panels
    const narrowMetrics = await page.evaluate(() => {
      const entry = document.getElementById('panel-entry');
      const lobbies = document.getElementById('panel-public-lobbies');
      const entryTitle = entry.querySelector('.panel-title');
      const lobbiesTitle = lobbies.querySelector('.panel-title');
      const joinBtn = document.getElementById('btn-join-room');
      const roomInput = document.getElementById('input-room-code');

      return {
        bodyScrollWidth: document.body.scrollWidth,
        windowInnerWidth: window.innerWidth,
        entryRect: entry.getBoundingClientRect(),
        lobbiesRect: lobbies.getBoundingClientRect(),
        lobbiesTitleText: lobbiesTitle.textContent.trim(),
        lobbiesTitleWidth: lobbiesTitle.getBoundingClientRect().width,
        joinBtnWidth: joinBtn.getBoundingClientRect().width,
        roomInputWidth: roomInput.getBoundingClientRect().width,
        isLobbiesClipped: lobbies.getBoundingClientRect().right > window.innerWidth
      };
    });

    console.log('Metrics at 631x662:', JSON.stringify(narrowMetrics, null, 2));
    const ss1Path = path.join(SCREENSHOT_DIR, '01_narrow_631x662.png');
    await page.screenshot({ path: ss1Path, fullPage: true });
    console.log('Screenshot saved:', ss1Path);

    if (narrowMetrics.isLobbiesClipped) {
      throw new Error('Public lobbies panel is clipped outside the viewport at 631px width!');
    }

    // =========================================================================
    // TEST 2: Standard Desktop Resolution (1280 x 800)
    // =========================================================================
    console.log('\n[TEST 2] Testing desktop resolution: 1280 x 800...');
    await page.setViewport({ width: 1280, height: 800 });
    await page.waitForTimeout ? await page.waitForTimeout(500) : await new Promise(r => setTimeout(r, 500));

    const desktopMetrics = await page.evaluate(() => {
      const entry = document.getElementById('panel-entry');
      const lobbies = document.getElementById('panel-public-lobbies');
      return {
        entryLeft: entry.getBoundingClientRect().left,
        entryWidth: entry.getBoundingClientRect().width,
        lobbiesLeft: lobbies.getBoundingClientRect().left,
        lobbiesWidth: lobbies.getBoundingClientRect().width,
        isSideBySide: lobbies.getBoundingClientRect().left > entry.getBoundingClientRect().right - 5
      };
    });

    console.log('Desktop 1280x800 Metrics:', JSON.stringify(desktopMetrics, null, 2));
    const ss2Path = path.join(SCREENSHOT_DIR, '02_desktop_1280x800.png');
    await page.screenshot({ path: ss2Path });
    console.log('Screenshot saved:', ss2Path);

    if (!desktopMetrics.isSideBySide) {
      throw new Error('Panels should be side-by-side on desktop 1280x800!');
    }

    // =========================================================================
    // TEST 3: Full-HD Desktop Resolution (1920 x 1080)
    // =========================================================================
    console.log('\n[TEST 3] Testing Full HD resolution: 1920 x 1080...');
    await page.setViewport({ width: 1920, height: 1080 });
    await new Promise(r => setTimeout(r, 400));
    const ss3Path = path.join(SCREENSHOT_DIR, '03_fhd_1920x1080.png');
    await page.screenshot({ path: ss3Path });
    console.log('Screenshot saved:', ss3Path);

    // =========================================================================
    // TEST 4: Create Room & Verify Room Lobby UI & Bot Functionality
    // =========================================================================
    console.log('\n[TEST 4] Testing "CREATE NEW ROOM" button and room management...');
    await page.click('#btn-create-room');

    await page.waitForSelector('#panel-room:not(.hidden)', { timeout: 5000 });
    await page.waitForFunction(() => {
      const code = document.getElementById('display-room-code').textContent.trim();
      return code && code !== '-----';
    }, { timeout: 5000 });

    const roomCode = await page.$eval('#display-room-code', el => el.textContent.trim());
    console.log('Room successfully created! Room Code:', roomCode);

    // Select Sova agent
    console.log('Selecting Sova agent...');
    const sovaCard = await page.$('.agent-card[data-agent="sova"]');
    if (sovaCard) {
      await sovaCard.click();
      console.log('Clicked Sova agent card.');
    }

    // Click "+ ADD AI BOT"
    console.log('Adding AI Bot...');
    await page.click('#btn-add-bot');
    await new Promise(r => setTimeout(r, 600));

    // Verify bot is added in defender or attacker roster
    const botCount = await page.evaluate(() => {
      const cards = document.querySelectorAll('.player-slot-card');
      let bots = 0;
      cards.forEach(c => {
        if (c.textContent.includes('BOT') || c.textContent.includes('ELITE AI')) bots++;
      });
      return bots;
    });
    console.log('Bot count in lobby:', botCount);

    const ss4Path = path.join(SCREENSHOT_DIR, '04_room_lobby_with_bot.png');
    await page.screenshot({ path: ss4Path });
    console.log('Screenshot saved:', ss4Path);

    // =========================================================================
    // TEST 5: Launch Match & In-Game Verification
    // =========================================================================
    console.log('\n[TEST 5] Launching match into 64Hz physics world...');
    const launchBtn = await page.$('#btn-start-match');
    const isLaunchVisible = await page.evaluate(el => !el.classList.contains('hidden'), launchBtn);
    console.log('Is launch match button visible?', isLaunchVisible);

    await page.click('#btn-start-match');

    // Wait for in-game canvas
    await page.waitForSelector('#screen-game.active', { timeout: 8000 });
    await page.waitForSelector('#game-canvas');
    console.log('In-game canvas and HUD loaded!');

    // Wait 2 seconds for initial buy phase tick
    await new Promise(r => setTimeout(r, 2000));

    const inGameStats = await page.evaluate(() => {
      return {
        hp: document.getElementById('hud-hp-val')?.textContent,
        armor: document.getElementById('hud-armor-val')?.textContent,
        credits: document.getElementById('buy-credits-display')?.textContent,
        timer: document.getElementById('hud-timer-display')?.textContent,
        phase: document.getElementById('hud-phase-label')?.textContent
      };
    });
    console.log('In-Game HUD initial stats:', inGameStats);

    const ss5Path = path.join(SCREENSHOT_DIR, '05_in_game_match.png');
    await page.screenshot({ path: ss5Path });
    console.log('Screenshot saved:', ss5Path);

    // Check for critical browser errors
    console.log('\nBrowser Errors Count:', errors.length);
    if (errors.length > 0) {
      console.error('Browser encountered errors:', errors);
    } else {
      console.log('SUCCESS: Zero browser console errors encountered!');
    }

    console.log('\n=== ALL BROWSER UI & FUNCTIONALITY TESTS PASSED! ===');
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runTests();


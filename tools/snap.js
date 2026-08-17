const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEMP_PROFILE = path.join(process.env.TEMP, 'cdp_profile_' + Date.now());

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureWithSetup(url, width, height, setupFn, outputPath) {
  console.log(`Starting Chrome for ${width}x${height} -> ${outputPath}...`);
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--remote-debugging-port=9222',
    'about:blank'
  ]);

  await sleep(1500);

  try {
    const versionRes = await fetch('http://localhost:9222/json/version');
    const versionData = await versionRes.json();
    const wsUrl = versionData.webSocketDebuggerUrl;

    const ws = new WebSocket(wsUrl);

    let id = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg);
        callbacks.delete(msg.id);
      }
    };

    await new Promise(resolve => ws.onopen = resolve);

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const msgId = id++;
        callbacks.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    // Create target
    const newTarget = await send('Target.createTarget', { url });
    const targetId = newTarget.result.targetId;

    // Attach to target
    const attached = await send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached.result.sessionId;

    function sendSession(method, params = {}) {
      return new Promise((resolve) => {
        const msgId = id++;
        callbacks.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, sessionId, method, params }));
      });
    }

    await sendSession('Page.enable');
    await sendSession('Runtime.enable');
    await sendSession('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true
    });

    await sendSession('Page.navigate', { url });
    await sleep(2000);

    if (setupFn) {
      await sendSession('Runtime.evaluate', {
        expression: `(${setupFn.toString()})()`,
        awaitPromise: true
      });
      await sleep(800);
    }

    // Take screenshot
    const shot = await sendSession('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    });

    const buffer = Buffer.from(shot.result.data, 'base64');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Saved screenshot to ${outputPath} (${buffer.length} bytes)`);

    ws.close();
  } finally {
    chrome.kill('SIGTERM');
    await sleep(600);
  }
}

async function main() {
  const outputDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const gameSetup = () => {
    // Populate board with blocks for screenshot
    const appEl = document.querySelector('.app') || document.querySelector('.container') || document.body;
    
    // Scale container to fill tablet nicely
    const style = document.createElement('style');
    style.innerHTML = `
      body, html {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      .app, #app, .app-container, main {
        transform: scale(2.2);
        transform-origin: center center;
        margin: auto !important;
      }
    `;
    document.head.appendChild(style);

    const scoreEl = document.getElementById('score') || document.getElementById('current-score');
    if (scoreEl) scoreEl.textContent = '3,480';
    const bestEl = document.getElementById('best') || document.getElementById('best-score');
    if (bestEl) bestEl.textContent = '8,920';

    const cells = document.querySelectorAll('.grid-cell, .cell');
    const colors = ['#5eead4', '#f472b6', '#fbbf24', '#a78bfa', '#a3e635', '#60a5fa', '#fb923c'];
    
    // Fill specific pattern on 8x8 grid
    const pattern = [
      [1, 1, 0, 0, 1, 1, 1, 0],
      [1, 1, 1, 0, 0, 1, 1, 0],
      [0, 1, 1, 1, 0, 0, 1, 1],
      [0, 0, 1, 1, 1, 0, 0, 1],
      [1, 0, 0, 1, 1, 1, 0, 0],
      [1, 1, 0, 0, 1, 1, 1, 0],
      [1, 1, 1, 0, 0, 1, 1, 1],
      [0, 1, 1, 1, 1, 1, 1, 0],
    ];

    if (cells && cells.length >= 64) {
      cells.forEach((cell, idx) => {
        const r = Math.floor(idx / 8);
        const c = idx % 8;
        if (pattern[r] && pattern[r][c]) {
          const color = colors[(r + c) % colors.length];
          cell.style.backgroundColor = color;
          cell.style.boxShadow = `0 0 12px ${color}88, inset 0 0 6px rgba(255,255,255,0.4)`;
          cell.style.borderRadius = '6px';
          cell.classList.add('filled');
          
          if (r === 6 && c === 6) {
            cell.innerHTML = '<span style="font-size:18px; filter:drop-shadow(0 0 4px #ff3366);">💣</span>';
          }
        }
      });
    }
  };

  // 1. 7-inch tablet (1200 x 1920)
  await captureWithSetup(
    'http://localhost:8000/game.html',
    1200,
    1920,
    gameSetup,
    path.join(outputDir, 'screenshot_7inch_tablet_1.png')
  );

  await captureWithSetup(
    'http://localhost:8000/index.html',
    1200,
    1920,
    null,
    path.join(outputDir, 'screenshot_7inch_tablet_2.png')
  );

  // 2. 10-inch tablet (1536 x 2048)
  await captureWithSetup(
    'http://localhost:8000/game.html',
    1536,
    2048,
    gameSetup,
    path.join(outputDir, 'screenshot_10inch_tablet_1.png')
  );

  await captureWithSetup(
    'http://localhost:8000/index.html',
    1536,
    2048,
    null,
    path.join(outputDir, 'screenshot_10inch_tablet_2.png')
  );

  console.log('Finished capturing all tablet screenshots!');
}

main().catch(console.error);

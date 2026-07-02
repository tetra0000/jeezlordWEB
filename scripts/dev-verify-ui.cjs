// One-off UI verification: drive the real client in headless Edge against the
// local test server. Registers a fresh account, screenshots the map, box-selects
// the starting squad (stance panel), and opens the diplomacy modal.
// Usage: node verify-ui.cjs <outDir>
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

const OUT = process.argv[2] ?? 'ui-shots';
mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto('http://localhost:8081', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-form', { timeout: 15000 });

  const user = 'ui_' + Math.floor(Date.now() % 1000000);
  await page.fill('#username', user);
  await page.fill('#password', 'hunter2');
  // The websocket must be open before the register message can be sent.
  await page.waitForFunction(() => document.getElementById('conn-status')?.textContent === 'connected', { timeout: 15000 });
  await page.click('#register-btn');
  try {
    await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  } catch (e) {
    const loginErr = await page.evaluate(() => document.getElementById('login-error')?.textContent);
    const status = await page.evaluate(() => document.getElementById('conn-status')?.textContent);
    const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));
    await page.screenshot({ path: join(OUT, '00-stuck.png') });
    console.error('STUCK AT LOGIN', JSON.stringify({ loginErr, status, hasCanvas, errors }, null, 2));
    throw e;
  }
  await page.waitForTimeout(4000); // let entities arrive + camera centre + render
  await page.screenshot({ path: join(OUT, '01-spawn.png') });

  // Zoom out a little so more terrain is visible.
  const cx = 720, cy = 450;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(150); }
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, '02-zoomed-out.png') });

  // Box-select around the base: grabs the starting scout cavalry squad.
  await page.mouse.move(cx - 250, cy - 200);
  await page.mouse.down();
  await page.mouse.move(cx + 250, cy + 220, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const stanceVisible = await page.evaluate(() => !document.getElementById('stance-panel').classList.contains('hidden'));
  await page.screenshot({ path: join(OUT, '03-selection-stance-panel.png') });

  // Click a stance button if the panel is up.
  if (stanceVisible) {
    await page.click('#stance-panel .sp-stance[data-stance="aggressive"]');
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, '04-stance-set.png') });
  }

  // Diplomacy modal.
  await page.click('#diplo-btn');
  await page.waitForTimeout(400);
  const diploVisible = await page.evaluate(() => !document.getElementById('diplo-modal').classList.contains('hidden'));
  await page.screenshot({ path: join(OUT, '05-diplomacy.png') });

  console.log(JSON.stringify({
    registered: user,
    stancePanelVisible: stanceVisible,
    diploModalVisible: diploVisible,
    consoleErrors: errors.slice(0, 10),
  }, null, 2));
  await browser.close();
})().catch((e) => { console.error('DRIVER FAIL:', e); process.exit(1); });

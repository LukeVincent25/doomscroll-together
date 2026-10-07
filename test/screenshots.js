// Desktop + mobile screenshots of a live room (mp4 mode).
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const PEER = process.env.PEER || 'broadcast';
const OUT = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (pathName, extra = {}) => {
  const u = new URL(pathName, BASE + '/');
  Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
  if (PEER) u.searchParams.set('peer', PEER);
  return u.toString();
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const host = await ctx.newPage();
  await host.goto(q('index.html'));
  await host.click('#mode button[data-mode=mp4]');
  await host.click('#create');
  await host.waitForURL(/room\.html/);
  const code = new URL(host.url()).searchParams.get('room');
  await host.fill('#gateName', 'Skibidi Otter');
  await host.click('#enter');
  await host.waitForFunction(() => window.__ds && __ds.S && __ds.S.me, null, { timeout: 30000 });

  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(q('index.html', { room: code }));
  await mob.waitForURL(/room\.html/);
  await mob.fill('#gateName', 'Rizzler Capybara');
  await mob.click('#enter');
  await mob.waitForFunction(() => window.__ds && __ds.S && __ds.S.me, null, { timeout: 30000 });
  await sleep(2000);

  await host.keyboard.press('ArrowDown'); await sleep(800);
  for (let i = 0; i < 8; i++) {
    await host.evaluate((e) => __ds.react(e), ['💀', '😭', '🔥', '🗿'][i % 4]);
    await sleep(50);
  }
  await host.fill('#chatInput', 'maximum brainrot loading…');
  await host.press('#chatInput', 'Enter');
  await sleep(800);

  await host.screenshot({ path: path.join(OUT, 'room-desktop.png') });
  await mob.screenshot({ path: path.join(OUT, 'room-mobile.png') });
  console.log('wrote', OUT + '/room-desktop.png', OUT + '/room-mobile.png');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

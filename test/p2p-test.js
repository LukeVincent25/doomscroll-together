// Headless Chromium P2P sync test: 1 host + 2 joiners over PeerJS.
// Usage: node test/p2p-test.js [baseUrl]
// Env: PEER=localhost:9000 to use a local PeerJS broker; CHROME=/path/to/chrome
const { chromium } = require('playwright-core');
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const PEER = process.env.PEER || 'broadcast'; // 'broadcast' = same-browser bus (WebRTC UDP blocked on this box); omit / use public broker in prod
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (path, extra = {}) => {
  const u = new URL(path, BASE + '/');
  Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
  if (PEER) u.searchParams.set('peer', PEER);
  return u.toString();
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--use-fake-ui-for-media-stream'],
  });
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`);
    });
  };
  const state = async (p) => p.evaluate(() => ({
    local: __ds.S.local, room: __ds.S.room.index, users: __ds.S.users.length, follow: __ds.S.follow,
    playing: __ds.S.room.playing, role: __ds.S.role, dead: __ds.S.dead,
    clips: __ds.S.clips.length, chat: document.querySelectorAll('#chat .msg').length,
    meter: __ds.S.room ? null : null,
    meterPct: document.querySelector('#meterPct') && document.querySelector('#meterPct').textContent,
    kind: __ds.player && __ds.player.kind, ready: !!(__ds.player && __ds.player.ready),
  }));

  // One shared context so BroadcastChannel (?peer=broadcast) works across pages.
  // (Separate Playwright contexts are isolated profiles; real PeerJS/WebRTC is used in production.)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const host = await ctx.newPage(); watch(host, 'host');

  // create via landing
  await host.goto(q('index.html'));
  await host.click('#mode button[data-mode=mp4]');
  await host.click('#create');
  await host.waitForURL(/room\.html\?.*room=/);
  const roomUrl = host.url();
  const code = new URL(roomUrl).searchParams.get('room');
  console.log('room', code, roomUrl);
  if (!new URL(roomUrl).searchParams.get('host')) errors.push('create did not set host=1');

  await host.fill('#gateName', 'Skibidi Otter');
  await host.click('#enter');
  await host.waitForFunction(() => window.__ds && __ds.S && __ds.S.me, null, { timeout: 30000 });
  await sleep(800);
  console.log('host', await state(host));

  // joiner A (mobile viewport, same context for broadcast bus)
  const a = await ctx.newPage(); watch(a, 'joinerA');
  await a.setViewportSize({ width: 390, height: 844 });
  await a.goto(q('index.html', { room: code }));
  await a.waitForURL(/room\.html/);
  await a.fill('#gateName', 'Rizzler Capybara');
  await a.click('#enter');
  await a.waitForFunction(() => window.__ds && __ds.S && __ds.S.me, null, { timeout: 30000 });

  // joiner B
  const b = await ctx.newPage(); watch(b, 'joinerB');
  await b.setViewportSize({ width: 1000, height: 800 });
  await b.goto(q('room.html', { room: code }));
  await b.fill('#gateName', 'Ohio Pigeon');
  await b.click('#enter');
  await b.waitForFunction(() => window.__ds && __ds.S && __ds.S.me, null, { timeout: 30000 });
  await sleep(1500);

  let hs = await state(host), as = await state(a), bs = await state(b);
  console.log('joined H', hs, '\nA', as, '\nB', bs);
  if (!(hs.users === 3 && as.users === 3 && bs.users === 3)) errors.push('PRESENCE FAIL: expected 3 users');
  if (hs.role !== 'host' || as.role !== 'client' || bs.role !== 'client') errors.push('ROLE FAIL');

  // swipe sync
  await host.keyboard.press('ArrowDown'); await sleep(1000);
  await host.keyboard.press('ArrowDown'); await sleep(2000);
  hs = await state(host); as = await state(a); bs = await state(b);
  console.log('after 2 swipes', hs.local, as.local, bs.local);
  if (!(hs.local === 2 && as.local === 2 && bs.local === 2)) errors.push('SYNC FAIL: not all on clip 3');

  // pause sync
  await host.evaluate(() => document.querySelector('.slide.active .tap').click());
  await sleep(1200);
  as = await state(a);
  console.log('pause: A playing=', as.playing, '(expect false)');
  if (as.playing !== false) errors.push('PAUSE SYNC FAIL');
  await host.evaluate(() => document.querySelector('.slide.active .tap').click());
  await sleep(500);

  // reactions + chat
  await host.fill('#chatInput', 'bro this clip is peak 💀');
  await host.press('#chatInput', 'Enter');
  await a.evaluate(() => { document.querySelector('#chatInput').value = 'ong'; document.querySelector('#chatForm').requestSubmit(); });
  for (let i = 0; i < 12; i++) {
    const pg = [host, a, b][i % 3];
    await pg.evaluate((e) => __ds.react(e), ['💀', '😭', '🔥', '🗿'][i % 4]);
    await sleep(60);
  }
  await sleep(800);
  hs = await state(host); as = await state(a);
  console.log('chat msgs H', hs.chat, 'A', as.chat, 'meter', hs.meterPct);
  if (hs.chat < 2 || as.chat < 2) errors.push('CHAT FAIL');

  // free scroll + rejoin
  await a.click('#syncBtn'); await sleep(400);
  const followA = await a.evaluate(() => __ds.S.follow);
  if (followA !== false) errors.push('FREE SCROLL FAIL: sync toggle did not stick');
  await host.evaluate(() => { document.activeElement && document.activeElement.blur(); __ds.step(1); });
  await sleep(1500);
  as = await state(a); hs = await state(host);
  console.log('free: H', hs.local, 'A', as.local, 'rejoin', await a.isVisible('#rejoin'));
  if (!(as.follow === false && as.local !== hs.local && await a.isVisible('#rejoin'))) errors.push('FREE SCROLL FAIL');
  await a.click('#rejoin'); await sleep(1500);
  as = await state(a);
  if (as.local !== hs.local || as.follow !== true) errors.push('REJOIN FAIL');

  // late joiner lands on current clip
  const c = await ctx.newPage(); watch(c, 'late');
  await c.setViewportSize({ width: 900, height: 700 });
  await c.goto(q('room.html', { room: code }));
  await c.fill('#gateName', 'Late Llama');
  await c.click('#enter');
  await c.waitForFunction(() => window.__ds && __ds.S && __ds.S.me, null, { timeout: 30000 });
  await sleep(1200);
  const cs = await state(c); hs = await state(host);
  console.log('late join C', cs.local, 'H', hs.local, 'users', cs.users);
  if (cs.local !== hs.local) errors.push('LATE JOIN FAIL: wrong clip');
  if (cs.users < 4) errors.push('LATE JOIN FAIL: presence');

  // add clip (mp4 URL — always works offline)
  await host.click('#addBtn');
  await host.fill('#addUrl', new URL('media/bunny-aura.mp4', BASE + '/').toString());
  await host.click('#addForm button[data-next="1"]');
  await sleep(2000);
  const clipsBefore = hs.clips;
  hs = await state(host); as = await state(a);
  console.log('add clip', clipsBefore, '->', hs.clips, as.clips, 'err', await host.textContent('#addErr'));
  if (!(hs.clips === clipsBefore + 1 && as.clips === hs.clips)) errors.push('ADD CLIP FAIL');

  // host leave (explicit leave so BroadcastChannel notifies joiners; then close)
  await host.evaluate(() => { try { __ds.sock && __ds.sock.leave(); } catch {} });
  await sleep(500);
  await host.close();
  await sleep(1500);
  const gone = await a.evaluate(() => !!document.getElementById('hostGone') || __ds.S.dead);
  console.log('host left overlay?', gone);
  if (!gone) errors.push('HOST LEFT FAIL');

  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.some((e) => /FAIL|pageerror/.test(e)) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

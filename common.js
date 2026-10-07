// shared helpers for landing + room
const DS = (() => {
  const ADJ = ['Happy', 'Lucky', 'Cozy', 'Sunny', 'Zippy', 'Jolly', 'Breezy', 'Goofy', 'Sparky', 'Chipper', 'Cosmic', 'Mellow', 'Peppy', 'Snazzy', 'Wiggly', 'Dandy', 'Quirky', 'Bubbly', 'Zesty', 'Plucky', 'Giddy', 'Nifty', 'Rowdy', 'Lowkey', 'Cracked'];
  const ANIMALS = ['Otter', 'Capybara', 'Goose', 'Penguin', 'Raccoon', 'Possum', 'Llama', 'Frog', 'Shrimp', 'Pigeon', 'Hamster', 'Axolotl', 'Sloth', 'Gremlin', 'Crab', 'Walrus', 'Moth', 'Ferret', 'Goblin', 'Duck', 'Chinchilla', 'Platypus'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const randomName = () => `${pick(ADJ)} ${pick(ANIMALS)}`;
  const getName = () => { try { return localStorage.getItem('ds:name') || randomName(); } catch { return randomName(); } };
  const saveName = (n) => { try { localStorage.setItem('ds:name', n); } catch {} };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // only ever put #rrggbb colours into style attributes (data from peers is untrusted)
  const col = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? c : '#888888');

  // room codes: 4 letters, no I/O to avoid confusion
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const newCode = () => Array.from({ length: 4 }, () => pick(CODE_CHARS.split(''))).join('');
  const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  // base URL of the app (works at / locally and at /doomscroll-together/ on GitHub Pages)
  const baseUrl = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const inviteLink = (code) => baseUrl() + '?room=' + encodeURIComponent(code);

  // ---------- PeerJS config (same approach as Bean Hunt) ----------
  // Production uses the free public PeerJS broker (0.peerjs.com). For local testing you can point at your own
  // `npx peer --port 9000` with window.DOOMSCROLL_PEER = { host: 'localhost', port: 9000, path: '/', secure: false }
  // or the URL param ?peer=localhost:9000. Extra ICE servers (e.g. your own TURN) go in window.DOOMSCROLL_ICE.
  const PEER_PREFIX = 'doomscroll-together-v1-';
  const hostPeerId = (code) => PEER_PREFIX + normCode(code).toLowerCase();
  function iceServers() {
    const def = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }];
    return Array.isArray(window.DOOMSCROLL_ICE) ? def.concat(window.DOOMSCROLL_ICE) : def;
  }
  function peerOptions() {
    const o = { debug: 0, config: { iceServers: iceServers(), sdpSemantics: 'unified-plan' } };
    let over = window.DOOMSCROLL_PEER;
    const q = new URLSearchParams(location.search).get('peer');
    if (!over && q && /^[a-z0-9.-]+:\d+$/i.test(q)) { const [host, port] = q.split(':'); over = { host, port: Number(port), path: '/', secure: false }; }
    return over ? { ...o, ...over } : o;
  }
  return { randomName, getName, saveName, esc, col, pick, newCode, normCode, baseUrl, inviteLink, hostPeerId, peerOptions, iceServers, PEER_PREFIX };
})();

// Doomscroll Together: room host. This is the old Express + Socket.IO server logic, ported to run in the
// browser of whoever hosts the room. It holds the authoritative room state (queue, current clip, playback
// clock, members, chat history, brainrot meter) and talks to "sockets": one loopback socket for the host's
// own UI plus one per PeerJS data connection. Clocks are the host's Date.now().
const RoomHost = (() => {
  const MP4_SEEDS = [
    { file: 'bunny-aura', title: 'POV: the bunny has +1000 aura', author: 'Big Buck Bunny (CC-BY Blender Foundation)' },
    { file: 'skibidi-freq', title: 'skibidi frequencies (do not scroll)', author: 'doomscroll-together' },
    { file: 'sintel-sigma', title: 'sigma grindset at 3am', author: 'Sintel (CC-BY Blender Foundation)' },
    { file: 'brain-cells', title: 'my last 2 brain cells leaving rn', author: 'doomscroll-together' },
    { file: 'wifi-back', title: 'when the wifi comes back', author: 'Big Buck Bunny (CC-BY Blender Foundation)' },
    { file: 'ohio-life', title: 'ohio cellular automata', author: 'doomscroll-together' },
  ].map((m) => ({ type: 'mp4', src: `media/${m.file}.mp4`, poster: `media/${m.file}.jpg`, title: m.title, author: m.author }));

  const AVATARS = ['🦦', '🐸', '🦆', '🐒', '🦝', '🐧', '🦙', '🐌', '🦀', '🐙', '🦈', '🐹', '🦥', '🐊', '🦩', '🐗', '🦫', '🐓'];
  const COLORS = ['#ff2bd6', '#00f0ff', '#39ff14', '#ffe600', '#ff7a00', '#b026ff', '#ff3864', '#00ffa3'];
  const EMOJIS = ['💀', '😭', '🔥', '🗿', '🤡', '😂', '🥶', '💅', '🤯', '👀'];
  const MAX_USERS = 30;
  const pickFree = (pool, used) => { const free = pool.filter((x) => !used.includes(x)); const src = free.length ? free : pool; return src[Math.floor(Math.random() * src.length)]; };
  const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  let seedsPromise = null;
  const loadSeeds = () => (seedsPromise ||= fetch('data/seeds.json').then((r) => r.json()).then((j) => (j.clips || []).filter((c) => c && /^[A-Za-z0-9_-]{11}$/.test(c.videoId))).catch(() => []));

  // restore: optional room state carried over from a previous host (host migration)
  async function create({ code, mode, restore }) {
    const ytSeeds = await loadSeeds();
    const tag = Math.random().toString(36).slice(2, 6);
    let clipSeq = 0;
    const withId = (c, addedBy = '🤖 algorithm') => ({ ...c, id: 'c' + tag + (++clipSeq).toString(36), addedBy });
    function buildFeed(m) {
      if (m === 'mp4' || ytSeeds.length === 0) return shuffle(MP4_SEEDS).map((c) => withId(c));
      // YouTube shorts mix, with an offline-safe MP4 slipped in every 6th slot
      const yt = shuffle(ytSeeds).slice(0, 30), mp4 = shuffle(MP4_SEEDS), out = [];
      yt.forEach((c, i) => { out.push(withId(c)); if (i % 6 === 4 && mp4.length) out.push(withId(mp4.shift())); });
      return out;
    }

    const room = {
      code, mode: mode === 'mp4' ? 'mp4' : 'yt', createdAt: Date.now(),
      clips: [], index: 0, playing: true, position: 0, updatedAt: Date.now(),
      users: new Map(), chat: [], meter: 0, maxedCount: 0,
    };
    if (restore && Array.isArray(restore.clips) && restore.clips.length) {
      room.mode = restore.mode === 'mp4' ? 'mp4' : 'yt';
      room.clips = restore.clips.slice(0, 500);
      room.index = Math.min(Math.max(0, restore.index | 0), room.clips.length - 1);
      room.playing = restore.playing !== false; room.position = Math.max(0, Number(restore.position) || 0);
      room.chat = Array.isArray(restore.chat) ? restore.chat.slice(-200) : [];
      room.meter = Math.min(100, Math.max(0, Number(restore.meter) || 0));
      room.maxedCount = restore.maxedCount | 0;
    } else room.clips = buildFeed(room.mode);

    const socks = new Map(); // id -> { emit(ev, d) }
    const livePosition = () => room.position + (room.playing ? (Date.now() - room.updatedAt) / 1000 : 0);
    const publicUsers = () => [...room.users.values()];
    const snapshot = () => ({
      code: room.code, mode: room.mode, clips: room.clips, index: room.index, playing: room.playing, maxedCount: room.maxedCount,
      position: livePosition(), serverNow: Date.now(), users: publicUsers(), chat: room.chat.slice(-50), meter: room.meter,
    });
    // io.to(room).emit / socket.to(room).emit equivalents (only joined sockets receive room events)
    const broadcast = (ev, d, exceptId) => { for (const [id, s] of socks) if (id !== exceptId && room.users.has(id)) { try { s.emit(ev, d); } catch {} } };
    const sys = (text) => { const m = { id: Date.now() + Math.random(), sys: true, text, at: Date.now() }; room.chat.push(m); if (room.chat.length > 200) room.chat.shift(); broadcast('chat', m); };
    const skip = (by) => {
      room.index = (room.index + 1) % room.clips.length;
      room.position = 0; room.playing = true; room.updatedAt = Date.now();
      broadcast('nav', { index: room.index, dir: 'down', by, auto: true, at: room.updatedAt, users: publicUsers() });
    };

    // connect a socket: returns { handle(ev, data, ack), disconnect() }
    function connect(sock, { isHost = false } = {}) {
      socks.set(sock.id, sock);
      let me = null;
      const reactTimes = [], msgTimes = [];
      const H = {};

      H.join = ({ name, prev } = {}, ack) => {
        if (me) return ack && ack({ error: 'already joined' });
        if (room.users.size >= MAX_USERS) return ack && ack({ error: `room is full (${MAX_USERS} max)` });
        const others = publicUsers();
        // name dedupe: "Sigma Otter" -> "Sigma Otter 2"
        let base = clean(name, 24) || 'Anonymous Goober', nm = base, n = 2;
        while (others.some((u) => u.name.toLowerCase() === nm.toLowerCase())) nm = `${base.slice(0, 21)} ${n++}`;
        const usedAv = others.map((u) => u.avatar), usedCol = others.map((u) => u.color);
        const p = prev && typeof prev === 'object' ? prev : {};
        me = {
          id: sock.id, name: nm, host: !!isHost,
          avatar: AVATARS.includes(p.avatar) && !usedAv.includes(p.avatar) ? p.avatar : pickFree(AVATARS, usedAv),
          color: COLORS.includes(p.color) && !usedCol.includes(p.color) ? p.color : pickFree(COLORS, usedCol),
          viewing: room.index, free: false, joinedAt: Number(p.joinedAt) > 0 && Number(p.joinedAt) <= Date.now() ? Number(p.joinedAt) : Date.now(),
        };
        room.users.set(sock.id, me);
        ack && ack({ me, state: snapshot(), emojis: EMOJIS });
        broadcast('presence', { type: 'join', user: me, users: publicUsers() }, sock.id);
        if (!p.quiet) sys(`${me.avatar} ${me.name} entered the brainrot${isHost && !restore ? ' (hosting 👑)' : ''}`);
      };

      // scroll / swipe to a clip
      H.nav = ({ index, dir } = {}) => {
        index = Number(index);
        if (!Number.isInteger(index) || index < 0 || index >= room.clips.length) return;
        me.viewing = index; me.free = false;
        if (index === room.index) return;
        room.index = index; room.position = 0; room.playing = true; room.updatedAt = Date.now();
        broadcast('nav', { index, dir: dir === 'up' ? 'up' : 'down', by: me, at: room.updatedAt, users: publicUsers() });
      };

      // free-scroll users report what they are looking at (for presence only)
      H.viewing = ({ index, free } = {}) => {
        if (!Number.isInteger(index) || index < 0 || index >= room.clips.length) return;
        me.viewing = index; me.free = !!free;
        broadcast('presence', { type: 'update', user: me, users: publicUsers() });
      };

      H.playback = ({ playing, position, index } = {}) => {
        if (index !== undefined && index !== room.index) return; // stale
        const pos = Number(position);
        room.playing = !!playing;
        room.position = Number.isFinite(pos) ? Math.min(Math.max(0, pos), 24 * 3600) : 0;
        room.updatedAt = Date.now();
        broadcast('playback', { playing: room.playing, position: room.position, at: room.updatedAt, index: room.index, by: me }, sock.id);
      };

      // a client finished the current clip -> autoscroll everyone once (deduped by index)
      H.ended = ({ index } = {}) => {
        if (index !== room.index) return;
        skip({ name: 'autoscroll', avatar: '🤖', color: '#888888' });
      };

      // someone's player can't embed this clip at all (YT error 100/101/150) -> skip it for everyone
      H.broken = ({ index, clipId } = {}) => {
        const c = room.clips[index];
        if (!c || c.id !== clipId || index !== room.index) return;
        c.broken = true;
        skip({ name: 'skip-bot (clip would not embed)', avatar: '🚫', color: '#888888' });
      };

      H.react = ({ emoji } = {}) => {
        if (!EMOJIS.includes(emoji)) return;
        const now = Date.now();
        while (reactTimes.length && now - reactTimes[0] > 1000) reactTimes.shift();
        if (reactTimes.length >= 10) return; // 10/s per user
        reactTimes.push(now);
        room.meter = Math.min(100, room.meter + 2.5);
        let maxed = false;
        if (room.meter >= 100) { maxed = true; room.maxedCount++; room.meter = 35; }
        broadcast('react', { emoji, by: { id: me.id, name: me.name, avatar: me.avatar, color: me.color }, meter: room.meter, maxed, x: Math.random() });
        if (maxed) sys(`🧠💥 MAXIMUM BRAINROT ACHIEVED (x${room.maxedCount}) — ${me.name} delivered the final blow`);
      };

      H.chat = ({ text } = {}) => {
        text = clean(text, 280);
        if (!text) return;
        const m = { id: Date.now() + Math.random(), text, at: Date.now(), by: { id: me.id, name: me.name, avatar: me.avatar, color: me.color } };
        room.chat.push(m); if (room.chat.length > 200) room.chat.shift();
        broadcast('chat', m);
      };

      H.rename = ({ name } = {}) => {
        const n = clean(name, 24); if (!n || n === me.name) return;
        if (publicUsers().some((u) => u !== me && u.name.toLowerCase() === n.toLowerCase())) return sock.emit('chat', { id: Date.now() + Math.random(), sys: true, text: `“${n}” is taken, pick another /nick`, at: Date.now() });
        const old = me.name; me.name = n;
        broadcast('presence', { type: 'update', user: me, users: publicUsers() });
        sys(`${old} is now known as ${n}`);
      };

      let adding = 0;
      H.addClip = async ({ url, next } = {}, ack) => {
        const reply = (x) => typeof ack === 'function' && ack(x);
        if (adding >= 2) return reply({ error: 'slow down, one clip at a time 😵' });
        adding++;
        let res;
        try { res = await YTX.resolveClip(String(url || '').slice(0, 500)); } finally { adding--; }
        if (res.error) return reply({ error: res.error });
        if (!room.users.has(sock.id)) return;
        const c = withId(res.clip, me.name);
        const at = next ? room.index + 1 : room.clips.length;
        room.clips.splice(at, 0, c);
        if (room.index >= at) room.index++; // never happens (at > index), kept for safety
        broadcast('queue', { clips: room.clips, index: room.index, added: c, at, by: me });
        sys(`${me.avatar} ${me.name} added “${c.title.slice(0, 60)}” ${next ? 'up next' : 'to the queue'}`);
        reply({ ok: true, clip: c, at });
      };

      H['ping-time'] = (t, ack) => typeof ack === 'function' && ack(Date.now());

      return {
        handle(ev, data, ack) {
          if (!Object.prototype.hasOwnProperty.call(H, ev)) return;
          // flood guard: max 40 messages per second per peer
          const now = Date.now();
          while (msgTimes.length && now - msgTimes[0] > 1000) msgTimes.shift();
          if (msgTimes.length >= 40) return;
          msgTimes.push(now);
          if (ev !== 'join' && ev !== 'ping-time' && !me) return;
          try { const r = H[ev](data && typeof data === 'object' ? data : {}, typeof ack === 'function' ? ack : null); if (r && r.catch) r.catch((e) => console.error(e)); }
          catch (e) { console.error('[host]', ev, e); }
        },
        disconnect(quiet) {
          socks.delete(sock.id);
          if (!me || !room.users.has(sock.id)) return;
          room.users.delete(sock.id);
          broadcast('presence', { type: 'leave', user: me, users: publicUsers() });
          if (!quiet) sys(`${me.avatar} ${me.name} touched grass (left)`);
        },
      };
    }

    // meter decay
    const decayT = setInterval(() => {
      if (room.meter > 0 && room.users.size) { room.meter = Math.max(0, room.meter - 1.5); broadcast('meter', { meter: room.meter }); }
    }, 1000);

    return { room, connect, snapshot, destroy: () => clearInterval(decayT), EMOJIS };
  }
  return { create, EMOJIS, AVATARS, COLORS };
})();

/* Doomscroll Together — room client (PeerJS / host-authoritative) */
(() => {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const code = DS.normCode(params.get('room') || params.get('code') || '');
  const wantHost = params.get('host') === '1' || params.get('host') === 'true';
  const wantMode = params.get('mode') === 'mp4' ? 'mp4' : 'yt';
  if (!code) { location.href = 'index.html'; return; }
  document.title = `${code} · Doomscroll Together`;
  $('#code').textContent = code; $('#gateCode').textContent = code;
  $('#backLink').href = 'index.html';
  $('#miniLogo').href = 'index.html';

  // ---------- state ----------
  const S = {
    me: null, users: [], clips: [], emojis: [],
    room: { index: 0, playing: true, position: 0, updatedAt: 0 },
    local: 0, follow: true, muted: true, wantSound: false,
    offset: 0, unread: 0, chatOpen: false, role: null, dead: false,
  };
  const serverNow = () => Date.now() + S.offset;
  const expectedPos = () => S.room.position + (S.room.playing ? (serverNow() - S.room.updatedAt) / 1000 : 0);
  const isMobile = () => matchMedia('(max-width: 899px)').matches;
  let sock = null; // { emit, leave, role, code }

  // ---------- gate ----------
  const gateName = $('#gateName');
  gateName.value = DS.getName();
  $('#gateReroll').onclick = () => (gateName.value = DS.randomName());
  $('#gateInfo').textContent = wantHost
    ? (wantMode === 'mp4' ? 'you’re hosting · Offline-safe MP4s' : 'you’re hosting · Dark humor mix — keep this tab open')
    : 'connecting to the host’s browser — they must keep their tab open';
  gateName.addEventListener('keydown', (e) => e.key === 'Enter' && $('#enter').click());
  $('#enter').onclick = () => {
    const name = gateName.value.trim() || DS.randomName();
    DS.saveName(name);
    S.wantSound = true; S.muted = false;
    $('#enter').disabled = true; $('#enter').textContent = wantHost ? 'opening room…' : 'joining…';
    start(name);
  };

  function showHostLeft(msg) {
    S.dead = true;
    try { sock && sock.leave(); } catch {}
    sock = null;
    const overlay = document.createElement('div');
    overlay.className = 'gate'; overlay.id = 'hostGone';
    overlay.innerHTML = `<div class="card gate-card">
      <div class="logo-emoji small">💀</div>
      <h2>Host left the room</h2>
      <p class="muted">${DS.esc(msg || 'The host closed their tab (or the connection dropped).')}</p>
      <p class="muted">Peer-to-peer rooms live in the host’s browser — start a new one and share a fresh invite.</p>
      <a class="btn primary big" href="index.html">Start a new room</a>
    </div>`;
    document.body.appendChild(overlay);
  }

  async function start(name) {
    const onError = (msg) => {
      $('#enter').disabled = false; $('#enter').textContent = 'Enter the dark side 💀';
      $('#gateInfo').textContent = '🚫 ' + msg;
      toast('🚫 ' + msg);
    };
    try {
      if (wantHost) {
        sock = await Net.host(code, wantMode, { onError });
      } else {
        sock = await Net.join(code, { onError, onHostGone: (m) => showHostLeft(m) });
      }
      if (!sock) return;
      S.role = sock.role();
      // if host had to pick a new code (id collision), update the UI + URL
      if (S.role === 'host' && sock.code() !== code) {
        const c = sock.code();
        history.replaceState(null, '', 'room.html?room=' + encodeURIComponent(c) + '&host=1&mode=' + wantMode + (params.get('peer') ? '&peer=' + encodeURIComponent(params.get('peer')) : ''));
        document.title = c + ' · Doomscroll Together';
        $('#code').textContent = c; $('#gateCode').textContent = c;
      }
      connectUI(name);
    } catch (e) {
      console.error(e);
      onError(e.message || 'failed to connect');
    }
  }

  function connectUI(name) {
    // wire event fan-in from Net
    const handlers = {};
    sock.on({
      on(ev, data) { const fn = handlers[ev]; if (fn) try { fn(data); } catch (e) { console.error(e); } },
    });
    const on = (ev, fn) => { handlers[ev] = fn; };

    on('nav', onNav);
    on('playback', onPlayback);
    on('presence', ({ type, user, users }) => {
      S.users = users; renderPeople();
      if (type === 'join' && user && S.me && user.id !== S.me.id) toast(`${user.avatar} ${DS.esc(user.name)} joined`);
    });
    on('react', onReact);
    on('meter', ({ meter }) => setMeter(meter));
    on('chat', (m) => addChat(m));
    on('queue', ({ clips, added, at, by }) => {
      S.clips = clips; insertSlide(added, at);
      if (by && S.me && by.id !== S.me.id) toast(`${by.avatar} ${DS.esc(by.name)} added a clip ${at === S.room.index + 1 ? 'up next ⏭' : ''}`);
      updateRejoin();
    });

    const t0 = Date.now();
    sock.emit('join', { name }, (res) => {
      if (!res || res.error) { toast('🚫 ' + ((res && res.error) || 'join failed')); return; }
      // for host, offset is 0 (host clock === server); for clients, estimate
      if (S.role === 'client') {
        const rtt = Date.now() - t0;
        S.offset = res.state.serverNow - (t0 + rtt / 2);
      } else S.offset = 0;
      $('#gate').classList.add('bye');
      setTimeout(() => { try { $('#gate').remove(); } catch {} }, 400);
      S.me = res.me; S.emojis = res.emojis;
      buildReactBar();
      applyState(res.state, false);
      (res.state.chat || []).forEach((m) => addChat(m, true));
      toast(`👋 welcome ${S.me.avatar} ${S.me.name}${S.role === 'host' ? ' · you are the host 👑' : ''}`);
      if (S.role === 'host') toast('🔗 share the invite — keep this tab open', 4000);
    });

    // periodic ping to keep offset fresh for clients
    if (S.role === 'client') setInterval(() => {
      if (S.dead || !sock) return;
      const a = Date.now();
      sock.emit('ping-time', {}, (t) => { if (typeof t === 'number') S.offset = t - (a + (Date.now() - a) / 2); });
    }, 10000);
  }

  function applyState(st, reconnect) {
    S.room = { index: st.index, playing: st.playing, position: st.position, updatedAt: st.serverNow };
    S.users = st.users; renderPeople(); setMeter(st.meter);
    if (!reconnect || S.clips.length !== st.clips.length) { S.clips = st.clips; renderFeed(); }
    if (S.follow) goTo(st.index, false);
  }

  // ---------- feed rendering ----------
  const feed = $('#feed');
  function slideHTML(c) {
    const thumb = c.type === 'yt' ? `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg` : (c.poster || '');
    return `<div class="slide${c.type === 'yt' && c.vertical === false ? ' landscape' : ''}" data-id="${DS.esc(c.id)}">
      <div class="poster" style="${thumb ? `background-image:url('${DS.esc(thumb)}')` : ''}"></div>
      <div class="player-host"></div>
      <div class="tap" title="tap to play / pause"></div>
      <div class="paused-icon">⏸</div>
      <div class="caption">
        <div class="cap-title">${DS.esc(c.title || 'untitled clip')}</div>
        <div class="cap-meta">${c.type === 'yt' ? '▶️' : '📼'} ${DS.esc(c.author || '')}${c.addedBy && !String(c.addedBy).startsWith('🤖') ? ` · added by <b>${DS.esc(c.addedBy)}</b>` : ''}</div>
      </div>
      <div class="progress"><i></i></div>
      <div class="slide-num"></div>
    </div>`;
  }
  function renderFeed() {
    destroyPlayer();
    feed.innerHTML = S.clips.map(slideHTML).join('');
    numberSlides();
  }
  function insertSlide(c, at) {
    const tmp = document.createElement('div'); tmp.innerHTML = slideHTML(c);
    const el = tmp.firstElementChild;
    const ref = feed.children[at];
    const keepTop = at <= S.local;
    feed.insertBefore(el, ref || null);
    if (keepTop) { S.local++; if (player) player.index = S.local; programmatic = true; feed.scrollTop = S.local * feed.clientHeight; }
    numberSlides();
  }
  function numberSlides() {
    [...feed.children].forEach((s, i) => (s.querySelector('.slide-num').textContent = `${i + 1}/${feed.children.length}`));
  }
  const slideEl = (i) => feed.children[i];

  // ---------- scrolling ----------
  let programmatic = false, settleT = null;
  function goTo(i, smooth = true) {
    if (i < 0 || i >= feed.children.length) return;
    programmatic = true;
    feed.scrollTo({ top: i * feed.clientHeight, behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth) programmatic = false;
    activate(i);
    clearTimeout(settleT); settleT = setTimeout(() => (programmatic = false), smooth ? 900 : 50);
  }
  feed.addEventListener('scroll', () => { clearTimeout(settleT); settleT = setTimeout(onSettle, 140); }, { passive: true });
  function onSettle() {
    const i = Math.round(feed.scrollTop / feed.clientHeight);
    if (programmatic) { programmatic = false; if (i === S.local) return; }
    if (i === S.local) return;
    userNav(i);
  }
  function userNav(i) {
    if (i < 0 || i >= S.clips.length || S.dead || !sock) return;
    const dir = i > S.local ? 'down' : 'up';
    activate(i);
    if (S.follow) {
      S.room = { ...S.room, index: i, position: 0, playing: true, updatedAt: serverNow() };
      sock.emit('nav', { index: i, dir });
    } else sock.emit('viewing', { index: i, free: true });
    updateRejoin();
  }
  function step(d) {
    const i = Math.max(0, Math.min(S.clips.length - 1, S.local + d));
    if (i === S.local) return;
    programmatic = true;
    feed.scrollTo({ top: i * feed.clientHeight, behavior: 'smooth' });
    userNav(i);
  }
  $('#navUp').onclick = () => step(-1);
  $('#navDown').onclick = () => step(1);
  addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (['ArrowDown', 'j', 'PageDown'].includes(e.key)) { e.preventDefault(); step(1); }
    else if (['ArrowUp', 'k', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'm') toggleMute();
    else { const n = Number(e.key); if (n >= 1 && n <= S.emojis.length) react(S.emojis[n - 1]); }
  });
  addEventListener('resize', () => { feed.scrollTop = S.local * feed.clientHeight; });

  function onNav({ index, dir, by, at }) {
    S.room = { ...S.room, index, position: 0, playing: true, updatedAt: at };
    const mine = by && by.id && S.me && by.id === S.me.id;
    if (!mine) {
      if (by && by.id) flashUser(by.id);
      toast(`${by && by.avatar || ''} <b style="color:${DS.col(by && by.color)}">${DS.esc(by && by.name || '')}</b> ${by && by.id ? 'swiped' : ''} ${dir === 'up' ? '⬆️' : '⬇️'}`, 1600);
      if (S.follow) goTo(index, true);
    }
    updateRejoin();
  }

  // ---------- players ----------
  let player = null;
  let ytReady = null;
  function loadYT() {
    if (ytReady) return ytReady;
    ytReady = new Promise((res, rej) => {
      if (window.YT && window.YT.Player) return res(window.YT);
      window.onYouTubeIframeAPIReady = () => res(window.YT);
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = rej;
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('yt timeout')), 12000);
    });
    return ytReady;
  }
  loadYT().catch(() => {});

  function destroyPlayer() {
    if (!player) return;
    const p = player; player = null;
    try { if (p.yt) p.yt.destroy(); } catch {}
    if (p.video) { p.video.pause(); p.video.removeAttribute('src'); p.video.load(); }
    if (p.slide) { p.slide.classList.remove('active', 'playing', 'is-paused', 'ready'); const h = p.slide.querySelector('.player-host'); if (h) h.innerHTML = ''; }
  }

  function activate(i) {
    const slide = slideEl(i), clip = S.clips[i];
    if (!slide || !clip) return;
    if (player && player.index === i && player.clip.id === clip.id) { S.local = i; return; }
    destroyPlayer();
    S.local = i;
    slide.classList.add('active');
    const host = slide.querySelector('.player-host');
    const startAt = S.follow && S.room.index === i ? Math.max(0, expectedPos()) : 0;
    const shouldPlay = S.follow && S.room.index === i ? S.room.playing : true;
    const p = { clip, index: i, slide, ready: false };
    player = p;
    if (clip.type === 'mp4') {
      const v = document.createElement('video');
      v.src = clip.src; v.playsInline = true; v.preload = 'auto'; v.muted = S.muted; v.poster = clip.poster || '';
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      host.appendChild(v);
      p.video = v; p.kind = 'mp4';
      v.addEventListener('loadedmetadata', () => {
        p.ready = true; slide.classList.toggle('landscape', v.videoWidth > v.videoHeight); slide.classList.add('ready');
        if (startAt > 0.3 && startAt < v.duration) v.currentTime = startAt;
        if (shouldPlay) safePlay(); else setPausedUI(true);
      });
      v.addEventListener('ended', () => onEnded(p));
      v.addEventListener('play', () => setPausedUI(false));
      v.addEventListener('pause', () => setPausedUI(true));
    } else {
      p.kind = 'yt';
      const div = document.createElement('div'); host.appendChild(div);
      loadYT().then((YT) => {
        if (player !== p) return;
        p.yt = new YT.Player(div, {
          videoId: clip.videoId, width: '100%', height: '100%',
          playerVars: { autoplay: shouldPlay ? 1 : 0, controls: 0, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1, mute: S.muted ? 1 : 0, start: Math.floor(startAt), origin: location.origin },
          events: {
            onReady: () => {
              if (player !== p) return;
              p.ready = true; slide.classList.add('ready');
              if (S.muted) p.yt.mute(); else p.yt.unMute();
              if (startAt > 1) p.yt.seekTo(startAt, true);
              if (shouldPlay) safePlay(); else { p.yt.pauseVideo(); setPausedUI(true); }
            },
            onStateChange: (e) => {
              if (player !== p) return;
              if (e.data === YT.PlayerState.ENDED) onEnded(p);
              else if (e.data === YT.PlayerState.PLAYING) setPausedUI(false);
              else if (e.data === YT.PlayerState.PAUSED) setPausedUI(true);
            },
            onError: (e) => {
              if (player !== p) return;
              slide.classList.add('broken');
              slide.querySelector('.caption .cap-title').insertAdjacentHTML('beforebegin', `<div class="broken-msg">🚫 this clip won't embed (YT error ${e.data}) — skipping…</div>`);
              if ([100, 101, 150].includes(e.data) && S.follow && sock) setTimeout(() => sock.emit('broken', { index: p.index, clipId: clip.id }), 1200);
            },
          },
        });
      }).catch(() => {
        if (player !== p) return;
        slide.classList.add('broken');
        slide.querySelector('.caption .cap-title').insertAdjacentHTML('beforebegin', `<div class="broken-msg">📵 YouTube couldn't load on this device/network. Swipe on (offline MP4 clips still play) or make an “Offline-safe MP4s” room.</div>`);
      });
    }
  }

  const getTime = () => !player || !player.ready ? 0 : player.video ? player.video.currentTime : (player.yt.getCurrentTime ? player.yt.getCurrentTime() : 0);
  const getDur = () => !player || !player.ready ? 0 : player.video ? player.video.duration || 0 : (player.yt.getDuration ? player.yt.getDuration() : 0);
  const isPlaying = () => !player || !player.ready ? false : player.video ? !player.video.paused : player.yt.getPlayerState && [1, 3].includes(player.yt.getPlayerState());
  function seek(t) { if (!player || !player.ready) return; if (player.video) player.video.currentTime = t; else player.yt.seekTo(t, true); }
  function pause() { if (!player || !player.ready) return; if (player.video) player.video.pause(); else player.yt.pauseVideo(); setPausedUI(true); }
  function safePlay() {
    if (!player || !player.ready) return;
    const p = player;
    if (p.video) {
      p.video.muted = S.muted;
      p.video.play().catch(() => { if (!S.muted) { setMuted(true); p.video.play().catch(() => setPausedUI(true)); } });
    } else {
      p.yt.playVideo();
      if (!S.muted) setTimeout(() => {
        if (player === p && S.room.playing && p.yt.getPlayerState && ![1, 3].includes(p.yt.getPlayerState())) { setMuted(true); p.yt.playVideo(); }
      }, 1800);
    }
  }
  function setPausedUI(paused) { if (player) { player.slide.classList.toggle('is-paused', paused); player.slide.classList.toggle('playing', !paused); } }

  function onEnded(p) {
    if (S.follow && S.room.index === p.index && sock) sock.emit('ended', { index: p.index });
    else { seek(0); safePlay(); }
  }

  feed.addEventListener('click', (e) => {
    const slide = e.target.closest('.slide'); if (!slide || !player || slide !== player.slide) return;
    if (e.target.closest('.progress')) {
      const r = e.target.closest('.progress').getBoundingClientRect();
      const t = ((e.clientX - r.left) / r.width) * getDur();
      seek(t); emitPlayback(isPlaying(), t);
      return;
    }
    if (e.target.closest('.tap')) togglePlay();
  });
  function togglePlay() {
    if (!player || !player.ready) return;
    const playing = isPlaying();
    if (playing) pause(); else safePlay();
    emitPlayback(!playing, getTime());
    burst(playing ? '⏸' : '▶️');
  }
  function emitPlayback(playing, position) {
    if (!S.follow || !sock) return;
    S.room = { ...S.room, playing, position, updatedAt: serverNow() };
    sock.emit('playback', { playing, position, index: S.local });
  }
  function onPlayback({ playing, position, at, index, by }) {
    S.room = { ...S.room, playing, position, updatedAt: at, index };
    if (!S.follow || index !== S.local || !player || !player.ready) return;
    if (Math.abs(getTime() - expectedPos()) > 1) seek(expectedPos());
    if (playing && !isPlaying()) safePlay(); else if (!playing && isPlaying()) pause();
    if (by) toast(`${by.avatar} ${DS.esc(by.name)} ${playing ? '▶️ resumed' : '⏸ paused'}`, 1400);
  }

  setInterval(() => {
    if (!player || !player.ready) return;
    const d = getDur(), t = getTime();
    const bar = player.slide.querySelector('.progress i'); if (bar && d) bar.style.width = `${Math.min(100, (t / d) * 100)}%`;
  }, 250);
  setInterval(() => {
    if (!S.follow || !player || !player.ready || S.room.index !== S.local) return;
    const d = getDur(), exp = expectedPos();
    if (d && exp < d - 1 && Math.abs(getTime() - exp) > 2.5) seek(exp);
    if (S.room.playing && !isPlaying() && !(d && exp >= d - 0.5)) safePlay();
    if (!S.room.playing && isPlaying()) pause();
  }, 2000);

  // ---------- sync mode ----------
  function setFollow(on) {
    S.follow = on;
    $('#syncBtn').classList.toggle('off', !on);
    $('#syncBtn').innerHTML = on ? '<span>🧲</span><small>synced</small>' : '<span>🏄</span><small>free</small>';
    if (on) { goTo(S.room.index, true); sock && sock.emit('viewing', { index: S.room.index, free: false }); toast('🧲 synced with the squad'); }
    else { sock && sock.emit('viewing', { index: S.local, free: true }); toast('🏄 free scroll — you roam alone (still see reactions & chat)'); }
    updateRejoin();
  }
  $('#syncBtn').onclick = () => setFollow(!S.follow);
  $('#rejoin').onclick = () => setFollow(true);
  function updateRejoin() {
    const show = !S.follow && S.room.index !== S.local;
    $('#rejoin').hidden = !show; $('#rejoinIdx').textContent = S.room.index + 1;
  }

  // ---------- sound ----------
  function setMuted(m) {
    S.muted = m;
    $('#muteBtn').innerHTML = m ? '<span>🔇</span><small>tap 4 sound</small>' : '<span>🔊</span><small>sound</small>';
    $('#muteBtn').classList.toggle('pulse', m);
    if (!player || !player.ready) return;
    if (player.video) player.video.muted = m; else m ? player.yt.mute() : player.yt.unMute();
  }
  function toggleMute() { setMuted(!S.muted); if (!S.muted && player && S.room.playing) safePlay(); }
  $('#muteBtn').onclick = toggleMute;
  setMuted(true);

  // ---------- presence ----------
  function renderPeople() {
    $('#count').textContent = S.users.length;
    const sorted = S.users.slice().sort((a, b) => a.joinedAt - b.joinedAt);
    $('#people').innerHTML = sorted.map((u) => `
      <li data-uid="${DS.esc(u.id)}" style="--c:${DS.col(u.color)}">
        <span class="av">${u.avatar}</span>
        <span class="nm">${DS.esc(u.name)}${S.me && u.id === S.me.id ? ' <em>(you)</em>' : ''}${u.host ? ' <em>👑</em>' : ''}</span>
        <span class="st">${u.free ? `🏄 free · #${(u.viewing | 0) + 1}` : '🧲 synced'}</span>
      </li>`).join('');
    $('#peopleStrip').innerHTML = sorted.slice(0, 8).map((u) => `<span class="pav" data-uid="${DS.esc(u.id)}" style="--c:${DS.col(u.color)}" title="${DS.esc(u.name)}">${u.avatar}</span>`).join('') + (sorted.length > 8 ? `<span class="pav more">+${sorted.length - 8}</span>` : '') + `<span class="pcount">${sorted.length} rotting</span>`;
  }
  function flashUser(id) {
    if (!id) return;
    document.querySelectorAll(`[data-uid="${CSS.escape(id)}"]`).forEach((el) => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
  }

  // ---------- reactions ----------
  function buildReactBar() {
    $('#reactBar').innerHTML = S.emojis.map((e, i) => `<button class="react-btn" data-e="${e}" title="${e} (key ${i + 1})">${e}</button>`).join('');
    $('#reactBar').onclick = (ev) => { const b = ev.target.closest('.react-btn'); if (b) { react(b.dataset.e); b.animate([{ transform: 'scale(1.5) rotate(-12deg)' }, { transform: 'none' }], 250); } };
  }
  function react(e) { sock && sock.emit('react', { emoji: e }); }
  const combo = {};
  function onReact({ emoji, by, meter, maxed, x }) {
    setMeter(meter);
    const now = Date.now();
    const c = combo[emoji] && now - combo[emoji].t < 900 ? combo[emoji].n + 1 : 1;
    combo[emoji] = { n: c, t: now };
    floatEmoji(emoji, by, x, c);
    if (by && S.me && by.id !== S.me.id) flashUser(by.id);
    if (maxed) maxOut();
  }
  function floatEmoji(emoji, by, x, comboN) {
    const layer = $('#floatLayer');
    const el = document.createElement('div');
    el.className = 'floater';
    const size = Math.min(1 + comboN * 0.12, 2.4);
    el.style.setProperty('--x', `${30 + (Number(x) || 0) * 45}%`);
    el.style.setProperty('--s', size);
    el.style.setProperty('--w', `${(Math.random() - 0.5) * 120}px`);
    el.style.setProperty('--r', `${(Math.random() - 0.5) * 60}deg`);
    el.innerHTML = `<span class="fe">${emoji}</span><span class="fn" style="color:${DS.col(by && by.color)}">${DS.esc(((by && by.name) || '').split(' ')[0])}${comboN > 2 ? ` x${comboN}` : ''}</span>`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2600);
    if (layer.children.length > 60) layer.firstElementChild.remove();
  }
  function burst(emoji) {
    if (!player) return;
    const el = document.createElement('div'); el.className = 'center-burst'; el.textContent = emoji;
    $('#floatLayer').appendChild(el); setTimeout(() => el.remove(), 700);
  }
  function setMeter(m) {
    $('#meterFill').style.width = `${m}%`;
    $('#meterPct').textContent = `${Math.round(m)}%`;
    $('#meter').classList.toggle('hot', m > 70);
  }
  function maxOut() {
    const mx = $('#maxed'); mx.hidden = false; document.body.classList.add('shake');
    for (let i = 0; i < 24; i++) setTimeout(() => floatEmoji(['💀', '🧠', '🔥', '😭', '🗿'][i % 5], { name: '', color: '#ffffff' }, Math.random() * 1.2 - 1, 3), i * 40);
    setTimeout(() => { mx.hidden = true; document.body.classList.remove('shake'); }, 2200);
  }

  // ---------- chat ----------
  const chatEl = $('#chat');
  function addChat(m, silent) {
    const div = document.createElement('div');
    div.className = 'msg' + (m.sys ? ' sys' : '') + (S.me && m.by && m.by.id === S.me.id ? ' mine' : '');
    div.innerHTML = m.sys ? DS.esc(m.text) : `<span class="who" style="color:${DS.col(m.by && m.by.color)}">${(m.by && m.by.avatar) || ''} ${DS.esc(m.by && m.by.name)}</span><span class="txt">${DS.esc(m.text)}</span>`;
    const atBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 60;
    chatEl.appendChild(div);
    while (chatEl.children.length > 200) chatEl.firstElementChild.remove();
    if (atBottom || (m.by && S.me && m.by.id === S.me.id)) chatEl.scrollTop = chatEl.scrollHeight;
    if (silent || m.sys) return;
    if (isMobile() && !S.chatOpen) {
      S.unread++; $('#unread').hidden = false; $('#unread').textContent = S.unread;
      const pop = document.createElement('div'); pop.className = 'chat-pop';
      pop.innerHTML = `<b style="color:${DS.col(m.by && m.by.color)}">${(m.by && m.by.avatar) || ''} ${DS.esc(m.by && m.by.name)}</b> ${DS.esc(m.text)}`;
      $('#chatPops').appendChild(pop); setTimeout(() => pop.remove(), 5000);
      while ($('#chatPops').children.length > 3) $('#chatPops').firstElementChild.remove();
    }
  }
  $('#chatForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#chatInput').value.trim(); if (!v || !sock) return;
    if (v.startsWith('/nick ')) { sock.emit('rename', { name: v.slice(6) }); DS.saveName(v.slice(6).trim()); }
    else sock.emit('chat', { text: v });
    $('#chatInput').value = '';
  };
  function openChat(open) {
    S.chatOpen = open; document.body.classList.toggle('chat-open', open);
    if (open) { S.unread = 0; $('#unread').hidden = true; chatEl.scrollTop = chatEl.scrollHeight; }
  }
  $('#chatBtn').onclick = () => openChat(!S.chatOpen);
  $('#closeChat').onclick = () => openChat(false);

  // ---------- add clip ----------
  const modal = $('#addModal');
  $('#addBtn').onclick = () => { modal.hidden = false; $('#addErr').textContent = ''; setTimeout(() => $('#addUrl').focus(), 50); };
  $('#addCancel').onclick = () => (modal.hidden = true);
  modal.addEventListener('click', (e) => e.target === modal && (modal.hidden = true));
  let nextFlag = false;
  modal.querySelectorAll('button[type=submit]').forEach((b) => b.addEventListener('click', () => (nextFlag = b.dataset.next === '1')));
  $('#addForm').onsubmit = (e) => {
    e.preventDefault();
    const url = $('#addUrl').value.trim(); if (!url) return;
    const pf = YTX.preflight(url);
    if (pf.error) { $('#addErr').textContent = pf.error; return; }
    $('#addErr').textContent = 'checking the vibes…';
    sock.emit('addClip', { url, next: nextFlag }, (res) => {
      if (!res || res.error) { $('#addErr').textContent = (res && res.error) || 'failed'; return; }
      modal.hidden = true; $('#addUrl').value = ''; $('#addErr').textContent = '';
      toast(`✅ added “${DS.esc(res.clip.title.slice(0, 40))}” ${nextFlag ? 'up next' : `as #${res.at + 1}`}`);
    });
  };

  // ---------- share ----------
  $('#share').onclick = async () => {
    const url = DS.inviteLink(code);
    if (navigator.share && isMobile()) { try { await navigator.share({ title: 'doomscroll with me 💀', text: `dark humor watch party — room ${code}`, url }); return; } catch {} }
    try { await navigator.clipboard.writeText(url); toast('🔗 invite link copied — send it to the group chat'); }
    catch { prompt('copy this link:', url); }
  };

  // ---------- toasts ----------
  function toast(html, ms = 2200) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 400);
    while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
  }

  window.__ds = { S, step, react, get player() { return player; }, get sock() { return sock; } };
  addEventListener('beforeunload', () => { try { sock && sock.leave(); } catch {} });
})();

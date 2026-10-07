// PeerJS transport. Host claims peer id `doomscroll-together-v1-<code>`; joiners connect to it.
// Protocol between peers: { ev, data, ack? }  (ack is a short id; reply is { ack, data }).
//
// Dev fallback: ?peer=broadcast (or window.DOOMSCROLL_PEER === 'broadcast') uses BroadcastChannel
// instead of WebRTC so multi-tab / Playwright tests work on hosts where UDP/TURN is blocked.
// Production (GitHub Pages) always uses the public PeerJS broker — same as Bean Hunt.
const Net = (() => {
  let peer = null, role = null, code = null, closing = false;
  let hostH = null;
  let remoteHandlers = new Map();
  let clientConn = null, clientHandlers = null, ackMap = new Map(), ackN = 0, joinTimer = 0;
  let bc = null, bcId = null, bcHostId = null;

  function useBroadcast() {
    if (window.DOOMSCROLL_PEER === 'broadcast') return true;
    const q = new URLSearchParams(location.search).get('peer');
    return q === 'broadcast';
  }

  function wireConn(conn, onData, onClose) {
    conn.on('data', (d) => { try { onData(d); } catch (e) { console.error(e); } });
    conn.on('close', () => onClose && onClose());
    conn.on('error', () => {});
  }

  function hostAccept(conn) {
    const sid = 'p_' + String(conn.peer).replace(/[^a-z0-9]/gi, '').slice(-12) + '_' + Math.random().toString(36).slice(2, 6);
    const sock = {
      id: sid,
      emit(ev, data) { if (conn.open) try { conn.send({ ev, data }); } catch {} },
    };
    const h = hostH.connect(sock);
    remoteHandlers.set(conn.peer, h);
    wireConn(conn, (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.ev === 'bye') { try { conn.close(); } catch {} return; }
      const reply = msg.ack != null ? (data) => { try { if (conn.open) conn.send({ ack: msg.ack, data }); } catch {} } : null;
      h.handle(msg.ev, msg.data, reply);
    }, () => {
      const hh = remoteHandlers.get(conn.peer);
      if (hh) { hh.disconnect(); remoteHandlers.delete(conn.peer); }
    });
  }

  function makeApi(emit) {
    return {
      emit,
      on(handlers) { clientHandlers = handlers; },
      leave() { shutdown(); },
      role: () => role,
      code: () => code,
      hostSnapshot: () => (hostH ? hostH.snapshot() : null),
    };
  }

  // ---------- BroadcastChannel transport (local / Playwright) ----------
  function bcChannel(c) { return new BroadcastChannel('doomscroll-bc-' + DS.normCode(c)); }
  function bcSend(msg) { try { bc.postMessage(msg); } catch {} }

  async function hostBroadcast(roomCode, mode, { restore, onError } = {}) {
    closing = false; role = 'host'; code = DS.normCode(roomCode);
    hostH = await RoomHost.create({ code, mode, restore });
    bcId = 'H_' + Math.random().toString(36).slice(2, 10);
    bcHostId = bcId;
    bc = bcChannel(code);
    try { localStorage.setItem('ds:bc-host:' + code, JSON.stringify({ id: bcId, at: Date.now() })); } catch {}

    const hostPeerSid = 'host_' + Math.random().toString(36).slice(2, 8);
    const localSock = {
      id: hostPeerSid,
      emit(ev, data) { if (clientHandlers) try { clientHandlers.on(ev, data); } catch (e) { console.error(e); } },
    };
    const localH = hostH.connect(localSock, { isHost: true });
    remoteHandlers.set('__local__', localH);

    const peers = new Map(); // remote bc id -> { sock, h }
    bc.onmessage = (ev) => {
      const m = ev.data; if (!m || m.v !== 1) return;
      if (m.t === 'hello' && m.to === bcId) {
        const sid = 'bc_' + m.from;
        if (peers.has(m.from)) return;
        const sock = {
          id: sid,
          emit(evName, data) { bcSend({ v: 1, t: 'msg', from: bcId, to: m.from, payload: { ev: evName, data } }); },
        };
        const h = hostH.connect(sock);
        peers.set(m.from, { sock, h });
        remoteHandlers.set(m.from, h);
        bcSend({ v: 1, t: 'welcome', from: bcId, to: m.from });
        return;
      }
      if (m.t === 'msg' && m.to === bcId) {
        const p = peers.get(m.from); if (!p || !m.payload) return;
        const msg = m.payload;
        if (msg.ev === 'bye') {
          p.h.disconnect(); peers.delete(m.from); remoteHandlers.delete(m.from); return;
        }
        const reply = msg.ack != null
          ? (data) => bcSend({ v: 1, t: 'msg', from: bcId, to: m.from, payload: { ack: msg.ack, data } })
          : null;
        p.h.handle(msg.ev, msg.data, reply);
        return;
      }
      if (m.t === 'bye' && peers.has(m.from)) {
        peers.get(m.from).h.disconnect(); peers.delete(m.from); remoteHandlers.delete(m.from);
      }
      if (m.t === 'who-host') bcSend({ v: 1, t: 'host-here', from: bcId, code });
    };
    // announce
    bcSend({ v: 1, t: 'host-here', from: bcId, code });
    return makeApi((ev, data, ack) => localH.handle(ev, data, typeof ack === 'function' ? ack : null));
  }

  async function joinBroadcast(roomCode, { onError, onHostGone } = {}) {
    closing = false; role = 'client'; code = DS.normCode(roomCode);
    bcId = 'C_' + Math.random().toString(36).slice(2, 10);
    bc = bcChannel(code);

    const fail = (msg) => { if (!closing) { onError && onError(msg); shutdown(); throw new Error(msg); } };

    // find host
    let hostId = null;
    try {
      const raw = localStorage.getItem('ds:bc-host:' + code);
      if (raw) { const j = JSON.parse(raw); if (j && j.id && Date.now() - j.at < 60 * 60 * 1000) hostId = j.id; }
    } catch {}

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Couldn't reach room ${code}. The host may have closed it.`)), 8000);
      bc.onmessage = (ev) => {
        const m = ev.data; if (!m || m.v !== 1) return;
        if (m.t === 'host-here' && m.code === code) { hostId = m.from; clearTimeout(t); resolve(); }
      };
      bcSend({ v: 1, t: 'who-host', from: bcId });
      // if localStorage already had host, still wait a tick for channel readiness then resolve
      if (hostId) setTimeout(() => { clearTimeout(t); resolve(); }, 50);
    }).catch((e) => fail(e.message));

    bcHostId = hostId;
    if (!bcHostId) fail(`No room found with code ${code}.`);

    // handshake
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timed out connecting to the host.')), 8000);
      const prev = bc.onmessage;
      bc.onmessage = (ev) => {
        if (typeof prev === 'function') try { prev(ev); } catch {}
        const m = ev.data; if (!m || m.v !== 1) return;
        if (m.t === 'welcome' && m.to === bcId && m.from === bcHostId) { clearTimeout(t); resolve(); }
        if (m.t === 'host-gone' || (m.t === 'bye' && m.from === bcHostId)) {
          clearTimeout(t);
          if (!closing) onHostGone && onHostGone('The host left the room (or the connection dropped).');
        }
        if (m.t === 'msg' && m.to === bcId && m.from === bcHostId) {
          const msg = m.payload || {};
          if (msg.ack != null && msg.ev === undefined) {
            const fn = ackMap.get(msg.ack); if (fn) { ackMap.delete(msg.ack); try { fn(msg.data); } catch (e) { console.error(e); } }
            return;
          }
          if (clientHandlers) try { clientHandlers.on(msg.ev, msg.data); } catch (e) { console.error(e); }
        }
      };
      bcSend({ v: 1, t: 'hello', from: bcId, to: bcHostId });
    }).catch((e) => fail(e.message));

    // keep listening for host-gone after welcome
    const after = bc.onmessage;
    bc.onmessage = (ev) => {
      if (typeof after === 'function') try { after(ev); } catch {}
      const m = ev.data; if (!m || m.v !== 1) return;
      if ((m.t === 'bye' || m.t === 'host-gone') && m.from === bcHostId && !closing) {
        onHostGone && onHostGone('The host left the room (or the connection dropped).');
      }
    };

    return makeApi((ev, data, ack) => {
      const msg = { ev, data };
      if (typeof ack === 'function') { const id = ++ackN; ackMap.set(id, ack); msg.ack = id; setTimeout(() => ackMap.delete(id), 15000); }
      bcSend({ v: 1, t: 'msg', from: bcId, to: bcHostId, payload: msg });
    });
  }

  // ---------- PeerJS transport (production) ----------
  async function hostPeer(roomCode, mode, { restore, onError } = {}) {
    if (typeof Peer !== 'function') { onError && onError('PeerJS failed to load. Check your connection and reload.'); throw new Error('no Peer'); }
    closing = false; role = 'host'; code = DS.normCode(roomCode);
    hostH = await RoomHost.create({ code, mode, restore });

    const hostPeerSid = 'host_' + Math.random().toString(36).slice(2, 8);
    const localSock = {
      id: hostPeerSid,
      emit(ev, data) { if (clientHandlers) try { clientHandlers.on(ev, data); } catch (e) { console.error(e); } },
    };
    const localH = hostH.connect(localSock, { isHost: true });
    remoteHandlers.set('__local__', localH);

    let tries = 0;
    await new Promise((resolve, reject) => {
      const open = () => {
        try { if (peer && !peer.destroyed) peer.destroy(); } catch {}
        const p = peer = new Peer(DS.hostPeerId(code), DS.peerOptions());
        p.on('open', () => { if (p === peer && !closing) resolve(); });
        p.on('connection', (conn) => { if (!closing) hostAccept(conn); });
        p.on('disconnected', () => {
          if (closing || p !== peer) return;
          setTimeout(() => { try { if (p === peer && !p.destroyed && !p.open) p.reconnect(); } catch {} }, 1500);
        });
        p.on('error', (err) => {
          if (closing || p !== peer) return;
          if (err.type === 'unavailable-id' && tries++ < 8) {
            code = DS.newCode();
            hostH.room.code = code;
            return open();
          }
          if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type) && !p.open) {
            const msg = 'Could not reach the matchmaking server (' + err.type + '). Check your connection and try again.';
            onError && onError(msg); reject(new Error(msg));
          } else if (err.type === 'browser-incompatible') {
            const msg = 'Your browser does not support WebRTC peer-to-peer connections.';
            onError && onError(msg); reject(new Error(msg));
          }
        });
      };
      open();
    });

    return makeApi((ev, data, ack) => localH.handle(ev, data, typeof ack === 'function' ? ack : null));
  }

  async function joinPeer(roomCode, { onError, onHostGone } = {}) {
    if (typeof Peer !== 'function') { onError && onError('PeerJS failed to load. Check your connection and reload.'); throw new Error('no Peer'); }
    closing = false; role = 'client'; code = DS.normCode(roomCode);

    const fail = (msg) => { if (!closing) { onError && onError(msg); shutdown(); throw new Error(msg); } };

    peer = new Peer(DS.peerOptions());
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => { if (!clientConn || !clientConn.open) fail(`Couldn't reach room ${code}. The host may have closed it, or a firewall is blocking peer-to-peer.`); }, 20000);

    await new Promise((resolve, reject) => {
      peer.on('open', resolve);
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') reject(new Error(`No room found with code ${code}. Check the code, and make sure the host still has the tab open.`));
        else if (!clientConn) reject(new Error('Connection problem (' + err.type + '). Please try again.'));
      });
    }).catch((e) => fail(e.message));

    if (closing || !peer || peer.destroyed) return null;
    const conn = clientConn = peer.connect(DS.hostPeerId(code), { reliable: true, serialization: 'json' });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timed out connecting to the host. (WebRTC blocked? Try a different network, or set window.DOOMSCROLL_ICE with a TURN server.)')), 18000);
      conn.on('open', () => { clearTimeout(t); resolve(); });
      conn.on('error', () => { clearTimeout(t); reject(new Error('Could not open a connection to the host.')); });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') { clearTimeout(t); reject(new Error(`No room found with code ${code}. Check the code, and make sure the host still has the tab open.`)); }
      });
    }).catch((e) => fail(e.message));

    clearTimeout(joinTimer);
    if (closing || !conn.open) return null;

    wireConn(conn, (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.ack != null && msg.ev === undefined) {
        const fn = ackMap.get(msg.ack); if (fn) { ackMap.delete(msg.ack); try { fn(msg.data); } catch (e) { console.error(e); } }
        return;
      }
      if (clientHandlers) try { clientHandlers.on(msg.ev, msg.data); } catch (e) { console.error(e); }
    }, () => { if (!closing) onHostGone && onHostGone('The host left the room (or the connection dropped).'); });

    return makeApi((ev, data, ack) => {
      if (!conn.open) return;
      const msg = { ev, data };
      if (typeof ack === 'function') { const id = ++ackN; ackMap.set(id, ack); msg.ack = id; setTimeout(() => ackMap.delete(id), 15000); }
      try { conn.send(msg); } catch {}
    });
  }

  async function host(roomCode, mode, opts) {
    return useBroadcast() ? hostBroadcast(roomCode, mode, opts) : hostPeer(roomCode, mode, opts);
  }
  async function join(roomCode, opts) {
    return useBroadcast() ? joinBroadcast(roomCode, opts) : joinPeer(roomCode, opts);
  }

  function shutdown() {
    closing = true;
    clearTimeout(joinTimer);
    try {
      if (bc) {
        if (role === 'host') {
          bcSend({ v: 1, t: 'host-gone', from: bcId });
          try { localStorage.removeItem('ds:bc-host:' + code); } catch {}
        } else if (bcHostId) {
          bcSend({ v: 1, t: 'bye', from: bcId, to: bcHostId });
          bcSend({ v: 1, t: 'msg', from: bcId, to: bcHostId, payload: { ev: 'bye', data: {} } });
        }
        try { bc.close(); } catch {}
        bc = null;
      }
      if (role === 'host') {
        for (const h of remoteHandlers.values()) try { h.disconnect(true); } catch {}
        remoteHandlers.clear();
        if (hostH) { hostH.destroy(); hostH = null; }
      } else if (clientConn) {
        try { if (clientConn.open) clientConn.send({ ev: 'bye', data: {} }); } catch {}
        try { clientConn.close(); } catch {}
      }
      if (peer && !peer.destroyed) peer.destroy();
    } catch {}
    peer = null; role = null; clientConn = null; clientHandlers = null; ackMap.clear();
  }

  return { host, join, shutdown };
})();

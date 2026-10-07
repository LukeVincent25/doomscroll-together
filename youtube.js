// Clip-link parsing + embeddability check, all in the browser (no server on GitHub Pages).
const YTX = (() => {
  // Extract an 11-char YouTube video id from any common URL form (shorts, watch, youtu.be, embed, live) or a bare id.
  function parseYouTubeId(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.searchParams.get('v')) id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
        if (m) id = m[2];
      }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  const isVideoUrl = (s) => /^https?:\/\/[^\s"'<>]+\.(mp4|webm)(\?[^\s"'<>]*)?$/i.test(String(s || '').trim());

  // Quick local check so the person pasting gets instant feedback.
  function preflight(url) {
    const s = String(url || '').trim();
    if (isVideoUrl(s)) return { ok: true };
    return parseYouTubeId(s) ? { ok: true } : { error: "that's not a YouTube link fr 💀" };
  }

  // youtube.com/oembed sends no CORS headers, so browsers can't read it. noembed.com proxies it with
  // Access-Control-Allow-Origin: * and passes YouTube's 401 (embedding disabled) / 404 / 400 through as {error}.
  async function oembed(id) {
    const url = 'https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) { const e = new Error('noembed ' + r.status); e.status = 0; throw e; }
      const j = await r.json();
      if (j.error) { const m = String(j.error).match(/\d{3}/); const e = new Error(j.error); e.status = m ? Number(m[0]) : 0; throw e; }
      return j;
    } finally { clearTimeout(t); }
  }

  // Full validation (run by the room host): returns { clip } or { error }.
  async function resolveClip(url) {
    const s = String(url || '').trim();
    if (isVideoUrl(s)) return { clip: { type: 'mp4', src: s, title: decodeURIComponent(s.split('/').pop().split('?')[0]).slice(0, 80), author: 'pasted link' } };
    const id = parseYouTubeId(s);
    if (!id) return { error: "that's not a YouTube link fr 💀" };
    try {
      const j = await oembed(id);
      return { clip: { type: 'yt', videoId: id, title: String(j.title || 'mystery clip 👀').slice(0, 140), author: String(j.author_name || '').slice(0, 60), vertical: j.height > j.width } };
    } catch (e) {
      if (e.status === 401 || e.status === 403) return { error: 'that video blocks embedding 😭' };
      if (e.status === 404 || e.status === 400) return { error: "video doesn't exist (or is private) 🤡" };
      // noembed unreachable: accept the parsed id; the player skips it for everyone if it won't embed
      return { clip: { type: 'yt', videoId: id, title: 'mystery clip 👀', author: 'unverified' } };
    }
  }
  return { parseYouTubeId, isVideoUrl, preflight, oembed, resolveClip };
})();

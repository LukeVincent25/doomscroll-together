# 🧠 Doomscroll Together

Rot your brain **in sync** with your friends. A shared, TikTok-style vertical feed of short clips where one person swipes and everyone swipes — live presence, floating emoji reactions, a brainrot meter, and chat.

**Live:** [https://lukevincent25.github.io/doomscroll-together/](https://lukevincent25.github.io/doomscroll-together/)

## How to play

1. Open the link above, pick a silly name (or 🎲 reroll), choose **YouTube Shorts mix** or **Offline-safe MP4s**, hit **Create a room**.
2. Share the invite link (`…/?room=ABCD`) — the **🔗 invite** chip copies it. Friends can also type the 4-letter code on the landing page.
3. **Keep the host’s tab open.** The room lives in the creator’s browser (peer-to-peer). If the host closes the tab, everyone else sees “host left the room.”
4. Swipe / scroll (or `↑`/`↓`/`j`/`k`). Everyone in **🧲 synced** mode moves with you. Tap the video to pause, the progress bar to seek, `1`–`0` for reactions, and chat with `/nick New Name` to rename.

## How hosting works

Same pattern as [Bean Hunt](https://github.com/LukeVincent25/bean-hunt):

* Fully static on **GitHub Pages** (no Node server).
* Online multiplayer is **WebRTC peer-to-peer** via [PeerJS](https://peerjs.com/) from a CDN, using the free public PeerJS broker (`0.peerjs.com`) for matchmaking.
* The **room creator’s browser is the authoritative host** (queue, current clip, playback clock, members, chat, brainrot meter). Joiners connect to peer id `doomscroll-together-v1-<code>`.
* Invite links look like `https://lukevincent25.github.io/doomscroll-together/?room=ABCD`.

### Optional TURN override

If friends can’t connect through restrictive NATs/firewalls, point extra ICE servers at the page before load:

```html
<script>window.DOOMSCROLL_ICE = [{ urls: 'turn:your.turn.server:3478', username: '…', credential: '…' }];</script>
```

(Default config already includes Google STUN + PeerJS’s free TURN.)

### Local PeerJS broker (dev only)

```bash
npx peer --port 9000
# then open http://localhost:8080/?peer=localhost:9000
```

Production always uses the public broker (exactly like Bean Hunt) unless you set `window.DOOMSCROLL_PEER`.

## Run locally

```bash
npx --yes http-server -p 8080 -c-1
# open http://localhost:8080/
```

No build step. Relative asset paths work under `/` and under `/doomscroll-together/` on Pages.

## Features (same vibes as the Node version)

| | |
|---|---|
| **Rooms** | 4-letter codes, `?room=CODE` invite links |
| **Synced feed** | Swipes, play/pause, seek, late-join sync, 2s drift correction, single auto-advance at clip end |
| **Follow vs free** | 🧲 synced / 🏄 free + “rejoin” pill |
| **Presence / reactions / meter / chat** | Avatars, 10 emoji reactions (rate-limited 10/s), MAXIMUM BRAINROT shake, `/nick` |
| **Add clips** | Paste YouTube / Shorts / youtu.be / `.mp4` — validated client-side via [noembed.com](https://noembed.com) (CORS-friendly YouTube oEmbed proxy) |
| **Content** | Bundled offline MP4s in `media/` (~9.6 MB) + YouTube Shorts seed list in `data/seeds.json` |

## Tests

```bash
npm install
npx peer --port 9000   # optional; production uses 0.peerjs.com
npm start              # http://127.0.0.1:8080
# This sandbox blocks WebRTC UDP/TURN, so the automated test uses a same-tab
# BroadcastChannel bus (?peer=broadcast). Real friends use PeerJS/WebRTC.
PEER=broadcast npm test
PEER=broadcast npm run screenshots
```

## Limitations

* **Host must keep the tab open.** Closing it ends the room for everyone (no host migration yet).
* **No persistence.** Rooms live only in the host’s memory.
* YouTube embed / autoplay / ads caveats are the same as any iframe player.
* WebRTC may need TURN on hard NATs — see `window.DOOMSCROLL_ICE` above.

## License / media

* Big Buck Bunny & Sintel © Blender Foundation, **CC-BY 3.0** (cropped vertical clips).
* Synthetic ffmpeg clips (`skibidi-freq`, `brain-cells`, `ohio-life`) are original to this project.

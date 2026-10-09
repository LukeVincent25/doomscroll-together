# 🧠 Doomscroll Together

A shared, TikTok-style vertical **dark humor** feed — one person swipes and everyone swipes. Live presence, floating emoji reactions, a playful vibes / brainrot meter, and chat.

**Live:** [https://lukevincent25.github.io/doomscroll-together/](https://lukevincent25.github.io/doomscroll-together/)

## How to play

1. Open the link above, pick a silly animal name (or 🎲 reroll), choose **Dark humor mix** or **Offline-safe MP4s**, hit **Create a room**.
2. Share the invite link (`…/?room=ABCD`) — the **🔗 invite** chip copies it. Friends can also type the 4-letter code on the landing page.
3. **Keep the host’s tab open.** The room lives in the creator’s browser (peer-to-peer). If the host closes the tab, everyone else sees “host left the room.”
4. Swipe / scroll (or `↑`/`↓`/`j`/`k`). Everyone in **🧲 synced** mode moves with you. Tap the video to pause, the progress bar to seek, `1`–`0` for reactions, and chat with `/nick New Name` to rename.

## Feed content

The default **Dark humor mix** is Shorts from mainstream comedy channels (Anthony Jeselnik, Jimmy Carr, Netflix Is A Joke roasts, I Think You Should Leave, WKUK sketches, Conan, Jim Jefferies, Tom Segura): morbid one-liners, roasts, deadpan and absurdist sketches. Clips whose titles suggest jokes aimed at race, religion, gender, sexuality or disability were left out, and every clip was checked to play in an embedded player. The offline MP4 room uses bundled Blender CC clips plus simple synthetic loops.

## How hosting works

Same pattern as [Bean Hunt](https://github.com/LukeVincent25/bean-hunt):

* Fully static on **GitHub Pages** (no Node server).
* Online multiplayer is **WebRTC peer-to-peer** via [PeerJS](https://peerjs.com/) from a CDN, using the free public PeerJS broker (`0.peerjs.com`) for matchmaking.
* The **room creator’s browser is the authoritative host** (queue, current clip, playback clock, members, chat, vibes meter). Joiners connect to peer id `doomscroll-together-v1-<code>`.
* Invite links look like `https://lukevincent25.github.io/doomscroll-together/?room=ABCD`.

### Optional TURN override

```html
<script>window.DOOMSCROLL_ICE = [{ urls: 'turn:your.turn.server:3478', username: '…', credential: '…' }];</script>
```

### Local PeerJS broker (dev only)

```bash
npx peer --port 9000
# then open http://localhost:8080/?peer=localhost:9000
```

Production always uses the public broker unless you set `window.DOOMSCROLL_PEER`.

## Run locally

```bash
npx --yes http-server -p 8080 -c-1
# open http://localhost:8080/
```

## Tests

```bash
npm install
npm start
# This sandbox blocks WebRTC UDP/TURN, so the automated test uses a same-tab
# BroadcastChannel bus (?peer=broadcast). Real friends use PeerJS/WebRTC.
PEER=broadcast npm test
PEER=broadcast npm run screenshots
```

## Features

| | |
|---|---|
| **Rooms** | 4-letter codes, `?room=CODE` invite links |
| **Synced feed** | Swipes, play/pause, seek, late-join sync, 2s drift correction, single auto-advance at clip end |
| **Follow vs free** | 🧲 synced / 🏄 free + “rejoin” pill |
| **Presence / reactions / meter / chat** | Avatars, 10 emoji reactions (rate-limited 10/s), MAXIMUM BRAINROT shake at full meter, `/nick` |
| **Add clips** | Paste YouTube / Shorts / youtu.be / `.mp4` — validated client-side via [noembed.com](https://noembed.com) |
| **Content** | Bundled offline MP4s in `media/` (~9.6 MB) + YouTube Shorts seed list in `data/seeds.json` |

## Limitations

* **Host must keep the tab open.** Closing it ends the room for everyone (no host migration yet).
* **No persistence.** Rooms live only in the host’s memory.
* YouTube embed / autoplay / ads caveats are the same as any iframe player.
* WebRTC may need TURN on hard NATs — see `window.DOOMSCROLL_ICE` above.

## License / media

* Big Buck Bunny & Sintel © Blender Foundation, **CC-BY 3.0** (cropped vertical clips).
* Synthetic ffmpeg loops are original to this project.

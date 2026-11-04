# Topmate Diwali Mela

A virtual Diwali mela in the browser (Three.js + Vite): walk the bazaar as your own avatar, eat
golgappas, ride the giant wheel, fly the Pushpak Viman, drive the Chakri Cars circuit, watch the
Ramayan under the stars, burn the Ravan together, and share a poster of it all.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173 (the Topmate proxy and the realtime server are included)
npm run build        # static build in dist/
npm run preview      # serves dist/ with the proxy and realtime server attached
```

Settings (⚙️ in the HUD) choose the graphics tier (phones get the low tier automatically), reduce
motion, the music (the Diwali song, or the synthesised royalty-free "mela band"), and key bindings.

## The servers

Two small pieces run alongside the static site:

- `server/topmate.mjs`: looks up a public Topmate profile (name, headline, photo) and streams the
  photo through the same origin so the poster can use it. During `vite dev`/`preview` it is a
  middleware at `/api/topmate`; `api/topmate.js` and `api/topmate/image.js` are the same thing as
  Vercel-style serverless functions.
- `server/realtime.mjs`: the multiplayer relay (positions at 10 Hz, waves, shared wish lanterns,
  leaderboards and the wish wall). Attached to the Vite dev/preview server at `/ws`; on its own:

  ```bash
  node server/realtime.mjs            # ws://localhost:8787/ws, data in server/data.json
  ```

  Point a deployed site at it with `VITE_WS_URL=wss://your-host/ws` at build time. Without a
  reachable server the mela still works: scores and wishes stay in the visitor's browser.
  A static build (`VITE_STATIC=1`, used by the GitHub Pages workflow) opens no socket and makes no
  Topmate lookups unless `VITE_WS_URL` / `VITE_API_BASE` (a host serving `api/`) are set.

## Voice chat

The 🎤 button (or **V**) turns the microphone on; voices are peer-to-peer WebRTC, spatialised at
each visitor's avatar (clear within ~4 m, gone by ~34 m). Settings offer open mic or push-to-talk
and a voice volume. It needs a secure page (https, or localhost) and the realtime server for
signalling; there is no TURN relay, so two visitors behind very strict NATs may not connect.

## Configuration

`src/config.js`:

- `creators`: Topmate usernames shown at Creator Corner (fetched live).
- `publicBuild`: `true` forces the royalty-free band instead of the song. The bundled song in
  `public/audio/diwali-song.m4a` (AAC, 72 kbps) is a commercial track: fine for a private demo, replace it or set
  `publicBuild` before hosting publicly.
- `ravanEveryMinutes` / `ravanFirstAfterMinutes`: the Ravan Dahan schedule.

## Dev URL switches

`?play` skips the intro (`&name=`, `&handle=` set who you are), `&place=ghat` jumps to a spot,
`&pos=x,z,heading` stands somewhere exact, `&night` skips dusk, `&noyt` skips the YouTube embed,
`&nonet` stays offline, `&tier=low` forces the phone tier, `&show` starts the grand fireworks show,
`&do=rocket,phuljhadi` runs actions. With `?play`, `window.__mela` exposes the systems for scripts.

## Layout of the code

- `src/main.js`: boots everything and runs the frame loop.
- `src/world.js`, `src/water.js`, `src/sky.js`, `src/daynight.js`, `src/decor.js`: the grounds.
- `src/character.js`, `src/player.js`, `src/npcs.js`, `src/extras.js`: people.
- `src/activities/`, `src/games/`, `src/rides.js`, `src/vehicles/`, `src/boat.js`, `src/train.js`,
  `src/columbus.js`, `src/kuan.js`, `src/ravan.js`, `src/ramayan.js`: things to do.
- `src/fireworks.js`, `src/smoke.js`, `src/debris.js`, `src/lanterns.js`, `src/audio.js`,
  `src/ambience.js`: effects and sound (all synthesised; the song is the only audio file).
- `src/net.js`, `src/wall.js`, `src/creators.js`, `src/poster.js`: the social layer.

# Diwali Mela: performance optimisation plan

This plan is read-only: no files were changed. Line numbers refer to the current `main` (42bcbb1).

## 1. Where the cost is

1. **Too many lights in every shader.** On the high tier there is no LightPool (`main.js:446`). So 50 point lights and 7 spot lights run in an unrolled loop for every lit pixel. That happens in the main pass and again in the river reflection, at a pixel ratio of up to 1.75. The GPU check is narrow (`settings.js:103`), so Intel Arc, newer "Intel(R) Graphics" chips, and Apple M-series in Chrome are all treated as high.
2. **Draw calls: about 4,466 per frame on high, about 1,950 on low.** The main pass is about 1,911, the shadow pass 2,085 and the reflection 456. The main causes:
   - 548 separate stall meshes with about 230 materials.
   - People cost 11 meshes each, about 900 meshes on high and 540 on low.
   - `shadowify` makes nearly every mesh cast a shadow.
3. **Shadow map redrawn every frame.** It is 2048² over a 190 m area, with 2,083 casters, and `autoUpdate` is never turned off.
4. **Things that run all the time no matter where the player is:**
   - The YouTube Ramleela video (1280x720, autoplay, loop) plus CSS3D rendering every frame.
   - About 11 `backdrop-filter` blur panels sitting on top of a WebGL canvas that changes every frame.
   - The full scene plus bloom renders behind the intro screen, while the customiser runs its own second WebGL context.
5. **Phones are not getting the savings the low tier intends:**
   - The half-resolution bloom is reset to full size by `resize()`.
   - The Reflector uses 4x MSAA by default.
   - Fireworks and smoke ignore the tier entirely.

## 2. Ranked plan

### Phase 1: Quick wins (small effort, safe)

| # | Title | Files:line | Why | Fix | Risk |
|---|---|---|---|---|---|
| Q1 | **LightPool on every tier** | `main.js:446`, `lightpool.js:43-55` | High tier loops over 57 lights per pixel, twice (main pass and reflection). Lights never get skipped by distance. | `poolSize = {points: low?8:16, spots: low?2:4}`. In `pick()`: pre-allocate one candidate record per light, re-pick at 5–10 Hz, and give the lights picked last time a score bonus so they don't swap. Give the fireworks lights a finite `distance` (`fireworks.js:110-118`, currently 0), otherwise the pool can't drop them by range. | Distant stalls look a little darker, and lights can pop when the picked set changes. Needs a visual check of the bazaar at night. |
| Q2 | **Fewer shadow casters, slower shadow updates** | `utils.js:69-76`, `main.js:154,174-178,450` | 2,085 shadow draws per frame. One shadow texel is about 9 cm, so tiny casters add nothing visible. | (a) `shadowify` skips stall goods, InstancedMesh decor and meshes with a radius under 0.3 m. Also set `debris.mesh.castShadow=false`. (b) `shadowMap.autoUpdate=false`. Set `needsUpdate=true` every frame for the first 90 s while the sun moves, then every 2–3 frames. This works with the Reflector. | Fewer contact shadows. Shadows of rides and characters lag slightly. |
| Q3 | **Fix low-tier bloom size** | `main.js:204,459,465` | The half-resolution bloom is reset to full size on startup. | After `composer.setSize` in `resize()`: `if (low) bloom.setSize(innerWidth/2, innerHeight/2)`. | Negligible. |
| Q4 | **Remove wasted multisampling** | `main.js:144`, `water.js:150-156` | The composer's render target has no MSAA, so `antialias:true` adds nothing. The Reflector defaults to `multisample:4`, also on phones. | Use `antialias:false` and pass `multisample:0` to the Reflector (at least on low). If high needs AA, add FXAA/SMAA or a `samples:4` composer target on high only. | None visible today. |
| Q5 | **Load and run the Ramleela video only when nearby** | `main.js:247,500,645`, `ramayan.js:195-243,341-370` | An HD video streams and decodes for the whole session at any distance. CSS3D re-renders every frame. | Inside `update()`, set `near = seated \|\| dist(center) < 45 m`. When `near` changes, call `pauseVideo()`/`playVideo()` and toggle `el.style.display`. Skip `cssRenderer.render` while not near. Call `start()` (iframe_api and player) on the first approach instead of on enter, and pause on `document.hidden`. A low tier could use a poster image with tap-to-watch. | Low. Playback resumes muted and is unmuted from `update()`, so no new user gesture is needed. Keep `alpha:true` while the iframe exists. |
| Q6 | **No blur on phones and low tier** | `style.css:59-69,189,217,230,256,468,630,1395`, `main.js` (after `detect`) | About 10 always-visible blurred panels, plus a full-screen `.overlay` blur, over a canvas that changes every frame. | In `main.js`: `body.classList.toggle('low', tier==='low')`. Under `body.low, body.touch` set `backdrop-filter:none` with a more opaque `--panel`. | Visual only: the panels look flatter. |
| Q7 | **Throttle the scene while the intro or modals are open** | `main.js:553-647`, `ui.js:211` | Full composer plus bloom renders behind the blurred intro, while the customiser runs its own WebGL context. | Intro open: render once, then every few frames (around 5–10 fps). Other non-tambola modals: render every 3rd frame or skip bloom. Keep the simulation updates running. Cap the customiser's pixel ratio at 1.5 (1 on low) and turn off its antialias on low (`customizer.js:48-49`). Do not dispose it: `portrait()` needs it. | The backdrop looks frozen or choppy under the blur, which is hard to notice. |
| Q8 | **Scale fireworks and smoke by tier** | `fireworks.js:4,92,224-232,564`, `smoke.js:70,79-87`, `main.js:193,424` | A 40k particle cap, fixed burst sizes, and trails spawned per frame (so more at 120 Hz) on every tier. The reflection draws all particles a second time. | Add `density = low?0.4:1` to the burst loops and emitter rates, with `MAX` about 12k on low. Spawn trails by time: `Math.random() < 18*dt*density`. Put `fireworks.points` on layer 1 on all tiers so the reflection skips them. On low, cap point size at 48 px for fireworks and 110 px for smoke, and reduce smoke `grow`. In the smoke shader, compute `cos/sin(seed)` in the vertex shader. | Bursts look sparser on phones; tune by eye. |
| Q9 | **Compile shaders while the loader is still up** | `main.js:489-491` | About 70 programs (40 on low) compile synchronously on the first frames after the loader is hidden. | `await renderer.compileAsync(scene, camera)` and render one warm-up `composer.render()` before `loader.classList.add('done')`. | The loader stays up a little longer. |
| Q10 | **Widen the weak-GPU check** | `settings.js:103` | Intel Arc, "Intel(R) Graphics", and M-series in Chrome ("ANGLE Metal Renderer: Apple M…") get the heaviest settings. | Add those patterns, or treat them as high with DPR 1.25. Do this after Q1, Q2 and B5 so the change can be judged on the new baseline. | Some capable machines would get a lower tier. |
| Q11 | **Cut redundant lights** | `kuan.js:52,100,148`, `booth.js:68`, `wall.js:38,100`, `vehicles/models.js:129,192`, `vehicles.js:219` | About 9 always-on lights in the games and UI area, 3 interior lights in the Kuan, and parked-car spotlights at intensity 0 that are still evaluated. | Replace the 4 booth lights with 1–2 over Khel Gali. Remove the Kuan interior lights (the emissive bands already exist). Use one shared headlight that is moved to whichever vehicle is driven. | Some areas get slightly darker. |
| Q12 | **Small fixes to the river reflection** | `water.js:150-175` | 456 draw calls per frame. | After Q4: render the reflection at 30 Hz by wrapping `onBeforeRender`, or skip it when the camera is far from the river. | The reflection lags one frame. |
| Q13 | **Fix CrowdScenes updating characters twice** | `extras.js:171` | `updatedThisFrame` is never set, so 17 characters get two pose updates per frame (also a visual bug). | Keep a separate `this.idle` list and update only that list in the final loop. | Garba timing changes; recheck it. |
| Q14 | **Per-frame waste on the CPU (bundle these together)** | `character.js:467`, `tambola.js:332`, `ramayan.js:326`, `kuan.js:272,310`, `train.js:256,379`, `boat.js:391,429`, `world.js:113`, `debris.js:58-87`, `ui.js:243-259,516-534`, `vehicles.js:123-126,196`, `physics.js:49`, `smoke.js:173`, `stringLights.js:78-113`, `ferrisWheel.js:204-217` | Small per-frame allocations, DOM writes and loops that run when nothing changes. | Each item below is independent: | Very low. Distant NPCs animating at 20 Hz is already accepted for Crowd. |

What Q14 involves, item by item:

- **Character update:** reuse a scratch object, `Object.assign(this._T ??= {}, DEFAULTS)`.
- **NPC distance rule:** apply the `npcs.js:262-264` rule (beyond 60 m, update every 3rd frame with dt*3) to Tambola, the Ramayan audience, Kuan, train passengers, keepers and the boatman. Tambola can return early when inactive and more than 45 m away.
- **Ride paths:** pass scratch targets, `getPointAt(u,_p)` and `getTangentAt(u,_t)`.
- **Debris:** use a dirty flag and skip `needsUpdate` when nothing is alive.
- **Prompt (`setPrompt`):** cache the elements and skip the write when the text is unchanged.
- **Game HUD bars:** cache the elements and animate with `transform: scaleX`.
- **Cars:** return early from `Car.step` when parked and stationary. Replace the `tall.filter` call with an inline loop.
- **String lights and wheel bulbs:** update colours at 20–30 Hz.

### Phase 2: Big wins (more effort, high impact)

| # | Title | Files:line | Why | Fix | Risk |
|---|---|---|---|---|---|
| B1 | **Merge each stall's static meshes** | `stalls.js:128-130,156-159,169-172,217,224,240,258,261` | 548 meshes and about 230 materials. These are draw calls on every tier, and phones are bound by draw calls. | After `createStall`, group meshes by material, turn the per-colour materials into vertex colours, and `mergeGeometries` them. Keep `keeper.root` separate. `shop.js` does not pick up stall goods, so this is safe. Target: under 50 calls per stall. | Low. Each stall loses per-object culling. |
| B2 | **Batch people's body parts** | `character.js:340-430`, `npcs.js`, `extras.js`, `net.js:356-376` | 11 draw calls per character: about 900 on high (plus the shadow pass) and 540 on low. | Step 1 (lower risk): one SkinnedMesh per character with 11 rigid bones, so 1 call per character with the same pose code. End state: a single `BatchedMesh` that reads matrices from each joint's `matrixWorld`. The player and the customiser preview stay separate. Remote players: show only the nearest K (16 on high, 8 on low) within 70 m, and turn shadows off beyond 25 m. | Medium. Layer masks (people are on layer 1) move to the batch, and culling and sorting work differently. |
| B3 | **Merge static world geometry** | `world.js:211-269,510-515,520-525,545-549`, `kuan.js:130-140`, `ramayan.js:90-103`, `booth.js:26-53`, `balloonShoot.js:41-51`, `ringToss.js:36-43`, `ferrisWheel.js:147-161`, `columbus.js:66-70`, `boat.js:133-137`, `train.js:193-238` | These are layer-0 objects, so merging them also shrinks the reflection pass. | Merge per material: gate, temple, ghat steps, field posts and tubes (with shared geometry), Kuan posts and stairs, Ramayan benches, and booth shells (one shared wood material). Use an InstancedMesh for balloons (with `instanceColor`, raycast by `instanceId`) and bottles. Wheel gondolas: one material per colour, cabin, posts and roof merged, Group kept as the seat anchor. Merge the bulbs. Freeze static subtrees with `matrixAutoUpdate=false`. | Low. Keep animated parts live: the temple flag, plaza star, keepers and rides. |
| B4 | **Instance the placed items on the wall** | `shop.js:8,295-311`, `items.js:101-130`, `wall.js:85-90` | A full Deepmala wall is about 100–145 draw calls next to the spawn point. | Use one InstancedMesh for diya bowls, one for flames (flicker by per-instance scale), and per-colour instancing for kandeels. Merge teddy and gift into one vertex-coloured mesh each. | Medium. The flame flicker logic needs porting. |
| B5 | **Adaptive resolution** | `main.js:149,281` | DPR 1.75 with no fallback when FPS drops. | A governor in the loop: if the average dt over 2–3 s is above 22 ms, step 1.75 → 1.5 → 1.25 → 1 with `renderer.setPixelRatio`, `composer.setPixelRatio` and `resize()`. Step back up when there is headroom, with hysteresis. Build it after Q1, Q2 and B1–B3, when it should rarely trigger. | The resolution change is visible when it happens. |
| B6 | **Draw the sky last among opaque objects** | `sky.js:11-47` | The full-screen dome is drawn first, so it shades every pixel before the geometry covers it. | Keep `depthTest` on, set `gl_Position.z = gl_Position.w`, and give it a high `renderOrder`. Move the stars after it. | Check the horizon blend at the ground edge. |

### Phase 3: Load-time

| # | Title | Files:line | Why | Fix | Risk |
|---|---|---|---|---|---|
| L1 | **Remove the font wait from the critical path** | `index.html:10`, `main.js:105-114,140-141` | A render-blocking cross-origin stylesheet (4 Poppins weights plus Yatra One), then a serial wait of up to 2.5 s before the renderer is created. | Self-host subsetted woff2 files (Latin, plus Devanagari for the sign) with `preload`, or load the CSS without blocking (`media=print onload`). Request only the weights that are used. Start `loadFonts()` at the top of `init()` and await it just before `buildWorld`. | A brief fallback font in HTML text. |
| L2 | **Re-encode the song** | `public/audio/diwali-song.mp3`, `audio.js:47-54` | 4.4 MB at 128 kbps stereo. It plays at 0.32 gain. | Re-encode to 96 kbps joint-stereo MP3 or 64–80 kbps AAC/Opus (about 2–3 MB). Create the `Audio` element only when `songPlaying` first becomes true, inside the user-gesture path. | Low. |
| L3 | **Separate chunk for three.js** | `vite.config.js` | One 945 KB chunk, so every deploy forces repeat visitors to re-download about 140 KB gzip of three.js. | `build.rolldownOptions.output.codeSplitting.groups: [{name:'three', test:/node_modules[\\/]three/}]` | Very low. First load does not shrink. |
| L4 | **Stop network calls that always fail on Pages** | `net.js:18-21,97-106`, `profile.js:51`, `.github/workflows/pages.yml` | The WebSocket retries every 15 s forever, and Topmate lookups always 404. | Without `VITE_WS_URL`, skip `net.connect()` or give up after 3 tries. Gate `fetchTopmate` on a `VITE_API_BASE` flag. | None. These requests can't succeed on Pages. |
| L5 | **Cheaper procedural textures** | `kuan.js:78-81`, `boat.js:43-46`, `utils.js:19` | About 10.5k fillStyle string parses at load. Anisotropy is 8 on every tier. | Use one fixed fillStyle and vary `globalAlpha`. Anisotropy 2 on low, `min(8, max)` on high. | Very low. |
| — | Code-splitting the games and poster | `main.js:23,363-399` | About 15–18 KB gzip, and they are constructed eagerly during init. | **Skip.** Lazy-loading Voice (about 2 KB) would need queuing of rtc messages, which isn't worth it. | — |

### Phase 4: Nice to have (memory leaks, server, audio)

- **Leaks to dispose, one helper (`disposeTree`) plus shared module-level geometry and materials:**
  - Remote players: `Character.dispose()` (materials only when `ownMaterial`) and `NameTag.dispose()`, called from `net.js:274-280`.
  - Sparklers: hoist the shared geometry and materials (`fireworks.js:428-446`).
  - Game rounds and food: `ringToss.js:80`, `cans.js:106`, `balloonShoot.js:109`, `food.js:167`, `misc.js:35,52`, `shop.js:283,339`, and the jalebi `TubeGeometry` (`items.js:44`).
  - Creator textures: dispose the old ones and downscale photos to 256² (`creators.js:100,110`).
- **Server and network** (does not affect Pages):
  - Send only players whose state changed, and have clients send only on change plus a 1 s keepalive (`realtime.mjs:178-182`, `net.js:352-355`).
  - Add a ws ping heartbeat with terminate.
  - Skip clients whose `bufferedAmount` is above 64 KB.
  - Use a compact array encoding.
- **Audio:**
  - Pre-render 1–3 crackle buffers: 2 nodes per crackle instead of 150 (`audio.js:159-165`).
  - Skip spatial sounds with gain under 0.03.
  - Create the band drone and dhol only on `setBand(true)` (`ambience.js:160-168`).
  - When the dhol is silent, advance `next` without creating nodes.
  - Call `setTargetAtTime` only when the change is above 0.005.
  - Voice: `equalpower` panning on low, and listener updates at 15–20 Hz (`voice.js:211-221,286-311`).
- **Smaller items:**
  - Tambola board: `generateMipmaps=false`, `LinearFilter`, and a `Set` for called numbers (`tambola.js:103-106,180-211`).
  - Poster capture: `createImageBitmap` or a 2D canvas downscaled to 1920, and `toBlob` with object URLs (`poster.js:424,512,558`).
  - Lower-poly people on the low tier, chosen at build time (`character.js:361-421`; no `THREE.LOD`).
  - Collision: a grid is optional at 227 colliders.
  - Name-tag atlas: only if the number of remote players grows.

## 3. How we measure

**What the repo already gives us** (`main.js:484-510`):

- `?play` skips the intro and sets `window.__mela`, which holds `{scene, camera, renderer, composer, bloom, player, world, fireworks, lightPool, crowd, …}`.
- `&tier=low|high` forces a tier, `&pos=x,z,heading` or `&place=gate|bazaar|games|plaza|ramleela|…` places the player, `&night` skips dusk, and `&show` starts the grand show.
- `&noyt` and `&nonet` remove the YouTube and network noise. `&script=KeyW@1,…` replays input.

Benchmarks run on a prod build (`npm run build && npx vite preview`), with the browser window at a fixed size.

**1. Per-frame render counts at fixed spots.** Use the 5 spots below, each at `tier=high` and `tier=low`. Example URL: `/?play&noyt&nonet&night&tier=high&place=bazaar`. Spots:
   - gate `pos=0,70,3.14`
   - bazaar
   - games
   - plaza
   - ramleela

   `composer.render` makes several render calls (main, shadow, reflection, bloom), so sum the counts across one frame. Paste this in the console:
   ```js
   const {renderer:r, scene:s} = __mela; r.info.autoReset = false;
   r.info.reset(); await new Promise(f => requestAnimationFrame(() => requestAnimationFrame(f)));
   let meshes=0, casters=0, pts=0, spots=0;
   s.traverse(o => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; } if (o.isPointLight && o.visible) pts++; if (o.isSpotLight && o.visible) spots++; });
   ({ calls: r.info.render.calls, tris: r.info.render.triangles, programs: r.info.programs.length,
      geoms: r.info.memory.geometries, tex: r.info.memory.textures, meshes, casters, pts, spots }); // one frame's totals
   ```
   Baseline to beat:
   - high: about 4,466 calls/frame (main 1,911, shadow 2,085, reflection 456), 70 programs, 57 lights, 2,083 casters.
   - low: about 1,951 calls, 40 programs.

   Targets: main pass under 700 on high, and under 1,000 total on low.

**2. FPS and frame time.**
   - Stand-still test: at each spot above, record 10 s with `&pos=` (same heading) and collect `performance.now()` deltas in a `requestAnimationFrame` hook. Report p50, p95 and p99 frame time, and the share of frames over 33 ms.
   - Moving test: a fixed walk with `&place=gate&script=KeyW@1,…` (hold W through repeated keydowns, or teleport through the 5 spots with `player.teleport` every 3 s from the console).
   - Stress test: `&show&night` (finale particles).
   - Run on a desktop, on CPU 4x throttling, and on a real phone with `&tier=low` (or remote debugging over USB).
   - Cross-check one run with a Chrome Performance trace: GPU-thread time and the compositor share, to confirm Q6 (blur) and Q5 (YouTube iframe).

**3. Startup.** Measure the time from navigation to the loader being hidden, and the longest task in the first 3 s after it hides (Performance panel, or `PerformanceObserver('longtask')`). This shows the Q9 shader-compile stall. Throttle the network to Fast 4G to see the font wait (L1).

**4. Low-tier checks.** At 1280x720 with `&tier=low`:
   - `__mela.bloom.renderTargetsHorizontal[0].width` should be 320 after Q3 (baseline 640).
   - `renderer.getContextAttributes().antialias` should be `false` after Q4.

**5. Memory and leaks.** Record `renderer.info.memory.geometries/textures` before and after playing 5 ring-toss rounds, a golgappa challenge and 3 sparklers. After the Phase 4 fixes the counts should return to the starting values.

**6. Build and network.**
   - Run `npm run build` and log the chunk sizes (baseline: 945 KB / 272 KB gzip JS, 21 KB CSS).
   - `ls -l dist/audio` (baseline 4.4 MB).
   - DevTools Network: total bytes over the first 60 s with and without `&noyt`. This is the YouTube cost that Q5 removes.

**Process:** before each phase, write down the numbers for every spot and tier from steps 1–3. Land one item per commit and re-measure. For any lighting change (Q1, Q11), compare screenshots taken from the same `&pos`/`&night` URLs.
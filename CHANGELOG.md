# Changelog

## 0.1.157 — 2026-07-10

### Refactor

- **Server** — shared route helpers (`errorMessage`, `parsePagination`, `parseIdParam`) and centralized config-dir resolution
- **Server** — `maskApiKey` helper for settings API key previews
- **Scripts** — shared `media_read_config_port` / `media_read_config_public_prefix` in `ui.sh`
- **Web** — remove `media-image-url` shim; use `api.imageUrl` directly in media hero

## 0.1.156 — 2026-07-10

### Fix

- **UI** — desktop scroll rows pad the trailing edge and fade the right side so the last poster is not hidden under the scroll arrow

## 0.1.155 — 2026-07-10

### Fix

- **Deploy** — `restart-prod.sh` uses port listeners (not `pgrep`) to detect stale processes, force-kills stubborn listeners, and always starts the replacement (fixes in-app updates that leave the server offline)

## 0.1.154 — 2026-07-10

### Fix

- **Android TV** — native subtitle hot-swap always re-prepares ExoPlayer and re-shows SubtitleView when tracks change (fixes missing cues after switching subtitles mid-playback)

## 0.1.153 — 2026-07-10

### Fix

- **Android TV** — Back from native playback uses WebView history when available instead of always stopping the player
- **Android TV** — defer stopping ExoPlayer until after the destination route paints (no black flash leaving watch)
- **TV** — shared row/gutter spacing tokens across all views; 4K uses higher image quality (90) on posters, heroes, and playback backdrops
- **TV** — home focus lands on the first video poster (Continue Watching) instead of browse cards
- **TV** — watch subtitle/quality menus scroll and wrap long labels on 4K displays
- **Server** — Plex import runs a full-system `find` for the library DB (cached 5 min) in addition to known paths

## 0.1.152 — 2026-07-10

### Fix

- **Android TV** — sharper adaptive icon and banner (larger M!, hero primary/accent colors, no nested tile in foreground)
- **Server** — Plex import detects Docker/snap/custom installs via `PLEX_DB_PATH`, `PLEX_HOME`, and a bounded filesystem scan; clearer warnings when the DB is unreadable or remote
- **Settings** — Plex import panel lists paths checked and documents Docker `PLEX_DB_PATH`

## 0.1.151 — 2026-07-10

### Fix

- **TV** — 4K layout polish: larger posters (10rem), row spacing, nav chrome, focus rings, and poster image `sizes` for sharper grids on 2160p displays

## 0.1.150 — 2026-07-10

### Fix

- **Performance** — poster prefetch warms hero-sized backdrop images (1920px) so media pages do not refetch after navigation
- **Performance** — `/_next/image` prefetch URLs respect `basePath` for subpath installs

## 0.1.149 — 2026-07-10

### Fix

- **Android TV** — keep splash visible until TV content is actually ready (`data-tv-content-ready`) instead of timing out at 15s on slow loads
- **Android TV** — lighter splash animation (static title gradient, simpler ring pulse) to reduce UI-thread jank on boot

### Enhancement

- **Playback** — prefetch theme music when hovering/focusing posters so media pages start theme audio faster
- **UI** — theme music waveform uses primary/accent gradient bars; dedupe concurrent theme blob fetches

## 0.1.148 — 2026-07-10

### Fix

- **Deploy** — track updater PID in `updating.lock` and clear stale locks when the detached update process has exited (fixes permanent “Restarting…” / blocked installs)
- **Deploy** — run `restart-prod.sh` with a 60s timeout so a stuck restart cannot leave the updater hanging forever

## 0.1.147 — 2026-07-10

### Fix

- **TV** — remove theme music mute button from media banner; theme music always plays on TV (ignores desktop mute preference)

## 0.1.146 — 2026-07-10

### Fix

- **Deploy** — skip library scans during build-time prerender API and kill the whole process group on teardown so in-app updates do not hang after “Build application”
- **TV** — focus Play on movie detail pages; stop refetch from stealing focus after Favorite/season selection
- **TV** — watch quality button label no longer truncates (full width + `watch-control-label`)

## 0.1.145 — 2026-07-10

### Fix

- **Deploy** — in-app update uses `restart-prod.sh` with a full stop/wait loop so ports 8096/8097 are free before the new stack starts (fixes EADDRINUSE and stuck “Restarting…” installs)
- **Deploy** — replace legacy `~/.startup/reel` scripts that only slept 1s after kill; new MEDIA_STARTUP_V2 template waits for API/web processes to exit
- **Deploy** — broaden process cleanup patterns so full-path node servers are stopped during restart

## 0.1.144 — 2026-07-10

### Fix

- **Server** — graceful shutdown stops all active HLS encoders on SIGTERM/SIGINT instead of leaving orphaned ffmpeg or crashing on async exit bookkeeping
- **Server** — `restart-prod.sh` waits for old API/web processes to exit before starting replacements (fixes EADDRINUSE on 8097 and mid-playback ffmpeg kills)
- **Server** — `start-prod.sh` supervisor lock prevents duplicate production stacks from racing the same ports

## 0.1.143 — 2026-07-10

### Fix

- **Playback** — remove client-side HLS buffer gate that could infinite-hold when the encoder runs near real time; let hls.js own buffer growth and resume after new fragments land
- **Server** — revert remux `-break_non_keyframes` (was producing invalid segment boundaries on long-GOP HEVC)

## 0.1.142 — 2026-07-10

### Fix

- **Playback** — HLS buffer gate holds playback until forward buffer refills (18s start / 8s min / 24s resume) instead of stuttering segment-by-segment at the growing encode edge
- **Playback** — disable hls.js hole nudging and automatic seeks on recovery so the playhead never jumps ahead or rewinds
- **Playback** — pin spurious-`ended` resume to last stable position; skip progress save during buffer gate (desktop + TV)

## 0.1.141 — 2026-07-10

### Fix

- **Playback** — use source-matched 2160p HLS when the browser cannot remux HEVC originals (full 4K quality instead of downscaling)
- **Playback** — stall watchdog waits on growing encode edges instead of pipeline-resetting; only escalates when the decoder is wedged on buffered data
- **Server** — 2160p transcode uses ultrafast/zerolatency; remux allows non-keyframe segment cuts for long-GOP HEVC; resume dead encodes after 1 segment (new sessions after 2); protect actively-serving transcodes for 90s

## 0.1.140 — 2026-07-10

### Fix

- **UI** — home hero title uses solid colors instead of gradient `background-clip:text` so "MEDIA!" paints reliably on hard reload and TV WebView
- **UI** — Inter `font-display: swap` so text always renders on slow networks
- **Subtitles** — default cue color is white with outline (web + native TV); migrate legacy black-on-transparent prefs

### UI

- **Document titles** — absolute `Page · MEDIA!` metadata on all routes for consistent SSR/hard-load tab titles

## 0.1.139 — 2026-07-10

### Fix

- **Subtitles** — preserve fractional resume offsets (ms precision) end-to-end so native HLS and web cue overlays stay aligned after mid-movie resume
- **Subtitles** — poll web cue overlay at 100ms while playing so short cues are not missed between sparse `timeupdate` events
- **Subtitles** — shared `convertSrtToVtt` with BOM/CRLF handling; VTT timestamp formatting rounds via total milliseconds

### TV

- **Watch UI** — circular 52px transport buttons with centered Lucide icons and dedicated `watch` focus variant

## 0.1.138 — 2026-07-10

### Fix

- **Playback** — poll `video.buffered` every 500ms so the scrubber buffer bar stays accurate while paused (desktop + TV)

### TV

- **Watch UI** — polish transport controls (consistent focus/selected states, sizing, subtitle and quality menu styling)
- **Native player** — black ExoPlayer background to avoid flash during direct play

### Tooling

- **Android TV** — add `scripts/deploy-android-tv.sh` and `pnpm tv-deploy` / `tv-deploy:release` for local APK deploy over adb

## 0.1.137 — 2026-07-09

### Fix

- **Server** — never emit `#EXT-X-ENDLIST` for SIGTERM'd or short partial transcodes; only when produced duration actually covers the source
- **Server** — resume dead-but-incomplete transcode sessions on playlist requests instead of serving a frozen ~20s partial playlist forever
- **Server** — protect actively-serving transcode sessions from capacity/cleanup kills during playlist polls; return 503 on mid-flush instead of stopping ffmpeg

## 0.1.136 — 2026-07-09

### Fix

- **Playback** — trust hls.js native live-playlist reload for growing transcodes instead of custom manifest polling and `startLoad()` refresh loops that reset the fragment loader and stall buffer growth
- **Playback** — simplify spurious-`ended` recovery to a tiny backward seek + `play()`; rework stall watchdog to nudge → pipeline reset → fatal escalation
- **Playback** — guard `saveProgress` against persisting regressed positions during stream restarts (desktop + TV)

## 0.1.135 — 2026-07-09

### Fix

- **Playback** — serve ffmpeg's real HLS playlist with accurate per-segment `#EXTINF` durations instead of synthesizing fixed 6.0s segments (fixes buffer/live-edge math stalls when source GOPs produce longer segments)
- **Server** — force keyframes at every segment boundary (`-force_key_frames`) for uniform transcode segments; retry playlist generation on mid-flush instead of killing a healthy transcode

## 0.1.134 — 2026-07-09

### Fix

- **Playback** — smarter spurious-`ended` recovery at growing transcode edges: coalesce rapid repeats, replay in place by default, only full-restart after sustained failure without forward progress (desktop + TV)

## 0.1.133 — 2026-07-09

### Fix

- **Playback** — fix infinite buffering after the first transcode window: keep manifest polling through premature `ended`, use contiguous buffer runway (ignore prefetch islands), poll every 2s until ENDLIST, recover on stall at growing playlist edge
- **Server** — mark in-progress HLS playlists as `#EXT-X-PLAYLIST-TYPE:EVENT`; skip segment 304 while transcode is still running

## 0.1.132 — 2026-07-09

### Fix

- **Playback** — harden growing transcode recovery: FRAG_PARSED resume, BUFFER_STALLED_ERROR refresh, monotonic ENDLIST tracking, startLoad(position) instead of no-op loadLevel reassignment
- **Playback** — improve spurious-ended detection with playlist-edge math and finite VTT-offset guard; tighten hls.js buffer tuning (back/max buffer, hole, nudge retries)
- **Playback** — prevent energy suck: Atomics.wait sleep helper avoids tight spin, partial transcode-dir cleanup, safer kill handling
- **Server** — /info perf + safety: reuse single ffprobe for metadata + range, guard stat/lstat throws, remove filePath leak from API, add strong ETag + 304 conditional GET helper for HLS playlists/segments
- **Test** — stabilize ffmpeg windowing test for 300-segment retention (30 min at 6 s) and increase MAX_CONCURRENT_TRANSCODES to 4

## 0.1.131 — 2026-07-09

### Fix

- **Build** — detect `#EXT-X-ENDLIST` from the playlist m3u8 text instead of the untyped `details.endList` field (fixes CI typecheck)

## 0.1.130 — 2026-07-09

### Fix

- **Playback** — use `hls.startLoad()` to reload growing transcode manifests; re-assigning the same `loadLevel` was a no-op in hls.js and stopped buffering after the first window
- **Playback** — gate manifest refresh on `#EXT-X-ENDLIST` (`details.endList`), not `details.live`, so VoD-style growing transcodes keep discovering new segments

## 0.1.129 — 2026-07-09

### Fix

- **Playback** — keep refreshing growing HLS transcode playlists until `#EXT-X-ENDLIST` appears; `video.duration` alone is the partial encode length, not the file end

## 0.1.128 — 2026-07-09

### Fix

- **Playback** — prune and window HLS segments based on what the client has consumed, not how far ffmpeg has encoded ahead (fixes forward skips on fresh transcodes)
- **Playback** — clamp sudden forward position spikes when tracking stable resume position during HLS recovery (desktop + TV)

## 0.1.127 — 2026-07-09

### Fix

- **Deploy** — auto-restart the web + API stack when either process dies or the API stops responding (shared hosting)
- **Playback** — recover cleanly from premature HLS `ended` events at transcode boundaries; full stream restart after repeated failures
- **Playback** — only mark transcodes complete with `#EXT-X-ENDLIST` when ffmpeg exits successfully

## 0.1.126 — 2026-07-09

### Fix

- **Deploy** — do not start the Next.js web server when the internal API fails to become ready; exit and let systemd restart instead of serving an empty library
- **Deploy** — align `/api` rewrite port with `MEDIA_INTERNAL_API_PORT` and verify the API responds after updates

## 0.1.125 — 2026-07-09

### Fix

- **Playback** — keep video playing when the browser tab loses focus; only save progress instead of pausing and killing the transcode
- **Playback** — stop exiting watch when HLS hits a growing playlist boundary; recover and continue instead of treating it as the end of the file
- **Playback** — preserve the current position on quality changes and auto-fallback instead of restarting from saved resume
- **Playback** — only mark transcodes complete with `#EXT-X-ENDLIST` when ffmpeg exits successfully, not on failure
- **Playback** — refresh the HLS manifest when returning to a foreground tab or when paused near the buffer edge
- **Playback** — stop orphaned ffmpeg sessions when switching from transcode to direct play

## 0.1.124 — 2026-07-09

### Fix

- **Playback** — fix scattered buffer dots on the scrubber by serving growing transcode playlists as VoD with `#EXT-X-ENDLIST` so hls.js loads segments sequentially instead of prefetching at the live edge
- **Playback** — poll the manifest before the buffer runs low so new segments are discovered during ongoing transcodes
- **Playback** — scrubber shows one contiguous buffered range from the playhead instead of disconnected islands ahead

## 0.1.123 — 2026-07-09

### Fix

- **Playback** — fix HLS stalling after the first buffer by loading segments sequentially from the buffer end instead of prefetching ahead of the playhead
- **Playback** — poll the growing transcode playlist and recover when playback stalls at the buffer edge
- **Playback** — stop killing the active ffmpeg transcode on seek or stream restart; only stop when leaving the title
- **Playback** — wait for four HLS segments before starting playback so the first buffer has enough runway

## 0.1.122 — 2026-07-09

### Fix

- **Playback** — fix HLS stalling at the first buffer edge caused by live-edge prefetch leaving gaps ahead of the playhead
- **Playback** — resume segment loading on waiting, playlist updates, and fragment errors instead of requiring a refresh

## 0.1.121 — 2026-07-09

### Fix

- **Playback** — stop HLS from stalling at the end of the first buffer; clearing seek state no longer kills the active transcode session mid-playback
- **Playback** — server waits for in-progress HLS segments instead of returning 404 while ffmpeg is still encoding
- **Playback** — hls.js keeps polling growing EVENT playlists for new segments

## 0.1.120 — 2026-07-09

### Fix

- **Playback** — stop buffering recoveries from jumping forward to a stale position instead of continuing where you were watching
- **Playback** — clear one-shot seek targets after stream restarts so later recoveries follow the live playhead

### TV

- **Playback** — commit scrub preview on blur and restart the stream when seeking outside the buffered range

## 0.1.119 — 2026-07-09

### Fix

- **Build** — remove duplicate import in TV watch view that broke the production Next.js build and left the site unstyled (CSS chunks returned 500)

## 0.1.118 — 2026-07-09

### Fix

- **Playback** — stop buffering recoveries from jumping to the end of the buffered range when the player briefly reports the buffer edge instead of the real playhead

### TV

- **Playback** — same stable-playhead restart fix on Android TV

## 0.1.117 — 2026-07-09

### Fix

- **Playback** — stop stream restarts during buffering from jumping back to the saved resume point instead of the current playhead

### TV

- **Playback** — same resume-position restart fix on Android TV

### UI

- **Posters** — prefetch carousel artwork on row hover and scroll so off-screen tiles decode sooner

## 0.1.116 — 2026-07-08

### TV

- **Playback** — watch scrubber and subtitle/quality menus mirror the desktop player (popover menus, ghost transport controls, preview-then-commit scrubbing)
- **Playback** — scrubber shows the saved resume position immediately when opening a title instead of creeping from zero

## 0.1.115 — 2026-07-08

### TV

- **Startup** — keep the native splash up until auth and page content are ready; homepage-style animated MEDIA! hero on launch
- **Playback** — clearer mid-stream buffering (scrubber buffer state, no settings chrome flash while rebuffering)
- **UI** — center sidebar logo in the nav rail

## 0.1.114 — 2026-07-08

### TV

- **Playback** — prefer native direct play on Android TV; fix black-screen overlay during loading; sync subtitles reliably and apply saved styles at start
- **Playback** — Back dismisses controls whenever they are visible; exit only when controls are hidden
- **UI** — center sidebar logo; MEDIA! startup splash until the web UI is ready
- **Android TV app** — launcher icon matches in-app branding; voice search via system recognizer (no mic permission)

### Fix

- **Playback** — do not treat ExoPlayer idle state as buffering on native TV


### Fix

- **Settings** — stop MEDIA! before prefix rebuilds, handle systemd restarts cleanly, log to `restart.log`, and ignore stale `MEDIA_PUBLIC_PREFIX` env

## 0.1.112 — 2026-07-08

### Fix

- **Reverse proxy** — clearing the public prefix now triggers a clean web rebuild so `/reel` does not stick in asset URLs
- **Home** — reduce font flicker on first load by prioritizing Inter over poster preloads and fading the hero title in once fonts are ready

## 0.1.111 — 2026-07-08

### Fix

- **Reverse proxy** — pass `MEDIA_PUBLIC_PREFIX` through Turbo builds so `basePath` is applied

## 0.1.110 — 2026-07-08

### Settings

- **Reverse proxy** — editable public URL prefix in Settings; save rebuilds (when changed) and restarts MEDIA!

## 0.1.109 — 2026-07-08

### Fix

- **Reverse proxy** — remove gateway `?__p=` mode; use a proper subpath proxy instead (see `docs/reverse-proxy.md`)

## 0.1.108 — 2026-07-08

### Fix

- **Reverse proxy** — gateway routing reads runtime `MEDIA_GATEWAY_PREFIX` and handles Apache stripping `/reel` to `/`

## 0.1.107 — 2026-07-08

### Fix

- **Reverse proxy** — gateway builds now emit `/_next` assets through `/reel?__p=…` (webpack build + HTML rewrite)

## 0.1.106 — 2026-07-08

### Fix

- **Reverse proxy** — gateway URL mode for broken Apache subpath proxies (`/reel?__p=…`); see `docs/gateway-proxy.md`
- **TV** — subtitle settings menu as a side panel with working D-pad navigation; smaller sidebar logo

## 0.1.105 — 2026-07-07

### Fix

- **Images** — allowlist `/api/images/**` in Next.js `localPatterns` so `/_next/image` no longer returns 400 for poster URLs
- **Images** — let the image optimizer fetch cached artwork from localhost on password-protected servers
- **Theme music** — guard the media-banner waveform canvas when layout is too narrow (fixes `roundRect` negative radius crash)

## 0.1.104 — 2026-07-07

### Performance

- **Images** — serve posters, backdrops, and stills through the Next.js image optimizer (AVIF/WebP via sharp) instead of full-size JPEGs
- **Images** — shared `MediaImage` component with responsive `sizes`; prefetch and playback preload warm optimized `/_next/image` URLs

### TV

- **Images** — TV posters and episode stills keep eager priority loading through `next/image`

## 0.1.103 — 2026-07-07

### Performance

- **Images** — eager-load above-fold posters, preload artwork on hover/TV focus, and warm media JSON before navigation
- **TV home** — server-seed home rows so posters render immediately instead of waiting on a client fetch spinner
- **Media pages** — eager-load hero backdrop and poster for faster first paint

### Fix

- **Deploy** — migrate legacy `~/.startup/reel` to `start-prod.sh`, verify Next.js is serving pages after update, and remove stale static export output on build
- **API proxy** — keep runtime `/api` rewrites on port 8097 instead of baking the ephemeral prerender port into the build
- **Next.js** — rename `middleware.ts` to `proxy.ts` (Next 16 convention)

## 0.1.102 — 2026-07-07

### Fix

- **Media pages** — force clean `.next` output on build and fail if prerendered HTML still contains loading skeletons; wipe web build cache on server deploy
- **Build** — disable turbopack filesystem build cache to avoid stale prerender shells across releases

### Performance

- **Media pages** — revalidate ISR cache by tag when a new TV episode is scanned so season lists refresh without waiting for the 5-minute TTL

## 0.1.101 — 2026-07-07

### Fix

- **Media pages** — remove `loading.tsx` from static ISR routes so prerendered hero HTML is visible immediately instead of a Suspense skeleton shell that waits for client hydration
- **Build** — verify pre-rendered media HTML includes hero markup and warn when loading shells leak into static output

## 0.1.100 — 2026-07-07

### Performance

- **App** — adopt Next.js App Router best practices: server-fetched home and list pages with ISR (`revalidate` 1 min), route-level `loading.tsx` for instant `<Link>` navigation, and shared server API helpers
- **Media pages** — async RSC page with `loading.tsx`, server hero, Suspense-streamed related titles, and ISR caching (no client skeletons or hard navigation)

### Fix

- **Media pages** — show sign-in prompt instead of a blank page when SSR cannot read a password-protected library; fix internal API auth for related titles and other SSR paths
- **Search** — wrap `useSearchParams` in Suspense to avoid client rendering bailout
- **Middleware** — redirect legacy `/favorites/?type=` query URLs to canonical paths

### UI

- **App** — global `error.tsx` recovery UI; route metadata titles on home, library, favorites, settings, and other main routes

## 0.1.99 — 2026-07-07

### Fix

- **Media pages** — server-render the hero in RSC so navigation never flashes a client skeleton; tighten internal API auth for SSR on password-protected servers

## 0.1.98 — 2026-07-07

### Fix

- **Media pages** — stop loading skeletons on password-protected servers by allowing Next's localhost internal API reads; seed hero data from server props and prefetch cache on client navigation
- **Deploy** — clear build-time API env vars in `start-prod.sh` so production does not proxy to the prerender port

## 0.1.97 — 2026-07-07

### Performance

- **Media pages** — pre-render all library titles at build time via `generateStaticParams`; new titles added after deploy still generate on first visit with ISR (`revalidate` 5 min)

## 0.1.96 — 2026-07-07

### Fix

- **Media pages** — ISR routes now server-render the hero instead of showing a skeleton while client JS loads; `useSearchParams` is limited to legacy `/media/?id=` URLs

## 0.1.95 — 2026-07-07

### Performance

- **Media pages** — run Next.js in server mode with ISR (`revalidate` 5 min), prefetch on poster hover/focus, and split related-title loading so the hero renders without waiting
- **Deploy** — serve the web UI from Next standalone; Fastify runs API-only on an internal port (`scripts/start-prod.sh`)

### Fix

- **API** — stop Next trailing-slash redirects from breaking `/api/stream` and other backend routes
- **Continue watching** — prune orphaned watch-progress rows when episodes/files are gone; hide the home row when empty
- **Subtitles** — fix appearance preview sizing, keep captions visible while the appearance panel is open, and only show background opacity when a background is selected

### UI

- **Subtitles** — new defaults: large sans-serif, black text, no background, outline edge

### TV

- **Android TV** — center the home-screen banner icon and wordmark
- **Subtitles** — match new default appearance styles in ExoPlayer

## 0.1.94 — 2026-07-07

### Fix

- **Subtitles** — sync web captions to live HLS playback time (not stale resume offset), reset offset on title change, and hide subtitles until the video actually starts playing

## 0.1.93 — 2026-07-07

### Fix

- **Subtitles** — sync HLS captions to absolute playback time on resume and seek-restart; hide them while watch menus are open and keep them below the controls chrome

## 0.1.92 — 2026-07-07

### Fix

- **Subtitles** — render web captions from parsed VTT timed to playback (reliable on HLS) and show clear errors when subtitle loads fail

## 0.1.91 — 2026-07-07

### Fix

- **Navigation** — parse entity IDs from the browser URL so `/media/7/` and other path routes work with static export (no more “Invalid media” flash)
- **Subtitles** — render desktop captions above watch controls via a DOM overlay and fix track sync races during HLS playback

## 0.1.90 — 2026-07-07

### Fix

- **Subtitles** — stop clearing web subtitle tracks on every HLS buffer event and preserve stored selection on page load

## 0.1.89 — 2026-07-07

### UI

- **URLs** — path-based routes (`/media/7/`, `/watch/movie/42/`, `/deck/5/`) with legacy query-param redirects
- **Watch player** — compact subtitle appearance submenu in the subtitles popover on desktop

### Fix

- **Subtitles** — apply appearance changes live on web and restore tracks after tab switch or navigation

### TV

- **ExoPlayer** — subtitle appearance styling via `setSubtitleStyles` bridge and smoother track hot-swap
- **ExoPlayer** — enable HDR window mode earlier when stream metadata reports HDR

## 0.1.88 — 2026-07-07

### Fix

- **Subtitles** — restore web subtitle display after playback reloads and fix HLS resume timing by shifting VTT cues to the stream offset
- **Subtitles** — prefetch and cache tracks for instant selection; native hot-swap only applies when ExoPlayer is active

### TV

- **Subtitles** — pass timeline offset to native subtitle URLs so cues stay in sync during transcoded playback

## 0.1.87 — 2026-07-07

### UI

- **Watch player** — subtitle appearance opens in a modal over the video from the subtitles menu instead of Settings

## 0.1.86 — 2026-07-07

### Fix

- **TV playback** — stop audio when leaving watch for home by tearing down native/web playback before navigation

### TV

- **Subtitles** — hot-swap tracks without a full player restart via a new native `setSubtitles` bridge
- **Subtitles** — full-screen settings menus with vertical D-pad navigation, section labels, and a back header
- **Subtitles** — keep the track menu open after selection so the active track stays visible

## 0.1.85 — 2026-07-06

### UI

- **Desktop nav** — logo without the dark tile background, tighter crop, and sizing aligned with the search bar

## 0.1.84 — 2026-07-06

### UI

- **Home** — redesigned hero with signal-style layout, animated headline, telemetry stats, and a monitor-style featured card
- **Home** — full recently added card is clickable, not just the Open button

## 0.1.83 — 2026-07-06

### Fix

- **Android TV 4K playback** — remove tunneled decoding that hung on some panels; 4K titles no longer stuck on "Loading video..."
- **Android TV HDR** — apply HDR window mode only after the player is ready

### TV

- **Back navigation** — one Back exits watch (unless controls were just opened); replace history so Back from the title page does not reopen playback
- **Side nav** — larger transparent logo without the dark tile background

## 0.1.82 — 2026-07-06

### Fix

- **Android TV HDR** — pass HDR through to the panel on native direct play; enable tunneling, HDR window mode, and stop the WebView overlay from dimming video during playback or buffering

### TV

- **4K SD content** — softer upscaling on 4K panels (native GPU upscale for SD, WebView soften fallback, Lanczos when transcoding)

### Playback

- **Transcode** — use Lanczos scaling when upscaling during transcode

## 0.1.81 — 2026-07-06

### Fix

- **Watch player** — hide dynamic range on SDR streams instead of showing "Original · null"

### TV

- **4K displays** — serve HD poster and backdrop tiers, detect 4K panels for sharper imagery and slightly larger UI
- **4K displays** — improve WebView viewport scaling on Android TV

## 0.1.80 — 2026-07-06

### TV

- **Watch player** — overlay transport controls on full-screen video instead of a bottom dock that shrank the picture
- **Watch player** — tighter button, title, and loading chrome sizing for a better 10-foot viewing experience
- **Watch player** — smaller seek-preview thumbnails and safe-area padding on the control bar

## 0.1.79 — 2026-07-06

### Android TV

- **Setup** — stop auto-opening the keyboard on the QR pairing screen; focus Connect by default and show the IME only when selecting manual host/port fields

## 0.1.78 — 2026-07-06

### UI

- **Branding** — animated MEDIA! logo on desktop (exclamation bounce on hover)

### Android TV

- **Branding** — updated launcher icon, round icon, and TV banner to match web colors and wordmark
- **Launcher** — setup screen label matches the app name

## 0.1.77 — 2026-07-06

### Playback

- **Dolby Vision / HDR** — detect dynamic range from ffprobe (Dolby Vision profile, HDR10, HLG) and expose it in stream info
- **Dolby Vision / HDR** — tone-map HDR and Dolby Vision sources when transcoding for SDR browsers
- **Dolby Vision / HDR** — show dynamic range in file details and the watch player chrome (desktop and TV)
- **Dolby Vision / HDR** — note Android TV direct-play passthrough for Dolby Vision in file details
- **Scrubber** — hover preview with faster thumbnail polling and a playhead marker on desktop
- **Controls** — fix volume slider clipping on desktop

### UI

- **Desktop player** — keyboard shortcut hints on hover for transport, quality, subtitles, cast, and display mode controls

### TV

- **Controls** — remove redundant on-screen Back button (remote Back still exits playback)
- **Playback** — show dynamic range alongside quality in the watch chrome

## 0.1.76 — 2026-07-06

### Fix

- **Updates** — reload the browser automatically when an in-app server update finishes so fresh JS assets load
- **Playback** — recover from stale chunk errors after deploys instead of hanging on the watch-page loader
- **Playback** — reload if the watch route spinner is still showing after 12 seconds

## 0.1.75 — 2026-07-06

### TV

- **Subtitles** — customize appearance from the player (size, font, color, opacity, background, edge style) with live preview, matching desktop Settings
- **Subtitles** — appearance settings share the same device preferences as desktop
- **Navigation** — spatial nav stays scoped inside watch menus (subtitles, quality, appearance)
- **Subtitles** — online search dialog focuses the first actionable control on open
- **Controls** — larger transport buttons, clearer aria labels, and dialog roles on player menus
- **Remote** — dedicated MediaPlay/MediaPause handling; rewind/forward keys seek when controls are hidden

### Fix

- **Playback** — clear buffering state when the video reaches `canplay`
- **Subtitles** — TV cue size respects user appearance settings instead of a fixed size

## 0.1.74 — 2026-07-06

### Playback

- **MKV/WebM** — remux browser-safe codecs in non-progressive containers (MKV, WebM, etc.) over HLS instead of broken direct play
- **HLS recovery** — retry network and media errors before failing playback on desktop and TV web
- **Visibility** — restart stopped HLS transcode sessions when returning to the watch tab or app

### Fix

- **Streaming** — parse HTTP range requests correctly (including suffix ranges) and return proper `416` responses
- **Streaming** — send credential-aware CORS headers on media, HLS, and subtitle responses
- **Transcoding** — accept completed short HLS playlists while waiting for the first segment

### TV

- **Playback** — resume HLS after the player was backgrounded, matching desktop behavior

## 0.1.73 — 2026-07-06

### Fix

- **Updater** — show full release notes with scroll instead of truncating long changelogs

### TV

- **Playback** — hide player controls while center-screen messages are shown (errors, loading, next-episode countdown) so overlay buttons stay focusable
- **Updates** — update modal available in TV mode, not only desktop

### UI

- **Updater** — pin action buttons below a scrollable release-notes area in the update modal

### Tooling

- **README** — document all integrations (TMDB, fanart.tv, ThemerrDB, OpenSubtitles, Plex import, Chromecast, cast-to-TV, GitHub updates)

## 0.1.72 — 2026-07-05

### Fix

- **Native 4K playback** — stop WebView alpha-blending from dimming ExoPlayer (SurfaceView + hide overlay while controls are hidden; transparent control chrome)

### TV

- **Navigation** — restore left sidebar rail (Home, Favorites, Search) instead of the desktop top header
- **Native playback** — hide the WebView layer during playback so video is not darkened under transparent pixels

### Android TV

- **Video surface** — switch ExoPlayer from TextureView to SurfaceView for correct compositing behind the WebView shell

## 0.1.71 — 2026-07-05

### Fix

- **In-app updates** — faster apply path without a slow GitHub round-trip before starting the update; fetch timeouts and clearer errors
- **Scrubber** — fix misaligned playhead on desktop and TV by centering the range overlay, hiding the native thumb, and unclipping the custom playhead

### TV

- **Native playback** — remove poster and loading dimming over ExoPlayer; prefer direct play for 4K MKV; lighter control chrome during playback
- **Navigation** — match desktop top header with shared tab styling (Home, Favorites, Settings)
- **Scrubber focus** — highlight the track bar instead of solid nav fill when selected on D-pad

### Android TV

- **WebView compositing** — transparent WebView background for clearer native video (`isOpaque = false`; rebuild APK to pick up)

### UI

- **Navigation** — shared `NavTab` component for desktop and TV headers

## 0.1.70 — 2026-07-05

### Fix
- **Quality labels** — classify widescreen 1080p sources by width (e.g. 1920×800) instead of mislabeling as 720p
- **TV scrolling** — faster horizontal row navigation when holding left/right on the remote
- **TV resume** — fix playback not continuing after pause and idle; sync native player state on activity resume
- **TV startup** — hide desktop UI flash while the Android TV shell loads

### Playback
- **Default quality** — always start at Original; remove network-based auto-downgrade on open
- **Display mode** — fit / fill / stretch toggle on desktop and TV (including native ExoPlayer stretch)
- **Reliability** — stream info errors surface instead of spinning; HLS fatal-error guard and recovery after long pause; progress saved on unmount and page hide; remux failure steps to source-matched transcode tier
- **Fallback** — skip blind 2160p transcode when remux fails on 1080p sources

### TV
- **Spatial nav** — O(1) focus tracking, edge-based row scroll, no repeat throttle on poster rows
- **Watch player** — HLS restart at current position after long pause or error (up to 3 attempts)

### Server
- **Probe** — SAR-aware display dimensions for accurate quality tiers (e.g. 1440×1080 → 1920×1080)
- **Streaming** — validate remux video copy support and HLS segment paths; clean up failed transcode sessions

### Tooling
- **Tests** — Vitest suite for shared, server, and web; GitHub Actions CI; release script runs tests before push

## 0.1.69 — 2026-07-05

### Fix
- **Home rows** — hide the left scroll arrow on collection rows until you’ve scrolled right (fixes false “scroll back” affordance on initial load)

## 0.1.68 — 2026-07-05

### Android TV (app 1.4.6)
- **Native playback** — transparent WebView/TextureView compositing so video is visible (fixes audio-only black screen)
- **Remote** — pass OK/Center and left/right to the WebView; stop native seek/play intercepts that bypassed focused controls
- **Back** — layered dismiss (menus → controls → exit) via web handler before history back
- **Pairing** — robust login token parsing and trimmed password on pair screen

### TV watch player
- **Controls** — scrubber above transport row; Up/Down navigation matches layout; Quality no longer opens on Up
- **Seek** — left/right only skips when scrubber is focused; hidden controls reveal the bar instead of skipping
- **Back** — first press closes open menus or hides controls; exit only when nothing is open
- **Picture** — remove page gradient dimming during native playback

### Server
- **Auth** — login returns session token in JSON for native TV pairing

### Playback
- **Native TV** — prefer direct play again; HLS remux stays as error fallback only

## 0.1.67 — 2026-07-05

### Playback
- **Native TV** — HLS remux for SD/HD MKV/WebM on ExoPlayer to reduce stutter; keep 4K on direct play
- **Quality fallback** — skip redundant original→2160p when already transcoding at 2160p; fix stale stream info on native playback errors
- **Playback start** — stop restarting native session when title metadata loads

### TV
- **Watch player** — any D-pad direction while controls are hidden opens Quality settings; Up no longer hides controls
- **Watch scrubber** — contain seek preview and progress track inside the control bar; solid focus border instead of glow
- **Poster cards** — clip Continue Watching progress bar inside poster bounds

## 0.1.66 — 2026-07-05

### Fix
- **Continue Watching** — fix nested links on poster cards that caused React hydration errors; resume rows link straight to playback
- **Homepage hero** — tighten line spacing between “This is your” and “MEDIA!”

## 0.1.65 — 2026-07-04

### UI
- **Homepage hero** — stacked “This is your MEDIA!” headline with gradient wordmark and simplified subtitle
- **Navbar** — logo-only header with larger mark, inset icon tile, and compact bar height
- **Copy** — replace em dashes with commas and plain punctuation across settings and UI messages

### Tooling
- **Cursor** — project agent rules and `/version` release skill

## 0.1.64 — 2026-07-04

### Fix
- **TV library** — restore missing posters and videos on Android TV (eager image loading, remove CSS `contain` that hid tiles)
- **TV playback** — restore native direct play instead of forcing MKV→HLS remux on every title
- **TV menus** — fix broken subtitle/quality selection borders (solid focus borders instead of inset shadows); remove backdrop blur from menus; lighter focus transitions

## 0.1.63 — 2026-07-04

### Playback
- **Seamless streaming** — MKV/WebM remux with annex-B bitstream filters and cleaner timestamps; HLS waits for two segments before start; transcode uses `veryfast` + `genpts`; pick transcode tier near source resolution; larger read buffers and HLS buffers
- **Android TV native** — remux MKV/WebM to HLS for smoother ExoPlayer playback; explicit MIME types for container formats; native error fallback to remux before transcode

### TV
- **Home screen** — smoother navigation: instant scroll, lighter poster effects, lazy-loaded images, layout containment
- **Title pages** — related movies/series row (genre-matched, same as desktop)
- **Watch player** — scrubber position preserved when changing subtitles or quality; focus returns to controls after closing menus; poster/scrub layout dock fix

### Tooling
- **Playback audit** — `scripts/audit-playback.mjs` classifies library files by direct/remux/transcode compatibility

## 0.1.62 — 2026-07-04

### TV
- **Google TV Tier 2/3** — MediaSession for native playback; voice search (mic / SEARCH key); cast-to-TV from web watch page; baseline profile + AAB bundle; memory trimming under low RAM
- **Watch poster** — show artwork immediately on the player (stream info + URL param + preloaded backdrop) instead of a blank play placeholder

## 0.1.61 — 2026-07-04

### TV
- **4K playback** — restore 4K transcode tier preference; direct-play 4K via ExoPlayer by setting both session cookies on login (legacy TV app compatibility); keep HEVC HLS remux on Android TV instead of unnecessary transcoding

## 0.1.60 — 2026-07-04

### TV
- **Sign out** — clear legacy `reel_session` cookies on logout; reload the TV shell; activate logout with Enter on focused nav buttons

## 0.1.59 — 2026-07-04

### TV
- **Scrollbars** — hide page and row scrollbars in TV mode; lock layout to viewport height
- **4K playback** — use ExoPlayer direct play for HEVC/AC3/DTS (legacy `ReelAndroid` bridge supported); avoid defaulting to 4K server transcode
- **Android TV app** — larger ExoPlayer buffers for high-bitrate streams; accept legacy session cookies

## 0.1.58 — 2026-07-04

### TV
- **Watch player** — pressing Up no longer shows a focus border around the video when hiding controls

## 0.1.57 — 2026-07-04

### UI
- **Playback scrubber** — cleaner progress bar and thumb styling on desktop; TV scrubber gets a proper playhead dot instead of stretching on focus

## 0.1.56 — 2026-07-04

### Fix
- **Update script** — move trap handlers to top level and clear EXIT trap on success so `config_dir` is never unbound after a completed update

## 0.1.55 — 2026-07-04

### Performance
- **Lazy routes** — load watch and settings pages on demand to shrink the initial bundle
- **Build** — enable Radix tree-shaking and Turbopack filesystem cache for faster rebuilds
- **Dependencies** — remove unused framer-motion

## 0.1.54 — 2026-07-04

### TV
- **Continue / Recently Added** — auto-focus the first poster when opening either list
- **Startup** — fix React 19 `flushSync` warning; add fallback so TV bootstrap cannot leave a blank page

### Settings
- **API keys** — consolidate TMDB, fanart.tv, and OpenSubtitles into one section

### Dependencies
- **Next.js 16** — upgrade to Next.js 16.2 with React 19.2; add required `not-found` page for static export

### Fix
- **Update script** — fix cleanup trap referencing an unbound variable after successful updates

## 0.1.53 — 2026-07-04

### Fix
- **Static build** — remove server `headers()` from root layout so static export builds succeed again

## 0.1.52 — 2026-07-04

### Fix
- **In-app update lock** — use the same config directory for the update lock file as logs and progress, fixing ENOENT on legacy `~/.config/reel` installs

## 0.1.51 — 2026-07-04

### TV
- **Startup flash** — bootstrap TV mode before first paint so the desktop web shell no longer flashes on launch

## 0.1.50 — 2026-07-04

### TV
- **Poster focus** — cleaner selection ring on browse rows; removed play overlay on focus
- **Show page** — auto-focus the next episode (continue watching, up next, or S1E1) when opening a series

### UI
- **Favicon** — updated to the M! logo to match the app icon

## 0.1.49 — 2026-07-04

### Fix
- **Update status crash** — wrap TV and desktop layouts in `UpdateStatusProvider` so settings and other pages no longer throw when not in desktop mode

## 0.1.48 — 2026-07-04

### Performance
- **Client API cache** — stale-while-revalidate caching for home, libraries, media, and browse routes so back-navigation feels instant
- **TV spatial nav** — index-based grid focus and instant scroll on key repeat for snappier D-pad browsing
- **Dynamic hls.js** — load the HLS library only when transcoding playback is needed
- **Scan polling** — stop refetching the full home payload every 1.5s during library scans
- **TV mode init** — detect Android TV on first paint to avoid desktop shell flash
- **Poster cards** — replace framer-motion with CSS transitions and memoization
- **Server batch queries** — TV show detail, library counts, and related media use fewer DB round-trips
- **DB indexes** — add indexes on hot lookup columns (library_id, season_id, watch_progress, etc.)
- **Static assets** — long-cache headers for hashed Next.js bundles
- **FFmpeg probe cache** — avoid spawning ffmpeg/ffprobe on every status poll

### Search
- **Fast typing fix** — ignore stale search responses so "No results found" no longer flashes while typing

## 0.1.47 — 2026-07-04

### Playback
- **4K quality option** — add a 4K transcode tier for 2160p sources so 4K movies and shows always offer full-resolution playback when transcoding is enabled

## 0.1.46 — 2026-07-04

### Branding
- **Renamed to MEDIA!** — app title, Android TV launcher, install/update scripts, and in-app copy now use MEDIA! branding
- **Package scope** — npm workspace packages moved from `@reel/*` to `@media-app/*` (GitHub repo URL unchanged)
- **Session cookie** — new installs use `media_session`; existing `reel_session` cookies still work

## 0.1.45 — 2026-07-04

### Playback
- **Poster on load** — show episode still or poster art on the `<video>` element while the stream starts
- **Background tabs** — pause playback and stop server transcodes when the tab is hidden
- **HLS segment window** — cap live transcode playlists at 120 segments and prune old `.ts` files from disk
- **hls.js retries** — retry manifest, level, and fragment loads before falling back to a lower quality
- **Throttled timeline** — cap `timeupdate` UI refreshes at 4 Hz to reduce main-thread work during playback
- **Network-aware quality** — pick 480p/720p on slow or metered connections when auto-transcoding
- **Seek previews** — generate thumbnail sprites server-side and show scrub-bar preview frames
- **Next-episode prefetch** — warm the next episode's HLS manifest during the autoplay countdown
- **Media Session** — lock-screen play/pause/seek controls on mobile browsers
- **Shared playback engine** — unify HLS/direct-play setup between desktop and TV web players

### Android TV
- **ExoPlayer buffers** — tune LoadControl (15–60s forward, 30s back) to match web TV hls.js settings

### UI
- **Lazy posters** — defer loading browse/search poster images until they scroll into view

### Dev
- **Actions-free releases** — drop the tag-triggered GitHub Actions workflow; publish releases locally with `pnpm release` (`gh` + CHANGELOG.md)
- **Updater tag detection** — check latest version via `git ls-remote` tags and CHANGELOG.md instead of relying on the GitHub Releases API

## 0.1.44 — 2026-07-04

### TV
- **Next episode autoplay** — countdown overlay when a TV episode ends, with play-now and cancel options
- **Continue Watching** — show the next episode in a series after the previous one is finished
- **Show page** — open on the last active season instead of always defaulting to season 1
- **Focus styling** — compact focus rings on buttons and chips so focused controls no longer overlap on Android TV

## 0.1.43 — 2026-07-04

### Android TV
- **Native video player** — ExoPlayer (Media3) decodes behind the Reel TV UI; keeps timeline, skip, quality, and subtitle controls
- **Session auth** — pass login cookies on all HLS/direct stream requests from the native player
- **Original quality** — play source resolution on TV (direct or remux); no 1080p cap when using native playback
- **Controls** — overlay fades out 3s after playback starts; Down on the remote brings it back

### Playback
- **HLS auth** — send session cookies on hls.js segment requests; auto-fallback to lower quality on fatal errors
- **Live transcode** — faster FFmpeg preset (ultrafast/zerolatency) for smoother HLS on the server

### TV
- **Episode list scroll** — keep focused row in view on long seasons
- **Logout** — move sign-out directly under Search in the side rail

## 0.1.42 — 2026-07-04

### Playback
- **MPEG-4 support** — detect non-browser video codecs (e.g. mpeg4 + aac) and route to HLS transcode instead of failed direct play
- **Sub-SD transcode** — allow 480p transcode for sources under 480p tall; remove server quality gate that returned HTTP 400
- **Auto quality** — player picks the correct transcode tier on open for incompatible originals

### TV
- **Focus visibility** — stronger glow rings, clearer selected vs focused states for nav, chips, cards, and player controls
- **Poster focus** — fix focus borders clipped at the top of scroll rows

## 0.1.41 — 2026-07-03

### TV
- **Living room UI** — Plex-style spatial navigation, focus styling, side rail, and smooth horizontal row scrolling
- **Watch player** — TV remote controls, skip buttons, buffered progress, subtitles/quality menus, and larger subtitle cues
- **Page access** — See-all tiles and browse shortcuts to Continue Watching, Recently Added, Favorites, libraries, and decks
- **Android TV** — QR pairing setup flow and session bridge for the TV WebView app

### Import
- **Plex watch history** — Detect local Plex library database and import resume points and watched state into Reel (Settings → Import from Plex)

## 0.1.40 — 2026-07-03

### Subtitles
- **OpenSubtitles search** — results sorted by download count (highest first)
- **OpenSubtitles downloads** — validate file content before saving; write cache file and verify on disk before inserting DB rows; keep downloads when list filtering runs
- **Playback** — load subtitle tracks via authenticated fetch (fixes dev cross-origin and auth); re-attach after stream reloads; preserve newly downloaded tracks when refreshing the menu

### Dev
- **`dev.sh`** — set `NEXT_PUBLIC_API_URL` so the web dev server talks to the API on `:8096`

## 0.1.39 — 2026-07-03

### Stability
- **Transcode cache cleanup** — removing HLS cache directories no longer crashes the server on `ENOTEMPTY`; kills orphan FFmpeg, retries removal, and isolates cleanup timer failures

## 0.1.38 — 2026-07-03

### UI
- **Subtitle menu** — show "None available" when a title has no subtitle tracks instead of "Off"

## 0.1.37 — 2026-07-03

### Subtitles
- **Appearance settings** — Netflix-style subtitle styling (size, font, color, opacity, background, edge style) with live preview in Settings
- **Empty track filtering** — external, embedded, and downloaded subtitles are validated for dialogue before listing or serving

### Theme music
- **Playback reliability** — resume AudioContext before play, blob cache, multi-ready events, gesture retry, and synchronous mute preference hydration

## 0.1.36 — 2026-07-03

### Theme music
- **Global mute** — speaker icon on detail pages stops the current theme and disables autoplay on all future detail pages until unmuted
- **Waveform layering** — banner waveform renders behind poster, title, and buttons

## 0.1.35 — 2026-07-03

### Theme music
- **Movie themes** — fetches theme songs from ThemerrDB (e.g. Star Wars) via yt-dlp; TV shows fall back to ThemerrDB when fanart.tv has no theme
- **Compressed cache** — downloaded themes re-encoded to 96 kbps MP3 to save disk space
- **Banner waveform** — transparent live audio visualization in the detail page hero while theme music plays
- **Autoplay** — muted-start playback and site-wide audio unlock so themes start without an extra click after navigating from the library

### Fixes
- **Shared build** — removed `node:path` from TV parser so web builds succeed on VPS

## 0.1.34 — 2026-07-03

### Settings
- **Fanart.tv API key** — configure theme music in Settings; saving the key syncs TV show themes across libraries

## 0.1.33 — 2026-07-03

### Features
- **Theme music** — Plex-style show/movie themes on detail pages with fade in/out; local `theme.mp3` in the media folder, or automatic fetch from fanart.tv when `fanart_api_key` is set in config

## 0.1.32 — 2026-07-03

### Playback
- **Scrubber buffer** — timeline shows loaded buffer ranges behind the playhead
- **Silent audio conversion** — removed the AC3/transcode info banner during playback

### UI
- **Player menus** — subtitle, quality, and volume dropdowns stack above the scrubber
- **Live upgrade status** — update progress polls every 2s without a page refresh

## 0.1.31 — 2026-07-03

### UI
- **View all links** — Continue Watching, Recently Added, and Library Decks rows on home now link to full browse pages (web and TV), matching Favorites

## 0.1.30 — 2026-07-03

### Updates
- **Upgrade banner fix** — progress phase and elapsed time update correctly during in-app updates; live timer, reliable log parsing, and stable start-time tracking

## 0.1.29 — 2026-07-03

### UI
- **Resume labels** — media detail Play button shows “Resume at 12:34” when watch progress exists; TV episode rows show the same
- **Continue button** — homepage hero button shows the movie or series title (e.g. “Continue Breaking Bad”)

## 0.1.28 — 2026-07-03

### Playback
- **Universal audio compatibility** — any non-AAC/MP3 audio (TrueHD, DTS, AC3, FLAC, PCM, etc.) is automatically converted to AAC on Original quality via remux or transcode
- **HEVC remux** — H.264/HEVC video stays at source quality while audio is converted; falls back to transcoded H.264 on browsers without HEVC support
- **Resume fix** — resuming playback no longer flashes 0:00; player seeks to the saved position before starting
- Smarter audio track selection (default track, skips commentary) and standardized AAC output at 48 kHz

## 0.1.27 — 2026-07-03

### Playback
- **Timeline hover preview** — show a timestamp tooltip when hovering or scrubbing the progress bar
- **Optimistic scrubbing** — progress bar and clock jump to the target immediately on seek; UI holds position until playback catches up

## 0.1.26 — 2026-07-03

### Features
- **Favorites** — star movies and TV shows from the detail page; browse them from a new Favorites nav item with Movies / TV filters
- Favorites row on home and quick-access card in Library Decks

### Playback
- **Original quality by default** — playback no longer auto-switches to transcoded quality for unsupported audio codecs
- **Faster direct play** — skip redundant ffprobe when scan metadata is available; larger read buffers; seek-on-release scrubbing; `preload="auto"`; earlier resume positioning
- Store TV episode codec/dimensions at scan time and backfill on rescan

### Updates
- **Upgrade progress fix** — in-app update banner no longer shows all steps complete immediately; log phase inference uses the current update session only

## 0.1.25 — 2026-07-03

### Playback
- **Seek fix** — scrubbing and skip-ahead to unbuffered positions now correctly restart HLS transcoding using the video seekable range (not buffered bytes)
- Remove the AC3 / transcoded-audio banner during playback; auto-fallback to transcoded audio still applies silently

## 0.1.24 — 2026-07-03

### Server
- **Transcode resource limits** — cap concurrent FFmpeg jobs at 2, stop stale sessions for the same file, and kill orphan transcoders on startup
- Idle transcode sessions expire after 2 minutes; stale cache dirs are pruned automatically
- Add `scripts/cleanup-cache.sh` for manual transcode/build cache cleanup

### Scripts
- Add `scripts/symlink-media-duplicates.py` to replace duplicate library files with symlinks to torrent copies

## 0.1.23 — 2026-07-03

### TV
- **`/tv` web UI** — remote-friendly browse and playback for TV browsers (Android TV, Fire TV, etc.)
- D-pad navigation, larger posters, simplified player with seek/play shortcuts
- Home, library, media detail, search, and watch routes under `/tv/`

## 0.1.22 — 2026-07-03

### UI
- **App icon** — navbar and login screen use the same film-reel icon as the favicon

## 0.1.21 — 2026-07-03

### Docs
- README trimmed to install and setup essentials

### Privacy
- All pages set to **noindex, nofollow**; `robots.txt` disallows crawlers

## 0.1.20 — 2026-07-03

### UI
- **Favicon** — Reel film-reel icon in the browser tab
- **Dynamic page titles** — tab title updates per page (e.g. movie/show name while watching, library name when browsing)

## 0.1.19 — 2026-07-03

### Playback
- **Seek anywhere while transcoding** — jump to any point in the video, not just the buffered range; in-buffer seeks are instant, far seeks restart transcoding at the new position
- Skip back 10s / forward 30s buttons and arrow-key shortcuts on the watch page

### Chromecast
- **Cast fix** — signed cast tokens let the TV fetch streams without browser cookies (fixes casting when Reel has a password)
- HLS cast uses the correct transcode session and resume position; segment URLs carry auth tokens
- Prefer Mac Wi‑Fi (`en0`) for cast URLs; clearer error messages when cast fails

### In-app updates
- Release notes render as markdown (headings, lists, bold) instead of raw text

## 0.1.18 — 2026-07-03

### Playback
- **Seek during transcoding** — scrubbing and skip-ahead now restart HLS at the correct position instead of staying at the start
- Scrub bar previews the target time while dragging; seek commits on release so transcoding is not restarted on every pixel

## 0.1.17 — 2026-07-03

### Playback
- **Loading & buffering feedback** — spinner while preparing, loading, or re-buffering; buffer range shown on the scrub bar
- **Audio fix** — auto-switch to transcoded playback when the browser cannot decode the file's audio (AC3, DTS, etc.)
- FFmpeg HLS transcoding now explicitly maps the first audio track
- Volume no longer stuck at zero from a saved slider value

## 0.1.16 — 2026-07-03

### UI
- **Media pages** — related films or series from your library below the title (matched by genre)
- **Watch page** — Details button moved to the far right of the title bar
- **Home** — removed the large Settings button from the hero (Settings stays in the navbar)

### In-app updates
- Update progress steps now advance live during upgrades (dedicated progress polling + smarter phase detection)

## 0.1.15 — 2026-07-03

### Playback
- Watch progress saves every **10 seconds** while playing
- Also saves on **pause** and when leaving the page
- More reliable saves when duration comes from stream info (HLS/transcoding)

### In-app updates
- Update script resets local changes before checking out a release tag on the server

## 0.1.14 — 2026-07-03

### UI
- **Continue** on the home hero picks up your last watched movie or episode (replaces "Play recent")
- Recently added panel uses **Open** to browse titles instead of starting playback

### Playback
- Watch page **resumes saved progress** automatically when you return to something in progress

### In-app updates
- Update checks use **git tags** instead of the GitHub API — avoids rate limits on shared hosts
- Release notes load from `CHANGELOG.md` (no API needed)
- Update script **stops the running process** before restart so new builds actually go live

## 0.1.13 — 2026-07-03

### UI
- **Settings nav** — Settings icon highlights correctly on the settings page (trailing-slash paths)
- **Condensed settings** — tighter layout, shared section component, shorter copy, compact system status rows

## 0.1.12 — 2026-07-03

### In-app updates
- **Live update progress** — step checklist (prepare, download, build, restart), status message, elapsed time, and recent log output while upgrading
- Update modal opens automatically and stays visible until the server restarts
- Navbar update chip shows the current step instead of a generic "Updating" label

### UI
- Removed confusing **"Local signal"**, **"Signal online"**, and **"Control room"** copy — plain "Reel" branding and Settings labels throughout

## 0.1.11 — 2026-07-03

### UI
- **Home hero** — "Play recent" starts playback directly; poster art in the featured panel; fewer layout flashes on refresh
- **Plain language** — removed "signal online", "local signal", and other jargon from Home and Settings
- **Search** — navbar bar is the only input; results drop down below as you type
- **Watch page** — new **Details** button shows file name, path, size, codecs, resolution, and playback mode
- Symlinked files show a note and resolved target path in Details

### API
- `/api/home` includes `tmdbConfigured`, library counts, and `recentPlay` watch target
- `/api/stream/:id/info` includes file path, codecs, bitrate, and symlink metadata

## 0.1.10 — 2026-07-03

### UI
- **Layout shift fixes** on Home and Settings — stable skeletons and reserved space while data loads
- **Static page shells** prerender at build time; dynamic content hydrates in client islands (PPR-like with static export)
- **Scroll arrows** on horizontal poster rows (Continue Watching, Recently Added) when content overflows
- Settings background polling no longer flashes the loading state every few seconds
- Navbar reserves space for the update button so it appearing does not shift nav items

## 0.1.9 — 2026-07-03

### UI
- **Header redesign** — centered search bar on desktop, segmented Home/Settings nav, compact update chip
- **Search** opens with **⌘K / Ctrl+K**; full-width search row on mobile
- **Update button** restyled to match the new header

## 0.1.8 — 2026-07-03

### UI
- **Search button sizing** matches Home and Settings in the navbar

## 0.1.7 — 2026-07-03

### In-app updates
- **Automatic update checks** on app load and when opening Settings — no need to press Check for updates

## 0.1.6 — 2026-07-03

### UI
- **Navbar order** — Home, Search, Settings, then Update available on the far right

## 0.1.5 — 2026-07-03

### Video player
- **TV episode titles** in the top bar now show the series name, episode name, and season/episode number (e.g. `Show — Pilot (Season 1 Episode 1)`)

## 0.1.4 — 2026-07-03

### In-app updates
- **Fixed Update now failing silently** when git remote used SSH — updates now force HTTPS, fall back to clone+rsync, and pass `pnpm` PATH to the update subprocess
- **Update available** button in the navbar opens a modal to start upgrades from anywhere in the app

### Search
- **Inline search popover** in the header replaces the separate search page — results appear as you type

## 0.1.3 — 2026-07-03

### Video player
- **Volume control** in the player — mute/unmute button with a slider (hover on desktop, popover on mobile)
- Volume level persists across sessions

## 0.1.2 — 2026-07-03

### Library scanning
- **Adding a library no longer hangs** — scans run in the background; the API returns immediately
- **Manual scan** returns right away while progress shows in the UI
- **File watcher hardening** — ignores source code, dev folders, and non-media files so large non-media trees (e.g. Go source) won't exhaust inotify watchers or crash the server
- **Scan walks skip** `node_modules`, `.git`, `go1`, and other common dev directories

## 0.1.1 — 2026-07-03

### In-app updates
- **Settings → Updates** checks GitHub Releases and shows an **Update now** button with a link to release notes
- Fixed install detection on nested deploy paths (e.g. shared hosting under `~/apps/reel`)
- Update script supports release tags, user-space restart (`~/.startup/reel`), and non-interactive apply

### Transcoding & quality
- **480p / 720p / 1080p** quality picker in the player (Original plays the file directly)
- Fixed transcoding on FFmpeg 4.x by generating HLS playlists server-side from segments
- Fixed quality switching jumping to random timestamps — transcode now resumes from your current position

### Subtitles
- Search and download subtitles from **OpenSubtitles.com** while watching
- Switch between local, embedded, and downloaded tracks from the CC menu
- OpenSubtitles API key configuration in Settings

### Library decks
- Custom browse collections built from hand-picked folders
- Folder picker can browse **any readable path on the server**, not just library subfolders

### Other
- Password protection for the web UI
- Real-time library scan progress in the UI
- TV show duplicate fix (match by TMDB ID during scans)

## 0.1.0 — 2026-07-03

Initial release: self-hosted media server with library scanning, TMDB metadata, direct play, HLS transcoding, Chromecast, and the web UI.

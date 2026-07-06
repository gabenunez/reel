# Changelog

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

# Changelog

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

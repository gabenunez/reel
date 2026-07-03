# Changelog

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

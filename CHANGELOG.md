# Changelog

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

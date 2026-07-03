# Reel — Self-Hosted Media Server

A beautiful, self-hosted Plex alternative for streaming your personal movie and TV libraries.

## Features

- **Library scanning** — Automatically indexes movies and TV shows from configured folders
- **Rich metadata** — Posters, backdrops, descriptions, and cast via TMDB
- **Smart parsing** — Detects `S01E02`, season folders, and movie filenames
- **Streaming** — Direct play with byte-range requests or HLS transcoding via FFmpeg
- **Subtitles** — External `.srt`/`.vtt` files and embedded track extraction
- **Beautiful UI** — Dark cinematic web interface with continue watching, search, and more
- **Native deployment** — Single Node process, SQLite database, simple config file

## Prerequisites

- **Node.js** 20+ and **pnpm**
- **FFmpeg** (includes ffprobe)

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

- **TMDB API key** (free): https://www.themoviedb.org/settings/api

## Configuration

Everything is managed in the web UI at **Settings** (`/settings`):

- Add, edit, and remove media library folders with a built-in folder browser
- Set your TMDB API key for posters and metadata
- Trigger library scans

On first launch, Reel auto-creates a `config.yaml` if needed. You shouldn't need to edit it manually.

## Quick Start

```bash
pnpm install
pnpm build
pnpm start
open http://localhost:8096/settings
```

1. Add your movie/TV folders in Settings
2. Paste your TMDB API key (optional but recommended)
3. Wait for the scan to finish, then browse your library

## Prerequisites

```bash
chmod +x scripts/dev.sh
./scripts/dev.sh
```

Or manually:

```bash
pnpm install
pnpm dev
```

## Auto-Start

### macOS (launchd)

```bash
# Edit deploy/com.reel.server.plist — set WorkingDirectory
cp deploy/com.reel.server.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.reel.server.plist
```

### Linux (systemd)

```bash
# Edit deploy/reel.service — set WorkingDirectory and User
sudo cp deploy/reel.service /etc/systemd/system/
sudo systemctl enable reel
sudo systemctl start reel
```

## Project Structure

```
plex/
├── config.example.yaml     # Configuration template
├── packages/
│   ├── shared/             # Shared types and filename parsers
│   ├── server/             # Fastify API, scanner, streaming
│   └── web/                # Next.js static web UI
├── scripts/                # Install and dev scripts
└── deploy/                 # launchd and systemd units
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Server health and scan progress |
| `GET /api/libraries` | List libraries |
| `GET /api/libraries/:id/items` | Paginated media grid |
| `GET /api/media/:id` | Media detail with episodes |
| `GET /api/search?q=` | Search library |
| `GET /api/stream/:fileId` | Direct video stream |
| `GET /api/stream/:fileId/hls/master.m3u8` | HLS transcoded stream |
| `GET /api/subtitles/:id` | Subtitle track (WebVTT) |
| `POST /api/libraries/:id/scan` | Trigger library rescan |

## Supported Video Formats

Reel indexes files by extension **and** falls back to FFprobe for unknown types (≥512 KB).

**Containers:** MKV, MP4, M4V, MOV, AVI, WebM, WMV, FLV, F4V, TS, M2TS, MTS, MPG, MPEG, DIVX, XVID, 3GP, OGV, VOB, ASF, RM, RMVB, MXF, ISO, and more.

**Playback:** Direct play for browser-friendly formats; use **Transcode** in the player for everything else (FFmpeg → H.264/AAC HLS).

**Subtitles:** SRT, VTT, ASS, SSA, SUB, IDX, SMI (external sidecars + embedded tracks).

## TV Show Folder Structure

Reel expects standard naming conventions:

```
TV Shows/
  Breaking Bad/
    Season 01/
      Breaking Bad S01E01.mkv
      Breaking Bad S01E02.mkv
```

Supported episode patterns: `S01E02`, `1x02`, `Season 1 Episode 2`

## License

MIT

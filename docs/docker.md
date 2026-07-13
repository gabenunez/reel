# Running MEDIA! with Docker

The Docker image bundles the API server, the web UI, and `ffmpeg` in one
container. Configuration and state live in mounted volumes, so upgrades are a
simple image pull — nothing is lost.

- **Config + state** persist in the `/config` and `/data` volumes.
- **Your media** is mounted read-only.
- **Updates** are `docker compose pull && docker compose up -d`.

---

## Quick start (Docker Compose — recommended)

1. Create a folder and add a `docker-compose.yml`:

   ```yaml
   services:
     media:
       image: ghcr.io/gabenunez/media-app:latest
       container_name: media
       restart: unless-stopped
       ports:
         - "8096:8096"
       environment:
         TMDB_API_KEY: ""          # optional; can also be set in the web UI
         OPENSUBTITLES_API_KEY: "" # optional
       volumes:
         - ./config:/config
         - ./data:/data
         - /path/to/movies:/media/movies:ro
         - /path/to/tv:/media/tv:ro
       healthcheck:
         test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8096/api/health"]
         interval: 30s
         timeout: 5s
         retries: 3
         start_period: 40s
   ```

2. Edit the two `/path/to/...` host paths to point at your real media folders.

3. Start it:

   ```bash
   docker compose up -d
   ```

4. Open **http://localhost:8096**, go to **Settings → Libraries**, and add your
   libraries using the **container paths** (e.g. `/media/movies`, `/media/tv`).

That's it. A free [TMDB API key](https://www.themoviedb.org/settings/api) is
recommended for posters and metadata; set it in Settings or via `TMDB_API_KEY`.

---

## Quick start (plain `docker run`)

```bash
docker run -d --name media \
  -p 8096:8096 \
  -v "$PWD/config:/config" \
  -v "$PWD/data:/data" \
  -v /path/to/movies:/media/movies:ro \
  -v /path/to/tv:/media/tv:ro \
  --restart unless-stopped \
  ghcr.io/gabenunez/media-app:latest
```

---

## Updating

```bash
docker compose pull
docker compose up -d
```

Your config, database, watch history, and artwork are in the `/config` and
`/data` volumes, so they carry over untouched. The in-app updater is disabled
inside containers and points you to this command instead.

Pin a specific version instead of `latest` for reproducible deploys:

```yaml
image: ghcr.io/gabenunez/media-app:v0.1.161
```

---

## Volumes

| Container path | Purpose | Notes |
|----------------|---------|-------|
| `/config` | `config.yaml` | Seeded on first run; edit here or in the web UI. |
| `/data` | Database, artwork cache, transcode cache, auth secret | Keep this to preserve your library + history. |
| `/media/...` | Your movies/TV | Mount **read-only** (`:ro`). Paths you enter in Settings must match these. |

> **Library paths are container paths.** If you mount
> `/mnt/nas/movies:/media/movies:ro`, add the library as `/media/movies`
> in Settings — not the host path.

---

## Configuration

Most settings are editable in the web UI (**/settings**). The container also
reads these optional environment variables on **first run** (when it seeds
`config.yaml`):

| Variable | Default | Description |
|----------|---------|-------------|
| `TMDB_API_KEY` | _(empty)_ | Metadata + posters. Free from themoviedb.org. |
| `OPENSUBTITLES_API_KEY` | _(empty)_ | Online subtitle search. |
| `MEDIA_LANGUAGE` | `en-US` | Metadata language. |
| `MEDIA_PORT` | `8096` | Internal listen port. |

To change config later, edit `./config/config.yaml` and restart the container,
or use the Settings page.

---

## Reverse proxy / subpath

To serve under a subpath (e.g. `https://example.com/media`), set
`public_prefix` in `config/config.yaml`:

```yaml
server:
  public_prefix: /media
```

See [`docs/reverse-proxy.md`](./reverse-proxy.md) for Apache/nginx examples.

---

## Building the image yourself

```bash
docker build -t media-app:local .
docker run -d --name media -p 8096:8096 \
  -v "$PWD/config:/config" -v "$PWD/data:/data" \
  media-app:local
```

Or with compose — uncomment `build: .` (and comment out `image:`) in
`docker-compose.yml`.

---

## Health & troubleshooting

- **Health:** `docker inspect --format '{{.State.Health.Status}}' media`
- **Logs:** `docker compose logs -f media`
- **API check:** `curl http://localhost:8096/api/health`
- **No posters?** Set a TMDB API key in Settings, then rescan.
- **Library empty?** Confirm the library path matches the **container** mount
  path, and that the media volume is readable.
- **Transcoding fails?** `ffmpeg` is included; check logs for the failing
  command. HDR/4K transcodes are CPU-heavy — expect load on large files.

---

## Notes

- The container runs the API and the Next.js web server together, supervised so
  a crash of either restarts the pair. `tini` reaps `ffmpeg`/node child
  processes cleanly, and `SIGTERM` shuts everything down gracefully.
- Multi-arch images are published for `linux/amd64` and `linux/arm64`.

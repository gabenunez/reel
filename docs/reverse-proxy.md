# Reverse proxy (Apache / nginx)

MEDIA! can be served under a public path prefix (for example `/reel`) when your reverse proxy forwards **all** paths under that prefix to the app.

Set the prefix in **Settings → Reverse proxy**, or in `config.yaml`:

```yaml
server:
  public_prefix: /reel
```

Saving from Settings rebuilds (when the prefix changes) and restarts MEDIA! so Next.js `basePath` matches.

## Apache example

```apache
# HTTPS vhost — proxy /reel and everything under it to MEDIA! on port 8096
ProxyPreserveHost On
ProxyPass        /reel http://127.0.0.1:8096/reel
ProxyPassReverse /reel http://127.0.0.1:8096/reel
```

Or strip the prefix at the proxy and set Next.js `basePath` at build time (not currently used — prefer preserving `/reel` as above).

**Do not** only proxy the exact URL `/reel`. These must also reach the app:

- `/reel/_next/...` — JS, CSS, fonts
- `/reel/api/...` — API, images, streams
- `/reel/media/...`, `/reel/watch/...` — navigation

If `/reel/media/...` redirects to `/media/...` or returns 404, the proxy is misconfigured.

## Verify

After the host updates config:

```bash
curl -sI 'https://your-host/reel/_next/static/chunks/' | head -5
curl -s  'https://your-host/reel/api/health'
```

Both should return 200 (or 308 within `/reel`), not 404 at the site root.

## Direct access

`http://your-server:8096/` continues to work without any proxy or `basePath`.

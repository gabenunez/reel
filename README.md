# MEDIA!

Self-hosted movies and TV. One Node app, SQLite, FFmpeg for transcoding.

**[github.com/gabenunez/media-app](https://github.com/gabenunez/media-app)**

## Install

**Linux VPS**

```bash
curl -fsSL https://raw.githubusercontent.com/gabenunez/media-app/main/install.sh | bash
```

Open `http://YOUR_SERVER:8096/settings` and add library folders.

**From source**

```bash
git clone https://github.com/gabenunez/media-app.git && cd media-app
pnpm install && pnpm build && pnpm start
```

Dev with hot reload: `./scripts/dev.sh`

**Update:** Settings → Updates in the app, or `./update.sh`

## Setup

1. Add movie/TV folders in **Settings**
2. Add a [TMDB API key](https://www.themoviedb.org/settings/api) (posters & metadata)
3. Scan libraries, then browse

Optional: FFmpeg for transcoding and Chromecast; OpenSubtitles API key in Settings for online subtitles.

## Android TV app

The Android TV client is a thin shell that connects to your MEDIA! server over the LAN and loads the web UI in TV mode.

**Requirements:** JDK 17+, Android SDK (Android Studio recommended).

```bash
pnpm android:build
```

APK output: `packages/android-tv/app/build/outputs/apk/debug/app-debug.apk`

**Sideload on Android TV**

1. Enable developer options and USB/network debugging on the TV (or use `adb connect TV_IP`).
2. Install: `adb install packages/android-tv/app/build/outputs/apk/debug/app-debug.apk`
3. Open **MEDIA!** from the Android TV launcher.
4. Enter your server address (e.g. `192.168.1.50` port `8096`).

The app validates the connection via `/api/status`, then opens your server at `/?tv=1` with D-pad-friendly navigation. Press **Menu** on the remote to change servers.

## License

MIT

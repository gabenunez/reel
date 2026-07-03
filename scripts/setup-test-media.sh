#!/usr/bin/env bash
set -euo pipefail

MOVIES="${REEL_TEST_MOVIES:-/tmp/reel-movies}"
TV="${REEL_TEST_TV:-/tmp/reel-tv}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install with: brew install ffmpeg"
  exit 1
fi

mkdir -p "$MOVIES" "$TV/Breaking Bad/Season 01" "$TV/The Office/Season 01"

echo "Generating test movies in $MOVIES..."

ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=duration=20:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440:duration=20" \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast -c:a aac -b:a 128k -shortest \
  "$MOVIES/Big Buck Bunny (2008).mp4"

ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=duration=20:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=660:duration=20" \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast -c:a aac -b:a 128k -shortest \
  "$MOVIES/Sintel (2010).mkv"

ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=blue:s=1280x720:d=15" \
  -f lavfi -i "sine=frequency=330:duration=15" \
  -c:v mpeg4 -q:v 5 -c:a mp3 -b:a 128k -shortest \
  "$MOVIES/The Matrix (1999).avi"

echo "Generating test TV episodes in $TV..."

ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=duration=15:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=520:duration=15" \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast -c:a aac -shortest \
  "$TV/Breaking Bad/Season 01/Breaking Bad S01E01.mp4"

ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=duration=15:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=780:duration=15" \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast -c:a aac -shortest \
  "$TV/Breaking Bad/Season 01/Breaking Bad S01E02.mkv"

ffmpeg -y -loglevel error \
  -f lavfi -i "smptebars=duration=15:size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=620:duration=15" \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast -c:a aac -shortest \
  "$TV/The Office/Season 01/The Office S01E01.mp4"

cat > "$MOVIES/Big Buck Bunny (2008).en.srt" << 'EOF'
1
00:00:01,000 --> 00:00:06,000
Reel test subtitle — direct play check

2
00:00:07,000 --> 00:00:12,000
Chromecast subtitle test line
EOF

cat > "$MOVIES/Sintel (2010).en.srt" << 'EOF'
1
00:00:01,000 --> 00:00:08,000
MKV transcode test with subtitles
EOF

cat > "$TV/Breaking Bad/Season 01/Breaking Bad S01E01.en.srt" << 'EOF'
1
00:00:01,000 --> 00:00:08,000
Breaking Bad S01E01 — test episode
EOF

echo ""
echo "Test media ready:"
find "$MOVIES" "$TV" -type f | sort
echo ""
echo "Trigger a scan from Settings, or run:"
echo "  curl -X POST http://localhost:8096/api/libraries/1/scan"
echo "  curl -X POST http://localhost:8096/api/libraries/2/scan"

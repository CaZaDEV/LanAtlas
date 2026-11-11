#!/usr/bin/env sh
# LanAtlas: engegada ràpida a Linux i macOS. Instal·la i compila si cal, engega el servidor i obre el navegador.
set -e
cd "$(dirname "$0")"

PORT=$(grep -E '^\s*PORT\s*=' .env 2>/dev/null | tail -1 | sed 's/.*=\s*//') || true
PORT=${PORT:-8080}
URL="http://127.0.0.1:${PORT}/"
export DATA_DIR="${DATA_DIR:-$(pwd)/data}"

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$URL"
  else echo "Obre $URL al navegador"; fi
}

if curl -fs "${URL}api/equipment/state" >/dev/null 2>&1; then open_browser; exit 0; fi

command -v node >/dev/null 2>&1 || { echo "Cal Node.js 20.12 o més nou: https://nodejs.org"; exit 1; }

REV=$(git rev-parse HEAD 2>/dev/null || stat -c %Y package-lock.json 2>/dev/null || echo build)
STAMP=node_modules/.lanatlas-build
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$REV" ] || [ ! -f server/dist/main.js ] || [ ! -f web/dist/index.html ]; then
  echo "LanAtlas: preparant-ho (el primer cop triga uns minuts)..."
  npm install --no-audit --no-fund
  npm run build
  echo "$REV" > "$STAMP"
fi

(sleep 4 && open_browser) &
cd server
exec node dist/main.js

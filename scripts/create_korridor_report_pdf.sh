#!/usr/bin/env bash
# Erzeugt den Korridor-Report als PDF.
# Nutzung: ./scripts/create_korridor_report_pdf.sh [report-id] [output.pdf]
# Voraussetzung: Report-Konfiguration unter client/public/data/reports/<id>.json
set -euo pipefail

REPORT_ID="${1:-demo}"
OUT="${2:-output/korridor-report-${REPORT_ID}.pdf}"
PORT=4179

cd "$(dirname "$0")/.."
mkdir -p "$(dirname "$OUT")"

npm run build >/dev/null

npx vite preview --host 127.0.0.1 --port $PORT >/dev/null 2>&1 &
PREVIEW_PID=$!
trap 'kill $PREVIEW_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done

npx playwright pdf \
  --paper-format A4 \
  --wait-for-timeout 4000 \
  "http://127.0.0.1:$PORT/korridor-report?id=$REPORT_ID" \
  "$OUT"

echo "PDF: $OUT"

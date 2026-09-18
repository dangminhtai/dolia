#!/data/data/com.termux/files/usr/bin/bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null 2>&1 || true
fi

if [[ ! -f ".env" ]]; then
  echo "[Dolia] Thiếu .env. Tạo bằng: cp .env.example .env"
  exit 1
fi

STOP_REQUESTED=0
trap 'STOP_REQUESTED=1' INT TERM

while [[ "$STOP_REQUESTED" -eq 0 ]]; do
  node index.js
  EXIT_CODE=$?

  if [[ "$STOP_REQUESTED" -ne 0 || "$EXIT_CODE" -eq 0 || "$EXIT_CODE" -eq 130 || "$EXIT_CODE" -eq 143 ]]; then
    exit "$EXIT_CODE"
  fi

  echo "[Dolia] Tiến trình dừng với mã $EXIT_CODE; khởi động lại sau 3 giây..."
  sleep 3
done

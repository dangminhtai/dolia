#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

if [[ "${PREFIX:-}" != *"com.termux"* ]]; then
  echo "[Dolia] Script này dành cho Termux trên Android."
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[Dolia] Đồng bộ toàn bộ package Termux..."
pkg update -y
# Termux là rolling release, tránh partial upgrade gây lệch libicu/node.
pkg upgrade -y

echo "[Dolia] Cài môi trường chạy Dolia..."
pkg install -y nodejs-lts npm git tmux python clang make pkg-config fontconfig ttf-dejavu

echo "[Dolia] Kiểm tra Node/npm..."
node -v
npm -v

# Các bản npm cũ từng để foreground-scripts=true; xóa cấu hình dư nếu có.
npm config delete foreground-scripts >/dev/null 2>&1 || true

echo "[Dolia] Cài dependency Node..."
npm ci --no-audit --no-fund

echo "[Dolia] Kiểm tra tương thích Termux..."
npm run check:termux

echo
echo "[Dolia] Hoàn tất."
echo "1) cp .env.example .env && nano .env"
echo "2) npm run start:termux"

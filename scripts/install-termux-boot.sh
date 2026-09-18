#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOT_DIR="$HOME/.termux/boot"
BOOT_FILE="$BOOT_DIR/dolia.sh"

mkdir -p "$BOOT_DIR"
cat > "$BOOT_FILE" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock >/dev/null 2>&1 || true
cd "$ROOT"
tmux has-session -t dolia 2>/dev/null || tmux new-session -d -s dolia "bash scripts/termux-run.sh"
EOF
chmod +x "$BOOT_FILE"

echo "[Dolia] Đã tạo $BOOT_FILE"
echo "[Dolia] Cần cài ứng dụng Termux:Boot và mở nó ít nhất một lần sau khi cài."

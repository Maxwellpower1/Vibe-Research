#!/usr/bin/env bash
# Install / refresh systemd units for Vibe-Research.
# Usage:
#   cd /root/Vibe-Research-main
#   bash deploy/install-systemd.sh
#
# Env: VR_ROOT VR_PYTHON

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${VR_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PYTHON="${VR_PYTHON:-/root/miniconda3/bin/python}"

log() { echo "[systemd] $*"; }
die() { echo "[ERROR] $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "run as root (needed to write /etc/systemd/system)"
[[ -d "$ROOT/backend" && -d "$ROOT/frontend" ]] || die "not a Vibe-Research root: $ROOT"
[[ -x "$PYTHON" ]] || die "python not found: $PYTHON"

tmp_b="$(mktemp)"
tmp_f="$(mktemp)"
sed -e "s|/root/Vibe-Research-main|${ROOT}|g" \
    -e "s|/root/miniconda3/bin/python|${PYTHON}|g" \
    "$SCRIPT_DIR/vibe-backend.service" >"$tmp_b"
sed -e "s|/root/Vibe-Research-main|${ROOT}|g" \
    "$SCRIPT_DIR/vibe-frontend.service" >"$tmp_f"

install -m 644 "$tmp_b" /etc/systemd/system/vibe-backend.service
install -m 644 "$tmp_f" /etc/systemd/system/vibe-frontend.service
rm -f "$tmp_b" "$tmp_f"

systemctl daemon-reload
systemctl enable vibe-backend vibe-frontend
systemctl restart vibe-backend vibe-frontend
sleep 1
systemctl --no-pager --full status vibe-backend vibe-frontend || true
log "installed. frontend http://SERVER_IP:5899  backend :8900"

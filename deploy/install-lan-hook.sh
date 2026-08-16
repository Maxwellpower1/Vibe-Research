#!/usr/bin/env bash
# Install post-commit hook: every local commit overlays HEAD onto the LAN box.
# Usage (repo root): bash deploy/install-lan-hook.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/deploy/hooks/post-commit"
DST="$ROOT/.git/hooks/post-commit"

[[ -d "$ROOT/.git/hooks" ]] || { echo "[lan] not a git checkout: $ROOT" >&2; exit 1; }
[[ -f "$SRC" ]] || { echo "[lan] missing $SRC" >&2; exit 1; }

# Git for Windows treats hooks as bash; strip CRLF if copied from Windows.
sed 's/\r$//' "$SRC" >"$DST"
chmod +x "$DST" 2>/dev/null || true
echo "[lan] installed $DST"
echo "[lan] next commit -> ${VR_LAN_USER:-root}@${VR_LAN_HOST:-172.168.115.149}:${VR_LAN_PATH:-/root/Vibe-Research-main}"
echo "[lan] skip one commit: VR_LAN_SKIP=1 git commit ..."

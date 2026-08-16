#!/usr/bin/env bash
# Pack HEAD and overlay onto the LAN box. Does not touch remote backend/.env.
# Usage (repo root, Git Bash):
#   bash deploy/lan-update.sh
# Env:
#   VR_LAN_HOST=172.168.115.149
#   VR_LAN_USER=root
#   VR_LAN_PATH=/root/Vibe-Research-main
#   VR_LAN_SKIP=1   # no-op (also honored by the post-commit hook)

set -euo pipefail

HOST="${VR_LAN_HOST:-172.168.115.149}"
USER="${VR_LAN_USER:-root}"
REMOTE="${VR_LAN_PATH:-/root/Vibe-Research-main}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=5)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { echo "[lan] $*"; }
die() { echo "[lan] ERROR: $*" >&2; exit 1; }

if [[ "${VR_LAN_SKIP:-}" == "1" ]]; then
  log "skipped (VR_LAN_SKIP=1)"
  exit 0
fi

command -v git >/dev/null || die "git not found"
command -v ssh >/dev/null || die "ssh not found"
command -v scp >/dev/null || die "scp not found"
[[ -d "$ROOT/.git" ]] || die "not a git checkout: $ROOT"

if ! ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" "test -d ${REMOTE}/backend"; then
  die "cannot reach ${USER}@${HOST}:${REMOTE} (key login + path required)"
fi

PACK="$(mktemp "${TMPDIR:-/tmp}/vibe-deploy.XXXXXX.tgz")"
cleanup() { rm -f "$PACK"; }
trap cleanup EXIT

git archive --format=tar.gz -o "$PACK" HEAD
log "pack $(wc -c < "$PACK" | tr -d ' ') bytes -> ${USER}@${HOST}:${REMOTE}"
scp "${SSH_OPTS[@]}" "$PACK" "${USER}@${HOST}:/tmp/vibe-deploy.tgz"

UPDATE_ARGS=()
if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  if git diff-tree --no-commit-id --name-only -r HEAD | grep -qx 'frontend/package-lock.json'; then
    log "package-lock changed; full npm ci"
  else
    UPDATE_ARGS+=(--no-npm-ci)
  fi
else
  UPDATE_ARGS+=(--no-npm-ci)
fi

ssh "${SSH_OPTS[@]}" "${USER}@${HOST}" bash -s -- "${UPDATE_ARGS[@]:-}" <<'REMOTE'
set -euo pipefail
UPDATE_ARGS="${1:-}"
ROOT=/root/Vibe-Research-main
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
if [[ -f /root/miniconda3/etc/profile.d/conda.sh ]]; then
  # shellcheck disable=SC1091
  source /root/miniconda3/etc/profile.d/conda.sh
  conda activate base >/dev/null 2>&1 || true
fi
if [[ -f "$ROOT/backend/.env" ]]; then
  cp -a "$ROOT/backend/.env" /tmp/vibe.env.bak
fi
STAGE="/tmp/vibe-extract-$$"
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -xzf /tmp/vibe-deploy.tgz -C "$STAGE"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '/backend/.env' \
    --exclude '/backend/.venv/' \
    --exclude '/backend/.cache/' \
    --exclude '/backend/.pytest_cache/' \
    --exclude '/frontend/node_modules/' \
    --exclude '/frontend/dist/' \
    --exclude '/.git/' \
    "$STAGE/" "$ROOT/"
else
  tar -xzf /tmp/vibe-deploy.tgz -C "$ROOT"
fi
rm -rf "$STAGE"
if [[ -f /tmp/vibe.env.bak ]]; then
  mkdir -p "$ROOT/backend"
  cp -a /tmp/vibe.env.bak "$ROOT/backend/.env"
fi
sed -i 's/\r$//' "$ROOT"/deploy/*.sh 2>/dev/null || true
chmod +x "$ROOT"/deploy/*.sh 2>/dev/null || true
cd "$ROOT"
# shellcheck disable=SC2086
bash deploy/update.sh ${UPDATE_ARGS}
rm -f /tmp/vibe-deploy.tgz /tmp/vibe.env.bak
REMOTE

log "done  http://${HOST}:5899/"

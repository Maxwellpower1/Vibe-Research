#!/usr/bin/env bash
# Update Vibe-Research on the server after code files are replaced.
# Usage (on server):
#   cd ~/Vibe-Research-main   # or wherever the repo lives
#   bash deploy/update.sh
#   bash deploy/update.sh --backend-only
#   bash deploy/update.sh --frontend-only
#   bash deploy/update.sh --no-npm-ci    # skip wiping node_modules; just build
#
# Env overrides:
#   VR_ROOT=/root/Vibe-Research-main
#   VR_PYTHON=/root/miniconda3/bin/python
#   VR_BACKEND_UNIT=vibe-backend
#   VR_FRONTEND_UNIT=vibe-frontend

set -euo pipefail

BACKEND_ONLY=0
FRONTEND_ONLY=0
NPM_CI=1

for arg in "$@"; do
  case "$arg" in
    --backend-only) BACKEND_ONLY=1 ;;
    --frontend-only) FRONTEND_ONLY=1 ;;
    --no-npm-ci) NPM_CI=0 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "[ERROR] unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${VR_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PYTHON="${VR_PYTHON:-/root/miniconda3/bin/python}"
BACKEND_UNIT="${VR_BACKEND_UNIT:-vibe-backend}"
FRONTEND_UNIT="${VR_FRONTEND_UNIT:-vibe-frontend}"

log() { echo "[update] $*"; }
die() { echo "[ERROR] $*" >&2; exit 1; }

[[ -d "$ROOT/backend" && -d "$ROOT/frontend" ]] || die "not a Vibe-Research root: $ROOT"
command -v systemctl >/dev/null 2>&1 || die "systemctl not found"

update_backend() {
  log "backend: pip install + restart ($BACKEND_UNIT)"
  [[ -x "$PYTHON" ]] || die "python not found: $PYTHON (set VR_PYTHON=...)"
  cd "$ROOT/backend"
  "$PYTHON" -m pip install -r requirements.txt
  if [[ -f .env.example && ! -f .env ]]; then
    cp .env.example .env
    log "backend: created .env from .env.example — edit secrets if needed"
  fi
  systemctl restart "$BACKEND_UNIT"
  sleep 1
  systemctl --no-pager --full status "$BACKEND_UNIT" || true
  if curl -fsS --max-time 5 "http://127.0.0.1:8900/api/health" >/dev/null 2>&1; then
    log "backend: health OK"
  else
    log "backend: health check failed — see: journalctl -u $BACKEND_UNIT -n 50"
  fi
  if curl -fsS --max-time 5 "http://127.0.0.1:8900/api/market/review-warmup" >/dev/null 2>&1; then
    log "backend: review-warmup endpoint OK"
  else
    log "backend: review-warmup not ready yet (old build or still starting)"
  fi
}

# tar overlay never deletes; leftover pages still get typechecked.
prune_stale_sources() {
  local stale=(
    "$ROOT/frontend/src/pages/Weather.tsx"
    "$ROOT/backend/weather.py"
    "$ROOT/frontend/src/components/review/ReviewIndexPanel.tsx"
    "$ROOT/frontend/src/components/review/ReviewRankRow.tsx"
    "$ROOT/frontend/src/components/review/constants.ts"
  )
  local f
  for f in "${stale[@]}"; do
    if [[ -e "$f" ]]; then
      log "prune leftover: $f"
      rm -f "$f"
    fi
  done
}

update_frontend() {
  log "frontend: build + restart ($FRONTEND_UNIT)"
  command -v npm >/dev/null 2>&1 || die "npm not found (need Node 18+)"
  prune_stale_sources
  cd "$ROOT/frontend"
  if [[ "$NPM_CI" -eq 1 ]]; then
    rm -rf node_modules
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  elif [[ ! -d node_modules ]]; then
    npm ci 2>/dev/null || npm install
  fi
  npm run build
  [[ -d dist ]] || die "frontend dist/ missing after build"

  if ! systemctl list-unit-files | grep -q "^${FRONTEND_UNIT}.service"; then
    if [[ -f "$SCRIPT_DIR/vibe-frontend.service" ]]; then
      log "frontend: installing systemd unit $FRONTEND_UNIT"
      sed -e "s|/root/Vibe-Research-main|${ROOT}|g" \
        "$SCRIPT_DIR/vibe-frontend.service" >/etc/systemd/system/${FRONTEND_UNIT}.service
      systemctl daemon-reload
      systemctl enable "$FRONTEND_UNIT"
    else
      die "frontend unit missing; run: bash deploy/install-systemd.sh"
    fi
  fi
  pkill -f "vite.*preview" 2>/dev/null || true
  systemctl restart "$FRONTEND_UNIT"
  sleep 1
  systemctl --no-pager --full status "$FRONTEND_UNIT" || true
}

log "root=$ROOT"
if [[ "$FRONTEND_ONLY" -eq 0 ]]; then
  update_backend
fi
if [[ "$BACKEND_ONLY" -eq 0 ]]; then
  update_frontend
fi
log "done"

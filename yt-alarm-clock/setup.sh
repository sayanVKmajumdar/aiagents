#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# YT Alarm Clock — one-command setup.
#
#   ./setup.sh              install backend + mobile dependencies and verify
#   ./setup.sh backend      backend only
#   ./setup.sh mobile       mobile only
#   ./setup.sh start        install if needed, then run the API on :8000
#   ./setup.sh oauth        run the YouTube Music OAuth flow (writes oauth.json)
#
# Everything is idempotent: re-running is safe and skips finished steps.
# ---------------------------------------------------------------------------
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND="$ROOT/backend"
MOBILE="$ROOT/mobile"
VENV="$BACKEND/.venv"
PY="$VENV/bin/python"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

check_prereqs() {
  bold "Checking prerequisites"
  have python3 || die "python3 not found (install Python 3.10+)"
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
    || die "Python 3.10+ required, found $(python3 -V 2>&1)"
  ok "python $(python3 -c 'import platform;print(platform.python_version())')"
  have node || die "node not found (install Node 18+; https://nodejs.org)"
  ok "node $(node -v)"
  have npm || die "npm not found"
  ok "npm $(npm -v)"
  have ffmpeg || warn "ffmpeg missing — only needed for rare stream remuxing (Docker image includes it)"
}

setup_backend() {
  bold "Backend"
  if [ ! -d "$VENV" ]; then
    python3 -m venv "$VENV" || die "could not create virtualenv at $VENV"
    ok "created $VENV"
  else
    ok "virtualenv present"
  fi

  "$PY" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || true
  # requirements-dev adds pytest; both are tiny, so install the dev set.
  "$PY" -m pip install --quiet -r "$BACKEND/requirements-dev.txt" \
    || die "pip install failed (check your network / proxy)"
  ok "dependencies installed"

  if [ -f "$BACKEND/oauth.json" ]; then
    ok "oauth.json found — the API will play your Liked Songs"
  else
    warn "no oauth.json yet: run './setup.sh oauth' (guest mode only plays public charts)"
  fi

  if [ -f "$BACKEND/.env" ]; then
    ok ".env found — loaded by your shell/docker (export manually if running uvicorn directly)"
  fi

  bold "Backend tests"
  ( cd "$BACKEND" && "$PY" -m pytest -q ) || die "backend tests failed"
}

setup_oauth() {
  bold "YouTube Music OAuth"
  [ -x "$PY" ] || setup_backend
  have "$VENV/bin/ytmusicapi" || "$PY" -m pip install --quiet ytmusicapi
  ( cd "$BACKEND" && "$VENV/bin/ytmusicapi" oauth )
  [ -f "$BACKEND/oauth.json" ] && ok "wrote $BACKEND/oauth.json (keep it secret, never commit)"
  return 0
}

setup_mobile() {
  bold "Mobile"
  have npm || die "npm not found"
  ( cd "$MOBILE" && npm install --no-audit --no-fund ) || die "npm install failed"
  ok "node_modules installed"

  bold "Plugin unit tests"
  ( cd "$MOBILE" && npx jest --config jest.config.js ) || die "plugin tests failed"

  bold "Bundle check (catches import/syntax errors without a device)"
  TMPOUT=$(mktemp -d)
  ( cd "$MOBILE" && CI=1 EXPO_NO_TELEMETRY=1 npx expo export --platform android \
      --output-dir "$TMPOUT" --clear >/dev/null ) \
    && ok "javascript bundle builds" \
    || { rm -rf "$TMPOUT"; die "expo export failed"; }
  rm -rf "$TMPOUT"

  cat <<'EOF'

  Next steps for the phone build (needs your Expo account + Android):
    cd mobile
    npx expo prebuild -p android --clean   # applies the lockscreen plugins
    npx expo run:android                   # local dev build, or:
    eas login && eas init && eas build -p android --profile preview

EOF
}

start_backend() {
  [ -x "$PY" ] || setup_backend
  bold "Starting API on http://0.0.0.0:8000 (Ctrl-C to stop)"
  if [ -f "$BACKEND/.env" ]; then
    set -a; . "$BACKEND/.env"; set +a
  fi
  cd "$BACKEND" && exec "$VENV/bin/uvicorn" server:app --host 0.0.0.0 --port "${PORT:-8000}" --reload
}

main() {
  case "${1:-all}" in
    all)     check_prereqs; setup_backend; setup_mobile ;;
    backend) check_prereqs; setup_backend ;;
    mobile)  check_prereqs; setup_mobile ;;
    oauth)   setup_oauth ;;
    start)   start_backend ;;
    *)       echo "usage: $0 [all|backend|mobile|oauth|start]" >&2; exit 2 ;;
  esac
}

main "$@"

#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# build-apk.sh — build an installable Android APK for YT Alarm.
#
# Run this on any Linux/macOS machine (or WSL) with internet access. It needs
# JDK 17 + Android SDK; everything else (Node, EAS CLI, Gradle) it installs or
# downloads itself. No Expo account, no Render account, no Android Studio GUI.
#
#   ./build-apk.sh            # trial build: alarm works immediately with the
#                             # built-in tone; add a backend URL later in-app
#   ./build-apk.sh --full     # same APK without demo mode (no URL = no song)
#   ./build-apk.sh --eas      # build in Expo's cloud instead (needs eas login)
#
# Output: yt-alarm-trial.apk next to this script, plus its SHA-256.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MOBILE="$HERE/mobile"
DEMO=1
USE_EAS=0

for arg in "$@"; do
  case "$arg" in
    --full) DEMO=0 ;;
    --eas)  USE_EAS=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Fast path: Expo's cloud builders (no local Android SDK needed at all).
# ---------------------------------------------------------------------------
if [ "$USE_EAS" = "1" ]; then
  bold "EAS cloud build"
  command -v npm >/dev/null || die "node/npm not found (https://nodejs.org)"
  cd "$MOBILE"
  npm install --no-audit --no-fund
  npx --yes eas-cli@latest login
  npx eas-cli init --non-interactive || npx eas-cli init
  if [ "$DEMO" = "1" ]; then
    npx eas-cli build -p android --profile android-trial
  else
    npx eas-cli build -p android --profile preview
  fi
  echo
  ok "When the build finishes, open the printed link on your phone and install the APK."
  exit 0
fi

# ---------------------------------------------------------------------------
# Local build
# ---------------------------------------------------------------------------
bold "1/6 Checking the toolchain"

if ! command -v java >/dev/null; then
  die "java not found. Install JDK 17:
    Ubuntu/Debian : sudo apt install -y openjdk-17-jdk
    macOS         : brew install --cask temurin@17"
fi
JAVA_MAJOR=$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)
[ "${JAVA_MAJOR:-0}" -ge 17 ] || die "JDK 17+ required, found $JAVA_MAJOR"
ok "java $JAVA_MAJOR"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

SDKMANAGER=$(command -v sdkmanager || true)
if [ -z "$SDKMANAGER" ] && [ -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
fi

if [ -z "$SDKMANAGER" ]; then
  warn "Android SDK not found — downloading the command-line tools (≈150 MB)"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  OS=$(uname -s)
  case "$OS" in
    Linux)  ZIP=commandlinetools-linux-11076708_latest.zip ;;
    Darwin) ZIP=commandlinetools-mac-11076708_latest.zip ;;
    *) die "unsupported OS: $OS (use --eas instead)" ;;
  esac
  curl -fsSL "https://dl.google.com/android/repository/$ZIP" -o /tmp/cmdline-tools.zip \
    || die "could not download the Android command-line tools"
  unzip -q -o /tmp/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
fi
ok "sdkmanager: $SDKMANAGER"

bold "2/6 Installing SDK packages (platform-tools, platform 35, build-tools)"
yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
"$SDKMANAGER" --install "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/dev/null \
  || "$SDKMANAGER" --install "platform-tools" "platforms;android-35" "build-tools;34.0.0" >/dev/null
ok "SDK ready at $ANDROID_HOME"
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > /dev/null

bold "3/6 Installing JS dependencies"
command -v npm >/dev/null || die "node/npm not found (https://nodejs.org)"
cd "$MOBILE"
npm install --no-audit --no-fund --legacy-peer-deps
ok "node_modules ready"

bold "4/6 Tests + prebuild (applies the lockscreen plugins)"
npm test --silent
npx --yes expo prebuild -p android --clean --no-install

MANIFEST=android/app/src/main/AndroidManifest.xml
grep -q 'android:showWhenLocked="true"' "$MANIFEST" || die "lockscreen flag missing from $MANIFEST"
grep -q 'USE_FULL_SCREEN_INTENT' "$MANIFEST" || die "full-screen intent permission missing"
grep -q 'applyFullScreenAlarmIntent' \
  node_modules/expo-notifications/android/src/main/java/expo/modules/notifications/notifications/presentation/builders/ExpoNotificationBuilder.kt \
  || die "expo-notifications builder was not patched"
ok "native alarm flags verified"
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties

bold "5/6 Compiling the APK (first run downloads Gradle deps, ~5-10 min)"
cd android
chmod +x gradlew
if [ "$DEMO" = "1" ]; then
  export EXPO_PUBLIC_DEMO_MODE=1
  ok "demo mode ON — alarms ring immediately with the built-in tone"
fi
./gradlew assembleRelease --no-daemon

bold "6/6 Collecting the APK"
APK=$(find app/build/outputs/apk -name '*.apk' | head -1)
[ -n "$APK" ] || die "build finished but no .apk was produced"
OUT="$HERE/yt-alarm-trial.apk"
[ "$DEMO" = "1" ] || OUT="$HERE/yt-alarm.apk"
cp "$APK" "$OUT"
( cd "$HERE" && shasum -a 256 "$(basename "$OUT")" 2>/dev/null || sha256sum "$(basename "$OUT")" ) \
  > "$OUT.sha256" || true

echo
ok "APK: $OUT"
cat "$OUT.sha256" 2>/dev/null || true
cat <<EOF

  Install it on your phone:
    1. Copy the .apk to the phone (USB, or: python3 -m http.server 8080 — then
       open http://<laptop-ip>:8080/yt-alarm-trial.apk in the phone browser)
    2. Tap the download → "Install anyway" (allow install from this source)
    3. Open YT Alarm, add an alarm 2 minutes from now, lock the screen

  With a backend URL (⚙︎ in the app) it streams your real songs; without one,
  the trial build still rings with the built-in tone.
EOF

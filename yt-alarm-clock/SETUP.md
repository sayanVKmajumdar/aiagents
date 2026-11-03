# Setup — from download to a ringing phone

Follow this top to bottom. Steps 1–3 you can do right now on a computer; step 4
needs your phone. Total time ≈ 20 minutes plus build time.

> **What "ready" means here.** The code is complete and verified: the backend
> suite passes, the JS bundle builds, and `expo prebuild` produces the native
> manifest this app needs. Three things only you can supply: your YouTube login,
> a hosting account, and a physical phone. No one can build or sign *your* APK
> for you, and no one can prove an alarm wakes a locked phone except on a phone.

---

## 1. Verify the backend on your machine (5 min)

```bash
cd yt-alarm-clock
chmod +x setup.sh
./setup.sh backend          # virtualenv + deps + tests  (safe to re-run)
cd backend
../backend/.venv/bin/python selfcheck.py
```

`selfcheck.py` is the honest gate. It checks imports, binaries, credentials and
whether a real YouTube stream can be resolved. On a normal home connection the
last two rows must be `PASS`:

```
PASS  youtube music reachable      charts keys: [...]
PASS  yt-dlp stream resolution     rr3---sn-...googlevideo.com · Never Gonna Give You Up
```

If either says `FAIL`, fix that before touching the phone — nothing downstream
can work.

### Add your YouTube Music account

```bash
./setup.sh oauth          # from the repo root; opens Google in your browser
```

This writes `backend/oauth.json`. It is a Google refresh token:
**never commit it, never paste it in a chat, never put it in a public repo.**
`.gitignore` already excludes it.

Restart the API and re-run the self-check — `ytmusic credentials` should now be
`PASS  mode=file`.

### Run it locally

```bash
./setup.sh start          # http://0.0.0.0:8000
```

Open <http://localhost:8000/docs> for the interactive API.

---

## 2. Deploy the backend (5 min)

### Option A — Render (easiest, free)

1. Push this folder (or the whole repo) to GitHub.
2. Render → **New → Blueprint** → select the repo. `backend/render.yaml` is the
   blueprint; it sets the Docker runtime, `/health` check, and generates
   `ALARM_API_KEY`.
3. When prompted, paste the **contents of `oauth.json`** (one line) into
   `YTMUSIC_OAUTH_JSON`. Copy the generated `ALARM_API_KEY` somewhere.
4. After the first deploy, prove it from your machine:

```bash
cd backend
.venv/bin/python selfcheck.py --url https://YOUR-SERVICE.onrender.com --api-key YOUR_KEY
```

Everything must be `PASS`, including **`stream URL serves audio`** — that row
downloads the first kilobyte, which is the difference between "returns JSON" and
"will actually play at 7 AM".

### Option B — Fly.io

```bash
cd backend
fly launch --no-deploy --copy-config
fly secrets set YTMUSIC_OAUTH_JSON="$(cat oauth.json)" ALARM_API_KEY="$(openssl rand -hex 16)"
fly deploy
```

### Option C — your own Docker host

```bash
cd backend
docker build -t yt-alarm-backend .
docker run -d -p 8000:8000 -e YTMUSIC_OAUTH_JSON="$(cat oauth.json)" yt-alarm-backend
```

> Render's free tier sleeps after ~15 min. The app sends a warm-up ping when it
> opens, and the ringing screen retries — but the first alarm of the day may
> take a few seconds longer to start the song.

---

## 3. Prepare the mobile app (5 min + build time)

```bash
cd mobile
npm install
npm test                       # 7 plugin tests must pass
npx expo prebuild -p android --clean
```

Look at `android/app/src/main/AndroidManifest.xml` — it must contain
`android:showWhenLocked="true"`, `android:turnScreenOn="true"` and
`android.permission.USE_FULL_SCREEN_INTENT`. That is the lockscreen bypass.

### Build an installable APK — pick one

**A. EAS cloud build (no Android SDK needed, recommended)**

```bash
npm install -g eas-cli
eas login
eas init                       # writes a real projectId into app.json
eas build -p android --profile preview
```

Scan the QR / open the link it prints and install the `.apk` on your phone.

**B. Local build (needs Android Studio + JDK 17)**

```bash
cd android
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For a signed release APK, follow
<https://docs.expo.dev/build-reference/local-builds/> or run
`eas build -p android --profile production` for an `.aab`.

**You cannot use Expo Go for this app.** Expo Go ships its own
`AndroidManifest.xml`, so the lockscreen flags and the full-screen-intent patch
simply are not there. A development or release build is mandatory.

---

## 4. Configure the phone (3 min)

1. Install the APK, open **YT Alarm**.
2. Tap **⚙︎** → Backend URL → paste `https://YOUR-SERVICE.onrender.com`
   → API key (the generated one) → **Test connection**.
   Green "Backend online · oauth" means the phone can reach your server.
3. Android **Settings → Apps → YT Alarm**:
   - **Battery → Unrestricted**
   - **Alarms & reminders → Allowed**
   - **Display over other apps → Allowed**
   - **Notifications → Allowed** (channel "Unstoppable Alarms" on)
   - Xiaomi/Redmi/Poco: also **Autostart → on**, battery profile **No restrictions**
4. Optional: **+ New alarm → song row** → search a track to pin one. Leave it as
   "Surprise me" for a random song from your Liked Songs each morning.

---

## 5. The test that matters

1. Add an alarm **2 minutes from now**.
2. Lock the phone and put it face down.
3. Wait.

Expected, in order:

- the screen lights up on its own;
- the ringing screen appears **over the lockscreen** (not just a banner);
- music starts within a few seconds, volume ramping up;
- the progress bar fills; **DISMISS** stays disabled until 100%;
- dismissing stops the audio and releases the wake lock.

| What you see instead | What it means | Fix |
| --- | --- | --- |
| Heads-up banner only, screen stays dark | native patch didn't apply | `npx expo prebuild -p android --clean`, confirm the build log says `Patched ExpoNotificationBuilder.kt` |
| Nothing at all | notification permission or exact-alarm blocked | Settings → Notifications / Alarms & reminders; toggle the alarm off and on |
| Screen wakes, but "Playback problem" | backend cold or stream expired | tap **Try again**; check the backend status line in the app |
| Ringing works, dismiss never unlocks | stream stalled | after 90 s a **Dismiss anyway** button appears by design |

---

## 6. Known limits (read before you rely on it)

- **After a reboot, open the app once.** Alarms are re-armed on app launch; no
  background boot receiver is shipped. A phone that reboots overnight will not
  ring until the app is opened.
- **Stream URLs are IP-bound and expire.** The app always re-resolves; never
  cache a `stream_url`.
- **YouTube can change the rules.** The mobile-client spoof works today from
  datacenter IPs. If `/get-alarm-audio` starts returning 403/500, bump
  `yt-dlp` in `requirements.txt` and redeploy — that's usually the whole fix.
- **Personal use only.** ytmusicapi and yt-dlp both operate outside YouTube's
  Terms of Service. Don't redistribute streams or publish the backend URL with
  no API key.
- **iOS is configured but untested here.** The JS is cross-platform and
  `UIBackgroundModes: audio` is set, but there is no `CriticalAlerts` entitlement
  and no iOS build was produced.

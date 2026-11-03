# YT Alarm Clock

Wake up to a random song from your YouTube Music library — streamed live, on a
locked phone, with a screen you have to deal with before it stops.

The app is two halves:

| Folder | What it is | Runs on |
| --- | --- | --- |
| [`backend/`](backend) | FastAPI service that picks a random track from your Liked Songs / history / charts and hands the phone a direct audio URL | Render, Fly.io, Docker anywhere |
| [`mobile/`](mobile) | Expo (SDK 54) app: alarm list, scheduler, ringing screen, native lockscreen wake-up | Android APK via EAS |

---

## Why this isn't "just an alarm"

Two failure modes kill most hobby alarm apps. Both are handled here.

**1. YouTube blocks datacenter IPs.** The plain `web` client gets
"Sign in to confirm you're not a bot" from Render/AWS/Fly. The backend forces
yt-dlp's mobile innertube clients (`android`, `ios`, `tv_embedded`), ships Deno so
yt-dlp can solve YouTube's JS challenges, and caches resolved stream URLs for 30
minutes so a retry never costs a second round trip.

**2. Android kills sleeping apps.** A local notification with
`importance: MAX` still only lights the screen for a heads-up banner on many
phones. A real alarm needs a **full-screen intent** plus
`showWhenLocked`/`turnScreenOn` on the activity. Neither is exposed by
`expo-notifications`, so `mobile/plugins/` contains two Expo config plugins that
inject them at build time (see [Native layer](#native-layer-what-the-plugins-do)).

---

## Quick start (local)

```bash
cd yt-alarm-clock
chmod +x setup.sh
./setup.sh            # installs both halves and runs every test
```

Or by hand:

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000/docs>. `GET /health` should say
`"ytmusic_auth": "guest"`. Guest mode only uses public charts — to play *your*
library, add OAuth (next section).

Run the tests (no network needed):

```bash
pytest -q          # 7 passed
```

### Mobile

```bash
cd mobile
npm install
npx expo prebuild -p android   # applies the config plugins, writes ./android
npx expo run:android           # needs Android Studio / a device attached
```

Point the app at your backend with the ⚙︎ button → **Backend URL**
(`http://<your-laptop-LAN-ip>:8000` when testing on a phone) → **Test
connection**.

> **Do not test alarms in Expo Go.** `expo-notifications` remote/local alarm
> behaviour and the config plugins require a development or release build — Expo
> Go cannot apply a custom `AndroidManifest.xml`.

---

## YouTube OAuth (needed for Liked Songs + History)

```bash
cd backend
pip install ytmusicapi
ytmusicapi oauth            # opens Google in your browser, writes oauth.json
cat oauth.json              # copy this whole JSON blob for the cloud
```

`ytmusicapi oauth` asks for a Google OAuth client (Desktop app) the first time;
create one at <https://console.cloud.google.com/apis/credentials> with the
YouTube Data API v3 enabled, and paste the client id/secret. Keep `oauth.json`
out of git — `.gitignore` already excludes it.

The backend accepts credentials three ways, in order:

1. `YTMUSIC_OAUTH_JSON` environment variable (the cloud path — recommended)
2. `oauth.json` in the working directory
3. `browser.json` cookies (legacy; not recommended, expires often)

Check what the server actually loaded:

```bash
curl https://YOUR-URL/debug/ytmusic
# {"mode":"oauth","probe":{"charts":true,"liked_songs":5}}
```

---

## Deploy the backend

### Render (free tier, one click)

`backend/render.yaml` is a ready blueprint.

1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo.
3. Render reads `render.yaml`: Docker runtime, health check `/health`,
   `ALARM_API_KEY` auto-generated, and it prompts for `YTMUSIC_OAUTH_JSON`
   (paste the contents of `oauth.json`).
4. Wait for the first build, then:

```bash
curl https://yt-alarm-backend.onrender.com/health
# {"status":"live",...,"ytmusic_auth":"oauth"}
```

> **Free tier sleeps after ~15 min idle.** The app sends a warm-up ping on
> launch, but the very first alarm after a long gap may take a few extra
> seconds to start the song — the ringing screen shows "CONNECTING…" and retries.
> If that bothers you, upgrade the plan or move to Fly.io with
> `min_machines_running = 1`.

### Fly.io

```bash
cd backend
fly launch --no-deploy --copy-config      # uses fly.toml
fly secrets set YTMUSIC_OAUTH_JSON="$(cat oauth.json)" ALARM_API_KEY="$(openssl rand -hex 16)"
fly deploy
```

### Any Docker host

```bash
cd backend
docker build -t yt-alarm-backend .
docker run -p 8000:8000 -e YTMUSIC_OAUTH_JSON="$(cat oauth.json)" yt-alarm-backend
```

### Lock it down

`ALARM_API_KEY` is optional but recommended on a public URL — without it, anyone
who finds the service can spend your YouTube quota.

```bash
curl -H "x-api-key: $ALARM_API_KEY" https://YOUR-URL/get-alarm-audio
```

Set the same key in the app: ⚙︎ → **API key**.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | liveness; reports which auth mode loaded (never guarded) |
| `GET` | `/get-alarm-audio` | random playable track + direct stream URL (`?video_id=` to pin one) |
| `GET` | `/search?q=` | search YouTube Music (used by the in-app song picker) |
| `GET` | `/debug/ytmusic` | live probe of charts / liked songs |

`/get-alarm-audio` returns:

```json
{
  "video_id": "dQw4w9WgXcQ",
  "title": "Never Gonna Give You Up",
  "artist": "Rick Astley",
  "stream_url": "https://rr3---sn-...googlevideo.com/videoplayback?...",
  "duration_ms": 213000,
  "thumbnail": "https://...",
  "expires_in_ms": 1800000
}
```

The stream URL is IP-bound and expires: the app always re-requests it rather
than storing it.

---

## Build the APK

```bash
cd mobile
npm install -g eas-cli
eas login
eas init                      # writes a real projectId into app.json
eas build -p android --profile preview
```

`eas.json`'s `preview` profile produces an installable `.apk` (the `production`
profile produces an `.aab` for Play Store). Install the APK on your phone, then
do the [Android settings](#android-settings-do-these-once) below.

---

## Native layer: what the plugins do

`mobile/plugins/withAndroidAlarmFlags.js`

- `MainActivity` gets `android:showWhenLocked="true"`, `android:turnScreenOn="true"`
  and `launchMode="singleTask"`.
- Adds the alarm permissions (`USE_FULL_SCREEN_INTENT`, `WAKE_LOCK`,
  `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `DISABLE_KEYGUARD`,
  `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE*`, `POST_NOTIFICATIONS`, …).
- Removes `RECORD_AUDIO` (the app never records; `expo-audio` adds it by default
  unless you pass `recordAudioAndroid: false`).
- Strips the bogus `android:showOnLockScreen` attribute that older tutorials
  suggest — it is not a framework attribute and strict manifest mergers reject it.

`mobile/plugins/withFullScreenAlarmNotification.js`

- Patches `expo-notifications`' `ExpoNotificationBuilder.kt` (idempotently, at
  prebuild) so notifications whose JS `data` contains
  `fullScreenIntent: true` also carry a **full-screen `PendingIntent`** plus
  `CATEGORY_ALARM` and `VISIBILITY_PUBLIC`. That is the flag Android needs to
  treat your app like the system clock. If a future `expo-notifications` release
  moves that file, the plugin logs a warning and the build still succeeds (you
  lose the instant wake-up, not the alarm).
- Declares the `SHOW_ALARMS` / `SET_ALARM` / `DISMISS_ALARM` `<queries>` entries
  Android 14+ checks before granting full-screen-intent permission.

Both plugins are unit-tested — `npm test` in `mobile/` — because a wrong XML node
here fails silently and only shows up as "my alarm didn't wake me".

---

## Android settings (do these once)

Without these, Android's doze mode owns your alarm.

| Setting (Settings → Apps → YT Alarm) | Value | Why |
| --- | --- | --- |
| Battery → Unrestricted | on | stops doze from delaying the alarm |
| Alarms & reminders | allowed | required for exact alarms on Android 13+ |
| Display over other apps | allowed | lets the ringing screen appear over the keyguard |
| Notifications | allowed, "Unstoppable Alarms" channel on | full-screen intent needs a notification |

Xiaomi/Redmi/Poco: also enable **Autostart** and set the battery profile to
**No restrictions**. Samsung: remove the app from "Sleeping apps".

---

## The ringing screen

- Streams a random track (or your pinned song) through `expo-audio`, looping, at
  a volume that ramps up over 2.5 s.
- Dismiss stays disabled until the track has played through; a progress bar and
  a "% listened" hint keep the user informed.
- If the backend or stream fails, the screen shows the error with **Try again**
  (it re-resolves a fresh URL) and after 90 s offers **Dismiss anyway**, so a
  broken stream can never trap you.
- The screen keeps the display awake via `expo-keep-awake` while ringing.

---

## Testing checklist

1. `curl https://YOUR-URL/get-alarm-audio` returns a `stream_url`.
2. In the app: ⚙︎ → Test connection → green "Backend online · oauth".
3. Add an alarm **2 minutes from now**, lock the phone, wait.
   Expected: screen lights up on its own, ringing screen appears over the
   lockscreen, music starts within a few seconds, Dismiss unlocks at 100%.
4. Reboot the phone → open the app → the alarm is still armed (re-scheduled on
   launch).

If step 3 only shows a heads-up notification, the native patch did not apply:
run `npx expo prebuild -p android --clean` and check the build log for
`[withFullScreenAlarmNotification] Patched ExpoNotificationBuilder.kt`.

---

## Repository layout

```text
yt-alarm-clock/
├── setup.sh                 one-command install + verify (backend & mobile)
├── QUICKSTART.txt           the 2-minute version of this file
├── SETUP.md                 full walkthrough + troubleshooting table
├── backend/
│   ├── Dockerfile            python:3.11-slim + ffmpeg + deno
│   ├── fly.toml              Fly.io alternative
│   ├── render.yaml           Render blueprint
│   ├── requirements.txt      pinned runtime deps
│   ├── requirements-dev.txt  + pytest/httpx
│   ├── server.py             FastAPI app
│   ├── selfcheck.py          end-to-end readiness probe (local + deployed)
│   └── tests/test_server.py  7 offline tests
└── mobile/
    ├── App.js                shell: list, FAB, sheets, ringing modal
    ├── app.json              Expo config (plugins wired here)
    ├── eas.json              preview -> apk, production -> aab
    ├── plugins/
    │   ├── withAndroidAlarmFlags.js
    │   └── withFullScreenAlarmNotification.js
    ├── __tests__/plugins.test.js
    └── src/
        ├── components/       AlarmCard, RingingModal, TimePickerSheet,
        │                     SongPickerSheet, SettingsSheet
        ├── hooks/            useAlarmTrigger
        ├── services/         ApiService, AudioService, NotificationService
        ├── utils/            storage, time
        └── theme.js
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `503 No tracks available` | guest mode + YouTube rate limit. Add `YTMUSIC_OAUTH_JSON`, or retry later. |
| Stream 403 / stops after a minute | googlevideo URL bound to another IP or expired → tap **Try again**; the backend caches for 30 min only. |
| Alarm doesn't fire after reboot | open the app once; notifications are re-armed on launch (a background boot receiver is not shipped). |
| Notification shows but no sound | expected: the notification is silent by design, the ringing screen streams the song. Check the backend status line. |
| Render cold start | first request after idle takes ~20 s; the app warms the backend on launch and retries. |
| `RECORD_AUDIO` still in the manifest | make sure the `expo-audio` plugin entry keeps `recordAudioAndroid: false`. |

## Credits & legal

Uses [ytmusicapi](https://github.com/sigma67/ytmusicapi) and
[yt-dlp](https://github.com/yt-dlp/yt-dlp). Both consume YouTube content in ways
that fall outside YouTube's Terms of Service — this project is for personal,
non-commercial use on your own account. Don't redistribute the streams.

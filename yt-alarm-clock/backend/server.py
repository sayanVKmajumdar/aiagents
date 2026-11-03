"""YouTube Music Alarm — cloud backend.

Endpoints
---------
GET  /health                  liveness probe (never throws, no auth needed)
GET  /get-alarm-audio         pick a random track and resolve a direct stream URL
GET  /search?q=...            search YouTube Music (used by the app's song picker)
GET  /debug/ytmusic           report which auth backend was detected (no secrets)

Why the extra care around passwords / tokens: this service is meant to sit on a
public URL. Anyone who finds it can spend your YouTube quota, so the endpoints
that hit ytmusicapi are optionally protected by ALARM_API_KEY.
"""

from __future__ import annotations

import json
import logging
import os
import random
from typing import Any, Iterable

import yt_dlp
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from ytmusicapi import YTMusic

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("yt-alarm-backend")

APP_VERSION = "2.1.0"

# ---------------------------------------------------------------------------
# Auth bootstrap
# ---------------------------------------------------------------------------
# Render gives you an ephemeral disk: files you drop in the container are gone
# after every deploy. So the OAuth blob is passed as an env var instead.
OAUTH_ENV_VAR = "YTMUSIC_OAUTH_JSON"
OAUTH_FILE_CANDIDATES = ("oauth.json", "browser.json")


def _ytmusic_from_env() -> YTMusic | None:
    raw = os.getenv(OAUTH_ENV_VAR)
    if not raw:
        return None
    try:
        # Tolerate base64-style single-line pastes as well as raw JSON.
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        logger.info("Using YTMusic credentials from %s", OAUTH_ENV_VAR)
        return YTMusic(data)
    except Exception as exc:  # noqa: BLE001 - we fall through to guest mode
        logger.error("Could not parse %s: %s", OAUTH_ENV_VAR, exc)
        return None


def _ytmusic_from_file() -> YTMusic | None:
    for path in OAUTH_FILE_CANDIDATES:
        if os.path.exists(path):
            try:
                logger.info("Using YTMusic credentials from %s", path)
                return YTMusic(path)
            except Exception as exc:  # noqa: BLE001
                logger.error("Could not load %s: %s", path, exc)
    return None


def init_ytmusic() -> tuple[YTMusic, str]:
    """Return (client, mode). mode is 'oauth' | 'file' | 'guest'."""
    client = _ytmusic_from_env()
    if client is not None:
        return client, "oauth"
    client = _ytmusic_from_file()
    if client is not None:
        return client, "file"
    logger.warning(
        "No YTMusic credentials found — using guest mode (charts + search only; "
        "Liked Songs and History need OAuth)."
    )
    return YTMusic(), "guest"


yt, YTMUSIC_MODE = init_ytmusic()


# ---------------------------------------------------------------------------
# yt-dlp configuration
# ---------------------------------------------------------------------------
# YouTube blocks the plain web client from datacenter IPs (Render, Fly, AWS...)
# with "Sign in to confirm you're not a bot". The *innertube* mobile clients are
# far more tolerant, so we force those. `deno` is bundled in the Docker image so
# yt-dlp can solve the nsig/JS challenges that mobile clients require.
def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [chunk.strip() for chunk in raw.replace(",", " ").split() if chunk.strip()]


PLAYER_CLIENTS = _env_list("YTDLP_PLAYER_CLIENTS", ["android", "ios", "tv_embedded"])

YDL_BASE_OPTS: dict[str, Any] = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "nocheckcertificate": True,
    "socket_timeout": 20,
    "retries": 3,
    "extractor_retries": 2,
    "cachedir": os.getenv("YTDLP_CACHE_DIR", "/tmp/yt-dlp-cache"),
    "extractor_args": {"youtube": {"player_client": PLAYER_CLIENTS}},
}

if os.getenv("YTDLP_COOKIES_FROM_BROWSER"):
    # Handy locally: YTDLP_COOKIES_FROM_BROWSER=chrome
    YDL_BASE_OPTS["cookiesfrombrowser"] = (
        os.getenv("YTDLP_COOKIES_FROM_BROWSER"),
    )


# --- HTTP cache ------------------------------------------------------------
# Stream URLs expire (~6h) and each resolution costs a couple of YouTube round
# trips. A tiny in-process cache keeps alarm fires snappy and dodges duplicate
# work when the phone retries.
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
CACHE_TTL_SECONDS = int(os.getenv("STREAM_CACHE_TTL", 60 * 30))


def _cache_get(key: str) -> dict[str, Any] | None:
    import time

    hit = _CACHE.get(key)
    if not hit:
        return None
    expires_at, payload = hit
    if expires_at < time.time():
        _CACHE.pop(key, None)
        return None
    return payload


def _cache_put(key: str, payload: dict[str, Any]) -> None:
    import time

    if len(_CACHE) > 64:
        _CACHE.clear()
    _CACHE[key] = (time.time() + CACHE_TTL_SECONDS, payload)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="YouTube Music Alarm Backend", version=APP_VERSION)

allowed_origins = _env_list("CORS_ALLOW_ORIGINS", ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,  # must stay False when allow_origins is "*"
    allow_methods=["*"],
    allow_headers=["*"],
)

ALARM_API_KEY = os.getenv("ALARM_API_KEY", "").strip()


async def require_api_key(request: Request) -> None:
    """No-op unless ALARM_API_KEY is set on the server."""
    if not ALARM_API_KEY:
        return
    supplied = request.headers.get("x-api-key") or request.query_params.get("api_key")
    if supplied != ALARM_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _track_artist(track: dict[str, Any]) -> str:
    artists = track.get("artists")
    if isinstance(artists, list):
        names = [a.get("name") for a in artists if isinstance(a, dict) and a.get("name")]
        if names:
            return ", ".join(names)
    for key in ("author", "uploader"):
        if track.get(key):
            return str(track[key])
    return "YouTube Music"


def _dedupe_tracks(tracks: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for track in tracks:
        if not isinstance(track, dict):
            continue
        video_id = track.get("videoId")
        if not video_id or video_id in seen:
            continue
        seen.add(video_id)
        out.append(track)
    return out


def gather_candidates(limit: int = 100) -> list[dict[str, Any]]:
    """Liked songs -> history -> charts -> search. Never raises, may return []."""
    candidates: list[dict[str, Any]] = []

    try:
        liked = yt.get_liked_songs(limit=limit)
        candidates.extend(_dedupe_tracks((liked or {}).get("tracks") or []))
        if candidates:
            logger.info("Using %d liked songs", len(candidates))
            return candidates
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not fetch liked songs: %s", exc)

    try:
        history = yt.get_history() or []
        candidates.extend(_dedupe_tracks(history))
        if candidates:
            logger.info("Using %d history tracks", len(candidates))
            return candidates
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not fetch history: %s", exc)

    try:
        charts = yt.get_charts(country=os.getenv("CHARTS_COUNTRY", "US")) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not fetch charts: %s", exc)
        charts = {}

    for section in ("videos", "songs"):
        block = (charts.get(section) or {})
        items = block.get("items") if isinstance(block, dict) else None
        if items:
            candidates.extend(_dedupe_tracks(items))
    if candidates:
        logger.info("Using %d chart tracks", len(candidates))
        return candidates

    try:
        candidates.extend(_dedupe_tracks(yt.search("Top Hits", filter="songs") or []))
    except Exception as exc:  # noqa: BLE001
        logger.error("Chart and search fallback both failed: %s", exc)

    return _dedupe_tracks(candidates)


def resolve_stream(video_id: str) -> dict[str, Any]:
    """Resolve a direct audio URL for `video_id` via yt-dlp."""
    cache_key = f"stream:{video_id}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    video_url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(YDL_BASE_OPTS) as ydl:
        info = ydl.extract_info(video_url, download=False)

    # yt-dlp returns a playlist-shaped dict when a "song" is a mix/album; take
    # the first real entry in that case.
    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise HTTPException(status_code=502, detail="Track resolved to an empty playlist.")
        info = entries[0]

    # Prefer an m4a/aac progressive format (hardware decoders on Android love it)
    # and fall back to whatever URL yt-dlp picked as "best".
    formats = info.get("formats") or []
    audio_formats = [f for f in formats if f.get("url") and f.get("acodec") not in (None, "none")]
    audio_formats.sort(
        key=lambda f: (
            f.get("ext") != "m4a",
            -(f.get("abr") or f.get("tbr") or 0),
        )
    )
    stream_url = audio_formats[0]["url"] if audio_formats else info.get("url")
    if not stream_url:
        raise HTTPException(status_code=502, detail="Stream URL resolution failed.")

    thumbnails = info.get("thumbnails") or []
    payload = {
        "video_id": info.get("id") or video_id,
        "title": info.get("title") or "Alarm Song",
        "artist": info.get("artist") or info.get("creator") or info.get("uploader") or "YouTube Music",
        "stream_url": stream_url,
        "duration_ms": int((info.get("duration") or 0) * 1000),
        "thumbnail": thumbnails[-1]["url"] if thumbnails else "",
        "expires_in_ms": CACHE_TTL_SECONDS * 1000,
    }
    _cache_put(cache_key, payload)
    return payload


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "yt-alarm-backend",
        "version": APP_VERSION,
        "docs": "/docs",
        "endpoints": ["/health", "/get-alarm-audio", "/search"],
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "live",
        "service": "yt-alarm-backend",
        "version": APP_VERSION,
        "ytmusic_auth": YTMUSIC_MODE,
        "api_key_required": bool(ALARM_API_KEY),
    }


@app.get(
    "/debug/ytmusic",
    dependencies=[Depends(require_api_key)],
)
def debug_ytmusic() -> dict[str, Any]:
    """Which credential source loaded, and a live probe of each source."""
    probe: dict[str, Any] = {}
    try:
        probe["charts"] = bool(yt.get_charts(country=os.getenv("CHARTS_COUNTRY", "US")))
    except Exception as exc:  # noqa: BLE001
        probe["charts_error"] = str(exc)
    if YTMUSIC_MODE != "guest":
        try:
            probe["liked_songs"] = len((yt.get_liked_songs(limit=5) or {}).get("tracks") or [])
        except Exception as exc:  # noqa: BLE001
            probe["liked_songs_error"] = str(exc)
    return {"mode": YTMUSIC_MODE, "probe": probe}


@app.get("/get-alarm-audio", dependencies=[Depends(require_api_key)])
def get_alarm_audio(
    video_id: str | None = Query(
        default=None,
        description="Optional. Resolve this exact track instead of a random one.",
    ),
) -> dict[str, Any]:
    """Return a random playable track from the user's library with a direct URL."""
    if video_id:
        try:
            return resolve_stream(video_id)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Extraction error for %s: %s", video_id, exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    candidates = gather_candidates()
    if not candidates:
        raise HTTPException(
            status_code=503,
            detail=(
                "No tracks available. Set YTMUSIC_OAUTH_JSON (Liked Songs) "
                "or retry — the guest fallback hit YouTube's rate limit."
            ),
        )

    # Try a handful of random tracks before giving up: a single track can be
    # geo-blocked, age-restricted or removed.
    random.shuffle(candidates)
    last_error: Exception | None = None
    for track in candidates[: min(8, len(candidates))]:
        try:
            return resolve_stream(track["videoId"])
        except HTTPException as exc:
            if exc.status_code == 502:
                last_error = exc
                logger.warning("Skipping %s: %s", track["videoId"], exc.detail)
                continue
            raise
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            logger.warning("Skipping %s: %s", track["videoId"], exc)

    raise HTTPException(
        status_code=502,
        detail=f"Could not resolve any track. Last error: {last_error}",
    )


@app.get("/search", dependencies=[Depends(require_api_key)])
def search(
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=10, ge=1, le=25),
) -> dict[str, Any]:
    """Search for songs so the app can pin a specific track to an alarm."""
    try:
        results = yt.search(q, filter="songs", limit=limit) or []
    except Exception as exc:  # noqa: BLE001
        logger.error("Search failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "results": [
            {
                "video_id": r.get("videoId"),
                "title": r.get("title"),
                "artist": _track_artist(r),
                "duration_ms": int((r.get("duration_seconds") or 0) * 1000),
                "thumbnail": (r.get("thumbnails") or [{}])[-1].get("url", ""),
            }
            for r in results
            if r.get("videoId")
        ]
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
    )

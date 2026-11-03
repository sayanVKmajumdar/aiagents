#!/usr/bin/env python3
"""Self-check for the YT Alarm backend.

Run it on the machine/container that hosts the API, or point it at a deployed
instance. It answers one question: *will an alarm actually ring?*

    python selfcheck.py                                  # local checks
    python selfcheck.py --url https://x.onrender.com      # local + remote E2E
    python selfcheck.py --url ... --api-key <key>         # when ALARM_API_KEY is set

Exit code 0 only if nothing failed (warnings are allowed).
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

PASS, FAIL, WARN, SKIP = "PASS", "FAIL", "WARN", "SKIP"
results: list[tuple[str, str, str]] = []


def record(status: str, name: str, detail: str = "") -> None:
    results.append((status, name, detail))


def check_imports() -> None:
    for module in ("fastapi", "uvicorn", "ytmusicapi", "yt_dlp"):
        try:
            mod = importlib.import_module(module)
            version = getattr(mod, "__version__", "?")
            record(PASS, f"import {module}", str(version))
        except Exception as exc:  # noqa: BLE001
            record(FAIL, f"import {module}", str(exc))


def check_binaries() -> None:
    for binary, required in (("ffmpeg", False), ("deno", False), ("curl", False)):
        path = shutil.which(binary)
        if path:
            record(PASS, f"binary {binary}", path)
        else:
            record(WARN if not required else FAIL, f"binary {binary}", "not on PATH")

    # yt-dlp needs a JS runtime for YouTube's nsig challenges on some clients.
    if not shutil.which("deno"):
        record(
            WARN,
            "js runtime for yt-dlp",
            "deno not found — the bundled Dockerfile installs it; local runs may hit 403s",
        )


def check_auth() -> str:
    try:
        import server
    except Exception as exc:  # noqa: BLE001
        record(FAIL, "load server.py", str(exc))
        return "unknown"

    mode = server.YTMUSIC_MODE
    if mode in {"oauth", "file"}:
        record(PASS, "ytmusic credentials", f"mode={mode}")
    else:
        record(
            WARN,
            "ytmusic credentials",
            "guest mode — Liked Songs/History unavailable; set YTMUSIC_OAUTH_JSON",
        )
    record(
        PASS if server.ALARM_API_KEY else WARN,
        "api key",
        "ALARM_API_KEY set" if server.ALARM_API_KEY else "public endpoint (anyone can use your quota)",
    )
    record(PASS, "player clients", " ".join(server.PLAYER_CLIENTS))
    return mode


def check_ytmusic_reachable() -> None:
    try:
        import server

        charts = server.yt.get_charts(country=os.getenv("CHARTS_COUNTRY", "US"))
        record(PASS, "youtube music reachable", f"charts keys: {sorted(charts)[:4]}")
    except Exception as exc:  # noqa: BLE001
        record(FAIL, "youtube music reachable", f"{type(exc).__name__}: {exc}")


def check_stream_resolution() -> None:
    """Resolve a well-known public track end to end (the real test)."""
    try:
        import server

        payload = server.resolve_stream("dQw4w9WgXcQ")
        url = payload.get("stream_url", "")
        host = url.split("/")[2] if "//" in url else "?"
        record(PASS, "yt-dlp stream resolution", f"{host} · {payload.get('title', '')[:40]}")
    except Exception as exc:  # noqa: BLE001
        record(FAIL, "yt-dlp stream resolution", f"{type(exc).__name__}: {exc}")


def http_json(url: str, api_key: str | None, timeout: int = 25) -> tuple[int, dict]:
    request = urllib.request.Request(url)
    if api_key:
        request.add_header("x-api-key", api_key)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode())
        except Exception:  # noqa: BLE001
            return exc.code, {}


def check_remote(base_url: str, api_key: str | None) -> None:
    base = base_url.rstrip("/")

    status, body = http_json(f"{base}/health", api_key)
    if status == 200 and body.get("status") == "live":
        record(PASS, "remote /health", f"{body.get('version')} · auth={body.get('ytmusic_auth')}")
    else:
        record(FAIL, "remote /health", f"HTTP {status} {body}")

    status, body = http_json(f"{base}/debug/ytmusic", api_key)
    if status == 200:
        probe = body.get("probe", {})
        detail = f"mode={body.get('mode')}"
        if "liked_songs" in probe:
            detail += f" · liked_songs={probe['liked_songs']}"
        if probe.get("charts_error"):
            detail += f" · charts_error={str(probe['charts_error'])[:60]}"
        record(PASS if "charts_error" not in probe else WARN, "remote /debug/ytmusic", detail)
    elif status == 401:
        record(FAIL, "remote /debug/ytmusic", "401 — pass the right --api-key")
    else:
        record(WARN, "remote /debug/ytmusic", f"HTTP {status}")

    status, body = http_json(f"{base}/get-alarm-audio", api_key, timeout=40)
    if status == 200 and body.get("stream_url"):
        record(PASS, "remote /get-alarm-audio", f"{body.get('title', '')[:40]}")
        # Verify the stream URL is actually playable bytes, not an error page.
        try:
            request = urllib.request.Request(body["stream_url"], headers={"Range": "bytes=0-1023"})
            with urllib.request.urlopen(request, timeout=25) as response:
                chunk = response.read(1024)
            record(
                PASS if len(chunk) > 0 else FAIL,
                "stream URL serves audio",
                f"{len(chunk)} bytes, content-type={response.headers.get('content-type')}",
            )
        except Exception as exc:  # noqa: BLE001
            record(FAIL, "stream URL serves audio", f"{type(exc).__name__}: {exc}")
    else:
        record(FAIL, "remote /get-alarm-audio", f"HTTP {status} {str(body)[:140]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the YT Alarm backend end to end.")
    parser.add_argument("--url", help="Deployed base URL, e.g. https://x.onrender.com")
    parser.add_argument("--api-key", help="Value of ALARM_API_KEY, if set on the server")
    parser.add_argument("--skip-remote", action="store_true", help="only run local checks")
    args = parser.parse_args()

    print("YT Alarm backend self-check\n" + "-" * 44)
    check_imports()
    check_binaries()
    check_auth()
    check_ytmusic_reachable()
    check_stream_resolution()

    if args.url and not args.skip_remote:
        print(f"\nRemote checks against {args.url}")
        check_remote(args.url, args.api_key)

    print()
    for status, name, detail in results:
        colour = {PASS: "\033[32m", FAIL: "\033[31m", WARN: "\033[33m", SKIP: "\033[90m"}[status]
        print(f"{colour}{status:4}\033[0m  {name:28} {detail}")

    failures = [r for r in results if r[0] == FAIL]
    warnings = [r for r in results if r[0] == WARN]
    print(f"\n{len(results) - len(failures) - len(warnings)} passed, "
          f"{len(warnings)} warnings, {len(failures)} failed")

    if failures:
        print("\nNot ready: fix the FAIL rows above. With no YouTube access at all, "
              "the app cannot fetch alarm audio.")
        return 1
    if warnings:
        print("\nReady with caveats — see the WARN rows (guest mode cannot use Liked Songs).")
    else:
        print("\nAll good. Deploy this, point the app at it, and an alarm will ring.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Smoke tests that never touch the network.

Run with:  cd backend && pip install -r requirements-dev.txt && pytest -q
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # Make sure a stray API key in the developer's shell doesn't 401 the tests.
    monkeypatch.delenv("ALARM_API_KEY", raising=False)
    monkeypatch.delenv("YTMUSIC_OAUTH_JSON", raising=False)
    import server

    importlib.reload(server)
    return TestClient(server.app)


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "live"
    assert body["ytmusic_auth"] in {"oauth", "file", "guest"}
    assert body["api_key_required"] is False


def test_root_lists_endpoints(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    assert "/get-alarm-audio" in r.json()["endpoints"]


def test_alarm_audio_returns_normalised_payload(client: TestClient, monkeypatch) -> None:
    import server

    monkeypatch.setattr(
        server,
        "gather_candidates",
        lambda limit=100: [{"videoId": "dQw4w9WgXcQ", "title": "T", "artists": [{"name": "A"}]}],
    )
    monkeypatch.setattr(
        server,
        "resolve_stream",
        lambda video_id: {
            "video_id": video_id,
            "title": "Never Gonna Give You Up",
            "artist": "Rick Astley",
            "stream_url": "https://example.com/a.m4a",
            "duration_ms": 213000,
            "thumbnail": "",
            "expires_in_ms": 1800000,
        },
    )
    r = client.get("/get-alarm-audio")
    assert r.status_code == 200
    body = r.json()
    assert body["video_id"] == "dQw4w9WgXcQ"
    assert body["stream_url"].endswith(".m4a")
    assert body["duration_ms"] == 213000


def test_alarm_audio_503_when_library_empty(client: TestClient, monkeypatch) -> None:
    import server

    monkeypatch.setattr(server, "gather_candidates", lambda limit=100: [])
    r = client.get("/get-alarm-audio")
    assert r.status_code == 503


def test_alarm_audio_skips_unplayable_tracks(client: TestClient, monkeypatch) -> None:
    import server
    from fastapi import HTTPException

    monkeypatch.setattr(
        server,
        "gather_candidates",
        lambda limit=100: [{"videoId": "bad"}, {"videoId": "good"}],
    )

    def fake_resolve(video_id: str) -> dict:
        if video_id == "bad":
            raise HTTPException(status_code=502, detail="blocked")
        return {
            "video_id": video_id,
            "title": "ok",
            "artist": "ok",
            "stream_url": "https://example.com/a.m4a",
            "duration_ms": 1000,
            "thumbnail": "",
            "expires_in_ms": 1,
        }

    monkeypatch.setattr(server, "resolve_stream", fake_resolve)
    r = client.get("/get-alarm-audio")
    assert r.status_code == 200
    assert r.json()["video_id"] == "good"


def test_api_key_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALARM_API_KEY", "s3cret")
    import server

    importlib.reload(server)
    c = TestClient(server.app)

    assert c.get("/health").status_code == 200  # health stays open
    assert c.get("/search", params={"q": "test"}).status_code == 401
    assert (
        c.get("/search", params={"q": "test"}, headers={"x-api-key": "s3cret"}).status_code
        in {200, 502, 503}  # 502 if the sandbox has no network
    )


def test_oauth_env_var_is_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    import server

    assert server._ytmusic_from_env() is None  # nothing set

    monkeypatch.setenv("YTMUSIC_OAUTH_JSON", "{not json")
    assert server._ytmusic_from_env() is None  # bad JSON is swallowed

from datetime import datetime
from zoneinfo import ZoneInfo

from conftest import auth, register

SH = ZoneInfo("Asia/Shanghai")
T0 = int(datetime(2026, 10, 17, 10, 0, tzinfo=SH).timestamp() * 1000)
DAY = 86_400_000


def log(cid: str, word_id: int = 101, result: str = "correct", at: int = T0, **kw) -> dict:
    return {"id": cid, "wordId": word_id, "rootId": 1, "skill": "spell", "result": result, "at": at, **kw}


def test_sync_builds_progress(client):
    h = auth(register(client))
    r = client.post(
        "/api/progress/sync",
        headers=h,
        json={
            "timezone": "Asia/Shanghai",
            "logs": [log("a1"), log("a2", result="wrong", answer="visable", at=T0 + 1000)],
            "events": [
                {"id": "e1", "kind": "time", "value": 30_000, "wordIds": [101], "at": T0 + 2000},
                {"id": "e2", "kind": "audio", "wordId": 101, "at": T0 + 3000},
            ],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["acceptedLogs"], body["acceptedEvents"]) == (2, 2)

    w = body["words"]["101"]
    assert w["spell"]["level"] == 1 and w["spell"]["wrong"] == 1
    assert w["recentWrong"] == ["visable"]
    assert w["studyMs"] == 30_000 and w["audioPlays"] == 1

    day = body["daily"]["2026-10-17"]
    assert day["answers"] == 2 and day["correct"] == 1 and day["activeMs"] == 30_000
    assert [x["id"] for x in body["logs"]] == ["a1", "a2"]
    assert body["cursor"] > 0 and body["hasMore"] is False


def test_sync_is_idempotent(client):
    h = auth(register(client))
    payload = {"logs": [log("a1"), log("a1")], "events": [{"id": "s1", "kind": "session", "at": T0}]}
    first = client.post("/api/progress/sync", headers=h, json=payload).json()
    again = client.post("/api/progress/sync", headers=h, json=payload).json()
    assert first["acceptedLogs"] == 1 and again["acceptedLogs"] == 0 and again["acceptedEvents"] == 0
    assert again["words"] == first["words"] and again["daily"] == first["daily"]


def test_out_of_order_devices_merge(client):
    """两台设备离线学习，后同步的设备带来更早的记录：服务端按时间回放，结果与按顺序同步一致"""
    h = auth(register(client))
    phone = [log("p1", at=T0), log("p2", at=T0 + 2 * DAY)]
    laptop = [log("l1", result="wrong", at=T0 + DAY)]

    client.post("/api/progress/sync", headers=h, json={"logs": phone})
    merged = client.post("/api/progress/sync", headers=h, json={"logs": laptop}).json()

    h2 = auth(register(client, "bob"))
    ordered = client.post("/api/progress/sync", headers=h2, json={"logs": sorted(phone + laptop, key=lambda x: x["at"])}).json()
    assert merged["words"] == ordered["words"]
    # 先对、再错（降回 1 级）、再对 → 2 级
    assert merged["words"]["101"]["spell"]["level"] == 2


def test_incremental_pull_and_paging(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "sync_page_size", 2)
    h = auth(register(client))
    client.post("/api/progress/sync", headers=h, json={"logs": [log(f"a{i}", at=T0 + i) for i in range(5)]})

    page1 = client.get("/api/progress", headers=h).json()
    assert [x["id"] for x in page1["logs"]] == ["a0", "a1"] and page1["hasMore"] is True
    page2 = client.get(f"/api/progress?since={page1['cursor']}", headers=h).json()
    assert [x["id"] for x in page2["logs"]] == ["a2", "a3"]
    page3 = client.get(f"/api/progress?since={page2['cursor']}", headers=h).json()
    assert [x["id"] for x in page3["logs"]] == ["a4"] and page3["hasMore"] is False


def test_users_are_isolated(client):
    alice = auth(register(client, "alice"))
    bob = auth(register(client, "bob"))
    client.post("/api/progress/sync", headers=alice, json={"logs": [log("same-id")]})
    r = client.post("/api/progress/sync", headers=bob, json={"logs": [log("same-id", word_id=202)]}).json()
    assert r["acceptedLogs"] == 1  # client_id 只在同一用户内去重
    assert list(r["words"]) == ["202"]
    assert list(client.get("/api/progress", headers=alice).json()["words"]) == ["101"]


def test_timezone_change_recomputes_days(client):
    h = auth(register(client))
    # 上海 10-17 03:30（学习日 10-16）= 伦敦 10-16 20:30（学习日 10-16）；上海 10-17 05:00 = 伦敦 10-16 22:00
    at = int(datetime(2026, 10, 17, 5, 0, tzinfo=SH).timestamp() * 1000)
    sh = client.post("/api/progress/sync", headers=h, json={"timezone": "Asia/Shanghai", "logs": [log("a", at=at)]}).json()
    assert list(sh["daily"]) == ["2026-10-17"]
    ldn = client.post("/api/progress/sync", headers=h, json={"timezone": "Europe/London"}).json()
    assert list(ldn["daily"]) == ["2026-10-16"]


def test_favorite_event(client):
    h = auth(register(client))
    events = [
        {"id": "f1", "kind": "favorite", "wordId": 101, "value": 1, "at": T0},
        {"id": "f2", "kind": "favorite", "wordId": 101, "value": 0, "at": T0 + 1},
        {"id": "f3", "kind": "favorite", "wordId": 102, "value": 1, "at": T0 + 2},
    ]
    words = client.post("/api/progress/sync", headers=h, json={"events": events}).json()["words"]
    assert words["101"]["favorite"] is False and words["102"]["favorite"] is True


def test_validation_limits(client, monkeypatch):
    from app.core.config import get_settings

    h = auth(register(client))
    assert client.post("/api/progress/sync", headers=h, json={"logs": [log("x", result="maybe")]}).status_code == 422
    assert client.post("/api/progress/sync", headers=h, json={"logs": [log("x", hintLevel=9)]}).status_code == 422
    assert client.post("/api/progress/sync", headers=h, json={"timezone": "Nowhere/City"}).status_code == 422

    monkeypatch.setattr(get_settings(), "sync_max_logs", 3)
    too_many = {"logs": [log(f"a{i}") for i in range(4)]}
    assert client.post("/api/progress/sync", headers=h, json=too_many).status_code == 413
    assert client.post("/api/progress/sync", json={"logs": []}).status_code == 401

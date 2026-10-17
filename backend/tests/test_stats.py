import time

from conftest import auth, register

DAY = 86_400_000


def now_ms() -> int:
    return int(time.time() * 1000)


def seed_vocab(client, h) -> list[int]:
    root = {
        "rootText": "vis",
        "meaning": "看",
        "words": [{"word": w, "chineseMeaning": "释义"} for w in ("visible", "visit", "evidence")],
    }
    return [w["wordId"] for w in client.post("/api/vocab/roots", headers=h, json=root).json()["words"]]


def log(cid, word_id, result, at, skill="spell", answer=None):
    return {"id": cid, "wordId": word_id, "rootId": 1, "skill": skill, "result": result, "at": at, "answer": answer}


def test_dashboard(client):
    h = auth(register(client))
    w1, w2, _ = seed_vocab(client, h)
    t = now_ms()
    logs = [log("y1", w1, "correct", t - DAY), log("t1", w1, "correct", t), log("t2", w2, "wrong", t, answer="vist")]
    client.post("/api/progress/sync", headers=h, json={"logs": logs, "events": [{"id": "e", "kind": "time", "value": 120_000, "at": t}]})

    d = client.get("/api/stats/dashboard", headers=h).json()
    assert d["streak"] == {"current": 2, "longest": 2}
    assert d["overview"] == {
        "total": 3,
        "mastered": 0,
        "learning": 2,
        "fresh": 1,
        "totalMinutes": 2,
        "totalAnswers": 3,
        "accuracy": 2 / 3,
    }
    assert d["today"]["minutes"] == 2 and d["today"]["answers"] == 2 and d["today"]["newWords"] == 1
    assert len(d["trend7"]) == 7 and d["trend7"][-1]["words"] == 2
    assert sum(d["dueForecast7"]) == 2


def test_due_and_difficult(client):
    h = auth(register(client))
    w1, w2, w3 = seed_vocab(client, h)
    t = now_ms()
    logs = [log("old", w1, "correct", t - 3 * DAY)]  # 1 级，已过期
    logs += [log(f"bad{i}", w2, "wrong", t - i, answer="vizit" if i < 2 else "visitt") for i in range(3)]
    logs += [log("ok", w3, "correct", t)]
    client.post("/api/progress/sync", headers=h, json={"logs": logs})

    due = client.get("/api/stats/due", headers=h).json()
    assert [d["word"] for d in due] == ["visible"]

    diff = client.get("/api/stats/difficult", headers=h).json()
    assert [d["word"] for d in diff] == ["visit"]
    assert diff[0]["wrong"] == 3 and diff[0]["commonMistake"] == {"answer": "vizit", "count": 2}

    roots = client.get("/api/stats/roots", headers=h).json()
    assert roots[0]["learning"] == 3 and roots[0]["due"] == 1

    assert len(client.get("/api/stats/hourly", headers=h).json()) == 24
    assert len(client.get("/api/stats/trend?days=30", headers=h).json()) == 30
    assert client.get("/api/stats/trend?days=0", headers=h).status_code == 422

from conftest import auth, register

ROOT = {
    "rootText": "vis / vid",
    "meaning": "看",
    "words": [
        {"word": "visible", "chineseMeaning": "adj. 可见的", "phoneticAudio": "https://dict.youdao.com/dictvoice?audio=visible"},
        {"word": "visit", "chineseMeaning": "v. 拜访", "sortOrder": 1},
    ],
}


def test_admin_crud(client):
    admin = auth(register(client, "admin"))
    r = client.post("/api/vocab/roots", headers=admin, json=ROOT)
    assert r.status_code == 201, r.text
    root = r.json()
    assert [w["word"] for w in root["words"]] == ["visible", "visit"]
    root_id, word_id = root["id"], root["words"][0]["wordId"]

    assert client.patch(f"/api/vocab/roots/{root_id}", headers=admin, json={"meaning": "看见"}).json()["meaning"] == "看见"
    w = client.post(f"/api/vocab/roots/{root_id}/words", headers=admin, json={"word": "vision", "chineseMeaning": "n. 视力"})
    assert w.status_code == 201
    assert client.patch(f"/api/vocab/words/{word_id}", headers=admin, json={"phonetic": "/ˈvɪzəbl/"}).json()["phonetic"] == "/ˈvɪzəbl/"

    brief = client.get("/api/vocab/roots/brief", headers=admin).json()
    assert brief == [{"id": root_id, "rootText": "vis / vid", "meaning": "看见", "sortOrder": 0, "wordCount": 3}]

    assert client.delete(f"/api/vocab/words/{word_id}", headers=admin).status_code == 204
    assert client.delete(f"/api/vocab/roots/{root_id}", headers=admin).status_code == 204
    assert client.get(f"/api/vocab/roots/{root_id}", headers=admin).status_code == 404


def test_normal_user_read_only(client):
    admin = auth(register(client, "admin"))
    user = auth(register(client, "bob"))
    root_id = client.post("/api/vocab/roots", headers=admin, json=ROOT).json()["id"]

    assert client.get("/api/vocab/roots", headers=user).status_code == 200
    assert client.post("/api/vocab/roots", headers=user, json=ROOT).status_code == 403
    assert client.patch(f"/api/vocab/roots/{root_id}", headers=user, json={"meaning": "x"}).status_code == 403
    assert client.delete(f"/api/vocab/roots/{root_id}", headers=user).status_code == 403
    assert client.get("/api/vocab/roots").status_code == 401


def test_reject_unsafe_audio_url(client):
    admin = auth(register(client, "admin"))
    bad = {**ROOT, "words": [{"word": "x", "chineseMeaning": "y", "exampleAudio": "javascript:alert(1)"}]}
    assert client.post("/api/vocab/roots", headers=admin, json=bad).status_code == 422


def test_import_append_and_replace(client):
    admin = auth(register(client, "admin"))
    client.post("/api/vocab/import", headers=admin, json={"roots": [ROOT]})
    r = client.post("/api/vocab/import", headers=admin, json={"roots": [ROOT, {**ROOT, "rootText": "path"}]})
    assert len(r.json()) == 3

    r = client.post("/api/vocab/import", headers=admin, json={"mode": "replace", "roots": [{**ROOT, "rootText": "loqu"}]})
    assert [x["rootText"] for x in r.json()] == ["loqu"]
    assert len(client.get("/api/vocab/roots", headers=admin).json()[0]["words"]) == 2

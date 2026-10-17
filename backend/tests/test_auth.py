from conftest import auth, register

from app.api.auth import REFRESH_COOKIE


def test_register_login_me(client):
    token = register(client, "alice")
    me = client.get("/api/auth/me", headers=auth(token)).json()
    assert me["username"] == "alice"
    assert me["isAdmin"] is True  # 第一个用户自动成为管理员
    assert me["dailyNewGoal"] == 10

    bob = register(client, "bob")
    assert client.get("/api/auth/me", headers=auth(bob)).json()["isAdmin"] is False

    r = client.post("/api/auth/login", json={"username": "alice", "password": "secret123"})
    assert r.status_code == 200
    assert r.json()["tokenType"] == "bearer"


def test_register_validation(client):
    register(client, "alice")
    assert client.post("/api/auth/register", json={"username": "alice", "password": "secret123"}).status_code == 409
    assert client.post("/api/auth/register", json={"username": "ab", "password": "secret123"}).status_code == 422
    assert client.post("/api/auth/register", json={"username": "carol", "password": "short1"}).status_code == 422
    assert client.post("/api/auth/register", json={"username": "carol", "password": "onlyletters"}).status_code == 422
    assert client.post("/api/auth/register", json={"username": "小明", "password": "secret123"}).status_code == 422
    assert client.post("/api/auth/register", json={"username": "小明同学", "password": "secret123"}).status_code == 201

    # 昵称全是空白时回退为用户名
    dave = client.post("/api/auth/register", json={"username": "dave", "password": "secret123", "nickname": "   "}).json()
    assert client.get("/api/auth/me", headers=auth(dave["accessToken"])).json()["nickname"] == "dave"


def test_wrong_password_same_message_as_unknown_user(client):
    register(client, "alice")
    a = client.post("/api/auth/login", json={"username": "alice", "password": "wrong1234"})
    b = client.post("/api/auth/login", json={"username": "nobody", "password": "wrong1234"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_login_rate_limit(client):
    register(client, "alice")
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": "alice", "password": "bad12345"}).status_code == 401
    r = client.post("/api/auth/login", json={"username": "alice", "password": "secret123"})
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=auth("garbage")).status_code == 401


def test_refresh_rotation_and_reuse_detection(client):
    register(client, "alice")
    old = client.cookies.get(REFRESH_COOKIE)
    assert old

    r = client.post("/api/auth/refresh")
    assert r.status_code == 200
    new = client.cookies.get(REFRESH_COOKIE)
    assert new and new != old

    # 重放已轮换掉的旧 token：判定为盗用，作废该用户所有 token
    client.cookies.set(REFRESH_COOKIE, old, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401
    client.cookies.set(REFRESH_COOKIE, new, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401


def test_logout_revokes_refresh(client):
    register(client, "alice")
    token = client.cookies.get(REFRESH_COOKIE)
    assert client.post("/api/auth/logout").status_code == 204
    client.cookies.set(REFRESH_COOKIE, token, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401


def test_update_settings_and_change_password(client):
    token = register(client, "alice")
    r = client.patch("/api/auth/me", headers=auth(token), json={"dailyNewGoal": 20, "timezone": "Europe/London"})
    assert r.status_code == 200
    assert r.json()["dailyNewGoal"] == 20
    assert client.patch("/api/auth/me", headers=auth(token), json={"timezone": "Mars/Base"}).status_code == 422
    assert client.patch("/api/auth/me", headers=auth(token), json={"dailyNewGoal": 0}).status_code == 422

    r = client.patch("/api/auth/me", headers=auth(token), json={"nickname": "  小艾  "})
    assert r.status_code == 200
    assert r.json()["nickname"] == "小艾"
    assert client.patch("/api/auth/me", headers=auth(token), json={"nickname": "   "}).status_code == 422
    assert client.patch("/api/auth/me", headers=auth(token), json={"nickname": "x" * 33}).status_code == 422

    bad = client.post("/api/auth/change-password", headers=auth(token), json={"oldPassword": "nope", "newPassword": "newpass123"})
    assert bad.status_code == 400
    ok = client.post("/api/auth/change-password", headers=auth(token), json={"oldPassword": "secret123", "newPassword": "newpass123"})
    assert ok.status_code == 204
    assert client.post("/api/auth/login", json={"username": "alice", "password": "secret123"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "alice", "password": "newpass123"}).status_code == 200

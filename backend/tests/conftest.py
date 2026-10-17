"""测试配置：默认使用 SQLite 内存库，设置 TEST_DATABASE_URL 可改为在 MySQL 测试库上运行"""

import os

os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:"))
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
os.environ.setdefault("ALLOW_REGISTRATION", "true")

from collections.abc import Iterator  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.database import Base, get_db  # noqa: E402
from app.core.ratelimit import login_limiter  # noqa: E402
from app.main import app  # noqa: E402


def _make_engine():
    url = os.environ["DATABASE_URL"]
    if url.startswith("sqlite"):
        eng = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)

        @event.listens_for(eng, "connect")
        def _fk_on(dbapi_conn, _):  # SQLite 默认不启用外键，级联删除需要它
            dbapi_conn.execute("PRAGMA foreign_keys=ON")

        return eng
    return create_engine(url, pool_pre_ping=True)


test_engine = _make_engine()
TestSession = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture(autouse=True)
def _fresh_db() -> Iterator[None]:
    Base.metadata.drop_all(test_engine)
    Base.metadata.create_all(test_engine)
    login_limiter.clear()
    yield


@pytest.fixture
def db():
    s = TestSession()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def client() -> Iterator[TestClient]:
    def _get_db():
        s = TestSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app, base_url="http://testserver") as c:
        yield c
    app.dependency_overrides.clear()


def register(client: TestClient, username: str = "alice", password: str = "secret123") -> str:
    r = client.post("/api/auth/register", json={"username": username, "password": password})
    assert r.status_code == 201, r.text
    return r.json()["accessToken"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}

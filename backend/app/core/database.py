from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    # 字符集由数据库默认值决定：建库时指定 utf8mb4（见 README），表会自动继承
    pass


def make_engine(url: str):
    # MySQL 默认 8 小时断开空闲连接，pool_pre_ping 在取连接时先探活
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("mysql"):
        kwargs |= {"pool_recycle": 3600, "pool_size": 10, "max_overflow": 20}
    return create_engine(url, **kwargs)


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

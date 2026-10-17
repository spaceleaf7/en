"""迁移脚本与模型一致性：执行全部迁移后，autogenerate 不应再检测到差异"""

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.core.database import Base

BACKEND = Path(__file__).resolve().parents[1]


def test_migrations_match_models(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{tmp_path / 'm.db'}"
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "database_url", url)
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(cfg, "head")

    engine = create_engine(url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    engine.dispose()
    assert diff == [], f"迁移与模型不一致：{diff}"

    command.downgrade(cfg, "base")

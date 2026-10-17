"""初始表结构：用户、认证、词库、学习日志与进度

Revision ID: 0001
Revises:
Create Date: 2026-10-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BigId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(32), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("nickname", sa.String(32), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("daily_new_goal", sa.SmallInteger(), nullable=False),
        sa.Column("daily_minutes_goal", sa.SmallInteger(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_refresh_token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    op.create_table(
        "roots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("root_text", sa.String(64), nullable=False),
        sa.Column("meaning", sa.String(255), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_roots_sort_order", "roots", ["sort_order"])

    op.create_table(
        "words",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("root_id", sa.Integer(), sa.ForeignKey("roots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("word", sa.String(64), nullable=False),
        sa.Column("phonetic", sa.String(128), nullable=False),
        sa.Column("phonetic_audio", sa.String(512), nullable=False),
        sa.Column("chinese_meaning", sa.String(255), nullable=False),
        sa.Column("breakdown", sa.String(255), nullable=False),
        sa.Column("example_sentence", sa.Text(), nullable=False),
        sa.Column("example_audio", sa.String(1024), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_words_root_id", "words", ["root_id"])
    op.create_index("ix_words_word", "words", ["word"])

    op.create_table(
        "review_logs",
        sa.Column("id", BigId, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("word_id", sa.Integer(), nullable=False),
        sa.Column("root_id", sa.Integer(), nullable=False),
        sa.Column("skill", sa.String(16), nullable=False),
        sa.Column("result", sa.String(16), nullable=False),
        sa.Column("answer", sa.String(255), nullable=True),
        sa.Column("hint_level", sa.SmallInteger(), nullable=False),
        sa.Column("response_ms", sa.Integer(), nullable=False),
        sa.Column("at", sa.BigInteger(), nullable=False),
        sa.UniqueConstraint("user_id", "client_id", name="uq_review_log_client"),
    )
    op.create_index("ix_review_logs_user_at", "review_logs", ["user_id", "at"])

    op.create_table(
        "study_events",
        sa.Column("id", BigId, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("word_id", sa.Integer(), nullable=True),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("word_ids", sa.JSON(), nullable=True),
        sa.Column("at", sa.BigInteger(), nullable=False),
        sa.UniqueConstraint("user_id", "client_id", name="uq_study_event_client"),
    )
    op.create_index("ix_study_events_user_at", "study_events", ["user_id", "at"])

    op.create_table(
        "word_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("word_id", sa.Integer(), nullable=False),
        sa.Column("root_id", sa.Integer(), nullable=False),
        sa.Column("spell", sa.JSON(), nullable=False),
        sa.Column("meaning", sa.JSON(), nullable=False),
        sa.Column("first_seen_at", sa.BigInteger(), nullable=False),
        sa.Column("mastered_at", sa.BigInteger(), nullable=True),
        sa.Column("study_ms", sa.BigInteger(), nullable=False),
        sa.Column("avg_response_ms", sa.Integer(), nullable=False),
        sa.Column("response_samples", sa.Integer(), nullable=False),
        sa.Column("audio_plays", sa.Integer(), nullable=False),
        sa.Column("hints_used", sa.Integer(), nullable=False),
        sa.Column("recent_wrong", sa.JSON(), nullable=False),
        sa.Column("favorite", sa.Boolean(), nullable=False),
        sa.Column("level", sa.SmallInteger(), nullable=False),
        sa.Column("next_review_at", sa.BigInteger(), nullable=True),
        sa.UniqueConstraint("user_id", "word_id", name="uq_word_progress"),
    )

    op.create_table(
        "daily_stats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.String(10), nullable=False),
        sa.Column("active_ms", sa.BigInteger(), nullable=False),
        sa.Column("new_words", sa.Integer(), nullable=False),
        sa.Column("reviewed_word_ids", sa.JSON(), nullable=False),
        sa.Column("mastered_words", sa.Integer(), nullable=False),
        sa.Column("answers", sa.Integer(), nullable=False),
        sa.Column("correct", sa.Integer(), nullable=False),
        sa.Column("audio_plays", sa.Integer(), nullable=False),
        sa.Column("sessions", sa.Integer(), nullable=False),
        sa.Column("first_at", sa.BigInteger(), nullable=False),
        sa.Column("last_at", sa.BigInteger(), nullable=False),
        sa.Column("hourly", sa.JSON(), nullable=False),
        sa.UniqueConstraint("user_id", "date", name="uq_daily_stats"),
    )


def downgrade() -> None:
    for table in (
        "daily_stats",
        "word_progress",
        "study_events",
        "review_logs",
        "words",
        "roots",
        "refresh_tokens",
        "users",
    ):
        op.drop_table(table)

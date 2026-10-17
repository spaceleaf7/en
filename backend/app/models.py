from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


# ───────────────────────── 用户与认证 ─────────────────────────


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    nickname: Mapped[str] = mapped_column(String(32), default="")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # 学习设置（与前端 StudySettings 对应）
    daily_new_goal: Mapped[int] = mapped_column(SmallInteger, default=10)
    daily_minutes_goal: Mapped[int] = mapped_column(SmallInteger, default=15)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Shanghai")


class RefreshToken(Base):
    """refresh token 只存 SHA-256 哈希；每次刷新轮换，旧 token 立即作废"""

    __tablename__ = "refresh_tokens"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_refresh_token_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ───────────────────────── 词库 ─────────────────────────


class Root(TimestampMixin, Base):
    __tablename__ = "roots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    root_text: Mapped[str] = mapped_column(String(64))
    meaning: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)

    words: Mapped[list["Word"]] = relationship(
        back_populates="root",
        order_by="Word.sort_order, Word.id",
        cascade="all, delete-orphan",
    )


class Word(TimestampMixin, Base):
    __tablename__ = "words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    root_id: Mapped[int] = mapped_column(ForeignKey("roots.id", ondelete="CASCADE"), index=True)
    word: Mapped[str] = mapped_column(String(64), index=True)
    phonetic: Mapped[str] = mapped_column(String(128), default="")
    phonetic_audio: Mapped[str] = mapped_column(String(512), default="")
    chinese_meaning: Mapped[str] = mapped_column(String(255))
    breakdown: Mapped[str] = mapped_column(String(255), default="")
    example_sentence: Mapped[str] = mapped_column(Text, default="")
    example_audio: Mapped[str] = mapped_column(String(1024), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    root: Mapped[Root] = relationship(back_populates="words")


# ───────────────────────── 学习数据 ─────────────────────────


class ReviewLog(Base):
    """作答日志：唯一真实数据源。id 由客户端生成，用于多设备同步去重"""

    __tablename__ = "review_logs"
    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_review_log_client"),
        Index("ix_review_logs_user_at", "user_id", "at"),
    )

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    client_id: Mapped[str] = mapped_column(String(64))
    word_id: Mapped[int] = mapped_column(Integer)
    root_id: Mapped[int] = mapped_column(Integer)
    skill: Mapped[str] = mapped_column(String(16))  # spell / meaning / self
    result: Mapped[str] = mapped_column(String(16))  # correct / wrong / skip
    answer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hint_level: Mapped[int] = mapped_column(SmallInteger, default=0)
    response_ms: Mapped[int] = mapped_column(Integer, default=0)
    at: Mapped[int] = mapped_column(BigInteger)  # 客户端毫秒时间戳


class StudyEvent(Base):
    """非作答类事件：有效学习时长、发音播放、打开页面、收藏切换。与日志一样按 client_id 去重"""

    __tablename__ = "study_events"
    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_study_event_client"),
        Index("ix_study_events_user_at", "user_id", "at"),
    )

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    client_id: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(16))  # time / audio / session / favorite
    word_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    value: Mapped[int] = mapped_column(Integer, default=0)  # time: 毫秒；favorite: 1 收藏 / 0 取消
    word_ids: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)  # time: 分摊的单词
    at: Mapped[int] = mapped_column(BigInteger)


class WordProgress(Base):
    """单词进度：由日志与事件回放得出的物化结果，便于查询与统计"""

    __tablename__ = "word_progress"
    __table_args__ = (UniqueConstraint("user_id", "word_id", name="uq_word_progress"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    word_id: Mapped[int] = mapped_column(Integer)
    root_id: Mapped[int] = mapped_column(Integer)
    # SkillState 以 JSON 存储：{correct, wrong, streak, level, lastReviewAt, nextReviewAt}
    spell: Mapped[dict] = mapped_column(JSON)
    meaning: Mapped[dict] = mapped_column(JSON)
    first_seen_at: Mapped[int] = mapped_column(BigInteger)
    mastered_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    study_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    avg_response_ms: Mapped[int] = mapped_column(Integer, default=0)
    response_samples: Mapped[int] = mapped_column(Integer, default=0)
    audio_plays: Mapped[int] = mapped_column(Integer, default=0)
    hints_used: Mapped[int] = mapped_column(Integer, default=0)
    recent_wrong: Mapped[list[str]] = mapped_column(JSON)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    # 便于统计接口直接用 SQL 筛选
    level: Mapped[int] = mapped_column(SmallInteger, default=0)  # min(spell.level, meaning.level)
    next_review_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class DailyStats(Base):
    __tablename__ = "daily_stats"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_daily_stats"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    date: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD 学习日
    active_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    new_words: Mapped[int] = mapped_column(Integer, default=0)
    reviewed_word_ids: Mapped[list[int]] = mapped_column(JSON)
    mastered_words: Mapped[int] = mapped_column(Integer, default=0)
    answers: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    audio_plays: Mapped[int] = mapped_column(Integer, default=0)
    sessions: Mapped[int] = mapped_column(Integer, default=0)
    first_at: Mapped[int] = mapped_column(BigInteger, default=0)
    last_at: Mapped[int] = mapped_column(BigInteger, default=0)
    hourly: Mapped[list[int]] = mapped_column(JSON)

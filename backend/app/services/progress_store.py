"""学习数据的持久化：写入日志 / 事件（按 client_id 去重），并回放重建单词进度与每日统计"""

from __future__ import annotations

from collections.abc import Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app import models
from app.core.config import get_settings
from app.services import progress_engine as engine


def user_tz(user: models.User) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(get_settings().default_timezone)


def _existing_client_ids(db: Session, model, user_id: int, client_ids: list[str]) -> set[str]:
    if not client_ids:
        return set()
    found: set[str] = set()
    # 分批查询，避免 IN 列表过长
    for i in range(0, len(client_ids), 500):
        chunk = client_ids[i : i + 500]
        rows = db.scalars(
            select(model.client_id).where(model.user_id == user_id, model.client_id.in_(chunk))
        )
        found.update(rows)
    return found


def insert_new(db: Session, model, user_id: int, items: Iterable[dict]) -> int:
    """插入 client_id 尚不存在的记录，返回实际新增条数。同一批次内重复的 client_id 只取第一条"""
    unique: dict[str, dict] = {}
    for item in items:
        unique.setdefault(item["client_id"], item)
    existing = _existing_client_ids(db, model, user_id, list(unique))
    rows = [{**item, "user_id": user_id} for cid, item in unique.items() if cid not in existing]
    if rows:
        db.execute(insert(model), rows)
    return len(rows)


def replay(db: Session, user: models.User) -> engine.ProgressState:
    """按时间顺序回放该用户的全部日志与事件"""
    state = engine.ProgressState(tz=user_tz(user))

    logs = db.execute(
        select(models.ReviewLog).where(models.ReviewLog.user_id == user.id).order_by(
            models.ReviewLog.at, models.ReviewLog.id
        )
    ).scalars()
    events = db.execute(
        select(models.StudyEvent).where(models.StudyEvent.user_id == user.id).order_by(
            models.StudyEvent.at, models.StudyEvent.id
        )
    ).scalars()

    # 归并两条有序序列；同一时刻先处理作答，保证时长 / 发音能分摊到刚学的单词上
    timeline = sorted(
        [(log.at, 0, log) for log in logs] + [(ev.at, 1, ev) for ev in events],
        key=lambda t: (t[0], t[1]),
    )
    root_of: dict[int, int] = {}
    for _, kind, item in timeline:
        if kind == 0:
            engine.record_answer(
                state,
                word_id=item.word_id,
                root_id=item.root_id,
                skill=item.skill,
                result=item.result,
                now=item.at,
                answer=item.answer,
                hint_level=item.hint_level,
                response_ms=item.response_ms,
            )
        elif item.kind == "time":
            engine.add_study_time(state, item.value, item.at, item.word_ids or [])
        elif item.kind == "audio":
            engine.record_audio_play(state, item.word_id, item.at)
        elif item.kind == "session":
            engine.record_session_start(state, item.at)
        elif item.kind == "favorite" and item.word_id is not None:
            if item.word_id not in root_of:
                root_of[item.word_id] = _root_of(db, item.word_id)
            engine.set_favorite(state, item.word_id, root_of[item.word_id], bool(item.value), item.at)
    return state


def _root_of(db: Session, word_id: int) -> int:
    return db.scalar(select(models.Word.root_id).where(models.Word.id == word_id)) or 0


def rebuild(db: Session, user: models.User) -> engine.ProgressState:
    """回放并覆盖写入 word_progress / daily_stats。调用方负责提交事务"""
    state = replay(db, user)

    db.execute(delete(models.WordProgress).where(models.WordProgress.user_id == user.id))
    db.execute(delete(models.DailyStats).where(models.DailyStats.user_id == user.id))

    word_rows = [
        {
            "user_id": user.id,
            "word_id": w.word_id,
            "root_id": w.root_id,
            "spell": w.spell,
            "meaning": w.meaning,
            "first_seen_at": w.first_seen_at,
            "mastered_at": w.mastered_at,
            "study_ms": w.study_ms,
            "avg_response_ms": w.avg_response_ms,
            "response_samples": w.response_samples,
            "audio_plays": w.audio_plays,
            "hints_used": w.hints_used,
            "recent_wrong": w.recent_wrong,
            "favorite": w.favorite,
            "level": w.level,
            "next_review_at": w.next_review_at,
        }
        for w in state.words.values()
    ]
    day_rows = [
        {
            "user_id": user.id,
            "date": d.date,
            "active_ms": d.active_ms,
            "new_words": d.new_words,
            "reviewed_word_ids": d.reviewed_word_ids,
            "mastered_words": d.mastered_words,
            "answers": d.answers,
            "correct": d.correct,
            "audio_plays": d.audio_plays,
            "sessions": d.sessions,
            "first_at": d.first_at,
            "last_at": d.last_at,
            "hourly": d.hourly,
        }
        for d in state.daily.values()
    ]
    if word_rows:
        db.execute(insert(models.WordProgress), word_rows)
    if day_rows:
        db.execute(insert(models.DailyStats), day_rows)
    return state


def lock_user(db: Session, user_id: int) -> models.User:
    """锁定用户行，串行化同一用户的并发同步，避免两次重建互相覆盖"""
    user = db.execute(
        select(models.User).where(models.User.id == user_id).with_for_update()
    ).scalar_one()
    return user


def count_logs(db: Session, user_id: int) -> int:
    return db.scalar(select(func.count()).select_from(models.ReviewLog).where(models.ReviewLog.user_id == user_id)) or 0

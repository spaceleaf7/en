"""学习进度同步。

客户端上报原始作答日志与学习事件（每条带客户端生成的唯一 id），服务端去重入库后
按时间顺序回放，重建该用户的单词进度与每日统计，并把权威结果返回给客户端覆盖本地。
同一批数据重复上报、多设备离线后先后同步，结果都一致。
"""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app import models, schemas
from app.api.auth import check_timezone
from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.services import progress_store

router = APIRouter(prefix="/progress", tags=["学习进度"])


def _snapshot(db: DbSession, user: models.User, since: int, accepted_logs: int, accepted_events: int) -> dict:
    s = get_settings()
    words = db.scalars(select(models.WordProgress).where(models.WordProgress.user_id == user.id))
    daily = db.scalars(select(models.DailyStats).where(models.DailyStats.user_id == user.id))
    logs = list(
        db.scalars(
            select(models.ReviewLog)
            .where(models.ReviewLog.user_id == user.id, models.ReviewLog.id > since)
            .order_by(models.ReviewLog.id)
            .limit(s.sync_page_size + 1)
        )
    )
    has_more = len(logs) > s.sync_page_size
    logs = logs[: s.sync_page_size]

    return {
        "accepted_logs": accepted_logs,
        "accepted_events": accepted_events,
        "words": {
            w.word_id: {
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
            }
            for w in words
        },
        "daily": {d.date: schemas.DailyStatsOut.model_validate(d) for d in daily},
        "settings": {"dailyNewGoal": user.daily_new_goal, "dailyMinutesGoal": user.daily_minutes_goal},
        "logs": [
            {
                "id": log.client_id,
                "word_id": log.word_id,
                "root_id": log.root_id,
                "skill": log.skill,
                "result": log.result,
                "answer": log.answer,
                "hint_level": log.hint_level,
                "response_ms": log.response_ms,
                "at": log.at,
            }
            for log in logs
        ],
        "cursor": logs[-1].id if logs else since,
        "has_more": has_more,
    }


@router.post("/sync", response_model=schemas.SyncOut)
def sync(body: schemas.SyncIn, user: CurrentUser, db: DbSession) -> dict:
    s = get_settings()
    if len(body.logs) > s.sync_max_logs or len(body.events) > s.sync_max_logs:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"单次最多同步 {s.sync_max_logs} 条日志和 {s.sync_max_logs} 条事件，请分批上传",
        )

    # 锁定用户行，串行化同一用户的并发同步
    user = progress_store.lock_user(db, user.id)

    tz_changed = False
    if body.timezone and body.timezone != user.timezone:
        check_timezone(body.timezone)
        user.timezone = body.timezone
        tz_changed = True

    accepted_logs = progress_store.insert_new(
        db,
        models.ReviewLog,
        user.id,
        (
            {
                "client_id": log.id,
                "word_id": log.word_id,
                "root_id": log.root_id,
                "skill": log.skill,
                "result": log.result,
                "answer": log.answer,
                "hint_level": log.hint_level,
                "response_ms": log.response_ms,
                "at": log.at,
            }
            for log in body.logs
        ),
    )
    accepted_events = progress_store.insert_new(
        db,
        models.StudyEvent,
        user.id,
        (
            {
                "client_id": ev.id,
                "kind": ev.kind,
                "word_id": ev.word_id,
                "value": ev.value,
                "word_ids": ev.word_ids,
                "at": ev.at,
            }
            for ev in body.events
        ),
    )

    # 只有数据变化（或时区变化导致学习日重新切分）时才回放重建
    if accepted_logs or accepted_events or tz_changed:
        progress_store.rebuild(db, user)
    db.commit()

    return _snapshot(db, user, body.since, accepted_logs, accepted_events)


@router.get("", response_model=schemas.SyncOut)
def get_progress(user: CurrentUser, db: DbSession, since: int = 0) -> dict:
    """只拉取不上传（例如换设备首次登录）"""
    return _snapshot(db, user, since, 0, 0)


@router.post("/rebuild", response_model=schemas.SyncOut)
def force_rebuild(user: CurrentUser, db: DbSession) -> dict:
    """规则调整后手动触发重算"""
    user = progress_store.lock_user(db, user.id)
    progress_store.rebuild(db, user)
    db.commit()
    return _snapshot(db, user, 0, 0, 0)

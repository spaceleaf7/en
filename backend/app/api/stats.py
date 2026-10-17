import time

from fastapi import APIRouter, Query
from sqlalchemy import select

from app import models
from app.api.deps import CurrentUser, DbSession
from app.services.stats import UserStats, accuracy, common_mistake

router = APIRouter(prefix="/stats", tags=["学习统计"])


def _now_ms() -> int:
    return int(time.time() * 1000)


def _all_word_ids(db: DbSession) -> list[int]:
    return list(db.scalars(select(models.Word.id)))


@router.get("/dashboard")
def dashboard(user: CurrentUser, db: DbSession) -> dict:
    """看板一次需要的全部指标"""
    st = UserStats(db, user, _now_ms())
    return {
        "today": st.today_progress(),
        "streak": st.streak(),
        "overview": st.overview(_all_word_ids(db)),
        "trend7": st.trend(7),
        "dueForecast7": st.due_forecast(7),
        "forgettingRate": st.forgetting_rate(),
    }


@router.get("/today")
def today(user: CurrentUser, db: DbSession) -> dict:
    st = UserStats(db, user, _now_ms())
    return {**st.today_progress(), "streak": st.streak()}


@router.get("/trend")
def trend(user: CurrentUser, db: DbSession, days: int = Query(30, ge=1, le=365)) -> list[dict]:
    return UserStats(db, user, _now_ms()).trend(days)


@router.get("/hourly")
def hourly(user: CurrentUser, db: DbSession) -> list[int]:
    return UserStats(db, user, _now_ms()).hourly()


@router.get("/forecast")
def forecast(user: CurrentUser, db: DbSession, days: int = Query(7, ge=1, le=60)) -> list[int]:
    return UserStats(db, user, _now_ms()).due_forecast(days)


@router.get("/due")
def due_words(user: CurrentUser, db: DbSession, limit: int = Query(100, ge=1, le=1000)) -> list[dict]:
    """今日待复习单词（含单词内容，可直接用于"今日复习"）"""
    ids = UserStats(db, user, _now_ms()).due_word_ids()[:limit]
    return _word_details(db, ids)


@router.get("/difficult")
def difficult_words(user: CurrentUser, db: DbSession, limit: int = Query(20, ge=1, le=200)) -> list[dict]:
    st = UserStats(db, user, _now_ms())
    words = st.difficult_words(limit)
    details = {d["wordId"]: d for d in _word_details(db, [p.word_id for p in words])}
    return [
        {
            **details.get(p.word_id, {"wordId": p.word_id}),
            "wrong": p.spell["wrong"] + p.meaning["wrong"],
            "correct": p.spell["correct"] + p.meaning["correct"],
            "accuracy": accuracy(p),
            "commonMistake": common_mistake(p),
        }
        for p in words
    ]


@router.get("/roots")
def roots_summary(user: CurrentUser, db: DbSession) -> list[dict]:
    """每个词根的掌握概况（翻页器 / 词根节点用）"""
    st = UserStats(db, user, _now_ms())
    roots = db.scalars(select(models.Root).order_by(models.Root.sort_order, models.Root.id))
    word_ids: dict[int, list[int]] = {}
    for wid, rid in db.execute(select(models.Word.id, models.Word.root_id)):
        word_ids.setdefault(rid, []).append(wid)
    return [{"rootId": r.id, "rootText": r.root_text, **st.root_summary(word_ids.get(r.id, []))} for r in roots]


def _word_details(db: DbSession, ids: list[int]) -> list[dict]:
    if not ids:
        return []
    rows = {
        w.id: w
        for w in db.scalars(select(models.Word).where(models.Word.id.in_(ids)))
    }
    return [
        {
            "wordId": w.id,
            "rootId": w.root_id,
            "word": w.word,
            "chineseMeaning": w.chinese_meaning,
            "phonetic": w.phonetic,
        }
        for i in ids
        if (w := rows.get(i)) is not None
    ]

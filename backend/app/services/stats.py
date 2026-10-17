"""统计指标：frontend/src/utils/stats.ts 的服务端实现，基于物化的 word_progress / daily_stats 计算"""

from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.services import progress_engine as engine
from app.services.progress_store import user_tz


def _day(key: str) -> date:
    return date.fromisoformat(key)


def _is_active(d: models.DailyStats | None) -> bool:
    return d is not None and (d.answers > 0 or d.active_ms >= 60_000)


def is_due(p: models.WordProgress, now: int) -> bool:
    return any(s["level"] > 0 and s["nextReviewAt"] <= now for s in (p.spell, p.meaning))


def accuracy(p: models.WordProgress) -> float | None:
    c = p.spell["correct"] + p.meaning["correct"]
    total = c + p.spell["wrong"] + p.meaning["wrong"]
    return None if total == 0 else c / total


def is_difficult(p: models.WordProgress) -> bool:
    wrong = p.spell["wrong"] + p.meaning["wrong"]
    total = wrong + p.spell["correct"] + p.meaning["correct"]
    return wrong >= 3 or (total >= 3 and (accuracy(p) or 0) < 0.6)


def is_mastered(p: models.WordProgress) -> bool:
    return p.spell["level"] >= engine.MASTERED_LEVEL and p.meaning["level"] >= engine.MASTERED_LEVEL


def common_mistake(p: models.WordProgress) -> dict | None:
    if not p.recent_wrong:
        return None
    answer, count = Counter(a.lower() for a in p.recent_wrong).most_common(1)[0]
    return {"answer": answer, "count": count}


class UserStats:
    """一次性加载用户的进度与每日数据，供各指标复用"""

    def __init__(self, db: Session, user: models.User, now: int) -> None:
        self.db = db
        self.user = user
        self.now = now
        self.tz: ZoneInfo = user_tz(user)
        self.words: dict[int, models.WordProgress] = {
            p.word_id: p
            for p in db.scalars(select(models.WordProgress).where(models.WordProgress.user_id == user.id))
        }
        self.daily: dict[str, models.DailyStats] = {
            d.date: d for d in db.scalars(select(models.DailyStats).where(models.DailyStats.user_id == user.id))
        }
        self.today = engine.study_day_key(now, self.tz)

    # ── 打卡 ──
    def streak(self) -> dict:
        today = _day(self.today)
        cursor = today if _is_active(self.daily.get(self.today)) else today - timedelta(days=1)
        current = 0
        while _is_active(self.daily.get(cursor.isoformat())):
            current += 1
            cursor -= timedelta(days=1)

        longest = run = 0
        prev: date | None = None
        for key in sorted(k for k, d in self.daily.items() if _is_active(d)):
            d = _day(key)
            run = run + 1 if prev and prev + timedelta(days=1) == d else 1
            longest = max(longest, run)
            prev = d
        return {"current": current, "longest": max(longest, current)}

    # ── 今日 ──
    def today_progress(self) -> dict:
        d = self.daily.get(self.today)
        new_goal = self.user.daily_new_goal
        minutes_goal = self.user.daily_minutes_goal
        new_words = d.new_words if d else 0
        minutes = (d.active_ms if d else 0) // 60_000

        def ratio(v: int, goal: int) -> float:
            return min(1.0, v / goal) if goal > 0 else 1.0

        return {
            "date": self.today,
            "newWords": new_words,
            "newGoal": new_goal,
            "minutes": minutes,
            "minutesGoal": minutes_goal,
            "reviewed": len(d.reviewed_word_ids) if d else 0,
            "answers": d.answers if d else 0,
            "accuracy": (d.correct / d.answers) if d and d.answers else None,
            "completion": (ratio(new_words, new_goal) + ratio(minutes, minutes_goal)) / 2,
            "due": len(self.due_word_ids()),
        }

    # ── 复习 ──
    def due_word_ids(self) -> list[int]:
        due = [p for p in self.words.values() if is_due(p, self.now)]
        due.sort(key=lambda p: min(p.spell["nextReviewAt"], p.meaning["nextReviewAt"]))
        return [p.word_id for p in due]

    def due_forecast(self, days: int) -> list[int]:
        forecast = [0] * days
        today_start = engine.study_day_start(self.now, self.tz)
        for p in self.words.values():
            if p.next_review_at is None:
                continue
            idx = max(0, (p.next_review_at - today_start) // engine.DAY_MS)
            if idx < days:
                forecast[idx] += 1
        return forecast

    # ── 趋势与分布 ──
    def trend(self, days: int) -> list[dict]:
        today = _day(self.today)
        out = []
        for i in range(days):
            key = (today - timedelta(days=days - 1 - i)).isoformat()
            d = self.daily.get(key)
            out.append(
                {
                    "date": key,
                    "minutes": engine.js_round((d.active_ms if d else 0) / 60_000),
                    "words": len(d.reviewed_word_ids) if d else 0,
                    "newWords": d.new_words if d else 0,
                    "accuracy": (d.correct / d.answers) if d and d.answers else None,
                }
            )
        return out

    def hourly(self) -> list[int]:
        total = [0] * 24
        for d in self.daily.values():
            for h, v in enumerate(d.hourly):
                total[h] += v
        return total

    # ── 概况 ──
    def overview(self, all_word_ids: list[int]) -> dict:
        mastered = learning = 0
        for wid in all_word_ids:
            p = self.words.get(wid)
            if p is None:
                continue
            if is_mastered(p):
                mastered += 1
            else:
                learning += 1
        answers = sum(d.answers for d in self.daily.values())
        correct = sum(d.correct for d in self.daily.values())
        return {
            "total": len(all_word_ids),
            "mastered": mastered,
            "learning": learning,
            "fresh": len(all_word_ids) - mastered - learning,
            "totalMinutes": engine.js_round(sum(d.active_ms for d in self.daily.values()) / 60_000),
            "totalAnswers": answers,
            "accuracy": correct / answers if answers else None,
        }

    def difficult_words(self, limit: int) -> list[models.WordProgress]:
        words = [p for p in self.words.values() if is_difficult(p)]
        words.sort(key=lambda p: -(p.spell["wrong"] + p.meaning["wrong"]))
        return words[:limit]

    def forgetting_rate(self) -> float | None:
        """按期复习（到期后才复习）的作答中答错的比例，回放日志计算"""
        logs = self.db.execute(
            select(models.ReviewLog.word_id, models.ReviewLog.skill, models.ReviewLog.result, models.ReviewLog.at)
            .where(models.ReviewLog.user_id == self.user.id)
            .order_by(models.ReviewLog.at, models.ReviewLog.id)
        )
        last: dict[tuple[int, str], int] = {}
        level: dict[tuple[int, str], int] = {}
        due = forgotten = 0
        for word_id, skill, result, at in logs:
            if skill == "self" or result == "skip":
                continue
            key = (word_id, skill)
            lv = level.get(key, 0)
            if key in last and lv > 0:
                due_at = engine.study_day_start(last[key], self.tz) + engine.REVIEW_INTERVAL_DAYS[lv] * engine.DAY_MS
                if at >= due_at:
                    due += 1
                    forgotten += result == "wrong"
            last[key] = at
            level[key] = 1 if result == "wrong" else min(5, lv + 1)
        return None if due == 0 else forgotten / due

    def root_summary(self, word_ids: list[int]) -> dict:
        s = {"total": len(word_ids), "mastered": 0, "learning": 0, "fresh": 0, "due": 0}
        for wid in word_ids:
            p = self.words.get(wid)
            if p is None:
                s["fresh"] += 1
                continue
            s["mastered" if is_mastered(p) else "learning"] += 1
            s["due"] += is_due(p, self.now)
        return s

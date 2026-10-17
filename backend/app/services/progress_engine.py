"""学习进度引擎：frontend/src/store/progressCore.ts 的 Python 实现。

两边的规则（熟练度升降、复习间隔、凌晨 4 点换日、掌握判定、每日汇总）必须完全一致，
由 tests/test_parity.py 用前端生成的同一组场景校验。修改规则时两处同时改。

服务端不直接接收客户端算好的进度，而是保存原始日志与事件，再按时间顺序回放得到进度，
因此多设备各自离线学习后合并也不会冲突。
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

Skill = Literal["spell", "meaning"]
LogSkill = Literal["spell", "meaning", "self"]
Result = Literal["correct", "wrong", "skip"]

DAY_MS = 24 * 60 * 60 * 1000
DAY_START_HOUR = 4
MASTERED_LEVEL = 4
REVIEW_INTERVAL_DAYS = {0: 0, 1: 1, 2: 2, 3: 4, 4: 7, 5: 15}
MAX_RECENT_WRONG = 5


# ───────────────────────── 学习日 ─────────────────────────


def _local(ts_ms: int, tz: ZoneInfo) -> datetime:
    return datetime.fromtimestamp(ts_ms / 1000, tz)


def study_day_key(ts_ms: int, tz: ZoneInfo) -> str:
    """学习日（YYYY-MM-DD），凌晨 4 点前算前一天"""
    return (_local(ts_ms, tz) - timedelta(hours=DAY_START_HOUR)).strftime("%Y-%m-%d")


def study_day_start(ts_ms: int, tz: ZoneInfo) -> int:
    """所在学习日开始（当天凌晨 4 点）的毫秒时间戳"""
    shifted = _local(ts_ms, tz) - timedelta(hours=DAY_START_HOUR)
    start = shifted.replace(hour=DAY_START_HOUR, minute=0, second=0, microsecond=0)
    return int(start.timestamp() * 1000)


def local_hour(ts_ms: int, tz: ZoneInfo) -> int:
    return _local(ts_ms, tz).hour


# ───────────────────────── 状态结构 ─────────────────────────


def new_skill_state() -> dict:
    # 键名与前端 SkillState 保持一致（camelCase），直接存入 JSON 列并原样返回给前端
    return {"correct": 0, "wrong": 0, "streak": 0, "level": 0, "lastReviewAt": 0, "nextReviewAt": 0}


@dataclass
class WordState:
    word_id: int
    root_id: int
    first_seen_at: int
    spell: dict = field(default_factory=new_skill_state)
    meaning: dict = field(default_factory=new_skill_state)
    mastered_at: int | None = None
    study_ms: int = 0
    avg_response_ms: int = 0
    response_samples: int = 0
    audio_plays: int = 0
    hints_used: int = 0
    recent_wrong: list[str] = field(default_factory=list)
    favorite: bool = False

    @property
    def mastered(self) -> bool:
        return self.spell["level"] >= MASTERED_LEVEL and self.meaning["level"] >= MASTERED_LEVEL

    @property
    def level(self) -> int:
        return min(self.spell["level"], self.meaning["level"])

    @property
    def next_review_at(self) -> int | None:
        """已学维度中最早的到期时间；都未学则为 None"""
        learned = [s["nextReviewAt"] for s in (self.spell, self.meaning) if s["level"] > 0]
        return min(learned) if learned else None


@dataclass
class DayState:
    date: str
    active_ms: int = 0
    new_words: int = 0
    reviewed_word_ids: list[int] = field(default_factory=list)
    mastered_words: int = 0
    answers: int = 0
    correct: int = 0
    audio_plays: int = 0
    sessions: int = 0
    first_at: int = 0
    last_at: int = 0
    hourly: list[int] = field(default_factory=lambda: [0] * 24)


@dataclass
class ProgressState:
    tz: ZoneInfo
    words: dict[int, WordState] = field(default_factory=dict)
    daily: dict[str, DayState] = field(default_factory=dict)

    def touch_day(self, now: int) -> DayState:
        key = study_day_key(now, self.tz)
        day = self.daily.get(key)
        if day is None:
            day = self.daily[key] = DayState(date=key)
        day.first_at = day.first_at or now
        day.last_at = now
        return day


# ───────────────────────── 规则 ─────────────────────────


def _schedule_next(level: int, now: int, tz: ZoneInfo) -> int:
    days = REVIEW_INTERVAL_DAYS[level]
    return now if days == 0 else study_day_start(now, tz) + days * DAY_MS


def apply_skill_result(prev: dict, result: Result, hint_level: int, now: int, tz: ZoneInfo) -> dict:
    """
    - 答对：升一级；看了答案（hint 3）不升级，首字母 / 听音（hint 1-2）仅在已连对时升级；新词答对总是升到 1 级
    - 答错：降回 1 级，连对清零
    - 跳过：只记录复习时间
    """
    nxt = copy.copy(prev)
    nxt["lastReviewAt"] = now

    if result == "correct":
        nxt["correct"] += 1
        nxt["streak"] += 1
        can_level_up = hint_level == 0 or (hint_level < 3 and prev["streak"] > 0)
        if can_level_up or prev["level"] == 0:
            nxt["level"] = min(5, prev["level"] + 1)
    elif result == "wrong":
        nxt["wrong"] += 1
        nxt["streak"] = 0
        nxt["level"] = 1

    nxt["nextReviewAt"] = _schedule_next(nxt["level"], now, tz)
    return nxt


def record_answer(
    state: ProgressState,
    *,
    word_id: int,
    root_id: int,
    skill: LogSkill,
    result: Result,
    now: int,
    answer: str | None = None,
    hint_level: int = 0,
    response_ms: int = 0,
) -> None:
    response_ms = max(0, response_ms)
    word = state.words.get(word_id)
    is_new = word is None
    if word is None:
        word = state.words[word_id] = WordState(word_id=word_id, root_id=root_id, first_seen_at=now)
    was_mastered = not is_new and word.mastered

    # 自评同时作用于两个维度
    for s in ("spell", "meaning") if skill == "self" else (skill,):
        setattr(word, s, apply_skill_result(getattr(word, s), result, hint_level, now, state.tz))

    if hint_level > 0:
        word.hints_used += 1
    if result == "wrong" and answer and answer.strip():
        word.recent_wrong = [answer.strip(), *word.recent_wrong][:MAX_RECENT_WRONG]
    if response_ms > 0:
        n = word.response_samples
        word.avg_response_ms = js_round((word.avg_response_ms * n + response_ms) / (n + 1))
        word.response_samples = n + 1

    now_mastered = word.mastered
    if now_mastered and not was_mastered:
        word.mastered_at = now
    if not now_mastered:
        word.mastered_at = None

    day = state.touch_day(now)
    day.answers += 1
    if result == "correct":
        day.correct += 1
    if is_new:
        day.new_words += 1
    if word_id not in day.reviewed_word_ids:
        day.reviewed_word_ids.append(word_id)
    if now_mastered and not was_mastered:
        day.mastered_words += 1
    day.hourly[local_hour(now, state.tz)] += 1


def add_study_time(state: ProgressState, ms: int, now: int, word_ids: list[int] | None = None) -> None:
    if ms <= 0:
        return
    day = state.touch_day(now)
    day.active_ms += ms
    tracked = [i for i in (word_ids or []) if i in state.words]
    if tracked:
        share = js_round(ms / len(tracked))
        for i in tracked:
            state.words[i].study_ms += share


def record_audio_play(state: ProgressState, word_id: int | None, now: int) -> None:
    state.touch_day(now).audio_plays += 1
    if word_id is not None and word_id in state.words:
        state.words[word_id].audio_plays += 1


def record_session_start(state: ProgressState, now: int) -> None:
    state.touch_day(now).sessions += 1


def set_favorite(state: ProgressState, word_id: int, root_id: int, favorite: bool, now: int) -> None:
    """服务端用"设置"而非"切换"，多设备重复同步同一事件时结果不变"""
    word = state.words.get(word_id)
    if word is None:
        word = state.words[word_id] = WordState(word_id=word_id, root_id=root_id, first_seen_at=now)
    word.favorite = favorite


def js_round(x: float) -> int:
    """与 JS Math.round 一致（.5 向正无穷取整），Python round() 是银行家舍入"""
    return math.floor(x + 0.5)

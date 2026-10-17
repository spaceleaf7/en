"""请求 / 响应模型。对外 JSON 字段统一用 camelCase，与前端类型保持一致"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ───────────────────────── 认证 ─────────────────────────

USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-一-鿿]{3,32}$")


def validate_password(v: str) -> str:
    if not (re.search(r"[A-Za-z]", v) and re.search(r"\d", v)):
        raise ValueError("密码至少 8 位，且需同时包含字母和数字")
    return v


def validate_audio_url(v: str | None) -> str | None:
    # 只允许 http(s) 音频地址，防止 javascript: 等协议被注入到前端
    if v and not re.match(r"^https?://", v, re.I):
        raise ValueError("音频地址必须以 http:// 或 https:// 开头")
    return v


class RegisterIn(CamelModel):
    username: str
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(default="", max_length=32)

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str) -> str:
        v = v.strip()
        if not USERNAME_RE.match(v):
            raise ValueError("用户名需为 3-32 位字母、数字、下划线、短横线或中文")
        return v

    @field_validator("password")
    @classmethod
    def _check_password(cls, v: str) -> str:
        return validate_password(v)

    @field_validator("nickname")
    @classmethod
    def _strip_nickname(cls, v: str) -> str:
        # 全空白视为未填写，注册时回退为用户名
        return v.strip()


class LoginIn(CamelModel):
    username: str = Field(max_length=32)
    password: str = Field(max_length=128)


class TokenOut(CamelModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class UserOut(CamelModel):
    id: int
    username: str
    nickname: str
    is_admin: bool
    daily_new_goal: int
    daily_minutes_goal: int
    timezone: str


class SettingsIn(CamelModel):
    nickname: str | None = Field(default=None, max_length=32)
    daily_new_goal: int | None = Field(default=None, ge=1, le=200)
    daily_minutes_goal: int | None = Field(default=None, ge=1, le=600)
    timezone: str | None = Field(default=None, max_length=64)

    @field_validator("nickname")
    @classmethod
    def _check_nickname(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("昵称不能为空")
        return v


class ChangePasswordIn(CamelModel):
    old_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _check_password(cls, v: str) -> str:
        return validate_password(v)


# ───────────────────────── 词库 ─────────────────────────


class WordBase(CamelModel):
    word: str = Field(min_length=1, max_length=64)
    phonetic: str = Field(default="", max_length=128)
    phonetic_audio: str = Field(default="", max_length=512)
    chinese_meaning: str = Field(min_length=1, max_length=255)
    breakdown: str = Field(default="", max_length=255)
    example_sentence: str = Field(default="", max_length=2000)
    example_audio: str = Field(default="", max_length=1024)
    sort_order: int = 0

    @field_validator("phonetic_audio", "example_audio")
    @classmethod
    def _check_url(cls, v: str) -> str | None:
        return validate_audio_url(v)


class WordIn(WordBase):
    pass


class WordUpdate(CamelModel):
    word: str | None = Field(default=None, min_length=1, max_length=64)
    phonetic: str | None = Field(default=None, max_length=128)
    phonetic_audio: str | None = Field(default=None, max_length=512)
    chinese_meaning: str | None = Field(default=None, min_length=1, max_length=255)
    breakdown: str | None = Field(default=None, max_length=255)
    example_sentence: str | None = Field(default=None, max_length=2000)
    example_audio: str | None = Field(default=None, max_length=1024)
    sort_order: int | None = None
    root_id: int | None = None

    @field_validator("phonetic_audio", "example_audio")
    @classmethod
    def _check_url(cls, v: str | None) -> str | None:
        return validate_audio_url(v)


class WordOut(WordBase):
    word_id: int = Field(validation_alias="id")
    root_id: int


class RootIn(CamelModel):
    root_text: str = Field(min_length=1, max_length=64)
    meaning: str = Field(min_length=1, max_length=255)
    sort_order: int = 0
    words: list[WordIn] = Field(default_factory=list, max_length=200)


class RootUpdate(CamelModel):
    root_text: str | None = Field(default=None, min_length=1, max_length=64)
    meaning: str | None = Field(default=None, min_length=1, max_length=255)
    sort_order: int | None = None


class RootOut(CamelModel):
    id: int
    root_text: str
    meaning: str
    sort_order: int
    words: list[WordOut]


class RootBrief(CamelModel):
    id: int
    root_text: str
    meaning: str
    sort_order: int
    word_count: int


class ImportIn(CamelModel):
    roots: list[RootIn] = Field(max_length=500)
    # replace: 清空后导入；append: 追加
    mode: Literal["append", "replace"] = "append"


# ───────────────────────── 同步 ─────────────────────────


class ReviewLogIn(CamelModel):
    id: str = Field(min_length=1, max_length=64)
    word_id: int
    root_id: int
    skill: Literal["spell", "meaning", "self"]
    result: Literal["correct", "wrong", "skip"]
    answer: str | None = Field(default=None, max_length=255)
    hint_level: int = Field(default=0, ge=0, le=3)
    response_ms: int = Field(default=0, ge=0, le=3_600_000)
    at: int = Field(gt=0)


class StudyEventIn(CamelModel):
    id: str = Field(min_length=1, max_length=64)
    kind: Literal["time", "audio", "session", "favorite"]
    word_id: int | None = None
    # time: 毫秒（单次上报不超过 1 小时）；favorite: 1 收藏 / 0 取消
    value: int = Field(default=0, ge=0, le=3_600_000)
    word_ids: list[int] | None = Field(default=None, max_length=500)
    at: int = Field(gt=0)


class SyncIn(CamelModel):
    logs: list[ReviewLogIn] = Field(default_factory=list)
    events: list[StudyEventIn] = Field(default_factory=list)
    # 客户端时区（IANA 名称），用于按用户本地时间切分学习日
    timezone: str | None = Field(default=None, max_length=64)
    # 增量拉取：客户端已拥有的服务端日志游标
    since: int = Field(default=0, ge=0)


class SkillStateOut(CamelModel):
    correct: int
    wrong: int
    streak: int
    level: int
    last_review_at: int
    next_review_at: int


class WordProgressOut(CamelModel):
    word_id: int
    root_id: int
    spell: SkillStateOut
    meaning: SkillStateOut
    first_seen_at: int
    mastered_at: int | None
    study_ms: int
    avg_response_ms: int
    response_samples: int
    audio_plays: int
    hints_used: int
    recent_wrong: list[str]
    favorite: bool


class DailyStatsOut(CamelModel):
    date: str
    active_ms: int
    new_words: int
    reviewed_word_ids: list[int]
    mastered_words: int
    answers: int
    correct: int
    audio_plays: int
    sessions: int
    first_at: int
    last_at: int
    hourly: list[int]


class SyncLogOut(CamelModel):
    id: str
    word_id: int
    root_id: int
    skill: str
    result: str
    answer: str | None
    hint_level: int
    response_ms: int
    at: int


class SyncOut(CamelModel):
    accepted_logs: int
    accepted_events: int
    # 服务端是权威数据：客户端用这份覆盖本地 words / daily / settings
    words: dict[int, WordProgressOut]
    daily: dict[str, DailyStatsOut]
    settings: dict[str, int]
    # 增量日志（服务端 id > since 的部分），用于客户端补齐其他设备产生的明细
    logs: list[SyncLogOut]
    cursor: int
    has_more: bool

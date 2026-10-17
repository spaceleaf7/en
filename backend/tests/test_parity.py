"""前后端规则一致性：回放 shared/progress-parity.json 中的场景，结果须与前端 progressCore.ts 完全一致。

fixture 由 frontend/src/store/parity.test.ts 生成；规则有意调整时，先在前端运行
`npm run test:parity:update` 重新生成，再同步修改 app/services/progress_engine.py。
"""

import json
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app.services import progress_engine as engine

FIXTURE = Path(__file__).resolve().parents[2] / "shared" / "progress-parity.json"
DOC = json.loads(FIXTURE.read_text(encoding="utf-8"))
TZ = ZoneInfo(DOC["timezone"])


def run(ops: list[dict]) -> engine.ProgressState:
    state = engine.ProgressState(tz=TZ)
    for o in ops:
        if o["op"] == "answer":
            engine.record_answer(
                state,
                word_id=o["wordId"],
                root_id=o["rootId"],
                skill=o["skill"],
                result=o["result"],
                now=o["now"],
                answer=o.get("answer"),
                hint_level=o.get("hintLevel", 0),
                response_ms=o.get("responseMs", 0),
            )
        elif o["op"] == "time":
            engine.add_study_time(state, o["ms"], o["now"], o["wordIds"])
        elif o["op"] == "audio":
            engine.record_audio_play(state, o["wordId"], o["now"])
        elif o["op"] == "session":
            engine.record_session_start(state, o["now"])
        else:
            raise AssertionError(f"未知操作 {o['op']}")
    return state


def to_camel_snapshot(state: engine.ProgressState) -> dict:
    """转成与前端 ProgressState.words / daily 相同的结构"""
    return {
        "words": {
            str(w.word_id): {
                "wordId": w.word_id,
                "rootId": w.root_id,
                "spell": w.spell,
                "meaning": w.meaning,
                "firstSeenAt": w.first_seen_at,
                "masteredAt": w.mastered_at,
                "studyMs": w.study_ms,
                "avgResponseMs": w.avg_response_ms,
                "responseSamples": w.response_samples,
                "audioPlays": w.audio_plays,
                "hintsUsed": w.hints_used,
                "recentWrong": w.recent_wrong,
                "favorite": w.favorite,
            }
            for w in state.words.values()
        },
        "daily": {
            d.date: {
                "date": d.date,
                "activeMs": d.active_ms,
                "newWords": d.new_words,
                "reviewedWordIds": d.reviewed_word_ids,
                "masteredWords": d.mastered_words,
                "answers": d.answers,
                "correct": d.correct,
                "audioPlays": d.audio_plays,
                "sessions": d.sessions,
                "firstAt": d.first_at,
                "lastAt": d.last_at,
                "hourly": d.hourly,
            }
            for d in state.daily.values()
        },
    }


@pytest.mark.parametrize("name", list(DOC["scenarios"]))
def test_matches_frontend(name: str) -> None:
    scenario = DOC["scenarios"][name]
    assert to_camel_snapshot(run(scenario["ops"])) == scenario["expected"]


def test_fixture_not_empty() -> None:
    assert len(DOC["scenarios"]) >= 5

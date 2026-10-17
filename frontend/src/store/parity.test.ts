/**
 * 前后端规则一致性：同一组场景分别由 progressCore.ts 与 backend 的 progress_engine.py 执行，结果必须一致。
 *
 * 场景与期望结果保存在 shared/progress-parity.json：
 * - 本测试校验前端结果与文件一致；规则有意调整时运行 `npm run test:parity:update` 重新生成
 * - backend/tests/test_parity.py 用同一文件校验后端
 *
 * 学习日按本地时区计算，因此本测试固定使用 Asia/Shanghai（见 vitest.config.ts）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addStudyTime,
  createInitialState,
  recordAnswer,
  recordAudioPlay,
  recordSessionStart,
  type RecordAnswerInput,
} from './progressCore';
import type { ProgressState } from '../types/progress';

const FIXTURE = fileURLToPath(new URL('../../../shared/progress-parity.json', import.meta.url));
export const PARITY_TIMEZONE = 'Asia/Shanghai';

type Op =
  | ({ op: 'answer' } & RecordAnswerInput)
  | { op: 'time'; ms: number; now: number; wordIds: number[] }
  | { op: 'audio'; wordId: number | null; now: number }
  | { op: 'session'; now: number };

const H = 60 * 60 * 1000;
const DAY = 24 * H;
// 2026-10-17 10:00 +08:00
const T0 = Date.UTC(2026, 9, 17, 2, 0, 0);

const ans = (wordId: number, result: 'correct' | 'wrong' | 'skip', now: number, extra: Partial<RecordAnswerInput> = {}): Op => ({
  op: 'answer',
  wordId,
  rootId: Math.floor(wordId / 100),
  skill: 'spell',
  result,
  now,
  ...extra,
});

const SCENARIOS: Record<string, Op[]> = {
  '逐级升到 5 级并封顶': Array.from({ length: 7 }, (_, i) => ans(101, 'correct', T0 + i * 3 * DAY)),
  '答错降级与错误写法': [
    ans(101, 'correct', T0),
    ans(101, 'correct', T0 + DAY),
    ans(101, 'wrong', T0 + 2 * DAY, { answer: ' visable ' }),
    ans(101, 'wrong', T0 + 2 * DAY + 1000, { answer: 'visibel' }),
    ans(101, 'wrong', T0 + 2 * DAY + 2000, { answer: '' }),
  ],
  '提示等级影响升级': [
    ans(102, 'correct', T0, { hintLevel: 3 }),
    ans(102, 'correct', T0 + DAY, { hintLevel: 3 }),
    ans(102, 'correct', T0 + 2 * DAY, { hintLevel: 1 }),
    ans(102, 'correct', T0 + 3 * DAY, { hintLevel: 2 }),
    ans(102, 'skip', T0 + 4 * DAY),
  ],
  '自评与双维度掌握': [
    ...Array.from({ length: 4 }, (_, i) => ans(201, 'correct', T0 + i * DAY, { skill: 'self' })),
    ans(201, 'correct', T0 + 5 * DAY, { skill: 'meaning' }),
    ans(201, 'wrong', T0 + 6 * DAY, { skill: 'spell', answer: 'sympaty' }),
  ],
  '凌晨 4 点换日': [
    ans(301, 'correct', Date.UTC(2026, 9, 17, 19, 59)), // 10-18 03:59 本地 → 学习日 10-17
    ans(302, 'correct', Date.UTC(2026, 9, 17, 20, 0)), // 10-18 04:00 本地 → 学习日 10-18
    ans(301, 'correct', Date.UTC(2026, 9, 18, 15, 59)), // 10-18 23:59 本地
  ],
  '时长分摊、发音与打开次数': [
    { op: 'session', now: T0 - 1000 },
    ans(101, 'correct', T0, { responseMs: 2500 }),
    ans(102, 'wrong', T0 + 1000, { responseMs: 4001, answer: 'x' }),
    { op: 'time', ms: 15001, now: T0 + 2000, wordIds: [101, 102, 999] },
    { op: 'time', ms: 0, now: T0 + 3000, wordIds: [101] },
    { op: 'audio', wordId: 101, now: T0 + 4000 },
    { op: 'audio', wordId: 999, now: T0 + 5000 },
    { op: 'audio', wordId: null, now: T0 + 6000 },
    ans(101, 'correct', T0 + 7000, { responseMs: 1500 }),
    { op: 'session', now: T0 + DAY },
  ],
};

function run(ops: Op[]): ProgressState {
  let s = createInitialState();
  for (const o of ops) {
    if (o.op === 'answer') {
      const { op: _op, ...input } = o;
      s = recordAnswer(s, input);
    } else if (o.op === 'time') s = addStudyTime(s, o.ms, o.now, o.wordIds);
    else if (o.op === 'audio') s = recordAudioPlay(s, o.wordId ?? undefined, o.now);
    else s = recordSessionStart(s, o.now);
  }
  return s;
}

/** 只比较 words 与 daily；日志 id 含随机数，不参与比较 */
function snapshot(s: ProgressState) {
  const words = Object.fromEntries(
    Object.entries(s.words).map(([k, w]) => [k, { ...w, masteredAt: w.masteredAt ?? null }])
  );
  return { words, daily: s.daily };
}

const results = Object.fromEntries(
  Object.entries(SCENARIOS).map(([name, ops]) => [name, { ops, expected: snapshot(run(ops)) }])
);

describe('前后端规则一致性 fixture', () => {
  it('运行在固定时区', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(PARITY_TIMEZONE);
  });

  it('与 shared/progress-parity.json 一致', () => {
    const doc = { timezone: PARITY_TIMEZONE, scenarios: results };
    if (process.env.UPDATE_PARITY || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    }
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});

import { describe, expect, it } from 'vitest';
import { createInitialState, recordAnswer, studyDayStart } from '../store/progressCore';
import type { ProgressState } from '../types/progress';
import {
  getCommonMistake,
  getDifficultWords,
  getDueForecast,
  getDueWordIds,
  getForgettingRate,
  getStreak,
  getTodayProgress,
  getTrend,
  summarizeRoot,
} from './stats';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 9, 17, 10, 0, 0).getTime();

const answer = (
  s: ProgressState,
  wordId: number,
  result: 'correct' | 'wrong',
  now: number,
  skill: 'spell' | 'meaning' = 'spell',
  text?: string
) => recordAnswer(s, { wordId, rootId: 1, skill, result, now, answer: text });

describe('getStreak', () => {
  it('统计连续学习天数；今天还没学不打断', () => {
    let s = createInitialState();
    for (const d of [-3, -2, -1]) s = answer(s, 101, 'correct', T0 + d * DAY);
    expect(getStreak(s, T0)).toEqual({ current: 3, longest: 3 });

    s = answer(s, 101, 'correct', T0);
    expect(getStreak(s, T0).current).toBe(4);
  });

  it('中断后重新计数，并保留最长记录', () => {
    let s = createInitialState();
    for (const d of [-10, -9, -8, -7, -2, -1]) s = answer(s, 101, 'correct', T0 + d * DAY);
    expect(getStreak(s, T0)).toEqual({ current: 2, longest: 4 });
  });
});

describe('复习到期', () => {
  it('学过的词按间隔到期；未学过的不算到期', () => {
    let s = answer(createInitialState(), 101, 'correct', T0); // level 1，明天到期
    s = answer(s, 102, 'correct', T0, 'meaning');

    expect(getDueWordIds(s, T0)).toEqual([]);
    expect(getDueWordIds(s, studyDayStart(T0) + DAY)).toEqual([101, 102]);
    expect(summarizeRoot(s, [101, 102, 103], T0 + DAY)).toEqual({
      total: 3,
      mastered: 0,
      learning: 2,
      fresh: 1,
      due: 2,
    });
  });

  it('未来 7 天复习预测；已过期计入今天', () => {
    let s = answer(createInitialState(), 101, 'correct', T0 - 5 * DAY); // 早已过期
    s = answer(s, 102, 'correct', T0); // 明天
    expect(getDueForecast(s, T0, 7)).toEqual([1, 1, 0, 0, 0, 0, 0]);
  });
});

describe('今日目标与趋势', () => {
  it('计算目标完成度', () => {
    let s = createInitialState();
    for (let i = 0; i < 5; i++) s = answer(s, 100 + i, i < 4 ? 'correct' : 'wrong', T0 + i);
    s.daily['2026-10-17'].activeMs = 15 * 60_000;

    expect(getTodayProgress(s, T0)).toMatchObject({
      newWords: 5,
      newGoal: 10,
      minutes: 15,
      accuracy: 0.8,
      completion: 0.75, // (5/10 + 15/15) / 2
    });
  });

  it('趋势补齐没学习的日子', () => {
    let s = answer(createInitialState(), 101, 'correct', T0 - 2 * DAY);
    s = answer(s, 102, 'correct', T0);
    const trend = getTrend(s, T0, 3);
    expect(trend.map((p) => [p.date, p.words])).toEqual([
      ['2026-10-15', 1],
      ['2026-10-16', 0],
      ['2026-10-17', 1],
    ]);
  });
});

describe('易错与遗忘', () => {
  it('按错误次数排序易错词，并给出常见错误写法', () => {
    let s = createInitialState();
    for (let i = 0; i < 3; i++) s = answer(s, 101, 'wrong', T0 + i, 'spell', i < 2 ? 'Visable' : 'visibel');
    for (let i = 0; i < 4; i++) s = answer(s, 102, 'wrong', T0 + 10 + i);
    s = answer(s, 103, 'correct', T0);

    expect(getDifficultWords(s).map((p) => p.wordId)).toEqual([102, 101]);
    expect(getCommonMistake(s.words[101])).toEqual({ answer: 'visable', count: 2 });
  });

  it('遗忘率只统计到期后的复习', () => {
    let s = answer(createInitialState(), 101, 'correct', T0); // 学会，明天到期
    s = answer(s, 101, 'correct', T0 + 1000); // 未到期就复习，不计入
    s = answer(s, 101, 'wrong', T0 + 5 * DAY); // 到期后答错 → 遗忘
    s = answer(s, 102, 'correct', T0);
    s = answer(s, 102, 'correct', T0 + 2 * DAY); // 到期后答对
    expect(getForgettingRate(s)).toBe(0.5);
  });

  it('没有到期复习时返回 null', () => {
    expect(getForgettingRate(answer(createInitialState(), 101, 'correct', T0))).toBeNull();
  });
});

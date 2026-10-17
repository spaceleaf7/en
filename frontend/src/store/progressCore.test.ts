import { describe, expect, it } from 'vitest';
import {
  addStudyTime,
  applySkillResult,
  createInitialState,
  isWordMastered,
  MAX_LOGS,
  recordAnswer,
  studyDayKey,
  studyDayStart,
} from './progressCore';
import type { ProgressState, SkillState } from '../types/progress';

const DAY = 24 * 60 * 60 * 1000;
// 2026-10-17 10:00 本地时间
const T0 = new Date(2026, 9, 17, 10, 0, 0).getTime();

const blankSkill = (): SkillState => ({
  correct: 0,
  wrong: 0,
  streak: 0,
  level: 0,
  lastReviewAt: 0,
  nextReviewAt: 0,
});

describe('studyDayKey', () => {
  it('凌晨 4 点前算前一天', () => {
    expect(studyDayKey(new Date(2026, 9, 17, 3, 59).getTime())).toBe('2026-10-16');
    expect(studyDayKey(new Date(2026, 9, 17, 4, 0).getTime())).toBe('2026-10-17');
    expect(studyDayKey(new Date(2026, 9, 17, 23, 59).getTime())).toBe('2026-10-17');
  });

  it('学习日起点是当天凌晨 4 点', () => {
    expect(studyDayStart(T0)).toBe(new Date(2026, 9, 17, 4, 0).getTime());
    expect(studyDayStart(new Date(2026, 9, 17, 2, 0).getTime())).toBe(new Date(2026, 9, 16, 4, 0).getTime());
  });
});

describe('applySkillResult', () => {
  it('答对升一级，并按间隔安排下次复习', () => {
    const s1 = applySkillResult(blankSkill(), 'correct', 0, T0);
    expect(s1).toMatchObject({ level: 1, correct: 1, streak: 1 });
    expect(s1.nextReviewAt).toBe(studyDayStart(T0) + 1 * DAY);

    const s2 = applySkillResult(s1, 'correct', 0, T0 + DAY);
    expect(s2.level).toBe(2);
    expect(s2.nextReviewAt).toBe(studyDayStart(T0 + DAY) + 2 * DAY);
  });

  it('熟练度最高 5 级', () => {
    let s = blankSkill();
    for (let i = 0; i < 8; i++) s = applySkillResult(s, 'correct', 0, T0 + i * DAY);
    expect(s.level).toBe(5);
    expect(s.streak).toBe(8);
  });

  it('答错降回 1 级，连对清零', () => {
    let s = blankSkill();
    for (let i = 0; i < 4; i++) s = applySkillResult(s, 'correct', 0, T0);
    s = applySkillResult(s, 'wrong', 0, T0);
    expect(s).toMatchObject({ level: 1, streak: 0, wrong: 1, correct: 4 });
    expect(s.nextReviewAt).toBe(studyDayStart(T0) + DAY);
  });

  it('看了答案再答对不升级（新词除外）', () => {
    const learned = { ...blankSkill(), level: 2 as const, streak: 2 };
    expect(applySkillResult(learned, 'correct', 3, T0).level).toBe(2);
    expect(applySkillResult(blankSkill(), 'correct', 3, T0).level).toBe(1);
  });

  it('用了首字母 / 听音提示：已连对才升级', () => {
    const noStreak = { ...blankSkill(), level: 2 as const, streak: 0 };
    const withStreak = { ...blankSkill(), level: 2 as const, streak: 1 };
    expect(applySkillResult(noStreak, 'correct', 1, T0).level).toBe(2);
    expect(applySkillResult(withStreak, 'correct', 2, T0).level).toBe(3);
  });

  it('跳过不改熟练度', () => {
    const s = { ...blankSkill(), level: 3 as const, streak: 3 };
    const next = applySkillResult(s, 'skip', 0, T0);
    expect(next).toMatchObject({ level: 3, streak: 3, correct: 0, wrong: 0, lastReviewAt: T0 });
  });
});

describe('recordAnswer', () => {
  const answer = (state: ProgressState, overrides: Partial<Parameters<typeof recordAnswer>[1]> = {}) =>
    recordAnswer(state, { wordId: 101, rootId: 1, skill: 'spell', result: 'correct', now: T0, ...overrides });

  it('不修改传入的 state', () => {
    const s0 = createInitialState();
    const snapshot = JSON.stringify(s0);
    answer(s0);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it('首次作答记为新词，同一天重复作答复习数去重', () => {
    let s = answer(createInitialState());
    s = answer(s, { result: 'wrong', answer: 'visable', now: T0 + 1000 });
    s = answer(s, { wordId: 102, now: T0 + 2000 });

    const day = s.daily['2026-10-17'];
    expect(day).toMatchObject({ newWords: 2, answers: 3, correct: 2 });
    expect(day.reviewedWordIds).toEqual([101, 102]);
    expect(day.hourly[10]).toBe(3);
    expect(s.logs).toHaveLength(3);
  });

  it('答错记录错误写法（新在前，最多 5 条）', () => {
    let s = createInitialState();
    for (let i = 0; i < 7; i++) s = answer(s, { result: 'wrong', answer: ` w${i} `, now: T0 + i });
    expect(s.words[101].recentWrong).toEqual(['w6', 'w5', 'w4', 'w3', 'w2']);
  });

  it('自评同时更新拼写和释义两个维度', () => {
    const s = answer(createInitialState(), { skill: 'self' });
    expect(s.words[101].spell.level).toBe(1);
    expect(s.words[101].meaning.level).toBe(1);
  });

  it('两个维度都到 4 级才算掌握，并计入当日新掌握', () => {
    let s = createInitialState();
    for (let i = 0; i < 4; i++) s = answer(s, { skill: 'spell', now: T0 + i });
    expect(isWordMastered(s.words[101])).toBe(false);
    for (let i = 0; i < 4; i++) s = answer(s, { skill: 'meaning', now: T0 + 10 + i });

    expect(isWordMastered(s.words[101])).toBe(true);
    expect(s.words[101].masteredAt).toBe(T0 + 13);
    expect(s.daily['2026-10-17'].masteredWords).toBe(1);

    // 再答对不重复计数；答错则取消掌握
    s = answer(s, { now: T0 + 20 });
    expect(s.daily['2026-10-17'].masteredWords).toBe(1);
    s = answer(s, { result: 'wrong', now: T0 + 30 });
    expect(s.words[101].masteredAt).toBeUndefined();
  });

  it('滚动计算平均作答用时', () => {
    let s = answer(createInitialState(), { responseMs: 2000 });
    s = answer(s, { responseMs: 4000 });
    expect(s.words[101].avgResponseMs).toBe(3000);
    expect(s.words[101].responseSamples).toBe(2);
  });

  it('日志超过上限时丢弃最旧的', () => {
    let s = createInitialState();
    s = { ...s, logs: Array.from({ length: MAX_LOGS }, (_, i) => ({ ...answer(s).logs[0], id: `old-${i}` })) };
    s = answer(s, { now: T0 + 1 });
    expect(s.logs).toHaveLength(MAX_LOGS);
    expect(s.logs[0].id).toBe('old-1');
    expect(s.logs.at(-1)?.at).toBe(T0 + 1);
  });
});

describe('addStudyTime', () => {
  it('累加到当日并平摊给已学单词', () => {
    let s = recordAnswer(createInitialState(), { wordId: 101, rootId: 1, skill: 'spell', result: 'correct', now: T0 });
    s = addStudyTime(s, 60_000, T0, [101, 999]); // 999 未学过，不参与分摊
    expect(s.daily['2026-10-17'].activeMs).toBe(60_000);
    expect(s.words[101].studyMs).toBe(60_000);
  });

  it('时长为 0 时原样返回', () => {
    const s = createInitialState();
    expect(addStudyTime(s, 0, T0)).toBe(s);
  });
});

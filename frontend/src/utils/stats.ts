import type { DailyStats, ProgressState, Skill, WordProgress } from '../types/progress';
import type { MasteryLevel } from '../types/progress';
import { isWordMastered, REVIEW_INTERVAL_DAYS, studyDayKey, studyDayStart } from '../store/progressCore';

const DAY_MS = 24 * 60 * 60 * 1000;

export type WordStatus = 'new' | 'learning' | 'mastered';

export function getWordStatus(p: WordProgress | undefined): WordStatus {
  if (!p) return 'new';
  return isWordMastered(p) ? 'mastered' : 'learning';
}

/** 综合熟练度 0-5：取两个维度中较弱的一项（会认不会拼不算掌握） */
export function getWordLevel(p: WordProgress | undefined): number {
  if (!p) return 0;
  return Math.min(p.spell.level, p.meaning.level);
}

export function isDue(p: WordProgress | undefined, now: number, skill?: Skill): boolean {
  if (!p) return false;
  const skills: Skill[] = skill ? [skill] : ['spell', 'meaning'];
  // 只有学过（level > 0）的维度才参与到期判断
  return skills.some((s) => p[s].level > 0 && p[s].nextReviewAt <= now);
}

export function getAccuracy(p: WordProgress): number | null {
  const total = p.spell.correct + p.spell.wrong + p.meaning.correct + p.meaning.wrong;
  if (total === 0) return null;
  return (p.spell.correct + p.meaning.correct) / total;
}

/** 易错词：累计错 3 次以上，或至少答过 3 次且正确率低于 60% */
export function isDifficult(p: WordProgress): boolean {
  const wrong = p.spell.wrong + p.meaning.wrong;
  const total = wrong + p.spell.correct + p.meaning.correct;
  return wrong >= 3 || (total >= 3 && (getAccuracy(p) ?? 1) < 0.6);
}

export interface RootSummary {
  total: number;
  mastered: number;
  learning: number;
  fresh: number;
  due: number;
}

export function summarizeRoot(state: ProgressState, wordIds: number[], now: number): RootSummary {
  const summary: RootSummary = { total: wordIds.length, mastered: 0, learning: 0, fresh: 0, due: 0 };
  for (const id of wordIds) {
    const p = state.words[id];
    const status = getWordStatus(p);
    if (status === 'mastered') summary.mastered += 1;
    else if (status === 'learning') summary.learning += 1;
    else summary.fresh += 1;
    if (isDue(p, now)) summary.due += 1;
  }
  return summary;
}

export function getDueWordIds(state: ProgressState, now: number): number[] {
  return Object.values(state.words)
    .filter((p) => isDue(p, now))
    .sort((a, b) => Math.min(a.spell.nextReviewAt, a.meaning.nextReviewAt) - Math.min(b.spell.nextReviewAt, b.meaning.nextReviewAt))
    .map((p) => p.wordId);
}

/** 易错词，按错误次数从多到少 */
export function getDifficultWords(state: ProgressState, limit = Infinity): WordProgress[] {
  return Object.values(state.words)
    .filter(isDifficult)
    .sort((a, b) => b.spell.wrong + b.meaning.wrong - (a.spell.wrong + a.meaning.wrong))
    .slice(0, limit);
}

function shiftDayKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + deltaDays, 12); // 取正午，规避夏令时切换
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isActiveDay(d: DailyStats | undefined): boolean {
  return !!d && (d.answers > 0 || d.activeMs >= 60_000);
}

/** 连续学习天数：今天还没学时，从昨天往前数，不打断连续记录 */
export function getStreak(state: ProgressState, now: number): { current: number; longest: number } {
  const today = studyDayKey(now);
  let cursor = isActiveDay(state.daily[today]) ? today : shiftDayKey(today, -1);
  let current = 0;
  while (isActiveDay(state.daily[cursor])) {
    current += 1;
    cursor = shiftDayKey(cursor, -1);
  }

  const days = Object.keys(state.daily).filter((k) => isActiveDay(state.daily[k])).sort();
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const k of days) {
    run = prev && shiftDayKey(prev, 1) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return { current, longest: Math.max(longest, current) };
}

export interface TodayProgress {
  newWords: number;
  newGoal: number;
  minutes: number;
  minutesGoal: number;
  reviewed: number;
  answers: number;
  accuracy: number | null;
  /** 0-1，新词与时长两项目标的平均完成度 */
  completion: number;
}

export function getTodayProgress(state: ProgressState, now: number): TodayProgress {
  const d = state.daily[studyDayKey(now)];
  const { dailyNewGoal, dailyMinutesGoal } = state.settings;
  const newWords = d?.newWords ?? 0;
  const minutes = Math.floor((d?.activeMs ?? 0) / 60_000);
  const ratio = (v: number, goal: number) => (goal > 0 ? Math.min(1, v / goal) : 1);
  return {
    newWords,
    newGoal: dailyNewGoal,
    minutes,
    minutesGoal: dailyMinutesGoal,
    reviewed: d?.reviewedWordIds.length ?? 0,
    answers: d?.answers ?? 0,
    accuracy: d && d.answers > 0 ? d.correct / d.answers : null,
    completion: (ratio(newWords, dailyNewGoal) + ratio(minutes, dailyMinutesGoal)) / 2,
  };
}

export interface TrendPoint {
  date: string;
  minutes: number;
  words: number;
  newWords: number;
  accuracy: number | null;
}

/** 最近 N 天趋势（含今天，旧在前），没学习的日子补 0 */
export function getTrend(state: ProgressState, now: number, days: number): TrendPoint[] {
  const today = studyDayKey(now);
  return Array.from({ length: days }, (_, i) => {
    const key = shiftDayKey(today, i - days + 1);
    const d = state.daily[key];
    return {
      date: key,
      minutes: Math.round((d?.activeMs ?? 0) / 60_000),
      words: d?.reviewedWordIds.length ?? 0,
      newWords: d?.newWords ?? 0,
      accuracy: d && d.answers > 0 ? d.correct / d.answers : null,
    };
  });
}

/**
 * 遗忘率：按期复习（到期后才复习）的作答中答错的比例。
 * 通过回放日志判断每次作答时该维度是否已到期。
 */
export function getForgettingRate(state: ProgressState): number | null {
  const lastByKey = new Map<string, number>();
  let dueReviews = 0;
  let forgotten = 0;
  const levelByKey = new Map<string, MasteryLevel>();

  for (const log of state.logs) {
    if (log.skill === 'self' || log.result === 'skip') continue;
    const key = `${log.wordId}:${log.skill}`;
    const last = lastByKey.get(key);
    const level = levelByKey.get(key) ?? 0;
    if (last !== undefined && level > 0) {
      const dueAt = studyDayStart(last) + REVIEW_INTERVAL_DAYS[level] * DAY_MS;
      if (log.at >= dueAt) {
        dueReviews += 1;
        if (log.result === 'wrong') forgotten += 1;
      }
    }
    lastByKey.set(key, log.at);
    levelByKey.set(key, log.result === 'wrong' ? 1 : (Math.min(5, level + 1) as MasteryLevel));
  }
  return dueReviews === 0 ? null : forgotten / dueReviews;
}

/** 常见拼写错误：返回出现次数最多的错误写法 */
export function getCommonMistake(p: WordProgress): { answer: string; count: number } | null {
  if (p.recentWrong.length === 0) return null;
  const counts = new Map<string, number>();
  for (const a of p.recentWrong) {
    const key = a.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [answer, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { answer, count };
}

/** 学习时段分布：24 小时累计作答次数 */
export function getHourlyDistribution(state: ProgressState): number[] {
  const total = Array(24).fill(0) as number[];
  for (const d of Object.values(state.daily)) {
    d.hourly.forEach((v, h) => (total[h] += v));
  }
  return total;
}

/** 未来 N 天每天到期的复习词数；已过期的计入第 0 天（今天） */
export function getDueForecast(state: ProgressState, now: number, days: number): number[] {
  const forecast = Array(days).fill(0) as number[];
  const todayStart = studyDayStart(now);
  for (const p of Object.values(state.words)) {
    const learned = (['spell', 'meaning'] as const).filter((s) => p[s].level > 0);
    if (learned.length === 0) continue;
    const dueAt = Math.min(...learned.map((s) => p[s].nextReviewAt));
    const idx = Math.max(0, Math.floor((dueAt - todayStart) / DAY_MS));
    if (idx < days) forecast[idx] += 1;
  }
  return forecast;
}

export interface OverallSummary {
  total: number;
  mastered: number;
  learning: number;
  fresh: number;
  totalMinutes: number;
  totalAnswers: number;
  accuracy: number | null;
}

export function getOverallSummary(state: ProgressState, allWordIds: number[]): OverallSummary {
  let mastered = 0;
  let learning = 0;
  for (const id of allWordIds) {
    const s = getWordStatus(state.words[id]);
    if (s === 'mastered') mastered += 1;
    else if (s === 'learning') learning += 1;
  }
  const days = Object.values(state.daily);
  const totalAnswers = days.reduce((a, d) => a + d.answers, 0);
  const totalCorrect = days.reduce((a, d) => a + d.correct, 0);
  return {
    total: allWordIds.length,
    mastered,
    learning,
    fresh: allWordIds.length - mastered - learning,
    totalMinutes: Math.round(days.reduce((a, d) => a + d.activeMs, 0) / 60_000),
    totalAnswers,
    accuracy: totalAnswers > 0 ? totalCorrect / totalAnswers : null,
  };
}

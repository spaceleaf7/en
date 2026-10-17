import type {
  DailyStats,
  HintLevel,
  LogSkill,
  MasteryLevel,
  ProgressState,
  ReviewLog,
  ReviewResult,
  Skill,
  SkillState,
  StudyEvent,
  StudySettings,
  WordProgress,
} from '../types/progress';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 客户端生成的记录 id，服务端据此去重 */
export function newClientId(tag: string, now: number): string {
  return `${now.toString(36)}-${tag}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 凌晨 4 点前的学习计入前一天 */
export const DAY_START_HOUR = 4;
/** 熟练度达到该级别视为掌握该维度 */
export const MASTERED_LEVEL: MasteryLevel = 4;
/** 各熟练度对应的复习间隔（天）；0 级为未学，立即可复习 */
export const REVIEW_INTERVAL_DAYS: Record<MasteryLevel, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 4,
  4: 7,
  5: 15,
};
export const MAX_LOGS = 5000;
const MAX_RECENT_WRONG = 5;

export const DEFAULT_SETTINGS: StudySettings = {
  dailyNewGoal: 10,
  dailyMinutesGoal: 15,
};

export function createInitialState(): ProgressState {
  return { version: 2, words: {}, daily: {}, logs: [], settings: { ...DEFAULT_SETTINGS } };
}

/** 本地时间的学习日 key（YYYY-MM-DD），凌晨 4 点换日 */
export function studyDayKey(ts: number): string {
  const d = new Date(ts - DAY_START_HOUR * 60 * 60 * 1000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 某个学习日开始的时间戳（当天凌晨 4 点） */
export function studyDayStart(ts: number): number {
  const d = new Date(ts - DAY_START_HOUR * 60 * 60 * 1000);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  return d.getTime();
}

function createSkillState(): SkillState {
  return { correct: 0, wrong: 0, streak: 0, level: 0, lastReviewAt: 0, nextReviewAt: 0 };
}

export function createWordProgress(wordId: number, rootId: number, now: number): WordProgress {
  return {
    wordId,
    rootId,
    spell: createSkillState(),
    meaning: createSkillState(),
    firstSeenAt: now,
    studyMs: 0,
    avgResponseMs: 0,
    responseSamples: 0,
    audioPlays: 0,
    hintsUsed: 0,
    recentWrong: [],
    favorite: false,
  };
}

function createDailyStats(date: string): DailyStats {
  return {
    date,
    activeMs: 0,
    newWords: 0,
    reviewedWordIds: [],
    masteredWords: 0,
    answers: 0,
    correct: 0,
    audioPlays: 0,
    sessions: 0,
    firstAt: 0,
    lastAt: 0,
    hourly: Array(24).fill(0),
  };
}

/** 复习到期时间对齐到学习日开始，避免"差几分钟没到期"的情况 */
function scheduleNext(level: MasteryLevel, now: number): number {
  const days = REVIEW_INTERVAL_DAYS[level];
  return days === 0 ? now : studyDayStart(now) + days * DAY_MS;
}

/**
 * 更新单个维度的熟练度：
 * - 答对：升一级；看了答案（hint 3）不升级，用了首字母 / 听音（hint 1-2）仅在已连对时升级
 * - 答错：降回 1 级，连对清零
 * - 跳过：只记录复习时间，不改熟练度
 */
export function applySkillResult(
  prev: SkillState,
  result: ReviewResult,
  hintLevel: HintLevel,
  now: number
): SkillState {
  const next: SkillState = { ...prev, lastReviewAt: now };

  if (result === 'correct') {
    next.correct += 1;
    next.streak += 1;
    const canLevelUp = hintLevel === 0 || (hintLevel < 3 && prev.streak > 0);
    if (canLevelUp || prev.level === 0) {
      next.level = Math.min(5, prev.level + 1) as MasteryLevel;
    }
  } else if (result === 'wrong') {
    next.wrong += 1;
    next.streak = 0;
    next.level = 1;
  }

  next.nextReviewAt = scheduleNext(next.level, now);
  return next;
}

export function isWordMastered(p: WordProgress): boolean {
  return p.spell.level >= MASTERED_LEVEL && p.meaning.level >= MASTERED_LEVEL;
}

function upsertDaily(state: ProgressState, now: number): DailyStats {
  const key = studyDayKey(now);
  const prev = state.daily[key] ?? createDailyStats(key);
  const day: DailyStats = {
    ...prev,
    reviewedWordIds: [...prev.reviewedWordIds],
    hourly: [...prev.hourly],
    firstAt: prev.firstAt || now,
    lastAt: now,
  };
  state.daily = { ...state.daily, [key]: day };
  return day;
}

export interface RecordAnswerInput {
  /** 回放已有日志时传入原 id；不传则生成新 id */
  id?: string;
  wordId: number;
  rootId: number;
  skill: LogSkill;
  result: ReviewResult;
  answer?: string;
  hintLevel?: HintLevel;
  responseMs?: number;
  now: number;
}

/** 记录一次作答：写日志、更新单词进度、累加当日统计。返回新的 state（不修改入参） */
export function recordAnswer(state: ProgressState, input: RecordAnswerInput): ProgressState {
  const { wordId, rootId, skill, result, now } = input;
  const hintLevel = input.hintLevel ?? 0;
  const responseMs = Math.max(0, input.responseMs ?? 0);

  const next: ProgressState = { ...state, words: { ...state.words } };
  const existing = state.words[wordId];
  const isNewWord = !existing;
  const prevWord = existing ?? createWordProgress(wordId, rootId, now);
  const wasMastered = !isNewWord && isWordMastered(prevWord);

  const word: WordProgress = { ...prevWord, recentWrong: [...prevWord.recentWrong] };

  // 自评（浏览模式"认识 / 模糊 / 不认识"）同时作用于两个维度
  const skills: Skill[] = skill === 'self' ? ['spell', 'meaning'] : [skill];
  for (const s of skills) {
    word[s] = applySkillResult(word[s], result, hintLevel, now);
  }

  if (hintLevel > 0) word.hintsUsed += 1;
  if (result === 'wrong' && input.answer?.trim()) {
    word.recentWrong = [input.answer.trim(), ...word.recentWrong].slice(0, MAX_RECENT_WRONG);
  }
  if (responseMs > 0) {
    const n = word.responseSamples;
    word.avgResponseMs = Math.round((word.avgResponseMs * n + responseMs) / (n + 1));
    word.responseSamples = n + 1;
  }

  const nowMastered = isWordMastered(word);
  if (nowMastered && !wasMastered) word.masteredAt = now;
  if (!nowMastered) word.masteredAt = undefined;
  next.words[wordId] = word;

  const day = upsertDaily(next, now);
  day.answers += 1;
  if (result === 'correct') day.correct += 1;
  if (isNewWord) day.newWords += 1;
  if (!day.reviewedWordIds.includes(wordId)) day.reviewedWordIds.push(wordId);
  if (nowMastered && !wasMastered) day.masteredWords += 1;
  day.hourly[new Date(now).getHours()] += 1;

  const log: ReviewLog = {
    id: input.id ?? newClientId(String(wordId), now),
    wordId,
    rootId,
    skill,
    result,
    answer: input.answer,
    hintLevel,
    responseMs,
    at: now,
  };
  next.logs = [...state.logs, log].slice(-MAX_LOGS);

  return next;
}

/** 累加有效学习时长；传入 wordIds 时平均分摊到这些单词上 */
export function addStudyTime(
  state: ProgressState,
  ms: number,
  now: number,
  wordIds: number[] = []
): ProgressState {
  if (ms <= 0) return state;
  const next: ProgressState = { ...state, words: { ...state.words } };
  const day = upsertDaily(next, now);
  day.activeMs += ms;

  const tracked = wordIds.filter((id) => next.words[id]);
  if (tracked.length > 0) {
    const share = Math.round(ms / tracked.length);
    for (const id of tracked) {
      next.words[id] = { ...next.words[id], studyMs: next.words[id].studyMs + share };
    }
  }
  return next;
}

export function recordAudioPlay(state: ProgressState, wordId: number | undefined, now: number): ProgressState {
  const next: ProgressState = { ...state, words: { ...state.words } };
  const day = upsertDaily(next, now);
  day.audioPlays += 1;
  if (wordId !== undefined && next.words[wordId]) {
    next.words[wordId] = { ...next.words[wordId], audioPlays: next.words[wordId].audioPlays + 1 };
  }
  return next;
}

export function recordSessionStart(state: ProgressState, now: number): ProgressState {
  const next: ProgressState = { ...state };
  const day = upsertDaily(next, now);
  day.sessions += 1;
  return next;
}

/** 设置收藏状态（而非切换），同一事件重复回放结果不变，与后端 set_favorite 一致 */
export function setFavorite(
  state: ProgressState,
  wordId: number,
  rootId: number,
  favorite: boolean,
  now: number
): ProgressState {
  const prev = state.words[wordId] ?? createWordProgress(wordId, rootId, now);
  return {
    ...state,
    words: { ...state.words, [wordId]: { ...prev, favorite } },
  };
}

/** 把一条学习事件作用到进度上 */
export function applyEvent(state: ProgressState, ev: StudyEvent): ProgressState {
  switch (ev.kind) {
    case 'time':
      return addStudyTime(state, ev.value, ev.at, ev.wordIds ?? []);
    case 'audio':
      return recordAudioPlay(state, ev.wordId, ev.at);
    case 'session':
      return recordSessionStart(state, ev.at);
    case 'favorite': {
      if (ev.wordId === undefined) return state;
      const rootId = ev.rootId ?? state.words[ev.wordId]?.rootId ?? 0;
      return setFavorite(state, ev.wordId, rootId, ev.value !== 0, ev.at);
    }
  }
}

/** 按时间顺序回放日志与事件；同一时刻先处理作答（与后端 progress_store.replay 一致） */
export function replayRecords(state: ProgressState, logs: ReviewLog[], events: StudyEvent[]): ProgressState {
  const timeline = [
    ...logs.map((log) => ({ at: log.at, order: 0, log })),
    ...events.map((ev) => ({ at: ev.at, order: 1, ev })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);

  let s = state;
  for (const item of timeline) {
    if ('log' in item) {
      const { at, ...rest } = item.log;
      s = recordAnswer(s, { ...rest, now: at });
    } else {
      s = applyEvent(s, item.ev);
    }
  }
  return s;
}

export function updateSettings(state: ProgressState, patch: Partial<StudySettings>): ProgressState {
  return { ...state, settings: { ...state.settings, ...patch } };
}

import type { DailyStats, ProgressState } from '../types/progress';
import { createInitialState, DEFAULT_SETTINGS, MAX_LOGS, studyDayKey } from './progressCore';

export const STORAGE_KEY = 'etymomind:v2:progress';
/** v1 版本按"每次提交"记录的旧数据 */
export const LEGACY_RECORDS_KEY = 'etymomind:records';

interface LegacyRecord {
  rootId: number;
  accuracyRate: number;
  studyDurationSeconds: number;
  id: number; // 旧版用 Date.now() 作为 id，即提交时间
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 校验并补齐字段；结构不对时返回 null（用于加载与导入） */
export function normalizeState(raw: unknown): ProgressState | null {
  if (!isObject(raw) || raw.version !== 2) return null;
  if (!isObject(raw.words) || !isObject(raw.daily) || !Array.isArray(raw.logs)) return null;

  const base = createInitialState();
  const daily: Record<string, DailyStats> = {};
  for (const [key, d] of Object.entries(raw.daily)) {
    if (!isObject(d)) continue;
    daily[key] = {
      ...(d as unknown as DailyStats),
      reviewedWordIds: Array.isArray(d.reviewedWordIds) ? (d.reviewedWordIds as number[]) : [],
      hourly: Array.isArray(d.hourly) && d.hourly.length === 24 ? (d.hourly as number[]) : Array(24).fill(0),
    };
  }

  return {
    ...base,
    words: raw.words as ProgressState['words'],
    daily,
    logs: (raw.logs as ProgressState['logs']).slice(-MAX_LOGS),
    settings: { ...DEFAULT_SETTINGS, ...(isObject(raw.settings) ? raw.settings : {}) },
  };
}

/** 把 v1 的提交记录合并为每日学习时长与次数（旧数据没有单词粒度，无法还原熟练度） */
export function migrateLegacyRecords(records: LegacyRecord[]): ProgressState {
  const state = createInitialState();
  for (const r of records) {
    if (typeof r?.id !== 'number') continue;
    const key = studyDayKey(r.id);
    const day =
      state.daily[key] ??
      ({
        date: key,
        activeMs: 0,
        newWords: 0,
        reviewedWordIds: [],
        masteredWords: 0,
        answers: 0,
        correct: 0,
        audioPlays: 0,
        sessions: 0,
        firstAt: r.id,
        lastAt: r.id,
        hourly: Array(24).fill(0),
      } satisfies DailyStats);
    day.activeMs += Math.max(0, r.studyDurationSeconds || 0) * 1000;
    day.sessions += 1;
    day.firstAt = Math.min(day.firstAt, r.id);
    day.lastAt = Math.max(day.lastAt, r.id);
    state.daily[key] = day;
  }
  return state;
}

export function loadState(storage: Storage = localStorage): ProgressState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw)) ?? createInitialState();

    const legacy = storage.getItem(LEGACY_RECORDS_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) return migrateLegacyRecords(parsed);
    }
  } catch (err) {
    console.warn('学习数据读取失败，已使用空数据:', err);
  }
  return createInitialState();
}

export function saveState(state: ProgressState, storage: Storage = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // 配额不足时丢弃一半日志再试；日志只是明细，汇总数据不受影响
    console.warn('学习数据保存失败，尝试精简日志:', err);
    try {
      const trimmed = { ...state, logs: state.logs.slice(-Math.floor(state.logs.length / 2)) };
      storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // 仍失败则放弃本次写入，内存中的数据继续可用
    }
  }
}

/** 备份里的单词 id 编号：接入后端后导出的为 server，之前的为 mock */
export type IdSpace = 'mock' | 'server';

export function exportState(state: ProgressState, idSpace?: IdSpace): string {
  return JSON.stringify({ app: 'etymomind', exportedAt: new Date().toISOString(), idSpace, data: state }, null, 2);
}

/** 读取备份的 id 编号；旧备份没有该字段，视为 mock */
export function backupIdSpace(text: string): IdSpace {
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) && parsed.idSpace === 'server' ? 'server' : 'mock';
  } catch {
    return 'mock';
  }
}

/** 解析备份文件；兼容直接导出的 state 和带外层包装的格式 */
export function parseBackup(text: string): ProgressState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  const data = isObject(parsed) && 'data' in parsed ? parsed.data : parsed;
  const state = normalizeState(data);
  if (!state) throw new Error('不是 EtymoMind 的学习数据备份');
  return state;
}

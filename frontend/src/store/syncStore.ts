/**
 * 学习数据同步的本地状态（按用户分别保存在 localStorage）：
 * - base：最近一次从服务端拿到的权威进度
 * - pendingLogs / pendingEvents：还没确认上传成功的原始记录
 * 页面显示的进度 = base 上回放 pending。同步成功后用服务端结果替换 base，并移除已确认的记录。
 */
import type { SyncIn, SyncOut } from '../api/endpoints';
import type { ProgressState, ReviewLog, StudyEvent, StudySettings, WordProgress } from '../types/progress';
import { createInitialState, MAX_LOGS, replayRecords } from './progressCore';

/** 与后端 sync_max_logs 一致 */
export const SYNC_BATCH = 2000;

export interface SyncStore {
  version: 3;
  userId: number;
  base: ProgressState;
  pendingLogs: ReviewLog[];
  pendingEvents: StudyEvent[];
  /** 尚未提交到服务端的学习目标修改 */
  pendingSettings: Partial<StudySettings> | null;
  /** 已拉取到的服务端日志游标 */
  cursor: number;
}

export const storeKey = (userId: number) => `etymomind:v3:user:${userId}`;

export function createStore(userId: number): SyncStore {
  return { version: 3, userId, base: createInitialState(), pendingLogs: [], pendingEvents: [], pendingSettings: null, cursor: 0 };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function loadStore(userId: number, storage: Storage = localStorage): SyncStore {
  try {
    const raw: unknown = JSON.parse(storage.getItem(storeKey(userId)) ?? 'null');
    if (
      isObject(raw) &&
      raw.version === 3 &&
      raw.userId === userId &&
      isObject(raw.base) &&
      Array.isArray(raw.pendingLogs) &&
      Array.isArray(raw.pendingEvents)
    ) {
      return { ...createStore(userId), ...(raw as unknown as SyncStore) };
    }
  } catch (err) {
    console.warn('本地同步数据读取失败，将从服务端重新拉取:', err);
  }
  return createStore(userId);
}

export function saveStore(store: SyncStore, storage: Storage = localStorage): void {
  try {
    storage.setItem(storeKey(store.userId), JSON.stringify(store));
  } catch (err) {
    // 配额不足：base 里的日志明细可以从服务端重新拉取，先丢掉它们；待上传记录必须保留
    console.warn('本地同步数据保存失败，尝试精简:', err);
    try {
      storage.setItem(storeKey(store.userId), JSON.stringify({ ...store, base: { ...store.base, logs: [] }, cursor: 0 }));
    } catch {
      // 仍失败则放弃本次写入
    }
  }
}

/** 页面显示的进度 */
export function viewState(store: SyncStore): ProgressState {
  const base = store.pendingSettings
    ? { ...store.base, settings: { ...store.base.settings, ...store.pendingSettings } }
    : store.base;
  return replayRecords(base, store.pendingLogs, store.pendingEvents);
}

export function hasPending(store: SyncStore): boolean {
  return store.pendingLogs.length > 0 || store.pendingEvents.length > 0 || store.pendingSettings !== null;
}

/** 取一批待上传记录 */
export function nextBatch(store: SyncStore, timezone?: string): SyncIn {
  return {
    logs: store.pendingLogs.slice(0, SYNC_BATCH),
    events: store.pendingEvents.slice(0, SYNC_BATCH).map(({ rootId: _rootId, ...ev }) => ev),
    timezone,
    since: store.cursor,
  };
}

function toWordProgress(w: SyncOut['words'][string]): WordProgress {
  const { masteredAt, ...rest } = w;
  return masteredAt === null ? rest : { ...rest, masteredAt };
}

/**
 * 合并服务端响应：替换 base，移除本次已确认的记录。
 * sent 为本次请求上传的记录 id；请求期间新产生的记录不在其中，会继续保留。
 */
export function applyServer(store: SyncStore, out: SyncOut, sent?: { logIds: string[]; eventIds: string[] }): SyncStore {
  const logIds = new Set(sent?.logIds);
  const eventIds = new Set(sent?.eventIds);
  const newLogs: ReviewLog[] = out.logs.map(({ answer, ...l }) => ({
    ...l,
    ...(answer === null ? {} : { answer }),
  }));
  const words: ProgressState['words'] = {};
  for (const [id, w] of Object.entries(out.words)) words[Number(id)] = toWordProgress(w);

  return {
    ...store,
    base: {
      version: 2,
      words,
      daily: out.daily,
      settings: { ...store.base.settings, ...out.settings },
      logs: [...store.base.logs, ...newLogs].slice(-MAX_LOGS),
    },
    pendingLogs: store.pendingLogs.filter((l) => !logIds.has(l.id)),
    pendingEvents: store.pendingEvents.filter((e) => !eventIds.has(e.id)),
    cursor: out.cursor,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { syncProgress, updateMe } from '../api/endpoints';
import type { RootData } from '../types';
import type { ReviewLog, StudyEvent, StudySettings } from '../types/progress';
import { newClientId, type RecordAnswerInput } from '../store/progressCore';
import { backupIdSpace, exportState, loadState, parseBackup, LEGACY_RECORDS_KEY, STORAGE_KEY } from '../store/persistence';
import { migrateLocalState } from '../store/migration';
import { browserTimezone } from '../utils/settings';
import {
  applyServer,
  hasPending,
  loadStore,
  nextBatch,
  saveStore,
  storeKey,
  viewState,
  type SyncStore,
} from '../store/syncStore';

const SAVE_DEBOUNCE_MS = 400;
/** 产生新记录后等待一会儿再上传，把连续操作合并成一次请求 */
const SYNC_DEBOUNCE_MS = 3_000;
/** 定期拉取其他设备的进度 */
const PULL_INTERVAL_MS = 5 * 60_000;
/** 上传失败后的重试间隔 */
const RETRY_MS = 30_000;
/** 页面关闭时用 keepalive 发出的请求体上限约 64KB，只带一小批 */
const KEEPALIVE_BATCH = 100;
/** 已处理过（迁移或拒绝）接入后端前的本机数据 */
const LEGACY_DONE_KEY = 'etymomind:v2:migrated';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';


/** StrictMode 下 effect 会执行两次，旧数据迁移的确认框只弹一次 */
let legacyPrompted = false;

/**
 * 学习进度：本地先记录、立即生效，后台批量上传到服务端；
 * 服务端回放后的结果作为新的基准，未确认的记录在其上回放得到页面显示的进度。
 */
export function useProgress(userId: number, roots: RootData[]) {
  // 每次打开页面记为一次学习（在初始化时追加，避免 StrictMode 下 effect 重复执行导致重复计数）
  const [initial] = useState<SyncStore>(() => {
    const s = loadStore(userId);
    const now = Date.now();
    return { ...s, pendingEvents: [...s.pendingEvents, { id: newClientId('s', now), kind: 'session', value: 0, at: now }] };
  });
  const [store, setStore] = useState(initial);
  const storeRef = useRef(initial);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const saveTimer = useRef<number | undefined>(undefined);
  const syncTimer = useRef<number | undefined>(undefined);
  const syncing = useRef<Promise<void> | null>(null);
  const syncRef = useRef<() => Promise<void>>(async () => {});

  const scheduleSync = useCallback((delay = SYNC_DEBOUNCE_MS) => {
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void syncRef.current(), delay);
  }, []);

  /** 所有修改都经过这里：同步更新 ref（供后台同步读取最新值），并防抖写入 localStorage */
  const commit = useCallback((fn: (s: SyncStore) => SyncStore, sync = true) => {
    const next = fn(storeRef.current);
    if (next === storeRef.current) return;
    storeRef.current = next;
    setStore(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveStore(storeRef.current), SAVE_DEBOUNCE_MS);
    if (sync && hasPending(next)) scheduleSync();
  }, [scheduleSync]);

  const pushLog = useCallback((log: ReviewLog) => {
    commit((s) => ({ ...s, pendingLogs: [...s.pendingLogs, log] }));
  }, [commit]);

  const pushEvent = useCallback((ev: StudyEvent) => {
    commit((s) => ({ ...s, pendingEvents: [...s.pendingEvents, ev] }));
  }, [commit]);

  /** 上传全部待同步记录并拉取服务端最新进度；并发调用共用同一次 */
  const syncNow = useCallback((): Promise<void> => {
    syncing.current ??= (async () => {
      setStatus('syncing');
      try {
        const settings = storeRef.current.pendingSettings;
        if (settings) {
          await updateMe(settings);
          // 请求期间又改了设置时保留新的修改
          commit((s) => (s.pendingSettings === settings ? { ...s, pendingSettings: null } : s), false);
        }
        for (;;) {
          const batch = nextBatch(storeRef.current, browserTimezone());
          const sent = { logIds: batch.logs.map((l) => l.id), eventIds: batch.events.map((e) => e.id) };
          const out = await syncProgress(batch);
          commit((s) => applyServer(s, out, sent), false);
          const s = storeRef.current;
          if (!out.hasMore && s.pendingLogs.length === 0 && s.pendingEvents.length === 0) break;
        }
        setStatus('idle');
        setLastSyncedAt(Date.now());
      } catch (err) {
        const offline = err instanceof ApiError && (err.status === 0 || err.status === 401 || err.status >= 500);
        setStatus(offline ? 'offline' : 'error');
        if (!offline) console.warn('同步失败:', err);
        scheduleSync(RETRY_MS);
      } finally {
        syncing.current = null;
      }
    })();
    return syncing.current;
  }, [commit, scheduleSync]);

  useEffect(() => {
    syncRef.current = syncNow;
  }, [syncNow]);

  // 首次进入立即同步；之后定期拉取，网络恢复、页面切回前台时也同步一次
  useEffect(() => {
    void syncNow();
    const pull = window.setInterval(() => void syncNow(), PULL_INTERVAL_MS);
    const onOnline = () => void syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(pull);
      window.clearTimeout(syncTimer.current);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [syncNow]);

  // 页面关闭前立即落盘，并尽量把最后一小批记录发出去（未确认的下次打开会重传，服务端去重）
  useEffect(() => {
    const flush = () => {
      window.clearTimeout(saveTimer.current);
      saveStore(storeRef.current);
      const s = storeRef.current;
      if (s.pendingLogs.length || s.pendingEvents.length) {
        const batch = nextBatch(s, browserTimezone());
        void syncProgress(
          { ...batch, logs: batch.logs.slice(0, KEEPALIVE_BATCH), events: batch.events.slice(0, KEEPALIVE_BATCH) },
          true
        ).catch(() => {});
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.clearTimeout(saveTimer.current);
      saveStore(storeRef.current);
    };
  }, []);

  // 其他标签页修改了数据时同步过来
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storeKey(userId)) return;
      const next = loadStore(userId);
      storeRef.current = next;
      setStore(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  /** 把旧格式的学习数据转换为待上传记录，返回导入的作答数与无法匹配而丢弃的作答数 */
  const importState = useCallback(
    (state: ReturnType<typeof loadState>, idSpace: 'mock' | 'server') => {
      // 已有数据的学习日不再合成时长等事件，避免同一份备份导入两次时重复累计
      const skipDays = new Set(Object.keys(viewState(storeRef.current).daily));
      const { logs, events, skipped } = migrateLocalState(state, roots, idSpace, skipDays);
      commit((s) => ({ ...s, pendingLogs: [...s.pendingLogs, ...logs], pendingEvents: [...s.pendingEvents, ...events] }));
      void syncRef.current();
      return { imported: logs.length, skipped };
    },
    [commit, roots]
  );

  // 接入后端之前保存在本机的数据：询问一次是否上传到当前账号
  useEffect(() => {
    if (legacyPrompted || roots.length === 0) return;
    legacyPrompted = true;
    if (localStorage.getItem(LEGACY_DONE_KEY)) return;
    if (!localStorage.getItem(STORAGE_KEY) && !localStorage.getItem(LEGACY_RECORDS_KEY)) return;
    const legacy = loadState();
    if (Object.keys(legacy.words).length === 0 && Object.keys(legacy.daily).length === 0) return;
    // 推迟到首帧之后再弹窗，避免阻塞页面渲染
    const timer = window.setTimeout(() => {
      localStorage.setItem(LEGACY_DONE_KEY, String(userId));
      if (window.confirm('检测到本浏览器中有之前的学习记录，是否合并到当前账号？\n（选择“取消”不会删除这些记录）')) {
        importState(legacy, 'mock');
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [importState, roots.length, userId]);

  const state = useMemo(() => viewState(store), [store]);

  const answer = useCallback(
    (input: Omit<RecordAnswerInput, 'now' | 'id'>) => {
      const now = Date.now();
      pushLog({
        id: newClientId(String(input.wordId), now),
        wordId: input.wordId,
        rootId: input.rootId,
        skill: input.skill,
        result: input.result,
        answer: input.answer?.slice(0, 255),
        hintLevel: input.hintLevel ?? 0,
        responseMs: Math.min(Math.max(0, Math.round(input.responseMs ?? 0)), 3_600_000),
        at: now,
      });
    },
    [pushLog]
  );

  const addTime = useCallback(
    (ms: number, wordIds?: number[]) => {
      if (ms <= 0) return;
      const now = Date.now();
      pushEvent({ id: newClientId('t', now), kind: 'time', value: Math.min(Math.round(ms), 3_600_000), wordIds: wordIds?.slice(0, 500), at: now });
    },
    [pushEvent]
  );

  const playAudio = useCallback(
    (wordId?: number) => {
      const now = Date.now();
      pushEvent({ id: newClientId('a', now), kind: 'audio', wordId, value: 0, at: now });
    },
    [pushEvent]
  );

  const favorite = useCallback(
    (wordId: number, rootId: number) => {
      const now = Date.now();
      const current = viewState(storeRef.current).words[wordId]?.favorite ?? false;
      pushEvent({ id: newClientId('f', now), kind: 'favorite', wordId, rootId, value: current ? 0 : 1, at: now });
    },
    [pushEvent]
  );

  const setSettings = useCallback(
    (patch: Partial<StudySettings>) => {
      commit((s) => ({ ...s, pendingSettings: { ...s.pendingSettings, ...patch } }));
    },
    [commit]
  );

  const exportBackup = useCallback(() => exportState(viewState(storeRef.current), 'server'), []);

  /** 导入备份：合并到当前账号（不会覆盖已有记录）；格式不对时抛错 */
  const importBackup = useCallback(
    (text: string) => importState(parseBackup(text), backupIdSpace(text)),
    [importState]
  );

  const pendingCount = store.pendingLogs.length + store.pendingEvents.length + (store.pendingSettings ? 1 : 0);

  return {
    state,
    status,
    pendingCount,
    lastSyncedAt,
    syncNow,
    answer,
    addTime,
    playAudio,
    favorite,
    setSettings,
    exportBackup,
    importBackup,
  };
}

export type ProgressApi = ReturnType<typeof useProgress>;

/**
 * 把接入后端之前保存在本机的学习数据（或旧备份文件）转换为待上传记录。
 *
 * 旧数据的单词 id 来自 mock 词库（101、102…），与数据库生成的 id 不同，这里按单词拼写重新映射。
 * 旧版本只为作答留了日志，学习时长、发音、打开次数只有每日汇总，收藏只有最终状态，
 * 因此按天合成对应事件。所有记录 id 由内容确定，重复迁移会被服务端去重。
 */
import { MOCK_ROOTS } from '../mock/roots';
import type { RootData } from '../types';
import type { ProgressState, ReviewLog, StudyEvent } from '../types/progress';

/** 与后端 StudyEvent.value 上限一致：单条时长不超过 1 小时 */
const MAX_TIME_EVENT_MS = 3_600_000;

export interface MigrationResult {
  logs: ReviewLog[];
  events: StudyEvent[];
  /** 新词库里找不到对应单词、被丢弃的作答数 */
  skipped: number;
}

/** 旧 id → 新 id。按拼写匹配（不区分大小写） */
function buildIdMap(serverRoots: RootData[]): Map<number, { wordId: number; rootId: number }> {
  const byText = new Map<string, { wordId: number; rootId: number }>();
  for (const r of serverRoots) {
    for (const w of r.words) byText.set(w.word.toLowerCase(), { wordId: w.wordId, rootId: r.id });
  }
  const map = new Map<number, { wordId: number; rootId: number }>();
  for (const r of MOCK_ROOTS) {
    for (const w of r.words) {
      const target = byText.get(w.word.toLowerCase());
      if (target) map.set(w.wordId, target);
    }
  }
  return map;
}

/**
 * idSpace：数据里的单词 id 属于哪套编号。
 * - mock：接入后端之前的本机数据和旧备份
 * - server：接入后端之后导出的备份，id 已是数据库 id
 */
export function migrateLocalState(
  state: ProgressState,
  serverRoots: RootData[],
  idSpace: 'mock' | 'server' = 'mock',
  /** 这些学习日已有数据（导入到同一账号时），不再按每日汇总合成时长 / 发音 / 打开次数，避免重复累计 */
  skipDays: ReadonlySet<string> = new Set()
): MigrationResult {
  const serverIndex = new Map(
    serverRoots.flatMap((r) => r.words.map((w) => [w.wordId, { wordId: w.wordId, rootId: r.id }] as const))
  );
  const idMap = idSpace === 'mock' ? buildIdMap(serverRoots) : serverIndex;
  const resolve = (oldId: number) => idMap.get(oldId);

  let skipped = 0;
  const logs: ReviewLog[] = [];
  for (const log of state.logs) {
    const target = resolve(log.wordId);
    if (!target) {
      skipped += 1;
      continue;
    }
    // server 编号的备份来自本系统导出，保留原 id，重复导入会被服务端去重
    const id = idSpace === 'server' ? log.id : `mig-${log.id}`.slice(0, 64);
    logs.push({ ...log, ...target, id, answer: log.answer?.slice(0, 255), responseMs: Math.min(log.responseMs, MAX_TIME_EVENT_MS) });
  }

  const events: StudyEvent[] = [];
  for (const d of Object.values(state.daily)) {
    if (skipDays.has(d.date)) continue;
    const at = d.firstAt || Date.parse(`${d.date}T12:00:00`);
    for (let i = 0, left = d.activeMs; left > 0; i++, left -= MAX_TIME_EVENT_MS) {
      events.push({ id: `mig-t-${d.date}-${i}`, kind: 'time', value: Math.min(left, MAX_TIME_EVENT_MS), at: at + i });
    }
    for (let i = 0; i < d.sessions; i++) events.push({ id: `mig-s-${d.date}-${i}`, kind: 'session', value: 0, at: at + i });
    for (let i = 0; i < d.audioPlays; i++) events.push({ id: `mig-a-${d.date}-${i}`, kind: 'audio', value: 0, at: at + i });
  }
  for (const w of Object.values(state.words)) {
    const target = resolve(w.wordId);
    if (!w.favorite || !target) continue;
    events.push({ id: `mig-f-${target.wordId}`, kind: 'favorite', ...target, value: 1, at: w.firstSeenAt || 1 });
  }

  return { logs, events, skipped };
}

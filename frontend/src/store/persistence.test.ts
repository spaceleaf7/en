import { describe, expect, it } from 'vitest';
import { createInitialState, recordAnswer } from './progressCore';
import {
  exportState,
  LEGACY_RECORDS_KEY,
  loadState,
  parseBackup,
  saveState,
  STORAGE_KEY,
} from './persistence';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  quotaBytes = Infinity;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    if (v.length > this.quotaBytes) throw new DOMException('quota', 'QuotaExceededError');
    this.map.set(k, v);
  }
}

const T0 = new Date(2026, 9, 17, 10, 0, 0).getTime();

describe('persistence', () => {
  it('保存后可完整读回', () => {
    const storage = new MemoryStorage();
    const s = recordAnswer(createInitialState(), { wordId: 101, rootId: 1, skill: 'spell', result: 'correct', now: T0 });
    saveState(s, storage);
    expect(loadState(storage)).toEqual(s);
  });

  it('没有数据或数据损坏时返回空状态', () => {
    const storage = new MemoryStorage();
    expect(loadState(storage)).toEqual(createInitialState());
    storage.setItem(STORAGE_KEY, '{oops');
    expect(loadState(storage)).toEqual(createInitialState());
  });

  it('迁移 v1 提交记录为每日时长与次数', () => {
    const storage = new MemoryStorage();
    const t1 = new Date(2026, 9, 16, 20, 0).getTime();
    const t2 = new Date(2026, 9, 16, 21, 0).getTime();
    storage.setItem(
      LEGACY_RECORDS_KEY,
      JSON.stringify([
        { id: t2, rootId: 1, accuracyRate: 50, studyDurationSeconds: 30 },
        { id: t1, rootId: 2, accuracyRate: 100, studyDurationSeconds: 90 },
      ])
    );
    const day = loadState(storage).daily['2026-10-16'];
    expect(day).toMatchObject({ activeMs: 120_000, sessions: 2, firstAt: t1, lastAt: t2 });
  });

  it('超出存储配额时精简日志后重试', () => {
    const storage = new MemoryStorage();
    let s = createInitialState();
    for (let i = 0; i < 40; i++) {
      s = recordAnswer(s, { wordId: 101, rootId: 1, skill: 'spell', result: 'correct', now: T0 + i });
    }
    storage.quotaBytes = JSON.stringify(s).length - 1;
    saveState(s, storage);
    expect(loadState(storage).logs).toHaveLength(20);
  });

  it('导出的备份可以导入；非法文件给出明确错误', () => {
    const s = recordAnswer(createInitialState(), { wordId: 101, rootId: 1, skill: 'spell', result: 'correct', now: T0 });
    expect(parseBackup(exportState(s))).toEqual(s);
    expect(parseBackup(JSON.stringify(s))).toEqual(s);
    expect(() => parseBackup('not json')).toThrow('不是有效的 JSON');
    expect(() => parseBackup('{"foo":1}')).toThrow('不是 EtymoMind 的学习数据备份');
  });
});

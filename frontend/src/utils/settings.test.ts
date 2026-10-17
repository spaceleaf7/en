import { describe, expect, it } from 'vitest';
import { createStore, hasPending, viewState, applyServer } from '../store/syncStore';
import type { SyncOut } from '../api/endpoints';
import { validateGoal, validateNickname } from './settings';

describe('validateGoal', () => {
  it('接受范围内的整数', () => {
    expect(validateGoal('dailyNewGoal', '1')).toBeNull();
    expect(validateGoal('dailyNewGoal', ' 200 ')).toBeNull();
    expect(validateGoal('dailyMinutesGoal', '600')).toBeNull();
  });

  it('拒绝空值、非整数和超出范围', () => {
    expect(validateGoal('dailyNewGoal', '')).toMatch('请填写');
    expect(validateGoal('dailyNewGoal', '1.5')).toMatch('整数');
    expect(validateGoal('dailyNewGoal', '-3')).toMatch('整数');
    expect(validateGoal('dailyNewGoal', '0')).toMatch('1-200');
    expect(validateGoal('dailyNewGoal', '201')).toMatch('1-200');
    expect(validateGoal('dailyMinutesGoal', '601')).toMatch('1-600');
  });
});

describe('validateNickname', () => {
  it('去掉首尾空格后 1-32 位', () => {
    expect(validateNickname('  小艾 ')).toBeNull();
    expect(validateNickname('x'.repeat(32))).toBeNull();
    expect(validateNickname('   ')).toMatch('不能为空');
    expect(validateNickname('x'.repeat(33))).toMatch('32');
  });
});

describe('学习目标的本地生效与同步', () => {
  const serverOut = (settings: SyncOut['settings']): SyncOut => ({
    acceptedLogs: 0,
    acceptedEvents: 0,
    words: {},
    daily: {},
    settings,
    logs: [],
    cursor: 0,
    hasMore: false,
  });

  it('修改后立即反映在页面显示的进度里', () => {
    const store = { ...createStore(1), pendingSettings: { dailyNewGoal: 30 } };
    expect(hasPending(store)).toBe(true);
    expect(viewState(store).settings).toEqual({ dailyNewGoal: 30, dailyMinutesGoal: 15 });
  });

  it('上传成功、清空 pendingSettings 后以服务端结果为准', () => {
    const store = createStore(1);
    const synced = applyServer(store, serverOut({ dailyNewGoal: 30, dailyMinutesGoal: 45 }));
    expect(hasPending(synced)).toBe(false);
    expect(viewState(synced).settings).toEqual({ dailyNewGoal: 30, dailyMinutesGoal: 45 });
  });
});

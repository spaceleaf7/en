import type { RootData } from '../types';
import type { DailyStats, ReviewLog, SkillState, StudyEvent, StudySettings } from '../types/progress';
import { request, setAccessToken } from './client';

// ───────────────────────── 认证 ─────────────────────────

export interface User {
  id: number;
  username: string;
  nickname: string;
  isAdmin: boolean;
  dailyNewGoal: number;
  dailyMinutesGoal: number;
  timezone: string;
}

interface TokenOut {
  accessToken: string;
  tokenType: 'bearer';
  expiresIn: number;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await request<TokenOut>('/auth/login', { method: 'POST', body: { username, password } });
  setAccessToken(res.accessToken);
}

export async function register(username: string, password: string, nickname: string): Promise<void> {
  const res = await request<TokenOut>('/auth/register', { method: 'POST', body: { username, password, nickname } });
  setAccessToken(res.accessToken);
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST' });
  } finally {
    setAccessToken(null);
  }
}

export const getMe = () => request<User>('/auth/me');

export const updateMe = (patch: Partial<Pick<User, 'nickname' | 'timezone'> & StudySettings>) =>
  request<User>('/auth/me', { method: 'PATCH', body: patch });

// ───────────────────────── 词库 ─────────────────────────

export const getRoots = () => request<RootData[]>('/vocab/roots');

// ───────────────────────── 同步 ─────────────────────────

export interface WordProgressOut {
  wordId: number;
  rootId: number;
  spell: SkillState;
  meaning: SkillState;
  firstSeenAt: number;
  masteredAt: number | null;
  studyMs: number;
  avgResponseMs: number;
  responseSamples: number;
  audioPlays: number;
  hintsUsed: number;
  recentWrong: string[];
  favorite: boolean;
}

export interface SyncLogOut extends Omit<ReviewLog, 'answer'> {
  answer: string | null;
}

export interface SyncOut {
  acceptedLogs: number;
  acceptedEvents: number;
  words: Record<string, WordProgressOut>;
  daily: Record<string, DailyStats>;
  settings: StudySettings;
  logs: SyncLogOut[];
  cursor: number;
  hasMore: boolean;
}

export interface SyncIn {
  logs: ReviewLog[];
  /** rootId 只在本地回放用，上传时去掉 */
  events: Omit<StudyEvent, 'rootId'>[];
  timezone?: string;
  since: number;
}

export const syncProgress = (body: SyncIn, keepalive = false) =>
  request<SyncOut>('/progress/sync', { method: 'POST', body, keepalive });

export const getProgress = (since: number) => request<SyncOut>(`/progress?since=${since}`);

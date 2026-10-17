/** 考核维度：默写拼写 / 中文释义 / 浏览模式自评 */
export type Skill = 'spell' | 'meaning';
export type LogSkill = Skill | 'self';
export type ReviewResult = 'correct' | 'wrong' | 'skip';
/** 0 无提示，1 首字母，2 听发音，3 查看答案 */
export type HintLevel = 0 | 1 | 2 | 3;
export type MasteryLevel = 0 | 1 | 2 | 3 | 4 | 5;

/** 原始作答日志：每次作答一条，所有统计均可由此重算 */
export interface ReviewLog {
  id: string;
  wordId: number;
  rootId: number;
  skill: LogSkill;
  result: ReviewResult;
  answer?: string;
  hintLevel: HintLevel;
  responseMs: number;
  at: number;
}

export type StudyEventKind = 'time' | 'audio' | 'session' | 'favorite';

/** 非作答类事件：与作答日志一起上传，服务端按时间回放重建进度 */
export interface StudyEvent {
  id: string;
  kind: StudyEventKind;
  wordId?: number;
  /** 仅本地回放收藏时使用，不上传（服务端按 wordId 查词根） */
  rootId?: number;
  /** time：毫秒；favorite：1 收藏 / 0 取消 */
  value: number;
  /** time：分摊学习时长的单词 */
  wordIds?: number[];
  at: number;
}

export interface SkillState {
  correct: number;
  wrong: number;
  streak: number;
  level: MasteryLevel;
  lastReviewAt: number;
  nextReviewAt: number;
}

export interface WordProgress {
  wordId: number;
  rootId: number;
  spell: SkillState;
  meaning: SkillState;
  firstSeenAt: number;
  masteredAt?: number;
  studyMs: number;
  avgResponseMs: number;
  /** 参与平均用时计算的作答次数 */
  responseSamples: number;
  audioPlays: number;
  hintsUsed: number;
  /** 最近的错误答案（新在前，最多 5 条） */
  recentWrong: string[];
  favorite: boolean;
}

export interface DailyStats {
  /** 学习日（凌晨 4 点换日），格式 YYYY-MM-DD */
  date: string;
  activeMs: number;
  newWords: number;
  /** 当日复习过的单词 id（去重），长度即复习词数 */
  reviewedWordIds: number[];
  masteredWords: number;
  answers: number;
  correct: number;
  audioPlays: number;
  sessions: number;
  firstAt: number;
  lastAt: number;
  /** 按小时（0-23）统计的作答次数，用于学习时段分布 */
  hourly: number[];
}

export interface StudySettings {
  dailyNewGoal: number;
  dailyMinutesGoal: number;
}

export interface ProgressState {
  version: 2;
  words: Record<number, WordProgress>;
  daily: Record<string, DailyStats>;
  logs: ReviewLog[];
  settings: StudySettings;
}

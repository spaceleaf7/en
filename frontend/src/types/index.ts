export interface WordItem {
  wordId: number;
  word: string;
  phonetic: string;
  phoneticAudio: string;
  chineseMeaning: string;
  breakdown: string;
  exampleSentence: string;
  exampleAudio: string;
}

export interface RootData {
  id: number;
  rootText: string;
  meaning: string;
  words: WordItem[];
}

export type StudyMode = 1 | 2 | 3; // 1: 填空单词, 2: 填空注释, 3: 浏览模式

export interface AnswerItem {
  userAnswer: string;
  isCorrect?: boolean;
  showAnswer?: boolean;
}

export type AnswerMap = Record<number, AnswerItem>;

export interface StudyRecord {
  id: number;
  rootId: number;
  rootText: string;
  mode: StudyMode;
  accuracyRate: number;
  studyDurationSeconds: number;
  createdAt: string;
}

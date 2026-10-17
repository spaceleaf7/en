import type { WordItem } from '../types';

const SENSE_SEPARATORS = /[；;，,、/\s]+/;

/** 去掉词性前缀（adj. / v./n.），按分隔符拆出各义项 */
function splitMeaningSenses(meaning: string): string[] {
  return meaning
    .replace(/[a-zA-Z]+\./g, '')
    .split(SENSE_SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 模式1：英文单词，忽略大小写与首尾空格 */
export function checkWordAnswer(input: string, word: WordItem): boolean {
  return input.trim().toLowerCase() === word.word.trim().toLowerCase();
}

/**
 * 模式2：中文释义。用户可填一个或多个义项（用标点分隔），
 * 任意一项与参考义项完全一致，或至少 2 个字且与某义项互相包含即判对。
 * 例："可见" / "可见的" / "明显的；可见的" 均判对，单个"的"判错。
 */
export function checkMeaningAnswer(input: string, word: WordItem): boolean {
  const senses = splitMeaningSenses(word.chineseMeaning);
  const parts = input.split(SENSE_SEPARATORS).map((p) => p.trim()).filter(Boolean);

  return parts.some((p) =>
    senses.some((s) => s === p || (p.length >= 2 && (s.includes(p) || p.includes(s))))
  );
}

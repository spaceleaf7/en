import { describe, expect, it } from 'vitest';
import { checkMeaningAnswer, checkWordAnswer } from './grading';
import type { WordItem } from '../types';

const word = (w: string, meaning: string) => ({ word: w, chineseMeaning: meaning }) as WordItem;

describe('checkWordAnswer', () => {
  it('忽略大小写与首尾空格', () => {
    expect(checkWordAnswer(' Visible ', word('visible', ''))).toBe(true);
    expect(checkWordAnswer('visable', word('visible', ''))).toBe(false);
  });
});

describe('checkMeaningAnswer', () => {
  const visible = word('visible', 'adj. 可见的；明显的');

  it.each([
    ['可见的', true],
    ['可见', true],
    ['明显的；可见的', true],
    ['的', false],
    ['看不见', false],
    ['', false],
  ])('%s → %s', (input, expected) => {
    expect(checkMeaningAnswer(input, visible)).toBe(expected);
  });

  it('处理多词性前缀', () => {
    expect(checkMeaningAnswer('参观', word('visit', 'v./n. 拜访；参观；探望'))).toBe(true);
  });
});

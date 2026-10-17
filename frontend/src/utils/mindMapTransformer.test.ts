// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createCustomNodeContent, transformToMindMap } from './mindMapTransformer';
import { createInitialState, recordAnswer } from '../store/progressCore';
import { MOCK_ROOTS } from '../mock/roots';

const T0 = new Date(2026, 9, 17, 10, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const root = MOCK_ROOTS[0];

/** 模拟 simple-mind-map 节点对象，只需要 getData */
const fakeNode = (data: { text: string; customData: unknown }) => ({
  getData: (key: string) => (key === 'customData' ? data.customData : data.text),
});

describe('transformToMindMap 学习进度', () => {
  it('单词节点显示熟练度圆点与状态', () => {
    let s = createInitialState();
    for (let i = 0; i < 3; i++) {
      s = recordAnswer(s, { wordId: 101, rootId: 1, skill: 'spell', result: 'wrong', answer: 'visable', now: T0 + i });
    }
    s = recordAnswer(s, { wordId: 102, rootId: 1, skill: 'self', result: 'correct', now: T0 });

    const tree = transformToMindMap(root, 3, {}, s, T0 + 2 * DAY);
    const html = (i: number) => createCustomNodeContent(fakeNode(tree.children[i].data)).innerHTML;

    expect(html(0)).toContain('word-flag difficult');
    expect(html(1)).toContain('word-flag due'); // 自评后 1 级，两天后到期
    expect(html(1).match(/<i class="on">/g)).toHaveLength(1);
    expect(html(2)).toContain('title="未学习"');
    expect(html(2)).not.toContain('<i class="on">');
  });

  it('词根节点显示掌握概况', () => {
    const s = recordAnswer(createInitialState(), { wordId: 101, rootId: 1, skill: 'spell', result: 'correct', now: T0 });
    const tree = transformToMindMap(root, 3, {}, s, T0 + 2 * DAY);
    const html = createCustomNodeContent(fakeNode(tree.data)).innerHTML;
    expect(html).toContain(`已掌握 0/${root.words.length}`);
    expect(html).toContain('待复习 1');
  });

  it('不传进度时不渲染进度元素', () => {
    const tree = transformToMindMap(root, 3, {});
    expect(createCustomNodeContent(fakeNode(tree.children[0].data)).innerHTML).not.toContain('word-progress');
    expect(createCustomNodeContent(fakeNode(tree.data)).innerHTML).not.toContain('node-root-stats');
  });
});

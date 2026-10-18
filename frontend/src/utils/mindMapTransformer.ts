import type { RootData, StudyMode, AnswerMap } from '../types';
import type { ProgressState } from '../types/progress';
import { getBranchColor } from './branchColors';
import { getWordLevel, getWordStatus, isDifficult, isDue, summarizeRoot, type RootSummary, type WordStatus } from './stats';

/** 单词节点上展示的学习进度 */
export interface WordProgressView {
  level: number; // 0-5，取拼写与释义中较弱的一项
  status: WordStatus;
  difficult: boolean;
  due: boolean;
  favorite: boolean;
}

export interface MindMapCustomNodeData {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  rootId?: number;
  wordId?: number;
  title?: string;
  subTitle?: string;
  word?: string;
  phonetic?: string;
  phoneticAudio?: string;
  chineseMeaning?: string;
  breakdown?: string;
  exampleSentence?: string;
  exampleAudio?: string;
  mode?: StudyMode;
  userAnswer?: string;
  isCorrect?: boolean;
  showAnswer?: boolean;
  locked?: boolean; // 已提交批改，输入框只读
  branchColor?: string; // 所在分支的彩虹色，与连线颜色一致
  progress?: WordProgressView; // 2级单词节点的学习进度
  rootSummary?: RootSummary; // 1级词根节点的掌握概况
}

interface MindMapTreeNode {
  data: { text: string; expand: boolean; customData: MindMapCustomNodeData };
  children: MindMapTreeNode[];
}

/** 各模式展示的层级：模式A 去掉音标与构词，避免发音 / 拆解直接提示单词拼写 */
const MODE_VISIBLE_LEVELS: Record<StudyMode, MindMapCustomNodeData['level'][]> = {
  1: [2, 4, 6],
  2: [2, 3, 4, 5, 6],
  3: [2, 3, 4, 5, 6],
};

/** 模式1下把例句里的目标单词（含词形变化）替换为下划线，避免直接泄露答案 */
function maskWordInSentence(sentence: string, word: string): string {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sentence.replace(new RegExp(`\\b${escaped}[a-z]*\\b`, 'gi'), (m) => '_'.repeat(Math.max(4, m.length)));
}

/** 模式2下去掉构词拆解 "→" 之后的引申释义，保留词素提示 */
function stripBreakdownMeaning(breakdown: string): string {
  return breakdown.split('→')[0].trim();
}

export function transformToMindMap(
  root: RootData,
  mode: StudyMode,
  answers: AnswerMap = {},
  progress?: ProgressState,
  now: number = Date.now()
) {
  return {
    data: {
      text: root.rootText,
      expand: true,
      customData: {
        level: 1,
        rootId: root.id,
        title: root.rootText,
        subTitle: root.meaning,
        mode,
        rootSummary: progress
          ? summarizeRoot(progress, root.words.map((w) => w.wordId), now)
          : undefined,
      } as MindMapCustomNodeData,
    },
    children: root.words.map((w, index) => {
      const ans = answers[w.wordId] || { userAnswer: '' };
      const locked = ans.isCorrect !== undefined;

      const chain: MindMapCustomNodeData[] = [
        // 2级节点：单词（模式1填空）
        {
          level: 2,
          rootId: root.id,
          wordId: w.wordId,
          word: w.word,
          progress: progress ? getProgressView(progress, w.wordId, now) : undefined,
          mode,
          userAnswer: ans.userAnswer,
          isCorrect: ans.isCorrect,
          showAnswer: ans.showAnswer,
          locked,
        },
        // 3级节点：音标与发音
        {
          level: 3,
          wordId: w.wordId,
          phonetic: w.phonetic,
          phoneticAudio: w.phoneticAudio,
          mode,
        },
        // 4级节点：中文注释（模式2填空）
        {
          level: 4,
          wordId: w.wordId,
          chineseMeaning: w.chineseMeaning,
          mode,
          userAnswer: ans.userAnswer,
          isCorrect: ans.isCorrect,
          showAnswer: ans.showAnswer,
          locked,
        },
        // 5级节点：词根拆解
        {
          level: 5,
          wordId: w.wordId,
          breakdown: mode === 2 ? stripBreakdownMeaning(w.breakdown) : w.breakdown,
          mode,
        },
        // 6级节点：例句与例句音频
        {
          level: 6,
          wordId: w.wordId,
          exampleSentence:
            mode === 1 ? maskWordInSentence(w.exampleSentence, w.word) : w.exampleSentence,
          exampleAudio: w.exampleAudio,
          mode,
        },
      ];

      // 整条分支（2~6级）共用同一彩虹色，与连线颜色一致
      const branchColor = getBranchColor(index);
      chain.forEach((d) => (d.branchColor = branchColor));

      const visible = chain.filter((d) => MODE_VISIBLE_LEVELS[mode].includes(d.level));
      return nestChain(visible)!;
    }),
  };
}

function getProgressView(state: ProgressState, wordId: number, now: number): WordProgressView {
  const p = state.words[wordId];
  return {
    level: getWordLevel(p),
    status: getWordStatus(p),
    difficult: p ? isDifficult(p) : false,
    due: isDue(p, now),
    favorite: p?.favorite ?? false,
  };
}

/** 熟练度圆点 + 状态角标（易错 / 待复习 / 已掌握），渲染在单词节点右侧 */
function renderProgressBadgeHtml(view?: WordProgressView): string {
  if (!view) return '';
  const dots = Array.from({ length: 5 }, (_, i) => `<i class="${i < view.level ? 'on' : ''}"></i>`).join('');
  let tag = '';
  if (view.difficult) tag = '<span class="word-flag difficult">易错</span>';
  else if (view.due) tag = '<span class="word-flag due">待复习</span>';
  else if (view.status === 'mastered') tag = '<span class="word-flag mastered">已掌握</span>';
  const label = view.status === 'new' ? '未学习' : `熟练度 ${view.level}/5`;
  return `<span class="word-progress" title="${label}"><span class="level-dots">${dots}</span>${tag}</span>`;
}

const STAR_PATH =
  'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z';

/** 收藏星标：只在浏览模式渲染，避免默写 / 考核时误触；绝对定位，切换状态不改变节点宽度 */
function renderFavoriteBtnHtml(d: MindMapCustomNodeData): string {
  if (d.mode !== 3 || !d.progress || d.wordId === undefined) return '';
  const on = d.progress.favorite;
  const label = on ? '取消收藏' : '收藏单词';
  return `
    <button class="favorite-btn${on ? ' on' : ''}" data-word-id="${d.wordId}" data-root-id="${d.rootId ?? ''}" aria-pressed="${on}" aria-label="${label}" title="${label}">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="${STAR_PATH}"></path>
      </svg>
      <span class="favorite-label">收藏</span>
    </button>`;
}

function renderRootSummaryHtml(summary?: RootSummary): string {
  if (!summary) return '';
  const pct = summary.total ? Math.round((summary.mastered / summary.total) * 100) : 0;
  const due = summary.due > 0 ? `<span class="root-stat-due">待复习 ${summary.due}</span>` : '';
  return `
    <div class="node-root-stats">
      <div class="root-progress-bar"><span style="width:${pct}%"></span></div>
      <div class="root-stat-line">
        <span>已掌握 ${summary.mastered}/${summary.total}</span>
        ${due}
      </div>
    </div>`;
}

/** 将同一单词的各级节点由上到下串成单链子树 */
function nestChain(chain: MindMapCustomNodeData[]): MindMapTreeNode | null {
  return chain.reduceRight<MindMapTreeNode | null>(
    (child, customData) => ({
      data: { text: getNodeText(customData), expand: true, customData },
      children: child ? [child] : [],
    }),
    null
  );
}

function getNodeText(d: MindMapCustomNodeData): string {
  return d.word ?? d.phonetic ?? d.chineseMeaning ?? d.breakdown ?? d.exampleSentence ?? '';
}

/**
 * 现代精致设计 - simple-mind-map 自定义节点创建函数
 */
export function createCustomNodeContent(node: any): HTMLElement {
  const customData: MindMapCustomNodeData = node.getData('customData') || {
    level: 1,
    title: node.getData('text') || '',
  };

  const container = document.createElement('div');
  container.className = 'custom-node-wrapper';
  container.style.display = 'inline-block';
  container.style.userSelect = 'none';
  // 分支色通过 CSS 变量下发，子元素样式统一用 var(--branch-color)
  if (customData.branchColor) {
    container.style.setProperty('--branch-color', customData.branchColor);
  }

  switch (customData.level) {
    case 1: {
      // 1级：词根本体根节点
      container.innerHTML = `
        <div class="node-card node-level-1">
          <div class="node-root-tag">ROOT · 词根</div>
          <div class="node-root-title">${escapeHtml(customData.title || '')}</div>
          <div class="node-root-meaning">${escapeHtml(customData.subTitle || '')}</div>
          ${renderRootSummaryHtml(customData.rootSummary)}
        </div>
      `;
      break;
    }

    case 2: {
      // 2级：单词节点（模式1填空）
      if (customData.mode === 1) {
        container.innerHTML = renderWordQuizNodeHtml({
          wordId: customData.wordId!,
          value: customData.userAnswer || '',
          correctAnswer: customData.word || '',
          isCorrect: customData.isCorrect,
          showAnswer: customData.showAnswer,
          locked: customData.locked,
          placeholder: '输入单词...',
        });
      } else {
        const favoriteHtml = renderFavoriteBtnHtml(customData);
        container.innerHTML = `
          <div class="node-card node-uniform-box node-level-2${favoriteHtml ? ' has-fav' : ''}">
            <span class="node-word-text">${escapeHtml(customData.word || '')}</span>
            ${renderProgressBadgeHtml(customData.progress)}
            ${favoriteHtml}
          </div>
        `;
      }
      break;
    }

    case 3: {
      // 3级：音标与发音
      container.innerHTML = `
        <div class="node-card node-uniform-box node-level-3">
          <span class="node-phonetic-text">${escapeHtml(customData.phonetic || '')}</span>
          <button class="audio-btn" data-audio="${encodeURI(customData.phoneticAudio || '')}" data-word-id="${customData.wordId ?? ''}" title="播放标准发音" aria-label="播放标准发音">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"></path>
            </svg>
          </button>
        </div>
      `;
      break;
    }

    case 4: {
      // 4级：中文注释（模式2填空）
      if (customData.mode === 2) {
        container.innerHTML = renderMeaningQuizNodeHtml({
          wordId: customData.wordId!,
          value: customData.userAnswer || '',
          correctAnswer: customData.chineseMeaning || '',
          isCorrect: customData.isCorrect,
          showAnswer: customData.showAnswer,
          locked: customData.locked,
          placeholder: '填写中文注释...',
        });
      } else {
        container.innerHTML = `
          <div class="node-card node-uniform-box node-level-4">
            <span class="node-meaning-text">${escapeHtml(customData.chineseMeaning || '')}</span>
          </div>
        `;
      }
      break;
    }

    case 5: {
      // 5级：词根拆解
      container.innerHTML = `
        <div class="node-card node-uniform-box node-level-5">
          <span class="node-breakdown-text">${escapeHtml(customData.breakdown || '')}</span>
        </div>
      `;
      break;
    }

    case 6: {
      // 6级：例句与例句音频（超长省略，悬停显示全文）
      container.innerHTML = `
        <div class="node-card node-uniform-box node-level-6" title="${escapeHtml(customData.exampleSentence || '')}">
          <div class="sentence-box">
            <span class="quote-mark">“</span>
            <span class="sentence-text">${escapeHtml(customData.exampleSentence || '')}</span>
            <span class="quote-mark">”</span>
          </div>
          <button class="audio-btn sentence-audio" data-audio="${encodeURI(customData.exampleAudio || '')}" data-word-id="${customData.wordId ?? ''}" title="朗读全句" aria-label="朗读全句">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
          </button>
        </div>
      `;
      break;
    }
  }

  return container;
}

/**
 * 单词默写高级交互卡片
 */
function renderWordQuizNodeHtml(params: {
  wordId: number;
  value: string;
  correctAnswer: string;
  isCorrect?: boolean;
  showAnswer?: boolean;
  locked?: boolean;
  placeholder: string;
}) {
  const { wordId, value, correctAnswer, isCorrect, showAnswer, locked, placeholder } = params;

  let stateClass = '';
  let iconHtml = `
    <span class="dictate-icon blue">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
      </svg>
    </span>`;

  if (isCorrect === true) {
    stateClass = 'is-correct';
    iconHtml = `
      <span class="dictate-icon success" title="答对啦">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>`;
  } else if (isCorrect === false) {
    stateClass = 'is-wrong';
    iconHtml = `
      <span class="dictate-icon danger" title="答错了">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </span>`;
  }

  const answerPop = showAnswer
    ? `<div class="quiz-pop-answer">
         <span class="pop-label">正确:</span>
         <span class="pop-val">${escapeHtml(correctAnswer)}</span>
       </div>`
    : '';

  return `
    <div class="dictate-node-card ${stateClass}">
      <div class="dictate-input-shell">
        ${iconHtml}
        <input
          class="quiz-input dictate-input"
          data-word-id="${wordId}"
          data-type="word"
          value="${escapeHtml(value || '')}"
          placeholder="${placeholder}"
          autocomplete="off"
          spellcheck="false"
          ${locked ? 'readonly' : ''}
        />
      </div>
      ${answerPop}
    </div>
  `;
}

/**
 * 释义默写卡片
 */
function renderMeaningQuizNodeHtml(params: {
  wordId: number;
  value: string;
  correctAnswer: string;
  isCorrect?: boolean;
  showAnswer?: boolean;
  locked?: boolean;
  placeholder: string;
}) {
  const { wordId, value, correctAnswer, isCorrect, showAnswer, locked, placeholder } = params;

  let stateClass = '';
  let iconHtml = `
    <span class="dictate-icon emerald">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    </span>`;

  if (isCorrect === true) {
    stateClass = 'is-correct';
    iconHtml = `
      <span class="dictate-icon success">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>`;
  } else if (isCorrect === false) {
    stateClass = 'is-wrong';
    iconHtml = `
      <span class="dictate-icon danger">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </span>`;
  }

  const answerPop = showAnswer
    ? `<div class="quiz-pop-answer">
         <span class="pop-label">参考:</span>
         <span class="pop-val">${escapeHtml(correctAnswer)}</span>
       </div>`
    : '';

  return `
    <div class="dictate-node-card ${stateClass}">
      <div class="dictate-input-shell">
        ${iconHtml}
        <input
          class="quiz-input dictate-input"
          data-word-id="${wordId}"
          data-type="meaning"
          value="${escapeHtml(value || '')}"
          placeholder="${placeholder}"
          autocomplete="off"
          ${locked ? 'readonly' : ''}
        />
      </div>
      ${answerPop}
    </div>
  `;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

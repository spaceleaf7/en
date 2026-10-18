import React, { useEffect, useRef, useState } from 'react';
import { Maximize, Minus, Move, Plus } from 'lucide-react';
import MindMap from 'simple-mind-map';
import RainbowLines from 'simple-mind-map/src/plugins/RainbowLines.js';
import type { RootData, StudyMode, AnswerMap } from '../types';
import type { ProgressState } from '../types/progress';
import { transformToMindMap, createCustomNodeContent } from '../utils/mindMapTransformer';
import { RAINBOW_COLORS } from '../utils/branchColors';

interface Props {
  currentRoot: RootData;
  mode: StudyMode;
  answers: AnswerMap;
  progress: ProgressState;
  onInputChange: (wordId: number, val: string) => void;
  onSubmit: () => void;
  /** 播放发音；wordId 为发音所属单词 */
  onAudioPlay?: (wordId: number | undefined) => void;
  /** 切换单词收藏（仅浏览模式渲染星标） */
  onFavorite?: (wordId: number, rootId: number) => void;
  renderTrigger: number;
}

// 与 simple-mind-map 默认的 minZoomRatio / maxZoomRatio（20% / 400%）一致，用于禁用缩放按钮
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

// 彩虹分支：每个单词分支（第2层及其子孙连线）依次取一种颜色
// usePlugin 是 simple-mind-map 的插件注册方法，并非 React Hook
// oxlint-disable-next-line react-hooks/rules-of-hooks
MindMap.usePlugin(RainbowLines);

// 自适应留白；底部额外让出浮动模式切换栏的高度
const FIT_PADDING = 80;
const DOCK_OFFSET = 40;

// 严格自适应屏幕，保证导图完整展示在屏幕内并避开底部工具栏
const fitToScreenCenter = (mm: MindMap) => {
  try {
    mm.view.fit(() => {}, true, FIT_PADDING);
    mm.view.translateY(-DOCK_OFFSET);
  } catch (err) {
    console.warn('自适应导图异常:', err);
  }
};

// 渲染结束后自适应一次；若渲染已同步完成未触发事件，则由兜底定时器执行
const scheduleFit = (mm: MindMap) => {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    mm.off('node_tree_render_end', run);
    clearTimeout(timer);
    fitToScreenCenter(mm);
  };
  mm.on('node_tree_render_end', run);
  const timer = setTimeout(run, 200);
  return () => {
    done = true;
    mm.off('node_tree_render_end', run);
    clearTimeout(timer);
  };
};

export const MindMapBoard: React.FC<Props> = ({
  currentRoot,
  mode,
  answers,
  progress,
  onInputChange,
  onSubmit,
  onAudioPlay,
  onFavorite,
  renderTrigger,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mindMapInstance = useRef<MindMap | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 当前缩放比例，由画布的 scale 事件同步（滚轮缩放、自适应都会触发）
  const [zoom, setZoom] = useState(1);

  // 输入时不重绘脑图（避免失焦），重绘时从 ref 读取最新作答
  const latestRef = useRef({ currentRoot, mode, answers, progress });
  // 记录当前画布对应的数据版本与视图版本，避免重复 setData / 重置用户缩放
  const renderedKeyRef = useRef('');
  const fittedKeyRef = useRef('');

  useEffect(() => {
    latestRef.current = { currentRoot, mode, answers, progress };
  });

  // 1. 初始化 simple-mind-map 实例，并监听容器尺寸变化
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.innerHTML = '';

    const { currentRoot: root, mode: initMode, answers: initAnswers, progress: initProgress } = latestRef.current;
    const mm = new MindMap({
      el,
      data: transformToMindMap(root, initMode, initAnswers, initProgress),
      layout: 'logicalStructure', // 逻辑结构图 (向右单向展开)
      theme: 'classicGreen',
      enableFreeDrag: false,
      readonly: true,
      initRootNodePosition: ['center', 'center'],
      // 鼠标缩放以指针为中心
      mouseScaleCenterUseMousePosition: true,
      mousewheelAction: 'zoom',
      mousewheelZoomActionReverse: false,
      scaleRatio: 0.12,
      rainbowLinesConfig: {
        open: true,
        colorsList: RAINBOW_COLORS,
      },
      // 连线与主题清空：彻底消除底层 SVG 形状节点自带的默认边框与背景，避免双重边框！
      themeConfig: {
        // 画布透明，露出 .app-container 的渐变背景
        backgroundColor: 'transparent',
        lineColor: '#60a5fa',
        lineWidth: 2.5,
        lineStyle: 'curve',
        // 曲线模式下根节点连线默认从节点中心出发；词根卡是半透明的，会透出卡片内的线段，改为从右边缘出发
        rootLineStartPositionKeepSameInCurve: true,
        // 1级根节点：去掉底层自带形状与边框
        root: {
          fillColor: 'transparent',
          borderColor: 'transparent',
          borderWidth: 0,
        },
        // 2级节点：去掉底层自带边框与背景
        second: {
          fillColor: 'transparent',
          borderColor: 'transparent',
          borderWidth: 0,
        },
        // 3~6级节点：去掉底层自带边框与背景
        node: {
          fillColor: 'transparent',
          borderColor: 'transparent',
          borderWidth: 0,
        },
      },
      // 启用自定义 DOM 节点
      isUseCustomNodeContent: true,
      customCreateNodeContent: (node: any) => createCustomNodeContent(node),
    });

    mindMapInstance.current = mm;
    const onScale = (scale: number) => setZoom(scale);
    mm.on('scale', onScale);
    renderedKeyRef.current = '';
    fittedKeyRef.current = `${root.id}-${initMode}`;
    const cancelFit = scheduleFit(mm);

    // simple-mind-map 不会自动感知容器尺寸变化（窗口缩放等），需要手动 resize
    const observer = new ResizeObserver(() => {
      try {
        mm.resize();
      } catch {
        // 容器宽高为 0 时库会抛错，忽略即可
      }
    });
    observer.observe(el);

    return () => {
      cancelFit();
      observer.disconnect();
      mm.off('scale', onScale);
      mm.destroy();
      mindMapInstance.current = null;
    };
  }, []);

  // 进度数据只在"影响节点展示"的部分变化时触发重绘（学习时长每 15 秒累加一次，不需要重绘）
  const progressKey = getProgressRenderKey(progress, currentRoot);

  // 2. 词根翻页、模式切换、提交、重置或进度变化后重绘；只有翻页 / 切模式才重新自适应视图
  useEffect(() => {
    const mm = mindMapInstance.current;
    if (!mm) return;

    const dataKey = `${currentRoot.id}-${mode}-${renderTrigger}-${progressKey}`;
    if (renderedKeyRef.current === '') {
      // 实例刚创建，数据已是最新
      renderedKeyRef.current = dataKey;
      return;
    }
    if (renderedKeyRef.current === dataKey) return;
    renderedKeyRef.current = dataKey;

    const latest = latestRef.current;
    mm.setData(transformToMindMap(currentRoot, mode, latest.answers, latest.progress));

    const viewKey = `${currentRoot.id}-${mode}`;
    if (fittedKeyRef.current === viewKey) return;
    fittedKeyRef.current = viewKey;
    return scheduleFit(mm);
  }, [currentRoot, mode, renderTrigger, progressKey]);

  // 3. 事件委托：处理发音、收藏、填空输入与键盘操作
  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const favoriteBtn = target.closest('.favorite-btn');
    if (favoriteBtn) {
      e.stopPropagation();
      const wordId = Number(favoriteBtn.getAttribute('data-word-id'));
      const rootId = Number(favoriteBtn.getAttribute('data-root-id'));
      if (wordId > 0) onFavorite?.(wordId, rootId);
      return;
    }
    const audioBtn = target.closest('.audio-btn');
    if (audioBtn) {
      e.stopPropagation();
      const audioUrl = audioBtn.getAttribute('data-audio');
      if (audioUrl) {
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }
        audioRef.current.pause();
        audioRef.current.src = decodeURI(audioUrl);
        audioRef.current.play().catch((err) => {
          console.warn('音频播放异常:', err);
        });
        const wordId = Number(audioBtn.getAttribute('data-word-id'));
        onAudioPlay?.(Number.isFinite(wordId) && wordId > 0 ? wordId : undefined);
      }
    }
  };

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('quiz-input')) {
      const wordId = Number(target.getAttribute('data-word-id'));
      const val = target.value;
      onInputChange(wordId, val);
    }
  };

  // Enter 跳到下一题，Ctrl/⌘ + Enter 提交
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLInputElement;
    if (!target.classList.contains('quiz-input') || e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing) return; // 中文输入法选词时的回车不处理

    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      onSubmit();
      return;
    }
    const inputs = Array.from(
      containerRef.current?.querySelectorAll<HTMLInputElement>('.quiz-input') ?? []
    );
    const next = inputs[inputs.indexOf(target) + 1];
    if (next) next.focus();
    else target.blur();
  };

  // 4. 缩放控件：以画布中心缩放；最右侧按钮恢复自适应
  const zoomOut = () => mindMapInstance.current?.view.narrow();
  const zoomIn = () => mindMapInstance.current?.view.enlarge();
  const zoomFit = () => {
    if (mindMapInstance.current) fitToScreenCenter(mindMapInstance.current);
  };

  return (
    <>
      {/* 容器内部由 simple-mind-map 接管（初始化时会清空），控件只能放在它外面 */}
      <div
        ref={containerRef}
        className="mindmap-container"
        onClick={handleClick}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />

      <div className="canvas-view-hint" aria-hidden="true">
        <Move size={14} />
        <span>共 {currentRoot.words.length} 个单词 · 拖动画布查看，滚轮缩放</span>
      </div>

      <div className="zoom-control" role="group" aria-label="画布缩放">
        <button className="zoom-btn" onClick={zoomOut} disabled={zoom <= MIN_ZOOM + 0.001} title="缩小" aria-label="缩小">
          <Minus size={14} />
        </button>
        <span className="zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button className="zoom-btn" onClick={zoomIn} disabled={zoom >= MAX_ZOOM - 0.001} title="放大" aria-label="放大">
          <Plus size={14} />
        </button>
        <button className="zoom-btn" onClick={zoomFit} title="适应屏幕" aria-label="适应屏幕">
          <Maximize size={14} />
        </button>
      </div>
    </>
  );
};

/** 当前词根下各单词的熟练度、到期、易错、收藏状态拼成的 key，变化时才重绘 */
function getProgressRenderKey(progress: ProgressState, root: RootData): string {
  return root.words
    .map((w) => {
      const p = progress.words[w.wordId];
      if (!p) return '-';
      return [p.spell.level, p.meaning.level, p.spell.nextReviewAt, p.meaning.nextReviewAt, p.spell.wrong + p.meaning.wrong, p.favorite ? 1 : 0].join('.');
    })
    .join('|');
}

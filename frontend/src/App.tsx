import { useState, useRef, useEffect, useCallback } from 'react';
import type { StudyMode, AnswerMap, RootData } from './types';
import type { User } from './api/endpoints';
import { Header } from './components/Header';
import { MindMapBoard } from './components/MindMapBoard';
import { StatsModal } from './components/StatsModal';
import { SettingsModal, type SettingsFocus } from './components/SettingsModal';
import { checkWordAnswer, checkMeaningAnswer } from './utils/grading';
import { useProgress } from './hooks/useProgress';
import { useActiveTimer } from './hooks/useActiveTimer';
import { AlertCircle, CheckCircle2, Info, Eye, BookOpen, HelpCircle, X } from 'lucide-react';
import './App.css';

type NoticeType = 'success' | 'warn' | 'info';

const NOTICE_AUTO_HIDE_MS = 4000;

const MODE_NOTICES: Record<StudyMode, string> = {
  1: '已开启【模式A · 默写单词】：根据释义与例句默写出英文单词（音标与构词已隐藏）。回车跳到下一题，Ctrl + Enter 提交。',
  2: '已开启【模式B · 考核释义】：已隐藏第4级中文注释，请填写该单词的中文释义（答出任一义项即可）。',
  3: '已切回【浏览模式】：六层思维导图已全量展示。',
};

interface StudyProps {
  user: User;
  roots: RootData[];
  onLogout: () => void;
  onUserChange: (user: User) => void;
}

export function StudyApp({ user, roots, onLogout, onUserChange }: StudyProps) {
  const [rootIndex, setRootIndex] = useState(0);
  const [mode, setMode] = useState<StudyMode>(3); // 默认浏览模式
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [renderTrigger, setRenderTrigger] = useState(0);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus | null>(null);
  const [notice, setNotice] = useState<{ msg: string; type: NoticeType } | null>(null);

  const startTimeRef = useRef(0);
  const currentRoot = roots[rootIndex];
  const isSubmitted = currentRoot.words.some((w) => answers[w.wordId]?.isCorrect !== undefined);

  const progress = useProgress(user.id, roots);
  const { addTime } = progress;
  // 稳定引用：SettingsModal 的 Esc 监听依赖它
  const closeSettings = useCallback(() => setSettingsFocus(null), []);

  // 有效学习时长：平摊到当前词根下已学过的单词
  const currentWordIdsRef = useRef<number[]>([]);
  useEffect(() => {
    currentWordIdsRef.current = currentRoot.words.map((w) => w.wordId);
  }, [currentRoot]);
  useActiveTimer((ms) => addTime(ms, currentWordIdsRef.current));

  useEffect(() => {
    startTimeRef.current = Date.now();
  }, []);

  // 普通提示自动消失；测评结果需要用户手动关闭
  useEffect(() => {
    if (notice?.type !== 'info') return;
    const timer = setTimeout(() => setNotice(null), NOTICE_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // 退出前先尽量上传；没传完的记录保留在本机，下次登录同一账号时继续上传
  const handleLogout = async () => {
    if (!confirmDiscard()) return;
    await progress.syncNow();
    onLogout();
  };

  // 存在未提交的作答时，离开当前题目前先确认
  const confirmDiscard = () => {
    const hasDraft =
      mode !== 3 && !isSubmitted && Object.values(answers).some((a) => a.userAnswer.trim());
    return !hasDraft || window.confirm('当前作答尚未提交，确定要放弃吗？');
  };

  const resetSession = () => {
    setAnswers({});
    startTimeRef.current = Date.now();
    setRenderTrigger((v) => v + 1);
  };

  // 模式切换
  const handleModeChange = (newMode: StudyMode) => {
    if (newMode === mode || !confirmDiscard()) return;
    setMode(newMode);
    resetSession();
    setNotice({ msg: MODE_NOTICES[newMode], type: 'info' });
  };

  // 翻页
  const goToRoot = (index: number) => {
    if (index < 0 || index >= roots.length || !confirmDiscard()) return;
    setRootIndex(index);
    resetSession();
    setNotice(null);
  };

  // 用户输入填空 (不刷新整个脑图，避免失焦)
  const handleInputChange = (wordId: number, val: string) => {
    if (isSubmitted) return;
    setAnswers((prev) => ({
      ...prev,
      [wordId]: {
        ...prev[wordId],
        userAnswer: val,
      },
    }));
  };

  // 重置作答
  const handleReset = () => {
    resetSession();
    setNotice({
      msg: '作答内容已重置，可以重新开始填写。',
      type: 'info',
    });
  };

  // 提交作答并批改
  const handleSubmit = () => {
    if (mode === 3) return;
    if (isSubmitted) {
      setNotice({ msg: '本轮已批改，如需再次练习请点击「重置」。', type: 'info' });
      return;
    }

    const getInput = (wordId: number) => (answers[wordId]?.userAnswer || '').trim();
    const blankCount = currentRoot.words.filter((w) => !getInput(w.wordId)).length;
    if (blankCount === currentRoot.words.length) {
      setNotice({ msg: '还没有填写任何答案哦，先作答再提交吧。', type: 'warn' });
      return;
    }
    if (blankCount > 0 && !window.confirm(`还有 ${blankCount} 题未填写，确定提交吗？`)) {
      return;
    }

    let correctCount = 0;
    const updatedAnswers: AnswerMap = {};
    const now = Date.now();
    // 本轮整体用时平均到每道已作答的题上
    const answeredCount = currentRoot.words.length - blankCount;
    const perAnswerMs = Math.round((now - startTimeRef.current) / Math.max(1, answeredCount));

    currentRoot.words.forEach((w) => {
      const userText = getInput(w.wordId);
      const isCorrect =
        userText.length > 0 &&
        (mode === 1 ? checkWordAnswer(userText, w) : checkMeaningAnswer(userText, w));

      if (isCorrect) correctCount++;

      // 留空的题记为"跳过"：不改熟练度，但计入复习
      progress.answer({
        wordId: w.wordId,
        rootId: currentRoot.id,
        skill: mode === 1 ? 'spell' : 'meaning',
        result: userText ? (isCorrect ? 'correct' : 'wrong') : 'skip',
        answer: userText || undefined,
        responseMs: userText ? perAnswerMs : 0,
      });

      updatedAnswers[w.wordId] = {
        userAnswer: answers[w.wordId]?.userAnswer || '',
        isCorrect,
        showAnswer: !isCorrect, // 错误时显示正确参考答案
      };
    });

    const accuracyRate = Math.round((correctCount / currentRoot.words.length) * 100);
    const duration = Math.max(1, Math.round((now - startTimeRef.current) / 1000));

    setAnswers(updatedAnswers);
    setRenderTrigger((v) => v + 1);

    setNotice({
      msg: `测评完成！本次正确率: ${accuracyRate}% (答对 ${correctCount} / 共 ${currentRoot.words.length} 题)，耗时 ${duration} 秒。${
        correctCount < currentRoot.words.length ? '错误项已标红并附参考答案。' : ''
      }`,
      type: accuracyRate >= 80 ? 'success' : 'warn',
    });
  };

  return (
    <div className="app-container">
      <Header
        currentRootText={currentRoot.rootText}
        currentIndex={rootIndex}
        totalRoots={roots.length}
        mode={mode}
        isSubmitted={isSubmitted}
        onPrev={() => goToRoot(rootIndex - 1)}
        onNext={() => goToRoot(rootIndex + 1)}
        onSubmit={handleSubmit}
        onReset={handleReset}
        onOpenStats={() => setIsStatsOpen(true)}
        user={user}
        syncStatus={progress.status}
        pendingCount={progress.pendingCount}
        onSync={() => void progress.syncNow()}
        onLogout={handleLogout}
        onOpenSettings={() => setSettingsFocus('profile')}
      />

      <main className="main-content">
        {notice && (
          <div className={`notice-toast ${notice.type}`} role="status">
            {notice.type === 'success' && <CheckCircle2 size={16} className="notice-icon" />}
            {notice.type === 'warn' && <AlertCircle size={16} className="notice-icon" />}
            {notice.type === 'info' && <Info size={16} className="notice-icon" />}
            <span className="notice-text">{notice.msg}</span>
            <button className="notice-close" onClick={() => setNotice(null)} aria-label="关闭提示">
              <X size={14} />
            </button>
          </div>
        )}

        {mode === 3 && (
          <div className="canvas-hint" aria-hidden="true">
            <span className="canvas-hint-tag">词根探索</span>
            <span className="canvas-hint-text">顺着一个词根，连接一整片词汇。</span>
          </div>
        )}

        <MindMapBoard
          currentRoot={currentRoot}
          mode={mode}
          answers={answers}
          progress={progress.state}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
          onAudioPlay={progress.playAudio}
          onFavorite={progress.favorite}
          renderTrigger={renderTrigger}
        />

        {/* 屏幕中间下方的模式切换浮动控制器 */}
        <div className="floating-mode-toolbar">
          <div className="mode-segmented-control shadow-dock" role="tablist">
            <button
              className={`segment-btn ${mode === 3 ? 'active' : ''}`}
              onClick={() => handleModeChange(3)}
              title="查看完整六层思维导图"
              role="tab"
              aria-selected={mode === 3}
            >
              <Eye size={18} /> 浏览模式
            </button>
            <button
              className={`segment-btn ${mode === 1 ? 'active' : ''}`}
              onClick={() => handleModeChange(1)}
              title="隐藏第2层单词进行英文默写"
              role="tab"
              aria-selected={mode === 1}
            >
              <BookOpen size={18} /> 模式A · 默写单词
            </button>
            <button
              className={`segment-btn ${mode === 2 ? 'active' : ''}`}
              onClick={() => handleModeChange(2)}
              title="隐藏第4层中文释义进行词义考核"
              role="tab"
              aria-selected={mode === 2}
            >
              <HelpCircle size={18} /> 模式B · 考核释义
            </button>
          </div>
        </div>
      </main>

      {/* 关闭时卸载，保证每次打开都按当前时间重新统计 */}
      {isStatsOpen && (
        <StatsModal
          isOpen={isStatsOpen}
          onClose={() => setIsStatsOpen(false)}
          progress={progress}
          roots={roots}
          onOpenSettings={() => setSettingsFocus('goals')}
        />
      )}

      {/* 渲染在看板之后，叠在看板上方 */}
      {settingsFocus && (
        <SettingsModal
          user={user}
          settings={progress.state.settings}
          focus={settingsFocus}
          onSaveSettings={progress.setSettings}
          onUserChange={onUserChange}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}

export default StudyApp;

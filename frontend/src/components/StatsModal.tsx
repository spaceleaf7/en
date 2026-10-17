import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RootData } from '../types';
import type { ProgressApi } from '../hooks/useProgress';
import {
  getCommonMistake,
  getDifficultWords,
  getDueWordIds,
  getOverallSummary,
  getStreak,
  getTodayProgress,
} from '../utils/stats';
import { X, Award, Flame, Target, Clock, BookOpen, AlertTriangle, Download, Upload, Sparkles, Settings2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  progress: ProgressApi;
  roots: RootData[];
  onOpenSettings: () => void;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export const StatsModal: React.FC<Props> = ({ isOpen, onClose, progress, roots, onOpenSettings }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state } = progress;
  // 弹窗每次打开都会重新挂载，挂载时取一次当前时间作为统计基准
  const [now] = useState(() => Date.now());

  // Esc 关闭弹窗
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const wordIndex = useMemo(() => {
    const map = new Map<number, { word: string; meaning: string; rootText: string }>();
    roots.forEach((r) => r.words.forEach((w) => map.set(w.wordId, { word: w.word, meaning: w.chineseMeaning, rootText: r.rootText })));
    return map;
  }, [roots]);

  if (!isOpen) return null;

  const today = getTodayProgress(state, now);
  const streak = getStreak(state, now);
  const overall = getOverallSummary(state, [...wordIndex.keys()]);
  const dueCount = getDueWordIds(state, now).length;
  const difficult = getDifficultWords(state, 5);

  const handleExport = () => {
    const blob = new Blob([progress.exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etymomind-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('导入会把备份中的学习记录合并到当前账号（不会覆盖已有记录），确定继续吗？')) return;
    try {
      const { imported, skipped } = progress.importBackup(await file.text());
      window.alert(`已导入 ${imported} 条作答记录${skipped ? `，${skipped} 条因单词不在当前词库中被跳过` : ''}`);
    } catch (err) {
      window.alert(`导入失败：${(err as Error).message}`);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon">
              <Award size={20} />
            </div>
            <div>
              <div className="modal-title" id="stats-modal-title">学习数据看板</div>
              <div className="modal-subtitle">
                共 {overall.total} 词 · 累计学习 {formatMinutes(overall.totalMinutes)} · 总正确率 {pct(overall.accuracy)}
              </div>
            </div>
          </div>
          <div className="modal-header-actions">
            <button className="action-btn-clean" onClick={onOpenSettings} title="修改每日新词与学习时长目标">
              <Settings2 size={14} /> 学习目标
            </button>
            <button className="modal-close-btn" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="stats-hero-grid">
          <div className="stat-card-modern">
            <div className="stat-icon-pill amber">
              <Flame size={18} />
            </div>
            <div className="stat-meta">
              <div className="stat-value">
                {streak.current}
                <span className="stat-unit">天</span>
              </div>
              <div className="stat-title">连续学习 · 最长 {streak.longest} 天</div>
            </div>
          </div>

          <div className="stat-card-modern">
            <div className="stat-icon-pill blue">
              <Target size={18} />
            </div>
            <div className="stat-meta">
              <div className="stat-value">
                {today.newWords}
                <span className="stat-total"> / {today.newGoal}</span>
              </div>
              <div className="stat-title">今日新词 · 复习 {today.reviewed} 词</div>
            </div>
          </div>

          <div className="stat-card-modern">
            <div className="stat-icon-pill emerald">
              <Clock size={18} />
            </div>
            <div className="stat-meta">
              <div className="stat-value">
                {today.minutes}
                <span className="stat-total"> / {today.minutesGoal} 分</span>
              </div>
              <div className="stat-title">今日时长 · 正确率 {pct(today.accuracy)}</div>
            </div>
          </div>
        </div>

        <div className="mastery-section">
          <div className="table-header-row">
            <span className="table-title">掌握进度</span>
            <span className="table-subtitle">
              {dueCount > 0 ? `今日待复习 ${dueCount} 词` : '今日暂无待复习'}
            </span>
          </div>
          <div className="mastery-bar" role="img" aria-label={`已掌握 ${overall.mastered}，学习中 ${overall.learning}，未学 ${overall.fresh}`}>
            {overall.mastered > 0 && <span className="seg mastered" style={{ flex: overall.mastered }} />}
            {overall.learning > 0 && <span className="seg learning" style={{ flex: overall.learning }} />}
            {overall.fresh > 0 && <span className="seg fresh" style={{ flex: overall.fresh }} />}
          </div>
          <div className="mastery-legend">
            <span><i className="dot mastered" />已掌握 {overall.mastered}</span>
            <span><i className="dot learning" />学习中 {overall.learning}</span>
            <span><i className="dot fresh" />未学 {overall.fresh}</span>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header-row">
            <span className="table-title">
              <AlertTriangle size={14} className="inline-icon" /> 易错词
            </span>
            <span className="table-subtitle">错 3 次以上或正确率低于 60%</span>
          </div>

          {difficult.length === 0 ? (
            <div className="table-empty">
              <div className="empty-icon-wrap">
                {overall.learning + overall.mastered === 0 ? <BookOpen size={24} /> : <Sparkles size={24} />}
              </div>
              <p className="empty-text">
                {overall.learning + overall.mastered === 0 ? '还没有学习记录' : '暂无易错词'}
              </p>
              <p className="empty-sub">
                {overall.learning + overall.mastered === 0
                  ? '切换到「模式A / 模式B」答题并提交，就会开始记录每个单词的学习进度'
                  : '继续保持'}
              </p>
            </div>
          ) : (
            <div className="table-scroll-area">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>单词</th>
                    <th>释义</th>
                    <th>错 / 对</th>
                    <th>常见错误</th>
                  </tr>
                </thead>
                <tbody>
                  {difficult.map((p) => {
                    const info = wordIndex.get(p.wordId);
                    const mistake = getCommonMistake(p);
                    return (
                      <tr key={p.wordId}>
                        <td>
                          <span className="root-pill">{info?.word ?? p.wordId}</span>
                        </td>
                        <td className="meaning-col">{info?.meaning}</td>
                        <td className="duration-col">
                          {p.spell.wrong + p.meaning.wrong} / {p.spell.correct + p.meaning.correct}
                        </td>
                        <td className="mistake-col">{mistake ? mistake.answer : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="footer-hint">学习记录自动同步到服务器，换设备登录即可继续</span>
          <div className="footer-actions">
            <button className="action-btn-clean" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} /> 导入
            </button>
            <button className="action-btn-clean" onClick={handleExport}>
              <Download size={14} /> 导出备份
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={handleImport}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

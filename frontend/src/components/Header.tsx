import React from 'react';
import type { StudyMode } from '../types';
import type { User } from '../api/endpoints';
import type { SyncStatus } from '../hooks/useProgress';
import {
  ChevronLeft,
  ChevronRight,
  BarChart3,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  Cloud,
  CloudOff,
  RefreshCw,
  LogOut,
} from 'lucide-react';

interface Props {
  currentRootText: string;
  currentIndex: number;
  totalRoots: number;
  mode: StudyMode;
  isSubmitted: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onReset: () => void;
  onOpenStats: () => void;
  user: User;
  syncStatus: SyncStatus;
  pendingCount: number;
  onSync: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
}

const SYNC_LABEL: Record<SyncStatus, string> = {
  idle: '已同步',
  syncing: '同步中',
  offline: '离线',
  error: '同步失败',
};

export const Header: React.FC<Props> = ({
  currentRootText,
  currentIndex,
  totalRoots,
  mode,
  isSubmitted,
  onPrev,
  onNext,
  onSubmit,
  onReset,
  onOpenStats,
  user,
  syncStatus,
  pendingCount,
  onSync,
  onLogout,
  onOpenSettings,
}) => {
  const SyncIcon = syncStatus === 'syncing' ? RefreshCw : syncStatus === 'idle' ? Cloud : CloudOff;
  const syncTitle =
    syncStatus === 'idle' && pendingCount === 0
      ? '学习记录已保存到服务器，点击立即同步'
      : `${pendingCount} 条记录待上传${syncStatus === 'offline' ? '（网络恢复后自动上传）' : ''}，点击立即同步`;

  return (
    <header className="header-container">
      {/* 品牌与标题 */}
      <div className="header-left">
        <div className="brand-logo">
          <Sparkles size={18} className="brand-icon" />
          <div className="brand-text">
            <span className="brand-title">EtymoMind</span>
            <span className="brand-sub">词根脉络思维导图</span>
          </div>
        </div>
      </div>

      {/* 词根切换翻页器 */}
      <div className="header-center">
        <div className="pagination-pill">
          <button
            className="pager-btn"
            onClick={onPrev}
            disabled={currentIndex <= 0}
            title="上一词根"
            aria-label="上一词根"
          >
            <ChevronLeft size={18} />
          </button>

          <div className="pager-info">
            <span className="pager-root-text" title={currentRootText}>{currentRootText}</span>
            <span className="pager-count">
              词根 {currentIndex + 1} / {totalRoots}
            </span>
          </div>

          <button
            className="pager-btn"
            onClick={onNext}
            disabled={currentIndex >= totalRoots - 1}
            title="下一词根"
            aria-label="下一词根"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* 动作区 */}
      <div className="header-right">
        {mode !== 3 && (
          <div className="quiz-actions-group">
            <button className="action-btn-clean" onClick={onReset} title="清空所有输入">
              <RotateCcw size={14} /> 重置
            </button>
            <button
              className="action-btn-primary"
              onClick={onSubmit}
              disabled={isSubmitted}
              title={isSubmitted ? '本轮已批改，点击「重置」重新练习' : '核对答案并生成评分（Ctrl + Enter）'}
            >
              <CheckCircle2 size={15} /> {isSubmitted ? '已批改' : '提交核对'}
            </button>
          </div>
        )}

        <button className="stats-entry-btn" onClick={onOpenStats} title="查看学习看板">
          <BarChart3 size={15} /> 学习看板
        </button>

        <button
          className={`sync-indicator ${syncStatus}`}
          onClick={onSync}
          disabled={syncStatus === 'syncing'}
          title={syncTitle}
          aria-label={`${SYNC_LABEL[syncStatus]}，${syncTitle}`}
        >
          <SyncIcon size={14} className={syncStatus === 'syncing' ? 'spin' : undefined} />
          <span>{syncStatus === 'idle' && pendingCount > 0 ? '待同步' : SYNC_LABEL[syncStatus]}</span>
        </button>

        <div className="user-chip">
          {/* 1.4 用户菜单完成前，点击头像直接打开个人设置 */}
          <button
            className="user-profile-btn"
            onClick={onOpenSettings}
            title={`已登录：${user.username}，点击打开个人设置`}
            aria-label={`个人设置（${user.nickname}）`}
          >
            <span className="user-avatar" aria-hidden="true">{user.nickname.slice(0, 1).toUpperCase()}</span>
            <span className="user-name">{user.nickname}</span>
          </button>
          <button className="user-logout" onClick={onLogout} title="退出登录" aria-label="退出登录">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
};

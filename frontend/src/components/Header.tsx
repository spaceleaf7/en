import React, { useEffect, useRef, useState } from 'react';
import type { StudyMode } from '../types';
import type { User } from '../api/endpoints';
import type { SyncStatus } from '../hooks/useProgress';
import type { SettingsFocus } from './SettingsModal';
import {
  ChevronLeft,
  ChevronRight,
  ChartColumnIncreasing,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  Cloud,
  CloudOff,
  RefreshCw,
  LogOut,
  ChevronDown,
  UserCog,
  KeyRound,
} from 'lucide-react';

/** 聚焦用户菜单的第 index 项，越界时首尾循环（-1 表示末项） */
function focusMenuItem(menu: HTMLElement | null, index: number) {
  const items = menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  if (!items?.length) return;
  items[((index % items.length) + items.length) % items.length].focus();
}

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
  onOpenSettings: (focus?: SettingsFocus) => void;
  onOpenChangePassword: () => void;
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
  onOpenChangePassword,
}) => {
  const SyncIcon = syncStatus === 'syncing' ? RefreshCw : syncStatus === 'idle' ? Cloud : CloudOff;
  const syncTitle =
    syncStatus === 'idle' && pendingCount === 0
      ? '学习记录已保存到服务器，点击立即同步'
      : `${pendingCount} 条记录待上传${syncStatus === 'offline' ? '（网络恢复后自动上传）' : ''}，点击立即同步`;

  // 用户下拉菜单
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 键盘打开菜单时，等菜单渲染出来再聚焦对应项
  const pendingFocusRef = useRef<number | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    if (pendingFocusRef.current !== null) {
      focusMenuItem(menuRef.current, pendingFocusRef.current);
      pendingFocusRef.current = null;
    }
    // 点击菜单外部关闭
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  const openMenuAt = (index: number) => {
    if (menuOpen) {
      focusMenuItem(menuRef.current, index);
      return;
    }
    pendingFocusRef.current = index;
    setMenuOpen(true);
  };

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  // Enter / Space / ↓ 打开并聚焦首项，↑ 打开并聚焦末项
  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openMenuAt(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenuAt(-1);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusMenuItem(menuRef.current, current + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusMenuItem(menuRef.current, current < 0 ? -1 : current - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusMenuItem(menuRef.current, 0);
        break;
      case 'End':
        e.preventDefault();
        focusMenuItem(menuRef.current, -1);
        break;
      case 'Tab':
        setMenuOpen(false);
        break;
    }
  };

  // Esc：焦点在触发器或菜单内都能关闭，并把焦点还给触发器
  const handleChipKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && menuOpen) {
      e.preventDefault();
      closeMenu(true);
    }
  };

  const avatarText = user.nickname.slice(0, 1).toUpperCase();

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

        <button className="stats-entry-btn" onClick={onOpenStats} title="查看学习看板" aria-label="学习看板">
          <ChartColumnIncreasing size={21} />
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

        <div className="user-chip" onKeyDown={handleChipKeyDown}>
          <button
            ref={triggerRef}
            className="user-profile-btn"
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={handleTriggerKeyDown}
            title={`已登录：${user.username}`}
            aria-label={`用户菜单（${user.nickname}）`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? 'user-menu' : undefined}
          >
            <span className="user-avatar" aria-hidden="true">{avatarText}</span>
            <span className="user-name">{user.nickname}</span>
            <ChevronDown size={13} className={`user-caret ${menuOpen ? 'open' : ''}`} aria-hidden="true" />
          </button>

          {menuOpen && (
            <div id="user-menu" ref={menuRef} className="user-menu" role="menu" aria-label="用户菜单" onKeyDown={handleMenuKeyDown}>
              <div className="user-menu-head">
                <span className="user-avatar lg" aria-hidden="true">{avatarText}</span>
                <div className="user-menu-id">
                  <span className="user-menu-name">
                    <span className="user-menu-nickname">{user.nickname}</span>
                    {user.isAdmin && <span className="admin-tag">管理员</span>}
                  </span>
                  <span className="user-menu-username">@{user.username}</span>
                </div>
              </div>
              <div className="user-menu-sep" role="separator" />
              <button
                role="menuitem"
                tabIndex={-1}
                className="user-menu-item"
                onClick={() => {
                  closeMenu(false);
                  onOpenSettings('profile');
                }}
              >
                <UserCog size={16} aria-hidden="true" /> 个人设置
              </button>
              <button
                role="menuitem"
                tabIndex={-1}
                className="user-menu-item"
                onClick={() => {
                  closeMenu(false);
                  onOpenChangePassword();
                }}
              >
                <KeyRound size={16} aria-hidden="true" /> 修改密码
              </button>
              <div className="user-menu-sep" role="separator" />
              <button
                role="menuitem"
                tabIndex={-1}
                className="user-menu-item danger"
                onClick={() => {
                  closeMenu(false);
                  onLogout();
                }}
              >
                <LogOut size={16} aria-hidden="true" /> 退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

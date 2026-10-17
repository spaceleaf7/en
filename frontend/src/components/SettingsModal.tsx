import React, { useEffect, useState } from 'react';
import { Globe, Loader2, Settings2, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { getMe, updateMe, type User } from '../api/endpoints';
import type { StudySettings } from '../types/progress';
import { browserTimezone, GOAL_LIMITS, NICKNAME_MAX, validateGoal, validateNickname } from '../utils/settings';

/** 打开时先聚焦哪一栏：从看板进入时直接定位到学习目标 */
export type SettingsFocus = 'profile' | 'goals';

interface Props {
  user: User;
  settings: StudySettings;
  focus?: SettingsFocus;
  onSaveSettings: (patch: Partial<StudySettings>) => void;
  onUserChange: (user: User) => void;
  onClose: () => void;
}

const GOAL_KEYS = Object.keys(GOAL_LIMITS) as (keyof StudySettings)[];

type Field = 'nickname' | keyof StudySettings;
type Errors = Partial<Record<Field, string>>;

export const SettingsModal: React.FC<Props> = ({ user, settings, focus = 'profile', onSaveSettings, onUserChange, onClose }) => {
  const [nickname, setNickname] = useState(user.nickname);
  const [goals, setGoals] = useState<Record<keyof StudySettings, string>>(() => ({
    dailyNewGoal: String(settings.dailyNewGoal),
    dailyMinutesGoal: String(settings.dailyMinutesGoal),
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const timezone = browserTimezone();

  // 可能叠在看板弹窗上：捕获阶段处理 Esc 并阻止传播，只关闭当前这一层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // 同步时服务端可能已更新时区，其他设备也可能改过昵称：打开时静默拉取一次最新资料（失败就沿用当前值）
  useEffect(() => {
    let alive = true;
    getMe()
      .then((me) => alive && onUserChange(me))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // 只在打开时拉取一次
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 关闭后把焦点还给打开弹窗的按钮；须在渲染时记录，autoFocus 会在 effect 之前抢走焦点
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => opener?.focus?.(), [opener]);

  const clearError = (field: Field) => {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    setSubmitError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const nextErrors: Errors = {};
    const nickErr = validateNickname(nickname);
    if (nickErr) nextErrors.nickname = nickErr;
    const goalPatch: Partial<StudySettings> = {};
    for (const key of GOAL_KEYS) {
      const err = validateGoal(key, goals[key]);
      if (err) nextErrors[key] = err;
      else if (Number(goals[key]) !== settings[key]) goalPatch[key] = Number(goals[key]);
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    // 昵称需要联网保存；学习目标可离线，先存本机再随同步上传
    const nextNickname = nickname.trim();
    if (nextNickname !== user.nickname) {
      setBusy(true);
      try {
        onUserChange(await updateMe({ nickname: nextNickname }));
      } catch (err) {
        setSubmitError(err instanceof ApiError && err.status !== 0 ? err.message : '昵称保存失败，请检查网络后重试');
        setBusy(false);
        return;
      }
    }
    if (Object.keys(goalPatch).length) onSaveSettings(goalPatch);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal-card settings-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon">
              <Settings2 size={20} />
            </div>
            <div>
              <div className="modal-title" id="settings-modal-title">个人设置</div>
              <div className="modal-subtitle">账号：{user.username}</div>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="settings-body">
          <fieldset className="settings-section">
            <legend className="settings-section-title">个人资料</legend>
            <label className="settings-field">
              <span className="settings-label">昵称</span>
              <span className={`settings-input-wrap${errors.nickname ? ' invalid' : ''}`}>
                <input
                  className="text"
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value);
                    clearError('nickname');
                  }}
                  maxLength={NICKNAME_MAX}
                  autoComplete="nickname"
                  aria-invalid={errors.nickname ? true : undefined}
                  aria-describedby="settings-nickname-hint"
                  autoFocus={focus === 'profile'}
                />
              </span>
              <span
                id="settings-nickname-hint"
                className={errors.nickname ? 'settings-error' : 'settings-hint'}
                role={errors.nickname ? 'alert' : undefined}
              >
                {errors.nickname ?? `显示在右上角，最多 ${NICKNAME_MAX} 个字`}
              </span>
            </label>

            <div className="settings-field">
              <span className="settings-label">时区</span>
              <span className="settings-readonly">
                <Globe size={14} aria-hidden="true" />
                {timezone}
                <span className="settings-readonly-tag">跟随浏览器</span>
              </span>
              <span className="settings-hint">
                {timezone === user.timezone
                  ? '每天凌晨 4 点按此时区换日'
                  : `服务器记录的是 ${user.timezone}，下次同步时会更新，学习日将按新时区重新切分`}
              </span>
            </div>
          </fieldset>

          <fieldset className="settings-section">
            <legend className="settings-section-title">学习目标</legend>
            {GOAL_KEYS.map((key, i) => {
              const { label, unit, min, max } = GOAL_LIMITS[key];
              const error = errors[key];
              const hintId = `settings-${key}-hint`;
              return (
                <label key={key} className="settings-field">
                  <span className="settings-label">{label}</span>
                  <span className={`settings-input-wrap${error ? ' invalid' : ''}`}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={min}
                      max={max}
                      step={1}
                      value={goals[key]}
                      onChange={(e) => {
                        setGoals((g) => ({ ...g, [key]: e.target.value }));
                        clearError(key);
                      }}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={hintId}
                      autoFocus={focus === 'goals' && i === 0}
                    />
                    <span className="settings-unit">{unit}</span>
                  </span>
                  <span id={hintId} className={error ? 'settings-error' : 'settings-hint'} role={error ? 'alert' : undefined}>
                    {error ?? `${min}-${max} ${unit}`}
                  </span>
                </label>
              );
            })}
            <p className="settings-note">修改后立即生效；离线时先保存在本机，联网后自动同步到其他设备。</p>
          </fieldset>

          {submitError && (
            <div className="auth-error" role="alert">
              {submitError}
            </div>
          )}
        </div>

        <div className="modal-footer settings-footer">
          <button type="button" className="action-btn-clean" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="action-btn-primary" disabled={busy}>
            {busy && <Loader2 size={14} className="spin" />}
            保存
          </button>
        </div>
      </form>
    </div>
  );
};

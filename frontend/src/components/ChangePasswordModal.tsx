import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Key, Loader2, X } from 'lucide-react';
import { ApiError, setAccessToken } from '../api/client';
import { changePassword } from '../api/endpoints';
import { isPasswordValid, PASSWORD_RULES } from '../utils/password';

interface Props {
  username: string;
  onClose: () => void;
  onLogout: () => void;
  syncNow: () => Promise<void>;
}

type Step = 'idle' | 'syncing' | 'saving';

type PwdErrors = { old?: string; new?: string; confirm?: string };

export const ChangePasswordModal: React.FC<Props> = ({ username, onClose, onLogout, syncNow }) => {
  const [old, setOld] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [errors, setErrors] = useState<PwdErrors>({});
  const [submitError, setSubmitError] = useState('');

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // 关闭后还焦点
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => opener?.focus?.(), [opener]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step !== 'idle') return;

    const next: PwdErrors = {};
    if (!old) next.old = '请输入原密码';
    if (!newPwd) next.new = '请输入新密码';
    else if (newPwd.length < 8) next.new = '新密码至少 8 位';
    else if (!/[A-Za-z]/.test(newPwd)) next.new = '新密码需包含英文字母';
    else if (!/\d/.test(newPwd)) next.new = '新密码需包含数字';
    if (newPwd && confirm && newPwd !== confirm) next.confirm = '两次输入的新密码不一致';
    if (Object.keys(next).length) { setErrors(next); return; }

    setSubmitError('');
    setStep('syncing');
    try { await syncNow(); } catch { /* 同步失败不阻断 */ }

    setStep('saving');
    try {
      await changePassword(old, newPwd);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 400 ? '原密码不正确' : err.message
          : '网络连接中断，密码未修改。请检查网络后重试。';
      setSubmitError(msg);
      setStep('idle');
      return;
    }

    setAccessToken(null);
    onLogout();
  };

  const busy = step !== 'idle';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal-card settings-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chpwd-modal-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        noValidate
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon">
              <Key size={20} />
            </div>
            <div>
              <div className="modal-title" id="chpwd-modal-title">修改密码</div>
              <div className="modal-subtitle">账号：{username}</div>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="settings-body">
          <fieldset className="settings-section">
            <legend className="settings-section-title" style={{ border: 0, padding: 0 }}>密码信息</legend>

            {/* 原密码 */}
            <label className="settings-field">
              <span className="settings-label">原密码</span>
              <span className={`settings-input-wrap${errors.old ? ' invalid' : ''}`}>
                <input
                  type={showOld ? 'text' : 'password'}
                  value={old}
                  onChange={(e) => { setOld(e.target.value); setErrors((x) => ({ ...x, old: undefined })); setSubmitError(''); }}
                  autoComplete="current-password"
                  maxLength={128}
                  disabled={busy}
                  autoFocus
                  aria-invalid={errors.old ? true : undefined}
                />
                <button type="button" className="settings-eye-btn" onClick={() => setShowOld((v) => !v)} aria-label={showOld ? '隐藏原密码' : '显示原密码'} aria-pressed={showOld}>
                  {showOld ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </span>
              {errors.old && <span className="settings-error" role="alert">{errors.old}</span>}
            </label>

            {/* 新密码 */}
            <label className="settings-field">
              <span className="settings-label">新密码</span>
              <span className={`settings-input-wrap${errors.new ? ' invalid' : ''}`}>
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPwd}
                  onChange={(e) => { setNewPwd(e.target.value); setErrors((x) => ({ ...x, new: undefined })); }}
                  autoComplete="new-password"
                  maxLength={128}
                  disabled={busy}
                  aria-invalid={errors.new ? true : undefined}
                />
                <button type="button" className="settings-eye-btn" onClick={() => setShowNew((v) => !v)} aria-label={showNew ? '隐藏新密码' : '显示新密码'} aria-pressed={showNew}>
                  {showNew ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </span>
              {errors.new && <span className="settings-error" role="alert">{errors.new}</span>}
              {newPwd && (
                <ul className="pwd-rules-list" aria-label="密码强度要求">
                  {PASSWORD_RULES.map((r) => (
                    <li key={r.key} className={r.test(newPwd) ? 'pass' : 'fail'}>
                      {r.test(newPwd) ? '✓' : '✗'} {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </label>

            {/* 确认新密码 */}
            <label className="settings-field">
              <span className="settings-label">确认新密码</span>
              <span className={`settings-input-wrap${errors.confirm ? ' invalid' : ''}`}>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setErrors((x) => ({ ...x, confirm: undefined })); }}
                  autoComplete="new-password"
                  maxLength={128}
                  disabled={busy}
                  aria-invalid={errors.confirm ? true : undefined}
                />
                <button type="button" className="settings-eye-btn" onClick={() => setShowConfirm((v) => !v)} aria-label={showConfirm ? '隐藏确认密码' : '显示确认密码'} aria-pressed={showConfirm}>
                  {showConfirm ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </span>
              {errors.confirm && <span className="settings-error" role="alert">{errors.confirm}</span>}
            </label>

            {submitError && <div className="auth-error" role="alert">{submitError}</div>}

            <p className="settings-note">修改前会先同步学习记录。密码修改后，其他设备将退出登录。</p>
          </fieldset>
        </div>

        <div className="modal-footer settings-footer">
          <button type="button" className="action-btn-clean" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            className="action-btn-primary"
            disabled={busy || !old || !newPwd || !confirm || !isPasswordValid(newPwd)}
          >
            {step === 'syncing' && <><Loader2 size={14} className="spin" /> 同步中…</>}
            {step === 'saving' && <><Loader2 size={14} className="spin" /> 修改中…</>}
            {step === 'idle' && '修改密码'}
          </button>
        </div>
      </form>
    </div>
  );
};

import React, { useState } from 'react';
import { Sparkles, LogIn, UserPlus, Loader2, User, Smile, LockKeyhole, Eye, EyeOff } from 'lucide-react';
import { ApiError } from '../api/client';
import { login, register } from '../api/endpoints';

interface Props {
  onSuccess: () => void;
}

type Tab = 'login' | 'register';

export const LoginPage: React.FC<Props> = ({ onSuccess }) => {
  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const switchTab = (t: Tab) => {
    setTab(t);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (tab === 'register') {
      if (password !== confirm) return setError('两次输入的密码不一致');
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return setError('密码至少 8 位，且需同时包含字母和数字');
      }
    }
    setBusy(true);
    setError('');
    try {
      if (tab === 'login') await login(username.trim(), password);
      else await register(username.trim(), password, nickname.trim() || username.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败，请稍后再试');
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <div className="auth-welcome">
          <div className="auth-brand">
            <span className="auth-brand-mark" aria-hidden="true">
              <Sparkles size={21} />
            </span>
            <div className="auth-brand-text">
              <span className="auth-brand-title">EtymoMind</span>
              <span className="auth-brand-sub">词根脉络思维导图</span>
            </div>
          </div>
          <div className="auth-heading">
            <h1>{tab === 'login' ? '欢迎回来' : '创建账号'}</h1>
            <p>{tab === 'login' ? '从词根出发，继续连接你的英语世界。' : '注册后学习记录会同步到服务器，随时随地接着学。'}</p>
          </div>
        </div>

        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'login'} className={tab === 'login' ? 'active' : ''} onClick={() => switchTab('login')}>
            登录
          </button>
          <button type="button" role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'active' : ''} onClick={() => switchTab('register')}>
            注册
          </button>
        </div>

        <div className="auth-fields">
          <label className="auth-field">
            <span className="auth-label">用户名</span>
            <span className="auth-input">
              <User size={16} aria-hidden="true" />
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={32} required autoFocus />
            </span>
          </label>
          {tab === 'register' && (
            <label className="auth-field">
              <span className="auth-label">昵称（可选）</span>
              <span className="auth-input">
                <Smile size={16} aria-hidden="true" />
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="nickname" maxLength={32} />
              </span>
            </label>
          )}
          <label className="auth-field">
            <span className="auth-label">密码</span>
            <span className="auth-input">
              <LockKeyhole size={16} aria-hidden="true" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="auth-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
              >
                {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </span>
          </label>
          {tab === 'register' && (
            <label className="auth-field">
              <span className="auth-label">确认密码</span>
              <span className="auth-input">
                <LockKeyhole size={16} aria-hidden="true" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  maxLength={128}
                  required
                />
              </span>
            </label>
          )}
        </div>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="auth-submit" disabled={busy || !username.trim() || !password}>
          {busy ? <Loader2 size={18} className="spin" /> : tab === 'login' ? <LogIn size={18} /> : <UserPlus size={18} />}
          {tab === 'login' ? '登录' : '注册并登录'}
        </button>
        <p className="auth-hint">{tab === 'register' ? '密码 8 位以上，需同时包含字母和数字' : '学习记录安全同步，换个设备也能接着学。'}</p>
      </form>
      <p className="auth-footnote">EtymoMind · 每一个单词，都有迹可循</p>
    </div>
  );
};

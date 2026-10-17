import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { refreshAccessToken, setUnauthorizedHandler } from './api/client';
import { getMe, getRoots, logout, type User } from './api/endpoints';
import type { RootData } from './types';
import { LoginPage } from './components/LoginPage';
import { StudyApp } from './App';
import './App.css';

type Phase =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; user: User; roots: RootData[] };

/** 恢复登录状态、加载用户与词库，之后才进入学习界面 */
export function AuthGate() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const loadSession = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const [user, roots] = await Promise.all([getMe(), getRoots()]);
      setPhase({ kind: 'ready', user, roots });
    } catch (err) {
      setPhase({ kind: 'error', message: (err as Error).message });
    }
  }, []);

  // 打开页面时用 refresh Cookie 换 access token；没有登录过则显示登录页
  const restore = useCallback(async () => {
    const r = await refreshAccessToken();
    if (r === 'ok') await loadSession();
    else if (r === 'expired') setPhase({ kind: 'login' });
    else setPhase({ kind: 'error', message: '无法连接服务器，请检查网络或后端服务' });
  }, [loadSession]);

  useEffect(() => {
    // restore 内的 setState 都在 await 之后执行，不会在 effect 中同步触发渲染
    // oxlint-disable-next-line react/set-state-in-effect
    void restore();
  }, [restore]);

  // 登录彻底失效（refresh token 过期或被作废）时回到登录页；本机未上传的记录会保留，重新登录后继续上传
  useEffect(() => {
    setUnauthorizedHandler(() => setPhase({ kind: 'login' }));
    return () => setUnauthorizedHandler(null);
  }, []);

  // 设置里改了昵称等资料后，用服务端返回的用户信息替换
  const handleUserChange = useCallback((user: User) => {
    setPhase((p) => (p.kind === 'ready' && p.user.id === user.id ? { ...p, user } : p));
  }, []);

  const handleLogout = useCallback(async () => {
    await logout().catch(() => {});
    setPhase({ kind: 'login' });
  }, []);

  switch (phase.kind) {
    case 'loading':
      return (
        <div className="auth-page">
          <div className="auth-status">
            <Loader2 size={20} className="spin" /> 正在加载…
          </div>
        </div>
      );
    case 'login':
      return <LoginPage onSuccess={loadSession} />;
    case 'error':
      return (
        <div className="auth-page">
          <div className="auth-status">
            <span>{phase.message}</span>
            <button className="action-btn-clean" onClick={() => {
                setPhase({ kind: 'loading' });
                void restore();
              }}>
              重试
            </button>
          </div>
        </div>
      );
    case 'ready':
      if (phase.roots.length === 0) {
        return (
          <div className="auth-page">
            <div className="auth-status">
              <span>词库还是空的，请管理员先导入词根（backend: uv run python -m scripts.seed_vocab）</span>
              <button className="action-btn-clean" onClick={handleLogout}>
                退出登录
              </button>
            </div>
          </div>
        );
      }
      // key：切换账号时重新挂载，避免沿用上一个用户的状态
      return <StudyApp key={phase.user.id} user={phase.user} roots={phase.roots} onLogout={handleLogout} onUserChange={handleUserChange} />;
  }
}

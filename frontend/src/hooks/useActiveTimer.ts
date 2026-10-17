import { useEffect, useRef } from 'react';

/** 无操作超过该时长视为离开，暂停计时 */
export const IDLE_TIMEOUT_MS = 60_000;
/** 累计到该时长时上报一次，避免频繁写入存储 */
const FLUSH_INTERVAL_MS = 15_000;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * 有效学习时长计时：页面可见且最近 60 秒内有操作才计时。
 * 每累计约 15 秒、页面隐藏或卸载时调用 onFlush(ms)。
 */
export function useActiveTimer(onFlush: (ms: number) => void, enabled = true) {
  const onFlushRef = useRef(onFlush);
  useEffect(() => {
    onFlushRef.current = onFlush;
  });

  useEffect(() => {
    if (!enabled) return;

    let lastActivity = Date.now();
    let lastTick = Date.now();
    let pending = 0;

    const isActive = (now: number) =>
      document.visibilityState === 'visible' && now - lastActivity < IDLE_TIMEOUT_MS;

    // 只把两次 tick 之间"处于活跃状态"的部分计入：最多算到最后一次操作后 60 秒
    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible') {
        const activeUntil = Math.min(now, lastActivity + IDLE_TIMEOUT_MS);
        pending += Math.max(0, activeUntil - lastTick);
      }
      lastTick = now;
    };

    const flush = () => {
      tick();
      if (pending > 0) {
        const ms = pending;
        pending = 0;
        onFlushRef.current(ms);
      }
    };

    const onActivity = () => {
      const now = Date.now();
      if (!isActive(now)) {
        // 从闲置恢复：闲置期间不计时
        tick();
        lastTick = now;
      }
      lastActivity = now;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
      else {
        lastTick = Date.now();
        lastActivity = Date.now();
      }
    };

    const interval = window.setInterval(() => {
      tick();
      if (pending >= FLUSH_INTERVAL_MS) flush();
    }, 5_000);

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    return () => {
      flush();
      window.clearInterval(interval);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [enabled]);
}

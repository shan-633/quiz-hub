import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { Attempt } from '../../shared/model';
import { api } from '../api';

export function AttemptTimer({
  attempt,
  onLock,
  onSubmitted,
}: {
  attempt: Attempt;
  onLock: (locked: boolean) => void;
  onSubmitted: (a: Attempt) => void;
}) {
  const initialOffset = attempt.serverNow ? Date.parse(attempt.serverNow) - Date.now() : 0;
  const offset = useRef(initialOffset),
    callbacks = useRef({ onLock, onSubmitted });
  callbacks.current = { onLock, onSubmitted };
  const [now, setNow] = useState(Date.now() + offset.current),
    [error, setError] = useState('');
  const due = Date.parse(attempt.dueAt ?? '');
  useEffect(() => {
    if (!Number.isFinite(due) || attempt.status !== 'active') return;
    let alive = true,
      checking = false,
      done = false,
      nextCheck = 0;
    let controller: AbortController | undefined;
    const verify = async (force = false) => {
      if (!attempt.enforceTimeLimit || checking || done || (!force && Date.now() < nextCheck))
        return;
      checking = true;
      nextCheck = Date.now() + 5000;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      try {
        const a = await api<Attempt>(`/attempts/${attempt.id}`, { signal: controller.signal });
        if (!alive) return;
        if (a.status === 'submitted') {
          done = true;
          callbacks.current.onLock(true);
          callbacks.current.onSubmitted(a);
        } else if (a.serverNow) {
          offset.current = Date.parse(a.serverNow) - Date.now();
          setNow(Date.now() + offset.current);
          callbacks.current.onLock(due <= Date.now() + offset.current);
          setError('');
        }
      } catch {
        if (alive) setError('正在确认交卷状态；网络恢复后会重试，已同步答案由服务器保留。');
      } finally {
        clearTimeout(timeout);
        checking = false;
      }
    };
    const tick = () => {
      const current = Date.now() + offset.current;
      setNow(current);
      if (attempt.enforceTimeLimit && current >= due) {
        callbacks.current.onLock(true);
        void verify();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    const visible = () => {
      if (!document.hidden) {
        tick();
        void verify(true);
      }
    };
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      clearInterval(timer);
      controller?.abort();
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [attempt.id, attempt.status, attempt.dueAt, attempt.enforceTimeLimit]);
  if (!Number.isFinite(due) || attempt.status !== 'active') return null;
  const seconds = Math.max(0, Math.ceil((due - now) / 1000)),
    expired = seconds === 0;
  const time = `${Math.floor(seconds / 3600) ? `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <section
      className={`attempt-clock ${seconds <= 60 ? 'clock-urgent' : ''}`}
      aria-label="作答计时"
    >
      <Clock3 size={22} />
      <div>
        <span>
          {expired
            ? attempt.enforceTimeLimit
              ? '时间到，正在确认交卷'
              : '已超时，可继续完成'
            : '剩余作答时间'}
        </span>
        <strong role="timer" aria-label="剩余时间">
          {time}
        </strong>
      </div>
      <p>
        {error ||
          (attempt.enforceTimeLimit
            ? '到时自动交卷。请及时同步文字、笔迹和照片。'
            : '超时不会自动交卷，提交时会标记迟交。')}
      </p>
    </section>
  );
}

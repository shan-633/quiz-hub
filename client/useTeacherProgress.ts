import { useEffect, useState } from 'react';
import { api, ApiError, progressEventsUrl } from './api';
import type { ProgressChange, StudentProgress } from '../shared/progress';

export function useTeacherProgress(refreshKey: number) {
  const [data, setData] = useState<StudentProgress[] | null>(null);
  const [error, setError] = useState(''),
    [checkedAt, setCheckedAt] = useState('');
  const [status, setStatus] = useState<'connecting' | 'live' | 'retrying' | 'paused'>('connecting');
  const [authError, setAuthError] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false,
      generation = 0,
      failures = 0,
      blocked = false;
    let source: EventSource | null = null,
      probe: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined,
      watchdog: ReturnType<typeof setTimeout> | undefined,
      probeTimer: ReturnType<typeof setTimeout> | undefined;
    const disconnect = () => {
      generation++;
      source?.close();
      source = null;
      probe?.abort();
      probe = null;
      clearTimeout(timer);
      clearTimeout(watchdog);
      clearTimeout(probeTimer);
    };
    const expire = () => {
      blocked = true;
      disconnect();
      setData(null);
      setAuthError(true);
      setError('登录状态已失效，请重新登录教师账号。');
    };
    const connect = () => {
      if (stopped || blocked || document.hidden) return;
      disconnect();
      const token = generation;
      setStatus('connecting');
      setAuthError(false);
      const valid = () => !stopped && generation === token;
      let events: EventSource;
      try {
        events = new EventSource(progressEventsUrl, { withCredentials: true });
      } catch {
        setError('浏览器无法建立实时连接，请重新加载页面。');
        setStatus('retrying');
        return;
      }
      source = events;
      const failed = async () => {
        if (!valid() || source !== events) return;
        events.close();
        source = null;
        clearTimeout(watchdog);
        setStatus('retrying');
        setError('实时连接中断，正在重新连接。');
        probe = new AbortController();
        const controller = probe;
        const timeout = setTimeout(() => controller.abort(), 5000);
        probeTimer = timeout;
        try {
          const me = await api<{ user: { role: string } | null }>('/auth/me', {
            signal: probe.signal,
          });
          if (controller.signal.aborted || !Object.hasOwn(me, 'user'))
            throw new Error('身份检查未完成');
          if (valid() && me.user?.role !== 'teacher') {
            expire();
            return;
          }
        } catch (e) {
          if (valid() && e instanceof ApiError && [401, 403].includes(e.status)) {
            expire();
            return;
          }
        } finally {
          clearTimeout(timeout);
          if (probeTimer === timeout) probeTimer = undefined;
        }
        if (valid() && !document.hidden)
          timer = setTimeout(connect, Math.min(1000 * 2 ** failures++, 15000));
      };
      const alive = () => valid() && source === events;
      const touch = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => void failed(), 45000);
        setCheckedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      };
      events.addEventListener('snapshot', (event) => {
        if (!alive()) return;
        try {
          const rows = JSON.parse((event as MessageEvent).data);
          if (!Array.isArray(rows)) throw new Error('snapshot');
          setData(rows);
          failures = 0;
          setError('');
          setStatus('live');
          touch();
        } catch {
          void failed();
        }
      });
      events.addEventListener('progress', (event) => {
        if (!alive()) return;
        try {
          const change = JSON.parse((event as MessageEvent).data) as ProgressChange;
          if (change.type !== 'upsert' && change.type !== 'remove') throw new Error('event');
          const id = change.type === 'upsert' ? change.row.id : change.id;
          setData((previous) => {
            const rows = (previous ?? []).filter((row) => row.id !== id);
            if (change.type === 'upsert') rows.push(change.row);
            return rows.sort(
              (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
            );
          });
          touch();
        } catch {
          void failed();
        }
      });
      events.addEventListener('heartbeat', () => {
        if (alive()) touch();
      });
      events.addEventListener('session-expired', () => {
        if (alive()) expire();
      });
      events.onerror = () => void failed();
      watchdog = setTimeout(() => void failed(), 20000);
    };
    const visibility = () => {
      if (document.hidden) {
        disconnect();
        setStatus('paused');
      } else connect();
    };
    const online = () => connect();
    const focus = () => {
      if (!source && !document.hidden) connect();
    };
    connect();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', online);
    window.addEventListener('focus', focus);
    return () => {
      stopped = true;
      disconnect();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', focus);
    };
  }, [refreshKey, retry]);
  return { data, error, checkedAt, status, authError, retryNow: () => setRetry((n) => n + 1) };
}

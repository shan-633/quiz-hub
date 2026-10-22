import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '../shared/model';
import type { Conversation } from '../shared/chat';
import { api, ApiError } from './api';
import { useAuth } from './context';
const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
interface ChatState {
  conversations: Conversation[];
  contacts: User[];
  revision: number;
  status: string;
  error: string;
  reload: () => void;
}
const Context = createContext<ChatState>({
  conversations: [],
  contacts: [],
  revision: 0,
  status: 'connecting',
  error: '',
  reload: () => {},
});
export const useChat = () => useContext(Context);
export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [contacts, setContacts] = useState<User[]>([]),
    [revision, setRevision] = useState(0),
    [status, setStatus] = useState('connecting'),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    setConversations([]);
    setContacts([]);
    setError('');
    if (!user || user.role === 'admin' || user.mustChangePassword) return;
    let stopped = false,
      blocked = false,
      generation = 0,
      failures = 0,
      request = 0;
    let source: EventSource | null = null,
      probe: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      watchdog: ReturnType<typeof setTimeout> | undefined,
      probeTimer: ReturnType<typeof setTimeout> | undefined;
    const disconnect = () => {
      generation++;
      source?.close();
      source = null;
      probe?.abort();
      clearTimeout(timer);
      clearTimeout(watchdog);
      clearTimeout(probeTimer);
    };
    const expire = () => {
      blocked = true;
      disconnect();
      setConversations([]);
      setContacts([]);
      setStatus('expired');
      setError('登录状态已失效，请重新登录。');
    };
    const load = async () => {
      const token = generation,
        n = ++request;
      try {
        const [rows, people] = await Promise.all([
          api<Conversation[]>('/chat/conversations'),
          api<User[]>('/chat/contacts'),
        ]);
        if (!stopped && !blocked && token === generation && request === n) {
          setConversations(rows);
          setContacts(people);
          setRevision((v) => v + 1);
        }
      } catch (e) {
        if (!stopped && token === generation) {
          if (e instanceof ApiError && [401, 403].includes(e.status)) expire();
          else setError((e as Error).message);
        }
      }
    };
    const connect = () => {
      if (stopped || blocked || document.hidden) return;
      disconnect();
      const token = generation;
      setStatus('connecting');
      const valid = () => !stopped && !blocked && token === generation;
      const failed = async () => {
        if (!valid() || !source) return;
        source.close();
        source = null;
        clearTimeout(watchdog);
        setStatus('retrying');
        setError('连接中断，正在重连；已加载消息仍可查看。');
        const controller = new AbortController();
        probe = controller;
        probeTimer = setTimeout(() => controller.abort(), 5000);
        try {
          const me = await api<{ user: User | null }>('/auth/me', { signal: controller.signal });
          if (
            !controller.signal.aborted &&
            Object.hasOwn(me, 'user') &&
            valid() &&
            (!me.user ||
              me.user.id !== user.id ||
              me.user.role !== user.role ||
              me.user.mustChangePassword)
          ) {
            expire();
            return;
          }
        } catch (e) {
          if (valid() && e instanceof ApiError && [401, 403].includes(e.status)) {
            expire();
            return;
          }
        } finally {
          clearTimeout(probeTimer);
        }
        if (valid()) timer = setTimeout(connect, Math.min(1000 * 2 ** failures++, 15000));
      };
      const touch = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => void failed(), 45000);
      };
      try {
        source = new EventSource(`${base}/api/chat/events`, { withCredentials: true });
      } catch {
        setStatus('retrying');
        setError('无法建立实时连接，请刷新重试。');
        return;
      }
      const events = source,
        alive = () => valid() && source === events;
      events.addEventListener('snapshot', (event) => {
        if (!alive()) return;
        try {
          const rows = JSON.parse((event as MessageEvent).data);
          if (!Array.isArray(rows)) throw new Error();
          request++;
          setConversations(rows);
          setError('');
          setStatus('live');
          failures = 0;
          touch();
          void load();
        } catch {
          void failed();
        }
      });
      events.addEventListener('changed', () => {
        if (alive()) {
          touch();
          void load();
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
      refresh.current = () => {
        if (valid()) void load();
      };
    };
    const visibility = () => {
      if (document.hidden) {
        disconnect();
        setStatus('paused');
      } else connect();
    };
    const online = () => connect();
    connect();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', online);
    return () => {
      stopped = true;
      disconnect();
      refresh.current = () => {};
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', online);
    };
  }, [user?.id, user?.role, user?.mustChangePassword, retry]);
  return (
    <Context.Provider
      value={{
        conversations,
        contacts,
        revision,
        status,
        error,
        reload: () => {
          if (status === 'expired' || status === 'retrying') setRetry((v) => v + 1);
          else refresh.current();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '../shared/model';
import type { Conversation } from '../shared/chat';
import { api, ApiError, json } from './api';
import type { PresenceSnapshot } from '../shared/presence';
import { randomId } from '../shared/browserIds';
import { useAuth } from './context';
const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
interface ChatState {
  conversations: Conversation[];
  contacts: User[];
  revision: number;
  status: string;
  error: string;
  reload: () => void;
  presence: PresenceSnapshot;
  reportActivity: (attemptId?: string) => void;
}
const Context = createContext<ChatState>({
  conversations: [],
  contacts: [],
  revision: 0,
  status: 'connecting',
  error: '',
  reload: () => {},
  presence: {},
  reportActivity: () => {},
});
export const useChat = () => useContext(Context);
export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [presenceState, setPresence] = useState({ owner: '', values: {} as PresenceSnapshot });
  const [activity, setActivity] = useState<{ owner: string; attemptId?: string }>({ owner: '' });
  const [clientId] = useState(randomId);
  const sequence = useRef(0);
  const reportActivity = useCallback(
    (attemptId?: string) => {
      setActivity({ owner: user?.id ?? '', attemptId });
    },
    [user?.id],
  );
  useEffect(() => {
    if (!user || user.role === 'admin' || user.mustChangePassword) return;
    const send = async (offline = false) => {
      const attemptId = activity.owner === user.id ? activity.attemptId : undefined;
      try {
        await api('/chat/presence', {
          method: 'POST',
          keepalive: offline,
          body: json({
            clientId,
            sequence: ++sequence.current,
            ...(attemptId ? { attemptId } : {}),
            ...(offline ? { offline: true } : {}),
          }),
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 422 && attemptId)
          setActivity((old) =>
            old.owner === user.id && old.attemptId === attemptId ? { owner: user.id } : old,
          );
      }
    };
    const heartbeat = () => void send();
    const leave = () => void send(true);
    heartbeat();
    const timer = setInterval(heartbeat, 25000);
    window.addEventListener('online', heartbeat);
    window.addEventListener('pageshow', heartbeat);
    window.addEventListener('pagehide', leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', heartbeat);
      window.removeEventListener('pageshow', heartbeat);
      window.removeEventListener('pagehide', leave);
    };
  }, [
    user?.id,
    user?.role,
    user?.mustChangePassword,
    activity.owner,
    activity.attemptId,
    clientId,
  ]);
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
    setPresence({ owner: user?.id ?? '', values: {} });
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
      setPresence({ owner: user.id, values: {} });
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
        setPresence({ owner: user.id, values: {} });
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
      events.addEventListener('presence', (event) => {
        if (!alive()) return;
        try {
          const values = JSON.parse((event as MessageEvent).data);
          if (
            !values ||
            Array.isArray(values) ||
            typeof values !== 'object' ||
            Object.values(values).some(
              (v) => !['offline', 'online', 'practicing', 'examining'].includes(v as string),
            )
          )
            return;
          setPresence({ owner: user.id, values });
          touch();
        } catch {}
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
        presence: presenceState.owner === user?.id ? presenceState.values : {},
        reportActivity,
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

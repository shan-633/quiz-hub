import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, Send, UsersRound, Paperclip, X, RefreshCw } from 'lucide-react';
import type { ChatMessage, MessagePage } from '../../shared/chat';
import { useAuth } from '../context';
import { useChat } from '../chatContext';
import { api, json } from '../api';
import { randomId } from '../../shared/browserIds';
import { EmptyState, Loading, Modal, formatDate } from '../components/ui';
interface Pending {
  id: string;
  conversationId: string;
  body: string;
  reference?: { attemptId: string; questionId: string };
  busy: boolean;
  error: string;
}
export function ChatPage() {
  const { user } = useAuth(),
    chat = useChat();
  const [params] = useSearchParams();
  const requestedConversation = params.get('conversation');
  const [selected, setSelected] = useState(''),
    [messages, setMessages] = useState<ChatMessage[]>([]),
    [hasMore, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [older, setOlder] = useState(false),
    [error, setError] = useState(''),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [pending, setPending] = useState<Pending[]>([]),
    [query, setQuery] = useState(''),
    [visible, setVisible] = useState(!document.hidden),
    [endVisible, setEndVisible] = useState(false),
    [reference, setReference] = useState<{
      attemptId: string;
      questionId: string;
      label: string;
    } | null>(null),
    [picking, setPicking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null),
    end = useRef<HTMLDivElement>(null),
    selection = useRef(selected),
    lastRead = useRef(''),
    readsInFlight = useRef(new Set<string>()),
    cursor = useRef({ id: '', messageId: 0 }),
    previous = useRef('');
  selection.current = selected;
  const conversation = chat.conversations.find((c) => c.id === selected),
    draft = drafts[selected] ?? '';
  useEffect(() => {
    if (requestedConversation && chat.conversations.some((c) => c.id === requestedConversation))
      setSelected(requestedConversation);
  }, [requestedConversation, !!chat.conversations.find((c) => c.id === requestedConversation)]);
  useEffect(() => {
    const fn = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, []);
  useEffect(() => {
    if (chat.status === 'expired') {
      setMessages([]);
      setSelected('');
      setPending([]);
      setDrafts({});
      setReference(null);
      return;
    }
    if (!selected) return;
    let alive = true;
    const controller = new AbortController(),
      changed = previous.current !== selected || cursor.current.id !== selected;
    previous.current = selected;
    if (changed) {
      setMessages([]);
      setLoading(true);
      setReference(null);
      lastRead.current = '';
    }
    setError('');
    const fetchPage = async () => {
      let after = changed ? undefined : cursor.current.messageId;
      let page = await api<MessagePage>(
        `/chat/conversations/${selected}/messages${after === undefined ? '' : '?after=' + after}`,
        { signal: controller.signal },
      );
      const rows = [...page.messages];
      const hasMore = page.hasMore;
      while (after !== undefined && page.hasMore && alive) {
        const next = page.messages.at(-1)?.id;
        if (next === undefined || next <= after) throw new Error('消息同步未完成，请刷新重试');
        after = next;
        page = await api<MessagePage>(`/chat/conversations/${selected}/messages?after=${after}`, {
          signal: controller.signal,
        });
        rows.push(...page.messages);
      }
      return { messages: rows, hasMore };
    };
    fetchPage()
      .then((page) => {
        if (!alive) return;
        cursor.current = {
          id: selected,
          messageId: page.messages.at(-1)?.id ?? (changed ? 0 : cursor.current.messageId),
        };
        setMessages((old) => {
          const map = new Map((changed ? [] : old).map((m) => [m.id, m]));
          for (const m of page.messages) map.set(m.id, m);
          return [...map.values()].sort((a, b) => a.id - b.id);
        });
        if (changed) setMore(page.hasMore);
        if (changed || endVisible)
          requestAnimationFrame(() => {
            if (alive && scroller.current)
              scroller.current.scrollTop = scroller.current.scrollHeight;
          });
      })
      .catch((e) => {
        if (alive && e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [selected, chat.revision, chat.status]);
  useEffect(() => {
    const node = end.current;
    if (!node || !selected) return;
    if (typeof IntersectionObserver === 'undefined') {
      setEndVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setEndVisible(entries[0]?.isIntersecting ?? false),
      { root: scroller.current, threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [selected, loading]);
  const latest = messages.at(-1)?.id;
  useEffect(() => {
    const key = `${selected}:${latest}`;
    if (
      !selected ||
      !latest ||
      !visible ||
      !endVisible ||
      !conversation?.unread ||
      lastRead.current === key ||
      readsInFlight.current.has(key)
    )
      return;
    readsInFlight.current.add(key);
    void api(`/chat/conversations/${selected}/read`, {
      method: 'POST',
      body: json({ messageId: latest }),
    })
      .then(() => {
        lastRead.current = key;
        chat.reload();
      })
      .catch((e) => {
        if (selection.current === selected) setError(e.message);
      })
      .finally(() => readsInFlight.current.delete(key));
  }, [selected, latest, visible, endVisible, conversation?.unread, chat.revision, chat.status]);
  const send = async (p: Pending) => {
    setPending((old) => old.map((x) => (x.id === p.id ? { ...x, busy: true, error: '' } : x)));
    try {
      const message = await api<ChatMessage>(`/chat/conversations/${p.conversationId}/messages`, {
        method: 'POST',
        body: json({
          body: p.body,
          clientMessageId: p.id,
          ...(p.reference ? { reference: p.reference } : {}),
        }),
      });
      setPending((old) => old.filter((x) => x.id !== p.id));
      if (selection.current === p.conversationId) {
        setMessages((old) =>
          [...old.filter((m) => m.id !== message.id), message].sort((a, b) => a.id - b.id),
        );
        requestAnimationFrame(() => {
          if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
        });
      }
      chat.reload();
    } catch (e) {
      setPending((old) =>
        old.map((x) => (x.id === p.id ? { ...x, busy: false, error: (e as Error).message } : x)),
      );
    }
  };
  const submit = () => {
    if (!draft.trim() || !conversation?.canSend) return;
    const p: Pending = {
      id: randomId(),
      conversationId: selected,
      body: draft.trim(),
      busy: true,
      error: '',
      ...(reference
        ? { reference: { attemptId: reference.attemptId, questionId: reference.questionId } }
        : {}),
    };
    setPending((old) => [...old, p]);
    setDrafts((old) => ({ ...old, [selected]: '' }));
    setReference(null);
    void send(p);
  };
  const loadOlder = async () => {
    if (!messages.length) return;
    setOlder(true);
    const id = selected,
      height = scroller.current?.scrollHeight ?? 0,
      top = scroller.current?.scrollTop ?? 0;
    try {
      const page = await api<MessagePage>(
        `/chat/conversations/${id}/messages?before=${messages[0].id}`,
      );
      if (selection.current === id) {
        setMessages((old) => {
          const map = new Map([...page.messages, ...old].map((m) => [m.id, m]));
          return [...map.values()].sort((a, b) => a.id - b.id);
        });
        setMore(page.hasMore);
        requestAnimationFrame(() => {
          if (scroller.current && selection.current === id)
            scroller.current.scrollTop = top + scroller.current.scrollHeight - height;
        });
      }
    } catch (e) {
      if (selection.current === id) setError((e as Error).message);
    } finally {
      setOlder(false);
    }
  };
  const start = async (peerId: string) => {
    try {
      const c = await api<{ id: string }>('/chat/conversations', {
        method: 'POST',
        body: json({ peerId }),
      });
      chat.reload();
      setSelected(c.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const matches = (name: string) => name.toLowerCase().includes(query.toLowerCase());
  return (
    <section className="community-page chat-page">
      <header className="community-heading">
        <div>
          <div className="eyebrow">LEARNING TOGETHER</div>
          <h1>问题，有人一起想。</h1>
          <p className="muted">
            {user?.role === 'teacher'
              ? '与你的学生沟通，围绕每一道题展开。'
              : '与你的教师沟通，让思路继续向前。'}
          </p>
        </div>
        <MessageCircle size={34} />
      </header>
      <div className="chat-status">
        <span className={`connection-dot ${chat.status === 'live' ? 'connected' : ''}`} />
        {chat.status === 'live'
          ? '实时连接已建立'
          : chat.status === 'paused'
            ? '页面隐藏，已暂停连接'
            : chat.status === 'expired'
              ? '登录已失效'
              : '正在连接…'}
        <button className="text-button" onClick={chat.reload}>
          <RefreshCw size={14} />
          刷新
        </button>
        {chat.status === 'expired' && <Link to="/login">重新登录</Link>}
      </div>
      {chat.error && (
        <p role="alert" className="inline-error">
          {chat.error}
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className={`chat-layout ${selected ? 'has-selection' : ''}`}>
        <aside className="chat-sidebar">
          <label className="field chat-search">
            <span>联系人与私聊</span>
            <input
              aria-label="搜索联系人"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索姓名或账号"
            />
          </label>
          <div className="chat-contacts">
            <p className="chat-section-label">最近会话</p>
            {chat.conversations
              .filter((c) => matches(c.peer.name + ' ' + c.peer.username))
              .map((c) => (
                <button
                  key={c.id}
                  className={`chat-person ${selected === c.id ? 'active' : ''}`}
                  onClick={() => setSelected(c.id)}
                >
                  <span className="avatar">{c.peer.name.slice(-1)}</span>
                  <span className="chat-person-text">
                    <strong>{c.peer.name}</strong>
                    <small>
                      {c.lastMessage ?? '开始一段交流'}
                      {!c.canSend ? ' · 只读' : ''}
                    </small>
                  </span>
                  {c.unread > 0 && (
                    <span className="unread-badge" aria-label={`${c.unread}条未读`}>
                      {c.unread > 99 ? '99+' : c.unread}
                    </span>
                  )}
                </button>
              ))}
            <p className="chat-section-label">
              {user?.role === 'teacher' ? '我的学生' : '我的教师'}
            </p>
            {chat.contacts
              .filter(
                (p) =>
                  !chat.conversations.some((c) => c.peer.id === p.id) &&
                  matches(p.name + ' ' + p.username),
              )
              .map((p) => (
                <button className="chat-person" key={p.id} onClick={() => void start(p.id)}>
                  <span className="avatar">{p.name.slice(-1)}</span>
                  <span className="chat-person-text">
                    <strong>{p.name}</strong>
                    <small>@{p.username}</small>
                  </span>
                </button>
              ))}
            {!chat.contacts.length && !chat.conversations.length && (
              <p className="muted small chat-contact-empty">
                暂无联系人，请等待管理员分配师生关系。
              </p>
            )}
          </div>
        </aside>
        <div className="chat-detail">
          {!selected ? (
            <EmptyState title="选一位联系人，开始交流" description="消息只在你与对方之间可见。">
              <UsersRound size={32} />
            </EmptyState>
          ) : (
            <>
              <header className="chat-detail-heading">
                <button
                  className="icon-button chat-back"
                  aria-label="返回会话列表"
                  onClick={() => {
                    setSelected('');
                    previous.current = '';
                  }}
                >
                  <ArrowLeft size={20} />
                </button>
                <span className="avatar">{conversation?.peer.name.slice(-1) ?? '·'}</span>
                <div>
                  <h2>{conversation?.peer.name ?? '正在载入会话…'}</h2>
                  <p className="muted small">
                    {conversation?.canSend
                      ? '关联师生 · 私聊'
                      : '师生关系已解除或账号已停用，当前会话只读'}
                  </p>
                </div>
              </header>
              <div className="chat-messages" ref={scroller} role="log" aria-label="聊天消息">
                {loading ? (
                  <Loading />
                ) : (
                  <>
                    {hasMore && (
                      <button
                        className="button small chat-older"
                        disabled={older}
                        onClick={() => void loadOlder()}
                      >
                        {older ? '正在加载…' : '加载更早消息'}
                      </button>
                    )}
                    {!messages.length && !error && (
                      <p className="muted chat-empty">从一个问题开始，留下你的思考。</p>
                    )}
                    {messages.map((m) => (
                      <article
                        className={`chat-message ${m.senderId === user?.id ? 'mine' : ''}`}
                        key={m.id}
                      >
                        <div className="message-bubble">
                          {m.body}
                          {m.reference && conversation?.canSend ? (
                            <Link className="message-reference" to={m.reference.href}>
                              <Paperclip size={14} />
                              {m.reference.label}
                            </Link>
                          ) : m.referenceUnavailable || m.reference ? (
                            <small className="message-reference">引用题目当前不可访问</small>
                          ) : null}
                        </div>
                        <time>{formatDate(m.createdAt)}</time>
                      </article>
                    ))}
                    {pending
                      .filter((p) => p.conversationId === selected)
                      .map((p) => (
                        <article className="chat-message mine pending" key={p.id}>
                          <div className="message-bubble">{p.body}</div>
                          <small>{p.busy ? '正在发送…' : p.error}</small>
                          {!p.busy && (
                            <button
                              className="text-button"
                              disabled={!conversation?.canSend}
                              onClick={() => void send(p)}
                            >
                              重试发送
                            </button>
                          )}
                        </article>
                      ))}
                    <div ref={end} className="chat-end" aria-hidden="true" />
                  </>
                )}
              </div>
              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                {reference && (
                  <div className="composer-reference">
                    <Paperclip size={14} />
                    <span>{reference.label}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="移除题目引用"
                      onClick={() => setReference(null)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                <textarea
                  aria-label="消息内容"
                  maxLength={4000}
                  placeholder={conversation?.canSend ? '写下你的问题或思路…' : '当前会话只读'}
                  value={draft}
                  disabled={!conversation?.canSend || chat.status === 'expired'}
                  onChange={(e) => setDrafts((old) => ({ ...old, [selected]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      (e.ctrlKey || e.metaKey) &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <div className="composer-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={!conversation?.canSend}
                    onClick={() => setPicking(true)}
                  >
                    <Paperclip size={15} />
                    引用已交卷题目
                  </button>
                  <span className="muted small">Ctrl / ⌘ + Enter 发送</span>
                  <button
                    className="button primary"
                    aria-label="发送消息"
                    disabled={!conversation?.canSend || !draft.trim() || chat.status === 'expired'}
                  >
                    <Send size={16} />
                    发送
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
      {picking && conversation && (
        <ReferencePicker
          peerId={conversation.peer.id}
          onClose={() => setPicking(false)}
          onPick={(r) => {
            setReference(r);
            setPicking(false);
          }}
        />
      )}
    </section>
  );
}
function ReferencePicker({
  peerId,
  onPick,
  onClose,
}: {
  peerId: string;
  onPick: (r: { attemptId: string; questionId: string; label: string }) => void;
  onClose: () => void;
}) {
  const { user } = useAuth(),
    [attempts, setAttempts] = useState<any[]>([]),
    [questions, setQuestions] = useState<{ id: string; title: string }[]>([]),
    [selected, setSelected] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api<any[]>(user?.role === 'teacher' ? '/teacher/attempts' : '/attempts')
      .then((rows) => {
        if (alive)
          setAttempts(
            rows.filter((a) =>
              user?.role === 'teacher'
                ? a.student?.id === peerId
                : a.status === 'submitted' && a.gradingMode !== 'self' && a.teacherId === peerId,
            ),
          );
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [peerId, user?.role]);
  useEffect(() => {
    setQuestions([]);
    if (!selected) return;
    let alive = true;
    setLoading(true);
    api<any>(`${user?.role === 'teacher' ? '/teacher' : ''}/attempts/${selected}`)
      .then((a) => {
        if (alive) setQuestions(a.questions);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected, user?.role]);
  return (
    <Modal title="引用已交卷题目" onClose={onClose}>
      <p className="muted">仅附上题目链接，不会附带作答、解析或评语。</p>
      <label className="field">
        选择答卷
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">请选择已交卷记录</option>
          {attempts.map((a) => (
            <option value={a.id} key={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <Loading />
      ) : error ? (
        <p role="alert" className="inline-error">
          {error}
        </p>
      ) : !attempts.length ? (
        <p>暂无双方可引用的已交卷记录。</p>
      ) : (
        questions.map((q, i) => (
          <button
            className="reference-choice"
            key={q.id}
            onClick={() =>
              onPick({
                attemptId: selected,
                questionId: q.id,
                label: `${attempts.find((a) => a.id === selected)?.title} · 第${i + 1}题`,
              })
            }
          >
            第{i + 1}题 · {q.title}
          </button>
        ))
      )}
    </Modal>
  );
}

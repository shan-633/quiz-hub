import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCheck,
  ClipboardList,
  Clock3,
  MessageCircle,
  NotebookPen,
  RefreshCw,
} from 'lucide-react';
import type { LibraryItem } from '../../shared/model';
import type { StudentTask } from '../../shared/assignments';
import { taskStatusLabels } from '../../shared/assignments';
import { attemptHref, learningStage, learningStageLabels } from '../../shared/learningOverview';
import type { AttemptSummary } from '../../shared/learningOverview';
import { useLoad } from '../useLoad';
import { useOpeningClock } from '../useOpeningClock';
import { isBeforeOpening } from '../../shared/availability';
import { useAuth } from '../context';
import { useChat } from '../chatContext';
import { Loading, formatDate } from '../components/ui';
import { LearningHeatmap } from '../components/LearningHeatmap';
import { DailyQuestionPanel } from '../components/DailyQuestionPanel';
import '../learningOverview.css';
import { useDirections, CurriculumTag } from '../directions';

function LoadNotice({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="learning-load-error" role="alert">
      <span>{error}</span>
      <button onClick={retry}>重试</button>
    </div>
  );
}
export function StudentHomePage() {
  const { matches, scope } = useDirections();
  const { user } = useAuth(),
    chat = useChat();
  const attempts = useLoad<AttemptSummary[]>('/attempts');
  const tasks = useLoad<StudentTask[]>('/tasks');
  const library = useLoad<LibraryItem[]>('/library');
  const now = useOpeningClock((tasks.data ?? []).map((t) => t.opensAt));
  const refresh = useCallback(() => {
    attempts.reload();
    tasks.reload();
    library.reload();
  }, [attempts.reload, tasks.reload, library.reload]);
  const teacherKey = chat.contacts
    .filter((p) => p.role === 'teacher')
    .map((p) => p.id)
    .sort()
    .join(',');
  const priorTeachers = useRef(teacherKey);
  useEffect(() => {
    if (priorTeachers.current !== teacherKey) {
      priorTeachers.current = teacherKey;
      refresh();
    }
  }, [teacherKey, refresh]);
  useEffect(() => {
    let last = Date.now();
    const onReturn = () => {
      if (!document.hidden && Date.now() - last >= 15000) {
        last = Date.now();
        refresh();
      }
    };
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refresh]);
  const history = [...(attempts.data ?? []).filter(matches)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const active = history.filter((a) => a.status === 'active' && a.available !== false);
  const recent = active[0];
  const newTasks = (tasks.data ?? [])
    .filter(matches)
    .map((t) =>
      t.status === 'scheduled' && !isBeforeOpening(t.opensAt, now)
        ? { ...t, status: 'not_started' as const }
        : t,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  const todo = (tasks.data ?? [])
    .filter(matches)
    .filter((t) => ['not_started', 'scheduled', 'active'].includes(t.status)).length;
  const waiting = history.filter((a) => ['pending', 'self'].includes(learningStage(a))).length;
  const messages = chat.conversations
    .filter((c) => c.peer.role === 'teacher' && c.latestReceived)
    .sort((a, b) => b.latestReceived!.createdAt.localeCompare(a.latestReceived!.createdAt))
    .slice(0, 3);
  const unread = chat.conversations.reduce((n, c) => n + c.unread, 0);
  const showcases = (library.data ?? [])
    .filter(matches)
    .filter((b) => b.deliveryMode !== 'assigned')
    .slice()
    .reverse()
    .slice(0, 3);
  const refreshing = attempts.loading || tasks.loading || library.loading;
  return (
    <div className="page learning-home">
      <header className="learning-home-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-line" /> MY LEARNING
          </div>
          <h1>
            {user?.name ?? '同学'}，今天也向前一步<span className="teal">。</span>
          </h1>
          <p>
            {scope
              ? '当前概览仅统计所选方向，切换全部方向可查看所有记录。'
              : '看看各个方向最近的收获，再开始下一份练习。'}
          </p>
        </div>
        <button
          className="button learning-refresh"
          onClick={() => {
            refresh();
            chat.reload();
          }}
          disabled={refreshing}
        >
          <RefreshCw size={15} className={refreshing ? 'learning-spinning' : ''} />
          {refreshing ? '更新中' : '刷新概览'}
        </button>
      </header>
      <DailyQuestionPanel />
      <div className="learning-stat-grid">
        <Link to="/tasks" className="learning-stat">
          <span className="learning-stat-icon">
            <ClipboardList size={21} />
          </span>
          <span>
            <small>待完成任务</small>
            <strong>
              {tasks.data ? todo : '—'}
              <em> 份</em>
            </strong>
          </span>
          <ArrowUpRight size={18} />
        </Link>
        <Link to="/history" className="learning-stat">
          <span className="learning-stat-icon amber">
            <Clock3 size={21} />
          </span>
          <span>
            <small>等待批改 / 自评</small>
            <strong>
              {attempts.data ? waiting : '—'}
              <em> 份</em>
            </strong>
          </span>
          <ArrowUpRight size={18} />
        </Link>
        <Link to="/chat" className="learning-stat">
          <span className="learning-stat-icon blue">
            <MessageCircle size={21} />
          </span>
          <span>
            <small>教师未读消息</small>
            <strong>
              {chat.status === 'connecting' ? '—' : unread}
              <em> 条</em>
            </strong>
          </span>
          <ArrowUpRight size={18} />
        </Link>
      </div>
      {recent && (
        <Link className="learning-continue" to={attemptHref(recent)}>
          <span className="learning-continue-icon">
            <NotebookPen size={23} />
          </span>
          <div>
            <small>接着上次的思路</small>
            <h2>{recent.title}</h2>
            <p>
              已保存 {recent.answeredCount} / {recent.questionCount} 题
              {active.length > 1 ? ` · 还有${active.length - 1}份未答完` : ''}
            </p>
          </div>
          <span className="learning-continue-action">
            继续作答 <ArrowRight size={18} />
          </span>
        </Link>
      )}
      <section className="learning-panel learning-heatmap-panel" aria-label="近期作答正确情况">
        <div className="learning-panel-heading">
          <div>
            <div className="eyebrow">YOUR PROGRESS, DAY BY DAY</div>
            <h2>把进步，留在每一天。</h2>
            <p>最近12周 · 点击日期，查看那天的试卷结果</p>
          </div>
          <span className="learning-date-pill">
            <CalendarDays size={14} />
            近12周
          </span>
        </div>
        {attempts.error ? (
          <LoadNotice error={attempts.error} retry={attempts.reload} />
        ) : attempts.loading && !attempts.data ? (
          <Loading />
        ) : (
          <LearningHeatmap attempts={(attempts.data ?? []).filter(matches)} />
        )}
      </section>
      <div className="learning-module-grid">
        <section className="learning-panel" aria-label="最新收到">
          <div className="learning-panel-heading">
            <div>
              <span className="learning-module-eyebrow">
                <ClipboardList size={15} /> FROM YOUR TEACHERS
              </span>
              <h2>最新收到</h2>
            </div>
            <Link className="learning-view-all" to="/tasks">
              全部任务 <ArrowUpRight size={15} />
            </Link>
          </div>
          {tasks.error ? (
            <LoadNotice error={tasks.error} retry={tasks.reload} />
          ) : tasks.loading && !tasks.data ? (
            <Loading />
          ) : !newTasks.length ? (
            <div className="learning-module-empty">
              <ClipboardList size={25} />
              <strong>等待老师安排练习</strong>
              <p>新推送的题库和试卷会出现在这里。</p>
            </div>
          ) : (
            <div className="learning-module-list">
              {newTasks.map((t) => (
                <Link
                  className="learning-task-row"
                  key={t.id}
                  to={`/tasks#task-${encodeURIComponent(t.id)}`}
                >
                  <span
                    className={`learning-row-icon ${t.status === 'published' ? 'is-complete' : ''}`}
                  >
                    <BookOpen size={19} />
                  </span>
                  <div className="learning-row-copy">
                    <span className="learning-row-overline">
                      {t.teacherName} · {formatDate(t.createdAt)}
                    </span>
                    <h3>{t.title}</h3>
                    <p>
                      {t.questionCount}题 · {t.totalScore}分 · {t.groupNames.join(' / ')}
                    </p>
                    <small className="learning-deadline">
                      {t.opensAt && Date.parse(t.opensAt) > now
                        ? `开放 ${formatDate(t.opensAt)}`
                        : t.deadlineAt
                          ? `截止 ${formatDate(t.deadlineAt)}`
                          : '无统一截止时间'}
                    </small>
                  </div>
                  <span className={`learning-stage stage-${t.status}`}>
                    {taskStatusLabels[t.status]}
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="learning-panel" aria-label="最近作答">
          <div className="learning-panel-heading">
            <div>
              <span className="learning-module-eyebrow">
                <NotebookPen size={15} /> RECENT PRACTICE
              </span>
              <h2>最近作答</h2>
            </div>
            <Link className="learning-view-all" to="/history">
              全部记录 <ArrowUpRight size={15} />
            </Link>
          </div>
          {attempts.error ? (
            <LoadNotice error={attempts.error} retry={attempts.reload} />
          ) : attempts.loading && !attempts.data ? (
            <Loading />
          ) : !history.length ? (
            <div className="learning-module-empty">
              <NotebookPen size={25} />
              <strong>从第一份练习开始</strong>
              <p>未完成、待批改和已批改的记录都会保存在这里。</p>
              <Link to="/library">
                去找一份练习 <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="learning-module-list">
              {history.slice(0, 4).map((a) => (
                <Link
                  className={`learning-history-row ${a.available === false ? 'is-unavailable' : ''}`}
                  key={a.id}
                  to={a.available === false ? '/history' : attemptHref(a)}
                >
                  <span
                    className={`learning-row-icon ${learningStage(a) === 'graded' ? 'is-complete' : ''}`}
                  >
                    {learningStage(a) === 'graded' ? (
                      <CheckCheck size={19} />
                    ) : (
                      <NotebookPen size={19} />
                    )}
                  </span>
                  <div className="learning-row-copy">
                    <h3>{a.title}</h3>
                    <p>
                      {learningStage(a) === 'active'
                        ? `已保存 ${a.answeredCount} / ${a.questionCount} 题`
                        : a.performance
                          ? `${a.performance.correct} / ${a.performance.total}题全对 · ${a.performance.earned} / ${a.performance.max}分`
                          : learningStageLabels[learningStage(a)]}
                      {a.gradingMode === 'self' ? ' · 学生自评' : ''}
                    </p>
                    <small>
                      {formatDate(a.updatedAt)}
                      {a.available === false ? ' · 当前无法继续' : ''}
                    </small>
                  </div>
                  <span className={`learning-stage stage-${learningStage(a)}`}>
                    {learningStageLabels[learningStage(a)]}
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="learning-panel" aria-label="教师消息">
          <div className="learning-panel-heading">
            <div>
              <span className="learning-module-eyebrow">
                <MessageCircle size={15} /> STAY CONNECTED
              </span>
              <h2>
                教师消息{unread > 0 && <span className="learning-unread-count">{unread}</span>}
              </h2>
            </div>
            <Link className="learning-view-all" to="/chat">
              全部消息 <ArrowUpRight size={15} />
            </Link>
          </div>
          {chat.error && <LoadNotice error={chat.error} retry={chat.reload} />}
          {!messages.length ? (
            <div className="learning-module-empty">
              <MessageCircle size={25} />
              <strong>{chat.status === 'connecting' ? '正在加载消息' : '还没有教师消息'}</strong>
              <p>老师发来的最近一条消息会显示在这里。</p>
            </div>
          ) : (
            <div className="learning-module-list">
              {messages.map((c) => (
                <Link
                  className="learning-message-row"
                  key={c.id}
                  to={`/chat?conversation=${encodeURIComponent(c.id)}`}
                >
                  <span className="avatar">{c.peer.name.slice(-1)}</span>
                  <div className="learning-row-copy">
                    <div className="learning-message-meta">
                      <h3>{c.peer.name}</h3>
                      <small>{formatDate(c.latestReceived!.createdAt)}</small>
                    </div>
                    <p>{c.latestReceived!.body}</p>
                    {!c.canSend && <small>历史会话 · 当前只读</small>}
                  </div>
                  {c.unread > 0 ? (
                    <span className="unread-badge" aria-label={`${c.unread}条未读`}>
                      {c.unread}
                    </span>
                  ) : (
                    <ArrowUpRight size={15} />
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="learning-panel" aria-label="展示练习">
          <div className="learning-panel-heading">
            <div>
              <span className="learning-module-eyebrow">
                <BookOpen size={15} /> EXPLORE AT YOUR PACE
              </span>
              <h2>展示练习</h2>
            </div>
            <Link className="learning-view-all" to="/library">
              浏览题库 <ArrowUpRight size={15} />
            </Link>
          </div>
          {library.error ? (
            <LoadNotice error={library.error} retry={library.reload} />
          ) : library.loading && !library.data ? (
            <Loading />
          ) : !showcases.length ? (
            <div className="learning-module-empty">
              <BookOpen size={25} />
              <strong>期待下一份好问题</strong>
              <p>教师发布的展示练习会出现在这里，可在答后对照答案自评。</p>
            </div>
          ) : (
            <div className="learning-module-list">
              {showcases.map((b) => (
                <Link
                  className="learning-showcase-row"
                  key={b.id}
                  to={`/library#library-${encodeURIComponent(b.id)}`}
                >
                  <span className="learning-row-icon">
                    <BookOpen size={19} />
                  </span>
                  <div className="learning-row-copy">
                    <h3>{b.title}</h3>
                    <p>
                      {b.kind === 'paper' ? '试卷' : '题库'} · {b.questionCount}题 · {b.totalScore}
                      分
                    </p>
                    <small>展示练习 · 答后自评</small>
                  </div>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

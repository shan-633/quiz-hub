import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, Clock3, ArrowUpRight, RefreshCw, Printer } from 'lucide-react';
import type { StudentTask, TaskStatus } from '../../shared/assignments';
import { taskStatusLabels } from '../../shared/assignments';
import { useLoad } from '../useLoad';
import { api, json } from '../api';
import { Loading, ErrorState, EmptyState, formatDate } from '../components/ui';
import { isBeforeOpening } from '../../shared/availability';
import { useOpeningClock } from '../useOpeningClock';
import { useCardAnchor } from '../useCardAnchor';
import { useDirections, CurriculumTag } from '../directions';
import { PrintPdfDialog } from '../components/PrintPdfDialog';

export function TasksPage() {
  const { matches } = useDirections();
  const tasks = useLoad<StudentTask[]>('/tasks'),
    navigate = useNavigate(),
    location = useLocation();
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [printing, setPrinting] = useState<StudentTask | null>(null);
  const now = useOpeningClock((tasks.data ?? []).filter(matches).map((t) => t.opensAt));
  useCardAnchor(!!tasks.data);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) tasks.reload();
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, []);
  const start = async (t: StudentTask) => {
    setBusy(t.id);
    setError('');
    try {
      const a = await api<{ id: string }>('/attempts', {
        method: 'POST',
        body: json({ libraryId: t.libraryId, assignmentId: t.id }),
      });
      navigate(`/attempts/${a.id}`);
    } catch (e) {
      setError((e as Error).message);
      tasks.reload();
    } finally {
      setBusy('');
    }
  };
  const all = (tasks.data ?? [])
      .filter(matches)
      .map((t) =>
        t.status === 'scheduled' && !isBeforeOpening(t.opensAt, now)
          ? { ...t, status: 'not_started' as const }
          : t,
      ),
    rows = all.filter((t) => filter === 'all' || t.status === filter);
  return (
    <div className="page class-page">
      <div className="class-heading">
        <div>
          <div className="eyebrow">YOUR CLASSROOM</div>
          <h1>班级任务</h1>
          <p>来自老师的练习安排，截止时间与完成状态都在这里。</p>
        </div>
        <button className="button" onClick={tasks.reload}>
          <RefreshCw size={16} />
          刷新状态
        </button>
      </div>
      {location.state?.timeout && (
        <p className="assignment-notice" role="status">
          时间到，试卷已自动交卷。你可以查看作答，等待教师批改。
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="class-tabs task-tabs" role="tablist" aria-label="任务状态">
        {(
          ['all', 'scheduled', 'not_started', 'active', 'pending', 'published', 'expired'] as const
        ).map((id) => (
          <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}>
            {id === 'all' ? '全部' : taskStatusLabels[id]}
            <small>{id === 'all' ? all.length : all.filter((t) => t.status === id).length}</small>
          </button>
        ))}
      </div>
      {tasks.loading && !tasks.data ? (
        <Loading />
      ) : tasks.error ? (
        <ErrorState message={tasks.error} retry={tasks.reload} />
      ) : !rows.length ? (
        <EmptyState
          title={all.length ? '这个分区暂时没有任务' : '等待老师安排练习'}
          description={
            all.length ? '切换其他状态查看班级任务。' : '老师向你的班级组推送题目后，会显示在这里。'
          }
        >
          <Link className="button" to="/history">
            查看我的作答
          </Link>
        </EmptyState>
      ) : (
        <div className="class-task-list">
          {rows.map((t) => (
            <article className="class-task-card" key={t.id} id={`task-${t.id}`} tabIndex={-1}>
              <span className="class-icon">
                <BookOpen />
              </span>
              <div className="task-copy">
                <span className="eyebrow">
                  {t.teacherName} · {t.groupNames.join(' / ')}
                </span>
                <h2>{t.title}</h2>
                <CurriculumTag item={t} />
                <div className="task-tags">
                  <span
                    className={`status-tag status-${t.status === 'expired' ? 'archived' : t.status === 'published' ? 'published' : 'draft'}`}
                  >
                    {taskStatusLabels[t.status]}
                  </span>
                  {t.enforceTimeLimit && <span className="task-rule">到时强制交卷</span>}
                  {t.submissionReason === 'timeout' && (
                    <span className="task-rule">已自动交卷</span>
                  )}
                  {t.late && <span className="task-late">迟交</span>}
                </div>
                <p>
                  {t.questionCount}题 · {t.totalScore}分
                  {t.timeLimitMinutes ? ` · 开始后${t.timeLimitMinutes}分钟` : ' · 无答题时长限制'}
                </p>
                <p className="muted small">
                  {t.opensAt && <span>开放 {formatDate(t.opensAt)} · </span>}
                  <Clock3 size={14} />
                  {t.dueAt
                    ? `本次交卷时间 ${formatDate(t.dueAt)}`
                    : t.deadlineAt
                      ? `截止 ${formatDate(t.deadlineAt)}`
                      : '无统一截止时间'}
                </p>
              </div>
              <div className="task-action">
                {t.status !== 'scheduled' && (
                  <button className="button" onClick={() => setPrinting(t)}>
                    <Printer size={16} />
                    打印题目
                  </button>
                )}
                {t.status === 'scheduled' ? (
                  <button className="button" disabled>
                    尚未开放
                  </button>
                ) : t.status === 'expired' ? (
                  <span className="muted small">任务已截止</span>
                ) : t.attemptId ? (
                  <Link
                    className={`button ${t.status === 'active' ? 'primary' : ''}`}
                    to={`/attempts/${t.attemptId}`}
                  >
                    {t.status === 'active' ? '继续作答' : '查看作答'}
                    <ArrowUpRight size={17} />
                  </Link>
                ) : (
                  <button
                    className="button primary"
                    disabled={!!busy}
                    onClick={() => void start(t)}
                  >
                    {busy === t.id ? '正在准备…' : '开始作答'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {printing && (
        <PrintPdfDialog
          key={printing.id}
          item={{ ...printing, id: printing.libraryId, kind: 'paper' }}
          assignmentId={printing.id}
          onClose={() => setPrinting(null)}
        />
      )}
    </div>
  );
}

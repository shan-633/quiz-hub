import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowUpRight, RotateCcw, Clock3, CheckCircle2 } from 'lucide-react';
import { useLoad } from '../useLoad';
import { useToast } from '../context';
import { api, json } from '../api';
import { Loading, ErrorState, EmptyState, formatDate } from '../components/ui';
interface HistoryItem {
  id: string;
  title: string;
  libraryId: string;
  status: 'active' | 'submitted';
  questionCount: number;
  answeredCount: number;
  updatedAt: string;
  reviewState?: 'pending' | 'in_progress' | 'published';
  earned?: number;
  pending?: boolean;
  available?: boolean;
  repeatAvailable?: boolean;
  submissionReason?: 'student' | 'timeout';
  late?: boolean;
}
const historyTabs = [
  { id: 'all', label: '全部' },
  { id: 'active', label: '未答完' },
  { id: 'pending', label: '待批改' },
  { id: 'graded', label: '已批改' },
] as const;
type HistoryFilter = (typeof historyTabs)[number]['id'];
function historyStage(a: HistoryItem): Exclude<HistoryFilter, 'all'> {
  if (a.status === 'active') return 'active';
  if (a.reviewState) return a.reviewState === 'published' ? 'graded' : 'pending';
  return !a.pending && typeof a.earned === 'number' ? 'graded' : 'pending';
}
const emptyMessages: Record<HistoryFilter, { title: string; description: string }> = {
  all: { title: '暂时没有作答', description: '开始一份练习，记录你的思考过程。' },
  active: { title: '暂时没有未答完的练习', description: '进行中且尚未交卷的练习会出现在这里。' },
  pending: {
    title: '暂时没有待批改的作答',
    description: '交卷后，等待教师批改或发布结果的作答会出现在这里。',
  },
  graded: {
    title: '暂时没有已批改的作答',
    description: '教师发布结果后，可在这里查看成绩和反馈。',
  },
};
export function HistoryPage() {
  const location = useLocation();
  const { data, loading, error, reload } = useLoad<HistoryItem[]>('/attempts'),
    navigate = useNavigate(),
    toast = useToast();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const all = data ?? [];
  const counts: Record<HistoryFilter, number> = {
    all: all.length,
    active: 0,
    pending: 0,
    graded: 0,
  };
  for (const a of all) counts[historyStage(a)]++;
  const rows = filter === 'all' ? all : all.filter((a) => historyStage(a) === filter);
  const again = async (id: string) => {
    try {
      const a = await api('/attempts', {
        method: 'POST',
        body: json({ libraryId: id, fresh: true }),
      });
      navigate(`/attempts/${a.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="page">
      {location.state?.timeout && (
        <p className="assignment-notice" role="status">
          时间到，试卷已自动交卷。你可以查看作答，等待教师批改。
        </p>
      )}
      <div className="page-heading">
        <div className="eyebrow">YOUR LEARNING JOURNEY</div>
        <h1>每一步思考，都有迹可循。</h1>
        <p>继续未完成的练习，或回看已经走过的解题过程。</p>
        <button className="button" onClick={reload}>
          刷新批改状态
        </button>
      </div>
      <div className="history-tabs" role="tablist" aria-label="作答状态">
        {historyTabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`history-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={filter === tab.id}
            aria-controls="history-panel"
            aria-label={`${tab.label}，${counts[tab.id]}份`}
            tabIndex={filter === tab.id ? 0 : -1}
            onClick={() => setFilter(tab.id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % historyTabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + historyTabs.length - 1) % historyTabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? historyTabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setFilter(historyTabs[next].id);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus();
            }}
          >
            {tab.label}
            <span aria-hidden="true">{counts[tab.id]}</span>
          </button>
        ))}
      </div>
      <section
        id="history-panel"
        className="history-panel"
        role="tabpanel"
        aria-labelledby={`history-tab-${filter}`}
        tabIndex={0}
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} retry={reload} />
        ) : !data?.length ? (
          <EmptyState
            title="第一份练习，等你开始"
            description="挑选感兴趣的题库，完成的练习会保存在这里。"
          >
            <Link className="button primary" to="/library">
              浏览试卷与题库
              <ArrowUpRight size={18} />
            </Link>
          </EmptyState>
        ) : !rows.length ? (
          <EmptyState
            title={emptyMessages[filter].title}
            description={emptyMessages[filter].description}
          >
            <button className="button" onClick={() => setFilter('all')}>
              查看全部作答
            </button>
          </EmptyState>
        ) : (
          <div className="history-list">
            {rows.map((a) => (
              <article className="history-card" key={a.id}>
                <div className={`history-icon ${historyStage(a) === 'graded' ? 'done' : ''}`}>
                  {historyStage(a) === 'graded' ? <CheckCircle2 /> : <Clock3 />}
                </div>
                <div className="history-copy">
                  <span
                    className={`status-tag ${historyStage(a) === 'graded' ? 'status-published' : historyStage(a) === 'pending' ? 'status-waiting' : 'status-draft'}`}
                  >
                    {historyStage(a) === 'active'
                      ? '未答完'
                      : historyStage(a) === 'graded'
                        ? '已批改'
                        : a.reviewState === 'in_progress'
                          ? '批改中'
                          : '待批改'}
                  </span>
                  <h2>{a.title}</h2>
                  {a.submissionReason === 'timeout' && (
                    <small className="task-rule">到时自动交卷</small>
                  )}
                  {a.late && <small className="task-late">迟交</small>}
                  <p>
                    {a.questionCount} 道题 ·{' '}
                    {a.status === 'active'
                      ? `已保存 ${a.answeredCount} 题`
                      : historyStage(a) === 'pending'
                        ? a.reviewState
                          ? '已交卷，等待教师发布结果'
                          : '已交卷，等待评阅结果'
                        : `得分 ${a.earned ?? 0} 分`}
                    <span>更新于 {formatDate(a.updatedAt)}</span>
                  </p>
                </div>
                <div className="history-actions">
                  {a.status === 'submitted' && a.repeatAvailable !== false && (
                    <button className="text-button" onClick={() => void again(a.libraryId)}>
                      <RotateCcw size={16} />
                      再练一次
                    </button>
                  )}
                  {a.available === false ? (
                    <span className="muted small">教学关系已解除，作答记录保留</span>
                  ) : (
                    <Link
                      className={`button ${a.status === 'active' ? 'primary' : ''}`}
                      to={`/attempts/${a.id}`}
                    >
                      {a.status === 'active' ? '继续练习' : '查看作答'}
                      <ArrowUpRight size={17} />
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

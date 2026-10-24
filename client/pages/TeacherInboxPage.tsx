import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RefreshCw, Inbox, ClipboardCheck, BookOpen } from 'lucide-react';
import { useLoad } from '../useLoad';
import { Loading, ErrorState, EmptyState, formatDate } from '../components/ui';
import '../teacher.css';
import { TeacherProgress } from '../components/TeacherProgress';
import { useDirections } from '../directions';
import type { Curriculum } from '../../shared/curriculum';
export interface InboxItem {
  curriculum?: Curriculum;
  id: string;
  title: string;
  kind: 'paper' | 'bank';
  student: { id: string; name: string; username: string };
  submittedAt: string;
  reviewState: 'pending' | 'in_progress' | 'published' | 'legacy';
  questionCount: number;
  finalizedCount: number;
  autoCount: number;
  autoReason?: string;
  earned: number;
  total: number;
}
export const reviewLabels = {
  pending: '待批改',
  in_progress: '批改中',
  published: '已发布',
  legacy: '历史记录',
};
export function TeacherInboxPage() {
  const { matches } = useDirections();
  const { data, loading, error, reload } = useLoad<InboxItem[]>('/teacher/attempts');
  const [filter, setFilter] = useState('todo'),
    [search, setSearch] = useState(''),
    [progressRefresh, setProgressRefresh] = useState(0);
  const all = (data ?? []).filter(matches),
    rows = all.filter(
      (a) =>
        (filter === 'all' ||
          (filter === 'todo' && ['pending', 'in_progress'].includes(a.reviewState)) ||
          a.reviewState === filter) &&
        `${a.title} ${a.student.name} ${a.student.username}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  return (
    <div className="page teacher-page">
      <div className="teacher-heading">
        <div>
          <div className="eyebrow">TEACHER WORKSPACE</div>
          <h1>每一份思考，都值得回应。</h1>
          <p>关注作答进度，收取试卷与题库答题卡，再把反馈交还给学生。</p>
        </div>
        <button
          className="button"
          onClick={() => {
            reload();
            setProgressRefresh((n) => n + 1);
          }}
        >
          <RefreshCw size={16} />
          刷新收卷箱
        </button>
      </div>
      <nav className="staff-shortcuts" aria-label="教师工作台">
        <Link className="active" to="/teacher">
          <Inbox size={16} />
          收卷与批改
        </Link>
        <Link to="/teacher/library">
          <BookOpen size={16} />
          题库与试卷
        </Link>
        <Link to="/">学生端</Link>
      </nav>
      <div className="teacher-stats">
        <div>
          <span>等待你的反馈</span>
          <strong>
            {
              all.filter((a) => a.reviewState === 'pending' || a.reviewState === 'in_progress')
                .length
            }
            <small>份答卷</small>
          </strong>
        </div>
        <div>
          <span>已发布批改</span>
          <strong>
            {all.filter((a) => a.reviewState === 'published').length}
            <small>份答卷</small>
          </strong>
        </div>
        <div>
          <span>选择题自动初评</span>
          <strong>
            {all.filter((a) => a.reviewState !== 'legacy').reduce((n, a) => n + a.autoCount, 0)}
            <small>个作答点</small>
          </strong>
        </div>
      </div>
      <section className="teacher-inbox">
        <div className="teacher-toolbar">
          <div className="teacher-filters" role="group" aria-label="答卷状态">
            {[
              ['active', '进行中'],
              ['todo', '待处理'],
              ['published', '已发布'],
              ['legacy', '历史记录'],
              ['all', '全部'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? 'active' : ''}
                aria-pressed={filter === id}
                onClick={() => {
                  if (filter === 'active' && id !== 'active') reload();
                  setFilter(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            aria-label="搜索学生或试卷"
            placeholder="搜索学生、试卷或题库…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {filter === 'active' ? (
          <TeacherProgress search={search} refreshKey={progressRefresh} />
        ) : loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} retry={reload} />
        ) : !rows.length ? (
          <EmptyState
            title="这里暂时没有答卷"
            description="学生交卷后，试卷和题库答题卡会出现在这里。"
          />
        ) : (
          <div className="teacher-submissions">
            {rows.map((a) => (
              <article className="teacher-submission" key={a.id}>
                <span className="submission-avatar">{a.student.name.slice(-1)}</span>
                <div className="submission-copy">
                  <div>
                    <span className={`review-tag review-${a.reviewState}`}>
                      {reviewLabels[a.reviewState]}
                    </span>
                    <span className="muted small">
                      {a.kind === 'paper' ? '考试试卷' : '题库答题卡'}
                    </span>
                  </div>
                  <h2>{a.title}</h2>
                  <p>
                    {a.student.name} <span className="muted">@{a.student.username}</span> ·{' '}
                    {formatDate(a.submittedAt)}
                  </p>
                  <p className="muted small">
                    {a.questionCount} 题 · {a.total} 分 ·{' '}
                    {a.reviewState === 'legacy'
                      ? '旧记录保留，可主动发起复核'
                      : a.reviewState === 'published'
                        ? `最终得分 ${a.earned} 分`
                        : `已判 ${a.finalizedCount}/${a.questionCount} 题${a.autoCount ? ` · ${a.autoCount} 个选择作答点已初评` : ''}`}
                  </p>
                </div>
                <Link
                  className={`button ${a.reviewState === 'published' || a.reviewState === 'legacy' ? '' : 'primary'}`}
                  to={`/teacher/attempts/${a.id}`}
                >
                  <ClipboardCheck size={16} />
                  {a.reviewState === 'published'
                    ? '查看批改'
                    : a.reviewState === 'legacy'
                      ? '查看记录'
                      : '进入批改'}
                  <ArrowUpRight size={16} />
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="muted small teacher-policy">
        标准答案全部完整时才自动初评选择题。填空、实验、阅读与计算题的非选择作答点由教师批改；学生在结果发布后查看成绩。
      </p>
    </div>
  );
}

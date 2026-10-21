import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { api } from '../api';
import { EmptyState, ErrorState, Loading, formatDate } from './ui';
import type { StudentProgress } from '../../shared/progress';

export function TeacherProgress({ search, refreshKey }: { search: string; refreshKey: number }) {
  const [data, setData] = useState<StudentProgress[] | null>(null);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false,
      running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (stopped || running || document.hidden) return;
      clearTimeout(timer);
      running = true;
      controller = new AbortController();
      try {
        const rows = await api<StudentProgress[]>('/teacher/progress', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!stopped) {
          setData(rows);
          setError('');
          setCheckedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
        }
      } catch (e) {
        if (!stopped && (e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        running = false;
        if (!stopped && !document.hidden) timer = setTimeout(() => void refresh(), 3000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    };
    const focus = () => void refresh();
    void refresh();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', focus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', focus);
    };
  }, [refreshKey, retry]);
  const rows = (data ?? []).filter((a) =>
    `${a.title} ${a.student.name} ${a.student.username}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const retryNow = () => setRetry((n) => n + 1);
  return (
    <div className="teacher-progress" aria-label="未交卷进度">
      <div className="progress-live-note">
        <Radio size={17} aria-hidden="true" />
        <div>
          <strong>未交卷 · {data?.length ?? '—'} 份记录</strong>
          <p>每 3 秒自动更新已同步进度；离线作答在恢复网络后可见。完成比例按填答题数统计。</p>
        </div>
        {checkedAt && <span className="muted small">最近检查 {checkedAt}</span>}
      </div>
      {error && data !== null && (
        <div className="progress-sync-error" role="alert">
          <span>{error}。当前显示上次成功获取的进度。</span>
          <button className="button" onClick={retryNow}>
            立即重试
          </button>
        </div>
      )}
      {data === null ? (
        error ? (
          <ErrorState message={error} retry={retryNow} />
        ) : (
          <Loading />
        )
      ) : !rows.length ? (
        <EmptyState
          title={search.trim() ? '没有匹配的记录' : '还没有未交卷记录'}
          description={
            search.trim()
              ? '试试其他学生姓名、账号或试卷名称。'
              : '学生开始练习后会显示在这里；交卷后移入待处理分区。'
          }
        />
      ) : (
        <div className="teacher-submissions">
          {rows.map((a) => (
            <article className="teacher-submission progress-submission" key={a.id}>
              <span className="submission-avatar">{a.student.name.slice(-1)}</span>
              <div className="submission-copy">
                <div>
                  <span className="review-tag review-active">未交卷</span>
                  <span className="muted small">
                    {a.kind === 'paper' ? '考试试卷' : '题库答题卡'}
                  </span>
                </div>
                <h2>{a.title}</h2>
                <p>
                  {a.student.name} <span className="muted">@{a.student.username}</span>
                </p>
                <p className="muted small">
                  最近同步 {formatDate(a.updatedAt)} · 开始于 {formatDate(a.createdAt)}
                </p>
              </div>
              <div className="student-progress-meter">
                <div className="progress-meter-heading">
                  <strong>
                    {a.answeredCount}
                    <small> / {a.questionCount} 题已填答</small>
                  </strong>
                  <span>{a.percent}%</span>
                </div>
                <div
                  className="student-progress-track"
                  role="progressbar"
                  aria-label={`${a.student.name} · ${a.title}填答进度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={a.percent}
                >
                  <span style={{ width: `${a.percent}%` }} />
                </div>
                <p className="muted small">
                  部分填答 {a.inProgressCount} 题 · 未作答 {a.emptyCount} 题
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

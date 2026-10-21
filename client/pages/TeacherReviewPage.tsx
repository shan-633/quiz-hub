import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, X, CircleDashed, Save, Send, BookOpen, Sparkles } from 'lucide-react';
import type { Attempt, Question, TeacherFeedback } from '../../shared/model';
import { typeLabels } from '../../shared/model';
import { emptyAnswer } from '../../shared/domain';
import { referenceAnswer } from '../../shared/teacherReview';
import { useLoad } from '../useLoad';
import { api, json, ApiError } from '../api';
import { useToast } from '../context';
import { QuestionRenderer } from '../components/QuestionRenderer';
import { Markdown } from '../components/Markdown';
import { Loading, ErrorState, Modal, formatDate } from '../components/ui';
import { navigatorState, navigatorLabels } from '../practiceFeedback';
import '../teacher.css';
type ReviewAttempt = Attempt & {
  student?: { name: string; username: string };
  kind?: 'paper' | 'bank';
};
type Form = {
  verdict: TeacherFeedback['verdict'] | '';
  score: string;
  correctAnswer: string;
  comment: string;
};
function formFor(a: Attempt, q: Question): Form {
  const f = a.teacherFeedback?.[q.id],
    g = a.grades?.[q.id];
  return {
    verdict:
      f?.verdict ??
      (g && !g.pending
        ? g.status === 'correct'
          ? 'correct'
          : g.status === 'partial'
            ? 'partial'
            : 'incorrect'
        : ''),
    score: String(f?.score ?? g?.earned ?? 0),
    correctAnswer: f?.correctAnswer ?? referenceAnswer(q),
    comment: f?.comment ?? '',
  };
}
export function TeacherReviewPage() {
  const { id } = useParams(),
    { data, loading, error, reload } = useLoad<ReviewAttempt>(`/teacher/attempts/${id}`);
  return loading ? (
    <Loading />
  ) : error ? (
    <ErrorState message={error} retry={reload} />
  ) : data ? (
    <ReviewWorkspace key={data.id} initial={data} />
  ) : null;
}
function ReviewWorkspace({ initial }: { initial: ReviewAttempt }) {
  const [a, setAttempt] = useState(initial),
    [index, setIndex] = useState(0),
    [form, setForm] = useState(() => formFor(initial, initial.questions[0])),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [publishConfirm, setPublishConfirm] = useState(false),
    [leave, setLeave] = useState<number | 'back' | null>(null),
    [startConfirm, setStartConfirm] = useState(false);
  const toast = useToast(),
    navigate = useNavigate(),
    q = a.questions[index],
    grade = a.grades?.[q.id],
    feedback = a.teacherFeedback?.[q.id];
  const readOnly = !a.review || a.review.state === 'published',
    pending = a.questions.filter((q) => !a.grades?.[q.id] || a.grades[q.id].pending).length,
    earned = Object.values(a.grades ?? {}).reduce((s, g) => s + g.earned, 0),
    total = a.questions.reduce((s, q) => s + q.score, 0);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setError('');
  };
  const jump = (i: number | 'back') => {
    if (dirty) {
      setLeave(i);
      return;
    }
    if (i === 'back') {
      navigate('/teacher');
      return;
    }
    setIndex(i);
    setForm(formFor(a, a.questions[i]));
    setError('');
    setConflict(false);
  };
  const save = async () => {
    if (!form.verdict) {
      setError('请先选择正确、错误或部分正确');
      return;
    }
    if (!form.score.trim() || !Number.isFinite(Number(form.score))) {
      setError('请填写有效分数');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await api<ReviewAttempt>(`/teacher/attempts/${a.id}/grades/${q.id}`, {
        method: 'PUT',
        body: json({ ...form, score: Number(form.score), expectedRevision: a.review!.revision }),
      });
      setAttempt(updated);
      setForm(formFor(updated, q));
      setDirty(false);
      setConflict(false);
      toast('本题批改已保存');
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  };
  const loadLatest = async () => {
    setBusy(true);
    try {
      const updated = await api<ReviewAttempt>(`/teacher/attempts/${a.id}`);
      setAttempt(updated);
      setConflict(false);
      setError('已载入最新批改，你的输入仍保留。请核对后重新保存。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    try {
      const updated = await api<ReviewAttempt>(`/teacher/attempts/${a.id}/publish`, {
        method: 'POST',
        body: json({ expectedRevision: a.review!.revision }),
      });
      setAttempt(updated);
      setPublishConfirm(false);
      toast('批改结果已发布，学生现在可以查看');
    } catch (e) {
      setError((e as Error).message);
      setPublishConfirm(false);
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    setBusy(true);
    try {
      const updated = await api<ReviewAttempt>(`/teacher/attempts/${a.id}/start`, {
        method: 'POST',
        body: json({ expectedRevision: 0 }),
      });
      setAttempt(updated);
      setForm(formFor(updated, q));
      setStartConfirm(false);
      toast('已进入教师批改流程');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page teacher-page teacher-review-page">
      <Link
        className="back-link"
        to="/teacher"
        onClick={(e) => {
          e.preventDefault();
          jump('back');
        }}
      >
        <ArrowLeft size={16} />
        返回收卷箱
      </Link>
      <div className="teacher-heading">
        <div>
          <div className="eyebrow">READ · UNDERSTAND · RESPOND</div>
          <h1>{a.title}</h1>
          <p>
            {a.student?.name ?? '学生'} {a.student?.username ? `@${a.student.username}` : ''} ·{' '}
            {a.kind === 'paper' ? '考试试卷' : '题库答题卡'} · {a.questions.length} 题 / {total} 分
          </p>
        </div>
        <Link className="button" to="/teacher/library">
          <BookOpen size={16} />
          管理题库
        </Link>
      </div>
      <div className={`review-overview ${a.review?.state === 'published' ? 'is-published' : ''}`}>
        <div>
          <strong>
            {!a.review
              ? '历史作答记录'
              : a.review.state === 'published'
                ? '批改已发布'
                : `还有 ${pending} 题等待批改`}
          </strong>
          <p>
            {!a.review
              ? '保留原批改结果。主动复核后，将按教师发布流程向学生返回结果。'
              : a.review.state === 'published'
                ? `${a.review.publishedBy} · ${formatDate(a.review.publishedAt!)} · 学生已可查看成绩与反馈。`
                : a.review.autoReason}
          </p>
        </div>
        <div className="review-overview-score">
          <strong>
            {earned}
            <small> / {total}</small>
          </strong>
          <span>{readOnly ? '分' : '分 · 当前已判得分'}</span>
        </div>
      </div>
      <div className="review-workspace">
        <aside className="review-answer-card">
          <h2>
            答题卡{' '}
            <small>
              {a.questions.length - pending}/{a.questions.length} 已判
            </small>
          </h2>
          <div className="question-numbers">
            {a.questions.map((question, i) => {
              const state = navigatorState(true, false, a.grades?.[question.id]);
              return (
                <button
                  key={question.id}
                  className={`nav-${state} ${i === index ? 'active' : ''}`}
                  aria-label={`第 ${i + 1} 题，${navigatorLabels[state]}`}
                  aria-current={i === index ? 'step' : undefined}
                  disabled={busy}
                  onClick={() => jump(i)}
                >
                  {String(i + 1).padStart(2, '0')}
                </button>
              );
            })}
          </div>
          <p className="muted small">绿色为全对，红色为未全对，灰色待批。当前题光圈独立显示。</p>
          <div className="review-publish-area">
            {!a.review ? (
              <button
                className="button primary full"
                disabled={busy}
                onClick={() => setStartConfirm(true)}
              >
                发起教师复核
              </button>
            ) : a.review.state === 'published' ? (
              <div className="review-published-label">
                <Check size={17} />
                已发布 · 只读
              </div>
            ) : (
              <>
                <button
                  className="button primary full"
                  disabled={busy || pending > 0 || dirty || conflict}
                  onClick={() => setPublishConfirm(true)}
                >
                  <Send size={16} />
                  发布批改结果
                </button>
                <p className="muted small">
                  {dirty
                    ? '请先保存本题改动，再发布结果。'
                    : pending
                      ? `完成剩余 ${pending} 题后可发布。`
                      : '全部题目已判，可发布给学生。'}
                </p>
              </>
            )}
          </div>
        </aside>
        <article className="question-card review-student-paper">
          <div className="question-card-heading">
            <div>
              <span className="question-index">{String(index + 1).padStart(2, '0')}</span>
              <span className={`question-type type-${q.type}`}>{typeLabels[q.type]}</span>
              <span className="question-score">{q.score} 分</span>
            </div>
            <span className="muted small">学生原始作答</span>
          </div>
          <QuestionRenderer question={q} answer={a.answers[q.id]?.data ?? emptyAnswer()} disabled />
          <div className="review-question-pagination">
            <button
              className="button"
              disabled={index === 0 || busy}
              onClick={() => jump(index - 1)}
            >
              上一题
            </button>
            <span>
              {index + 1} / {a.questions.length}
            </span>
            <button
              className="button"
              disabled={index === a.questions.length - 1 || busy}
              onClick={() => jump(index + 1)}
            >
              下一题
            </button>
          </div>
        </article>
        <section className="review-grading-panel" aria-label="本题批改">
          <div className="grading-title">
            <h2>{readOnly ? '批改记录' : '本题批改'}</h2>
            <span>
              {grade?.source === 'auto' || grade?.source === 'mixed' ? (
                <>
                  <Sparkles size={14} />
                  {grade.source === 'mixed' ? '选择小问已初评' : '选择题已初评'}
                </>
              ) : grade?.source === 'teacher' ? (
                '教师已判'
              ) : (
                '待人工批改'
              )}
            </span>
          </div>
          {grade && (
            <p className="grading-current">
              当前得分{' '}
              <strong>
                {grade.earned} / {q.score}
              </strong>{' '}
              {grade.pending ? '（含待批改部分）' : ''}
            </p>
          )}
          {!readOnly ? (
            <>
              <div className="verdict-buttons" role="group" aria-label="判定结果">
                {(
                  [
                    ['correct', '正确', Check],
                    ['incorrect', '错误', X],
                    ['partial', '部分正确', CircleDashed],
                  ] as const
                ).map(([v, label, Icon]) => (
                  <button
                    key={v}
                    className={`verdict-${v} ${form.verdict === v ? 'selected' : ''}`}
                    aria-pressed={form.verdict === v}
                    disabled={busy}
                    onClick={() =>
                      change({
                        verdict: v,
                        score: String(
                          v === 'correct'
                            ? q.score
                            : v === 'incorrect'
                              ? 0
                              : Number(form.score) > 0 && Number(form.score) < q.score
                                ? Number(form.score)
                                : q.score / 2,
                        ),
                      })
                    }
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </div>
              <label className="field">
                本题得分
                <div className="grading-score-input">
                  <input
                    type="number"
                    step="any"
                    min={0}
                    max={q.score}
                    aria-label="本题得分"
                    value={form.score}
                    disabled={busy || form.verdict !== 'partial'}
                    onChange={(e) => change({ score: e.target.value })}
                  />
                  <span>/ {q.score} 分</span>
                </div>
              </label>
              <label className="field">
                正确答案
                <textarea
                  rows={6}
                  value={form.correctAnswer}
                  disabled={busy}
                  onChange={(e) => change({ correctAnswer: e.target.value })}
                  maxLength={20000}
                  placeholder="填写正确答案或解题过程，支持 Markdown 与公式"
                />
              </label>
              <label className="field">
                教师评语
                <textarea
                  rows={4}
                  value={form.comment}
                  disabled={busy}
                  onChange={(e) => change({ comment: e.target.value })}
                  maxLength={10000}
                  placeholder="告诉学生哪里做得好，下一步如何改进…"
                />
              </label>
              <p className="muted small">正确答案与评语仅用于本次答卷，发布后学生可见。</p>
              <button
                className="button primary full"
                disabled={busy || conflict}
                onClick={() => void save()}
              >
                <Save size={16} />
                {busy ? '正在保存…' : '保存本题批改'}
              </button>
              <p className="grading-save-state" aria-live="polite">
                {dirty
                  ? '本题有未保存改动'
                  : feedback
                    ? `${feedback.teacherName} · 已保存`
                    : grade?.pending
                      ? '等待教师判定'
                      : '自动初评，可直接采用或修改'}
              </p>
            </>
          ) : (
            <>
              <h3>正确答案</h3>
              <Markdown text={feedback?.correctAnswer || referenceAnswer(q) || '未填写'} />
              <h3>教师评语</h3>
              <Markdown text={feedback?.comment || '未填写评语'} />
              {feedback && (
                <p className="muted small">
                  {feedback.teacherName} · {formatDate(feedback.updatedAt)}
                </p>
              )}
            </>
          )}
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          {conflict && (
            <button className="button full" disabled={busy} onClick={() => void loadLatest()}>
              载入最新批改
            </button>
          )}
          <details className="review-reference">
            <summary>查看题库标准答案</summary>
            <Markdown text={referenceAnswer(q) || '未录入标准答案'} />
          </details>
        </section>
      </div>
      {publishConfirm && (
        <Modal
          title="把反馈交还给学生"
          onClose={() => {
            if (!busy) setPublishConfirm(false);
          }}
        >
          <p className="modal-intro">
            已完成全部 {a.questions.length} 题批改，最终得分{' '}
            <strong>
              {earned} / {total}
            </strong>{' '}
            分。发布后，学生可以看到分数、正确答案和评语，批改记录将锁定。
          </p>
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setPublishConfirm(false)}>
              再检查一下
            </button>
            <button className="button primary" disabled={busy} onClick={() => void publish()}>
              {busy ? '正在发布…' : '确认发布'}
            </button>
          </div>
        </Modal>
      )}
      {leave !== null && (
        <Modal title="本题还有未保存的批改" onClose={() => setLeave(null)}>
          <p className="modal-intro">先保存本题，可以保留刚填写的分数、正确答案和评语。</p>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                const target = leave;
                setLeave(null);
                setDirty(false);
                if (target === 'back') navigate('/teacher');
                else {
                  setIndex(target);
                  setForm(formFor(a, a.questions[target]));
                  setError('');
                  setConflict(false);
                }
              }}
            >
              放弃改动并离开
            </button>
            <button className="button primary" onClick={() => setLeave(null)}>
              留下继续批改
            </button>
          </div>
        </Modal>
      )}
      {startConfirm && (
        <Modal
          title="将历史记录转入教师复核"
          onClose={() => {
            if (!busy) setStartConfirm(false);
          }}
        >
          <p className="modal-intro">
            复核将依据交卷时的题目快照重新生成选择题初评，其余题目等待人工。学生在你重新发布前只能看到收卷确认。原始作答保持不变。
          </p>
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setStartConfirm(false)}>
              取消
            </button>
            <button className="button primary" disabled={busy} onClick={() => void start()}>
              确认发起复核
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

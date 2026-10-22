import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Check } from 'lucide-react';
import type { Attempt } from '../../shared/model';
import { typeLabels } from '../../shared/model';
import { emptyAnswer } from '../../shared/domain';
import { referenceAnswer } from '../../shared/teacherReview';
import { selfReviewParts } from '../../shared/selfReview';
import { api, json, ApiError } from '../api';
import { useLoad } from '../useLoad';
import { useToast } from '../context';
import { GradeControls, type GradeValue } from '../components/GradeControls';
import { Loading, ErrorState, Modal } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ReferenceImages } from '../components/ReferenceImages';
import { QuestionRenderer } from '../components/QuestionRenderer';
import { navigatorState } from '../practiceFeedback';
import '../teacher.css';
type Form = GradeValue & { comment: string };
function formFor(a: Attempt, index: number): Form {
  const q = a.questions[index],
    f = a.selfReview?.feedback[q.id];
  return { verdict: f?.verdict ?? '', score: String(f?.score ?? 0), comment: f?.comment ?? '' };
}
export function SelfReviewPage() {
  const { id } = useParams(),
    load = useLoad<Attempt>(`/attempts/${id}`);
  return load.loading ? (
    <Loading />
  ) : load.error ? (
    <ErrorState message={load.error} retry={load.reload} />
  ) : load.data?.gradingMode === 'self' && load.data.status === 'submitted' ? (
    <SelfWorkspace key={load.data.id} initial={load.data} />
  ) : (
    <ErrorState message="只有已交卷的展示练习支持自评" />
  );
}
function SelfWorkspace({ initial }: { initial: Attempt }) {
  const [a, setAttempt] = useState(initial),
    [index, setIndex] = useState(0),
    [form, setForm] = useState(() => formFor(initial, 0)),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [conflict, setConflict] = useState(false),
    [finish, setFinish] = useState(false),
    [leave, setLeave] = useState<number | 'back' | null>(null);
  const navigate = useNavigate(),
    toast = useToast(),
    q = a.questions[index],
    grade = a.grades?.[q.id],
    parts = selfReviewParts(a, q),
    completed = a.selfReview!.state === 'completed',
    pending = a.questions.filter((q) => a.grades?.[q.id]?.pending).length;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const move = (i: number | 'back', discard = false) => {
    if (dirty && !discard) {
      setLeave(i);
      return;
    }
    if (i === 'back') {
      navigate(`/attempts/${a.id}`);
      return;
    }
    setIndex(i);
    setForm(formFor(a, i));
    setDirty(false);
    setError('');
    setMessage('');
  };
  const change = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setMessage('');
  };
  const save = async () => {
    if (!form.verdict) {
      setError('请选择判定结果');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const updated = await api<Attempt>(`/attempts/${a.id}/self-review/${q.id}`, {
        method: 'PUT',
        body: json({
          ...form,
          score: Number(form.score),
          expectedRevision: a.selfReview!.revision,
        }),
      });
      setAttempt(updated);
      setForm(formFor(updated, index));
      setDirty(false);
      setConflict(false);
      setMessage('本题自评已保存');
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  };
  const complete = async () => {
    setBusy(true);
    setError('');
    try {
      const updated = await api<Attempt>(`/attempts/${a.id}/self-review/complete`, {
        method: 'POST',
        body: json({ expectedRevision: a.selfReview!.revision }),
      });
      setAttempt(updated);
      setFinish(false);
      toast('自评已完成');
    } catch (e) {
      setError((e as Error).message);
      setFinish(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page teacher-page teacher-review-page self-review-page">
      <Link
        className="back-link"
        to={`/attempts/${a.id}`}
        onClick={(e) => {
          e.preventDefault();
          move('back');
        }}
      >
        <ArrowLeft size={16} />
        返回作答
      </Link>
      <div className="teacher-heading">
        <div>
          <div className="eyebrow">REFLECT & REVIEW</div>
          <h1>{a.title}</h1>
          <p>展示练习 · 对照答案为自己的解题过程判分</p>
        </div>
        <span className="mode-badge mode-showcase">学生自评</span>
      </div>
      <div className="review-overview">
        <div>
          <strong>{completed ? '自评已完成' : `还有 ${pending} 题待自评`}</strong>
          <p>单选、多选自动评分；其他部分由自己判分。自评成绩与教师成绩分别标记。</p>
        </div>
        <div className="review-overview-score">
          <strong>
            {Object.values(a.grades ?? {}).reduce((s, g) => s + g.earned, 0)}
            <small> / {a.questions.reduce((s, q) => s + q.score, 0)}</small>
          </strong>
          <span>分 · {completed ? '自评成绩' : '当前已判'}</span>
        </div>
      </div>
      <div className="review-workspace">
        <aside className="review-answer-card">
          <h2>答题卡</h2>
          <div className="question-numbers">
            {a.questions.map((q, i) => (
              <button
                key={q.id}
                disabled={busy}
                className={`nav-${navigatorState(true, false, a.grades?.[q.id])} ${index === i ? 'active' : ''}`}
                aria-label={`第${i + 1}题`}
                onClick={() => move(i)}
              >
                {String(i + 1).padStart(2, '0')}
              </button>
            ))}
          </div>
          <p className="muted small">选择题分数已锁定，灰色题目等待自评。</p>
          {!completed && (
            <button
              className="button primary full"
              disabled={busy || dirty || !!pending || conflict}
              onClick={() => setFinish(true)}
            >
              完成自评
            </button>
          )}
        </aside>
        <article className="question-card review-student-paper">
          <div className="question-card-heading">
            <span className="question-index">{String(index + 1).padStart(2, '0')}</span>
            <span>
              {typeLabels[q.type]} · {q.score}分
            </span>
          </div>
          <QuestionRenderer question={q} answer={a.answers[q.id]?.data ?? emptyAnswer()} disabled />
          <div className="review-question-pagination">
            <button
              className="button"
              disabled={index === 0 || busy}
              onClick={() => move(index - 1)}
            >
              上一题
            </button>
            <span>
              {index + 1}/{a.questions.length}
            </span>
            <button
              className="button"
              disabled={index === a.questions.length - 1 || busy}
              onClick={() => move(index + 1)}
            >
              下一题
            </button>
          </div>
        </article>
        <section className="review-grading-panel">
          <div className="grading-title">
            <h2>对照答案自评</h2>
          </div>
          <div className="self-reference">
            <h3>标准答案</h3>
            <Markdown text={referenceAnswer(q) || '未录入标准答案，请联系教师'} />
            <ReferenceImages question={q} />
          </div>
          <p className="grading-current">
            当前得分{' '}
            <strong>
              {grade?.earned ?? 0} / {q.score}
            </strong>
          </p>
          {!parts.hasManual ? (
            <p className="assignment-notice">自动评分，不能修改</p>
          ) : completed ? (
            <>
              <p>
                人工部分得分：{a.selfReview!.feedback[q.id]?.score ?? 0}/{parts.maximum}
              </p>
              <Markdown text={a.selfReview!.feedback[q.id]?.comment || '未填写自评备注'} />
            </>
          ) : (
            <>
              {Object.keys(parts.automatic).length > 0 && (
                <p className="muted small">
                  选择小问已得{parts.earned}分，下方只评人工部分（{parts.maximum}分）。
                </p>
              )}
              <GradeControls
                value={form}
                maximum={parts.maximum}
                disabled={busy || conflict}
                onChange={change}
              />
              <label className="field">
                自评备注
                <textarea
                  rows={4}
                  value={form.comment}
                  maxLength={10000}
                  disabled={busy || conflict}
                  onChange={(e) => change({ comment: e.target.value })}
                />
              </label>
              <button
                className="button primary full"
                disabled={busy || conflict}
                onClick={() => void save()}
              >
                <Save size={16} />
                保存本题自评
              </button>
            </>
          )}
          {message && (
            <p role="status" className="grading-save-state">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {conflict && (
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void api<Attempt>(`/attempts/${a.id}`)
                  .then((updated) => {
                    setAttempt(updated);
                    setConflict(false);
                    setError('已加载最新记录，请核对后保存');
                  })
                  .catch((e) => setError(e.message))
              }
            >
              载入最新自评
            </button>
          )}
        </section>
      </div>
      {finish && (
        <Modal
          title="确认完成自评"
          onClose={() => {
            if (!busy) setFinish(false);
          }}
        >
          <p className="modal-intro">完成后自评记录将锁定，原始作答和自动选择分保留。</p>
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setFinish(false)}>
              返回检查
            </button>
            <button className="button primary" disabled={busy} onClick={() => void complete()}>
              <Check size={16} />
              确认完成
            </button>
          </div>
        </Modal>
      )}
      {leave !== null && (
        <Modal title="本题有未保存自评" onClose={() => setLeave(null)}>
          <p>请先保存自评，或放弃本题改动。</p>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                const target = leave;
                setLeave(null);
                move(target, true);
              }}
            >
              放弃改动并离开
            </button>
            <button className="button primary" onClick={() => setLeave(null)}>
              继续自评
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

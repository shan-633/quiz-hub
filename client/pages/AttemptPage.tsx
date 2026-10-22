import { useState, useEffect } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Flag,
  Send,
  Cloud,
  CloudOff,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CircleAlert,
  Clock3,
} from 'lucide-react';
import type { Attempt } from '../../shared/model';
import { typeLabels } from '../../shared/model';
import { isAnswered } from '../../shared/domain';
import { referenceAnswer } from '../../shared/teacherReview';
import { useLoad } from '../useLoad';
import { useAnswerSync } from '../useAnswerSync';
import { api } from '../api';
import { useToast } from '../context';
import { UploadContext } from '../uploadContext';
import { QuestionRenderer } from '../components/QuestionRenderer';
import { Markdown } from '../components/Markdown';
import { Loading, ErrorState, Modal } from '../components/ui';
import { AttemptTimer } from '../components/AttemptTimer';
import {
  getScoreFeedback,
  summarizeScore,
  summarizeResult,
  navigatorState,
  navigatorLabels,
} from '../practiceFeedback';
export function AttemptPage() {
  const { id } = useParams();
  const { data, loading, error, reload } = useLoad<Attempt>(`/attempts/${id}`);
  return loading ? (
    <Loading />
  ) : error ? (
    <ErrorState message={error} retry={reload} />
  ) : data ? (
    <AttemptWorkspace
      key={`${data.id}-${data.review?.revision ?? 0}`}
      initial={data}
      reload={reload}
    />
  ) : null;
}
function AttemptWorkspace({ initial, reload }: { initial: Attempt; reload: () => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(initial),
    [active, setActive] = useState(() =>
      Math.max(
        0,
        initial.questions.findIndex((q) => q.id === params.get('question')),
      ),
    ),
    [confirm, setConfirm] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [timeLocked, setTimeLocked] = useState(
      () =>
        !!initial.enforceTimeLimit &&
        !!initial.dueAt &&
        Date.parse(initial.dueAt) <= Date.parse(initial.serverNow ?? new Date().toISOString()),
    );
  const sync = useAnswerSync(attempt, timeLocked),
    toast = useToast();
  useEffect(() => {
    const q = params.get('question');
    if (q && sync.ready)
      document.getElementById(`question-${q}`)?.scrollIntoView?.({ block: 'start' });
  }, [sync.ready, attempt.id]);
  const submitted = attempt.status === 'submitted';
  const waiting = submitted && !!attempt.review && attempt.review.state !== 'published';
  const count = attempt.questions.filter((q) => isAnswered(q, sync.get(q.id))).length;
  const jump = (index: number) => {
    setActive(index);
    document
      .getElementById(`question-${attempt.questions[index].id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const submit = async () => {
    setSubmitting(true);
    try {
      await sync.prepareSubmission();
      const result = await api<Attempt>(`/attempts/${attempt.id}/submit`, { method: 'POST' });
      setAttempt(result);
      setConfirm(false);
      toast(
        result.gradingMode === 'self'
          ? '已交卷，可查看答案并完成自评'
          : '已交卷，教师已收到你的作答',
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSubmitting(false);
    }
  };
  const result = summarizeResult(attempt.questions, attempt.grades),
    score = summarizeScore(attempt.questions, attempt.grades),
    feedback = getScoreFeedback(score.scoreRate),
    FeedbackIcon =
      feedback.band === 'pending'
        ? Clock3
        : feedback.band === 'danger'
          ? CircleAlert
          : ['caution', 'warning'].includes(feedback.band)
            ? AlertTriangle
            : CheckCircle2;
  if (!sync.ready) return <Loading />;
  return (
    <UploadContext.Provider value={sync.uploads}>
      <div className="page practice-page">
        <Link to="/library" className="back-link">
          <ArrowLeft size={16} />
          返回试卷与题库
        </Link>
        <div className="practice-heading">
          <div>
            <div className="eyebrow">{submitted ? 'PRACTICE REVIEW' : 'FOCUS & EXPLORE'}</div>
            <h1>{attempt.title}</h1>
            <div className="practice-meta">
              <span>{attempt.questions.length} 道题</span>
              <span>{attempt.questions.reduce((s, q) => s + q.score, 0)} 分</span>
              <span>{submitted ? '作答已提交' : '按自己的节奏，写清思考过程'}</span>
            </div>
          </div>
          <div className="save-state" aria-live="polite">
            {submitted ? (
              <>
                <CheckCircle2 size={17} />
                已提交
              </>
            ) : sync.status === 'saved' ? (
              <>
                <Cloud size={17} />
                已保存到服务器
              </>
            ) : sync.status === 'local' ? (
              <button className="text-button" onClick={() => void sync.flush().catch(() => {})}>
                <CloudOff size={17} />
                仅保存在本机 · 重试
              </button>
            ) : sync.status === 'conflict' ? (
              <>
                <CloudOff size={17} />
                需要处理版本冲突
              </>
            ) : sync.uploads.pending.length ? (
              <>
                <CloudOff size={17} />
                照片待同步
              </>
            ) : sync.status === 'saving' ? (
              <>
                <LoaderCircle size={17} className="spin" />
                正在保存…
              </>
            ) : (
              <button
                className="text-button error-text"
                onClick={() => void sync.flush().catch((e) => toast(e.message, true))}
              >
                <CloudOff size={17} />
                保存失败 · 重试
              </button>
            )}
          </div>
        </div>
        <AttemptTimer
          attempt={attempt}
          onLock={setTimeLocked}
          onSubmitted={(a) => {
            setAttempt(a);
            setConfirm(false);
            toast(a.submissionReason === 'timeout' ? '时间到，已自动交卷' : '作答已提交');
            navigate(a.assignmentId ? '/tasks' : '/history', {
              replace: true,
              state: {
                timeout: a.submissionReason === 'timeout',
                selfReview: a.gradingMode === 'self',
              },
            });
          }}
        />
        {submitted && attempt.gradingMode === 'self' && (
          <section className="waiting-banner self-assessment-banner">
            <div>
              <h2>
                {attempt.selfReview?.state === 'completed'
                  ? '自评已完成'
                  : '答案已公布，请对照完成自评'}
              </h2>
              <p>单选、多选自动评分；其余部分由你自己判分，成绩标记为学生自评。</p>
            </div>
            <Link className="button primary" to={`/attempts/${attempt.id}/self-review`}>
              {attempt.selfReview?.state === 'completed' ? '查看自评' : '开始自评'}
            </Link>
          </section>
        )}
        {waiting && (
          <section className="waiting-banner" aria-live="polite">
            <Clock3 size={30} />
            <div>
              <h2>已交卷，教师已收到</h2>
              {attempt.submissionReason === 'timeout' && (
                <p>本次为到时自动交卷，已同步的答案已保存。</p>
              )}
              <p>原始作答已保存。教师正在核对和批改，发布后即可查看分数、正确答案与评语。</p>
            </div>
            <button className="button" onClick={reload}>
              刷新批改结果
            </button>
          </section>
        )}
        {submitted && !waiting && (
          <div className={`result-banner result-${feedback.band}`}>
            <div>
              <FeedbackIcon size={29} aria-hidden="true" />
              <div>
                <h2>
                  {score.pendingScore > 0 && feedback.band === 'perfect'
                    ? '已判部分拿到满分，其余答案等待评阅。'
                    : feedback.title}
                </h2>
                <p>{feedback.description}</p>
                <p className="result-scope">
                  {score.scoreRate !== null
                    ? `${score.pendingScore > 0 ? '已判部分得分率' : '得分率'} ${score.displayScoreRate}%。`
                    : ''}
                  {score.pendingScore > 0
                    ? ` ${score.pendingScore} 分待评阅，最终得分以评阅后为准。`
                    : ''}
                </p>
              </div>
            </div>
            <strong>
              {score.scoreRate === null && score.earnedScore === 0 ? '—' : score.earnedScore} /{' '}
              {score.totalScore}
              <small>
                {score.scoreRate === null
                  ? '分 · 等待评阅'
                  : score.pendingScore
                    ? '分 · 当前得分'
                    : '分 · 总得分'}
              </small>
            </strong>
          </div>
        )}
        {sync.error && !submitted && (
          <div className="inline-error" role="alert">
            {sync.error}。请重试保存后再离开。
          </div>
        )}
        {Object.entries(sync.conflicts).map(([id, c]) => (
          <section className="conflict-panel" role="alert" key={id}>
            <strong>这道题有两份不同的草稿</strong>
            <p>
              本机：
              {c.local.markdown.slice(0, 120) ||
                Object.values(c.local.blankValues).join('、') ||
                '包含选择、笔迹或附件'}
            </p>
            <p>
              服务器：
              {c.remote.data.markdown.slice(0, 120) ||
                Object.values(c.remote.data.blankValues).join('、') ||
                '包含选择、笔迹或附件'}
            </p>
            <div>
              <button
                className="button"
                onClick={() => void sync.resolve(id, 'remote').catch((e) => toast(e.message, true))}
              >
                使用服务器版本
              </button>
              <button
                className="button primary"
                onClick={() => void sync.resolve(id, 'local').catch((e) => toast(e.message, true))}
              >
                保留本机版本
              </button>
            </div>
          </section>
        ))}
        <div className="practice-layout">
          <aside className="question-navigator">
            <div className="navigator-title">
              <h2>答题卡</h2>
              <span>
                {submitted
                  ? result.graded
                    ? `${result.correct}/${result.graded} 正确`
                    : '待评阅'
                  : `${count}/${attempt.questions.length}`}
              </span>
            </div>
            <div
              className={`progress-track ${submitted ? 'review-progress' : ''}`}
              role="progressbar"
              aria-label={submitted ? '已判题正确率' : '作答进度'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={
                submitted
                  ? (result.accuracy ?? 0)
                  : attempt.questions.length
                    ? (count / attempt.questions.length) * 100
                    : 0
              }
            >
              <span
                style={{
                  width: `${submitted ? (result.accuracy ?? 0) : attempt.questions.length ? (count / attempt.questions.length) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="question-numbers">
              {attempt.questions.map((q, i) => {
                const answer = sync.get(q.id),
                  state = navigatorState(submitted, isAnswered(q, answer), attempt.grades?.[q.id]);
                return (
                  <button
                    key={q.id}
                    className={`nav-${state} ${active === i ? 'active' : ''} ${answer.flagged ? 'flagged' : ''}`}
                    aria-label={`第 ${i + 1} 题，${navigatorLabels[state]}`}
                    aria-current={active === i ? 'step' : undefined}
                    onClick={() => jump(i)}
                  >
                    {String(i + 1).padStart(2, '0')}
                    {sync.get(q.id).flagged && <i />}
                  </button>
                );
              })}
            </div>
            <div className="navigator-legend">
              {submitted ? (
                <>
                  <span>
                    <i className="legend-correct" />
                    正确
                  </span>
                  <span title="错误、部分正确和未作答">
                    <i className="legend-incorrect" />
                    未全对
                  </span>
                  <span>
                    <i className="legend-pending" />
                    待评阅
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <i className="legend-done" />
                    已作答
                  </span>
                  <span>
                    <i />
                    未作答
                  </span>
                </>
              )}
              <span>
                <i className="legend-current" />
                当前题
              </span>
              <span>
                <Flag size={12} />
                待检查
              </span>
            </div>
            {!submitted && (
              <button
                className="button primary full submit-sidebar"
                disabled={timeLocked || submitting}
                onClick={() => setConfirm(true)}
              >
                <Send size={16} />
                提交练习
              </button>
            )}
            <div className="practice-note">
              <span>✳</span>
              <p>
                不急着找到答案，
                <br />
                先把思路写下来。
              </p>
            </div>
          </aside>
          <div className="question-list">
            {attempt.questions.map((q, i) => {
              const answer = sync.get(q.id),
                grade = attempt.grades?.[q.id];
              return (
                <article
                  key={q.id}
                  id={`question-${q.id}`}
                  className={`question-card ${active === i ? 'focused' : ''}`}
                  onFocusCapture={() => setActive(i)}
                >
                  <div className="question-card-heading">
                    <div>
                      <span className="question-index">{String(i + 1).padStart(2, '0')}</span>
                      <span className={`question-type type-${q.type}`}>{typeLabels[q.type]}</span>
                      <span className="question-score">{q.score} 分</span>
                      {q.type === 'multiple' && <span className="multi-hint">可多选</span>}
                    </div>
                    <button
                      className={`flag-button ${answer.flagged ? 'marked' : ''}`}
                      aria-label={answer.flagged ? '取消待检查标记' : '标记稍后检查'}
                      disabled={submitted || submitting || timeLocked}
                      onClick={() => sync.update(q.id, { ...answer, flagged: !answer.flagged })}
                    >
                      <Flag size={16} />
                      <span>{answer.flagged ? '待检查' : '标记'}</span>
                    </button>
                  </div>
                  <QuestionRenderer
                    question={q}
                    answer={answer}
                    onChange={(a) => sync.update(q.id, a)}
                    disabled={submitted || submitting || timeLocked}
                    context={{ attemptId: attempt.id, questionId: q.id }}
                  />
                  {grade && (
                    <div className={`grade-panel grade-${grade.status}`}>
                      <div className="grade-heading">
                        <strong>
                          {grade.pending
                            ? attempt.gradingMode === 'self'
                              ? '待自评'
                              : '待人工评阅'
                            : grade.status === 'correct'
                              ? '回答正确'
                              : grade.status === 'partial'
                                ? '部分正确'
                                : grade.status === 'unanswered'
                                  ? '本题未作答'
                                  : '继续理解这道题'}
                        </strong>
                        <span>
                          {grade.pending ? '保留原始解题过程' : `${grade.earned} / ${grade.max} 分`}
                        </span>
                      </div>
                      <h4>
                        {attempt.teacherFeedback?.[q.id]?.correctAnswer
                          ? '教师提供的正确答案'
                          : '参考答案与解析'}
                      </h4>
                      <Markdown
                        text={attempt.teacherFeedback?.[q.id]?.correctAnswer || referenceAnswer(q)}
                      />
                      {attempt.teacherFeedback?.[q.id] && (
                        <div className="teacher-feedback">
                          <h4>教师评语</h4>
                          <Markdown
                            text={attempt.teacherFeedback[q.id].comment || '本题未填写评语。'}
                          />
                          <p className="feedback-author">
                            {attempt.teacherFeedback[q.id].teacherName} · 已批改
                          </p>
                        </div>
                      )}
                      {attempt.selfReview?.feedback[q.id] && (
                        <div className="teacher-feedback">
                          <h4>自评备注</h4>
                          <Markdown
                            text={attempt.selfReview.feedback[q.id].comment || '未填写自评备注'}
                          />
                          <p className="feedback-author">
                            学生自评 · {attempt.selfReview.feedback[q.id].score}分（人工部分）
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
            <div className="practice-bottom">
              <span>
                <Check size={16} />
                {submitted ? '已提交并保存' : `已完成 ${count} / ${attempt.questions.length} 题`}
              </span>
              {!submitted && (
                <button
                  className="button primary"
                  disabled={timeLocked || submitting}
                  onClick={() => setConfirm(true)}
                >
                  完成并提交
                  <ArrowRight size={17} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="practice-mobile-actions">
          <button className="button" disabled={active === 0} onClick={() => jump(active - 1)}>
            <ChevronLeft size={18} />
            上一题
          </button>
          <span>
            {active + 1} / {attempt.questions.length}
          </span>
          {active < attempt.questions.length - 1 ? (
            <button className="button primary" onClick={() => jump(active + 1)}>
              下一题
              <ChevronRight size={18} />
            </button>
          ) : (
            <button
              className="button primary"
              disabled={submitted || submitting || timeLocked}
              onClick={() => setConfirm(true)}
            >
              {submitted ? '已提交' : '提交练习'}
              <Send size={16} />
            </button>
          )}
        </div>
        {confirm && (
          <Modal
            title="提交前，再看一眼"
            onClose={() => {
              if (!submitting) setConfirm(false);
            }}
          >
            <p className="modal-intro">
              已完成 <strong>{count}</strong> / {attempt.questions.length} 题。
              {count < attempt.questions.length
                ? '还有未完成的题目，可以返回补充，也可以继续提交。'
                : attempt.gradingMode === 'self'
                  ? '作答已准备好，提交后即可查看答案并开始自评。'
                  : '每一份思考都已准备好，提交后将交给教师批改。'}
            </p>
            <div className="submission-overview">
              {attempt.questions.map((q, i) => {
                const a = sync.get(q.id);
                return (
                  <div key={q.id}>
                    <span>
                      {String(i + 1).padStart(2, '0')} · {typeLabels[q.type]}
                    </span>
                    <span>
                      {isAnswered(q, a) ? '已作答' : '未完成'}
                      {a.markdown ? ' · 文字' : ''}
                      {a.drawingPages.length ? ` · ${a.drawingPages.length} 页笔迹` : ''}
                      {a.imagePages.length ? ` · ${a.imagePages.length} 张照片` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="muted small">
              {attempt.gradingMode === 'self'
                ? '提交后无法修改本次答案。单选、多选自动评分，其他部分由你对照标准答案完成自评。'
                : '提交后无法修改本次答案。教师收到试卷或答题卡并完成批改，发布后即可查看成绩与反馈。'}
            </p>
            <div className="modal-actions">
              <button className="button" disabled={submitting} onClick={() => setConfirm(false)}>
                返回检查
              </button>
              <button
                className="button primary"
                disabled={submitting || timeLocked}
                onClick={() => void submit()}
              >
                {submitting ? '正在保存并提交…' : '确认提交'}
                <Send size={16} />
              </button>
            </div>
          </Modal>
        )}
      </div>
    </UploadContext.Provider>
  );
}

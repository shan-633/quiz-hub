import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ArrowUpRight } from 'lucide-react';
import {
  accuracyTone,
  attemptHref,
  learningCalendar,
  learningDay,
  learningStage,
  learningStageLabels,
} from '../../shared/learningOverview';
import type { AttemptSummary, LearningDay } from '../../shared/learningOverview';

export const percentage = (value: number) => `${Number(value.toFixed(1))}%`;
function dayLabel(day: LearningDay) {
  if (day.future) return `${day.date}：尚未到来`;
  if (!day.attempts.length) return `${day.date}：没有交卷记录`;
  return `${day.date}：${day.attempts.length}份作答，${day.accuracy === undefined ? '暂无完整成绩' : `正确率${percentage(day.accuracy)}`}${day.pending ? `，${day.pending}份待评` : ''}`;
}
export function LearningHeatmap({ attempts }: { attempts: AttemptSummary[] }) {
  const today = learningDay(new Date());
  const days = useMemo(() => learningCalendar(attempts), [attempts, today]);
  const [selected, setSelected] = useState('');
  const latest = days.filter((d) => !d.future && d.attempts.length).at(-1);
  const detail =
    days.find((d) => d.date === selected) ?? latest ?? days.find((d) => d.date === today)!;
  const evaluated = days.flatMap((d) => d.attempts).filter((a) => a.performance);
  const correct = evaluated.reduce((n, a) => n + a.performance!.correct, 0);
  const total = evaluated.reduce((n, a) => n + a.performance!.total, 0);
  const pending = days.reduce((n, d) => n + d.pending, 0);
  const months = days
    .filter((_, i) => i % 7 === 0)
    .map((day, index, weeks) => ({
      label:
        index === 0 || day.date.slice(0, 7) !== weeks[index - 1].date.slice(0, 7)
          ? `${Number(day.date.slice(5, 7))}月`
          : '',
    }));
  return (
    <>
      <div className="learning-heatmap-summary">
        <div>
          <strong>{total ? percentage((correct / total) * 100) : '—'}</strong>
          <span>完全答对比例</span>
        </div>
        <div>
          <strong>
            {evaluated.length}
            <small> 份</small>
          </strong>
          <span>已完成评阅</span>
        </div>
        <div>
          <strong>
            {pending}
            <small> 份</small>
          </strong>
          <span>等待批改 / 自评</span>
        </div>
        <p>
          每一次复盘，
          <br />
          都让理解更清晰。
        </p>
      </div>
      <div className="learning-calendar" aria-label="最近12周作答正确率热力图">
        <div className="learning-months" aria-hidden="true">
          <span />
          {months.map((month, i) => (
            <span key={i}>{month.label}</span>
          ))}
        </div>
        <div className="learning-calendar-body">
          <div className="learning-weekdays" aria-hidden="true">
            {['一', '', '三', '', '五', '', '日'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="learning-cells">
            {days.map((day, index) => (
              <button
                key={day.date}
                type="button"
                className={`learning-cell tone-${day.attempts.length ? accuracyTone(day.accuracy) : 'empty'} ${day.future ? 'is-future' : ''}`}
                aria-label={dayLabel(day)}
                title={dayLabel(day)}
                disabled={day.future}
                aria-pressed={detail.date === day.date}
                tabIndex={detail.date === day.date ? 0 : -1}
                onKeyDown={(event) => {
                  const step = { ArrowRight: 7, ArrowLeft: -7, ArrowUp: -1, ArrowDown: 1 }[
                    event.key
                  ];
                  if (step === undefined) return;
                  event.preventDefault();
                  const next = index + step;
                  if (!days[next] || days[next].future) return;
                  setSelected(days[next].date);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('button')
                    [next]?.focus();
                }}
                onClick={() => setSelected(day.date)}
              >
                {day.pending > 0 && day.total > 0 && <span className="learning-pending-dot" />}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="learning-legend" aria-label="热力图图例">
        <span>
          <i className="tone-empty" />
          无交卷
        </span>
        <span>
          <i className="tone-waiting" />
          待评
        </span>
        {[
          ['risk', '<60%'],
          ['warning', '60%+'],
          ['steady', '75%+'],
          ['safe', '85%+'],
          ['strong', '90%+'],
          ['perfect', '100%'],
        ].map(([tone, text]) => (
          <span key={tone}>
            <i className={`tone-${tone}`} />
            {text}
          </span>
        ))}
      </div>
      <section className="learning-day-detail" aria-label="当天作答详情" aria-live="polite">
        <div className="learning-day-heading">
          <span>
            <CalendarDays size={15} />
            {detail.date.replaceAll('-', '.')}
          </span>
          <small>
            {detail.attempts.length ? `${detail.attempts.length}份作答` : '没有交卷记录'}
          </small>
        </div>
        {!detail.attempts.length ? (
          <p className="learning-empty-day">
            这一天还没有交卷记录。点击有颜色的格子，回看你的作答。
          </p>
        ) : (
          <div className="learning-day-rows">
            {detail.attempts.map((a) => (
              <Link key={a.id} to={attemptHref(a)} className="learning-day-row">
                <span className="learning-day-title">
                  {a.title}
                  {a.gradingMode === 'self' && <small>学生自评</small>}
                </span>
                <span className="learning-day-result">
                  {a.performance ? (
                    <>
                      <span>
                        {a.performance.correct} / {a.performance.total} 题全对
                        {a.performance.partial ? ` · ${a.performance.partial}题部分得分` : ''}
                      </span>
                      <strong>
                        {a.performance.earned} / {a.performance.max} 分
                      </strong>
                    </>
                  ) : (
                    <span>
                      {learningStage(a) === 'graded'
                        ? '成绩统计待补全'
                        : learningStageLabels[learningStage(a)]}
                    </span>
                  )}
                </span>
                <ArrowUpRight size={15} />
              </Link>
            ))}
          </div>
        )}
      </section>
      <p className="learning-method">
        按北京时间交卷日归档；正确率仅统计完整评阅的作答，部分得分不计为全对。学生自评会注明。
      </p>
    </>
  );
}

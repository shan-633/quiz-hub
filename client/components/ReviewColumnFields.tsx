import { useState } from 'react';
import { Plus, Trash2, Check, LockKeyhole } from 'lucide-react';
import type {
  Attempt,
  Grade,
  Question,
  ReviewColumn,
  ReviewColumnFeedback,
} from '../../shared/model';
import type { ReviewTarget } from '../../shared/reviewColumns';
import {
  columnReference,
  reviewPoints,
  columnAllocationNote,
  validColumnScore,
} from '../../shared/reviewColumns';
import { walkBlocks } from '../../shared/domain';
import { randomId } from '../../shared/browserIds';
import type { ColumnForms, ColumnForm } from '../reviewColumnForms';
import { GradeControls } from './GradeControls';
import { Markdown } from './Markdown';
import './reviewColumns.css';
function responseText(a: Attempt, q: Question, c: ReviewTarget) {
  const answer = a.answers[q.id]?.data;
  if (!answer) return '未作答';
  if (c.kind === 'blank') return answer.blankValues[c.sourceId]?.trim() || '未作答';
  if (c.kind === 'custom') return '请按原卷相应小问核对，完整作答见左侧。';
  const response = c.kind === 'part' ? answer.parts[c.sourceId] : answer;
  if (!response) return '未作答';
  const b = walkBlocks(q.content).find((b) => b.id === c.sourceId);
  if (b?.type === 'subquestion' && b.options?.length)
    return (
      b.options
        .filter((o) => response.choiceIds.includes(o.id))
        .map((o) => String.fromCharCode(65 + b.options!.indexOf(o)))
        .join('、') || '未作答'
    );
  return (
    [
      response.markdown,
      response.drawingPages.length ? `${response.drawingPages.length}页手写（见原始作答）` : '',
      response.imagePages.length ? `${response.imagePages.length}张照片（见原始作答）` : '',
    ]
      .filter(Boolean)
      .join(' · ') || '未作答'
  );
}
export function ReviewColumnFields({
  attempt,
  question,
  columns,
  value,
  onChange,
  disabled,
  self = false,
  automatic = {},
  showErrors = false,
  customRubric = false,
}: {
  attempt: Attempt;
  question: Question;
  columns: ReviewTarget[];
  value: ColumnForms;
  onChange: (id: string, patch: Partial<ColumnForm>) => void;
  disabled?: boolean;
  self?: boolean;
  automatic?: Grade['details'];
  showErrors?: boolean;
  customRubric?: boolean;
}) {
  const valid = (c: ReviewColumn) =>
    !!value[c.id]?.score.trim() &&
    validColumnScore(c.max, value[c.id]?.verdict ?? '', Number(value[c.id]?.score));
  const done = columns.filter((c) => Object.hasOwn(automatic, c.id) || valid(c)).length;
  const allocation = customRubric
    ? '评分栏目采用教师为本次答卷确认的分值，原卷快照保持不变。'
    : columnAllocationNote(question);
  return (
    <div className="review-columns">
      {allocation && <p className="review-column-legacy">{allocation}</p>}
      <div className="review-columns-progress">
        <strong>分栏评价</strong>
        <span>
          {done} / {columns.length} 栏已评价
        </span>
      </div>
      <p className="muted small">每个栏目都要完成评价，才能保存并切换到下一题。</p>
      {columns.map((c) => {
        const locked = Object.hasOwn(automatic, c.id),
          f = value[c.id];
        return (
          <fieldset
            key={c.id}
            className={`review-column ${showErrors && !locked && !valid(c) ? 'has-error' : ''}`}
            aria-label={`评分栏目：${c.label}`}
            data-review-column={c.id}
            tabIndex={-1}
          >
            <legend>
              <strong>{c.label}</strong>
              <span>{c.max}分</span>
            </legend>
            <div className="review-column-state">
              {locked ? (
                <>
                  <LockKeyhole size={12} />
                  选择小问已自动评分 · {automatic[c.id].earned} / {c.max}分
                </>
              ) : valid(c) ? (
                <>
                  <Check size={12} />
                  已评价，保存后生效
                </>
              ) : (
                '未评价'
              )}
            </div>
            <div className="review-column-response">
              <small>本栏作答</small>
              <p>{responseText(attempt, question, c)}</p>
            </div>
            {self && columnReference(question, c) && (
              <div className="review-column-reference">
                <small>参考答案</small>
                <Markdown text={columnReference(question, c)} />
              </div>
            )}
            {!locked && f && (
              <>
                <GradeControls
                  value={f}
                  maximum={c.max}
                  disabled={disabled}
                  scoreLabel={`${c.label}得分`}
                  onChange={(patch) => onChange(c.id, patch)}
                />
                {!self && (
                  <label className="field">
                    正确答案
                    <textarea
                      rows={3}
                      maxLength={20000}
                      disabled={disabled}
                      value={f.correctAnswer}
                      onChange={(e) => onChange(c.id, { correctAnswer: e.target.value })}
                      placeholder="本栏正确答案或过程，可留空沿用题库参考答案"
                    />
                  </label>
                )}
                <label className="field">
                  {self ? '自评备注' : '教师评语'}
                  <textarea
                    rows={2}
                    maxLength={10000}
                    disabled={disabled}
                    value={f.comment}
                    onChange={(e) => onChange(c.id, { comment: e.target.value })}
                    placeholder={self ? '记录本栏需要复习的地方（可选）' : '本栏评语（可选）'}
                  />
                </label>
              </>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
const verdicts = { correct: '正确', incorrect: '错误', partial: '部分正确' };
export function ReviewColumnResults({
  columns,
  items,
  self = false,
}: {
  columns: ReviewColumn[];
  items: Record<string, ReviewColumnFeedback>;
  self?: boolean;
}) {
  return (
    <div className="review-column-results" aria-label={self ? '逐栏自评结果' : '逐栏批改结果'}>
      {columns
        .filter((c) => Object.hasOwn(items, c.id))
        .map((c) => {
          const f = items[c.id];
          return (
            <section className={`review-column-result result-${f.verdict}`} key={c.id}>
              <div className="review-column-result-heading">
                <h4>{c.label}</h4>
                <span>
                  {verdicts[f.verdict]} · {f.score} / {c.max}分
                </span>
              </div>
              {f.correctAnswer && (
                <>
                  <small>正确答案</small>
                  <Markdown text={f.correctAnswer} />
                </>
              )}
              <small>{self ? '自评备注' : '教师评语'}</small>
              <Markdown text={f.comment || (self ? '未填写自评备注' : '本栏未填写评语')} />
            </section>
          );
        })}
    </div>
  );
}
export function RubricSetup({
  maximum,
  initial,
  disabled,
  onApply,
  onCancel,
  fixed = false,
}: {
  maximum: number;
  initial?: ReviewColumn[];
  disabled?: boolean;
  onApply: (columns: ReviewColumn[]) => void;
  onCancel: () => void;
  fixed?: boolean;
}) {
  const [rows, setRows] = useState(
    () =>
      initial?.map((c) => ({ ...c, points: String(c.max) })) ??
      [1, 2].map((n) => ({
        id: `custom-${randomId().slice(0, 12)}`,
        label: `（${n}）`,
        max: 0,
        points: '',
      })),
  );
  const [error, setError] = useState('');
  const sum = reviewPoints(rows.reduce((n, c) => n + (Number(c.points) || 0), 0));
  return (
    <div className="review-rubric-setup" aria-label="拆分评分栏目">
      <h3>{fixed ? '核对评分栏目分值' : '按原卷拆分评分栏目'}</h3>
      <p className="muted small">
        {fixed
          ? '保留全部空格和小问，请核对每栏满分。'
          : '原图题未提供结构化小问，请明确填写每栏名称和满分。'}
        合计须为本题{maximum}分；只影响本次答卷。
      </p>
      {rows.map((c, i) => (
        <div className="review-rubric-row" key={c.id}>
          <label className="field">
            栏目{i + 1}名称
            <input
              value={c.label}
              maxLength={200}
              disabled={disabled}
              onChange={(e) =>
                setRows(rows.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))
              }
            />
          </label>
          <label className="field">
            栏目{i + 1}满分
            <input
              type="number"
              min={0}
              max={maximum}
              step="any"
              value={c.points}
              disabled={disabled}
              onChange={(e) =>
                setRows(rows.map((x) => (x.id === c.id ? { ...x, points: e.target.value } : x)))
              }
            />
          </label>
          <button
            className="icon-button"
            aria-label={`删除栏目${i + 1}`}
            disabled={disabled || fixed || rows.length <= 2}
            onClick={() => setRows(rows.filter((x) => x.id !== c.id))}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <p className={sum === maximum ? 'muted small' : 'small rubric-invalid'}>
        栏目满分合计：{sum} / {maximum}分
      </p>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="review-rubric-actions">
        <button
          className="button"
          disabled={disabled || fixed || rows.length >= 100}
          onClick={() =>
            setRows([
              ...rows,
              {
                id: `custom-${randomId().slice(0, 12)}`,
                label: `（${rows.length + 1}）`,
                points: '',
                max: 0,
              },
            ])
          }
        >
          <Plus size={14} />
          增加栏目
        </button>
        <button className="button" disabled={disabled} onClick={onCancel}>
          取消
        </button>
        <button
          className="button primary"
          disabled={disabled}
          onClick={() => {
            if (
              rows.some(
                (c) =>
                  !c.label.trim() ||
                  !c.points.trim() ||
                  !Number.isFinite(Number(c.points)) ||
                  Number(c.points) < 0,
              ) ||
              Math.abs(sum - maximum) > 0.000000001
            ) {
              setError('请填写所有栏目名称和有效满分，合计必须等于本题总分');
              return;
            }
            onApply(rows.map((c) => ({ id: c.id, label: c.label.trim(), max: Number(c.points) })));
          }}
        >
          应用分栏
        </button>
      </div>
    </div>
  );
}

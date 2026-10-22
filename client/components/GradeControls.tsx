import { Check, X, CircleDashed } from 'lucide-react';
import type { TeacherFeedback } from '../../shared/model';
export interface GradeValue {
  verdict: TeacherFeedback['verdict'] | '';
  score: string;
}
export function GradeControls({
  value,
  maximum,
  disabled = false,
  onChange,
  scoreLabel = '本题得分',
}: {
  value: GradeValue;
  maximum: number;
  disabled?: boolean;
  onChange: (patch: Partial<GradeValue>) => void;
  scoreLabel?: string;
}) {
  return (
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
            className={`verdict-${v} ${value.verdict === v ? 'selected' : ''}`}
            aria-pressed={value.verdict === v}
            disabled={disabled || (v === 'partial' && maximum === 0)}
            onClick={() =>
              onChange({
                verdict: v,
                score: String(
                  v === 'correct'
                    ? maximum
                    : v === 'incorrect'
                      ? 0
                      : Number(value.score) > 0 && Number(value.score) < maximum
                        ? Number(value.score)
                        : maximum / 2,
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
        {scoreLabel}
        <div className="grading-score-input">
          <input
            type="number"
            step="any"
            min={0}
            max={maximum}
            aria-label={scoreLabel}
            value={value.score}
            disabled={disabled || value.verdict !== 'partial'}
            onChange={(e) => onChange({ score: e.target.value })}
          />
          <span>/ {maximum} 分</span>
        </div>
      </label>
    </>
  );
}

import { assetUrl } from '../api';
import type { AnswerData, Block, Option, Question, ResponseValue } from '../../shared/model';
import { emptyAnswer, emptyResponse } from '../../shared/domain';
import { Markdown } from './Markdown';
import katex from 'katex';
import { CalculationAnswer } from './CalculationAnswer';
import type { AnswerContext } from '../uploadContext';
export function OptionGroup({
  options,
  ids,
  onChange,
  multiple,
  disabled,
  name,
}: {
  options: Option[];
  ids: string[];
  onChange: (ids: string[]) => void;
  multiple: boolean;
  disabled?: boolean;
  name: string;
}) {
  return (
    <div className="options">
      {options.map((o, i) => (
        <label
          className={`option ${ids.includes(o.id) ? 'selected' : ''} ${disabled ? 'readonly' : ''}`}
          key={o.id}
        >
          <input
            type={multiple ? 'checkbox' : 'radio'}
            name={name}
            value={o.id}
            checked={ids.includes(o.id)}
            disabled={disabled}
            onChange={() =>
              onChange(
                multiple
                  ? ids.includes(o.id)
                    ? ids.filter((x) => x !== o.id)
                    : [...ids, o.id]
                  : [o.id],
              )
            }
          />
          <span className="option-letter">{String.fromCharCode(65 + i)}</span>
          <span className="option-copy">
            <Markdown text={o.text} inline />
          </span>
        </label>
      ))}
    </div>
  );
}
export function QuestionRenderer({
  question: q,
  answer = emptyAnswer(),
  onChange = () => {},
  disabled = false,
  context,
}: {
  question: Question;
  answer?: AnswerData;
  onChange?: (a: AnswerData) => void;
  disabled?: boolean;
  context?: AnswerContext;
}) {
  const inline = (text: string) => (
    <>
      {text.split(/(\{\{[a-zA-Z0-9_-]+\}\})/g).map((chunk, index) => {
        const match = chunk.match(/^\{\{(.+)\}\}$/);
        if (!match) return <Markdown key={index} text={chunk} inline />;
        const blank = q.blanks.find((b) => b.id === match[1]);
        if (!blank)
          return (
            <span key={index} className="invalid-blank">
              [未配置空格]
            </span>
          );
        return (
          <input
            key={index}
            aria-label={blank.label}
            className="inline-blank"
            inputMode={blank.kind === 'number' ? 'decimal' : 'text'}
            value={answer.blankValues[blank.id] ?? ''}
            placeholder={blank.kind === 'number' ? '数值' : '填写答案'}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...answer,
                blankValues: { ...answer.blankValues, [blank.id]: e.target.value },
              })
            }
          />
        );
      })}
    </>
  );
  const block = (b: Block): React.ReactNode => {
    switch (b.type) {
      case 'paragraph':
        return (
          <div className="stem-paragraph" key={b.id}>
            {/\{\{/.test(b.text) ? inline(b.text) : <Markdown text={b.text} />}
          </div>
        );
      case 'formula': {
        let html = '';
        try {
          html = katex.renderToString(b.latex, {
            displayMode: true,
            throwOnError: false,
            trust: false,
            maxExpand: 500,
          });
        } catch {}
        return (
          <div className="formula-block" key={b.id} dangerouslySetInnerHTML={{ __html: html }} />
        );
      }
      case 'image':
        return (
          <figure className="question-figure" key={b.id} style={{ maxWidth: `${b.width}%` }}>
            <a
              href={b.assetId ? assetUrl(b.assetId) : b.src}
              target="_blank"
              rel="noreferrer"
              aria-label={`放大图片：${b.alt}`}
            >
              <img src={b.assetId ? assetUrl(b.assetId) : b.src} alt={b.alt} loading="lazy" />
            </a>
            {b.caption && <figcaption>{b.caption}</figcaption>}
          </figure>
        );
      case 'table':
        return (
          <div className="table-scroll" key={b.id}>
            <table className="question-table">
              <thead>
                <tr>
                  {b.headers.map((cell, i) => (
                    <th key={i}>{inline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{inline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'group':
        return (
          <div className={`content-group ${b.layout}`} key={b.id}>
            {b.children.map(block)}
          </div>
        );
      case 'subquestion': {
        const part = answer.parts[b.id] ?? emptyResponse();
        const change = (p: ResponseValue) =>
          onChange({ ...answer, parts: { ...answer.parts, [b.id]: p } });
        return (
          <section className="subquestion" key={b.id}>
            <div className="subquestion-heading">
              <strong>{b.label}</strong>
              <span>{b.score} 分</span>
            </div>
            {b.children.map(block)}
            {(b.responseKind === 'single' || b.responseKind === 'multiple') && (
              <OptionGroup
                options={b.options ?? []}
                ids={part.choiceIds}
                onChange={(choiceIds) => change({ ...part, choiceIds })}
                multiple={b.responseKind === 'multiple'}
                disabled={disabled}
                name={`${q.id}-${b.id}`}
              />
            )}{' '}
            {b.responseKind === 'open' && (
              <CalculationAnswer
                value={part}
                onChange={change}
                disabled={disabled}
                context={context ? { ...context, partId: b.id } : undefined}
              />
            )}
          </section>
        );
      }
    }
  };
  return (
    <div className="question-renderer">
      <div className="question-content">{q.content.map(block)}</div>
      {(q.type === 'single' || q.type === 'multiple') && (
        <OptionGroup
          options={q.options}
          ids={answer.choiceIds}
          onChange={(choiceIds) => onChange({ ...answer, choiceIds })}
          multiple={q.type === 'multiple'}
          disabled={disabled}
          name={q.id}
        />
      )}
      {q.type === 'calculation' && (
        <CalculationAnswer
          value={answer}
          onChange={(value) => onChange({ ...answer, ...value })}
          disabled={disabled}
          context={context}
          allowedModes={q.allowedModes}
        />
      )}
    </div>
  );
}

import { Plus, Trash2 } from 'lucide-react';
import type { Block, Question } from '../../../shared/model';
import { insertTableBlank } from '../../../shared/editor';
export function TableEditor({
  block: b,
  onChange,
  question,
  onQuestionChange,
}: {
  block: Extract<Block, { type: 'table' }>;
  onChange: (b: Extract<Block, { type: 'table' }>) => void;
  question: Question;
  onQuestionChange: (q: Question) => void;
}) {
  return (
    <div className="table-edit">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {b.headers.map((cell, column) => (
                <th key={column}>
                  <input
                    aria-label={`第 ${column + 1} 列表头`}
                    value={cell}
                    onChange={(e) =>
                      onChange({
                        ...b,
                        headers: b.headers.map((v, i) => (i === column ? e.target.value : v)),
                      })
                    }
                  />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column}>
                    <textarea
                      aria-label={`第 ${index + 1} 行第 ${column + 1} 列`}
                      rows={2}
                      value={cell}
                      onChange={(e) =>
                        onChange({
                          ...b,
                          rows: b.rows.map((r, i) =>
                            i === index ? r.map((v, j) => (j === column ? e.target.value : v)) : r,
                          ),
                        })
                      }
                    />
                    {(question.type === 'fill' ||
                      question.type === 'experiment' ||
                      question.type === 'reading') && (
                      <button
                        className="text-button"
                        onClick={() =>
                          onQuestionChange(insertTableBlank(question, b.id, index, column))
                        }
                      >
                        <Plus size={11} />
                        填空
                      </button>
                    )}
                  </td>
                ))}
                <td>
                  <button
                    className="icon-button danger"
                    aria-label={`删除表格第 ${index + 1} 行`}
                    onClick={() => onChange({ ...b, rows: b.rows.filter((_, i) => i !== index) })}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-edit-actions">
        <button
          className="button small"
          disabled={b.rows.length >= 100}
          onClick={() => onChange({ ...b, rows: [...b.rows, b.headers.map(() => '')] })}
        >
          <Plus size={13} />
          添加行
        </button>
        <button
          className="button small"
          disabled={b.headers.length >= 20}
          onClick={() =>
            onChange({
              ...b,
              headers: [...b.headers, `列 ${b.headers.length + 1}`],
              rows: b.rows.map((r) => [...r, '']),
            })
          }
        >
          <Plus size={13} />
          添加列
        </button>
        {b.headers.length > 1 && (
          <button
            className="text-button"
            onClick={() =>
              onChange({
                ...b,
                headers: b.headers.slice(0, -1),
                rows: b.rows.map((r) => r.slice(0, -1)),
              })
            }
          >
            移除末列
          </button>
        )}
      </div>
    </div>
  );
}

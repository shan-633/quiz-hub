import { assetUrl } from '../../api';
import { useRef } from 'react';
import { duplicateBlock, removeBlock, insertBlankAt, reorderBlock } from '../../../shared/editor';
import { TableEditor } from './TableEditor';
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Type,
  Image,
  FunctionSquare,
  Table2,
  ListTree,
  Columns2,
  GripVertical,
  Copy,
} from 'lucide-react';
import type { Block, Question } from '../../../shared/model';
import { ImageUploader } from './ImageUploader';
export function BlockEditor({
  blocks,
  onChange,
  question: q,
  onQuestionChange,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  question: Question;
  onQuestionChange: (q: Question) => void;
}) {
  const cursor = useRef<Record<string, number>>({});
  const update = (id: string, data: Partial<Block>) =>
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...data } as Block) : b)));
  const move = (index: number, direction: number) => {
    const list = [...blocks];
    [list[index], list[index + direction]] = [list[index + direction], list[index]];
    onChange(list);
  };
  const add = (type: Block['type']) => {
    const id = crypto.randomUUID();
    const b: Block =
      type === 'paragraph'
        ? { id, type, text: '' }
        : type === 'formula'
          ? { id, type, latex: 'v=\\frac{s}{t}' }
          : type === 'image'
            ? {
                id,
                type,
                src: '/diagrams/cart.svg',
                alt: '小车在水平面上运动',
                caption: '',
                width: 80,
              }
            : type === 'table'
              ? {
                  id,
                  type,
                  headers: ['实验次数', '测量结果'],
                  rows: [
                    ['1', ''],
                    ['2', ''],
                  ],
                }
              : type === 'group'
                ? {
                    id,
                    type,
                    layout: 'mediaAside',
                    children: [{ id: crypto.randomUUID(), type: 'paragraph', text: '' }],
                  }
                : {
                    id,
                    type: 'subquestion',
                    label: `（${blocks.filter((b) => b.type === 'subquestion').length + 1}）`,
                    score: 2,
                    responseKind: 'blanks',
                    children: [{ id: crypto.randomUUID(), type: 'paragraph', text: '' }],
                  };
    onChange([...blocks, b]);
  };
  const insertBlank = (block: Extract<Block, { type: 'paragraph' }>) =>
    onQuestionChange(insertBlankAt(q, block.id, cursor.current[block.id] ?? block.text.length));
  return (
    <div className="block-editor">
      {blocks.map((b, index) => (
        <section
          className="edit-block"
          key={b.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onQuestionChange(reorderBlock(q, e.dataTransfer.getData('text/plain'), b.id));
          }}
        >
          <div className="block-bar">
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', b.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              title="拖动可调整同级顺序"
            >
              <GripVertical size={15} />
              {
                {
                  paragraph: '文字',
                  formula: '公式',
                  image: '图片',
                  table: '表格',
                  group: '组合排版',
                  subquestion: '子问题',
                }[b.type]
              }
            </span>
            <div>
              <button
                className="icon-button"
                title="复制内容块"
                aria-label="复制内容块"
                onClick={() => onQuestionChange(duplicateBlock(q, b.id))}
              >
                <Copy size={14} />
              </button>
              <button
                className="icon-button"
                title="向上移动"
                aria-label="向上移动内容块"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="icon-button"
                title="向下移动"
                aria-label="向下移动内容块"
                disabled={index === blocks.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                className="icon-button danger"
                aria-label="删除内容块"
                onClick={() => onQuestionChange(removeBlock(q, b.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="block-body">
            {b.type === 'paragraph' && (
              <>
                <textarea
                  onSelect={(e) => {
                    cursor.current[b.id] = e.currentTarget.selectionStart;
                  }}
                  aria-label="文字内容"
                  rows={3}
                  value={b.text}
                  onChange={(e) => update(b.id, { text: e.target.value })}
                  placeholder="输入题干文字，支持 Markdown 和 $公式$"
                />
                {(q.type === 'fill' || q.type === 'experiment' || q.type === 'reading') && (
                  <button className="text-button small" onClick={() => insertBlank(b)}>
                    <Plus size={14} />
                    插入空格
                  </button>
                )}
              </>
            )}
            {b.type === 'formula' && (
              <label className="field">
                LaTeX 公式
                <input value={b.latex} onChange={(e) => update(b.id, { latex: e.target.value })} />
              </label>
            )}
            {b.type === 'image' && (
              <>
                <ImageUploader
                  onUploaded={(assetId) => update(b.id, { assetId, src: undefined })}
                />
                <img
                  className="editor-image"
                  src={b.assetId ? assetUrl(b.assetId) : b.src}
                  alt={b.alt}
                />
                <div className="form-grid">
                  <label className="field">
                    示例图片
                    <select
                      value={b.src ?? ''}
                      onChange={(e) => update(b.id, { src: e.target.value, assetId: undefined })}
                    >
                      <option value="/diagrams/cart.svg">水平运动小车</option>
                      <option value="/diagrams/friction.svg">摩擦力实验</option>
                      <option value="/diagrams/circuit.svg">电路</option>
                      <option value="/diagrams/buoyancy.svg">漂浮木块</option>
                    </select>
                  </label>
                  <label className="field">
                    展示宽度（%）
                    <input
                      type="number"
                      min="10"
                      max="100"
                      value={b.width}
                      onChange={(e) => update(b.id, { width: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    图片说明
                    <input
                      value={b.caption}
                      onChange={(e) => update(b.id, { caption: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    替代文字
                    <input value={b.alt} onChange={(e) => update(b.id, { alt: e.target.value })} />
                  </label>
                </div>
              </>
            )}
            {b.type === 'table' && (
              <TableEditor
                block={b}
                onChange={(next) => update(b.id, next)}
                question={q}
                onQuestionChange={onQuestionChange}
              />
            )}
            {b.type === 'group' && (
              <label className="field">
                排版方式
                <select
                  value={b.layout}
                  onChange={(e) =>
                    update(b.id, { layout: e.target.value as 'stack' | 'mediaAside' })
                  }
                >
                  <option value="mediaAside">图文并排（手机自动上下）</option>
                  <option value="stack">上下排列</option>
                </select>
              </label>
            )}
            {b.type === 'subquestion' && (
              <div className="form-grid">
                <label className="field">
                  小问标题
                  <input
                    value={b.label}
                    onChange={(e) => update(b.id, { label: e.target.value })}
                  />
                </label>
                <label className="field">
                  小问分值
                  <input
                    type="number"
                    value={b.score}
                    onChange={(e) => update(b.id, { score: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  作答方式
                  <select
                    value={b.responseKind}
                    onChange={(e) =>
                      update(b.id, {
                        responseKind: e.target.value as any,
                        ...(['single', 'multiple'].includes(e.target.value) && !b.options
                          ? {
                              options: [
                                { id: 'a', text: '' },
                                { id: 'b', text: '' },
                              ],
                            }
                          : {}),
                      })
                    }
                  >
                    <option value="blanks">正文填空</option>
                    <option value="single">单选</option>
                    <option value="multiple">多选</option>
                    <option value="open">开放回答</option>
                  </select>
                </label>
              </div>
            )}
            {'children' in b && (
              <BlockEditor
                blocks={b.children}
                onChange={(children) => update(b.id, { children })}
                question={q}
                onQuestionChange={onQuestionChange}
              />
            )}
            {b.type === 'subquestion' &&
              (b.responseKind === 'single' || b.responseKind === 'multiple') && (
                <div className="subquestion-options">
                  {b.options?.map((o, i) => (
                    <label className="option-edit-row" key={o.id}>
                      <input
                        type={b.responseKind === 'single' ? 'radio' : 'checkbox'}
                        name={`correct-${b.id}`}
                        checked={(q.solution?.partChoices?.[b.id] ?? []).includes(o.id)}
                        onChange={() => {
                          const prev = q.solution?.partChoices?.[b.id] ?? [];
                          onQuestionChange({
                            ...q,
                            solution: {
                              ...q.solution!,
                              partChoices: {
                                ...q.solution?.partChoices,
                                [b.id]:
                                  b.responseKind === 'single'
                                    ? [o.id]
                                    : prev.includes(o.id)
                                      ? prev.filter((id) => id !== o.id)
                                      : [...prev, o.id],
                              },
                            },
                          });
                        }}
                      />
                      <span>{String.fromCharCode(65 + i)}</span>
                      <input
                        aria-label={`子题选项 ${i + 1}`}
                        value={o.text}
                        onChange={(e) =>
                          update(b.id, {
                            options: b.options!.map((x) =>
                              x.id === o.id ? { ...x, text: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
          </div>
        </section>
      ))}
      <div className="add-block-buttons">
        {[
          { type: 'paragraph', label: '文字', Icon: Type },
          { type: 'image', label: '图片', Icon: Image },
          { type: 'formula', label: '公式', Icon: FunctionSquare },
          { type: 'table', label: '表格', Icon: Table2 },
          { type: 'group', label: '图文', Icon: Columns2 },
          { type: 'subquestion', label: '子题', Icon: ListTree },
        ].map(({ type, label, Icon }) => (
          <button key={type} className="button small" onClick={() => add(type as Block['type'])}>
            <Plus size={12} />
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

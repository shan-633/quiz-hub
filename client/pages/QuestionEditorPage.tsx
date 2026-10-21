import { ResponsivePreview } from '../components/editor/ResponsivePreview';
import { removeBlank, syncScores } from '../../shared/editor';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Send,
  Smartphone,
  Tablet,
  Monitor,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
} from 'lucide-react';
import type { AnswerData, LibraryItem, Question } from '../../shared/model';
import { typeLabels } from '../../shared/model';
import { emptyAnswer, validateQuestion } from '../../shared/domain';
import { useLoad } from '../useLoad';
import { api, json, ApiError } from '../api';
import { useToast } from '../context';
import { Loading, ErrorState, Modal } from '../components/ui';
import { QuestionRenderer } from '../components/QuestionRenderer';
import { BlockEditor } from '../components/editor/BlockEditor';
export function QuestionEditorPage() {
  const { id } = useParams(),
    loaded = useLoad<Question>(`/teacher/questions/${id}`),
    banks = useLoad<LibraryItem[]>('/teacher/banks'),
    toast = useToast();
  const [editorView, setEditorView] = useState('edit'),
    [fullPreview, setFullPreview] = useState(false),
    [tagText, setTagText] = useState('');
  const [q, setQ] = useState<Question | null>(null),
    [tab, setTab] = useState('content'),
    [device, setDevice] = useState(390),
    [preview, setPreview] = useState<AnswerData>(emptyAnswer()),
    [busy, setBusy] = useState(''),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (loaded.data) {
      setQ(structuredClone(loaded.data));
      setTagText(loaded.data.tags.join('，'));
      setDirty(false);
    }
  }, [loaded.data]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  if (loaded.loading || (!q && !loaded.error)) return <Loading />;
  if (loaded.error || !q) return <ErrorState message={loaded.error} retry={loaded.reload} />;
  const patch = (next: Question) => {
    setQ(next);
    setDirty(true);
  };
  const save = async (publish = false) => {
    setBusy(publish ? 'publish' : 'save');
    setError('');
    try {
      let result = await api<Question>(`/teacher/questions/${q.id}`, {
        method: 'PUT',
        body: json(q),
      });
      if (publish)
        result = await api<Question>(`/teacher/questions/${q.id}/publish`, { method: 'POST' });
      setQ(result);
      setDirty(false);
      toast(publish ? '题目已发布，新练习将使用此版本' : '草稿已保存');
    } catch (e) {
      const err = e as ApiError;
      setError(err.body?.issues?.join('；') ?? err.message);
    } finally {
      setBusy('');
    }
  };
  const issues = validateQuestion(q);
  return (
    <div className="page editor-page">
      <Link className="back-link" to={`/teacher/library?tab=questions&bank=${q.bankId}`}>
        <ArrowLeft size={16} />
        返回题目列表
      </Link>
      <div className="editor-page-heading">
        <div>
          <div className="eyebrow">QUESTION EDITOR</div>
          <h1>{q.title || '录入新题目'}</h1>
          <p>
            {typeLabels[q.type]} · {q.version ? `当前发布版本 v${q.version}` : '尚未发布'}
            <span className={`status-tag status-${dirty ? 'draft' : q.state}`}>
              {dirty ? '未保存' : q.state === 'published' ? '已发布' : '草稿'}
            </span>
          </p>
        </div>
        <div className="editor-actions">
          <button className="button" disabled={!!busy} onClick={() => void save()}>
            <Save size={17} />
            {busy === 'save' ? '保存中…' : '保存草稿'}
          </button>
          <button className="button primary" disabled={!!busy} onClick={() => void save(true)}>
            <Send size={16} />
            {busy === 'publish' ? '发布中…' : '发布题目'}
          </button>
        </div>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="editor-mobile-tabs segmented">
        <button
          className={editorView === 'edit' ? 'active' : ''}
          onClick={() => setEditorView('edit')}
        >
          编辑题目
        </button>
        <button
          className={editorView === 'preview' ? 'active' : ''}
          onClick={() => setEditorView('preview')}
        >
          学生端预览
        </button>
      </div>
      <div className={`editor-layout ${editorView === 'preview' ? 'show-preview' : ''}`}>
        <div className="editing-pane">
          <section className="editor-metadata panel">
            <h2>基本信息</h2>
            <div className="form-grid">
              <label className="field span-2">
                题目标题
                <input
                  value={q.title}
                  onChange={(e) => patch({ ...q, title: e.target.value })}
                  placeholder="给这道题一个便于查找的标题"
                  maxLength={300}
                />
              </label>
              <label className="field">
                所属题库
                <select value={q.bankId} onChange={(e) => patch({ ...q, bankId: e.target.value })}>
                  {banks.data?.map((b) => (
                    <option value={b.id} key={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                总分
                <input
                  type="number"
                  min="1"
                  value={q.score}
                  onChange={(e) => patch({ ...q, score: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                难度
                <select
                  value={q.difficulty}
                  onChange={(e) => patch({ ...q, difficulty: e.target.value })}
                >
                  <option>基础</option>
                  <option>中等</option>
                  <option>提升</option>
                </select>
              </label>
              <label className="field">
                知识点（逗号分隔）
                <input
                  value={tagText}
                  onChange={(e) => {
                    setTagText(e.target.value);
                    patch({
                      ...q,
                      tags: e.target.value
                        .split(/[,，]/)
                        .map((t) => t.trim())
                        .filter(Boolean),
                    });
                  }}
                />
              </label>
              <label className="field span-2">
                题目来源
                <input
                  value={q.source ?? ''}
                  onChange={(e) => patch({ ...q, source: e.target.value })}
                  placeholder="例如：自编题 / 年份、地区与原题编号"
                />
              </label>
            </div>
            {(q.type === 'fill' || q.type === 'experiment' || q.type === 'reading') && (
              <div className="score-sync-row">
                <span>填空与子问题的分值应与总分一致。</span>
                <button className="text-button" onClick={() => patch(syncScores(q))}>
                  自动汇总分值
                </button>
              </div>
            )}
          </section>
          <section className="panel content-edit-panel">
            <div className="line-tabs">
              <button
                className={tab === 'content' ? 'active' : ''}
                onClick={() => setTab('content')}
              >
                题目内容
              </button>
              <button
                className={tab === 'solution' ? 'active' : ''}
                onClick={() => setTab('solution')}
              >
                答案与解析
              </button>
            </div>
            {tab === 'content' ? (
              <>
                <BlockEditor
                  blocks={q.content}
                  onChange={(content) => patch({ ...q, content })}
                  question={q}
                  onQuestionChange={patch}
                />
                {(q.type === 'single' || q.type === 'multiple') && (
                  <div className="options-editor">
                    <h3>选项与正确答案</h3>
                    <p className="muted small">点击选项前的控件设置正确答案。</p>
                    {q.type === 'multiple' && (
                      <label className="field">
                        多选评分规则
                        <select
                          value={q.multipleScoring ?? 'exact'}
                          onChange={(e) =>
                            patch({ ...q, multipleScoring: e.target.value as 'exact' | 'half' })
                          }
                        >
                          <option value="exact">全部正确才得分</option>
                          <option value="half">全对满分、漏选一半分、错选零分</option>
                        </select>
                      </label>
                    )}
                    {q.options.map((o, i) => (
                      <div className="option-edit-row" key={o.id}>
                        <input
                          aria-label={`设 ${String.fromCharCode(65 + i)} 为正确选项`}
                          type={q.type === 'single' ? 'radio' : 'checkbox'}
                          name="correct-options"
                          checked={q.solution!.choices.includes(o.id)}
                          onChange={() =>
                            patch({
                              ...q,
                              solution: {
                                ...q.solution!,
                                choices:
                                  q.type === 'single'
                                    ? [o.id]
                                    : q.solution!.choices.includes(o.id)
                                      ? q.solution!.choices.filter((id) => id !== o.id)
                                      : [...q.solution!.choices, o.id],
                              },
                            })
                          }
                        />
                        <span>{String.fromCharCode(65 + i)}</span>
                        <input
                          aria-label={`选项 ${String.fromCharCode(65 + i)}`}
                          value={o.text}
                          onChange={(e) =>
                            patch({
                              ...q,
                              options: q.options.map((x) =>
                                x.id === o.id ? { ...x, text: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <button
                          className="icon-button danger"
                          aria-label="删除选项"
                          onClick={() =>
                            patch({
                              ...q,
                              options: q.options.filter((x) => x.id !== o.id),
                              solution: {
                                ...q.solution!,
                                choices: q.solution!.choices.filter((id) => id !== o.id),
                              },
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="text-button"
                      onClick={() =>
                        patch({
                          ...q,
                          options: [...q.options, { id: crypto.randomUUID(), text: '' }],
                        })
                      }
                    >
                      <Plus size={15} />
                      添加选项
                    </button>
                  </div>
                )}
                <div className="editor-tip">
                  空格使用固定编号关联答案，移动内容不会改变对应关系。
                </div>
              </>
            ) : (
              <div className="solution-editor">
                {q.blanks.map((blank) => (
                  <div className="blank-settings" key={blank.id}>
                    <div className="blank-settings-heading">
                      <strong>{blank.label}</strong>
                      <button
                        className="text-button danger"
                        onClick={() => patch(removeBlank(q, blank.id))}
                      >
                        移除此空格
                      </button>
                    </div>
                    <div className="form-grid">
                      <label className="field">
                        空格名称
                        <input
                          value={blank.label}
                          onChange={(e) =>
                            patch({
                              ...q,
                              blanks: q.blanks.map((b) =>
                                b.id === blank.id ? { ...b, label: e.target.value } : b,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        分值
                        <input
                          type="number"
                          value={blank.score}
                          onChange={(e) =>
                            patch({
                              ...q,
                              blanks: q.blanks.map((b) =>
                                b.id === blank.id ? { ...b, score: Number(e.target.value) } : b,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        判题方式
                        <select
                          value={blank.kind}
                          onChange={(e) =>
                            patch({
                              ...q,
                              blanks: q.blanks.map((b) =>
                                b.id === blank.id ? { ...b, kind: e.target.value as any } : b,
                              ),
                            })
                          }
                        >
                          <option value="text">文字 / 同义答案</option>
                          <option value="number">数值 / 容差</option>
                          <option value="manual">人工评阅</option>
                        </select>
                      </label>
                      <label className="field">
                        单位
                        <input
                          value={blank.unit ?? ''}
                          onChange={(e) =>
                            patch({
                              ...q,
                              blanks: q.blanks.map((b) =>
                                b.id === blank.id ? { ...b, unit: e.target.value } : b,
                              ),
                            })
                          }
                        />
                      </label>
                      {blank.kind !== 'manual' && (
                        <label className="field span-2">
                          可接受答案（每行一个）
                          <textarea
                            rows={2}
                            value={q.solution!.blanks[blank.id]?.accepted.join('\n') ?? ''}
                            onChange={(e) =>
                              patch({
                                ...q,
                                solution: {
                                  ...q.solution!,
                                  blanks: {
                                    ...q.solution!.blanks,
                                    [blank.id]: {
                                      ...q.solution!.blanks[blank.id],
                                      accepted: e.target.value.split('\n'),
                                    },
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      )}
                      {blank.kind === 'number' && (
                        <label className="field">
                          允许误差
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={q.solution!.blanks[blank.id]?.tolerance ?? 0}
                            onChange={(e) =>
                              patch({
                                ...q,
                                solution: {
                                  ...q.solution!,
                                  blanks: {
                                    ...q.solution!.blanks,
                                    [blank.id]: {
                                      ...q.solution!.blanks[blank.id],
                                      tolerance: Number(e.target.value),
                                    },
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      )}
                    </div>
                    {blank.kind === 'text' && (
                      <label className="whitespace-option">
                        <input
                          type="checkbox"
                          checked={q.solution!.blanks[blank.id]?.ignoreWhitespace ?? false}
                          onChange={(e) =>
                            patch({
                              ...q,
                              solution: {
                                ...q.solution!,
                                blanks: {
                                  ...q.solution!.blanks,
                                  [blank.id]: {
                                    ...q.solution!.blanks[blank.id],
                                    ignoreWhitespace: e.target.checked,
                                  },
                                },
                              },
                            })
                          }
                        />
                        忽略答案中的空白字符
                      </label>
                    )}
                  </div>
                ))}
                {q.type === 'calculation' && (
                  <div className="allowed-modes">
                    <h3>允许的作答方式</h3>
                    {[
                      { id: 'text', text: '文字与公式' },
                      { id: 'drawing', text: '手写作答' },
                      { id: 'photo', text: '照片上传' },
                    ].map((mode) => (
                      <label key={mode.id}>
                        <input
                          type="checkbox"
                          checked={q.allowedModes?.includes(mode.id as any) ?? false}
                          onChange={(e) =>
                            patch({
                              ...q,
                              allowedModes: e.target.checked
                                ? [...(q.allowedModes ?? []), mode.id as any]
                                : q.allowedModes?.filter((m) => m !== mode.id),
                            })
                          }
                        />
                        {mode.text}
                      </label>
                    ))}
                  </div>
                )}
                <label className="field">
                  参考解析 / 计算过程
                  <textarea
                    rows={9}
                    value={q.solution!.explanation}
                    onChange={(e) =>
                      patch({ ...q, solution: { ...q.solution!, explanation: e.target.value } })
                    }
                    placeholder="支持 Markdown 与 $公式$；学生提交后才能查看。"
                  />
                </label>
              </div>
            )}
          </section>
        </div>
        <aside className="preview-pane">
          <div className="preview-header">
            <strong>学生端实时预览</strong>
            <div className="device-switch">
              {[
                { width: 390, Icon: Smartphone, label: '手机' },
                { width: 820, Icon: Tablet, label: 'iPad' },
                { width: 1440, Icon: Monitor, label: 'PC' },
              ].map(({ width, Icon, label }) => (
                <button
                  className={device === width ? 'active' : ''}
                  key={width}
                  title={label}
                  aria-label={`${label}预览`}
                  onClick={() => setDevice(width)}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
          <div className="preview-stage">
            <ResponsivePreview question={q} width={device} answer={preview} onChange={setPreview} />
          </div>
          <div className="preview-caption">
            题目区域 {device}px · 共用渲染器{' '}
            <button className="text-button" onClick={() => setFullPreview(true)}>
              放大预览
            </button>
          </div>
          <div className={`publish-check ${issues.length ? 'has-issues' : 'ready'}`}>
            <strong>
              {issues.length ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}发布前检查
              {issues.length ? ` · ${issues.length} 项` : ' · 已通过'}
            </strong>
            {issues.length ? (
              <ul>
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : (
              <p>内容与答案配置完整，可以发布。</p>
            )}
          </div>
        </aside>
      </div>
      {fullPreview && (
        <Modal title={`学生端预览 · ${device}px`} onClose={() => setFullPreview(false)} wide>
          <ResponsivePreview question={q} width={device} answer={preview} onChange={setPreview} />
        </Modal>
      )}
    </div>
  );
}

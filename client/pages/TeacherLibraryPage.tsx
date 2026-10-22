import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  BookOpen,
  FileText,
  NotebookPen,
  ArrowUpRight,
  Pencil,
  Search,
  Archive,
  Layers3,
  ArrowUp,
  ArrowDown,
  Upload,
} from 'lucide-react';
import type { LibraryItem, Question, QuestionType } from '../../shared/model';
import { typeLabels } from '../../shared/model';
import { questionTemplates } from '../../shared/questionTemplates';
import { useLoad } from '../useLoad';
import { api, json } from '../api';
import { useToast } from '../context';
import { Loading, ErrorState, EmptyState, Modal } from '../components/ui';
import { BankImportDialog } from '../components/BankImportDialog';
import { PushAssignment } from '../components/PushAssignment';
export function TeacherLibraryPage() {
  const [params, setParams] = useSearchParams(),
    tab = params.get('tab') ?? 'banks';
  const banks = useLoad<LibraryItem[]>('/teacher/banks'),
    papers = useLoad<LibraryItem[]>('/teacher/papers'),
    questions = useLoad<(Question & { latestVersion: number })[]>('/teacher/questions'),
    navigate = useNavigate(),
    toast = useToast();
  const [editing, setEditing] = useState<Partial<LibraryItem> | null>(null),
    [pushing, setPushing] = useState<LibraryItem | null>(null),
    [importing, setImporting] = useState(false),
    [adding, setAdding] = useState(false),
    [bankId, setBankId] = useState(''),
    [type, setType] = useState<QuestionType>('single'),
    [templateId, setTemplateId] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState('');
  const refresh = () => {
    banks.reload();
    papers.reload();
    questions.reload();
  };
  const addQuestion = async () => {
    if (!bankId) {
      toast('请先选择题库', true);
      return;
    }
    setBusy(true);
    try {
      const q = await api('/teacher/questions', {
        method: 'POST',
        body: json({ bankId, type, templateId: templateId || undefined }),
      });
      navigate(`/teacher/questions/${q.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const loading = banks.loading || papers.loading || questions.loading,
    error = banks.error || papers.error || questions.error;
  const filtered = (tab === 'papers' ? papers.data : banks.data)?.filter((x) =>
    `${x.title} ${x.chapter}`.includes(query),
  );
  return (
    <div className="page teacher-library-page">
      <div className="teacher-library-heading">
        <div>
          <div className="eyebrow">CONTENT STUDIO</div>
          <h1>好题目，从这里开始。</h1>
          <p>组织题库、编排试卷，让每道题都清楚地表达。</p>
        </div>
        <div className="teacher-heading-actions">
          <Link className="button" to="/teacher">
            <NotebookPen size={18} />
            收卷与批改
          </Link>
          <button className="button" onClick={() => setImporting(true)}>
            <Upload size={18} />
            导入题库
          </button>
          <button
            className="button primary"
            onClick={() => {
              if (tab === 'questions') {
                setBankId(
                  params.get('bank') ?? banks.data?.find((b) => b.state !== 'archived')?.id ?? '',
                );
                setAdding(true);
              } else
                setEditing({
                  kind: tab === 'papers' ? 'paper' : 'bank',
                  state: 'draft',
                  title: '',
                  description: '',
                  chapter: '八年级 · 力学',
                  accent: tab === 'papers' ? 'exam' : 'mechanics',
                  minutes: 30,
                  items: [],
                });
            }}
          >
            <Plus size={18} />
            {tab === 'questions' ? '录入题目' : tab === 'papers' ? '创建试卷' : '创建题库'}
          </button>
        </div>
      </div>
      <div className="teacher-tabs">
        <div className="line-tabs">
          {[
            { id: 'banks', text: '题库管理', Icon: BookOpen, count: banks.data?.length },
            { id: 'papers', text: '试卷管理', Icon: FileText, count: papers.data?.length },
            { id: 'questions', text: '题目管理', Icon: NotebookPen, count: questions.data?.length },
          ].map(({ id, text, Icon, count }) => (
            <button
              className={tab === id ? 'active' : ''}
              key={id}
              onClick={() => setParams({ tab: id })}
            >
              <Icon size={17} />
              {text}
              <span>{count ?? '—'}</span>
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="搜索管理内容"
            placeholder="搜索名称或知识点"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={refresh} />
      ) : tab === 'questions' ? (
        <>
          <div className="teacher-filter">
            <label>
              所属题库
              <select
                aria-label="按题库筛选题目"
                value={params.get('bank') ?? ''}
                onChange={(e) =>
                  setParams({
                    tab: 'questions',
                    ...(e.target.value ? { bank: e.target.value } : {}),
                  })
                }
              >
                <option value="">全部题库</option>
                {banks.data?.map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted small">发布题目的修改会生成新版本，历史作答保持原样。</span>
          </div>
          <div className="teacher-table-scroll">
            <table className="teacher-table">
              <thead>
                <tr>
                  <th>题目</th>
                  <th>所属题库</th>
                  <th>题型 / 分值</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {questions.data
                  ?.filter(
                    (q) =>
                      (!params.get('bank') || q.bankId === params.get('bank')) &&
                      `${q.title} ${q.tags.join(' ')}`.includes(query),
                  )
                  .map((q) => (
                    <tr key={q.id}>
                      <td>
                        <strong>{q.title || '未命名题目'}</strong>
                        <small>{q.tags.join(' · ') || '尚未设置知识点'}</small>
                      </td>
                      <td>{banks.data?.find((b) => b.id === q.bankId)?.title ?? '—'}</td>
                      <td>
                        {typeLabels[q.type]}
                        <small>{q.score} 分</small>
                      </td>
                      <td>
                        <span className={`status-tag status-${q.state}`}>
                          {q.state === 'published'
                            ? `已发布 v${q.version}`
                            : q.state === 'archived'
                              ? '已归档'
                              : '草稿'}
                        </span>
                      </td>
                      <td>
                        <Link className="text-button" to={`/teacher/questions/${q.id}`}>
                          <Pencil size={15} />
                          编辑
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!questions.data?.length && (
            <EmptyState
              title="第一道题，从这里开始"
              description="选择题库与题型，使用内容块编辑题干。"
            />
          )}
        </>
      ) : (
        <div className="teacher-library-grid">
          {filtered?.map((item) => (
            <article className="teacher-library-card" key={item.id}>
              <div className="teacher-card-top">
                <span className={`teacher-card-icon accent-${item.accent}`}>
                  {item.kind === 'paper' ? <FileText /> : <BookOpen />}
                </span>
                <span className={`status-tag status-${item.state}`}>
                  {item.state === 'published'
                    ? '已发布'
                    : item.state === 'archived'
                      ? '已归档'
                      : '草稿'}
                </span>
              </div>
              <span className="card-chapter">{item.chapter}</span>
              <h2>{item.title}</h2>
              <p>{item.description || '还没有添加简介'}</p>
              <div className="teacher-card-meta">
                <span>
                  <Layers3 size={15} />
                  {item.questionCount} 道题
                </span>
                <span>{item.totalScore} 分</span>
              </div>
              <div className="teacher-card-actions">
                {item.state === 'published' && (
                  <button className="text-button" onClick={() => setPushing(item)}>
                    推送班级
                  </button>
                )}
                <button className="text-button" onClick={() => setEditing(item)}>
                  <Pencil size={15} />
                  {item.kind === 'paper' ? '编排与设置' : '编辑题库'}
                </button>
                {item.kind === 'bank' && (
                  <button
                    className="text-button"
                    onClick={() => setParams({ tab: 'questions', bank: item.id })}
                  >
                    管理题目
                    <ArrowUpRight size={17} />
                  </button>
                )}
              </div>
            </article>
          ))}
          {!filtered?.length && (
            <EmptyState title="这里还没有内容" description="点击右上角按钮，创建你的第一份内容。" />
          )}
        </div>
      )}
      {importing && (
        <BankImportDialog onClose={() => setImporting(false)} onImported={() => refresh()} />
      )}
      {pushing && (
        <PushAssignment item={pushing} onClose={() => setPushing(null)} onSent={() => {}} />
      )}
      {adding && (
        <Modal title="录入一道新题" onClose={() => setAdding(false)}>
          <div className="form-grid">
            <label className="field">
              所属题库
              <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.data
                  ?.filter((b) => b.state !== 'archived')
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              题型
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as QuestionType);
                  setTemplateId('');
                }}
              >
                {Object.entries(typeLabels).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {questionTemplates.some((t) => t.type === type) && (
              <label className="field span-2">
                可复用模板
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">基础模板</option>
                  {questionTemplates
                    .filter((t) => t.type === type)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
                <span className="muted small">
                  {questionTemplates.find((t) => t.id === templateId)?.description ??
                    '按题型创建基础草稿。'}
                </span>
              </label>
            )}
          </div>
          <p className="muted">
            创建后可以添加文字、图片、公式和子问题，并实时预览学生看到的页面。
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setAdding(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy || !bankId}
              onClick={() => void addQuestion()}
            >
              {busy ? '正在创建…' : '开始编辑'}
              <ArrowUpRight size={17} />
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <LibraryEditor
          item={editing}
          questions={questions.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
function LibraryEditor({
  item,
  questions,
  onClose,
  onSaved,
}: {
  item: Partial<LibraryItem>;
  questions: (Question & { latestVersion: number })[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(item),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const toast = useToast();
  const paper = value.kind === 'paper',
    items = value.items ?? [];
  const move = (index: number, delta: number) => {
    const next = [...items];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    patch({ items: next });
  };
  const patch = (data: Partial<LibraryItem>) => setValue((v) => ({ ...v, ...data }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/teacher/${paper ? 'papers' : 'banks'}${value.id ? `/${value.id}` : ''}`, {
        method: value.id ? 'PUT' : 'POST',
        body: json(value),
      });
      toast('已保存');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${item.id ? '编辑' : '创建'}${paper ? '试卷' : '题库'}`}
      onClose={onClose}
      wide={paper}
    >
      <div className="form-grid">
        <label className="field">
          名称
          <input
            value={value.title ?? ''}
            onChange={(e) => patch({ title: e.target.value })}
            maxLength={200}
          />
        </label>
        <label className="field">
          学段与专题
          <input value={value.chapter ?? ''} onChange={(e) => patch({ chapter: e.target.value })} />
        </label>
        <label className="field span-2">
          简介
          <textarea
            rows={2}
            value={value.description ?? ''}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <label className="field">
          预计时长（分钟）
          <input
            type="number"
            min="1"
            max="600"
            value={value.minutes}
            onChange={(e) => patch({ minutes: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          答题时限（分钟，可留空）
          <input
            type="number"
            min="1"
            max="600"
            placeholder="不限时"
            value={value.timeLimitMinutes ?? ''}
            onChange={(e) =>
              patch({
                timeLimitMinutes: e.target.value ? Number(e.target.value) : undefined,
                ...(e.target.value ? {} : { enforceTimeLimit: false }),
              })
            }
          />
        </label>
        <label className="assignment-toggle span-2">
          <input
            type="checkbox"
            disabled={!value.timeLimitMinutes}
            checked={!!value.enforceTimeLimit}
            onChange={(e) => patch({ enforceTimeLimit: e.target.checked })}
          />
          到时强制交卷
        </label>
        <p className="muted small span-2">
          答题时限从首次开始计算。预计时长只作建议；推送班级时可以另设截止时间和本次时限。
        </p>
        <label className="field">
          状态
          <select
            value={value.state}
            onChange={(e) => patch({ state: e.target.value as LibraryItem['state'] })}
          >
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="archived">已归档</option>
          </select>
        </label>
        <label className="field">
          封面主题
          <select value={value.accent} onChange={(e) => patch({ accent: e.target.value })}>
            <option value="mechanics">力与运动</option>
            <option value="electric">电路</option>
            <option value="buoyancy">浮力</option>
            <option value="exam">实验与综合</option>
          </select>
        </label>
      </div>
      {paper && (
        <section className="paper-picker">
          <h3>
            选择试题 <span className="count-badge">{items.length}</span>
          </h3>
          <p className="muted small">试卷固定引用发布版本，题库后续修改不会改变当前试卷。</p>
          <div className="selected-paper-items">
            {items.map((item, index) => (
              <div key={item.questionId}>
                <span className="paper-order">{index + 1}</span>
                <span>
                  {questions.find((q) => q.id === item.questionId)?.title ?? item.questionId}
                  <small>v{item.version}</small>
                </span>
                <label>
                  分值
                  <input
                    aria-label={`第 ${index + 1} 题分值`}
                    type="number"
                    min="1"
                    value={item.score}
                    onChange={(e) =>
                      patch({
                        items: items.map((v, i) =>
                          i === index ? { ...v, score: Number(e.target.value) } : v,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label={`上移试卷第 ${index + 1} 题`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`下移试卷第 ${index + 1} 题`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            ))}
          </div>
          {questions
            .filter((q) => q.latestVersion > 0)
            .map((q) => (
              <label className="paper-picker-row" key={q.id}>
                <input
                  type="checkbox"
                  checked={items.some((i) => i.questionId === q.id)}
                  onChange={(e) =>
                    patch({
                      items: e.target.checked
                        ? [...items, { questionId: q.id, version: q.latestVersion, score: q.score }]
                        : items.filter((i) => i.questionId !== q.id),
                    })
                  }
                />
                <span>
                  {q.title}
                  <small>
                    {typeLabels[q.type]} · v{q.latestVersion}
                  </small>
                </span>
                <span>{q.score} 分</span>
              </label>
            ))}
        </section>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={busy || !value.title?.trim()}
          onClick={() => void save()}
        >
          {busy ? '正在保存…' : '保存设置'}
        </button>
      </div>
    </Modal>
  );
}

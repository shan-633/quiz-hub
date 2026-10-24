import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Search,
  Clock3,
  Layers3,
  FileText,
  ArrowUpRight,
  BookOpen,
  Check,
  MoveRight,
  Printer,
} from 'lucide-react';
import type { LibraryItem } from '../../shared/model';
import { curriculumOf } from '../../shared/curriculum';
import { useLoad } from '../useLoad';
import { api, json } from '../api';
import { useAuth, useToast } from '../context';
import { useChat } from '../chatContext';
import { Loading, ErrorState, EmptyState, formatDate } from '../components/ui';
import { isBeforeOpening } from '../../shared/availability';
import { useOpeningClock } from '../useOpeningClock';
import { useCardAnchor } from '../useCardAnchor';
import { useDirections, CurriculumTag } from '../directions';
import { PrintPdfDialog } from '../components/PrintPdfDialog';
const diagram: Record<string, string> = {
  mechanics: 'cart',
  electric: 'circuit',
  buoyancy: 'buoyancy',
  exam: 'friction',
};
export function HomePage() {
  const { matches } = useDirections();
  const { contacts, status } = useChat();
  const teacherKey = contacts
    .filter((p) => p.role === 'teacher')
    .map((p) => p.id)
    .sort()
    .join(',');
  const { data, loading, error, reload } = useLoad<LibraryItem[]>('/library'),
    { user } = useAuth(),
    toast = useToast(),
    navigate = useNavigate(),
    location = useLocation();
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [chapter, setChapter] = useState('all'),
    [busy, setBusy] = useState(''),
    [recents, setRecents] = useState<any[]>([]),
    [printing, setPrinting] = useState<LibraryItem | null>(null);
  const [params, setParams] = useSearchParams();
  const now = useOpeningClock((data ?? []).map((item) => item.opensAt));
  const locked = (item: LibraryItem) =>
    user?.role === 'student' && isBeforeOpening(item.opensAt, now);
  useCardAnchor(!!data);
  useEffect(() => {
    if (user?.role === 'student') reload();
  }, [teacherKey]);
  useEffect(() => {
    const id = params.get('print'),
      item = data?.find((x) => x.id === id);
    if (item) {
      if (!locked(item)) setPrinting(item);
      const next = new URLSearchParams(params);
      next.delete('print');
      setParams(next, { replace: true });
    }
  }, [data, params, setParams]);
  useEffect(() => {
    let alive = true;
    if (user)
      api<any[]>('/attempts')
        .then((items) => {
          if (alive)
            setRecents(items.filter((a) => a.status === 'active' && a.available !== false));
        })
        .catch(() => {});
    else setRecents([]);
    return () => {
      alive = false;
    };
  }, [user?.id, teacherKey]);
  const start = async (item: LibraryItem) => {
    if (!user) {
      navigate(`/login?library=${item.id}`);
      return;
    }
    setBusy(item.id);
    try {
      const a = await api('/attempts', { method: 'POST', body: json({ libraryId: item.id }) });
      navigate(`/attempts/${a.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy('');
    }
  };
  const recent = recents.find(matches);
  const chapters = [
    ...new Set(
      (data ?? [])
        .filter(matches)
        .map((item) => item.chapter)
        .filter(Boolean),
    ),
  ];
  const currentChapter = chapters.includes(chapter) ? chapter : 'all';
  const items = (data ?? []).filter(
    (item) =>
      matches(item) &&
      item.deliveryMode !== 'assigned' &&
      (filter === 'all' || item.kind === filter) &&
      (currentChapter === 'all' || item.chapter === currentChapter) &&
      `${item.title} ${item.description} ${item.chapter}`.includes(query),
  );
  return (
    <div className="page home-page">
      <section className="home-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-line" /> LEARNING SPACE
          </div>
          <h1>
            {location.pathname === '/library' ? (
              '找到下一份值得思考的练习。'
            ) : (
              <>
                把每一道题，
                <br className="mobile-break" />
                真正弄懂<span className="teal">。</span>
              </>
            )}
          </h1>
          <p>从理解一个概念，到写清一段过程。按自己的节奏，向前一步。</p>
        </div>
        <div className="heading-note">
          <span className="note-equation">知行有序</span>
          <span>跨越学段，让每次学习都有方向</span>
        </div>
      </section>
      {user?.role === 'student' && (
        <Link to="/tasks" className="assignment-home-link">
          查看班级任务 <span>老师推送的练习与截止安排 →</span>
        </Link>
      )}
      {recent && data?.some((item) => item.id === recent.libraryId) ? (
        <Link to={`/attempts/${recent.id}`} className="continue-card">
          <span className="continue-icon">
            <BookOpen size={27} />
          </span>
          <div className="continue-copy">
            <span className="eyebrow">继续上次练习</span>
            <h2>{recent.title}</h2>
            <p>
              已保存 {recent.answeredCount} / {recent.questionCount} 题，接着上次的思路。
            </p>
          </div>
          <div className="continue-progress">
            <div className="mini-progress">
              <span style={{ width: `${(recent.answeredCount / recent.questionCount) * 100}%` }} />
            </div>
            <span>{Math.round((recent.answeredCount / recent.questionCount) * 100)}%</span>
          </div>
          <span className="button primary">
            继续作答
            <ArrowRight size={18} />
          </span>
        </Link>
      ) : (
        <div className="welcome-strip">
          <span className="welcome-symbol">✳</span>
          <div>
            <strong>今天，从一个好问题开始。</strong>
            <span>选一份练习，让理解再深一点。</span>
          </div>
          <span className="welcome-end">
            READY WHEN YOU ARE <MoveRight size={20} />
          </span>
        </div>
      )}
      <section className="catalog-section" aria-label="试卷与题库">
        <div className="section-heading">
          <div>
            <h2>
              你的下一次探索<span className="count-badge">{data ? items.length : '—'}</span>
            </h2>
            <p>按专题练习，或用一份试卷检验理解。</p>
          </div>
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="搜索试卷或题库"
              placeholder="搜索试卷、题库或知识点"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="清空搜索" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </div>
        </div>
        <div className="catalog-toolbar">
          <div className="segmented" aria-label="内容类型">
            {[
              { id: 'all', text: '全部', Icon: Layers3 },
              { id: 'bank', text: '题库', Icon: BookOpen },
              { id: 'paper', text: '试卷', Icon: FileText },
            ].map(({ id, text, Icon }) => (
              <button
                key={id}
                className={filter === id ? 'active' : ''}
                onClick={() => setFilter(id)}
                aria-pressed={filter === id}
              >
                <Icon size={16} />
                {text}
              </button>
            ))}
          </div>
          <label className="chapter-filter">
            <span>年级 / 专题</span>
            <select
              aria-label="筛选年级专题"
              value={currentChapter}
              onChange={(e) => setChapter(e.target.value)}
            >
              <option value="all">全部专题</option>
              {chapters.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} retry={reload} />
        ) : !items.length ? (
          <EmptyState
            title={!data?.length ? '暂时没有可用练习' : '还没有匹配的练习'}
            description={
              !data?.length
                ? user?.role === 'student' && status === 'live' && !contacts.length
                  ? '请等待管理员分配教师；关联后可查看展示练习，并接收老师推送的班级任务。'
                  : '所属教师暂未发布展示练习；收到的分配内容请到班级任务查看。'
                : !data?.some((item) => item.deliveryMode !== 'assigned')
                  ? '这里只显示展示练习，分配内容请到班级任务查看。'
                  : '换一个关键词，或清除筛选条件。'
            }
          >
            <button
              className="button"
              onClick={() => {
                setQuery('');
                setFilter('all');
                setChapter('all');
              }}
            >
              清除筛选
            </button>
          </EmptyState>
        ) : (
          <div className="library-grid">
            {items.map((item) => (
              <article
                key={item.id}
                id={`library-${item.id}`}
                tabIndex={-1}
                className={`library-card accent-${item.accent}`}
              >
                <div className="card-art">
                  <span className="card-kind">
                    {item.kind === 'paper' ? <FileText size={14} /> : <Layers3 size={14} />}{' '}
                    {item.kind === 'paper' ? '专题试卷' : '专题题库'}
                  </span>
                  {curriculumOf(item).subject === '物理' ? (
                    <img src={`/diagrams/${diagram[item.accent] ?? 'cart'}.svg`} alt="" />
                  ) : (
                    <div className="generic-card-art">
                      <BookOpen size={48} strokeWidth={1.2} />
                      <span>{curriculumOf(item).subject}</span>
                    </div>
                  )}
                  <span className="art-index">{item.kind === 'paper' ? 'PAPER' : 'PRACTICE'}</span>
                </div>
                <div className="card-body">
                  <div className="card-chapter">{item.chapter}</div>
                  <span className="mode-badge mode-showcase">展示练习 · 答后自评</span>
                  <h3>{item.title}</h3>
                  <CurriculumTag item={item} />
                  <p className="card-description">{item.description}</p>
                  <div className="card-metadata">
                    <span>
                      <Layers3 size={14} />
                      {item.questionCount} 道题
                    </span>
                    <span>
                      <Clock3 size={14} />
                      {item.minutes} 分钟
                    </span>
                    <span>{item.totalScore} 分</span>
                  </div>
                  {item.opensAt && (
                    <p className="opening-hint">
                      {isBeforeOpening(item.opensAt, now) ? '开放时间' : '已开放'} ·{' '}
                      {formatDate(item.opensAt)}
                    </p>
                  )}
                  <div className="card-actions">
                    <button
                      className="card-start"
                      onClick={() => void start(item)}
                      disabled={!!busy || locked(item)}
                    >
                      <span>
                        {locked(item) ? '尚未开放' : busy === item.id ? '正在准备…' : '开始练习'}
                      </span>
                      <ArrowUpRight size={20} />
                    </button>
                    <button
                      className="card-print"
                      disabled={!item.questionCount || locked(item)}
                      onClick={() => setPrinting(item)}
                    >
                      <Printer size={16} />
                      打印 PDF
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <div className="home-bottom-note">
        <Check size={16} />
        <span>每道题都值得留下完整的思考过程。</span>
        <span className="sample-note">内容来源见各试卷说明 · 可在后台管理题目</span>
      </div>
      {printing && (
        <PrintPdfDialog key={printing.id} item={printing} onClose={() => setPrinting(null)} />
      )}
    </div>
  );
}

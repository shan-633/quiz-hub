import { useState, lazy, Suspense } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  Navigate,
  useLocation,
} from 'react-router-dom';
import {
  House,
  BookOpen,
  NotebookPen,
  Settings2,
  LogOut,
  ArrowUpRight,
  HelpCircle,
  Atom,
} from 'lucide-react';
import { AuthProvider, ToastProvider, useAuth, useToast } from './context';
import { Loading, Modal } from './components/ui';
import { HomePage } from './pages/HomePage';
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const AttemptPage = lazy(() =>
  import('./pages/AttemptPage').then((m) => ({ default: m.AttemptPage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
);
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const QuestionEditorPage = lazy(() =>
  import('./pages/QuestionEditorPage').then((m) => ({ default: m.QuestionEditorPage })),
);
function Protected({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth(),
    location = useLocation();
  if (loading) return <Loading />;
  if (!user || (admin && user.role !== 'admin'))
    return (
      <Navigate
        to={`/login${admin ? '?admin=1' : ''}`}
        state={{ from: location.pathname }}
        replace
      />
    );
  return children;
}
function Shell() {
  const { user, logout } = useAuth(),
    toast = useToast();
  const [help, setHelp] = useState(false);
  const location = useLocation(),
    admin = location.pathname.startsWith('/admin');
  const links = [
    { to: '/', icon: House, label: '学习首页' },
    { to: '/library', icon: BookOpen, label: '试卷与题库' },
    { to: '/history', icon: NotebookPen, label: '我的作答' },
  ];
  return (
    <div className={`app-shell ${admin ? 'admin-shell' : ''}`}>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Atom size={25} strokeWidth={1.6} />
          </span>
          <span>
            <strong>
              知序<span className="brand-dot">.</span>
            </strong>
            <small>{admin ? '管理工作台' : '物理练习'}</small>
          </span>
        </Link>
        <div className="nav-section-label">{admin ? '内容管理' : '学习空间'}</div>
        <nav aria-label="主要导航">
          {admin ? (
            <>
              <Link
                to="/admin"
                className={
                  location.pathname === '/admin' && !location.search.includes('tab=questions')
                    ? 'active'
                    : ''
                }
              >
                <BookOpen size={19} />
                题库与试卷
              </Link>
              <Link
                to="/admin?tab=questions"
                className={
                  location.search.includes('tab=questions') ||
                  location.pathname.includes('/admin/questions/')
                    ? 'active'
                    : ''
                }
              >
                <NotebookPen size={19} />
                题目录入
              </Link>
            </>
          ) : (
            links.map(({ to, icon: Icon, label }) => (
              <NavLink to={to} end key={to}>
                <Icon size={19} />
                {label}
              </NavLink>
            ))
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            <span>使用指南</span>
            <ArrowUpRight size={14} />
          </button>
          <Link className="admin-entry" to={admin ? '/' : '/admin'}>
            <Settings2 size={17} />
            {admin ? '返回学习空间' : '管理后台'}
            <ArrowUpRight size={14} />
          </Link>
          {user ? (
            <div className="user-card">
              <span className="avatar">{user.name.slice(-1)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.role === 'admin' ? '管理员' : '保持好奇，继续探索'}</small>
              </span>
              <button
                className="icon-button"
                aria-label="退出登录"
                onClick={() => void logout().catch((e) => toast(e.message, true))}
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <Link className="button sidebar-login" to="/login">
              登录学习空间
              <ArrowUpRight size={17} />
            </Link>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Link to="/" className="mobile-brand">
            <Atom size={22} />
            知序
          </Link>
          <span className="breadcrumb">
            {admin ? '内容管理工作台' : '学习空间'} <span>/</span>{' '}
            {admin ? '题库与题目' : '物理 · 自主练习'}
          </span>
          <div className="topbar-right">
            <span className="term-label">每一步，都有收获</span>
            <span className="subject-badge">
              <span />
              初中物理
            </span>
          </div>
        </header>
        <main id="main">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/library" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/history"
                element={
                  <Protected>
                    <HistoryPage />
                  </Protected>
                }
              />
              <Route
                path="/attempts/:id"
                element={
                  <Protected>
                    <AttemptPage />
                  </Protected>
                }
              />
              <Route
                path="/admin"
                element={
                  <Protected admin>
                    <AdminPage />
                  </Protected>
                }
              />
              <Route
                path="/admin/questions/:id"
                element={
                  <Protected admin>
                    <QuestionEditorPage />
                  </Protected>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="site-footer">
          <span>知序 · 让思考留下痕迹</span>
          <span>文字 · 手写 · 照片</span>
        </footer>
      </div>
      {!admin && (
        <nav className="mobile-nav" aria-label="手机导航">
          {links.map(({ to, icon: Icon, label }) => (
            <NavLink to={to} end key={to}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
          <NavLink to="/admin">
            <Settings2 size={20} />
            <span>管理后台</span>
          </NavLink>
        </nav>
      )}
      {help && (
        <Modal title="让每种思路，都有合适的表达方式" onClose={() => setHelp(false)}>
          <div className="help-content">
            <p>先从首页选择试卷或题库。练习会保存进度，可以随时回来继续。</p>
            <ol>
              <li>选择题点击选项，多选题可勾选多个答案。</li>
              <li>填空题与实验题直接填写题干中的空格；单位已给出时只填写数值。</li>
              <li>计算题可以输入文字与公式，也可以手写或上传纸面答案。</li>
              <li>查看页面保存状态，完成后提交；主观题保留原始过程并标记待评阅。</li>
            </ol>
            <p className="muted">本地演示数据为自编示例。iPad 手写建议使用触控笔。</p>
            <button className="button primary" onClick={() => setHelp(false)}>
              开始探索
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

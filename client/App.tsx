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
  MessageCircle,
  ShieldCheck,
  Users,
  ClipboardList,
} from 'lucide-react';
import { AuthProvider, ToastProvider, useAuth, useToast } from './context';
import { Loading, Modal } from './components/ui';
import { HomePage } from './pages/HomePage';
import { StudentHomePage } from './pages/StudentHomePage';
import './teacher.css';
import './community.css';
import { DirectionsProvider, DirectionBar } from './directions';
const DirectionsPage = lazy(() =>
  import('./pages/DirectionsPage').then((m) => ({ default: m.DirectionsPage })),
);
import './assignments.css';
import { ChatProvider, useChat } from './chatContext';
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const TeacherStudentsPage = lazy(() =>
  import('./pages/TeacherStudentsPage').then((m) => ({ default: m.TeacherStudentsPage })),
);
const TasksPage = lazy(() => import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })));
const SelfReviewPage = lazy(() =>
  import('./pages/SelfReviewPage').then((m) => ({ default: m.SelfReviewPage })),
);
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const PasswordPage = lazy(() =>
  import('./pages/PasswordPage').then((m) => ({ default: m.PasswordPage })),
);
const TeacherInboxPage = lazy(() =>
  import('./pages/TeacherInboxPage').then((m) => ({ default: m.TeacherInboxPage })),
);
const TeacherReviewPage = lazy(() =>
  import('./pages/TeacherReviewPage').then((m) => ({ default: m.TeacherReviewPage })),
);
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const AttemptPage = lazy(() =>
  import('./pages/AttemptPage').then((m) => ({ default: m.AttemptPage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
);
const TeacherLibraryPage = lazy(() =>
  import('./pages/TeacherLibraryPage').then((m) => ({ default: m.TeacherLibraryPage })),
);
const QuestionEditorPage = lazy(() =>
  import('./pages/QuestionEditorPage').then((m) => ({ default: m.QuestionEditorPage })),
);
function Protected({
  children,
  teacher = false,
  admin = false,
  allowPassword = false,
}: {
  children: React.ReactNode;
  teacher?: boolean;
  admin?: boolean;
  allowPassword?: boolean;
}) {
  const { user, loading } = useAuth(),
    location = useLocation();
  if (loading) return <Loading />;
  if (!user)
    return (
      <Navigate
        to={`/login${teacher ? '?teacher=1' : ''}`}
        state={{ from: location.pathname }}
        replace
      />
    );
  if (user.mustChangePassword && !allowPassword) return <Navigate to="/account/password" replace />;
  if ((teacher && user.role !== 'teacher') || (admin && user.role !== 'admin'))
    return (
      <Navigate
        to={user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/'}
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
    teacher =
      location.pathname.startsWith('/teacher') ||
      (location.pathname === '/chat' && user?.role === 'teacher'),
    admin = user?.role === 'admin',
    chat = useChat(),
    unread = chat.conversations.reduce((n, c) => n + c.unread, 0);
  const links = [
    { to: '/', icon: House, label: '学习首页' },
    { to: '/library', icon: BookOpen, label: '试卷与题库' },
    { to: '/tasks', icon: ClipboardList, label: '班级任务' },
    { to: '/history', icon: NotebookPen, label: '我的作答' },
  ];
  return (
    <div className={`app-shell ${teacher || admin ? 'staff-shell' : ''}`}>
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
            <small>{admin ? '账号管理' : teacher ? '教师工作台' : '考试学习空间'}</small>
          </span>
        </Link>
        <div className="nav-section-label">
          {admin ? '系统管理' : teacher ? '教学工作台' : '学习空间'}
        </div>
        <nav aria-label="主要导航">
          {admin ? (
            <NavLink to="/admin">
              <ShieldCheck size={19} />
              账号与师生关系
            </NavLink>
          ) : teacher ? (
            <>
              <NavLink to="/teacher" end>
                <NotebookPen size={19} />
                收卷与批改
              </NavLink>
              <NavLink to="/teacher/students">
                <Users size={19} />
                管理学生
              </NavLink>
              <Link
                to="/teacher/library"
                className={
                  location.pathname === '/teacher/library' &&
                  !location.search.includes('tab=questions')
                    ? 'active'
                    : ''
                }
              >
                <BookOpen size={19} />
                题库与试卷
              </Link>
              <Link
                to="/teacher/library?tab=questions"
                className={
                  location.search.includes('tab=questions') ||
                  location.pathname.includes('/teacher/questions/')
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
          {user && !admin && (
            <NavLink to="/chat">
              <MessageCircle size={19} />
              站内消息
              {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            <span>使用指南</span>
            <ArrowUpRight size={14} />
          </button>
          <Link className="workspace-entry" to={admin ? '/admin' : teacher ? '/' : '/teacher'}>
            <Settings2 size={17} />
            {admin ? '管理员工作台' : teacher ? '返回学习空间' : '教师工作台'}
            <ArrowUpRight size={14} />
          </Link>
          {user ? (
            <div className="user-card">
              <span className="avatar">{user.name.slice(-1)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>
                  {user.role === 'admin' ? '管理员' : user.role === 'teacher' ? '教师' : '学生'}
                </small>
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
            {admin ? '管理员工作台' : teacher ? '教师工作台' : '学习空间'} <span>/</span>{' '}
            {admin
              ? '账号与师生关系'
              : location.pathname === '/chat'
                ? '站内消息'
                : teacher
                  ? location.pathname === '/teacher'
                    ? '收卷与批改'
                    : location.pathname === '/teacher/students'
                      ? '管理学生'
                      : '题库与题目'
                  : '多考试 · 自主练习'}
          </span>
          <div className="topbar-right">
            {user && (
              <div className="community-nav">
                <Link className="text-button" to="/account/password">
                  修改密码
                </Link>
                {!admin && (
                  <Link className="text-button" to="/chat">
                    <MessageCircle size={15} />
                    消息{unread > 0 && <span className="unread-badge">{unread}</span>}
                  </Link>
                )}
              </div>
            )}
            <span className="term-label">每一步，都有收获</span>
            <span className="subject-badge">
              <span />
              多学段 · 多学科
            </span>
          </div>
        </header>
        <main id="main">
          <DirectionBar />
          {user && (
            <div className="community-mobile-links">
              <Link to={admin ? '/admin' : user.role === 'teacher' ? '/teacher' : '/'}>
                {admin ? '管理员工作台' : user.role === 'teacher' ? '教师工作台' : '学习首页'}
              </Link>
              {!admin && <Link to="/chat">站内消息{unread > 0 ? `（${unread}）` : ''}</Link>}
              {!admin && (
                <Link to={user.role === 'teacher' ? '/teacher/students' : '/tasks'}>
                  {user.role === 'teacher' ? '管理学生' : '班级任务'}
                </Link>
              )}
              <Link to="/account/password">修改密码</Link>
              <button onClick={() => void logout().catch((e) => toast(e.message, true))}>
                退出登录
              </button>
            </div>
          )}
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route
                path="/"
                element={
                  <Protected>
                    {admin ? (
                      <Navigate to="/admin" replace />
                    ) : user?.role === 'student' ? (
                      <StudentHomePage />
                    ) : (
                      <HomePage />
                    )}
                  </Protected>
                }
              />
              <Route
                path="/library"
                element={
                  <Protected>{admin ? <Navigate to="/admin" replace /> : <HomePage />}</Protected>
                }
              />
              <Route
                path="/account/directions"
                element={
                  <Protected>
                    <DirectionsPage />
                  </Protected>
                }
              />
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/admin"
                element={
                  <Protected admin>
                    <AdminPage />
                  </Protected>
                }
              />
              <Route
                path="/chat"
                element={
                  <Protected>{admin ? <Navigate to="/admin" replace /> : <ChatPage />}</Protected>
                }
              />
              <Route
                path="/account/password"
                element={
                  <Protected allowPassword>
                    <PasswordPage />
                  </Protected>
                }
              />
              <Route
                path="/teacher"
                element={
                  <Protected teacher>
                    <TeacherInboxPage />
                  </Protected>
                }
              />
              <Route
                path="/teacher/students"
                element={
                  <Protected teacher>
                    <TeacherStudentsPage />
                  </Protected>
                }
              />
              <Route
                path="/tasks"
                element={
                  <Protected>
                    {user?.role === 'student' ? (
                      <TasksPage />
                    ) : (
                      <Navigate to={admin ? '/admin' : '/teacher/students'} replace />
                    )}
                  </Protected>
                }
              />
              <Route
                path="/teacher/attempts/:id"
                element={
                  <Protected teacher>
                    <TeacherReviewPage />
                  </Protected>
                }
              />
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
                path="/attempts/:id/self-review"
                element={
                  <Protected>
                    <SelfReviewPage />
                  </Protected>
                }
              />
              <Route
                path="/teacher/library"
                element={
                  <Protected teacher>
                    <TeacherLibraryPage />
                  </Protected>
                }
              />
              <Route
                path="/teacher/questions/:id"
                element={
                  <Protected teacher>
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
      {!teacher && !admin && (
        <nav className="mobile-nav" aria-label="手机导航">
          {links.map(({ to, icon: Icon, label }) => (
            <NavLink to={to} end key={to}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
          <NavLink to="/teacher">
            <Settings2 size={20} />
            <span>教师端</span>
          </NavLink>
          {user && !admin && (
            <NavLink to="/chat">
              <MessageCircle size={20} />
              <span>消息{unread > 0 ? `(${unread})` : ''}</span>
            </NavLink>
          )}
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
              <li>查看保存状态，完成后交卷；教师批改并发布后，可以查看成绩和评语。</li>
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
          <ChatProvider>
            <DirectionsProvider>
              <Shell />
            </DirectionsProvider>
          </ChatProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

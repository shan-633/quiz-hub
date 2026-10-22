import { useState } from 'react';
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, Atom, NotebookPen } from 'lucide-react';
import { useAuth, useToast } from '../context';
import { api, json } from '../api';
export function LoginPage() {
  const { login } = useAuth(),
    toast = useToast(),
    navigate = useNavigate(),
    [params] = useSearchParams(),
    location = useLocation();
  const teacher = params.has('teacher'),
    admin = params.has('admin');
  const [username, setUsername] = useState(admin ? '' : teacher ? 'teacher' : 'student'),
    [password, setPassword] = useState(admin ? '' : teacher ? 'Teacher123!' : 'Student123!'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async (user = username, pass = password) => {
    setBusy(true);
    setError('');
    try {
      const authenticated = await login(user, pass);
      if (authenticated.mustChangePassword) {
        navigate('/account/password', { replace: true });
        return;
      }
      if (authenticated.role === 'admin') {
        navigate('/admin', { replace: true });
        return;
      }
      const from = (location.state as { from?: string } | null)?.from;
      const destination =
        from?.startsWith('/teacher') && authenticated.role !== 'teacher' ? '/' : from;
      const libraryId = params.get('library');
      const printId = params.get('print');
      if (printId) navigate(`/library?print=${encodeURIComponent(printId)}`, { replace: true });
      else if (libraryId) {
        const a = await api('/attempts', { method: 'POST', body: json({ libraryId }) });
        navigate(`/attempts/${a.id}`, { replace: true });
      } else
        navigate(destination ?? (authenticated.role === 'teacher' ? '/teacher' : '/'), {
          replace: true,
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <div className="login-intro">
        <div className="eyebrow">WELCOME BACK</div>
        <h1>
          思考，可以从这里
          <br />
          接着开始。
        </h1>
        <p>
          登录后，你的每一次选择、每一段推导，
          <br />
          都能找到属于它的位置。
        </p>
        <div className="login-equation">
          <span>理解</span>
          <span>＋</span>
          <span>练习</span>
          <span>＝</span>
          <strong>进步</strong>
        </div>
      </div>
      <div className="login-card">
        <span className="login-logo">
          <Atom size={30} />
        </span>
        <h2>{admin ? '进入管理员工作台' : teacher ? '进入教师工作台' : '进入学习空间'}</h2>
        <p>
          {admin
            ? '使用本机初始化或管理员创建的账号登录。'
            : '使用已分配的账号登录，也可体验本地演示。'}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            账号
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label className="field">
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? '正在登录…' : '登录并继续'}
            <ArrowRight size={18} />
          </button>
        </form>
        <div className="demo-divider">
          <span>快速体验 · 本地演示</span>
        </div>
        <div className="demo-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => void submit('teacher', 'Teacher123!')}
          >
            <NotebookPen size={18} />
            教师端
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => void submit('student', 'Student123!')}
          >
            <GraduationCap size={18} />
            学生端
          </button>
        </div>
        <p className="demo-accounts">
          学生 student / Student123!
          <br />
          教师 teacher / Teacher123!
        </p>
        <Link className="text-button" to="/login?admin=1">
          管理员登录
        </Link>
        <Link className="text-button" to="/">
          先浏览试卷与题库
        </Link>
      </div>
    </div>
  );
}

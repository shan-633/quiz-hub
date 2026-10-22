import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useAuth } from '../context';
import { api, json } from '../api';
export function PasswordPage() {
  const { user, login } = useAuth(),
    navigate = useNavigate();
  const [currentPassword, setCurrent] = useState(''),
    [newPassword, setNew] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <section className="community-page password-page">
      <div className="eyebrow">ACCOUNT SECURITY</div>
      <h1>{user?.mustChangePassword ? '先为你的账号设置新密码' : '修改登录密码'}</h1>
      <p className="muted">
        {user?.mustChangePassword
          ? '当前使用的是临时密码，修改后即可进入工作台。'
          : '保存后，其他设备的登录会失效。'}
      </p>
      <form
        className="community-panel password-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (newPassword !== confirm) {
            setError('两次输入的新密码不一致');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await api('/auth/password', {
              method: 'POST',
              body: json({ currentPassword, newPassword }),
            });
            const u = await login(user!.username, newPassword);
            navigate(u.role === 'admin' ? '/admin' : u.role === 'teacher' ? '/teacher' : '/', {
              replace: true,
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <KeyRound size={28} />
        <label className="field">
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
            maxLength={128}
          />
        </label>
        <label className="field">
          新密码
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <label className="field">
          再次输入新密码
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={12}
            maxLength={128}
            required
          />
        </label>
        <p className="muted small">使用12—128位密码。</p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? '正在保存…' : '保存新密码'}
        </button>
        {!user?.mustChangePassword && (
          <Link
            to={user?.role === 'admin' ? '/admin' : user?.role === 'teacher' ? '/teacher' : '/'}
            className="text-button"
          >
            返回
          </Link>
        )}
      </form>
    </section>
  );
}

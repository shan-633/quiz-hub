import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, UsersRound, UserPlus, Search, Link2, KeyRound } from 'lucide-react';
import type { User } from '../../shared/model';
import { useLoad } from '../useLoad';
import { api, json } from '../api';
import { useToast, useAuth } from '../context';
import { Modal, Loading, ErrorState, EmptyState } from '../components/ui';
const labels = { admin: '管理员', teacher: '教师', student: '学生' };
export function AdminPage() {
  const { user: me } = useAuth(),
    toast = useToast(),
    navigate = useNavigate();
  const [tab, setTab] = useState('users'),
    [search, setSearch] = useState(''),
    [role, setRole] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [edit, setEdit] = useState<User | null>(null),
    [reset, setReset] = useState<User | null>(null),
    [credential, setCredential] = useState<{ user: User; temporaryPassword: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const users = useLoad<{ users: User[]; total: number; page: number }>(
    `/admin/users?search=${encodeURIComponent(search)}&page=${page}${role ? '&role=' + role : ''}${status ? '&status=' + status : ''}`,
  );
  const relations = useLoad<{ users: User[]; links: { teacherId: string; studentId: string }[] }>(
    '/admin/relations',
  );
  const [teacher, setTeacher] = useState(''),
    [student, setStudent] = useState('');
  const closeCredential = () => {
    const self = credential?.user.id === me?.id;
    setCredential(null);
    if (self) {
      window.dispatchEvent(new Event('auth-expired'));
      navigate('/login?admin=1', { replace: true });
    }
  };
  const perform = async (fn: () => Promise<any>, secret = false) => {
    setBusy(true);
    setError('');
    try {
      const result = await fn();
      if (secret) setCredential(result);
      setCreating(false);
      setEdit(null);
      setReset(null);
      if (!(secret && result.user.id === me?.id)) {
        users.reload();
        relations.reload();
      }
      toast('已保存');
    } catch (e) {
      setError((e as Error).message);
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const teachers = relations.data?.users.filter((u) => u.role === 'teacher' && !u.disabled) ?? [],
    students = relations.data?.users.filter((u) => u.role === 'student' && !u.disabled) ?? [];
  const selectedTeacher = teacher || teachers[0]?.id || '';
  const assigned =
    relations.data?.links.filter((l) => l.teacherId === selectedTeacher).map((l) => l.studentId) ??
    [];
  return (
    <section className="community-page">
      <header className="community-heading">
        <div>
          <div className="eyebrow">ADMINISTRATION</div>
          <h1>让每个账号，找到自己的位置。</h1>
          <p className="muted">管理账号与师生关系，教学内容由所属教师维护。</p>
        </div>
        <ShieldCheck size={36} />
      </header>
      <div className="community-tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
          <UsersRound size={17} />
          账号管理
        </button>
        <button className={tab === 'relations' ? 'active' : ''} onClick={() => setTab('relations')}>
          <Link2 size={17} />
          师生关系
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {tab === 'users' ? (
        <div className="community-panel">
          <div className="community-toolbar">
            <label className="search-input">
              <Search size={17} />
              <input
                aria-label="搜索账号或姓名"
                placeholder="搜索账号或姓名"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <select
              aria-label="筛选角色"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              <option value="">所有角色</option>
              {Object.entries(labels).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
            <select
              aria-label="筛选账号状态"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">所有状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用</option>
              <option value="pending">待首次改密</option>
            </select>
            <button
              className="button primary"
              onClick={() => {
                setError('');
                setCreating(true);
              }}
            >
              <UserPlus size={17} />
              创建账号
            </button>
          </div>
          {users.loading ? (
            <Loading />
          ) : users.error ? (
            <ErrorState message={users.error} retry={users.reload} />
          ) : (
            <>
              <div className="account-list">
                {users.data?.users.map((u) => (
                  <article className="account-row" key={u.id}>
                    <span className="avatar">{u.name.slice(-1)}</span>
                    <div className="account-name">
                      <strong>{u.name}</strong>
                      <span className="muted small">@{u.username}</span>
                    </div>
                    <span className="community-tag">{labels[u.role]}</span>
                    <span className={`community-tag ${u.disabled ? 'muted' : ''}`}>
                      {u.disabled ? '已停用' : u.mustChangePassword ? '待首次改密' : '已启用'}
                    </span>
                    <div className="account-actions">
                      <button className="button small" onClick={() => setEdit(u)}>
                        编辑账号
                      </button>
                      <button className="text-button" onClick={() => setReset(u)}>
                        <KeyRound size={14} />
                        重置密码
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!users.data?.users.length && (
                <EmptyState title="没有匹配账号" description="换个关键词，或创建一个新账号。" />
              )}
              <div className="community-pagination">
                <span>
                  共 {users.data?.total ?? 0} 个账号 · 第 {page} 页
                </span>
                <button
                  className="button small"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </button>
                <button
                  className="button small"
                  disabled={page * 30 >= (users.data?.total ?? 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="community-panel">
          <div className="relation-heading">
            <label className="field">
              选择教师
              <select
                value={selectedTeacher}
                onChange={(e) => {
                  setTeacher(e.target.value);
                  setStudent('');
                }}
              >
                <option value="" disabled>
                  请选择教师
                </option>
                {teachers.map((u) => (
                  <option value={u.id} key={u.id}>
                    {u.name} @{u.username}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">一名学生可以关联多位教师；每位教师只查看自己的题库和对应作答。</p>
          </div>
          {relations.loading ? (
            <Loading />
          ) : relations.error ? (
            <ErrorState message={relations.error} retry={relations.reload} />
          ) : (
            <>
              <div className="community-toolbar">
                <select
                  aria-label="选择要添加的学生"
                  value={student}
                  onChange={(e) => setStudent(e.target.value)}
                >
                  <option value="">选择要添加的学生</option>
                  {students
                    .filter((u) => !assigned.includes(u.id))
                    .map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.name} @{u.username}
                      </option>
                    ))}
                </select>
                <button
                  className="button primary"
                  disabled={!student || !selectedTeacher || busy}
                  onClick={() =>
                    void perform(() =>
                      api(`/admin/teachers/${selectedTeacher}/students/${student}`, {
                        method: 'PUT',
                        body: json({}),
                      }),
                    ).then(() => setStudent(''))
                  }
                >
                  添加关联
                </button>
              </div>
              {students
                .filter((u) => assigned.includes(u.id))
                .map((u) => (
                  <article className="account-row" key={u.id}>
                    <span className="avatar">{u.name.slice(-1)}</span>
                    <div className="account-name">
                      <strong>{u.name}</strong>
                      <span className="muted small">@{u.username}</span>
                    </div>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          api(`/admin/teachers/${selectedTeacher}/students/${u.id}`, {
                            method: 'DELETE',
                          }),
                        )
                      }
                    >
                      解除关联
                    </button>
                  </article>
                ))}
              {!assigned.length && (
                <EmptyState
                  title="这位教师还没有学生"
                  description="从上方选择学生，建立教学关系。"
                />
              )}
            </>
          )}
        </div>
      )}
      {creating && (
        <Modal title="创建账号" onClose={() => setCreating(false)}>
          <form
            className="community-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(
                () =>
                  api('/admin/users', {
                    method: 'POST',
                    body: json({
                      username: f.get('username'),
                      name: f.get('name'),
                      role: f.get('role'),
                    }),
                  }),
                true,
              );
            }}
          >
            <label className="field">
              登录账号
              <input
                name="username"
                autoComplete="off"
                pattern="[a-zA-Z0-9_-]{3,40}"
                placeholder="3—40位字母、数字、_ 或 -"
                required
              />
            </label>
            <label className="field">
              姓名
              <input name="name" maxLength={60} required />
            </label>
            <label className="field">
              账号角色
              <select name="role" defaultValue="student">
                {Object.entries(labels).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">系统生成一次性展示的临时密码，首次登录后必须修改。</p>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              确认创建
            </button>
          </form>
        </Modal>
      )}
      {edit && (
        <Modal title={`编辑 ${edit.username}`} onClose={() => setEdit(null)}>
          <form
            className="community-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(() =>
                api(`/admin/users/${edit.id}`, {
                  method: 'PATCH',
                  body: json({
                    expectedRevision: edit.revision ?? 0,
                    name: f.get('name'),
                    role: f.get('role'),
                    disabled: f.get('disabled') === 'on',
                  }),
                }),
              );
            }}
          >
            <label className="field">
              姓名
              <input name="name" defaultValue={edit.name} required maxLength={60} />
            </label>
            <label className="field">
              角色
              <select name="role" defaultValue={edit.role}>
                {Object.entries(labels).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-field">
              <input name="disabled" type="checkbox" defaultChecked={edit.disabled} />
              停用账号
            </label>
            <p className="muted small">
              保存将结束该账号现有登录。角色改变后原数据保留，按新角色权限访问。
              {edit.id === me?.id ? '这是你当前的账号。' : ''}
            </p>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              保存账号
            </button>
          </form>
        </Modal>
      )}
      {reset && (
        <Modal title="重置登录密码" onClose={() => setReset(null)}>
          <p>
            为 {reset.name}（@{reset.username}）生成新的临时密码？现有设备会退出登录，原密码将失效。
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void perform(
                () =>
                  api(`/admin/users/${reset.id}/reset-password`, {
                    method: 'POST',
                    body: json({ expectedRevision: reset.revision ?? 0 }),
                  }),
                true,
              )
            }
          >
            确认重置
          </button>
        </Modal>
      )}
      {credential && (
        <Modal title="请妥善交付临时密码" onClose={closeCredential}>
          <p>
            账号：<strong>{credential.user.username}</strong>
          </p>
          <code className="temporary-password">{credential.temporaryPassword}</code>
          <p className="muted">仅本次显示。请私下交给账号本人，首次登录后需要设置新密码。</p>
          <button className="button primary" onClick={closeCredential}>
            我已记录
          </button>
        </Modal>
      )}
    </section>
  );
}

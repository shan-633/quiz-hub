import { useDirections, CurriculumTag } from '../directions';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Send, Pencil, Clock3 } from 'lucide-react';
import type { User } from '../../shared/model';
import type { ClassGroup, TeacherAssignment, AssignmentStudent } from '../../shared/assignments';
import { taskStatusLabels } from '../../shared/assignments';
import { useLoad } from '../useLoad';
import { api, json } from '../api';
import { Loading, ErrorState, EmptyState, Modal, formatDate } from '../components/ui';
type Student = Pick<User, 'id' | 'name' | 'username'>;

export function TeacherStudentsPage() {
  const { matches } = useDirections();
  const students = useLoad<Student[]>('/teacher/students'),
    groups = useLoad<ClassGroup[]>('/teacher/groups'),
    tasks = useLoad<TeacherAssignment[]>('/teacher/assignments');
  const [tab, setTab] = useState('groups'),
    [query, setQuery] = useState(''),
    [editing, setEditing] = useState<Partial<ClassGroup> | null>(null),
    [detail, setDetail] = useState<string | null>(null),
    [message, setMessage] = useState('');
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        tasks.reload();
        students.reload();
        groups.reload();
      }
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const scopedTasks = tasks.data?.filter(matches);
  const error = students.error || groups.error || tasks.error;
  return (
    <div className="page class-page">
      <div className="class-heading">
        <div>
          <div className="eyebrow">TEACHING TOGETHER</div>
          <h1>管理学生</h1>
          <p>按班级和学习小组组织学生，把练习送到合适的人手中。</p>
        </div>
        <button className="button primary" onClick={() => setEditing({ name: '', studentIds: [] })}>
          <Plus size={17} />
          新建班级组
        </button>
      </div>
      <div className="class-stats">
        <span>
          <strong>{students.data?.length ?? 0}</strong> 关联学生
        </span>
        <span>
          <strong>{groups.data?.length ?? 0}</strong> 班级组
        </span>
        <span>
          <strong>{scopedTasks?.length ?? 0}</strong> 推送任务
        </span>
      </div>
      {message && (
        <p className="assignment-notice" role="status">
          {message}
        </p>
      )}
      <div className="class-toolbar">
        <div className="class-tabs" role="tablist" aria-label="学生管理分区">
          {[
            ['groups', '班级组'],
            ['students', '全部学生'],
            ['tasks', '推送任务'],
          ].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <input
          className="class-search"
          aria-label="搜索学生、班级或任务"
          placeholder="搜索学生、班级或任务"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error ? (
        <ErrorState
          message={error}
          retry={() => {
            students.reload();
            groups.reload();
            tasks.reload();
          }}
        />
      ) : students.loading || groups.loading || tasks.loading ? (
        <Loading />
      ) : (
        <>
          {tab === 'groups' && (
            <div className="class-grid">
              {groups.data
                ?.filter((g) => g.name.includes(query))
                .map((g) => (
                  <article className="class-card" key={g.id}>
                    <span className="class-icon">
                      <Users />
                    </span>
                    <h2>{g.name}</h2>
                    <p>{g.studentIds.length}位学生</p>
                    <div className="class-member-chips">
                      {g.studentIds.slice(0, 8).map((id) => (
                        <span key={id}>
                          {students.data?.find((s) => s.id === id)?.name ?? '学生'}
                        </span>
                      ))}
                      {g.studentIds.length > 8 && <span>+{g.studentIds.length - 8}</span>}
                    </div>
                    <div className="class-card-actions">
                      <button className="text-button" onClick={() => setEditing(g)}>
                        <Pencil size={15} />
                        管理成员
                      </button>
                      <Link className="text-button" to="/teacher/library">
                        <Send size={15} />
                        选择题库推送
                      </Link>
                    </div>
                  </article>
                ))}
              {!groups.data?.length && (
                <EmptyState
                  title="创建第一个班级组"
                  description="一个学生可以加入多个组，推送任务时会自动去重。"
                />
              )}
            </div>
          )}
          {tab === 'students' && (
            <section className="class-panel">
              <p className="muted small">
                学生账号及教师归属由管理员管理；这里可将已关联学生分入多个班级组。
              </p>
              <div className="class-student-list">
                {students.data
                  ?.filter((s) => `${s.name} ${s.username}`.includes(query))
                  .map((s) => (
                    <article key={s.id}>
                      <span className="class-avatar">{s.name.slice(0, 1)}</span>
                      <div>
                        <strong>{s.name}</strong>
                        <small>{s.username}</small>
                      </div>
                      <div className="class-member-chips">
                        {groups.data
                          ?.filter((g) => g.studentIds.includes(s.id))
                          .map((g) => (
                            <span key={g.id}>{g.name}</span>
                          ))}
                      </div>
                      <Link className="text-button" to="/chat">
                        站内消息
                      </Link>
                    </article>
                  ))}
              </div>
              {!students.data?.length && (
                <EmptyState
                  title="等待管理员关联学生"
                  description="关联完成后即可在这里建立班级组。"
                />
              )}
            </section>
          )}
          {tab === 'tasks' && (
            <div className="class-task-list">
              {scopedTasks
                ?.filter((t) => `${t.title} ${t.groupNames.join(' ')}`.includes(query))
                .map((t) => (
                  <article className="class-task-card" key={t.id}>
                    <div>
                      <span className="eyebrow">{t.groupNames.join(' · ')}</span>
                      <h2>{t.title}</h2>
                      <CurriculumTag item={t} />
                      <p>
                        {t.questionCount}题 · {t.totalScore}分 · 已交 {t.submittedCount}/
                        {t.recipientCount}人
                      </p>
                      <p className="muted small">
                        <Clock3 size={14} />
                        {t.opensAt ? `开放 ${formatDate(t.opensAt)} · ` : ''}
                        {t.deadlineAt ? `截止 ${formatDate(t.deadlineAt)}` : '无统一截止'}
                        {t.timeLimitMinutes ? ` · 开始后${t.timeLimitMinutes}分钟` : ''} ·{' '}
                        {t.enforceTimeLimit ? '到时强制交卷' : '超时可继续'}
                      </p>
                    </div>
                    <button className="button" onClick={() => setDetail(t.id)}>
                      查看完成情况
                    </button>
                  </article>
                ))}
              {!scopedTasks?.length && (
                <EmptyState
                  title="还没有推送任务"
                  description="导入并发布题库后，在卡片上选择“推送班级”。"
                >
                  <Link className="button primary" to="/teacher/library">
                    前往题库与试卷
                  </Link>
                </EmptyState>
              )}
            </div>
          )}
        </>
      )}
      {editing && (
        <GroupEditor
          group={editing}
          students={students.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(deleted) => {
            setEditing(null);
            setMessage(deleted ? '班级组已删除，历史任务保留' : '班级组已保存');
            groups.reload();
          }}
        />
      )}
      {detail && <TaskDetail id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
function GroupEditor({
  group,
  students,
  onClose,
  onSaved,
}: {
  group: Partial<ClassGroup>;
  students: Student[];
  onClose: () => void;
  onSaved: (deleted?: boolean) => void;
}) {
  const [name, setName] = useState(group.name ?? ''),
    [ids, setIds] = useState(group.studentIds ?? []),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmDelete, setConfirmDelete] = useState(false);
  const save = async (remove = false) => {
    setBusy(true);
    setError('');
    try {
      await api(`/teacher/groups${group.id ? `/${group.id}` : ''}`, {
        method: remove ? 'DELETE' : group.id ? 'PUT' : 'POST',
        body: json(
          remove
            ? { expectedRevision: group.revision }
            : { name, studentIds: ids, expectedRevision: group.revision },
        ),
      });
      onSaved(remove);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={group.id ? '编辑班级组' : '新建班级组'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          班级组名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            disabled={busy}
          />
        </label>
        <label className="field">
          搜索关联学生
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="姓名或账号"
          />
        </label>
        <fieldset className="assignment-checks">
          <legend>选择学生 · 已选{ids.length}人</legend>
          {students
            .filter((s) => `${s.name} ${s.username}`.includes(query))
            .map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={ids.includes(s.id)}
                  onChange={(e) =>
                    setIds((old) =>
                      e.target.checked ? [...old, s.id] : old.filter((id) => id !== s.id),
                    )
                  }
                />
                <span>
                  {s.name}
                  <small>{s.username}</small>
                </span>
              </label>
            ))}
          {!students.length && <p>尚无关联学生，请联系管理员分配。</p>}
        </fieldset>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {confirmDelete && (
          <p className="inline-error">
            删除班级组会移除分组，已推送任务及学生作答保留。
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              确认删除
            </button>
          </p>
        )}
        <div className="modal-actions">
          {group.id && (
            <button
              type="button"
              className="text-button error-text"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              删除班级组
            </button>
          )}
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            保存班级组
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useLoad<{ title: string; students: AssignmentStudent[] }>(
    `/teacher/assignments/${id}`,
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) detail.reload();
    }, 10000);
    return () => clearInterval(timer);
  }, [id]);
  return (
    <Modal title={detail.data?.title ?? '任务完成情况'} onClose={onClose} wide>
      {detail.loading && !detail.data ? (
        <Loading />
      ) : detail.error ? (
        <ErrorState message={detail.error} retry={detail.reload} />
      ) : (
        <div className="class-detail-list">
          {detail.data?.students.map((s) => (
            <article key={s.student.id}>
              <div>
                <strong>{s.student.name}</strong>
                <small>{s.student.username}</small>
              </div>
              <span>{s.available ? taskStatusLabels[s.status] : '教学关系已解除'}</span>
              <span className="muted small">
                {s.submissionReason === 'timeout'
                  ? '到时自动交卷'
                  : s.late
                    ? '迟交'
                    : s.submittedAt
                      ? formatDate(s.submittedAt)
                      : s.dueAt
                        ? `交卷前 ${formatDate(s.dueAt)}`
                        : '—'}
              </span>
              {s.available && s.attemptId && s.status !== 'active' && (
                <Link className="button" to={`/teacher/attempts/${s.attemptId}`}>
                  查看答卷
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}

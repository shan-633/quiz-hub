import { randomBytes, randomUUID } from 'node:crypto';
import type { Attempt, LibraryItem, User } from '../shared/model';
import { hashPassword, HttpError, type StoredUser } from './auth';
import type { Store } from './store';

export const temporaryPassword = () => randomBytes(18).toString('base64url') + '!9aA';
export function publicUser(u: User): User {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    disabled: !!u.disabled,
    mustChangePassword: !!u.mustChangePassword,
    revision: u.revision ?? 0,
  };
}
export function revokeSessions(store: Store, userId: string) {
  store.db
    .prepare(
      "DELETE FROM documents WHERE collection='sessions' AND json_extract(data,'$.userId')=?",
    )
    .run(userId);
}
export function audit(store: Store, actor: string, action: string, target: string, detail: string) {
  store.db
    .prepare(
      'INSERT INTO admin_audit(actor_id,action,target_id,detail,created_at) VALUES(?,?,?,?,?)',
    )
    .run(actor, action, target, detail, new Date().toISOString());
}
export function migrateIdentity(store: Store) {
  store.db
    .exec(`CREATE TABLE IF NOT EXISTS teaching_links(teacher_id TEXT NOT NULL,student_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(teacher_id,student_id));
    CREATE INDEX IF NOT EXISTS teaching_links_student ON teaching_links(student_id,teacher_id);
    CREATE TABLE IF NOT EXISTS identity_schema(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);`);
  if (store.db.prepare('SELECT 1 FROM identity_schema WHERE version=1').get()) return;
  store.transaction(() => {
    const users = store.list<StoredUser>('users');
    const teachers = users.filter((u) => u.role === 'teacher' && !u.disabled);
    const libraries = store.list<LibraryItem>('library');
    if (teachers.length !== 1 && libraries.some((l) => !l.teacherId))
      throw new Error('已有内容缺少教师归属，请先提供迁移映射');
    const teacher = teachers[0];
    for (const u of users)
      if (u.role === 'admin') {
        store.put('users', u.id, { ...u, disabled: true, revision: (u.revision ?? 0) + 1 });
        revokeSessions(store, u.id);
      }
    for (const item of libraries)
      if (!item.teacherId)
        store.put('library', item.id, { ...item, teacherId: teacher.id }, teacher.id);
    if (teacher)
      for (const u of users)
        if (u.role === 'student' && !u.disabled)
          store.db
            .prepare('INSERT OR IGNORE INTO teaching_links VALUES(?,?,?)')
            .run(teacher.id, u.id, new Date().toISOString());
    for (const a of store.list<Attempt>('attempts')) {
      const teacherId =
        a.teacherId ?? store.get<LibraryItem>('library', a.libraryId)?.teacherId ?? teacher?.id;
      if (!a.teacherId && teacherId) store.put('attempts', a.id, { ...a, teacherId }, a.userId);
    }
    store.db.prepare('INSERT INTO identity_schema VALUES(1)').run();
  });
}
export function bootstrapAdmin(store: Store, username: string, password = temporaryPassword()) {
  if (!/^[a-zA-Z0-9_-]{3,40}$/.test(username))
    throw new Error('管理员账号须为3—40位字母、数字、下划线或连字符');
  if (password.length < 12 || password.length > 128) throw new Error('临时密码长度须为12—128位');
  const user = store.transaction(() => {
    const users = store.list<StoredUser>('users');
    if (users.some((u) => u.role === 'admin' && !u.disabled))
      throw new HttpError(409, '已有可用管理员，不能重复初始化');
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
      throw new HttpError(409, '账号已存在，请使用另一个名称');
    const u: StoredUser = {
      id: randomUUID(),
      username,
      name: '系统管理员',
      role: 'admin',
      disabled: false,
      mustChangePassword: true,
      revision: 1,
      passwordHash: hashPassword(password),
    };
    store.put('users', u.id, u);
    audit(store, 'local-bootstrap', 'bootstrap', u.id, '本机创建管理员');
    return publicUser(u);
  });
  return { user, temporaryPassword: password };
}

import type { Attempt, User } from '../shared/model';
import type { ChatMessage, Conversation, MessagePage } from '../shared/chat';
import { HttpError } from './auth';
import { publicUser } from './identity';
import { activeUser, attemptTeacher, linked } from './permissions';
import type { Store } from './store';
interface Thread {
  id: string;
  teacher_id: string;
  student_id: string;
  updated_at: string;
}
export class ChatService {
  private listeners = new Set<(users: string[], conversationId: string) => void>();
  constructor(readonly store: Store) {
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS chat_conversations(id TEXT PRIMARY KEY,teacher_id TEXT NOT NULL,student_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(teacher_id,student_id));
      CREATE INDEX IF NOT EXISTS chat_teacher ON chat_conversations(teacher_id,updated_at);
      CREATE INDEX IF NOT EXISTS chat_student ON chat_conversations(student_id,updated_at);
      CREATE TABLE IF NOT EXISTS chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),sender_id TEXT NOT NULL,client_message_id TEXT NOT NULL,body TEXT NOT NULL,reference TEXT,created_at TEXT NOT NULL,UNIQUE(conversation_id,sender_id,client_message_id));
      CREATE INDEX IF NOT EXISTS chat_message_page ON chat_messages(conversation_id,id);
      CREATE TABLE IF NOT EXISTS chat_reads(conversation_id TEXT NOT NULL,user_id TEXT NOT NULL,last_read_message_id INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(conversation_id,user_id));`);
  }
  subscribe(listener: (users: string[], id: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify(c: Thread) {
    for (const fn of this.listeners) {
      try {
        fn([c.teacher_id, c.student_id], c.id);
      } catch {}
    }
  }
  contacts(user: User): User[] {
    const column = user.role === 'teacher' ? 'teacher_id' : 'student_id',
      peer = user.role === 'teacher' ? 'student_id' : 'teacher_id';
    return this.store.db
      .prepare(`SELECT ${peer} AS id FROM teaching_links WHERE ${column}=?`)
      .all(user.id)
      .flatMap((row) => {
        const u = activeUser(
          this.store,
          row.id as string,
          user.role === 'teacher' ? 'student' : 'teacher',
        );
        return u ? [publicUser(u)] : [];
      });
  }
  thread(user: User, id: string): Thread {
    const c = this.store.db
      .prepare('SELECT * FROM chat_conversations WHERE id=?')
      .get(id) as unknown as Thread | undefined;
    if (
      !c ||
      !(
        (user.role === 'teacher' && c.teacher_id === user.id) ||
        (user.role === 'student' && c.student_id === user.id)
      )
    )
      throw new HttpError(404, '会话不存在');
    return c;
  }
  private summary(user: User, c: Thread): Conversation {
    const peerId = c.teacher_id === user.id ? c.student_id : c.teacher_id;
    const peer = this.store.get<User>('users', peerId)!;
    const last = this.store.db
      .prepare('SELECT body FROM chat_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1')
      .get(c.id);
    const unread = this.store.db
      .prepare(
        'SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id=? AND sender_id<>? AND id>COALESCE((SELECT last_read_message_id FROM chat_reads WHERE conversation_id=? AND user_id=?),0)',
      )
      .get(c.id, user.id, c.id, user.id)!.n as number;
    return {
      id: c.id,
      peer: peer
        ? publicUser(peer)
        : {
            id: peerId,
            name: '已停用账号',
            username: '',
            role: user.role === 'teacher' ? 'student' : 'teacher',
          },
      canSend: linked(this.store, c.teacher_id, c.student_id),
      unread,
      updatedAt: c.updated_at,
      lastMessage: last?.body as string | undefined,
    };
  }
  conversations(user: User): Conversation[] {
    const col = user.role === 'teacher' ? 'teacher_id' : 'student_id';
    return (
      this.store.db
        .prepare(`SELECT * FROM chat_conversations WHERE ${col}=? ORDER BY updated_at DESC,id`)
        .all(user.id) as unknown as Thread[]
    ).map((c) => this.summary(user, c));
  }
  create(user: User, peerId: string): Conversation {
    const teacher = user.role === 'teacher' ? user.id : peerId,
      student = user.role === 'student' ? user.id : peerId;
    if (!linked(this.store, teacher, student))
      throw new HttpError(403, '只能与关联的教师或学生聊天');
    const now = new Date().toISOString();
    const c = this.store.transaction(() => {
      this.store.db
        .prepare('INSERT OR IGNORE INTO chat_conversations VALUES(?,?,?,?,?)')
        .run(crypto.randomUUID(), teacher, student, now, now);
      return this.store.db
        .prepare('SELECT * FROM chat_conversations WHERE teacher_id=? AND student_id=?')
        .get(teacher, student) as unknown as Thread;
    });
    this.notify(c);
    return this.summary(user, c);
  }
  private reference(user: User, c: Thread, raw: { attemptId: string; questionId: string }) {
    const a = this.store.get<Attempt>('attempts', raw.attemptId);
    if (
      !linked(this.store, c.teacher_id, c.student_id) ||
      !a ||
      a.status !== 'submitted' ||
      a.gradingMode === 'self' ||
      a.userId !== c.student_id ||
      attemptTeacher(this.store, a) !== c.teacher_id
    )
      return undefined;
    const n = a.questions.findIndex((q) => q.id === raw.questionId);
    if (n < 0) return undefined;
    return {
      ...raw,
      label: `${a.title} · 第${n + 1}题`,
      href:
        user.role === 'teacher'
          ? `/teacher/attempts/${a.id}?question=${encodeURIComponent(raw.questionId)}`
          : `/attempts/${a.id}?question=${encodeURIComponent(raw.questionId)}`,
    };
  }
  private message(user: User, c: Thread, row: any): ChatMessage {
    const ref = row.reference ? this.reference(user, c, JSON.parse(row.reference)) : undefined;
    return {
      id: row.id,
      conversationId: c.id,
      senderId: row.sender_id,
      clientMessageId: row.client_message_id,
      body: row.body,
      createdAt: row.created_at,
      ...(ref ? { reference: ref } : row.reference ? { referenceUnavailable: true } : {}),
    };
  }
  messages(user: User, id: string, before?: number, limit = 50, after?: number): MessagePage {
    const c = this.thread(user, id);
    const rows = this.store.db
      .prepare(
        after === undefined
          ? 'SELECT * FROM chat_messages WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT ?'
          : 'SELECT * FROM chat_messages WHERE conversation_id=? AND id>? ORDER BY id ASC LIMIT ?',
      )
      .all(id, after ?? before ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const page = rows.slice(0, limit);
    if (after === undefined) page.reverse();
    return {
      messages: page.map((r) => this.message(user, c, r)),
      hasMore: rows.length > limit,
    };
  }
  send(
    user: User,
    id: string,
    b: {
      body: string;
      clientMessageId: string;
      reference?: { attemptId: string; questionId: string };
    },
  ): ChatMessage {
    const c = this.thread(user, id);
    if (!linked(this.store, c.teacher_id, c.student_id))
      throw new HttpError(403, '师生关系已解除或账号已停用，当前会话只读');
    if (b.reference && !this.reference(user, c, b.reference))
      throw new HttpError(422, '只能引用双方有权查看的已交卷题目');
    const message = this.store.transaction(() => {
      const prior = this.store.db
        .prepare(
          'SELECT * FROM chat_messages WHERE conversation_id=? AND sender_id=? AND client_message_id=?',
        )
        .get(id, user.id, b.clientMessageId);
      if (prior) {
        if (
          prior.body !== b.body ||
          prior.reference !== (b.reference ? JSON.stringify(b.reference) : null)
        )
          throw new HttpError(409, '重试标识已用于其他消息');
        return this.message(user, c, prior);
      }
      const now = new Date().toISOString();
      const row = this.store.db
        .prepare(
          'INSERT INTO chat_messages(conversation_id,sender_id,client_message_id,body,reference,created_at) VALUES(?,?,?,?,?,?) RETURNING *',
        )
        .get(
          id,
          user.id,
          b.clientMessageId,
          b.body,
          b.reference ? JSON.stringify(b.reference) : null,
          now,
        );
      this.store.db.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(now, id);
      return this.message(user, c, row);
    });
    this.notify(c);
    return message;
  }
  read(user: User, id: string, messageId: number) {
    const c = this.thread(user, id);
    if (
      messageId !== 0 &&
      !this.store.db
        .prepare('SELECT 1 FROM chat_messages WHERE id=? AND conversation_id=?')
        .get(messageId, id)
    )
      throw new HttpError(422, '已读位置不属于当前会话');
    this.store.db
      .prepare(
        'INSERT INTO chat_reads VALUES(?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_message_id=MAX(last_read_message_id,excluded.last_read_message_id)',
      )
      .run(id, user.id, messageId);
    this.notify(c);
    return { ok: true };
  }
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LibraryItem } from '../../shared/model';
import type { ClassGroup } from '../../shared/assignments';
import { api, json } from '../api';
import { useLoad } from '../useLoad';
import { ErrorState, Loading, Modal } from './ui';

export function PushAssignment({
  item,
  onClose,
  onSent,
}: {
  item: Pick<LibraryItem, 'id' | 'title' | 'timeLimitMinutes' | 'enforceTimeLimit'>;
  onClose: () => void;
  onSent: () => void;
}) {
  const groups = useLoad<ClassGroup[]>('/teacher/groups');
  const [selected, setSelected] = useState<string[]>([]),
    [deadline, setDeadline] = useState(''),
    [minutes, setMinutes] = useState(item.timeLimitMinutes?.toString() ?? ''),
    [enforce, setEnforce] = useState(!!item.enforceTimeLimit),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [sent, setSent] = useState<number | null>(null);
  const send = async () => {
    setError('');
    if (!selected.length) {
      setError('请选择至少一个班级组');
      return;
    }
    if (enforce && !minutes && !deadline) {
      setError('强制交卷需要设置时限或截止时间');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ recipientCount: number }>('/teacher/assignments', {
        method: 'POST',
        body: json({
          libraryId: item.id,
          groupIds: selected,
          timeLimitMinutes: minutes ? Number(minutes) : undefined,
          enforceTimeLimit: enforce,
          deadlineAt: deadline ? new Date(deadline).toISOString() : undefined,
        }),
      });
      setSent(result.recipientCount);
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="推送班级任务"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {sent !== null ? (
        <div className="assignment-success" role="status">
          <h2>已推送给{sent}位学生</h2>
          <p>学生可在“班级任务”中开始作答。重叠班级中的学生只收到一份。</p>
          <button className="button primary" onClick={onClose}>
            完成
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <p className="assignment-source">{item.title}</p>
          <p className="muted small">推送当前已发布题目，后续题库和班级调整不会改写本次任务。</p>
          {groups.loading ? (
            <Loading />
          ) : groups.error ? (
            <ErrorState message={groups.error} retry={groups.reload} />
          ) : (
            <fieldset className="assignment-checks">
              <legend>接收班级组</legend>
              {groups.data?.length ? (
                groups.data.map((g) => (
                  <label key={g.id}>
                    <input
                      type="checkbox"
                      disabled={busy || !g.studentIds.length}
                      checked={selected.includes(g.id)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked ? [...ids, g.id] : ids.filter((id) => id !== g.id),
                        )
                      }
                    />
                    <span>
                      {g.name}
                      <small>{g.studentIds.length}位学生</small>
                    </span>
                  </label>
                ))
              ) : (
                <p>
                  还没有班级组，先前往<Link to="/teacher/students">管理学生</Link>创建。
                </p>
              )}
            </fieldset>
          )}
          <div className="form-grid">
            <label className="field">
              截止时间
              <input
                type="datetime-local"
                value={deadline}
                disabled={busy}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
            <label className="field">
              答题时限（分钟）
              <input
                type="number"
                min="1"
                max="600"
                placeholder="不限时"
                value={minutes}
                disabled={busy}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </label>
          </div>
          <label className="assignment-toggle">
            <input
              type="checkbox"
              checked={enforce}
              disabled={busy}
              onChange={(e) => setEnforce(e.target.checked)}
            />
            到时强制交卷
          </label>
          <p className="muted small">
            时限从首次开始作答计算。两种期限同时设置时，以先到者为准。
            {enforce
              ? '到时提交已同步的答案；未开始的学生无法再进入。'
              : '超时仍可作答，交卷时标记迟交。'}
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button className="button primary" disabled={busy || groups.loading}>
              {busy ? '正在推送…' : '确认推送'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

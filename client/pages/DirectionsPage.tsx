import { useEffect, useState } from 'react';
import { api, json } from '../api';
import { useAuth, useToast } from '../context';
import { useLoad } from '../useLoad';
import { Loading, ErrorState } from '../components/ui';
import { CurriculumFields, emptyCurriculum } from '../components/CurriculumFields';
import {
  curriculumKey,
  curriculumLabel,
  curriculumSchema,
  type LearningDirections,
  type Curriculum,
} from '../../shared/curriculum';
import { useDirections } from '../directions';
export function DirectionsPage() {
  const profile = useLoad<LearningDirections>('/account/directions'),
    { user } = useAuth(),
    context = useDirections(),
    toast = useToast();
  const [items, setItems] = useState<Curriculum[]>([]),
    [draft, setDraft] = useState(emptyCurriculum),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (profile.data) setItems(profile.data.directions);
  }, [profile.data]);
  if (profile.loading) return <Loading />;
  if (profile.error) return <ErrorState message={profile.error} retry={profile.reload} />;
  const add = () => {
    const result = curriculumSchema.safeParse(draft);
    if (!result.success) {
      setError('请填写学科、地区和考试名称。');
      return;
    }
    if (items.some((c) => curriculumKey(c) === curriculumKey(result.data))) {
      setError('这个方向已经添加。');
      return;
    }
    if (items.length >= 30) {
      setError('最多保存30个方向。');
      return;
    }
    setItems([...items, result.data]);
    setError('');
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await api<LearningDirections>('/account/directions', {
        method: 'PUT',
        body: json({ expectedRevision: profile.data!.revision, directions: items }),
      });
      profile.setData(next);
      context.reload();
      toast('方向已保存，可随时切换或查看全部方向。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page directions-page">
      <div className="eyebrow">YOUR DIRECTIONS</div>
      <h1>我的{user?.role === 'teacher' ? '教学' : '学习'}方向</h1>
      <p className="muted">
        一个账号可以同时学习或教授多个学段、学科和地区的考试。这里设置偏好，不限制你能接收的试卷。
      </p>
      <div className="direction-list">
        {items.length ? (
          items.map((c, i) => (
            <div className="direction-item" key={curriculumKey(c)}>
              <strong>{curriculumLabel(c)}</strong>
              <button
                className="text-button"
                disabled={busy}
                aria-label={'移除方向 ' + curriculumLabel(c)}
                onClick={() => setItems(items.filter((_, n) => n !== i))}
              >
                移除
              </button>
            </div>
          ))
        ) : (
          <p>尚未添加偏好，当前仍可查看全部已授权内容。</p>
        )}
      </div>
      <CurriculumFields value={draft} onChange={setDraft} disabled={busy} />
      <div className="direction-actions">
        <button className="button" disabled={busy} onClick={add}>
          添加方向
        </button>
        <button className="button primary" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存我的方向'}
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

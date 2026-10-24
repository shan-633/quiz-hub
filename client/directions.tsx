import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './context';
import { api } from './api';
import {
  curriculumKey,
  curriculumLabel,
  curriculumOf,
  uniqueCurricula,
  type Curriculum,
  type LearningDirections,
} from '../shared/curriculum';
import './directions.css';
const matchesAll = (_item: { curriculum?: Curriculum }) => true;
const DirectionContext = createContext({
  scope: null as Curriculum | null,
  directions: [] as Curriculum[],
  revision: 0,
  reload: () => {},
  matches: matchesAll,
  available: [] as Curriculum[],
  select: (_key: string) => {},
});
export const useDirections = () => useContext(DirectionContext);
export function DirectionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [state, setState] = useState<{
      owner: string;
      profile: LearningDirections;
      available: Curriculum[];
      scope: Curriculum | null;
    } | null>(null),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!user) {
      setState(null);
      return;
    }
    let alive = true;
    api<LearningDirections & { available: Curriculum[] }>('/account/directions')
      .then((profile) => {
        if (!alive) return;
        const options = uniqueCurricula(
          [...(profile.directions ?? []), ...(profile.available ?? [])].map((curriculum) => ({
            curriculum,
          })),
        );
        let key = '';
        try {
          key = localStorage.getItem('quiz-direction:' + user.id) ?? '';
        } catch {}
        setState({
          owner: user.id,
          profile,
          available: options,
          scope: options.find((c) => curriculumKey(c) === key) ?? null,
        });
      })
      .catch(() => {
        if (alive) setState(null);
      });
    return () => {
      alive = false;
    };
  }, [user?.id, version, pathname]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setVersion((v) => v + 1);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, []);
  const current = state?.owner === user?.id ? state : null,
    scope = current?.scope ?? null;
  const matches = (item: { curriculum?: Curriculum }) => {
    if (!scope) return true;
    const c = curriculumOf(item);
    return (
      c.stage === scope.stage &&
      c.subject === scope.subject &&
      c.region === scope.region &&
      c.exam === scope.exam &&
      (!scope.scheme || c.scheme === scope.scheme)
    );
  };
  const change = (key: string) => {
    if (!current || !user) return;
    const scope = current.available.find((c) => curriculumKey(c) === key) ?? null;
    setState({ ...current, scope });
    try {
      localStorage.setItem('quiz-direction:' + user.id, scope ? curriculumKey(scope) : '');
    } catch {}
  };
  return (
    <DirectionContext.Provider
      value={{
        scope,
        directions: current?.profile.directions ?? [],
        revision: current?.profile.revision ?? 0,
        reload: () => setVersion((v) => v + 1),
        matches,
        available: current?.available ?? [],
        select: change,
      }}
    >
      {children}
    </DirectionContext.Provider>
  );
}
export function CurriculumTag({ item }: { item: { curriculum?: Curriculum } }) {
  return <span className="curriculum-tag">{curriculumLabel(curriculumOf(item))}</span>;
}

export function DirectionBar() {
  const { user } = useAuth(),
    { scope, available, select, reload } = useContext(DirectionContext);
  if (!user || user.role === 'admin') return null;
  return (
    <div className="direction-bar">
      <label>
        当前方向
        <select
          aria-label="切换学习教学方向"
          value={scope ? curriculumKey(scope) : ''}
          onChange={(e) => select(e.target.value)}
        >
          <option value="">全部方向</option>
          {available.map((c) => (
            <option key={curriculumKey(c)} value={curriculumKey(c)}>
              {curriculumLabel(c)}
            </option>
          ))}
        </select>
      </label>
      <Link to="/account/directions">管理{user.role === 'teacher' ? '教学' : '学习'}方向</Link>
      <button className="text-button" onClick={reload}>
        刷新方向
      </button>
      <span>筛选内容与成绩；消息、学生和班级保持完整</span>
    </div>
  );
}

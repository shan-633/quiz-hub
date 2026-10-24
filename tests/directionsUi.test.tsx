// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DirectionsProvider, DirectionBar, useDirections } from '../client/directions';
import { curriculumKey, legacyCurriculum } from '../shared/curriculum';
const auth = vi.hoisted(() => ({ user: { id: 'student-a', role: 'student' } }));
vi.mock('../client/context', () => ({ useAuth: () => auth }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  auth.user = { id: 'student-a', role: 'student' };
});
const senior = {
  stage: 'senior' as const,
  subject: '数学',
  region: '浙江',
  exam: '高考',
  scheme: '',
};
function Probe() {
  const { matches, scope } = useDirections();
  return (
    <div>
      <span data-testid="scope">{scope?.subject ?? '全部'}</span>
      <span data-testid="count">
        {[{ curriculum: legacyCurriculum }, { curriculum: senior }].filter(matches).length}
      </span>
    </div>
  );
}
const Tree = () => (
  <MemoryRouter>
    <DirectionsProvider>
      <DirectionBar />
      <Probe />
    </DirectionsProvider>
  </MemoryRouter>
);
it('多个方向默认全部，可切换并保留本人偏好，空方案包含该考试不同卷型', async () => {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => ({
      id: auth.user.id,
      revision: 1,
      directions: [legacyCurriculum, senior],
      available: [],
    }),
  }));
  render(<Tree />);
  const select = await screen.findByLabelText('切换学习教学方向');
  await waitFor(() => expect(select.querySelectorAll('option')).toHaveLength(3));
  expect(screen.getByTestId('count').textContent).toBe('2');
  fireEvent.change(select, { target: { value: curriculumKey(senior) } });
  expect(screen.getByTestId('count').textContent).toBe('1');
  expect(localStorage.getItem('quiz-direction:student-a')).toBe(curriculumKey(senior));
  fireEvent.change(select, { target: { value: '' } });
  expect(screen.getByTestId('count').textContent).toBe('2');
});
it('换账号立即恢复全部，不在新请求返回前展示上一个账号方向；旧请求返回不能覆盖新账号', async () => {
  localStorage.setItem('quiz-direction:student-a', curriculumKey(senior));
  let resolveB!: (value: any) => void;
  vi.stubGlobal('fetch', async () =>
    auth.user.id === 'student-a'
      ? {
          ok: true,
          json: async () => ({ id: 'student-a', revision: 1, directions: [senior], available: [] }),
        }
      : new Promise((resolve) => {
          resolveB = resolve;
        }),
  );
  const view = render(<Tree />);
  await waitFor(() => expect(screen.getByTestId('scope').textContent).toBe('数学'));
  auth.user = { id: 'student-b', role: 'student' };
  view.rerender(<Tree />);
  expect(screen.getByTestId('scope').textContent).toBe('全部');
  expect(screen.queryByRole('option', { name: /浙江/ })).toBeNull();
  resolveB({
    ok: true,
    json: async () => ({ id: 'student-b', revision: 0, directions: [], available: [] }),
  });
  await waitFor(() =>
    expect(screen.getByLabelText('切换学习教学方向').querySelectorAll('option')).toHaveLength(1),
  );
});
it('已删除方向不会恢复过期筛选；偏好服务失败仍可看全部已授权内容', async () => {
  localStorage.setItem('quiz-direction:student-a', curriculumKey(senior));
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => ({ id: 'student-a', revision: 2, directions: [], available: [] }),
  }));
  const view = render(<Tree />);
  await waitFor(() =>
    expect(screen.getByLabelText('切换学习教学方向').querySelectorAll('option')).toHaveLength(1),
  );
  expect(screen.getByTestId('count').textContent).toBe('2');
  view.unmount();
  vi.stubGlobal('fetch', async () => {
    throw Error('offline');
  });
  render(<Tree />);
  await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
});

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, ArrowUpRight } from 'lucide-react';
import { beijingDate, type DailyOverview } from '../../shared/dailyQuestion';
import { useLoad } from '../useLoad';
import { api } from '../api';
import '../dailyQuestion.css';

const labels = { correct: '全对', incorrect: '未全对' };
export function DailyQuestionPanel() {
  const navigate = useNavigate();
  const [day, setDay] = useState(() => beijingDate());
  const [month, setMonth] = useState(() => day.slice(0, 7));
  const [selected, setSelected] = useState(day);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useLoad<DailyOverview>(`/daily-question?month=${month}`);
  const today = data?.today ?? day;
  const entries = data?.month === month ? data.entries : [];
  const todayEntry = data?.todayEntry;
  const entry = entries.find((e) => e.date === selected);
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      const next = beijingDate();
      if (next !== day) {
        setDay(next);
        setMonth((old) => (old === day.slice(0, 7) ? next.slice(0, 7) : old));
        setSelected(next);
      }
      reload();
    };
    const timer = setInterval(() => {
      if (beijingDate() !== day) refresh();
    }, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [day, reload]);
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ attemptId: string }>('/daily-question/start', { method: 'POST' });
      navigate(`/attempts/${encodeURIComponent(result.attemptId)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells = Math.ceil((offset + length) / 7) * 7;
  const changeMonth = (amount: number) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + amount, 1)).toISOString().slice(0, 7);
    setMonth(next);
    setSelected(`${next}-01`);
  };
  return (
    <section className="learning-panel daily-panel" aria-label="每日一题打卡">
      <div className="learning-panel-heading">
        <div>
          <span className="learning-module-eyebrow">
            <CalendarDays size={15} /> A LITTLE EVERY DAY
          </span>
          <h2>每日一题</h2>
          <p className="daily-subtitle">每天一道单选或多选，答完即评 · 北京时间</p>
        </div>
        <button
          className="button primary daily-start"
          onClick={() => void start()}
          disabled={busy || loading || todayEntry?.available === false}
        >
          {busy
            ? '准备中…'
            : todayEntry?.result
              ? '查看今日结果'
              : todayEntry
                ? '继续今日一题'
                : '开始今日一题'}
          <ArrowUpRight size={15} />
        </button>
      </div>
      {(error || loadError) && (
        <p role="alert" className="inline-error">
          {error || loadError}{' '}
          <button className="text-button" onClick={reload}>
            重试
          </button>
        </p>
      )}
      <div className="daily-content">
        <div className="daily-calendar">
          <div className="daily-month-heading">
            <button
              className="icon-button"
              aria-label="上个月"
              onClick={() => changeMonth(-1)}
              disabled={year <= 2000 && monthNumber === 1}
            >
              <ChevronLeft size={18} />
            </button>
            <h3>
              {year} 年 {monthNumber} 月
            </h3>
            <button
              className="icon-button"
              aria-label="下个月"
              onClick={() => changeMonth(1)}
              disabled={month >= today.slice(0, 7)}
            >
              <ChevronRight size={18} />
            </button>
            <button
              className="text-button"
              onClick={() => {
                setMonth(today.slice(0, 7));
                setSelected(today);
              }}
            >
              本月
            </button>
          </div>
          <div className="daily-week" aria-hidden="true">
            {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="daily-days" aria-label={`${year}年${monthNumber}月打卡日历`}>
            {Array.from({ length: cells }, (_, i) => {
              const number = i - offset + 1;
              if (number < 1 || number > length) return <span key={i} className="daily-padding" />;
              const date = `${month}-${String(number).padStart(2, '0')}`;
              const current = entries.find((e) => e.date === date);
              const result = current?.result;
              const label = result
                ? labels[result]
                : current
                  ? '未交卷'
                  : date > today
                    ? '未到日期'
                    : '未做';
              return (
                <button
                  key={date}
                  className={`daily-day ${result ?? 'empty'} ${date === today ? 'today' : ''}`}
                  aria-label={`${date} · ${label}`}
                  aria-pressed={selected === date}
                  aria-current={date === today ? 'date' : undefined}
                  disabled={date > today || loading}
                  onClick={() => setSelected(date)}
                >
                  <span>{number}</span>
                  <small>
                    {date === today
                      ? '今天'
                      : result === 'correct'
                        ? '全对'
                        : result === 'incorrect'
                          ? '未全对'
                          : ''}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="daily-legend">
            <span>
              <i className="correct" />
              全对
            </span>
            <span>
              <i className="incorrect" />
              未全对
            </span>
            <span>
              <i className="empty" />
              未完成
            </span>
          </div>
        </div>
        <div className="daily-details" aria-label="每日一题当天详情" aria-live="polite">
          <span className="daily-date">{selected.replaceAll('-', ' / ')}</span>
          <h3>
            {entry?.result
              ? entry.result === 'correct'
                ? '这一天，答得漂亮'
                : '把这道题再想明白'
              : entry
                ? '还差一次提交'
                : selected === today
                  ? '今天的一点进步'
                  : '这一天还没有打卡'}
          </h3>
          <p>
            {entry?.result
              ? '首次交卷的自动评分已记入日历，可以查看答案和解析。'
              : '完成选择并提交评分后，全对记绿色，其余结果记红色。未作答或未交卷保持空色。'}
          </p>
          {entry?.available && (
            <Link className="button" to={`/attempts/${entry.attemptId}`}>
              {entry.result ? '查看作答与解析' : '继续作答'}
              <ArrowUpRight size={15} />
            </Link>
          )}
          {entry && !entry.available && <p>教学关系已改变，当前题目暂不可继续。</p>}
          <div className="daily-totals">
            <div>
              <strong>{entries.filter((e) => e.result).length}</strong>
              <small>本月已完成</small>
            </div>
            <div>
              <strong>{entries.filter((e) => e.result === 'correct').length}</strong>
              <small>本月全对</small>
            </div>
          </div>
          <small className="daily-note">
            每天每人固定一题，涵盖你可访问的各学习方向。重复查看不改变首次结果；未交卷记录可继续完成，结果归入出题日期。
          </small>
        </div>
      </div>
    </section>
  );
}

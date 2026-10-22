import { useEffect, useState } from 'react';

/** Refresh only while a visible item still has an upcoming opening boundary. */
export function useOpeningClock(dates: (string | undefined)[]) {
  const last = Math.max(0, ...dates.map((date) => (date ? Date.parse(date) : 0)));
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    let timer: ReturnType<typeof setInterval> | undefined;
    if (last > Date.now())
      timer = setInterval(() => {
        refresh();
        if (Date.now() >= last) clearInterval(timer);
      }, 1000);
    const visible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', refresh);
    };
  }, [last]);
  return now;
}

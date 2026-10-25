import type { Curriculum } from './curriculum';

export interface DailyEntry {
  date: string;
  attemptId: string;
  status: 'active' | 'submitted';
  result: 'correct' | 'incorrect' | null;
  available: boolean;
  curriculum: Curriculum;
}
export interface DailyOverview {
  today: string;
  month: string;
  todayEntry?: DailyEntry;
  entries: DailyEntry[];
}
/** Calendar keys always use Beijing time, independently of browser/server time zones. */
export function beijingDate(now = Date.now()): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

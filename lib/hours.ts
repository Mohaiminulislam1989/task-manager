// Working hours: every clock on the board (column estimates, the card dot, the deadline colour)
// counts only the organisation's working time, in its own time zone.

export interface WorkHours {
  tz: string;          // IANA time zone, e.g. "Asia/Dhaka"
  days: number[];      // working weekdays, 0 = Sunday … 6 = Saturday
  start: number;       // minutes after midnight the working day starts
  end: number;         // minutes after midnight it ends (after start)
  holidays: string[];  // "YYYY-MM-DD" dates with no work
}

export const DEFAULT_HOURS: WorkHours = { tz: 'UTC', days: [1, 2, 3, 4, 5], start: 9 * 60, end: 18 * 60, holidays: [] };
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const fmts = new Map<string, Intl.DateTimeFormat>();
function wall(tz: string, ms: number) {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(ms)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}
// How far the zone's wall clock is ahead of UTC at this instant.
function offset(tz: string, ms: number) {
  const w = wall(tz, ms);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}
// The instant a wall-clock time happens in the zone (DST-safe for working hours).
function instant(tz: string, y: number, m: number, d: number, min: number) {
  const guess = Date.UTC(y, m - 1, d) + min * 60000, o1 = offset(tz, guess - offset(tz, guess));
  return guess - o1;
}

export function validZone(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Working milliseconds between two instants. Negative when b is before a. No schedule means calendar time.
export function workMs(h: WorkHours | null | undefined, a: number, b: number): number {
  if (!h) return b - a;
  if (b < a) return -workMs(h, b, a);
  if (!h.days.length || h.end <= h.start) return 0;
  const w = wall(h.tz, a), hol = new Set(h.holidays);
  let total = 0;
  for (let i = 0; i < 3700; i++) {
    const day = new Date(Date.UTC(w.year, w.month - 1, w.day + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const from = instant(h.tz, y, m, d, h.start);
    if (from >= b) break;
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!h.days.includes(day.getUTCDay()) || hol.has(key)) continue;
    const to = instant(h.tz, y, m, d, h.end);
    total += Math.max(0, Math.min(to, b) - Math.max(from, a));
  }
  return total;
}

export const dayHours = (h: WorkHours | null | undefined) => h ? (h.end - h.start) / 60 : 24;
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

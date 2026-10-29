'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Person } from '@/lib/rules';

const I: Record<string, ReactNode> = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cal: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  check: <><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M8 12.5l2.8 2.8L16.5 9" /></>,
  chat: <path d="M4 5.5h16v11H9.5L4 20.5z" />,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 1.8H4.2z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  right: <path d="M5 12h14M13 6l6 6-6 6" />,
  left: <path d="M19 12H5M11 6l-6 6 6 6" />,
  lock: <><rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  send: <path d="M4 12l16-7-6 16-3-7z" />,
  ok: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16 10" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  clip: <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.4 3.4 0 0 1 4.8 4.8l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />,
  at: <><circle cx="12" cy="12" r="3.8" /><path d="M15.8 8.5v5a2.6 2.6 0 0 0 5.2 0V12a9 9 0 1 0-3.6 7.2" /></>,
  play: <path d="M8 5.5v13l11-6.5z" fill="currentColor" />,
  img: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M20.5 16l-5-5-9 8.5" /></>,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  chev: <path d="M9 6l6 6-6 6" />,
  out: <path d="M15 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H15M10 16.5l4.5-4.5L10 7.5M14.5 12H4" />,
};
export function Ic({ n, s = 16 }: { n: keyof typeof I | string; s?: number }) {
  return <svg className="ic" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[n]}</svg>;
}

export type PeopleMap = Record<string, Person>;
const PeopleCtx = createContext<PeopleMap>({});
export const PeopleProvider = ({ people, children }: { people: Person[]; children: ReactNode }) =>
  <PeopleCtx.Provider value={Object.fromEntries(people.map(p => [p.id, p]))}>{children}</PeopleCtx.Provider>;
export const usePeople = () => useContext(PeopleCtx);

export function Av({ id, size = '' }: { id: string; size?: '' | 'sm' | 'lg' | 'xl' }) {
  const p = usePeople()[id];
  const ini = p ? p.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  return <span className={`av ${size}`} style={{ ['--h' as string]: p?.hue ?? 210 }} title={p?.name}>{ini}</span>;
}
export const Avs = ({ ids, size = 'sm' }: { ids: string[]; size?: '' | 'sm' }) => <span className="avs">{ids.map(id => <Av key={id} id={id} size={size} />)}</span>;

// Current time, refreshed every minute so colours recalculate without a reload.
export function useNow(step = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), step); return () => clearInterval(t); }, [step]);
  return now;
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t); }, [msg]);
  return <ToastCtx.Provider value={setMsg}>{children}<div className="toast" role="status" hidden={!msg}><Ic n="ok" />{msg}</div></ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

const SearchCtx = createContext<[string, (q: string) => void]>(['', () => {}]);
export function SearchProvider({ children }: { children: ReactNode }) {
  const st = useState('');
  return <SearchCtx.Provider value={st}>{children}</SearchCtx.Provider>;
}
export const useSearch = () => useContext(SearchCtx);

export const fmtSize = (b: number) => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
export function relTime(ms: number, now: number) {
  const d = now - ms;
  if (d < 60000) return 'just now';
  if (d < 3600e3) return `${Math.round(d / 60000)} min ago`;
  if (d < 864e5) return `${Math.floor(d / 3600e3)} h ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
export const toLocalInput = (ms: number) => { const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

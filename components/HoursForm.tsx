'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveWorkHours } from '@/app/actions';
import { WEEKDAYS, hhmm, type WorkHours } from '@/lib/hours';
import { Ic, useToast } from './ui';

const toMin = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + (m || 0); };
const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function HoursForm({ initial, zones, canEdit }: { initial: WorkHours; zones: string[]; canEdit: boolean }) {
  const [h, setH] = useState(initial), [day, setDay] = useState('');
  const [pending, start] = useTransition(), toast = useToast(), router = useRouter();
  const set = (patch: Partial<WorkHours>) => setH(x => ({ ...x, ...patch }));
  const here = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const len = Math.max(0, h.end - h.start), week = (len * h.days.length) / 60;
  const addDay = () => { if (day && !h.holidays.includes(day)) set({ holidays: [...h.holidays, day].sort() }); setDay(''); };
  const save = () => start(async () => { const r = await saveWorkHours(h); toast(r.ok ? r.msg ?? 'Saved' : r.error); if (r.ok) router.refresh(); });

  return <>
    {!canEdit && <p className="muted hours-note"><Ic n="lock" s={14} />Only the Super admin can change these.</p>}
    <section className="panel hours"><div className="panel-h"><h2>Working week</h2><span className="muted">{+(len / 60).toFixed(2)} h a day · {week % 1 ? week.toFixed(1) : week} h a week</span></div>
      <div className="hours-body">
        <div className="field"><label htmlFor="tz">Time zone</label>
          <select id="tz" value={h.tz} disabled={!canEdit} onChange={e => set({ tz: e.target.value })}>{zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select>
          {canEdit && here && here !== h.tz && zones.includes(here) && <button type="button" className="link" onClick={() => set({ tz: here })}>Use my time zone ({here.replace(/_/g, ' ')})</button>}</div>
        <fieldset className="field days"><legend>Working days</legend>
          <div className="day-row">{[0, 1, 2, 3, 4, 5, 6].map(d => <label key={d} className={`day ${h.days.includes(d) ? 'on' : ''}`}>
            <input type="checkbox" checked={h.days.includes(d)} disabled={!canEdit} onChange={e => set({ days: e.target.checked ? [...h.days, d].sort() : h.days.filter(x => x !== d) })} />{WEEKDAYS[d].slice(0, 3)}</label>)}</div></fieldset>
        <div className="row2">
          <div className="field"><label htmlFor="hStart">Day starts</label><input id="hStart" type="time" step={900} value={hhmm(h.start)} disabled={!canEdit} onChange={e => e.target.value && set({ start: toMin(e.target.value) })} /></div>
          <div className="field"><label htmlFor="hEnd">Day ends</label><input id="hEnd" type="time" step={900} value={hhmm(h.end)} disabled={!canEdit} onChange={e => e.target.value && set({ end: toMin(e.target.value) })} /></div>
        </div>
      </div></section>
    <section className="panel hours"><div className="panel-h"><h2>Holidays <span className="n-badge">{h.holidays.length}</span></h2><span className="muted">No time is counted on these dates.</span></div>
      <div className="hours-body">
        {canEdit && <div className="hol-add"><div className="field"><label htmlFor="hol">Add a date</label><input id="hol" type="date" value={day} onChange={e => setDay(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDay(); } }} /></div><button type="button" className="btn" onClick={addDay} disabled={!day}><Ic n="plus" s={14} />Add</button></div>}
        {h.holidays.length ? <ul className="hol-list">{h.holidays.map(d => <li key={d}><span>{fmtDay(d)}</span>{canEdit && <button type="button" className="icon-btn sm" aria-label={`Remove ${fmtDay(d)}`} onClick={() => set({ holidays: h.holidays.filter(x => x !== d) })}><Ic n="x" s={14} /></button>}</li>)}</ul>
          : <p className="muted" style={{ margin: 0 }}>No holidays yet.</p>}
      </div></section>
    {canEdit && <div className="actions" style={{ justifyContent: 'flex-start' }}><button className="btn primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save working hours'}</button></div>}
  </>;
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SWATCHES, isAdminRole, type ProjectShape } from '@/lib/rules';
import { createProject } from '@/app/actions';
import { Av, Ic, usePeople, useToast } from './ui';

interface DCol { key: number; name: string; est: number; owners: string[] }
interface DTeam { key: number; name: string; color: string; lead: string; members: string[]; cols: DCol[] }
interface Draft { name: string; manager: string; teams: DTeam[] }
let seq = 0;
const k = () => ++seq;
const blankTeam = (i: number): DTeam => ({ key: k(), name: '', color: SWATCHES[i % SWATCHES.length], lead: '', members: [], cols: [{ key: k(), name: '', est: 8, owners: [] }] });
const CAMPAIGN: [string, string, [string, number][]][] = [
  ['Client Strategy', '--t1', [['Client brief', 8], ['Strategy & media plan', 16]]],
  ['Creative', '--t2', [['Copywriting', 6], ['Design & video', 12], ['Internal review', 4]]],
  ['Media & Performance', '--t3', [['Ad setup & tracking', 8], ['Client approval', 24]]],
];
function template(kind: string, copyFrom: ProjectShape[]): DTeam[] {
  if (kind === 'blank') return [blankTeam(0)];
  if (kind === 'campaign') return CAMPAIGN.map(([name, color, cols]) => ({ key: k(), name, color, lead: '', members: [], cols: cols.map(([n, est]) => ({ key: k(), name: n, est, owners: [] })) }));
  const p = copyFrom.find(x => x.id === kind)!;
  return [...p.teams].sort((a, b) => a.lineOrder - b.lineOrder).map(t => ({ key: k(), name: t.name, color: t.color, lead: t.leadId ?? '', members: [...t.memberIds],
    cols: p.columns.filter(c => c.teamId === t.id).sort((a, b) => a.position - b.position).map(c => ({ key: k(), name: c.name, est: c.estH, owners: [...c.ownerIds] })) }));
}

function issues(d: Draft) {
  const out: { step: number; text: string }[] = [];
  if (!d.name.trim()) out.push({ step: 1, text: 'Give the project a name.' });
  if (!d.teams.length) out.push({ step: 2, text: 'Add at least one team.' });
  d.teams.forEach((t, i) => {
    const label = t.name.trim() || `Team ${i + 1}`;
    if (!t.name.trim()) out.push({ step: 2, text: `Team ${i + 1} needs a name.` });
    if (!t.lead) out.push({ step: 2, text: `${label} needs a team lead.` });
    if (!t.cols.length) out.push({ step: 2, text: `${label} needs at least one column.` });
    t.cols.forEach((c, j) => {
      if (!c.name.trim()) out.push({ step: 2, text: `${label}: column ${j + 1} needs a name.` });
      if (!(c.est > 0)) out.push({ step: 2, text: `${label}: ${c.name || 'column ' + (j + 1)} needs a time estimate.` });
      if (!c.owners.length) out.push({ step: 2, text: `${label}: pick who is responsible for ${c.name || 'column ' + (j + 1)}.` });
    });
  });
  return out;
}

function LinePreview({ d }: { d: Draft }) {
  const people = usePeople();
  const totalH = d.teams.reduce((a, t) => a + t.cols.reduce((b, c) => b + (+c.est || 0), 0), 0);
  const arrow = <span className="lp-arrow"><Ic n="right" /></span>;
  return <div className="lp">
    <div className="lp-h"><span>The line, left to right</span><span>{d.teams.reduce((a, t) => a + t.cols.length, 0) + 2} columns · {totalH} h of estimated work</span></div>
    <div className="lp-row"><div className="lp-col fin"><b>To do</b><small>backlog</small></div>{arrow}
      {d.teams.map((t, i) => <span key={t.key} style={{ display: 'contents' }}>{i > 0 && arrow}<div className="lp-team" style={{ ['--tc' as string]: `var(${t.color})` }}>
        <div className="lp-tn">{t.name || `Team ${i + 1}`}{t.lead && <> <span>{people[t.lead]?.name}</span></>}</div>
        <div className="lp-cols">{t.cols.map(c => <div className="lp-col" key={c.key}><b>{c.name || 'Untitled'}</b><small>{+c.est || 0} h</small></div>)}</div></div></span>)}
      {arrow}<div className="lp-col fin"><b>Done</b><small>finish</small></div></div>
  </div>;
}

export function Builder({ me, admin, copyFrom }: { me: string; admin: boolean; copyFrom: ProjectShape[] }) {
  const people = usePeople(), toast = useToast(), router = useRouter();
  const pms = Object.values(people).filter(p => p.orgRole).sort((a, b) => a.name.localeCompare(b.name));
  const [d, setD] = useState<Draft>(() => ({ name: '', manager: admin ? (pms.find(p => p.orgRole === 'pm')?.id ?? me) : me, teams: template('campaign', copyFrom) }));
  const [step, setStep] = useState(1), [tpl, setTpl] = useState('campaign');
  const [pending, start] = useTransition();
  const probs = issues(d);
  // Leads and members: everyone except admins (they already see everything) and the manager.
  const everyone = Object.values(people).filter(p => !isAdminRole(p.orgRole) && p.id !== d.manager).sort((a, b) => a.name.localeCompare(b.name)).map(p => p.id);
  const upd = (fn: (x: Draft) => void) => setD(x => { const y: Draft = structuredClone(x); fn(y); return y; });
  const team = (i: number, fn: (t: DTeam) => void) => upd(x => fn(x.teams[i]));
  const swap = <T,>(arr: T[], i: number, dir: number) => { const [x] = arr.splice(i, 1); arr.splice(i + dir, 0, x); };
  const chip = (id: string, on: boolean, onClick: () => void) => <button key={id} type="button" className={`pchip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}><Av id={id} size="sm" />{people[id]?.name}</button>;
  const go = (s: number) => { setStep(s); document.querySelector('.b-body')?.scrollTo(0, 0); };
  const create = () => start(async () => {
    const r = await createProject({ name: d.name, manager: d.manager, teams: d.teams.map(t => ({ name: t.name, color: t.color, lead: t.lead, members: t.members, cols: t.cols.map(c => ({ name: c.name, est: +c.est, owners: c.owners })) })) });
    if (!r.ok) return toast(r.error);
    toast(`Created "${d.name.trim()}"`); router.push(`/p/${r.id}`); router.refresh();
  });

  return <div className="builder" role="dialog" aria-modal="true" aria-label="New project">
    <div className="b-head gutter">
      <div><small className="eyebrow">New project</small><h2>{d.name || 'Set up a production line'}</h2></div>
      <ol className="stepper">{['Project details', 'Teams & columns', 'Review & create'].map((n, i) => <li key={n} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}><button type="button" onClick={() => go(i + 1)}><span>{step > i + 1 ? '✓' : i + 1}</span>{n}</button></li>)}</ol>
      <Link className="icon-btn" href="/" aria-label="Close"><Ic n="x" s={18} /></Link>
    </div>
    <div className="b-body gutter">
      {step === 1 && <div className="b-narrow">
        <section className="b-sec"><h3>Start from</h3><div className="tpls">
          {[['campaign', 'Marketing campaign', '3 teams, 7 columns, from brief to live ads'], ['blank', 'Blank line', 'One team and one column to start'], ...copyFrom.map(p => [p.id, `Copy ${p.name}`, 'Same teams, columns and people, no tasks'])]
            .map(([key, n, sub]) => <button key={key} type="button" className={`tpl ${tpl === key ? 'on' : ''}`} onClick={() => { setTpl(key); upd(x => { x.teams = template(key, copyFrom); }); }}><b>{n}</b><small>{sub}</small></button>)}
        </div></section>
        <section className="b-sec">
          <div className="field"><label htmlFor="bName">Project name</label><input id="bName" value={d.name} maxLength={120} onChange={e => upd(x => { x.name = e.target.value; })} placeholder="Glow & Co: spring sale" autoFocus /></div>
          {admin ? <div className="field"><label htmlFor="bPm">Project manager</label><select id="bPm" value={d.manager} onChange={e => upd(x => { x.manager = e.target.value; x.teams.forEach(t => { if (t.lead === x.manager) t.lead = ''; t.members = t.members.filter(m => m !== x.manager); }); })}>{pms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            : <div className="field"><span className="flabel">Project manager</span><div className="pm-row"><Av id={me} /><span>{people[me]?.name} (you)</span></div></div>}
        </section></div>}

      {step === 2 && <><LinePreview d={d} /><div className="b-teams">
        {d.teams.map((t, i) => {
          const crew = [t.lead, ...t.members].filter(Boolean);
          return <section className="b-team" key={t.key} style={{ ['--tc' as string]: `var(${t.color})` }}>
            <div className="bt-head">
              <span className="bt-num">{i + 1}</span>
              <input className="bt-name" value={t.name} maxLength={60} onChange={e => team(i, x => { x.name = e.target.value; })} placeholder="Team name, e.g. Creative" aria-label={`Team ${i + 1} name`} />
              <div className="swatches" role="radiogroup" aria-label="Team color">{SWATCHES.map(sw => <button key={sw} type="button" className={`sw ${t.color === sw ? 'on' : ''}`} style={{ ['--c' as string]: `var(${sw})` }} aria-label="Color" aria-pressed={t.color === sw} onClick={() => team(i, x => { x.color = sw; })} />)}</div>
              <div className="bt-tools">
                <button type="button" className="icon-btn" disabled={i === 0} aria-label="Move team earlier" onClick={() => upd(x => swap(x.teams, i, -1))}><Ic n="left" /></button>
                <button type="button" className="icon-btn" disabled={i === d.teams.length - 1} aria-label="Move team later" onClick={() => upd(x => swap(x.teams, i, 1))}><Ic n="right" /></button>
                <button type="button" className="icon-btn" aria-label="Remove team" onClick={() => upd(x => { x.teams.splice(i, 1); })}><Ic n="x" /></button>
              </div>
            </div>
            <div className="bt-people">
              <div className="field"><label htmlFor={`lead-${t.key}`}>Team lead</label><select id={`lead-${t.key}`} value={t.lead} onChange={e => team(i, x => { x.lead = e.target.value; x.members = x.members.filter(m => m !== x.lead); })}><option value="">Choose a lead</option>{everyone.map(p => <option key={p} value={p}>{people[p].name}</option>)}</select></div>
              <div className="field"><span className="flabel">Members</span><div className="pchips">{everyone.filter(p => p !== t.lead).map(p => chip(p, t.members.includes(p), () => team(i, x => {
                x.members = x.members.includes(p) ? x.members.filter(m => m !== p) : [...x.members, p];
                if (!x.members.includes(p)) x.cols.forEach(c => { c.owners = c.owners.filter(o => o !== p); });
              })))}</div></div>
            </div>
            <div className="bt-cols">
              <div className="bc-h"><span /><span>Column</span><span>Time estimate</span><span>Responsible</span><span /></div>
              {t.cols.map((c, j) => <div className="bc" key={c.key}>
                <div className="bc-order"><button type="button" disabled={j === 0} aria-label="Move column up" onClick={() => team(i, x => swap(x.cols, j, -1))}>▲</button><button type="button" disabled={j === t.cols.length - 1} aria-label="Move column down" onClick={() => team(i, x => swap(x.cols, j, 1))}>▼</button></div>
                <input value={c.name} maxLength={40} placeholder="Column name" aria-label="Column name" onChange={e => team(i, x => { x.cols[j].name = e.target.value; })} />
                <span className="est-in"><input type="number" min="0.5" step="0.5" value={Number.isNaN(c.est) ? '' : c.est} aria-label="Hours" onChange={e => team(i, x => { x.cols[j].est = parseFloat(e.target.value); })} /><em>hours</em></span>
                <div className="pchips sm">{crew.length ? crew.map(p => chip(p, c.owners.includes(p), () => team(i, x => { const o = x.cols[j].owners; x.cols[j].owners = o.includes(p) ? o.filter(y => y !== p) : [...o, p]; }))) : <span className="muted">Pick a lead or members first</span>}</div>
                <button type="button" className="icon-btn" aria-label="Remove column" onClick={() => team(i, x => { x.cols.splice(j, 1); })}><Ic n="x" s={15} /></button>
              </div>)}
              <button type="button" className="add" onClick={() => team(i, x => { x.cols.push({ key: k(), name: '', est: 8, owners: [] }); })}><Ic n="plus" s={14} />Add column to {t.name || 'this team'}</button>
            </div>
          </section>;
        })}
        <button type="button" className="b-addteam" onClick={() => upd(x => { x.teams.push(blankTeam(x.teams.length)); })}><Ic n="plus" />Add team to the end of the line</button>
        <p className="muted b-note">Every project also gets a shared To do backlog at the start and a Done column at the end. Missing someone? A Super admin or Head of projects adds people on People & roles.</p>
      </div></>}

      {step === 3 && <div className="review">
        <div className="rv-top"><div><h3>{d.name || 'Untitled project'}</h3><p className="muted">Managed by {people[d.manager]?.name}</p></div></div>
        <LinePreview d={d} />
        <div className="rv-grid">{d.teams.map((t, i) => <div key={t.key} className="box-card rv-team" style={{ ['--tc' as string]: `var(${t.color})` }}><h4><span className="team-swatch" />{t.name || `Team ${i + 1}`}</h4>
          <ul className="people">{t.lead && <li><Av id={t.lead} />{people[t.lead]?.name} <span className="muted">lead</span></li>}{t.members.map(m => <li key={m}><Av id={m} />{people[m]?.name}</li>)}</ul></div>)}</div>
        {probs.length ? <div className="probs"><b>Fix these before creating the project</b><ul>{probs.map(p => <li key={p.text}><button type="button" className="link" onClick={() => go(p.step)}>{p.text}</button></li>)}</ul></div>
          : <div className="ready"><Ic n="ok" s={18} />Ready. The board opens with empty columns, and team leads can start adding tasks.</div>}
      </div>}
    </div>
    <div className="b-foot gutter">
      <Link className="btn" href="/">Cancel</Link>
      <div className="grow" />
      {step > 1 && <button className="btn" onClick={() => go(step - 1)}><Ic n="left" s={14} />Back</button>}
      {step < 3 ? <button className="btn primary" onClick={() => go(step + 1)}>Next<Ic n="right" s={14} /></button>
        : <button className="btn primary" disabled={probs.length > 0 || pending} onClick={create}><Ic n="plus" s={14} />Create project</button>}
    </div>
  </div>;
}

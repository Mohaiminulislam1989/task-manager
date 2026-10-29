'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Board, fmtDate, type Column, type ProjectShape, type Task } from '@/lib/rules';
import { Av, Ic, useNow, usePeople } from './ui';

type Status = 'overdue' | 'risk' | 'ontime' | 'done' | 'backlog';
const ST: Record<Status, string> = { overdue: 'Overdue', risk: 'At risk', ontime: 'On time', done: 'Finished', backlog: 'Backlog' };
const ICON: Record<Status, string> = { overdue: 'x', risk: 'clock', ontime: 'ok', done: 'check', backlog: 'plus' };
const ORDER: Status[] = ['overdue', 'risk', 'ontime', 'done', 'backlog'];
const BACKLOG_T = { id: '__backlog', name: 'Backlog', color: '--t6' };

type P = ProjectShape & { archived: Column[] };
interface Row { p: P; k: Task; where: string; special: boolean; t: { id: string; name: string; color: string }; status: Status; left: number; leftTxt: string }
const count = (list: Row[]) => list.reduce((a, r) => (a[r.status] = (a[r.status] ?? 0) + 1, a), {} as Partial<Record<Status, number>>);

function StackBar({ list }: { list: Row[] }) {
  const c = count(list), total = list.length;
  if (!total) return <div className="sbar empty" />;
  return <div className="sbar" role="img" aria-label={ORDER.map(s => `${ST[s]} ${c[s] ?? 0}`).join(', ')}>
    {ORDER.filter(s => c[s]).map(s => <span key={s} className={`sg st-${s}`} style={{ flex: c[s] }} title={`${ST[s]}: ${c[s]} of ${total}`} />)}
  </div>;
}
const StChip = ({ s }: { s: Status }) => <span className={`stchip st-${s}-t`}><Ic n={ICON[s]} s={12} />{ST[s]}</span>;
const Nums = ({ list }: { list: Row[] }) => { const c = count(list); return <><td className="n">{list.length}</td><td className={`n ${c.overdue ? 'hot' : ''}`}>{c.overdue ?? 0}</td><td className="n">{c.risk ?? 0}</td><td className="n">{c.ontime ?? 0}</td><td className="n">{c.done ?? 0}</td><td className="n">{c.backlog ?? 0}</td></>; };
const Head = ({ first }: { first: string }) => <thead><tr><th>{first}</th><th className="bar-col">Status mix</th><th className="n">Tasks</th><th className="n">Overdue</th><th className="n">At risk</th><th className="n">On time</th><th className="n">Finished</th><th className="n">Backlog</th></tr></thead>;

export function Dashboard({ admin, canCreate, projects, tasks }: { admin: boolean; canCreate: boolean; projects: P[]; tasks: (Task & { projectId: string })[] }) {
  const now = useNow(), people = usePeople(), router = useRouter();
  const [f, setF] = useState({ project: 'all', team: 'all', who: 'all', status: 'all' as 'all' | Status });
  const rows = useMemo(() => {
    const boards = new Map(projects.map(p => [p.id, new Board(p, { kind: 'pm' }, p.archived)]));
    return tasks.map((k): Row => {
      const b = boards.get(k.projectId)!, p = b.p as P, c = b.col(k.col)!;
      const special = 'special' in c && !!c.special;
      const t = k.col === 'todo' ? BACKLOG_T : b.team(special ? k.lastTeam : c.teamId) ?? BACKLOG_T;
      const ds = b.dlStatus(k, now);
      const status: Status = k.col === 'todo' ? 'backlog' : k.col === 'done' ? 'done' : ds.lv === 'bad' ? 'overdue' : ds.lv === 'warn' ? 'risk' : 'ontime';
      return { p, k, where: special ? c.name : `${t.name} / ${c.name}`, special, t, status, left: ds.left, leftTxt: b.left(ds.left) };
    });
  }, [projects, tasks, now]);

  const inProj = rows.filter(r => f.project === 'all' || r.p.id === f.project);
  const teamsAvail = [...new Map(inProj.map(r => [r.t.id, r])).values()];
  const peopleAvail = [...new Set(inProj.flatMap(r => r.k.assignees))].filter(id => people[id]).sort((a, b) => people[a].name.localeCompare(people[b].name));
  const shown = inProj.filter(r => (f.team === 'all' || r.t.id === f.team) && (f.who === 'all' || r.k.assignees.includes(f.who)) && (f.status === 'all' || r.status === f.status));
  const c = count(shown), total = shown.length;
  const multi = f.project === 'all' && projects.length > 1;
  const filtered = f.project !== 'all' || f.team !== 'all' || f.who !== 'all' || f.status !== 'all';
  const pct = (n: number) => total ? `${Math.round(n / total * 100)}% of tasks` : 'no tasks';
  const toggle = (k: 'team' | 'who' | 'status', v: string) => setF(x => ({ ...x, [k]: x[k] === v ? 'all' : v }));
  const byTeam = teamsAvail.map(x => ({ t: x.t, p: x.p, list: shown.filter(r => r.t.id === x.t.id) })).filter(g => g.list.length || f.team === 'all');
  const byWho = peopleAvail.map(id => ({ id, list: shown.filter(r => r.k.assignees.includes(id)), teams: [...new Set(inProj.filter(r => r.k.assignees.includes(id)).map(r => r.t.name))] }))
    .filter(g => g.list.length).sort((a, b) => (count(b.list).overdue ?? 0) - (count(a.list).overdue ?? 0) || b.list.length - a.list.length);
  const sorted = [...shown].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.k.deadline ?? Infinity) - (b.k.deadline ?? Infinity));

  const Tile = ({ k, label, n, sub }: { k: Status | 'all'; label: string; n: number; sub: string }) =>
    <button className={`tile ${k !== 'all' ? `st-${k}-tile` : ''} ${f.status === k && k !== 'all' ? 'on' : ''}`} onClick={() => k === 'all' ? setF(x => ({ ...x, status: 'all' })) : toggle('status', k)}>
      <span className="tl">{k !== 'all' && <Ic n={ICON[k]} s={14} />}{label}</span><b>{n}</b><small>{sub}</small></button>;
  const Sel = ({ id, label, value, opts, on }: { id: string; label: string; value: string; opts: [string, string][]; on: (v: string) => void }) =>
    <div className="field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={e => on(e.target.value)}>{opts.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>;

  return <main className="pane gutter">
    <div className="pane-head"><div><h1>Dashboard</h1><p className="muted">{admin ? 'All projects in the organisation' : `Projects you manage (${projects.length})`} · as of {fmtDate(now)}</p></div></div>
    {projects.length ? <>
      <div className="filters">
        <Sel id="dfProject" label="Project" value={f.project} on={v => setF(x => ({ ...x, project: v, team: 'all' }))} opts={[['all', 'All projects'], ...projects.map(p => [p.id, p.name] as [string, string])]} />
        <Sel id="dfTeam" label="Team" value={f.team} on={v => setF(x => ({ ...x, team: v }))} opts={[['all', 'All teams'], ...teamsAvail.map(x => [x.t.id, x.t.name + (multi && x.t.id !== BACKLOG_T.id ? ' · ' + x.p.name.split(':')[0] : '')] as [string, string])]} />
        <Sel id="dfWho" label="Assignee" value={f.who} on={v => setF(x => ({ ...x, who: v }))} opts={[['all', 'Everyone'], ...peopleAvail.map(id => [id, people[id].name] as [string, string])]} />
        <Sel id="dfStatus" label="Status" value={f.status} on={v => setF(x => ({ ...x, status: v as Status | 'all' }))} opts={[['all', 'Any status'], ...Object.entries(ST) as [string, string][]]} />
        {filtered && <button className="btn" onClick={() => setF({ project: 'all', team: 'all', who: 'all', status: 'all' })}>Clear filters</button>}
      </div>
      <div className="tiles">
        <Tile k="all" label="Tasks" n={total} sub={multi ? `across ${new Set(shown.map(r => r.p.id)).size} projects` : 'in view'} />
        <Tile k="overdue" label="Overdue" n={c.overdue ?? 0} sub={pct(c.overdue ?? 0)} />
        <Tile k="risk" label="At risk" n={c.risk ?? 0} sub="past 80% of deadline time" />
        <Tile k="ontime" label="On time" n={c.ontime ?? 0} sub={pct(c.ontime ?? 0)} />
        <Tile k="done" label="Finished" n={c.done ?? 0} sub={pct(c.done ?? 0)} />
        <Tile k="backlog" label="Backlog" n={c.backlog ?? 0} sub="not started yet" />
      </div>
      <div className="legend-st">{ORDER.map(s => <span key={s}><i className={`st-${s}`} />{ST[s]}</span>)}</div>
      <div className="dgrid">
        <section className="panel"><div className="panel-h"><h2>By team</h2><span className="muted">Click a row to filter</span></div>
          <div className="tbl-wrap"><table className="tbl"><Head first="Team" /><tbody>
            {byTeam.length ? byTeam.map(g => <tr key={g.t.id + g.p.id} className={`click ${f.team === g.t.id ? 'sel' : ''}`} onClick={() => toggle('team', g.t.id)} style={{ ['--tc' as string]: `var(${g.t.color})` }}>
              <td><span className="tname"><span className="team-swatch" /><span><b>{g.t.name}</b>{multi && g.t.id !== BACKLOG_T.id && <small>{g.p.name}</small>}</span></span></td>
              <td className="bar-col"><StackBar list={g.list} /></td><Nums list={g.list} /></tr>)
              : <tr><td colSpan={8} className="muted">No tasks match these filters.</td></tr>}
          </tbody></table></div></section>
        <section className="panel"><div className="panel-h"><h2>By team member</h2><span className="muted">Sorted by overdue tasks</span></div>
          <div className="tbl-wrap"><table className="tbl"><Head first="Person" /><tbody>
            {byWho.length ? byWho.map(g => <tr key={g.id} className={`click ${f.who === g.id ? 'sel' : ''}`} onClick={() => toggle('who', g.id)}>
              <td><span className="tname"><Av id={g.id} /><span><b>{people[g.id].name}</b><small>{g.teams.join(', ')}</small></span></span></td>
              <td className="bar-col"><StackBar list={g.list} /></td><Nums list={g.list} /></tr>)
              : <tr><td colSpan={8} className="muted">No assigned tasks match these filters.</td></tr>}
          </tbody></table></div></section>
      </div>
      <section className="panel"><div className="panel-h"><h2>Tasks <span className="n-badge">{total}</span></h2><span className="muted">Overdue first. Click a task to open it.</span></div>
        <div className="tbl-wrap"><table className="tbl tasks"><thead><tr><th>Task</th><th>Where</th><th>Assignee</th><th>Deadline</th><th>Status</th></tr></thead><tbody>
          {sorted.length ? sorted.map(r => <tr key={r.k.id} className="click" onClick={() => router.push(`/p/${r.p.id}?task=${r.k.id}`)}>
            <td><Link href={`/p/${r.p.id}?task=${r.k.id}`} onClick={e => e.stopPropagation()} className="plain"><b>{r.k.title}</b></Link>{multi && <small>{r.p.name}</small>}</td>
            <td><span className="where" style={{ ['--tc' as string]: `var(${r.t.color})` }}><span className="team-swatch" />{r.where}</span></td>
            <td><span className="avs">{r.k.assignees.map(a => <Av key={a} id={a} size="sm" />)}</span> {r.k.assignees.map(a => people[a]?.name).join(', ')}</td>
            <td className="mono">{r.k.deadline ? fmtDate(r.k.deadline, true) : 'No deadline'}{r.k.deadline && r.status !== 'done' && r.status !== 'backlog' && <small className={r.left < 0 ? 'hot' : ''}>{r.leftTxt}</small>}</td>
            <td><StChip s={r.status} /></td></tr>)
            : <tr><td colSpan={5} className="muted">No tasks match these filters.</td></tr>}
        </tbody></table></div></section>
    </> : <div className="panel empty-state"><h2>No projects yet</h2><p className="muted">Projects you manage will be reported here.</p>{canCreate && <Link className="btn primary" href="/new"><Ic n="plus" s={14} />New project</Link>}</div>}
  </main>;
}

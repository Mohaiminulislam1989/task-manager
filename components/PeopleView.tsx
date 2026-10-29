'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ORG, assignable, isAdminRole, type OrgRole, type ProjectShape, type Team } from '@/lib/rules';
import { addPerson, setOrgRole, setProjectManager, setTeamPlacement } from '@/app/actions';
import { Av, Ic, usePeople, useToast } from './ui';
import { Modal } from './Dialogs';

type Proj = ProjectShape & { taskCount: number };
type Place = { p: Proj; t?: Team; kind: 'pm' | 'lead' | 'member' };
type Kind = 'admin' | 'pm' | 'lead' | 'member' | 'none';
type Res = { ok: true; msg?: string } | { ok: false; error: string };

const ROLE_INFO: [string, string, string, string[]][] = [
  ['super', 'Super admin', 'Everything, in every project.', ['Gives any role, including Super admin and Head of projects', 'Assigns project managers', 'Sees every dashboard']],
  ['head', 'Head of projects', 'Everything, in every project.', ['Adds project managers', 'Assigns team leads and members', 'Sees every dashboard']],
  ['pm', 'Project manager', 'Full control of the projects they manage.', ['Creates projects, teams and columns', 'Moves any card, reopens finished tasks', 'Sees the dashboard for their projects']],
  ['lead', 'Team lead', 'Runs one team inside a project.', ['Adds tasks and backlog items, renames tasks and columns', 'Hands over, sends back, marks done', 'Moves cards in their own team']],
  ['member', 'Team member', 'Works the cards in their team.', ['Moves cards inside their team', 'Comments, attaches files, ticks subtasks', 'Views other teams read-only']],
];
const FILTERS: [Kind | 'all', string][] = [['all', 'Everyone'], ['admin', 'Admins'], ['pm', 'Project managers'], ['lead', 'Team leads'], ['member', 'Members'], ['none', 'Not on a project']];
const short = (p: Proj) => p.name.split(':')[0];

export function PeopleView({ me, projects }: { me: { id: string; orgRole: OrgRole }; projects: Proj[] }) {
  const people = usePeople(), toast = useToast(), router = useRouter();
  const [tab, setTab] = useState<'people' | 'projects' | 'roles'>('people');
  const [q, setQ] = useState(''), [filter, setFilter] = useState<Kind | 'all'>('all');
  const [dlg, setDlg] = useState<null | { kind: 'manage'; id: string } | { kind: 'add' } | { kind: 'password'; name: string; email: string; password: string }>(null);
  const [, start] = useTransition();
  const can = assignable(me.orgRole);
  const ids = Object.keys(people).sort((a, b) => people[a].name.localeCompare(people[b].name));

  const placements = (id: string) => projects.flatMap((p): Place[] => [
    ...(p.managerId === id ? [{ p, kind: 'pm' } as Place] : []),
    ...p.teams.flatMap((t): Place[] => t.leadId === id ? [{ p, t, kind: 'lead' }] : t.memberIds.includes(id) ? [{ p, t, kind: 'member' }] : []),
  ]);
  const kinds = (id: string): Record<Kind, boolean> => {
    const pl = placements(id), r = people[id].orgRole;
    return { admin: isAdminRole(r), pm: r === 'pm' || pl.some(x => x.kind === 'pm'), lead: pl.some(x => x.kind === 'lead'), member: pl.some(x => x.kind === 'member'), none: !pl.length };
  };
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? ids.length : ids.filter(id => kinds(id)[k]).length]));
  const shown = ids.filter(id => (filter === 'all' || kinds(id)[filter]) && (!q || `${people[id].name} ${people[id].email}`.toLowerCase().includes(q.toLowerCase())));
  const pms = ids.filter(id => people[id].orgRole);

  const run = (fn: () => Promise<Res>) => start(async () => { const r = await fn(); toast(r.ok ? r.msg ?? 'Saved' : r.error); if (r.ok) router.refresh(); });

  const PlaceChip = ({ x }: { x: Place }) => x.kind === 'pm'
    ? <span className="rchip pm"><Ic n="user" s={12} />{short(x.p)} <em>Manager</em></span>
    : <span className="rchip" style={{ ['--tc' as string]: `var(${x.t!.color})` }}><span className="sw" />{short(x.p)} <em>{x.kind === 'lead' ? 'Lead' : 'Member'} · {x.t!.name}</em></span>;

  return <main className="pane gutter">
    <div className="pane-head"><div><h1>People & roles</h1><p className="muted">You are {me.orgRole ? ORG[me.orgRole] : 'a team member'}. {me.orgRole === 'super' ? 'You can give any role, including Super admin and Head of projects.' : 'You can add project managers, assign them to projects, and set team leads and members.'}</p></div>
      <button className="btn primary" onClick={() => setDlg({ kind: 'add' })}><Ic n="plus" s={14} />Add person</button></div>
    <div className="ptabs" role="tablist">{([['people', 'People', ids.length], ['projects', 'Projects', projects.length], ['roles', 'What each role can do', null]] as const).map(([k, n, c]) =>
      <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}{c != null && <span>{c}</span>}</button>)}</div>

    {tab === 'people' && <>
      <div className="ptools">
        <label className="search psearch"><Ic n="search" s={15} /><input type="search" placeholder="Search by name or email" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" /></label>
        <div className="fchips" role="group" aria-label="Filter by role">{FILTERS.map(([k, n]) => <button key={k} className={`fchip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{n}<span>{counts[k]}</span></button>)}</div>
      </div>
      <div className="plist">
        <div className="prow phead" aria-hidden="true"><span>Person</span><span>Organisation role</span><span>Projects and teams</span><span /></div>
        {shown.map(id => {
          const r = people[id].orgRole, editable = id !== me.id && can.length > 0 && (!r || can.includes(r));
          const opts: [string, string][] = [['', 'No organisation role'], ...(['super', 'head', 'pm'] as const).filter(k => k === r || can.includes(k)).map(k => [k, ORG[k]] as [string, string])];
          const pl = placements(id);
          return <div className="prow" key={id}>
            <div className="pcell who"><Av id={id} size="lg" /><span><b>{people[id].name}{id === me.id && <> <i className="you">You</i></>}</b><small>{people[id].email}</small></span></div>
            <div className="pcell"><span className="plabel">Organisation role</span>{editable
              ? <select className="sel" value={r ?? ''} aria-label={`Organisation role for ${people[id].name}`} onChange={e => run(() => setOrgRole(id, e.target.value as '' | 'pm'))}>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
              : <span className={`orgtag ${r ?? ''}`}>{r ? ORG[r] : 'None'}</span>}</div>
            <div className="pcell"><span className="plabel">Projects and teams</span><div className="rchips">{pl.length ? pl.map((x, i) => <PlaceChip key={i} x={x} />) : <span className="muted">Not on a project yet</span>}</div></div>
            <div className="pcell act"><button className="btn sm" onClick={() => setDlg({ kind: 'manage', id })}>Manage</button></div>
          </div>;
        })}
        {!shown.length && <div className="pempty muted">Nobody matches. Try another name or filter.</div>}
      </div>
    </>}

    {tab === 'projects' && <div className="pgrid">{projects.map(p => <article className="projcard" key={p.id}>
      <div className="pc-h"><h3>{p.name}</h3><span className="muted">{p.taskCount} tasks</span></div>
      <div className="field"><label htmlFor={`pm-${p.id}`}>Project manager</label><select className="sel" id={`pm-${p.id}`} value={p.managerId} onChange={e => run(() => setProjectManager(p.id, e.target.value))}>
        {[...new Set([p.managerId, ...pms])].map(id => <option key={id} value={id}>{people[id]?.name}{people[id]?.orgRole ? ` · ${ORG[people[id].orgRole!]}` : ''}</option>)}</select></div>
      <ul className="pc-teams">{p.teams.map(t => <li key={t.id} style={{ ['--tc' as string]: `var(${t.color})` }}><span className="sw" /><div><b>{t.name}</b><small>{t.leadId ? `Lead ${people[t.leadId]?.name}` : 'No lead'} · {t.memberIds.length} member{t.memberIds.length === 1 ? '' : 's'}</small></div>
        <span className="avs">{[t.leadId, ...t.memberIds].filter(Boolean).map(a => <Av key={a} id={a!} size="sm" />)}</span></li>)}</ul>
    </article>)}</div>}

    {tab === 'roles' && <div className="rgrid">{ROLE_INFO.map(([k, n, d, list]) => <article key={k} className={`rcard ${k}`}><h3>{n}</h3><p>{d}</p><ul>{list.map(x => <li key={x}><Ic n="ok" s={14} />{x}</li>)}</ul>
      <small>{ids.filter(id => k === 'lead' || k === 'member' ? kinds(id)[k] : people[id].orgRole === k).length} people</small></article>)}</div>}

    {dlg?.kind === 'manage' && <ManageDialog id={dlg.id} projects={projects} places={placements(dlg.id)} onClose={() => setDlg(null)} run={run} />}
    {dlg?.kind === 'add' && <AddPersonDialog can={can} projects={projects} onClose={() => setDlg(null)} onAdded={(name, email, password) => { setDlg({ kind: 'password', name, email, password }); router.refresh(); }} />}
    {dlg?.kind === 'password' && <Modal onClose={() => setDlg(null)}>
      <div><h2>{dlg.name} can sign in now</h2><p className="lead">Send them these details. They will be asked to choose their own password the first time they sign in. This password is not shown again.</p></div>
      <div className="creds"><div><span className="flabel">Email</span><code>{dlg.email}</code></div><div><span className="flabel">Temporary password</span><code>{dlg.password}</code></div></div>
      <div className="actions"><button className="btn" onClick={() => { navigator.clipboard?.writeText(`Sign in at ${location.origin}/login\nEmail: ${dlg.email}\nTemporary password: ${dlg.password}`); toast('Copied'); }}>Copy details</button><button className="btn primary" onClick={() => setDlg(null)}>Done</button></div>
    </Modal>}
  </main>;
}

function TeamPicker({ projects, required }: { projects: Proj[]; required?: boolean }) {
  const [pid, setPid] = useState('');
  const p = projects.find(x => x.id === pid);
  return <>
    <div className="row2">
      <div className="field"><label htmlFor="pProj">Project</label><select id="pProj" name="projectId" value={pid} onChange={e => setPid(e.target.value)} required={required}><option value="">{required ? 'Choose a project' : 'No team for now'}</option>{projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
      <div className="field"><label htmlFor="pTeam">Team</label><select id="pTeam" name="teamId" disabled={!p} key={pid}>{p ? p.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>) : <option value="">Pick a project first</option>}</select></div>
    </div>
    <div className="field"><label htmlFor="pRole">Team role</label><select id="pRole" name="teamRole"><option value="member">Member</option><option value="lead">Lead (the current lead stays on as a member)</option></select></div>
  </>;
}

function ManageDialog({ id, projects, places, onClose, run }: { id: string; projects: Proj[]; places: Place[]; onClose: () => void; run: (fn: () => Promise<Res>) => void }) {
  const people = usePeople(), p = people[id];
  const teams = places.filter(x => x.kind !== 'pm'), mgr = places.filter(x => x.kind === 'pm');
  return <Modal onClose={onClose}>
    <div className="dlg-person"><Av id={id} size="xl" /><div><h2>{p.name}</h2><p className="lead">{p.email} · {p.orgRole ? ORG[p.orgRole] : 'No organisation role'}</p></div></div>
    <div><h3 className="mini-h">Current teams</h3>{teams.length || mgr.length ? <ul className="placelist">
      {mgr.map(x => <li key={x.p.id}><span className="rchip pm"><Ic n="user" s={12} />{short(x.p)}</span><span className="muted">Project manager. Change it on the Projects tab.</span></li>)}
      {teams.map(x => <li key={x.t!.id}><span className="rchip" style={{ ['--tc' as string]: `var(${x.t!.color})` }}><span className="sw" />{short(x.p)} · {x.t!.name}</span>
        <select className="sel sm" value={x.kind} aria-label={`Role in ${x.t!.name}`} onChange={e => run(() => setTeamPlacement(id, x.t!.id, e.target.value as 'lead' | 'member'))}><option value="member">Member</option><option value="lead">Lead</option></select>
        <button className="icon-btn sm" aria-label={`Remove from ${x.t!.name}`} title="Remove from team" onClick={() => run(() => setTeamPlacement(id, x.t!.id, 'remove'))}><Ic n="x" s={15} /></button></li>)}
    </ul> : <p className="muted">Not on any team yet.</p>}</div>
    <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget), tid = String(fd.get('teamId') ?? '');
      if (!tid) return;
      run(() => setTeamPlacement(id, tid, String(fd.get('teamRole')) as 'lead' | 'member'));
    }}>
      <h3 className="mini-h" style={{ margin: '4px 0 -6px' }}>Add to a team</h3>
      <TeamPicker projects={projects} required />
      <div className="actions"><button type="button" className="btn" onClick={onClose}>Done</button><button className="btn primary" type="submit">Add to team</button></div>
    </form>
  </Modal>;
}

function AddPersonDialog({ can, projects, onClose, onAdded }: { can: Exclude<OrgRole, null>[]; projects: Proj[]; onClose: () => void; onAdded: (name: string, email: string, password: string) => void }) {
  const toast = useToast(), [pending, start] = useTransition();
  return <Modal onClose={onClose}>
    <div><h2>Add person</h2><p className="lead">They get a temporary password to sign in with. Give an organisation role, a team role, or both.</p></div>
    <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => { const r = await addPerson(fd); if (r.ok && r.password) onAdded(String(fd.get('name')), String(fd.get('email')).toLowerCase(), r.password); else if (!r.ok) toast(r.error); });
    }}>
      <div className="row2"><div className="field"><label htmlFor="pName">Full name</label><input id="pName" name="name" required maxLength={80} placeholder="Shirin Akter" autoFocus /></div>
        <div className="field"><label htmlFor="pEmail">Work email</label><input id="pEmail" name="email" type="email" required placeholder="shirin@agency.example" /></div></div>
      <div className="field"><label htmlFor="pOrg">Organisation role</label><select id="pOrg" name="orgRole"><option value="">None, team role only</option>{can.map(k => <option key={k} value={k}>{ORG[k]}</option>)}</select></div>
      <TeamPicker projects={projects} />
      <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={pending}><Ic n="plus" s={14} />Add person</button></div>
    </form>
  </Modal>;
}

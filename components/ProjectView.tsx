'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Board, DONE, TODO, fmtDate, roleIn, type AnyCol, type Column, type OrgRole, type ProjectShape, type Task } from '@/lib/rules';
import { moveTask, renameColumn, renameProject, renameTeam } from '@/app/actions';
import { Av, Avs, Ic, useNow, usePeople, useSearch, useToast } from './ui';
import { Drawer } from './Drawer';
import { AddColumnDialog, AddTaskDialog, MoveDialog, RemoveColumnDialog } from './Dialogs';
import { InlineName } from './InlineName';
import type { MentionItem } from './MentionTextarea';

export type BoardTask = Task & { commentCount: number; fileCount: number };
export interface Snapshot { project: ProjectShape & { archived: Column[] }; tasks: BoardTask[]; me: { id: string; orgRole: OrgRole } }
export type DialogState =
  | { kind: 'move'; task: BoardTask; to: string }
  | { kind: 'add'; col: string }
  | { kind: 'addcol'; team: string }
  | { kind: 'rmcol'; col: Column }
  | null;

const lvWord: Record<string, string> = { ok: 'On track', warn: 'Running late', bad: 'Over time', done: 'Finished', todo: 'Not started' };

export function useBoard(snap: Snapshot) {
  return useMemo(() => new Board(snap.project, roleIn(snap.project, snap.me.id, snap.me.orgRole), snap.project.archived), [snap]);
}

export function useMentionItems(b: Board, extraAdmins: string[]): MentionItem[] {
  const people = usePeople();
  return useMemo(() => {
    const ids = [...new Set([...extraAdmins, b.p.managerId, ...b.teams.flatMap(t => [t.leadId, ...t.memberIds])].filter(Boolean) as string[])];
    const sub = (id: string) => { const r = roleIn(b.p, id, people[id]?.orgRole ?? null); return !r ? '' : r.admin ? 'Admin' : r.kind === 'pm' ? 'Project manager' : `${r.kind === 'lead' ? 'Lead' : 'Member'} · ${b.team(r.team)?.name}`; };
    return [...ids.filter(id => people[id]).map(id => ({ kind: 'user' as const, id, name: people[id].name, sub: sub(id) })),
      ...b.teams.map(t => ({ kind: 'team' as const, id: t.id, name: t.name, color: t.color, sub: `Whole team · ${[t.leadId, ...t.memberIds].filter(Boolean).length} people` }))];
  }, [b, people, extraAdmins]);
}

export function ProjectView({ snap, initialTask }: { snap: Snapshot; initialTask?: string | null }) {
  const b = useBoard(snap);
  const people = usePeople();
  const admins = useMemo(() => Object.values(people).filter(p => p.orgRole === 'super' || p.orgRole === 'head').map(p => p.id), [people]);
  const mentionItems = useMentionItems(b, admins);
  const now = useNow();
  const toast = useToast();
  const router = useRouter();
  const [q] = useSearch();
  const [layout, setLayout] = useState<'board' | 'list'>('board');
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<string | null>(initialTask ?? null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [, start] = useTransition();
  const me = snap.me.id, r = b.role!;
  useEffect(() => { if (initialTask) setOpen(initialTask); }, [initialTask]);

  const matches = (k: BoardTask) => (!mine || k.assignees.includes(me)) && (!q || (k.title + ' ' + k.desc).toLowerCase().includes(q.toLowerCase()));

  const requestMove = (tk: BoardTask, to: string) => {
    const rule = b.moveRule(tk, to);
    if (!rule.ok) { if (rule.why) toast(rule.why); return; }
    if (rule.needsComment || rule.needsDeadline) return setDialog({ kind: 'move', task: tk, to });
    const fd = new FormData(); fd.set('taskId', tk.id); fd.set('to', to);
    start(async () => { const res = await moveTask(fd); toast(res.ok ? res.msg ?? 'Moved' : res.error); router.refresh(); });
  };

  const hint = r.admin ? 'You can edit everything in every project, and manage people and roles.' : r.kind === 'pm' ? 'You can edit and move everything in this project.'
    : r.kind === 'lead' ? `Add tasks, move cards in ${b.team(r.team)?.name}, hand over to the next team or send back.` : `Move cards within ${b.team(r.team)?.name}. Other teams are view only.`;
  const roleLabel = r.admin ? (snap.me.orgRole === 'super' ? 'Super admin' : 'Head of projects') : r.kind === 'pm' ? 'Project manager' : `${r.kind === 'lead' ? 'Lead' : 'Member'}, ${b.team(r.team)?.name}`;

  const dropProps = (colId: string) => ({
    'data-col': colId,
    className: dragId && b.moveRule(snap.tasks.find(t => t.id === dragId)!, colId).ok ? 'drop-ok' : '',
    onDragOver: (e: React.DragEvent) => { if (dragId && b.moveRule(snap.tasks.find(t => t.id === dragId)!, colId).ok) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const tk = snap.tasks.find(t => t.id === dragId); setDragId(null); if (tk) requestMove(tk, colId); },
  });

  const card = (k: BoardTask, canDrag: boolean) => {
    const cs = b.colStatus(k, now), ds = b.dlStatus(k, now);
    const done = k.subtasks.filter(s => s.done).length, overdue = k.subtasks.filter(s => !s.done && s.deadline && s.deadline < now).length;
    return <article key={k.id} className={`card ${cs.lv === 'done' ? 'done' : cs.lv === 'todo' ? 'todo' + (ds.lv === 'none' ? '' : ' bg-' + ds.lv) : 'bg-' + ds.lv} ${matches(k) ? '' : 'dim'} ${dragId === k.id ? 'dragging' : ''}`}
      draggable={canDrag} tabIndex={0} aria-label={k.title} onClick={() => setOpen(k.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(k.id); } }}
      onDragStart={e => { setDragId(k.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k.id); }} onDragEnd={() => setDragId(null)}>
      <span className={`dot s-${cs.lv}`} title={cs.lv === 'done' ? 'Finished' : cs.lv === 'todo' ? 'Not started' : b.left(cs.left) + ' in this column'} />
      <span className={`timer t-${cs.lv}`}>{cs.lv === 'done' ? <><Ic n="ok" s={13} />Finished {fmtDate(k.entered, true).split(',')[0]}</> : cs.lv === 'todo' ? 'Not started' : <><Ic n="clock" s={13} />{b.left(cs.left)}</>}</span>
      <h4>{k.title}</h4>
      <div className="c-meta">
        <span className={`m ${ds.lv === 'bad' ? 'bad' : ''}`} title="Overall deadline"><Ic n="cal" s={13} />{k.deadline ? fmtDate(k.deadline, true).split(',')[0] : 'No deadline'}</span>
        {k.subtasks.length > 0 && <span className={`m ${overdue ? 'bad' : ''}`} title={overdue ? `${overdue} overdue` : 'Subtasks'}><Ic n="check" s={13} />{done}/{k.subtasks.length}</span>}
        {k.commentCount > 0 && <span className="m" title="Comments"><Ic n="chat" s={13} />{k.commentCount}</span>}
        {k.fileCount > 0 && <span className="m" title="Attachments"><Ic n="clip" s={13} />{k.fileCount}</span>}
        {!canDrag && <span className="view-only"><Ic n="lock" s={12} /></span>}
        <Avs ids={k.assignees} />
      </div>
      {k.subtasks.length > 0 && <div className="mini-prog"><span style={{ width: `${done / k.subtasks.length * 100}%` }} /></div>}
    </article>;
  };

  const lane = (c: typeof TODO | typeof DONE) => {
    const cards = snap.tasks.filter(k => k.col === c.id).sort((a, z) => c.id === 'done' ? z.entered - a.entered : 0);
    const canDrag = c.id === 'todo' ? b.canBacklog() : b.isPM;
    const dp = dropProps(c.id);
    if (!expanded[c.id]) return <button key={c.id} {...dp} className={`strip lane-strip ${c.id === 'todo' ? 'lane-todo' : 'lane-done'} ${dp.className}`} style={{ ['--tc' as string]: 'var(--t6)' }} onClick={() => setExpanded(x => ({ ...x, [c.id]: true }))} title={`Open ${c.name}`}>
      <span className="lane-ic"><Ic n={c.id === 'todo' ? 'plus' : 'ok'} s={15} /></span><span className="n">{cards.length}</span><span className="name">{c.name}</span><span className="peek"><Ic n="right" s={15} /></span></button>;
    return <section key={c.id} className={`team lane ${c.id === 'todo' ? 'lane-todo' : 'lane-done'}`} style={{ ['--tc' as string]: 'var(--t6)' }}>
      <div className="team-head"><div className="team-id"><span className="lane-ic"><Ic n={c.id === 'todo' ? 'plus' : 'ok'} /></span><div><h2>{c.name}</h2>
        <div className="sub">{c.id === 'todo' ? 'Backlog for later · no clock' : 'Finished work · clocks stopped'}</div></div></div>
        <div className="team-right"><span className="n-badge">{cards.length}</span><button className="ghost" onClick={() => setExpanded(x => ({ ...x, [c.id]: false }))}>Collapse</button></div></div>
      <div className="cols"><div {...dp} className={`col ${dp.className}`}>
        <div className="col-body">{cards.length ? cards.map(k => card(k, canDrag)) : <div className="empty-col">{c.id === 'todo' ? 'Nothing in the backlog' : 'Nothing finished yet'}</div>}</div>
        {c.id === 'todo' && b.canBacklog() && <button className="add" onClick={() => setDialog({ kind: 'add', col: 'todo' })}><Ic n="plus" s={14} />Add to backlog</button>}
      </div></div></section>;
  };

  const openTask = snap.tasks.find(t => t.id === open) ?? null;

  return <>
    <section className="page gutter">
      <div className="page-top">
        <div><h1>{b.canRenameProject() ? <InlineName value={snap.project.name} label="project" maxLength={120} save={n => renameProject(snap.project.id, n)} /> : snap.project.name}</h1><p className="hint"><span className="role-chip"><Ic n="user" s={13} />{roleLabel}</span>{hint}</p></div>
        <div className="tools">
          <div className="seg layout" role="group" aria-label="Layout">{(['board', 'list'] as const).map(l => <button key={l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)}>{l === 'board' ? 'Board' : 'List'}</button>)}</div>
          <div className="seg" role="group" aria-label="Filter cards"><button className={!mine ? 'on' : ''} onClick={() => setMine(false)}>All cards</button><button className={mine ? 'on' : ''} onClick={() => setMine(true)}>My cards</button></div>
        </div>
      </div>
      <div className="legend">
        <span><i className="s-ok" /><i className="s-warn" /><i className="s-bad" /> Dot: time in the current column, yellow at 80%, red when over</span>
        <span><b style={{ background: 'color-mix(in srgb,var(--ok) 7%,var(--surface))' }} /><b style={{ background: 'color-mix(in srgb,var(--warn) 13%,var(--surface))' }} /><b style={{ background: 'color-mix(in srgb,var(--bad) 10%,var(--surface))' }} /> Card color: time to the overall deadline</span>
        <span className="muted">Counted in <Link href="/hours" className="link">working hours</Link></span>
      </div>
    </section>

    {layout === 'board' ? <div className="board-wrap gutter"><div className="board">
      {lane(TODO)}
      {b.teams.map((t, ti) => {
        const mineTeam = b.canWorkIn(t.id), cols = b.teamCols(t.id);
        const tasks = snap.tasks.filter(k => cols.some(c => c.id === k.col));
        if (!mineTeam && !expanded[t.id]) return <button key={t.id} className="strip" style={{ ['--tc' as string]: `var(${t.color})` }} onClick={() => setExpanded(x => ({ ...x, [t.id]: true }))} title={`Open ${t.name} (view only)`}>
          <span className="team-swatch" /><span className="n">{tasks.length}</span><span className="dots">{tasks.map(k => <i key={k.id} className={`s-${b.colStatus(k, now).lv}`} />)}</span>
          <span className="name">{t.name}</span><span className="peek"><Ic n="eye" /></span></button>;
        return <section key={t.id} className="team" style={{ ['--tc' as string]: `var(${t.color})` }}>
          <div className="team-head">
            <div className="team-id"><span className="team-swatch" /><div><h2>{b.canRenameTeam(t.id) ? <InlineName value={t.name} label="team" maxLength={60} save={n => renameTeam(t.id, n)} /> : t.name}</h2><div className="sub">Step {ti + 1} of {b.teams.length}{t.leadId ? ` · Lead ${people[t.leadId]?.name}` : ''}</div></div></div>
            <div className="team-right"><Avs ids={[t.leadId, ...t.memberIds].filter(Boolean) as string[]} />
              {mineTeam ? (!b.isPM && <span className="team-tag">Your team</span>) : <><span className="team-tag"><Ic n="lock" s={12} />View only</span><button className="ghost" onClick={() => setExpanded(x => ({ ...x, [t.id]: false }))}>Collapse</button></>}
              {b.canEditCols(t.id) && <button className="btn sm" onClick={() => setDialog({ kind: 'addcol', team: t.id })}><Ic n="plus" s={13} />Column</button>}
            </div>
          </div>
          <div className="cols">{cols.map(c => {
            const cards = snap.tasks.filter(k => k.col === c.id), dp = dropProps(c.id);
            return <div key={c.id} {...dp} className={`col ${dp.className}`}>
              <div className="col-head"><div className="col-name">
                {b.canEditCols(t.id) ? <h3><InlineName value={c.name} label="column" maxLength={40} save={n => renameColumn(c.id, n)} /></h3> : <h3>{c.name}</h3>}
                <span className="n-badge">{cards.length}</span></div>
                <span className="col-r"><span className="est" title={`Estimate: ${c.estH} working hours`}><Ic n="clock" s={12} />{c.estH} h</span>
                  {b.canEditCols(t.id) && cols.length > 1 && <button className={`col-x ${cards.length ? 'busy' : ''}`} aria-label={`Remove column ${c.name}`} title={cards.length ? 'Move its cards out first' : 'Remove empty column'}
                    onClick={() => cards.length ? toast(`${c.name} still has ${cards.length} card${cards.length > 1 ? 's' : ''}. Move ${cards.length > 1 ? 'them' : 'it'} out first.`) : setDialog({ kind: 'rmcol', col: c })}><Ic n="trash" s={14} /></button>}</span></div>
              {c.ownerIds.length > 0 && <div className="owners"><Avs ids={c.ownerIds} />{c.ownerIds.map(o => people[o]?.name).join(', ')}</div>}
              <div className="col-body">{cards.length ? cards.map(k => card(k, mineTeam)) : <div className="empty-col">No cards here</div>}</div>
              {b.canCreateIn(t.id) && <button className="add" onClick={() => setDialog({ kind: 'add', col: c.id })}><Ic n="plus" s={14} />Add task</button>}
            </div>;
          })}</div>
        </section>;
      })}
      {lane(DONE)}
    </div></div>
      : <ListView snap={snap} b={b} now={now} matches={matches} onOpen={setOpen} onMove={requestMove} onAdd={() => setDialog({ kind: 'add', col: 'todo' })} />}

    {openTask && <Drawer key={openTask.id} task={openTask} b={b} me={me} now={now} mentionItems={mentionItems} onClose={() => setOpen(null)} onMove={to => requestMove(openTask, to)} />}
    {dialog?.kind === 'move' && <MoveDialog b={b} task={dialog.task} to={dialog.to} mentionItems={mentionItems} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'add' && <AddTaskDialog b={b} projectId={snap.project.id} col={dialog.col} mentionItems={mentionItems} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'addcol' && <AddColumnDialog b={b} teamId={dialog.team} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'rmcol' && <RemoveColumnDialog col={dialog.col} onClose={() => setDialog(null)} />}
  </>;
}

// ---- list view ----
function ListView({ snap, b, now, matches, onOpen, onMove, onAdd }: { snap: Snapshot; b: Board; now: number; matches: (k: BoardTask) => boolean; onOpen: (id: string) => void; onMove: (k: BoardTask, to: string) => void; onAdd: () => void }) {
  const people = usePeople();
  const [group, setGroup] = useState<'stage' | 'team' | 'assignee' | 'status'>('stage');
  const [sort, setSort] = useState<'deadline' | 'column' | 'moved' | 'title'>('deadline');
  const [closed, setClosed] = useState<Record<string, boolean>>({ todo: true, done: true });
  const all = snap.tasks.filter(matches);
  const teamColor = (tid: string | null) => b.team(tid)?.color ?? '--t6';
  type G = { key: string; label: string; items: BoardTask[]; color?: string; sub?: string; av?: string };
  const groups: G[] = (() => {
    if (group === 'team') return [{ key: 'todo', label: 'To do', sub: 'Backlog', color: '--t6', items: all.filter(k => k.col === 'todo') },
      ...b.teams.map(t => ({ key: t.id, label: t.name, color: t.color, sub: t.leadId ? `Lead ${people[t.leadId]?.name}` : 'No lead', items: all.filter(k => b.col(k.col)?.teamId === t.id) })),
      { key: 'done', label: 'Done', sub: 'Finished', color: '--t6', items: all.filter(k => k.col === 'done') }];
    if (group === 'assignee') {
      const ids = [...new Set(all.flatMap(k => k.assignees))].sort((a, z) => (people[a]?.name ?? '').localeCompare(people[z]?.name ?? ''));
      return [...ids.map(id => ({ key: 'u:' + id, label: people[id]?.name ?? 'Unknown', av: id, items: all.filter(k => k.assignees.includes(id)) })), { key: 'u:none', label: 'Unassigned', color: '--t6', items: all.filter(k => !k.assignees.length) }].filter(g => g.items.length);
    }
    if (group === 'status') {
      const st = (k: BoardTask) => { const d = b.dlStatus(k, now); return k.col === 'done' ? 'done' : d.lv === 'none' || k.col === 'todo' ? 'none' : d.lv; };
      return ([['bad', 'Overdue', '--bad'], ['warn', 'At risk', '--warn'], ['ok', 'On time', '--ok'], ['none', 'Not started or no deadline', '--t6'], ['done', 'Finished', '--muted']] as const)
        .map(([s, n, c]) => ({ key: 's:' + s, label: n, color: c, items: all.filter(k => st(k) === s) })).filter(g => g.items.length);
    }
    return ([TODO, ...b.columns, DONE] as AnyCol[]).map(c => ({ key: c.id, label: c.name, color: teamColor(c.teamId), sub: 'special' in c && c.special ? (c.id === 'todo' ? 'Backlog' : 'Finished') : `${b.team(c.teamId)?.name} · ${c.estH} h estimate`, items: all.filter(k => k.col === c.id) }));
  })();
  const key = { deadline: (k: BoardTask) => k.deadline ?? Infinity, column: (k: BoardTask) => { const s = b.colStatus(k, now); return s.lv === 'done' || s.lv === 'todo' ? Infinity : s.left; }, title: (k: BoardTask) => k.title.toLowerCase(), moved: (k: BoardTask) => -k.entered }[sort];
  const sorted = (l: BoardTask[]) => [...l].sort((a, z) => { const x = key(a), y = key(z); return x < y ? -1 : x > y ? 1 : 0; });
  const order: Record<string, number> = { undefined: 0, start: 0, reopen: 0, handover: 1, done: 2, back: 3, backlog: 4 };
  const moveLabel = (k: BoardTask, x: AnyCol) => {
    const kind = b.moveRule(k, x.id).kind, tn = b.team(x.teamId)?.name;
    return kind === 'handover' ? `Hand over to ${tn} (${x.name})` : kind === 'back' ? `Send back to ${tn} (${x.name})` : kind === 'done' ? 'Mark done' : kind === 'backlog' ? 'Back to backlog' : kind === 'start' ? `Start in ${x.name}` : kind === 'reopen' ? `Reopen in ${x.name}` : `Move to ${x.name}`;
  };

  return <div className="list-wrap gutter">
    <div className="ltools">
      <div className="field inline"><label htmlFor="lvGroup">Group by</label><select className="sel" id="lvGroup" value={group} onChange={e => { const g = e.target.value as typeof group; setGroup(g); setClosed(g === 'stage' || g === 'team' ? { todo: true, done: true } : {}); }}>
        <option value="stage">Column</option><option value="team">Team</option><option value="assignee">Assignee</option><option value="status">Deadline status</option></select></div>
      <div className="field inline"><label htmlFor="lvSort">Sort by</label><select className="sel" id="lvSort" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
        <option value="deadline">Deadline</option><option value="column">Time left in column</option><option value="moved">Recently moved</option><option value="title">Title</option></select></div>
      <span className="muted">{all.length} task{all.length === 1 ? '' : 's'}</span>
      <span className="ltools-r"><button className="link" onClick={() => setClosed({})}>Expand all</button><button className="link" onClick={() => setClosed(Object.fromEntries(groups.map(g => [g.key, true])))}>Collapse all</button>
        {b.canBacklog() && <button className="btn sm" onClick={onAdd}><Ic n="plus" s={13} />Add to backlog</button>}</span>
    </div>
    <div className="ltable" role="table" aria-label={`Tasks in ${snap.project.name}`}>
      <div className="lrow lhead" role="row"><span role="columnheader">Task</span><span role="columnheader">Column</span><span role="columnheader">Time in column</span><span role="columnheader">Deadline</span><span role="columnheader">Assignees</span></div>
      {groups.map(g => {
        const isClosed = !!closed[g.key];
        return <div className="lgroup" role="rowgroup" key={g.key}>
          <button className="lg-h" aria-expanded={!isClosed} style={{ ['--tc' as string]: `var(${g.color ?? '--t6'})` }} onClick={() => setClosed(x => ({ ...x, [g.key]: !x[g.key] }))}>
            <span className={`chev ${isClosed ? '' : 'open'}`}><Ic n="chev" s={14} /></span>{g.av ? <Av id={g.av} size="sm" /> : <span className="sw" />}<b>{g.label}</b>{g.sub && <small>{g.sub}</small>}<span className="n-badge">{g.items.length}</span></button>
          {!isClosed && (g.items.length ? sorted(g.items).map(k => {
            const c = b.col(k.col)!, t = b.team(c.teamId), cs = b.colStatus(k, now), ds = b.dlStatus(k, now);
            const done = k.subtasks.filter(s => s.done).length;
            const targets = b.canWorkIn(c.teamId ?? null) ? ([TODO, ...b.columns, DONE] as AnyCol[]).filter(x => x.id !== k.col && b.moveRule(k, x.id).ok).sort((x, y) => order[String(b.moveRule(k, x.id).kind)] - order[String(b.moveRule(k, y.id).kind)]) : [];
            return <div key={k.id} className="lrow" role="row" tabIndex={0} onClick={e => { if (!(e.target as HTMLElement).closest('select')) onOpen(k.id); }} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(k.id); }}>
              <div className="lc task" role="cell"><span className={`ldot s-${cs.lv}`} title={lvWord[cs.lv]} /><div><b>{k.title}</b>
                <span className="lmeta">{k.subtasks.length > 0 && <span><Ic n="check" s={12} />{done}/{k.subtasks.length}</span>}{k.commentCount > 0 && <span><Ic n="chat" s={12} />{k.commentCount}</span>}{k.fileCount > 0 && <span><Ic n="clip" s={12} />{k.fileCount}</span>}</span></div></div>
              <div className="lc stage" role="cell" style={{ ['--tc' as string]: `var(${t?.color ?? '--t6'})` }}><span className="sw" /><span className="st-txt"><b>{c.name}</b><small>{'special' in c && c.special ? (c.id === 'todo' ? 'Backlog' : 'Finished') : t?.name}</small></span>
                {targets.length > 0 && <select className="lmove" aria-label={`Move ${k.title}`} value="" onChange={e => { if (e.target.value) onMove(k, e.target.value); }}><option value="">Move…</option>{targets.map(x => <option key={x.id} value={x.id}>{moveLabel(k, x)}</option>)}</select>}</div>
              <div className={`lc time t-${cs.lv}`} role="cell"><span className="lbl">In column</span>{cs.lv === 'done' ? 'Finished' : cs.lv === 'todo' ? 'Not started' : <><Ic n="clock" s={12} />{b.left(cs.left)}</>}</div>
              <div className={`lc ldue d-${ds.lv}`} role="cell"><span className="lbl">Deadline</span>{k.deadline ? <><span>{fmtDate(k.deadline, true)}</span>{ds.lv !== 'done' && ds.lv !== 'none' && <small>{b.left(ds.left)}</small>}</> : <span className="muted">No deadline</span>}</div>
              <div className="lc who" role="cell"><Avs ids={k.assignees} />{k.assignees.length === 1 ? <span className="nm">{people[k.assignees[0]]?.name}</span> : k.assignees.length ? null : <span className="muted">Nobody</span>}</div>
            </div>;
          }) : <div className="lempty muted">No tasks</div>)}
        </div>;
      })}
    </div>
  </div>;
}

'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Board, Column } from '@/lib/rules';
import { addColumn, createTask, moveTask, removeColumn } from '@/app/actions';
import { Av, Ic, toLocalInput, usePeople, useToast } from './ui';
import { AttachButton, MAX_MB, PendChips, usePending } from './files';
import { MentionTextarea, type MentionHandle, type MentionItem } from './MentionTextarea';
import type { BoardTask } from './ProjectView';

type Res = { ok: true; msg?: string } | { ok: false; error: string };

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current!; if (!d.open) d.showModal(); return () => d.close(); }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); onClose(); }} style={wide ? { width: 'min(640px, calc(100vw - 32px))' } : undefined}><div className="dlg">{children}</div></dialog>;
}

function useSubmit(onClose: () => void) {
  const toast = useToast(), router = useRouter();
  const [pending, start] = useTransition();
  return { pending, submit: (fn: () => Promise<Res>) => start(async () => { const r = await fn(); if (r.ok) { toast(r.msg ?? 'Saved'); onClose(); router.refresh(); } else toast(r.error); }) };
}

const in3days = () => { const d = new Date(Date.now() + 3 * 864e5); d.setHours(17, 0, 0, 0); return toLocalInput(d.getTime()); };

export function MoveDialog({ b, task, to, mentionItems, onClose }: { b: Board; task: BoardTask; to: string; mentionItems: MentionItem[]; onClose: () => void }) {
  const rule = b.moveRule(task, to), col = b.col(to)!, toast = useToast();
  const note = useRef<MentionHandle>(null), [deadline, setDeadline] = useState(in3days());
  const pend = usePending();
  const { pending, submit } = useSubmit(onClose);
  const T = rule.kind === 'done' ? ['Mark as done?', `"${task.title}" moves to Done and skips the rest of the line. Both clocks stop. Add a note so everyone knows why it is finished.`, 'Client approved the final cut', 'primary', 'Mark done', 'ok']
    : rule.kind === 'backlog' ? ['Move back to the backlog?', `"${task.title}" leaves the line and goes to To do. Its clocks stop until someone starts it again. Add the reason.`, 'Client paused this until after Eid', 'primary', 'Move to backlog', 'left']
    : rule.kind === 'back' ? [`Send back to ${b.team(col.teamId)?.name}?`, `"${task.title}" returns to ${col.name} and its column clock restarts. Tell them what needs another look.`, 'Client wants the price removed from frame 3', 'danger', 'Send back', 'left']
    : [rule.kind === 'reopen' ? 'Set a deadline to reopen' : 'Set a deadline to start', `"${task.title}" moves into ${col.name} and its clocks start now. Tasks on the line need a deadline.`, '', 'primary', rule.kind === 'reopen' ? 'Reopen task' : 'Start task', 'right'];
  const go = () => {
    const fd = new FormData(); fd.set('taskId', task.id); fd.set('to', to);
    if (rule.needsComment) {
      const text = note.current!.value().trim();
      if (!text) { toast(rule.kind === 'back' ? 'Add a reason so the other team knows what to fix' : 'Add a note to explain this move'); return note.current!.focus(); }
      fd.set('note', text); pend.files.forEach(f => fd.append('files', f));
    }
    if (rule.needsDeadline) fd.set('deadline', new Date(deadline).toISOString());
    submit(() => moveTask(fd));
  };
  return <Modal onClose={onClose}>
    <div><h2>{T[0]}</h2><p className="lead">{T[1]}</p></div>
    {rule.needsComment && <div className="field"><label htmlFor="reason">{rule.kind === 'back' ? 'Reason' : 'Note (required)'}</label><div className="composer solo"><div className="box">
      <MentionTextarea ref={note} id="reason" items={mentionItems} placeholder={`${T[2]}. Type @ to mention someone.`} autoFocus />
      <PendChips p={pend} inset />
      <div className="bar"><span className="ctools"><AttachButton id="file-reason" onPick={l => pend.add(l, toast)} /><button type="button" className="tool" onClick={() => note.current?.insertAt()} title="Mention"><Ic n="at" /><span className="sr">Mention</span></button></span><span className="muted hide-sm">Attach a screenshot or clip if useful</span></div></div></div></div>}
    {rule.needsDeadline && <div className="field"><label htmlFor="dlDue">Overall deadline</label><input id="dlDue" type="datetime-local" required value={deadline} onChange={e => setDeadline(e.target.value)} autoFocus={!rule.needsComment} /></div>}
    <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${T[3]}`} disabled={pending} onClick={go}><Ic n={T[5]} s={14} />{T[4]}</button></div>
  </Modal>;
}

export function AddTaskDialog({ b, projectId, col, mentionItems, onClose }: { b: Board; projectId: string; col: string; mentionItems: MentionItem[]; onClose: () => void }) {
  const people = usePeople(), toast = useToast();
  const backlog = col === 'todo', c = b.col(col)!, t = b.team(c.teamId);
  const choices = backlog ? [] : b.teamCols(t!.id);
  const crew = backlog ? [...new Set(b.teams.flatMap(x => [x.leadId, ...x.memberIds]).filter(Boolean) as string[])] : [t!.leadId, ...t!.memberIds].filter(Boolean) as string[];
  const desc = useRef<MentionHandle>(null), pend = usePending();
  const { pending, submit } = useSubmit(onClose);
  return <Modal onClose={onClose}>
    <div><h2>{backlog ? 'Add to backlog' : 'New task'}</h2><p className="lead">{backlog ? 'Saved in To do for later. No clock runs until a team lead starts it, and the deadline can wait until then.' : `Adds a card to ${t!.name}. Both clocks start now.`}</p></div>
    <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget); fd.set('projectId', projectId); fd.set('desc', desc.current!.value());
      if (backlog) fd.set('col', 'todo');
      const dl = String(fd.get('deadline') ?? ''); if (dl) fd.set('deadline', new Date(dl).toISOString());
      pend.files.forEach(f => fd.append('files', f));
      submit(() => createTask(fd));
    }}>
      <div className="field"><label htmlFor="nTitle">Title</label><input id="nTitle" name="title" required maxLength={200} placeholder={backlog ? 'Eid gift guide carousel' : 'YouTube pre-roll, 6 s'} autoFocus /></div>
      <div className="field"><label htmlFor="nDesc">Description</label><MentionTextarea ref={desc} id="nDesc" items={mentionItems} placeholder="Format, sizes, key message. Type @ to mention someone." /></div>
      <div className="field"><span className="flabel">Attachments (optional)</span><div className="att-add"><AttachButton id="file-new" label="Add images or video" onPick={l => pend.add(l, toast)} /><span className="muted">Up to {MAX_MB} MB each</span></div><PendChips p={pend} /></div>
      <div className="row2">
        {!backlog && <div className="field"><label htmlFor="nCol">Start in</label><select id="nCol" name="col" defaultValue={col}>{choices.map(x => <option key={x.id} value={x.id}>{x.name} ({x.estH} h)</option>)}</select></div>}
        <div className="field"><label htmlFor="nWho">Assignee{backlog ? ' (optional)' : ''}</label><select id="nWho" name="assignee" defaultValue={backlog ? '' : crew[0]}>{backlog && <option value="">Nobody yet</option>}{crew.map(p => <option key={p} value={p}>{people[p]?.name}</option>)}</select></div>
        {backlog && <div className="field"><label htmlFor="nDue">Deadline (optional)</label><input id="nDue" name="deadline" type="datetime-local" /></div>}
      </div>
      {!backlog && <div className="field"><label htmlFor="nDue">Overall deadline</label><input id="nDue" name="deadline" type="datetime-local" defaultValue={in3days()} required /></div>}
      <div className="field"><label htmlFor="nSubs">Subtasks, one per line (optional)</label><textarea id="nSubs" name="subtasks" placeholder={'Write script\nGet client sign-off'} /></div>
      <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={pending}><Ic n="plus" s={14} />{backlog ? 'Add to backlog' : 'Add task'}</button></div>
    </form>
  </Modal>;
}

export function AddColumnDialog({ b, teamId, onClose }: { b: Board; teamId: string; onClose: () => void }) {
  const t = b.team(teamId)!, cols = b.teamCols(teamId), crew = [t.leadId, ...t.memberIds].filter(Boolean) as string[];
  const people = usePeople();
  const { pending, submit } = useSubmit(onClose);
  return <Modal onClose={onClose}>
    <div><h2>Add a column to {t.name}</h2><p className="lead">It joins the line straight away. Cards entering it get its time estimate.</p></div>
    <form style={{ display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set('teamId', teamId); submit(() => addColumn(fd)); }}>
      <div className="field"><label htmlFor="cName">Column name</label><input id="cName" name="name" required maxLength={40} placeholder="Client feedback" autoFocus /></div>
      <div className="row2">
        <div className="field"><label htmlFor="cEst">Time estimate (hours)</label><input id="cEst" name="est" type="number" min="0.5" step="0.5" defaultValue={8} required /></div>
        <div className="field"><label htmlFor="cPos">Position</label><select id="cPos" name="after" defaultValue={cols.at(-1)?.id}><option value="start">First in {t.name}</option>{cols.map(c => <option key={c.id} value={c.id}>After {c.name}</option>)}</select></div>
      </div>
      <div className="field"><span className="flabel">Responsible (optional)</span><div className="ownpick">{crew.map(p => <label key={p} className="ownopt"><input type="checkbox" name="owners" value={p} /><Av id={p} size="sm" />{people[p]?.name}</label>)}</div></div>
      <p className="muted" style={{ margin: 0 }}>Placing it first or last changes where {t.name} receives and hands over cards.</p>
      <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={pending}><Ic n="plus" s={14} />Add column</button></div>
    </form>
  </Modal>;
}

export function RemoveColumnDialog({ col, onClose }: { col: Column; onClose: () => void }) {
  const { pending, submit } = useSubmit(onClose);
  return <Modal onClose={onClose}>
    <div><h2>Remove {col.name}?</h2><p className="lead">The column is empty, so no cards move. Time already spent in it stays in each task's activity.</p></div>
    <div className="actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={pending} onClick={() => submit(() => removeColumn(col.id))}><Ic n="trash" s={14} />Remove column</button></div>
  </Modal>;
}

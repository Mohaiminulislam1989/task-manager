'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DONE, H, TODO, fmtDate, level, type AnyCol, type Board, type Level } from '@/lib/rules';
import { InlineName } from './InlineName';
import { addComment, addTaskFiles, renameTask, getTaskDetail, removeFile, toggleSubtask, updateDetails } from '@/app/actions';
import type { TaskDetail } from '@/lib/data';
import { Av, Ic, relTime, usePeople, useToast } from './ui';
import { AttachButton, Lightbox, PendChips, Thumb, usePending, type FileInfo } from './files';
import { MentionTextarea, Rich, type MentionHandle, type MentionItem } from './MentionTextarea';
import type { BoardTask } from './ProjectView';

function Meter({ title, s, sub, b }: { title: string; s: { lv: Level; frac: number; left: number }; sub: string; b: Board }) {
  const pct = Math.min(100, Math.max(0, s.frac * 100));
  return <div className="box-card meter"><h3>{title}</h3>
    <div className="big"><i className={`s-${s.lv}`} />{s.lv === 'done' ? 'Finished' : s.lv === 'todo' ? 'Not started' : s.lv === 'none' ? 'No deadline' : b.left(s.left)}</div>
    {!['done', 'todo', 'none'].includes(s.lv) && <div className="track"><span className={`s-${s.lv}`} style={{ width: `${pct}%` }} /><span className="mark80" title="80%" /></div>}
    <p>{sub}</p></div>;
}

export function Drawer({ task: k, b, me, now, mentionItems, onClose, onMove }: { task: BoardTask; b: Board; me: string; now: number; mentionItems: MentionItem[]; onClose: () => void; onMove: (to: string) => void }) {
  const people = usePeople(), toast = useToast(), router = useRouter();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<FileInfo | null>(null);
  const [pending, start] = useTransition();
  const cmt = useRef<MentionHandle>(null), desc = useRef<MentionHandle>(null);
  const cPend = usePending(), dPend = usePending();
  const closeBtn = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => getTaskDetail(k.id).then(setDetail).catch(() => setDetail(null)), [k.id]);
  useEffect(() => { load(); }, [load, k.entered, k.commentCount, k.fileCount]);
  useEffect(() => { closeBtn.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !view && !document.querySelector('dialog[open]')) onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose, view]);

  const c = b.col(k.col)!, t = b.team(c.teamId);
  const special = 'special' in c && !!c.special;
  const editable = b.canWorkIn(c.teamId ?? null), canRename = b.canRenameTask(k);
  const cs = b.colStatus(k, now), ds = b.dlStatus(k, now);
  const done = k.subtasks.filter(s => s.done).length;
  const targets = ([TODO, ...b.columns, DONE] as AnyCol[]).filter(x => b.moveRule(k, x.id).ok);
  const kindOf = (x: AnyCol) => b.moveRule(k, x.id).kind;

  const run = (fn: () => Promise<{ ok: boolean; msg?: string; error?: string } | { ok: false; error: string }>, after?: () => void) => start(async () => {
    const res = await fn();
    if (res.ok) { if ('msg' in res && res.msg) toast(res.msg); after?.(); await load(); router.refresh(); } else toast((res as { error: string }).error);
  });

  const post = () => {
    const text = cmt.current!.value().trim();
    if (!text && !cPend.files.length) return cmt.current!.focus();
    const fd = new FormData(); fd.set('taskId', k.id); fd.set('text', text); cPend.files.forEach(f => fd.append('files', f));
    run(() => addComment(fd), () => { cmt.current!.clear(); cPend.clear(); });
  };
  const saveDetails = () => {
    const fd = new FormData(); fd.set('taskId', k.id); fd.set('desc', desc.current!.value());
    dPend.files.forEach(f => fd.append('files', f));
    run(() => updateDetails(fd), () => { setEditing(false); dPend.clear(); });
  };
  const attach = (list: FileList | null) => {
    const fd = new FormData(); fd.set('taskId', k.id);
    let n = 0; for (const f of Array.from(list ?? [])) if (/^(image|video)\//.test(f.type)) { fd.append('files', f); n++; } else toast(`${f.name} is not an image or video`);
    if (n) run(() => addTaskFiles(fd));
  };

  const stintRows = detail ? [...detail.stints.map(st => ({ c: b.col(st.col), ms: b.work(st.start, st.end), live: false })), ...(!special ? [{ c, ms: b.work(k.entered, now), live: true }] : [])].filter(r => r.c) : [];

  return <>
    <div className="scrim" onClick={onClose} />
    <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dTitle">
      <div className="d-head" style={{ ['--tc' as string]: `var(${t?.color ?? '--t6'})` }}>
        <div className="crumb">{special ? <b>{c.name}</b> : <><b>{t?.name}</b><span className="sep">/</span>{c.name}</>}{!editable && <span className="ro"><Ic n="lock" s={12} />View only</span>}</div>
        <button ref={closeBtn} className="icon-btn" onClick={onClose} aria-label="Close"><Ic n="x" s={18} /></button>
      </div>
      <div className="d-scroll">
        <div className="d-title">
          <h2 id="dTitle">{canRename ? <InlineName value={k.title} label="task" maxLength={200} save={n => renameTask(k.id, n)} /> : k.title}</h2>
          <div className="pills">
            <span className={`pill p-${cs.lv}`}><i className={`s-${cs.lv}`} />{c.id === 'done' ? 'Finished' : c.id === 'todo' ? 'In the backlog' : `${c.name}: ${b.left(cs.left)}`}</span>
            {ds.lv !== 'done' && <span className={`pill p-${ds.lv}`}><Ic n="cal" s={13} />{ds.lv === 'none' ? 'No deadline yet' : 'Deadline: ' + b.left(ds.left)}</span>}
            <span className="pill"><Ic n="check" s={13} />{done}/{k.subtasks.length} subtasks</span>
          </div>
        </div>
        <div className="d-grid">
          <div className="d-main">
            <section><div className="sec-h"><h3>Description</h3>{editable && !editing && <button className="link" onClick={() => setEditing(true)}>Edit description</button>}</div>
              {editing ? <>
                <div className="composer solo"><div className="box"><MentionTextarea ref={desc} items={mentionItems} defaultValue={k.desc} placeholder="What needs doing. Type @ to mention a person or team." autoFocus />
                  <div className="bar"><span className="ctools"><AttachButton id="file-desc" onPick={l => dPend.add(l, toast)} /><button type="button" className="tool" onClick={() => desc.current?.insertAt()} title="Mention"><Ic n="at" /><span className="sr">Mention</span></button></span>
                    <span className="bar-r"><button className="btn sm" onClick={() => { setEditing(false); dPend.clear(); }}>Cancel</button><button className="btn primary sm" disabled={pending} onClick={saveDetails}>Save</button></span></div></div></div>
                <PendChips p={dPend} /></>
                : <p className="desc">{k.desc ? <Rich text={k.desc} items={mentionItems} me={me} /> : <span className="muted">No description yet.</span>}</p>}
            </section>
            <section><div className="sec-h"><h3>Attachments <span className="n-badge">{detail?.files.length ?? 0}</span></h3>{editable && <span><input type="file" id="file-task" accept="image/*,video/*" multiple hidden onChange={e => { attach(e.target.files); e.target.value = ''; }} /><label className="link" htmlFor="file-task"><Ic n="plus" s={13} />Add images or video</label></span>}</div>
              {detail?.files.length ? <div className="att-grid">{detail.files.map(f => <Thumb key={f.id} f={f} onOpen={setView} onRemove={editable ? () => run(() => removeFile(f.id)) : undefined} />)}</div>
                : <p className="muted" style={{ margin: 0 }}>{editable ? 'No files yet. Add reference images, drafts or video cuts.' : 'No files yet.'}</p>}
            </section>
            <section><div className="sec-h"><h3>Subtasks</h3><span className="muted">{done} of {k.subtasks.length} done</span></div>
              {k.subtasks.length ? <><div className="prog"><span style={{ width: `${done / k.subtasks.length * 100}%` }} /></div>
                <ul className="subs">{k.subtasks.map(s => {
                  const late = !s.done && s.deadline != null && s.deadline < now;
                  return <li key={s.id} className={s.done ? 'done' : ''}><input type="checkbox" id={`sub-${s.id}`} checked={s.done} disabled={!editable || pending} onChange={e => run(() => toggleSubtask(s.id, e.target.checked))} />
                    <label htmlFor={`sub-${s.id}`}>{s.title}</label>{s.deadline != null && <span className={`due ${late ? 'bad' : ''}`}><Ic n="cal" s={12} />{late ? 'Overdue · ' : ''}{fmtDate(s.deadline, true)}</span>}</li>;
                })}</ul></> : <p className="muted">No subtasks.</p>}
            </section>
            <section>
              <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>Comments <span className="n">{detail?.comments.length ?? k.commentCount}</span></button>
                <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Activity <span className="n">{detail?.log.length ?? ''}</span></button>
              </div>
              {tab === 'comments' ? <>
                {detail?.comments.length ? <div className="thread">{detail.comments.map(m => <div key={m.id} className={`cmt ${m.kind === 'back' ? 'is-back' : ''}`}><Av id={m.who} size="lg" /><div>
                  <div className="who">{people[m.who]?.name}{m.kind === 'back' && <span className="kind back">Sent back</span>}{m.kind === 'done' && <span className="kind done">Marked done</span>}{m.kind === 'backlog' && <span className="kind backlog">Moved to backlog</span>}<small>{relTime(m.at, now)}</small></div>
                  <div className="bubble"><Rich text={m.text} items={mentionItems} me={me} />{m.files.length > 0 && <div className="att-grid sm">{m.files.map(f => <Thumb key={f.id} f={f} onOpen={setView} />)}</div>}</div></div></div>)}</div>
                  : <p className="muted" style={{ margin: '0 0 14px' }}>{detail ? 'No comments yet. Start the conversation.' : 'Loading…'}</p>}
                {editable ? <div className="composer"><Av id={me} size="lg" /><div className="box">
                  <MentionTextarea ref={cmt} items={mentionItems} placeholder="Write a comment. Type @ to mention someone." onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }} />
                  <PendChips p={cPend} inset />
                  <div className="bar"><span className="ctools"><AttachButton id="file-cmt" onPick={l => cPend.add(l, toast)} /><button type="button" className="tool" onClick={() => cmt.current?.insertAt()} title="Mention a person or team"><Ic n="at" /><span className="sr">Mention</span></button></span>
                    <span className="bar-r"><span className="muted hide-sm">Notifies {special ? 'the project manager' : t?.name}</span><button className="btn primary" disabled={pending} onClick={post}><Ic n="send" s={14} />Comment</button></span></div></div></div>
                  : <p className="muted"><Ic n="lock" s={12} /> Only {special ? 'team leads' : t?.name} and the project manager can comment here.</p>}
              </> : <>
                {stintRows.length > 0 && <div className="stints"><div className="stints-h"><span>Time in each column</span><span>Total {b.fmt(stintRows.reduce((a, r) => a + r.ms, 0))}</span></div>
                  {stintRows.map((r, i) => {
                    const col = r.c!, est = col.estH * H, frac = r.ms / est, lv = r.live ? level(frac) : frac > 1 ? 'bad' : 'ok', diff = r.ms - est;
                    return <div key={i} className="stint" style={{ ['--tc' as string]: `var(${b.team(col.teamId)?.color ?? '--t6'})` }}><span className="sw" />
                      <div className="nm"><b>{col.name}</b><small>{b.team(col.teamId)?.name}{r.live ? ' · in progress' : ''}</small></div>
                      <div className="bar"><span className={`s-${lv}`} style={{ width: `${Math.min(100, frac * 100)}%` }} /></div>
                      <div className="num"><b>{b.fmt(r.ms)}</b><small>of {col.estH} h</small></div>
                      <span className={`tag ${lv}`}>{r.live ? (diff > 0 ? b.fmt(diff) + ' over' : b.fmt(-diff) + ' left') : diff > 0 ? b.fmt(diff) + ' over' : 'On time'}</span></div>;
                  })}</div>}
                <h4 className="mini-h">Log</h4>
                <ul className="timeline">{detail?.log.map((l, i) => <li key={i}>{l.who && <><b>{people[l.who]?.name}</b> · </>}{l.text}<small>{fmtDate(l.at)}</small></li>)}</ul>
              </>}
            </section>
          </div>
          <aside className="d-side">
            {editable && targets.length > 0 && <div className="box-card"><h3>Move card</h3><div className="moves">
              {targets.filter(x => kindOf(x) === 'start' || kindOf(x) === 'reopen').map(x => <button key={x.id} className="mv handover" onClick={() => onMove(x.id)}><Ic n="right" s={15} />{kindOf(x) === 'start' ? 'Start in' : 'Reopen in'} {x.name}<span className="k">{b.team(x.teamId)?.name}</span></button>)}
              {targets.filter(x => kindOf(x) === 'handover').map(x => <button key={x.id} className="mv handover" onClick={() => onMove(x.id)}><Ic n="right" s={15} />Hand over<span className="k">to {b.team(x.teamId)?.name}</span></button>)}
              {targets.filter(x => !kindOf(x)).map(x => <button key={x.id} className="mv" onClick={() => onMove(x.id)}><Ic n={b.columns.indexOf(x as never) > b.columns.indexOf(c as never) ? 'right' : 'left'} s={15} />{x.name}</button>)}
              {targets.filter(x => kindOf(x) === 'back').map(x => <button key={x.id} className="mv back" onClick={() => onMove(x.id)}><Ic n="left" s={15} />Send back<span className="k">to {b.team(x.teamId)?.name}</span></button>)}
              {targets.filter(x => kindOf(x) === 'done').map(x => <button key={x.id} className="mv donebtn" onClick={() => onMove('done')}><Ic n="ok" s={15} />Mark done<span className="k">skips the rest of the line</span></button>)}
              {targets.filter(x => kindOf(x) === 'backlog').map(x => <button key={x.id} className="mv" onClick={() => onMove('todo')}><Ic n="left" s={15} />Back to backlog</button>)}
            </div></div>}
            <Meter title={special ? c.name : `Time in ${c.name}`} s={cs} b={b} sub={c.id === 'done' ? `Finished ${fmtDate(k.entered)}. Clocks stopped.` : c.id === 'todo' ? `In the backlog since ${fmtDate(k.entered, true)}. The clocks start when a lead starts it.` : `Estimate ${c.estH} working hours · entered ${fmtDate(k.entered, true)}`} />
            <Meter title="Overall deadline" s={ds} b={b} sub={k.deadline ? `Due ${fmtDate(k.deadline)}` : 'Set when the task is started'} />
            <div><h3>Assignees</h3><ul className="people">{k.assignees.length ? k.assignees.map(a => <li key={a}><Av id={a} />{people[a]?.name}</li>) : <li className="muted">Nobody yet</li>}</ul></div>
            <div><h3>Details</h3><dl className="kv">{t?.leadId && <><dt>Team lead</dt><dd>{people[t.leadId]?.name}</dd></>}{!special && (c as { ownerIds: string[] }).ownerIds.length > 0 && <><dt>Column owner</dt><dd>{(c as { ownerIds: string[] }).ownerIds.map(o => people[o]?.name).join(', ')}</dd></>}<dt>Created</dt><dd>{fmtDate(k.created, true)}</dd></dl></div>
          </aside>
        </div>
      </div>
    </aside>
    <Lightbox f={view} onClose={() => setView(null)} />
  </>;
}

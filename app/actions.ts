'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { db, schema as s } from '@/db';
import { currentUser, endSession, requireUser, startSession, type Viewer } from '@/lib/auth';
import { boardFor, people, taskDetail, tasksFor } from '@/lib/data';
import { storeFile } from '@/lib/files';
import { SWATCHES, assignable, Board, fmtDur, isAdminRole, mentionsIn, type Column, type Mentionable, type Task } from '@/lib/rules';

type Result = { ok: true; msg?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

// ---------- auth ----------
export async function login(_: unknown, form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const [u] = await db.select().from(s.users).where(eq(s.users.email, email));
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) return { error: 'Email or password is wrong.' };
  await startSession(u.id);
  redirect(u.mustChangePassword ? '/account?first=1' : '/');
}

export async function logout() { await endSession(); redirect('/login'); }

export async function changePassword(_: unknown, form: FormData) {
  const v = await requireUser();
  const cur = String(form.get('current') ?? ''), next = String(form.get('next') ?? '');
  if (next.length < 8) return { error: 'Use at least 8 characters.' };
  if (!(await bcrypt.compare(cur, v.passwordHash))) return { error: 'Current password is wrong.' };
  await db.update(s.users).set({ passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false }).where(eq(s.users.id, v.id));
  return { ok: 'Password changed.' };
}

// ---------- shared helpers ----------
async function ctx(projectId: string) {
  const v = await currentUser();
  if (!v) throw new Error('Please sign in again.');
  const b = await boardFor(v, projectId);
  if (!b) throw new Error('You are not part of this project.');
  return { v, ...b };
}

async function loadTask(taskId: string) {
  const [row] = await db.select({ projectId: s.tasks.projectId }).from(s.tasks).where(eq(s.tasks.id, taskId));
  if (!row) throw new Error('That task no longer exists.');
  const c = await ctx(row.projectId);
  const [tk] = (await tasksFor([row.projectId])).filter(t => t.id === taskId);
  return { ...c, tk };
}

const teamPeople = (b: Board, tid: string | null) => { const t = b.team(tid); return t ? [t.leadId, ...t.memberIds].filter(Boolean) as string[] : []; };

// Fan out an in-app notification: the given teams, plus the project manager, never the actor.
async function notify(b: Board, v: Viewer, opts: { teams: (string | null)[]; kind: 'update' | 'move' | 'comment' | 'back'; text: string; taskId: string | null }) {
  const to = new Set<string>([b.p.managerId, ...opts.teams.flatMap(t => teamPeople(b, t))]);
  to.delete(v.id);
  if (to.size) await db.insert(s.notifications).values([...to].map(userId => ({ userId, projectId: b.p.id, taskId: opts.taskId, byId: v.id, kind: opts.kind, text: opts.text })));
}

// Notify specific people (e.g. about their own role or team), never the actor.
async function notifyUsers(v: Viewer, userIds: (string | null | undefined)[], opts: { projectId: string | null; text: string; taskId?: string | null }) {
  const to = new Set(userIds.filter((x): x is string => !!x)); to.delete(v.id);
  if (to.size) await db.insert(s.notifications).values([...to].map(userId => ({ userId, projectId: opts.projectId, taskId: opts.taskId ?? null, byId: v.id, kind: 'update' as const, text: opts.text })));
}
// Everyone on a project: the manager plus every lead and member.
async function projectPeople(projectId: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.id, projectId));
  const ts = await db.select().from(s.teams).where(eq(s.teams.projectId, projectId));
  const ms = ts.length ? await db.select().from(s.teamMembers).where(inArray(s.teamMembers.teamId, ts.map(t => t.id))) : [];
  return { project: p, teams: ts, ids: [p?.managerId, ...ts.map(t => t.leadId), ...ms.map(m => m.userId)] };
}

async function mentionables(b: Board, orgId: string): Promise<Mentionable[]> {
  const ps = await people(orgId);
  const ids = new Set([b.p.managerId, ...b.teams.flatMap(t => [t.leadId, ...t.memberIds]), ...ps.filter(p => isAdminRole(p.orgRole)).map(p => p.id)].filter(Boolean) as string[]);
  return [...ps.filter(p => ids.has(p.id)).map(p => ({ kind: 'user' as const, id: p.id, name: p.name })), ...b.teams.map(t => ({ kind: 'team' as const, id: t.id, name: t.name }))];
}

async function notifyMentions(b: Board, v: Viewer, tk: { id: string; title: string }, text: string, where: string) {
  const ms = mentionsIn(text, await mentionables(b, v.organizationId));
  const snip = text.length > 90 ? text.slice(0, 88) + '…' : text;
  const rows: (typeof s.notifications.$inferInsert)[] = [];
  const seen = new Set<string>([v.id]);
  for (const m of ms.filter(x => x.kind === 'user')) if (!seen.has(m.id)) { seen.add(m.id); rows.push({ userId: m.id, projectId: b.p.id, taskId: tk.id, byId: v.id, kind: 'mention', text: `${v.name} mentioned you in ${where} on "${tk.title}": ${snip}` }); }
  for (const m of ms.filter(x => x.kind === 'team')) for (const uid of teamPeople(b, m.id)) if (!seen.has(uid)) { seen.add(uid); rows.push({ userId: uid, projectId: b.p.id, taskId: tk.id, byId: v.id, kind: 'mention', text: `${v.name} mentioned ${m.name} in ${where} on "${tk.title}": ${snip}` }); }
  if (rows.length) await db.insert(s.notifications).values(rows);
  return ms.length;
}

async function saveFiles(form: FormData, key: string, taskId: string, by: string, commentId: string | null = null) {
  const files = form.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
  const out = [];
  for (const f of files) {
    const st = await storeFile(f);
    out.push({ taskId, commentId, uploadedBy: by, name: st.name, mimeType: st.mime, size: st.size, url: st.url });
  }
  if (out.length) await db.insert(s.attachments).values(out);
  return out;
}

const log = (taskId: string, userId: string | null, text: string) => db.insert(s.taskEvents).values({ taskId, userId, text });
const done = (projectId: string, msg?: string): Result => { revalidatePath(`/p/${projectId}`); revalidatePath('/dashboard'); return { ok: true, msg }; };
const guard = async (fn: () => Promise<Result>): Promise<Result> => { try { return await fn(); } catch (e) { return fail(e instanceof Error ? e.message : 'Something went wrong.'); } };

// ---------- tasks ----------
export async function getTaskDetail(taskId: string) {
  await loadTask(taskId);
  return taskDetail(taskId);
}

export async function moveTask(form: FormData): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(String(form.get('taskId')));
    const toId = String(form.get('to'));
    const rule = b.moveRule(tk, toId);
    if (!rule.ok) return fail(rule.why ?? 'That move is not allowed.');
    const note = String(form.get('note') ?? '').trim();
    if (rule.needsComment && !note) return fail(rule.kind === 'back' ? 'Add a reason so the other team knows what to fix.' : 'Add a note to explain this move.');
    let deadline = tk.deadline;
    if (rule.needsDeadline) {
      const d = Date.parse(String(form.get('deadline') ?? ''));
      if (!(d > Date.now())) return fail('Set a deadline in the future to start this task.');
      deadline = d;
    }
    const from = b.col(tk.col)!, to = b.col(toId)!, now = new Date();
    const fromTeam = from.teamId, toTeam = to.teamId;
    const spent = now.getTime() - tk.entered;
    if (!('special' in from && from.special)) await db.insert(s.stints).values({ taskId: tk.id, columnId: from.id, startedAt: new Date(tk.entered), endedAt: now });
    await db.update(s.tasks).set({
      stage: toId === 'todo' ? 'todo' : toId === 'done' ? 'done' : 'line',
      columnId: toId === 'todo' || toId === 'done' ? null : toId,
      enteredColumnAt: now,
      deadlineAt: deadline ? new Date(deadline) : null,
      ...(fromTeam ? { lastTeamId: fromTeam } : {}),
      ...(tk.col === 'todo' ? { startedAt: now } : {}),
    }).where(eq(s.tasks.id, tk.id));
    const tName = (id: string | null) => b.team(id)?.name ?? '';
    let text = `Moved from ${from.name} to ${to.name}`;
    if (rule.kind === 'start') text = `Started from the backlog in ${tName(toTeam)} (${to.name})`;
    if (rule.kind === 'reopen') text = `Reopened in ${tName(toTeam)} (${to.name})`;
    if (rule.kind === 'done') text = 'Marked done';
    if (rule.kind === 'backlog') text = 'Moved back to the backlog';
    if (rule.kind === 'handover') text = `Handed over from ${tName(fromTeam)} to ${tName(toTeam)} (${to.name})`;
    if (rule.kind === 'back') text = `Sent back to ${tName(toTeam)} (${to.name}) for review`;
    if (!('special' in from && from.special)) text += ` after ${fmtDur(spent)} in ${from.name}`;
    await log(tk.id, v.id, note ? `${text}. Reason: "${note}"` : text);
    if (rule.needsDeadline) await log(tk.id, v.id, `Set the deadline`);
    if (note) {
      const [c] = await db.insert(s.comments).values({ taskId: tk.id, userId: v.id, kind: rule.kind === 'back' ? 'back' : rule.kind === 'done' ? 'done' : 'backlog', body: note }).returning();
      await saveFiles(form, 'files', tk.id, v.id, c.id);
      await notifyMentions(b, v, tk, note, rule.kind === 'back' ? 'a send-back reason' : rule.kind === 'done' ? 'a done note' : 'a backlog note');
    }
    const what = rule.kind === 'done' ? `marked "${tk.title}" done` : rule.kind === 'start' ? `started "${tk.title}" in ${to.name}` : rule.kind === 'handover' ? `handed "${tk.title}" to ${tName(toTeam)}`
      : rule.kind === 'back' ? `sent "${tk.title}" back to ${to.name}` : `moved "${tk.title}" to ${to.name}`;
    await notify(b, v, { teams: [fromTeam ?? tk.lastTeam, toTeam], kind: rule.kind === 'back' ? 'back' : 'move', text: `${v.name} ${what}${note ? ': ' + note : ''}`, taskId: tk.id });
    return done(b.p.id, rule.kind === 'done' ? 'Marked done' : rule.kind === 'handover' ? `Handed to ${tName(toTeam)}` : rule.kind === 'back' ? `Sent back to ${tName(toTeam)}` : `Moved to ${to.name}`);
  });
}

export async function createTask(form: FormData): Promise<Result> {
  return guard(async () => {
    const projectId = String(form.get('projectId'));
    const { v, board: b } = await ctx(projectId);
    const colId = String(form.get('col'));
    const backlog = colId === 'todo';
    const c = b.col(colId);
    if (!c || colId === 'done') return fail('Pick a column.');
    if (backlog ? !b.canBacklog() : !b.canCreateIn(c.teamId!)) return fail('Only team leads and the project manager can add tasks here.');
    const title = String(form.get('title') ?? '').trim();
    if (!title) return fail('Add a title.');
    const dl = Date.parse(String(form.get('deadline') ?? ''));
    if (!backlog && !(dl > Date.now())) return fail('Set a deadline in the future.');
    const who = String(form.get('assignee') ?? '');
    if (who && !(backlog ? b.teams.flatMap(t => teamPeople(b, t.id)) : teamPeople(b, c.teamId)).includes(who)) return fail('The assignee must be on this team.');
    const now = new Date();
    const [tk] = await db.insert(s.tasks).values({
      projectId, stage: backlog ? 'todo' : 'line', columnId: backlog ? null : colId, title, description: String(form.get('desc') ?? '').trim(),
      deadlineAt: dl > 0 ? new Date(dl) : null, startedAt: backlog ? null : now, enteredColumnAt: now, createdBy: v.id,
    }).returning();
    if (who) await db.insert(s.taskAssignees).values({ taskId: tk.id, userId: who });
    const subs = String(form.get('subtasks') ?? '').split('\n').map(x => x.trim()).filter(Boolean);
    if (subs.length) {
      const span = (dl > 0 ? dl : now.getTime() + 7 * 864e5) - now.getTime();
      await db.insert(s.subtasks).values(subs.map((t, i) => ({ taskId: tk.id, title: t, position: i, deadlineAt: new Date(now.getTime() + span * (i + 1) / (subs.length + 1)) })));
    }
    await saveFiles(form, 'files', tk.id, v.id);
    await log(tk.id, v.id, backlog ? 'Added to the backlog' : `Created in ${c.name}`);
    await notify(b, v, { teams: [c.teamId], kind: 'update', text: `${v.name} added "${title}" to ${c.name}`, taskId: tk.id });
    if (tk.description) await notifyMentions(b, v, tk, tk.description, 'the task details');
    return done(projectId, `Added "${title}"`);
  });
}

const canEditTask = (b: Board, tk: Task) => b.canWorkIn(b.col(tk.col)!.teamId ?? null);

export async function addComment(form: FormData): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(String(form.get('taskId')));
    if (!canEditTask(b, tk)) return fail('Only this team and the project manager can comment here.');
    const text = String(form.get('text') ?? '').trim();
    const hasFiles = form.getAll('files').some(f => f instanceof File && f.size > 0);
    if (!text && !hasFiles) return fail('Write a comment or attach a file.');
    const [c] = await db.insert(s.comments).values({ taskId: tk.id, userId: v.id, body: text }).returning();
    const files = await saveFiles(form, 'files', tk.id, v.id, c.id);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'comment', text: `${v.name} commented on "${tk.title}": ${text || `attached ${files.length} file${files.length > 1 ? 's' : ''}`}`, taskId: tk.id });
    const n = text ? await notifyMentions(b, v, tk, text, 'a comment') : 0;
    return done(b.p.id, n ? `Comment posted, ${n} mention${n > 1 ? 's' : ''} notified` : 'Comment posted');
  });
}

export async function updateDetails(form: FormData): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(String(form.get('taskId')));
    if (!canEditTask(b, tk)) return fail('You can only edit tasks in your own team.');
    const desc = String(form.get('desc') ?? '').trim(), title = tk.title;
    const changed = desc !== tk.desc;
    if (changed) await db.update(s.tasks).set({ description: desc }).where(eq(s.tasks.id, tk.id));
    const files = await saveFiles(form, 'files', tk.id, v.id);
    if (changed) await log(tk.id, v.id, 'Edited the details');
    for (const f of files) await log(tk.id, v.id, `Attached "${f.name}"`);
    if (changed || files.length) await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} updated the details of "${title}"`, taskId: tk.id });
    const n = changed && desc !== tk.desc ? await notifyMentions(b, v, { id: tk.id, title }, desc, 'the task details') : 0;
    return done(b.p.id, n ? `Saved, ${n} mention${n > 1 ? 's' : ''} notified` : 'Saved');
  });
}

export async function renameTask(taskId: string, name: string): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(taskId);
    if (!b.canRenameTask(tk)) return fail('Only the team lead or the project manager can rename this task.');
    const n = name.trim().slice(0, 200);
    if (!n) return fail('Give the task a title.');
    if (n === tk.title) return { ok: true, msg: 'Saved' };
    await db.update(s.tasks).set({ title: n }).where(eq(s.tasks.id, tk.id));
    await log(tk.id, v.id, `Renamed from "${tk.title}"`);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} renamed "${tk.title}" to "${n}"`, taskId: tk.id });
    return done(b.p.id, 'Task renamed');
  });
}

export async function addTaskFiles(form: FormData): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(String(form.get('taskId')));
    if (!canEditTask(b, tk)) return fail('You can only add files to tasks in your own team.');
    const files = await saveFiles(form, 'files', tk.id, v.id);
    if (!files.length) return fail('Pick an image or video.');
    for (const f of files) await log(tk.id, v.id, `Attached "${f.name}"`);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} attached ${files.length > 1 ? files.length + ' files' : `"${files[0].name}"`} to "${tk.title}"`, taskId: tk.id });
    return done(b.p.id, `Attached ${files.length} file${files.length > 1 ? 's' : ''}`);
  });
}

export async function removeFile(fileId: string): Promise<Result> {
  return guard(async () => {
    const [f] = await db.select().from(s.attachments).where(eq(s.attachments.id, fileId));
    if (!f || f.commentId) return fail('That file cannot be removed here.');
    const { v, board: b, tk } = await loadTask(f.taskId);
    if (!canEditTask(b, tk)) return fail('You can only remove files from tasks in your own team.');
    await db.delete(s.attachments).where(eq(s.attachments.id, fileId));
    await log(tk.id, v.id, `Removed attachment "${f.name}"`);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} removed "${f.name}" from "${tk.title}"`, taskId: tk.id });
    return done(b.p.id, `Removed ${f.name}`);
  });
}

export async function toggleSubtask(subId: string, value: boolean): Promise<Result> {
  return guard(async () => {
    const [st] = await db.select().from(s.subtasks).where(eq(s.subtasks.id, subId));
    if (!st) return fail('That subtask no longer exists.');
    const { v, board: b, tk } = await loadTask(st.taskId);
    if (!canEditTask(b, tk)) return fail('You can only tick subtasks in your own team.');
    await db.update(s.subtasks).set({ done: value }).where(eq(s.subtasks.id, subId));
    await log(tk.id, v.id, `${value ? 'Completed' : 'Reopened'} subtask "${st.title}"`);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} ${value ? 'completed' : 'reopened'} "${st.title}" on "${tk.title}"`, taskId: tk.id });
    return done(b.p.id);
  });
}

export async function markNotificationsRead(ids: string[] | 'all') {
  const v = await requireUser();
  await db.update(s.notifications).set({ readAt: new Date() })
    .where(ids === 'all' ? and(eq(s.notifications.userId, v.id), isNull(s.notifications.readAt)) : and(eq(s.notifications.userId, v.id), inArray(s.notifications.id, ids)));
  revalidatePath('/', 'layout');
}

// ---------- columns ----------
export async function addColumn(form: FormData): Promise<Result> {
  return guard(async () => {
    const teamId = String(form.get('teamId'));
    const [t] = await db.select().from(s.teams).where(eq(s.teams.id, teamId));
    if (!t) return fail('That team no longer exists.');
    const { v, board: b } = await ctx(t.projectId);
    if (!b.canEditCols(teamId)) return fail('Only this team’s lead and the project manager can add columns.');
    const name = String(form.get('name') ?? '').trim(), est = Number(form.get('est'));
    if (!name) return fail('Name the column.');
    if (!(est > 0)) return fail('Set a time estimate.');
    const cols = b.teamCols(teamId);
    if (cols.some(c => c.name.toLowerCase() === name.toLowerCase())) return fail(`${t.name} already has a column called ${name}.`);
    const pos = String(form.get('after') ?? 'start');
    const at = pos === 'start' ? 0 : cols.findIndex(c => c.id === pos) + 1;
    const ordered: (Column | null)[] = [...cols]; ordered.splice(at, 0, null);
    await db.transaction(async tx => {
      const [c] = await tx.insert(s.columns).values({ teamId, name, position: at, estimateMinutes: Math.round(est * 60) }).returning();
      for (const [i, x] of ordered.entries()) if (x) await tx.update(s.columns).set({ position: i }).where(eq(s.columns.id, x.id));
      const owners = form.getAll('owners').map(String).filter(o => teamPeople(b, teamId).includes(o));
      if (owners.length) await tx.insert(s.columnOwners).values(owners.map(userId => ({ columnId: c.id, userId })));
    });
    await notify(b, v, { teams: [teamId], kind: 'update', text: `${v.name} added the column "${name}" to ${t.name}`, taskId: null });
    return done(t.projectId, `Added ${name} to ${t.name}`);
  });
}

export async function renameColumn(columnId: string, name: string): Promise<Result> {
  return guard(async () => {
    const [c] = await db.select().from(s.columns).where(eq(s.columns.id, columnId));
    if (!c) return fail('That column no longer exists.');
    const [t] = await db.select().from(s.teams).where(eq(s.teams.id, c.teamId));
    const { v, board: b } = await ctx(t.projectId);
    if (!b.canEditCols(t.id)) return fail('Only this team’s lead and the project manager can rename columns.');
    const n = name.trim();
    if (!n) return fail('Name the column.');
    if (b.teamCols(t.id).some(x => x.id !== c.id && x.name.toLowerCase() === n.toLowerCase())) return fail(`${t.name} already has a column called ${n}.`);
    await db.update(s.columns).set({ name: n }).where(eq(s.columns.id, columnId));
    await notify(b, v, { teams: [t.id], kind: 'update', text: `${v.name} renamed the column "${c.name}" to "${n}"`, taskId: null });
    return done(t.projectId, 'Column renamed');
  });
}

export async function renameTeam(teamId: string, name: string): Promise<Result> {
  return guard(async () => {
    const [t] = await db.select().from(s.teams).where(eq(s.teams.id, teamId));
    if (!t) return fail('That team no longer exists.');
    const { v, board: b } = await ctx(t.projectId);
    if (!b.canRenameTeam(t.id)) return fail('Only this team’s lead and the project manager can rename the team.');
    const n = name.trim().slice(0, 60);
    if (!n) return fail('Name the team.');
    if (n === t.name) return { ok: true, msg: 'Saved' };
    if (b.teams.some(x => x.id !== t.id && x.name.toLowerCase() === n.toLowerCase())) return fail(`This project already has a team called ${n}.`);
    await db.update(s.teams).set({ name: n }).where(eq(s.teams.id, teamId));
    await notify(b, v, { teams: [t.id], kind: 'update', text: `${v.name} renamed the team "${t.name}" to "${n}"`, taskId: null });
    revalidatePath('/people');
    return done(t.projectId, 'Team renamed');
  });
}

export async function renameProject(projectId: string, name: string): Promise<Result> {
  return guard(async () => {
    const { v, board: b } = await ctx(projectId);
    if (!b.canRenameProject()) return fail('Only the project manager and admins can rename the project.');
    const n = name.trim().slice(0, 120);
    if (!n) return fail('Name the project.');
    if (n === b.p.name) return { ok: true, msg: 'Saved' };
    await db.update(s.projects).set({ name: n }).where(eq(s.projects.id, projectId));
    await notify(b, v, { teams: b.teams.map(t => t.id), kind: 'update', text: `${v.name} renamed the project "${b.p.name}" to "${n}"`, taskId: null });
    revalidatePath('/', 'layout');
    return done(projectId, 'Project renamed');
  });
}

export async function removeColumn(columnId: string): Promise<Result> {
  return guard(async () => {
    const [c] = await db.select().from(s.columns).where(eq(s.columns.id, columnId));
    if (!c) return fail('That column no longer exists.');
    const [t] = await db.select().from(s.teams).where(eq(s.teams.id, c.teamId));
    const { v, board: b } = await ctx(t.projectId);
    if (!b.canEditCols(t.id)) return fail('Only this team’s lead and the project manager can remove columns.');
    const n = (await db.select({ id: s.tasks.id }).from(s.tasks).where(eq(s.tasks.columnId, columnId))).length;
    if (n) return fail(`${c.name} still has ${n} card${n > 1 ? 's' : ''}. Move ${n > 1 ? 'them' : 'it'} out first.`);
    if (b.teamCols(t.id).length < 2) return fail(`${t.name} needs at least one column.`);
    await db.update(s.columns).set({ archivedAt: new Date() }).where(eq(s.columns.id, columnId));
    await notify(b, v, { teams: [t.id], kind: 'update', text: `${v.name} removed the empty column "${c.name}" from ${t.name}`, taskId: null });
    return done(t.projectId, `Removed ${c.name}`);
  });
}

// ---------- people & roles ----------
async function sameOrg(v: Viewer, projectId: string, userIds: string[]) {
  const [p] = await db.select({ org: s.projects.organizationId }).from(s.projects).where(eq(s.projects.id, projectId));
  if (p?.org !== v.organizationId) return false;
  if (!userIds.length) return true;
  const us = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.organizationId, v.organizationId), inArray(s.users.id, userIds)));
  return us.length === userIds.length;
}
async function admin() {
  const v = await requireUser();
  if (!isAdminRole(v.orgRole ?? null)) throw new Error('Only a Super admin or Head of projects can manage people.');
  return v;
}

export async function addPerson(form: FormData): Promise<Result & { password?: string }> {
  try {
    const v = await admin();
    const name = String(form.get('name') ?? '').trim(), email = String(form.get('email') ?? '').trim().toLowerCase();
    const org = String(form.get('orgRole') ?? '') || null;
    if (!name || !email) return fail('Add a name and email.');
    if (org && !assignable(v.orgRole ?? null).includes(org as 'pm')) return fail('You cannot give that role.');
    const [dupe] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
    if (dupe) return fail('Someone with that email already exists.');
    const password = randomBytes(9).toString('base64url');
    const [u] = await db.insert(s.users).values({ organizationId: v.organizationId, name, email, orgRole: org as 'pm' | null, passwordHash: await bcrypt.hash(password, 10), hue: Math.floor(Math.random() * 360) }).returning();
    const pid = String(form.get('projectId') ?? ''), tid = String(form.get('teamId') ?? '');
    const [team] = tid ? await db.select().from(s.teams).where(eq(s.teams.id, tid)) : [];
    if (team && await sameOrg(v, team.projectId, [])) {
      const kind = String(form.get('teamRole') ?? 'member') as 'lead' | 'member';
      await placeInTeam(u.id, tid, kind);
      const pp = await projectPeople(team.projectId);
      await notifyUsers(v, pp.ids, { projectId: team.projectId, text: `${v.name} added ${name} to ${team.name} as ${kind === 'lead' ? 'team lead' : 'a member'}` });
    }
    revalidatePath('/people');
    return { ok: true, msg: `Added ${name}`, password };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Could not add that person.'); }
}

async function placeInTeam(userId: string, teamId: string, kind: 'lead' | 'member') {
  const [t] = await db.select().from(s.teams).where(eq(s.teams.id, teamId));
  const siblings = await db.select().from(s.teams).where(eq(s.teams.projectId, t.projectId));
  for (const x of siblings) {
    await db.delete(s.teamMembers).where(and(eq(s.teamMembers.teamId, x.id), eq(s.teamMembers.userId, userId)));
    if (x.leadId === userId && x.id !== teamId) {
      const [next] = await db.select().from(s.teamMembers).where(eq(s.teamMembers.teamId, x.id)).limit(1);
      if (next) { await db.delete(s.teamMembers).where(and(eq(s.teamMembers.teamId, x.id), eq(s.teamMembers.userId, next.userId))); }
      await db.update(s.teams).set({ leadId: next?.userId ?? null }).where(eq(s.teams.id, x.id));
    }
  }
  if (kind === 'lead') {
    if (t.leadId && t.leadId !== userId) await db.insert(s.teamMembers).values({ teamId, userId: t.leadId }).onConflictDoNothing();
    await db.update(s.teams).set({ leadId: userId }).where(eq(s.teams.id, teamId));
  } else if (t.leadId !== userId) await db.insert(s.teamMembers).values({ teamId, userId }).onConflictDoNothing();
}

export async function setTeamPlacement(userId: string, teamId: string, kind: 'lead' | 'member' | 'remove'): Promise<Result> {
  return guard(async () => {
    const v = await admin();
    const [t] = await db.select().from(s.teams).where(eq(s.teams.id, teamId));
    if (!t || !(await sameOrg(v, t.projectId, [userId]))) return fail('That team no longer exists.');
    if (kind === 'remove' || (kind === 'member' && t.leadId === userId)) {
      if (t.leadId === userId) {
        const [next] = await db.select().from(s.teamMembers).where(eq(s.teamMembers.teamId, teamId)).limit(1);
        if (!next) return fail(`${t.name} needs a lead. Add someone else first.`);
        await db.delete(s.teamMembers).where(and(eq(s.teamMembers.teamId, teamId), eq(s.teamMembers.userId, next.userId)));
        await db.update(s.teams).set({ leadId: next.userId }).where(eq(s.teams.id, teamId));
        if (kind === 'member') await db.insert(s.teamMembers).values({ teamId, userId });
      } else await db.delete(s.teamMembers).where(and(eq(s.teamMembers.teamId, teamId), eq(s.teamMembers.userId, userId)));
    } else await placeInTeam(userId, teamId, kind);
    const [who] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, userId));
    const what = kind === 'remove' ? `removed ${who.name} from ${t.name}` : `made ${who.name} ${kind === 'lead' ? 'team lead' : 'a member'} of ${t.name}`;
    const pp = await projectPeople(t.projectId);
    await notifyUsers(v, [...pp.ids, userId], { projectId: t.projectId, text: `${v.name} ${what}` });
    revalidatePath('/people'); revalidatePath(`/p/${t.projectId}`);
    return { ok: true, msg: 'Saved' };
  });
}

export async function setOrgRole(userId: string, role: '' | 'super' | 'head' | 'pm'): Promise<Result> {
  return guard(async () => {
    const v = await admin();
    if (userId === v.id) return fail('You cannot change your own role.');
    const [u] = await db.select().from(s.users).where(and(eq(s.users.id, userId), eq(s.users.organizationId, v.organizationId)));
    if (!u) return fail('That person is not in your organisation.');
    const can = assignable(v.orgRole ?? null);
    if ((u.orgRole && !can.includes(u.orgRole)) || (role && !can.includes(role))) return fail('You cannot give or take that role.');
    await db.update(s.users).set({ orgRole: role || null }).where(eq(s.users.id, userId));
    const label = { super: 'Super admin', head: 'Head of projects', pm: 'Project manager' };
    await notifyUsers(v, [userId], { projectId: null, text: role ? `${v.name} made you ${label[role]}` : `${v.name} removed your organisation role` });
    revalidatePath('/', 'layout');
    return { ok: true, msg: 'Role updated' };
  });
}

export async function setProjectManager(projectId: string, userId: string): Promise<Result> {
  return guard(async () => {
    const v = await admin();
    const [u] = await db.select().from(s.users).where(and(eq(s.users.id, userId), eq(s.users.organizationId, v.organizationId)));
    if (!u?.orgRole) return fail('Give them the Project manager role first.');
    const before = await projectPeople(projectId);
    if (!before.project || before.project.organizationId !== v.organizationId) return fail('That project no longer exists.');
    await db.update(s.projects).set({ managerId: userId }).where(eq(s.projects.id, projectId));
    await notifyUsers(v, [...before.ids, userId], { projectId, text: `${v.name} made ${u.name} the project manager of "${before.project.name}"` });
    revalidatePath('/', 'layout');
    return { ok: true, msg: `${u.name} now manages this project` };
  });
}

// ---------- project builder ----------
export interface DraftTeam { name: string; color: string; lead: string; members: string[]; cols: { name: string; est: number; owners: string[] }[] }
export async function createProject(draft: { name: string; manager?: string; teams: DraftTeam[] }): Promise<Result & { id?: string }> {
  try {
    const v = await requireUser();
    if (!(isAdminRole(v.orgRole ?? null) || v.orgRole === 'pm')) return fail('Only project managers and admins can create projects.');
    if (!draft.name.trim()) return fail('Name the project.');
    if (!draft.teams.length || draft.teams.some(t => !t.name.trim() || !t.lead || !t.cols.length || t.cols.some(c => !c.name.trim() || !(c.est > 0)))) return fail('Every team needs a name, a lead and named columns with estimates.');
    const used = [...new Set(draft.teams.flatMap(t => [t.lead, ...t.members, ...t.cols.flatMap(c => c.owners)]))];
    const known = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.organizationId, v.organizationId), inArray(s.users.id, used)));
    if (known.length !== used.length) return fail('Some people in this project are not in your organisation.');
    if (draft.teams.some(t => !SWATCHES.includes(t.color) || t.cols.some(c => c.owners.some(o => o !== t.lead && !t.members.includes(o))))) return fail('Column owners must be on that team.');
    let managerId = v.id;
    if (isAdminRole(v.orgRole ?? null) && draft.manager) {
      const [m] = await db.select().from(s.users).where(and(eq(s.users.id, draft.manager), eq(s.users.organizationId, v.organizationId)));
      if (!m?.orgRole) return fail('The project manager needs the Project manager role.');
      managerId = m.id;
    }
    const id = await db.transaction(async tx => {
      const [p] = await tx.insert(s.projects).values({ organizationId: v.organizationId, name: draft.name.trim(), managerId }).returning();
      for (const [i, t] of draft.teams.entries()) {
        const [team] = await tx.insert(s.teams).values({ projectId: p.id, name: t.name.trim(), color: t.color, lineOrder: i, leadId: t.lead }).returning();
        const members = [...new Set(t.members.filter(m => m !== t.lead))];
        if (members.length) await tx.insert(s.teamMembers).values(members.map(userId => ({ teamId: team.id, userId })));
        for (const [j, c] of t.cols.entries()) {
          const [col] = await tx.insert(s.columns).values({ teamId: team.id, name: c.name.trim(), position: j, estimateMinutes: Math.round(c.est * 60) }).returning();
          if (c.owners.length) await tx.insert(s.columnOwners).values([...new Set(c.owners)].map(userId => ({ columnId: col.id, userId })));
        }
      }
      return p.id;
    });
    await notifyUsers(v, [managerId, ...used], { projectId: id, text: `${v.name} created the project "${draft.name.trim()}" and added you to it` });
    revalidatePath('/', 'layout');
    return { ok: true, id, msg: 'Project created' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Could not create the project.'); }
}

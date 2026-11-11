'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { db, schema as s } from '@/db';
import { currentUser, endSession, requireUser, startSession, type Viewer } from '@/lib/auth';
import { boardFor, people, taskDetail, tasksFor } from '@/lib/data';
import { blobRef, storeFile } from '@/lib/files';
import { DEFAULT_HOURS, WEEKDAYS, addWork, hhmm, validZone, type WorkHours } from '@/lib/hours';
import { SWATCHES, assignable, Board, isAdminRole, mentionsIn, type Column, type Mentionable, type Task } from '@/lib/rules';

type Result = { ok: true; msg?: string } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const STALE = 'Someone else just moved this card. The board has been refreshed, so check where it is now.';

// ---------- auth ----------
export async function login(_: unknown, form: FormData) {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const [u] = await db.select().from(s.users).where(eq(s.users.email, email));
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) return { error: 'Email or password is wrong.' };
  await startSession(u.id);
  redirect(u.mustChangePassword ? '/account?first=1' : '/');
}

// First run only: creates the organisation and its Super admin when the database has no users yet.
export async function setupOrganization(_: unknown, form: FormData) {
  const org = String(form.get('org') ?? '').trim(), name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase(), password = String(form.get('password') ?? '');
  const tz = String(form.get('tz') ?? '');
  if (!org || !name || !/^\S+@\S+\.\S+$/.test(email)) return { error: 'Fill in every field.' };
  if (password.length < 8) return { error: 'Use at least 8 characters for the password.' };
  const id = await db.transaction(async tx => {
    await tx.execute(sql`LOCK TABLE users IN EXCLUSIVE MODE`);
    if ((await tx.select({ id: s.users.id }).from(s.users).limit(1)).length) return null;
    const [o] = await tx.insert(s.organizations).values({ name: org, workHours: { ...DEFAULT_HOURS, tz: validZone(tz) ? tz : DEFAULT_HOURS.tz } }).returning();
    const [u] = await tx.insert(s.users).values({ organizationId: o.id, name, email, orgRole: 'super', passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false }).returning();
    return u.id;
  });
  if (!id) return { error: 'This Line Board is already set up. Sign in instead.' };
  await startSession(id);
  redirect('/hours');
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

// Everyone assigned to a task or one of its subtasks, read fresh so it reflects the change just made.
async function taskPeople(taskId: string) {
  const [as, subs] = await Promise.all([
    db.select({ id: s.taskAssignees.userId }).from(s.taskAssignees).where(eq(s.taskAssignees.taskId, taskId)),
    db.select({ id: s.subtasks.assigneeId }).from(s.subtasks).where(eq(s.subtasks.taskId, taskId)),
  ]);
  return [...as, ...subs].map(x => x.id).filter((x): x is string => !!x);
}

// Fan out an in-app notification: the given teams, the task's assignees (task and subtasks) and the project manager, never the actor.
async function notify(b: Board, v: Viewer, opts: { teams: (string | null)[]; kind: 'update' | 'move' | 'comment' | 'back'; text: string; taskId: string | null }) {
  const to = new Set<string>([b.p.managerId, ...opts.teams.flatMap(t => teamPeople(b, t)), ...(opts.taskId ? await taskPeople(opts.taskId) : [])]);
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

const names = async (orgId: string, ids: string[]) => { const ps = await people(orgId); return ids.map(id => ps.find(p => p.id === id)?.name ?? 'someone').join(', '); };

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
  const stored = [...await Promise.all(form.getAll(`${key}:ref`).map(r => blobRef(String(r)))), ...await Promise.all(files.map(storeFile))];
  for (const st of stored) out.push({ taskId, commentId, uploadedBy: by, name: st.name, mimeType: st.mime, size: st.size, url: st.url });
  if (out.length) await db.insert(s.attachments).values(out);
  return out;
}

const log = (taskId: string, userId: string | null, text: string) => db.insert(s.taskEvents).values({ taskId, userId, text });
// Marks the project changed so every open board refreshes (see app/api/pulse).
const touch = (projectIds: string | string[]) => { const ids = [projectIds].flat(); return ids.length ? db.update(s.projects).set({ changedAt: new Date() }).where(inArray(s.projects.id, ids)) : null; };
const done = async (projectId: string, msg?: string): Promise<Result> => { await touch(projectId); revalidatePath(`/p/${projectId}`); revalidatePath('/dashboard'); return { ok: true, msg }; };
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
    // The board the person dragged on may be out of date: refuse rather than guess what they meant.
    const seen = form.get('from');
    if (seen != null && String(seen) !== tk.col) return fail(STALE);
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
    const spent = b.work(tk.entered, now.getTime());
    // Moving a card that is on hold resumes it first: the hold's working time pushes the deadline back.
    const held = tk.hold ? b.work(tk.hold.since, now.getTime()) : 0;
    if (held && deadline && !rule.needsDeadline) deadline = addWork(b.p.hours, deadline, held);
    // Lock the row and check nobody moved it since this person loaded the board.
    const moved = await db.transaction(async tx => {
      const [cur] = await tx.select({ stage: s.tasks.stage, columnId: s.tasks.columnId, entered: s.tasks.enteredColumnAt }).from(s.tasks).where(eq(s.tasks.id, tk.id)).for('update');
      if (!cur || (cur.stage === 'line' ? cur.columnId : cur.stage) !== tk.col || cur.entered.getTime() !== tk.entered) return false;
      if (!('special' in from && from.special)) await tx.insert(s.stints).values({ taskId: tk.id, columnId: from.id, startedAt: new Date(tk.entered), endedAt: now, pausedMs: (tk.paused ?? 0) + held });
      await tx.update(s.tasks).set({
        stage: toId === 'todo' ? 'todo' : toId === 'done' ? 'done' : 'line',
        columnId: toId === 'todo' || toId === 'done' ? null : toId,
        enteredColumnAt: now,
        deadlineAt: deadline ? new Date(deadline) : null,
        holdSince: null, holdReason: null, pausedMs: 0,
        ...(fromTeam ? { lastTeamId: fromTeam } : {}),
        ...(tk.col === 'todo' ? { startedAt: now } : {}),
      }).where(eq(s.tasks.id, tk.id));
      return true;
    });
    if (!moved) { await touch(b.p.id); return fail(STALE); }
    const tName = (id: string | null) => b.team(id)?.name ?? '';
    let text = `Moved from ${from.name} to ${to.name}`;
    if (rule.kind === 'start') text = `Started from the backlog in ${tName(toTeam)} (${to.name})`;
    if (rule.kind === 'reopen') text = `Reopened in ${tName(toTeam)} (${to.name})`;
    if (rule.kind === 'done') text = 'Marked done';
    if (rule.kind === 'backlog') text = 'Moved back to the backlog';
    if (rule.kind === 'handover') text = `Handed over from ${tName(fromTeam)} to ${tName(toTeam)} (${to.name})`;
    if (rule.kind === 'back') text = `Sent back to ${tName(toTeam)} (${to.name}) for review`;
    if (!('special' in from && from.special)) text += ` after ${b.fmt(spent)} in ${from.name}`;
    await log(tk.id, v.id, note ? `${text}. Reason: "${note}"` : text);
    if (tk.hold) await log(tk.id, v.id, `Resumed from hold after ${b.fmt(held)}${held && tk.deadline && !rule.needsDeadline ? ', deadline pushed back by the same' : ''}`);
    if (rule.needsDeadline) await log(tk.id, v.id, `Set the deadline`);
    // Assignees stay with the task. When it reaches a team none of them are on, its lead is told to add someone.
    const unstaffed = toTeam !== fromTeam && toTeam != null && !b.hasTeamAssignee({ ...tk, col: toId });
    if (unstaffed) {
      await log(tk.id, v.id, `Nobody on ${tName(toTeam)} is assigned yet`);
      await notifyUsers(v, [b.team(toTeam)?.leadId], { projectId: b.p.id, taskId: tk.id, text: `"${tk.title}" reached ${tName(toTeam)} (${to.name}) and nobody on your team is assigned to it yet` });
    }
    if (note) {
      const [c] = await db.insert(s.comments).values({ taskId: tk.id, userId: v.id, kind: rule.kind === 'back' ? 'back' : rule.kind === 'done' ? 'done' : 'backlog', body: note }).returning();
      await saveFiles(form, 'files', tk.id, v.id, c.id);
      await notifyMentions(b, v, tk, note, rule.kind === 'back' ? 'a send-back reason' : rule.kind === 'done' ? 'a done note' : 'a backlog note');
    }
    const what = rule.kind === 'done' ? `marked "${tk.title}" done` : rule.kind === 'start' ? `started "${tk.title}" in ${to.name}` : rule.kind === 'handover' ? `handed "${tk.title}" to ${tName(toTeam)}`
      : rule.kind === 'back' ? `sent "${tk.title}" back to ${to.name}` : `moved "${tk.title}" to ${to.name}`;
    await notify(b, v, { teams: [fromTeam ?? tk.lastTeam, toTeam], kind: rule.kind === 'back' ? 'back' : 'move', text: `${v.name} ${what}${note ? ': ' + note : ''}`, taskId: tk.id });
    const msg = rule.kind === 'done' ? 'Marked done' : rule.kind === 'handover' ? `Handed to ${tName(toTeam)}` : rule.kind === 'back' ? `Sent back to ${tName(toTeam)}` : `Moved to ${to.name}`;
    return done(b.p.id, unstaffed ? `${msg}. Nobody on ${tName(toTeam)} is assigned yet` : msg);
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
    const who = [...new Set(form.getAll('assignee').map(String).filter(Boolean))];
    if (who.some(id => !b.crew.includes(id))) return fail('Assignees must be on one of this project’s teams.');
    const now = new Date();
    const [tk] = await db.insert(s.tasks).values({
      projectId, stage: backlog ? 'todo' : 'line', columnId: backlog ? null : colId, title, description: String(form.get('desc') ?? '').trim(),
      deadlineAt: dl > 0 ? new Date(dl) : null, startedAt: backlog ? null : now, enteredColumnAt: now, createdBy: v.id,
    }).returning();
    if (who.length) await db.insert(s.taskAssignees).values(who.map(userId => ({ taskId: tk.id, userId })));
    const subs = String(form.get('subtasks') ?? '').split('\n').map(x => x.trim()).filter(Boolean);
    if (subs.length) {
      const span = (dl > 0 ? dl : now.getTime() + 7 * 864e5) - now.getTime();
      await db.insert(s.subtasks).values(subs.map((t, i) => ({ taskId: tk.id, title: t, position: i, deadlineAt: new Date(now.getTime() + span * (i + 1) / (subs.length + 1)) })));
    }
    await saveFiles(form, 'files', tk.id, v.id);
    await log(tk.id, v.id, backlog ? 'Added to the backlog' : `Created in ${c.name}`);
    await notify(b, v, { teams: [c.teamId], kind: 'update', text: `${v.name} added "${title}" to ${c.name}${who.length ? ` and assigned ${await names(v.organizationId, who)}` : ''}`, taskId: tk.id });
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
    const hasFiles = form.getAll('files').some(f => f instanceof File && f.size > 0) || form.getAll('files:ref').length > 0;
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

// ---------- editing a task after it is created ----------
// Assignees, the overall deadline and removing subtasks: the lead of the team holding the card, or PM and above.
// Adding subtasks and choosing who does each one: anyone who can work the card, so members can break down their own work.
// Assignees can be anyone on the project's teams, and they stay with the task as it moves.

export async function setAssignees(taskId: string, ids: string[]): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(taskId);
    if (!b.canRenameTask(tk)) return fail('Only the team lead or the project manager can change who is on this task.');
    const next = [...new Set(ids)];
    if (next.some(id => !b.crew.includes(id))) return fail('Assignees must be on one of this project’s teams.');
    if (next.length === tk.assignees.length && next.every(a => tk.assignees.includes(a))) return { ok: true, msg: 'Saved' };
    await db.transaction(async tx => {
      await tx.delete(s.taskAssignees).where(eq(s.taskAssignees.taskId, tk.id));
      if (next.length) await tx.insert(s.taskAssignees).values(next.map(userId => ({ taskId: tk.id, userId })));
    });
    const who = next.length ? await names(v.organizationId, next) : 'nobody';
    await log(tk.id, v.id, `Assigned to ${who}`);
    await notifyUsers(v, [...next, ...tk.assignees, ...teamPeople(b, b.cardTeam(tk)), b.p.managerId], { projectId: b.p.id, taskId: tk.id, text: `${v.name} assigned "${tk.title}" to ${who}` });
    return done(b.p.id, 'Assignees saved');
  });
}

export async function setDeadline(taskId: string, iso: string): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(taskId);
    if (!b.canRenameTask(tk)) return fail('Only the team lead or the project manager can change the deadline.');
    if (tk.col === 'done') return fail('Finished tasks keep their deadline.');
    const d = iso ? Date.parse(iso) : NaN;
    if (!iso && tk.col !== 'todo') return fail('Tasks on the line need a deadline.');
    if (iso && !(d > 0)) return fail('Pick a valid date and time.');
    if ((d || null) === tk.deadline) return { ok: true, msg: 'Saved' };
    await db.update(s.tasks).set({ deadlineAt: iso ? new Date(d) : null }).where(eq(s.tasks.id, tk.id));
    const txt = iso ? `Changed the deadline to ${new Date(d).toLocaleString('en-GB', { timeZone: b.p.hours?.tz ?? 'UTC', dateStyle: 'medium', timeStyle: 'short' })}` : 'Removed the deadline';
    await log(tk.id, v.id, txt);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} ${iso ? 'changed the deadline of' : 'removed the deadline of'} "${tk.title}"`, taskId: tk.id });
    return done(b.p.id, 'Deadline saved');
  });
}

export async function addSubtask(taskId: string, title: string, deadlineIso: string, assignee = ''): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(taskId);
    if (!canEditTask(b, tk)) return fail('You can only add subtasks to tasks in your own team.');
    const t = title.trim().slice(0, 200);
    if (!t) return fail('Name the subtask.');
    const d = deadlineIso ? Date.parse(deadlineIso) : NaN;
    if (deadlineIso && !(d > 0)) return fail('Pick a valid date for the subtask.');
    if (assignee && !b.crew.includes(assignee)) return fail('The subtask’s assignee must be on one of this project’s teams.');
    await db.insert(s.subtasks).values({ taskId: tk.id, title: t, position: tk.subtasks.length, deadlineAt: d > 0 ? new Date(d) : null, assigneeId: assignee || null });
    const forWho = assignee ? ` for ${await names(v.organizationId, [assignee])}` : '';
    await log(tk.id, v.id, `Added subtask "${t}"${forWho}`);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} added the subtask "${t}"${forWho} to "${tk.title}"`, taskId: tk.id });
    return done(b.p.id, 'Subtask added');
  });
}

// A subtask has one assignee at most; '' clears it.
export async function setSubtaskAssignee(subId: string, userId: string): Promise<Result> {
  return guard(async () => {
    const [st] = await db.select().from(s.subtasks).where(eq(s.subtasks.id, subId));
    if (!st) return fail('That subtask no longer exists.');
    const { v, board: b, tk } = await loadTask(st.taskId);
    if (!canEditTask(b, tk)) return fail('You can only assign subtasks on tasks in your own team.');
    if (userId && !b.crew.includes(userId)) return fail('The subtask’s assignee must be on one of this project’s teams.');
    if ((userId || null) === st.assigneeId) return { ok: true, msg: 'Saved' };
    await db.update(s.subtasks).set({ assigneeId: userId || null }).where(eq(s.subtasks.id, subId));
    const who = userId ? await names(v.organizationId, [userId]) : '';
    await log(tk.id, v.id, userId ? `Assigned subtask "${st.title}" to ${who}` : `Unassigned subtask "${st.title}"`);
    // notify() reaches the new assignee through the task's people; the previous one is told separately.
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: userId ? `${v.name} assigned the subtask "${st.title}" on "${tk.title}" to ${who}` : `${v.name} unassigned the subtask "${st.title}" on "${tk.title}"`, taskId: tk.id });
    if (st.assigneeId && st.assigneeId !== userId) await notifyUsers(v, [st.assigneeId], { projectId: b.p.id, taskId: tk.id, text: `${v.name} took you off the subtask "${st.title}" on "${tk.title}"` });
    return done(b.p.id, userId ? `Subtask assigned to ${who}` : 'Subtask unassigned');
  });
}

export async function removeSubtask(subId: string): Promise<Result> {
  return guard(async () => {
    const [st] = await db.select().from(s.subtasks).where(eq(s.subtasks.id, subId));
    if (!st) return fail('That subtask no longer exists.');
    const { v, board: b, tk } = await loadTask(st.taskId);
    if (!b.canRenameTask(tk)) return fail('Only the team lead or the project manager can remove subtasks.');
    await db.delete(s.subtasks).where(eq(s.subtasks.id, subId));
    await log(tk.id, v.id, `Removed subtask "${st.title}"`);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} removed the subtask "${st.title}" from "${tk.title}"`, taskId: tk.id });
    return done(b.p.id, 'Subtask removed');
  });
}

// ---------- on hold ----------
// A card waiting on something outside the team (client feedback, assets, a shoot date) is put on hold:
// its column clock and deadline stop. Resuming adds the time on hold to the column's allowance and
// pushes the deadline back by the same working time.
export async function holdTask(taskId: string, reason: string): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(taskId);
    if (!b.canHold(tk)) return fail('Only this team and the project manager can put this card on hold.');
    if (tk.hold) return fail('This card is already on hold.');
    const why = reason.trim().slice(0, 500);
    if (!why) return fail('Say what the card is waiting for.');
    const r = await db.update(s.tasks).set({ holdSince: new Date(), holdReason: why }).where(and(eq(s.tasks.id, tk.id), isNull(s.tasks.holdSince))).returning({ id: s.tasks.id });
    if (!r.length) return fail('Someone else just put this card on hold.');
    await log(tk.id, v.id, `Put on hold: "${why}"`);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} put "${tk.title}" on hold: ${why}`, taskId: tk.id });
    await notifyMentions(b, v, tk, why, 'a hold reason');
    return done(b.p.id, 'On hold. Clocks stopped');
  });
}

export async function resumeTask(taskId: string): Promise<Result> {
  return guard(async () => {
    const { v, board: b, tk } = await loadTask(taskId);
    if (!b.canHold(tk)) return fail('Only this team and the project manager can resume this card.');
    if (!tk.hold) return { ok: true, msg: 'Already running' };
    const now = Date.now(), held = b.work(tk.hold.since, now);
    const deadline = tk.deadline ? addWork(b.p.hours, tk.deadline, held) : null;
    const r = await db.update(s.tasks).set({ holdSince: null, holdReason: null, pausedMs: (tk.paused ?? 0) + held, deadlineAt: deadline ? new Date(deadline) : null })
      .where(and(eq(s.tasks.id, tk.id), eq(s.tasks.holdSince, new Date(tk.hold.since)))).returning({ id: s.tasks.id });
    if (!r.length) return fail('Someone else just changed this card. The board has been refreshed.');
    await log(tk.id, v.id, `Resumed after ${b.fmt(held)} on hold${held && deadline ? '; deadline pushed back by the same' : ''}`);
    await notify(b, v, { teams: [b.cardTeam(tk)], kind: 'update', text: `${v.name} resumed "${tk.title}" after ${b.fmt(held)} on hold`, taskId: tk.id });
    return done(b.p.id, held ? `Resumed. Deadline pushed back ${b.fmt(held)}` : 'Resumed');
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
      await tx.insert(s.columns).values({ teamId, name, position: at, estimateMinutes: Math.round(est * 60) });
      for (const [i, x] of ordered.entries()) if (x) await tx.update(s.columns).set({ position: i }).where(eq(s.columns.id, x.id));
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

export async function setColumnEstimate(columnId: string, hours: number): Promise<Result> {
  return guard(async () => {
    const [c] = await db.select().from(s.columns).where(eq(s.columns.id, columnId));
    if (!c) return fail('That column no longer exists.');
    const [t] = await db.select().from(s.teams).where(eq(s.teams.id, c.teamId));
    const { v, board: b } = await ctx(t.projectId);
    if (!b.canEditCols(t.id)) return fail('Only this team’s lead and the project manager can change estimates.');
    const min = Math.round(hours * 60);
    if (!(min >= 15 && min <= 1000 * 60)) return fail('Use an estimate between 0.25 and 1000 working hours.');
    if (min === c.estimateMinutes) return { ok: true, msg: 'Saved' };
    await db.update(s.columns).set({ estimateMinutes: min }).where(eq(s.columns.id, columnId));
    await notify(b, v, { teams: [t.id], kind: 'update', text: `${v.name} changed the estimate of "${c.name}" from ${c.estimateMinutes / 60} h to ${min / 60} h`, taskId: null });
    return done(t.projectId, 'Estimate saved');
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
      await touch(team.projectId);
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
    await touch(t.projectId);
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
    await touch(projectId);
    revalidatePath('/', 'layout');
    return { ok: true, msg: `${u.name} now manages this project` };
  });
}

// ---------- project builder ----------
export interface DraftTeam { name: string; color: string; lead: string; members: string[]; cols: { name: string; est: number }[] }
export async function createProject(draft: { name: string; manager?: string; teams: DraftTeam[] }): Promise<Result & { id?: string }> {
  try {
    const v = await requireUser();
    if (!(isAdminRole(v.orgRole ?? null) || v.orgRole === 'pm')) return fail('Only project managers and admins can create projects.');
    if (!draft.name.trim()) return fail('Name the project.');
    if (!draft.teams.length || draft.teams.some(t => !t.name.trim() || !t.lead || !t.cols.length || t.cols.some(c => !c.name.trim() || !(c.est > 0)))) return fail('Every team needs a name, a lead and named columns with estimates.');
    const used = [...new Set(draft.teams.flatMap(t => [t.lead, ...t.members]))];
    const known = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.organizationId, v.organizationId), inArray(s.users.id, used)));
    if (known.length !== used.length) return fail('Some people in this project are not in your organisation.');
    if (draft.teams.some(t => !SWATCHES.includes(t.color))) return fail('Pick a colour for every team.');
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
          await tx.insert(s.columns).values({ teamId: team.id, name: c.name.trim(), position: j, estimateMinutes: Math.round(c.est * 60) });
        }
      }
      return p.id;
    });
    await notifyUsers(v, [managerId, ...used], { projectId: id, text: `${v.name} created the project "${draft.name.trim()}" and added you to it` });
    revalidatePath('/', 'layout');
    return { ok: true, id, msg: 'Project created' };
  } catch (e) { return fail(e instanceof Error ? e.message : 'Could not create the project.'); }
}

// ---------- working hours ----------
export async function saveWorkHours(h: WorkHours): Promise<Result> {
  return guard(async () => {
    const v = await requireUser();
    if (v.orgRole !== 'super') return fail('Only the Super admin can change working hours.');
    const days = [...new Set(h.days)].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    const holidays = [...new Set(h.holidays)].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const start = Math.round(h.start), end = Math.round(h.end);
    if (!validZone(h.tz)) return fail('Pick a valid time zone.');
    if (!days.length) return fail('Pick at least one working day.');
    if (!(start >= 0 && end <= 1440 && end > start)) return fail('The working day must end after it starts.');
    await db.update(s.organizations).set({ workHours: { tz: h.tz, days, start, end, holidays } }).where(eq(s.organizations.id, v.organizationId));
    const everyone = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.organizationId, v.organizationId));
    await db.update(s.projects).set({ changedAt: new Date() }).where(eq(s.projects.organizationId, v.organizationId));
    await notifyUsers(v, everyone.map(u => u.id), { projectId: null, text: `${v.name} changed the working hours to ${days.map(d => WEEKDAYS[d].slice(0, 3)).join(', ')}, ${hhmm(start)} to ${hhmm(end)} (${h.tz})` });
    revalidatePath('/', 'layout');
    return { ok: true, msg: 'Working hours saved' };
  });
}

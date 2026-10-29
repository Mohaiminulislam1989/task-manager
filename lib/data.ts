import 'server-only';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema as s } from '@/db';
import { Board, roleIn, type Column, type Person, type ProjectShape, type Task, type OrgRole } from './rules';
import type { Viewer } from './auth';

export async function people(orgId: string): Promise<Person[]> {
  const rows = await db.select().from(s.users).where(eq(s.users.organizationId, orgId)).orderBy(asc(s.users.name));
  return rows.map(u => ({ id: u.id, name: u.name, email: u.email, hue: u.hue, orgRole: u.orgRole ?? null }));
}

export async function projectShapes(orgId: string, ids?: string[]): Promise<(ProjectShape & { archived: Column[] })[]> {
  const ps = await db.select().from(s.projects).where(ids ? and(eq(s.projects.organizationId, orgId), inArray(s.projects.id, ids)) : eq(s.projects.organizationId, orgId)).orderBy(asc(s.projects.createdAt));
  if (!ps.length) return [];
  const [org] = await db.select({ hours: s.organizations.workHours }).from(s.organizations).where(eq(s.organizations.id, orgId));
  const pids = ps.map(p => p.id);
  const ts = await db.select().from(s.teams).where(inArray(s.teams.projectId, pids));
  const tids = ts.map(t => t.id);
  const tm = tids.length ? await db.select().from(s.teamMembers).where(inArray(s.teamMembers.teamId, tids)) : [];
  const cs = tids.length ? await db.select().from(s.columns).where(inArray(s.columns.teamId, tids)) : [];
  const co = cs.length ? await db.select().from(s.columnOwners).where(inArray(s.columnOwners.columnId, cs.map(c => c.id))) : [];
  return ps.map(p => {
    const teams = ts.filter(t => t.projectId === p.id).map(t => ({ id: t.id, name: t.name, color: t.color, lineOrder: t.lineOrder, leadId: t.leadId, memberIds: tm.filter(m => m.teamId === t.id).map(m => m.userId) }));
    const all = cs.filter(c => teams.some(t => t.id === c.teamId)).map(c => ({ id: c.id, teamId: c.teamId, name: c.name, position: c.position, estH: c.estimateMinutes / 60, ownerIds: co.filter(o => o.columnId === c.id).map(o => o.userId), archived: !!c.archivedAt }));
    return { id: p.id, name: p.name, managerId: p.managerId, hours: org?.hours ?? null, teams, columns: all.filter(c => !c.archived), archived: all.filter(c => c.archived) };
  });
}

export async function visibleProjects(v: Viewer) {
  const all = await projectShapes(v.organizationId);
  return all.filter(p => roleIn(p, v.id, v.orgRole ?? null));
}

export async function boardFor(v: Viewer, projectId: string) {
  const [p] = await projectShapes(v.organizationId, [projectId]);
  if (!p) return null;
  const role = roleIn(p, v.id, v.orgRole ?? null);
  if (!role) return null;
  return { shape: p, board: new Board(p, role, p.archived) };
}

export const toMs = (d: Date | null) => d ? d.getTime() : null;

export async function tasksFor(projectIds: string[]): Promise<(Task & { projectId: string; commentCount: number; fileCount: number })[]> {
  if (!projectIds.length) return [];
  const ts = await db.select().from(s.tasks).where(inArray(s.tasks.projectId, projectIds)).orderBy(asc(s.tasks.createdAt));
  if (!ts.length) return [];
  const ids = ts.map(t => t.id);
  const [as, subs, cm, at] = await Promise.all([
    db.select().from(s.taskAssignees).where(inArray(s.taskAssignees.taskId, ids)),
    db.select().from(s.subtasks).where(inArray(s.subtasks.taskId, ids)).orderBy(asc(s.subtasks.position)),
    db.select({ taskId: s.comments.taskId }).from(s.comments).where(inArray(s.comments.taskId, ids)),
    db.select({ taskId: s.attachments.taskId }).from(s.attachments).where(inArray(s.attachments.taskId, ids)),
  ]);
  return ts.map(t => ({
    id: t.id, projectId: t.projectId, title: t.title, desc: t.description,
    col: t.stage === 'line' ? t.columnId! : t.stage,
    created: t.createdAt.getTime(), entered: t.enteredColumnAt.getTime(), started: toMs(t.startedAt), deadline: toMs(t.deadlineAt),
    assignees: as.filter(a => a.taskId === t.id).map(a => a.userId), lastTeam: t.lastTeamId,
    subtasks: subs.filter(x => x.taskId === t.id).map(x => ({ id: x.id, title: x.title, deadline: toMs(x.deadlineAt), done: x.done })),
    commentCount: cm.filter(c => c.taskId === t.id).length, fileCount: at.filter(a => a.taskId === t.id).length,
  }));
}

export async function taskDetail(taskId: string) {
  const [comments, files, events, stints] = await Promise.all([
    db.select().from(s.comments).where(eq(s.comments.taskId, taskId)).orderBy(asc(s.comments.createdAt)),
    db.select().from(s.attachments).where(eq(s.attachments.taskId, taskId)).orderBy(asc(s.attachments.createdAt)),
    db.select().from(s.taskEvents).where(eq(s.taskEvents.taskId, taskId)).orderBy(desc(s.taskEvents.createdAt)),
    db.select().from(s.stints).where(eq(s.stints.taskId, taskId)).orderBy(asc(s.stints.startedAt)),
  ]);
  const file = (f: typeof files[number]) => ({ id: f.id, name: f.name, mime: f.mimeType, size: f.size, url: f.url, by: f.uploadedBy });
  return {
    files: files.filter(f => !f.commentId).map(file),
    comments: comments.map(c => ({ id: c.id, who: c.userId, kind: c.kind, text: c.body, at: c.createdAt.getTime(), files: files.filter(f => f.commentId === c.id).map(file) })),
    log: events.map(e => ({ who: e.userId, text: e.text, at: e.createdAt.getTime() })),
    stints: stints.map(x => ({ col: x.columnId, start: x.startedAt.getTime(), end: x.endedAt.getTime() })),
  };
}
export type TaskDetail = Awaited<ReturnType<typeof taskDetail>>;

export async function notificationsFor(userId: string, projectId?: string) {
  return db.select().from(s.notifications)
    .where(projectId ? and(eq(s.notifications.userId, userId), eq(s.notifications.projectId, projectId)) : eq(s.notifications.userId, userId))
    .orderBy(desc(s.notifications.createdAt)).limit(50);
}
export const unreadFilter = isNull(s.notifications.readAt);
export type { OrgRole };

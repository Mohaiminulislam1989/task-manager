import { requireUser } from '@/lib/auth';
import { notificationsFor, people, unreadCount, visibleProjects } from '@/lib/data';
import { isAdminRole } from '@/lib/rules';
import { Shell } from '@/components/Shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const v = await requireUser();
  const [ps, projects, notes, unread] = await Promise.all([people(v.organizationId), visibleProjects(v), notificationsFor(v.id), unreadCount(v.id)]);
  const canDash = isAdminRole(v.orgRole ?? null) || v.orgRole === 'pm' || projects.some(p => p.managerId === v.id);
  return <Shell
    me={{ id: v.id, name: v.name, orgRole: v.orgRole ?? null, mustChange: v.mustChangePassword }}
    people={ps}
    projects={projects.map(p => ({ id: p.id, name: p.name }))}
    notes={notes.map(n => ({ id: n.id, projectId: n.projectId, taskId: n.taskId, by: n.byId, kind: n.kind, text: n.text, at: n.createdAt.getTime(), read: !!n.readAt }))}
    unreadCount={unread}
    canDash={canDash} isAdmin={isAdminRole(v.orgRole ?? null)} canCreate={isAdminRole(v.orgRole ?? null) || v.orgRole === 'pm'}>
    {children}
  </Shell>;
}

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { projectShapes, tasksFor } from '@/lib/data';
import { isAdminRole } from '@/lib/rules';
import { PeopleView } from '@/components/PeopleView';

export default async function PeoplePage() {
  const v = await requireUser();
  if (!isAdminRole(v.orgRole ?? null)) redirect('/');
  const projects = await projectShapes(v.organizationId);
  const tasks = await tasksFor(projects.map(p => p.id));
  return <PeopleView me={{ id: v.id, orgRole: v.orgRole ?? null }}
    projects={projects.map(({ archived: _, ...p }) => ({ ...p, taskCount: tasks.filter(t => t.projectId === p.id).length }))} />;
}

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { projectShapes, tasksFor } from '@/lib/data';
import { isAdminRole } from '@/lib/rules';
import { Dashboard } from '@/components/Dashboard';

export default async function DashboardPage() {
  const v = await requireUser();
  const admin = isAdminRole(v.orgRole ?? null);
  const scope = (await projectShapes(v.organizationId)).filter(p => admin || p.managerId === v.id);
  if (!admin && v.orgRole !== 'pm' && !scope.length) redirect('/');
  const tasks = await tasksFor(scope.map(p => p.id));
  return <Dashboard admin={admin} canCreate={admin || v.orgRole === 'pm'} projects={scope} tasks={tasks} />;
}

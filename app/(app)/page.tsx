import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { visibleProjects } from '@/lib/data';
import { isAdminRole } from '@/lib/rules';

export default async function Home() {
  const v = await requireUser();
  if (v.mustChangePassword) redirect('/account?first=1');
  const ps = await visibleProjects(v);
  if (ps.length) redirect(`/p/${ps[0].id}`);
  const canCreate = isAdminRole(v.orgRole ?? null) || v.orgRole === 'pm';
  return <main className="pane gutter"><div className="panel empty-state"><h2>No projects yet</h2>
    <p className="muted">{canCreate ? 'Create your first project to set up its teams and columns.' : 'You will see a board here once someone adds you to a project team.'}</p>
    {canCreate && <Link className="btn primary" href="/new">New project</Link>}</div></main>;
}

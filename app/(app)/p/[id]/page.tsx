import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { boardFor, tasksFor } from '@/lib/data';
import { ProjectView } from '@/components/ProjectView';

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ task?: string }> }) {
  const v = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const b = await boardFor(v, id);
  if (!b) notFound();
  const tasks = (await tasksFor([id])).map(({ projectId: _, ...t }) => t);
  return <ProjectView snap={{ project: b.shape, tasks, me: { id: v.id, orgRole: v.orgRole ?? null } }} initialTask={(await searchParams).task ?? null} />;
}

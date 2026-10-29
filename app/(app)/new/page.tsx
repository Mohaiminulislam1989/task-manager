import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { projectShapes } from '@/lib/data';
import { isAdminRole } from '@/lib/rules';
import { Builder } from '@/components/Builder';

export default async function NewProjectPage() {
  const v = await requireUser();
  const admin = isAdminRole(v.orgRole ?? null);
  if (!admin && v.orgRole !== 'pm') redirect('/');
  const mine = (await projectShapes(v.organizationId)).filter(p => admin || p.managerId === v.id).map(({ archived: _, ...p }) => p);
  return <Builder me={v.id} admin={admin} copyFrom={mine} />;
}

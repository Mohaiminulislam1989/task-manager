import { and, desc, eq } from 'drizzle-orm';
import { db, schema as s } from '@/db';
import { currentUser } from '@/lib/auth';

// A tiny "has anything changed?" stamp that open pages poll, so boards and the bell
// stay current for everyone without a reload. Works on serverless hosting (no sockets).
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = await currentUser();
  if (!v) return Response.json({ s: null }, { status: 401 });
  const p = new URL(req.url).searchParams.get('p');
  const [proj] = p && /^[0-9a-f-]{36}$/.test(p)
    ? await db.select({ at: s.projects.changedAt }).from(s.projects).where(and(eq(s.projects.id, p), eq(s.projects.organizationId, v.organizationId)))
    : [];
  const [note] = await db.select({ id: s.notifications.id }).from(s.notifications).where(eq(s.notifications.userId, v.id)).orderBy(desc(s.notifications.createdAt)).limit(1);
  return Response.json({ s: `${proj?.at.getTime() ?? 0}|${note?.id ?? ''}` }, { headers: { 'Cache-Control': 'no-store' } });
}

import { eq } from 'drizzle-orm';
import { db, schema as s } from '@/db';
import { requireUser } from '@/lib/auth';
import { DEFAULT_HOURS } from '@/lib/hours';
import { HoursForm } from '@/components/HoursForm';

export default async function HoursPage() {
  const v = await requireUser();
  const [org] = await db.select({ hours: s.organizations.workHours }).from(s.organizations).where(eq(s.organizations.id, v.organizationId));
  const zones = Intl.supportedValuesOf('timeZone');
  return <main className="pane gutter"><div className="b-narrow" style={{ margin: 0, maxWidth: 640 }}>
    <div className="pane-head"><div><h1>Working hours</h1>
      <p className="muted">Column estimates, the card dot and the deadline colour only count working time. Nights, days off and holidays don&apos;t use up anyone&apos;s time. On the board, one day means one working day.</p></div></div>
    <HoursForm initial={org?.hours ?? DEFAULT_HOURS} zones={zones.includes('UTC') ? zones : ['UTC', ...zones]} canEdit={v.orgRole === 'super'} />
  </div></main>;
}

import { redirect } from 'next/navigation';
import { db, schema as s } from '@/db';
import { SetupForm } from './SetupForm';

// First run on an empty database: the person who opens this creates the organisation and becomes its Super admin.
// Once anyone exists, this page is gone.
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const [anyone] = await db.select({ id: s.users.id }).from(s.users).limit(1);
  if (anyone) redirect('/login');
  return <main className="auth-wrap"><div className="auth-card">
    <div className="logo"><span className="mark"><i /><i /><i /></span>Line Board</div>
    <h1>Set up Line Board</h1><p className="muted">Create your agency and your own Super admin login. This page only works once, before anyone has signed up.</p>
    <SetupForm />
  </div></main>;
}

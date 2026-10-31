import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db, schema as s } from '@/db';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  if (!(await db.select({ id: s.users.id }).from(s.users).limit(1)).length) redirect('/setup');
  return <main className="auth-wrap"><div className="auth-card">
    <div className="logo"><span className="mark"><i /><i /><i /></span>Line Board</div>
    <h1>Sign in</h1><p className="muted">Use the email and password your admin gave you.</p>
    <LoginForm />
  </div></main>;
}

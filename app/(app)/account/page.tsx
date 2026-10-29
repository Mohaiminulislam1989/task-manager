import { requireUser } from '@/lib/auth';
import { ORG } from '@/lib/rules';
import { PasswordForm } from './PasswordForm';

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const v = await requireUser();
  const first = (await searchParams).first === '1' || v.mustChangePassword;
  return <main className="pane gutter"><div className="b-narrow" style={{ margin: 0, maxWidth: 520 }}>
    <div className="pane-head"><div><h1>{first ? 'Choose your password' : 'Account'}</h1>
      <p className="muted">{first ? 'You signed in with a temporary password. Pick your own before you start.' : `${v.name} · ${v.email} · ${v.orgRole ? ORG[v.orgRole] : 'Team member'}`}</p></div></div>
    <section className="panel" style={{ padding: 18 }}><h2 style={{ margin: '0 0 14px', fontSize: 15 }}>Change password</h2><PasswordForm first={first} /></section>
  </div></main>;
}

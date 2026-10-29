'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { changePassword } from '@/app/actions';

export function PasswordForm({ first }: { first: boolean }) {
  const [state, action, pending] = useActionState(changePassword, null);
  if (state && 'ok' in state) return <div className="ready" role="status">{state.ok} <Link href="/" className="link">{first ? 'Open the board' : 'Back to the board'}</Link></div>;
  return <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="field"><label htmlFor="current">{first ? 'Temporary password' : 'Current password'}</label><input id="current" name="current" type="password" autoComplete="current-password" required autoFocus /></div>
    <div className="field"><label htmlFor="next">New password</label><input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required /><small className="muted">At least 8 characters.</small></div>
    {state?.error && <p className="form-error" role="alert">{state.error}</p>}
    <div className="actions" style={{ justifyContent: 'flex-start' }}><button className="btn primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save password'}</button></div>
  </form>;
}

'use client';

import { useActionState } from 'react';
import { login } from '@/app/actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="email" required autoFocus /></div>
    <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
    {state?.error && <p className="form-error" role="alert">{state.error}</p>}
    <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
  </form>;
}

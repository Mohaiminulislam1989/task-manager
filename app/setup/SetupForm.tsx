'use client';

import { useActionState } from 'react';
import { setupOrganization } from '@/app/actions';

export function SetupForm() {
  const [state, action, pending] = useActionState(setupOrganization, null);
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  return <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="field"><label htmlFor="org">Agency name</label><input id="org" name="org" required autoFocus maxLength={80} /></div>
    <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" required maxLength={80} /></div>
    <div className="field"><label htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
    <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required /><small className="muted">At least 8 characters.</small></div>
    <input type="hidden" name="tz" value={tz} />
    {state?.error && <p className="form-error" role="alert">{state.error}</p>}
    <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Setting up…' : 'Create agency'}</button>
  </form>;
}

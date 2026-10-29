'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { OrgRole, Person } from '@/lib/rules';
import { logout, markNotificationsRead } from '@/app/actions';
import { Av, Ic, PeopleProvider, SearchProvider, ToastProvider, relTime, useNow, useSearch } from './ui';

export interface Note { id: string; projectId: string | null; taskId: string | null; by: string; kind: string; text: string; at: number; read: boolean }

export function Shell(props: { me: { id: string; name: string; orgRole: OrgRole; mustChange?: boolean }; people: Person[]; projects: { id: string; name: string }[]; notes: Note[]; canDash: boolean; isAdmin: boolean; canCreate: boolean; children: ReactNode }) {
  return <PeopleProvider people={props.people}><ToastProvider><SearchProvider><Header {...props} />{props.children}</SearchProvider></ToastProvider></PeopleProvider>;
}

function Header({ me, projects, notes, canDash, isAdmin, canCreate }: Parameters<typeof Shell>[0]) {
  const path = usePathname(), router = useRouter(), now = useNow();
  const [q, setQ] = useSearch();
  const [bell, setBell] = useState(false), [menu, setMenu] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const projectId = path.startsWith('/p/') ? path.split('/')[2] : null;
  const unread = notes.filter(n => !n.read);
  useEffect(() => { if (me.mustChange && !path.startsWith('/account')) router.replace('/account?first=1'); }, [me.mustChange, path, router]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.pop, #bellBtn, .me-menu, .me')) { setBell(false); setMenu(false); } };
    document.addEventListener('click', close); return () => document.removeEventListener('click', close);
  }, []);
  const views = [{ href: projectId ? `/p/${projectId}` : projects[0] ? `/p/${projects[0].id}` : '/', label: 'Board', on: path === '/' || path.startsWith('/p/') },
    ...(canDash ? [{ href: '/dashboard', label: 'Dashboard', on: path.startsWith('/dashboard') }] : []),
    ...(isAdmin ? [{ href: '/people', label: 'People & roles', on: path.startsWith('/people') }] : [])];
  const roleLabel = me.orgRole === 'super' ? 'Super admin' : me.orgRole === 'head' ? 'Head of projects' : me.orgRole === 'pm' ? 'Project manager' : 'Team';

  return <>
    <header className="app"><div className="app-row gutter">
      <Link href="/" className="logo"><span className="mark"><i /><i /><i /></span>Line Board</Link>
      {projectId && projects.length > 1 && <><span className="divider" /><div className="proj"><select aria-label="Project" value={projectId} onChange={e => router.push(`/p/${e.target.value}`)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div></>}
      {canCreate && <Link className="btn" href="/new"><Ic n="plus" s={14} />New project</Link>}
      {views.length > 1 && <nav className="views" aria-label="Views">{views.map(v => <Link key={v.label} href={v.href} className={v.on ? 'on' : ''}>{v.label}</Link>)}</nav>}
      <div className="grow" />
      {projectId && <label className="search" htmlFor="q"><Ic n="search" s={15} /><input id="q" type="search" placeholder="Search cards" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} /></label>}
      <button className="icon-btn" id="bellBtn" aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} onClick={() => setBell(x => !x)}><Ic n="bell" s={19} />{unread.length > 0 && <span className="count">{unread.length}</span>}</button>
      <button className="me" onClick={() => setMenu(x => !x)} aria-haspopup="menu" aria-expanded={menu}><Av id={me.id} size="sm" /><span className="me-name">{me.name} · {roleLabel}</span></button>
    </div></header>
    {menu && <div className="pop me-menu" role="menu"><Link href="/account" role="menuitem" onClick={() => setMenu(false)}><Ic n="user" s={15} />Account and password</Link><form action={logout}><button role="menuitem"><Ic n="out" s={15} />Sign out</button></form></div>}
    {bell && <div className="pop" id="notes" ref={pop}>
      <div className="pop-h"><h3>Notifications</h3>{unread.length > 0 && <button className="link" onClick={async () => { await markNotificationsRead('all'); router.refresh(); }}>Mark all read</button>}</div>
      {notes.length ? <ol>{notes.map(n => <li key={n.id} onClick={async () => { setBell(false); if (!n.read) markNotificationsRead([n.id]); router.push(n.projectId ? `/p/${n.projectId}${n.taskId ? `?task=${n.taskId}` : ''}` : '/'); }}>
        <Av id={n.by} size="lg" /><div><div className="txt">{n.text}</div><small><span className={`kind ${n.kind}`}>{n.kind === 'comment' ? 'Comment' : n.kind === 'back' ? 'Sent back' : n.kind === 'mention' ? 'Mention' : 'Update'}</span>{relTime(n.at, now)}</small></div>
        {n.read ? <span /> : <span className="unread" />}</li>)}</ol>
        : <div className="empty">You are all caught up. Comments, mentions and task updates show up here.</div>}
    </div>}
  </>;
}

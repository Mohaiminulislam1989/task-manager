'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useToast } from './ui';

type Res = { ok: true; msg?: string } | { ok: false; error: string };

// Click a name to edit it in place. Enter or clicking away saves, Escape cancels.
export function InlineName({ value, label, maxLength, save }: { value: string; label: string; maxLength: number; save: (name: string) => Promise<Res> }) {
  const [editing, setEditing] = useState(false), [shown, setShown] = useState(value);
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null), done = useRef(false);
  const toast = useToast(), router = useRouter();
  useEffect(() => setShown(value), [value]);
  useEffect(() => { if (editing) { done.current = false; input.current?.select(); } }, [editing]);
  const commit = () => {
    if (done.current) return;
    done.current = true; setEditing(false);
    const next = input.current!.value.trim();
    if (!next || next === value) return;
    setShown(next);
    start(async () => {
      const r = await save(next);
      if (r.ok) { toast(r.msg ?? 'Saved'); router.refresh(); } else { setShown(value); toast(r.error); }
    });
  };
  if (!editing) return <button type="button" className="col-title" title={`Rename ${label}`} onClick={() => setEditing(true)}>{shown}</button>;
  return <input ref={input} className="inline-name" defaultValue={shown} maxLength={maxLength} aria-label={`${label[0].toUpperCase()}${label.slice(1)} name`} autoFocus
    onClick={e => e.stopPropagation()}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); done.current = true; setEditing(false); }
    }}
    onBlur={commit} />;
}

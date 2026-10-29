'use client';

import { forwardRef, useImperativeHandle, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Av, Ic } from './ui';

export interface MentionItem { kind: 'user' | 'team'; id: string; name: string; sub: string; color?: string }
export interface MentionHandle { insertAt(): void; focus(): void; clear(): void; value(): string }

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { items: MentionItem[] };

// A textarea that offers people and teams when you type @. Mentions are stored as plain "@Name" text.
export const MentionTextarea = forwardRef<MentionHandle, Props>(function MentionTextarea({ items, onKeyDown, ...rest }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [pop, setPop] = useState<{ at: number; list: MentionItem[]; i: number; x: number; y: number; w: number } | null>(null);

  const check = () => {
    const el = ta.current!; const caret = el.selectionStart;
    const m = el.value.slice(0, caret).match(/(?:^|[\s(])@([^\s@][^@\n]{0,24})?$/);
    if (!m) return setPop(null);
    const q = (m[1] || '').toLowerCase();
    const list = items.filter(x => !q || x.name.toLowerCase().startsWith(q) || x.name.toLowerCase().includes(' ' + q)).slice(0, 8);
    if (!list.length) return setPop(null);
    const r = el.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 16), h = 44 * list.length + 30;
    setPop(p => ({ at: caret - (m[1] || '').length - 1, list, i: Math.min(p?.i ?? 0, list.length - 1), w,
      x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), y: r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4 }));
  };
  const pick = (x: MentionItem) => {
    const el = ta.current!; if (!pop) return;
    const ins = '@' + x.name + ' ';
    el.value = el.value.slice(0, pop.at) + ins + el.value.slice(el.selectionStart);
    const pos = pop.at + ins.length; el.focus(); el.setSelectionRange(pos, pos); setPop(null);
  };
  useImperativeHandle(ref, () => ({
    insertAt() { const el = ta.current!; const p = el.selectionStart ?? el.value.length, pre = el.value.slice(0, p), ins = (pre && !/\s$/.test(pre) ? ' ' : '') + '@'; el.value = pre + ins + el.value.slice(p); el.focus(); el.setSelectionRange(p + ins.length, p + ins.length); check(); },
    focus() { ta.current?.focus(); },
    clear() { if (ta.current) ta.current.value = ''; },
    value() { return ta.current?.value ?? ''; },
  }));

  const host = typeof document !== 'undefined' ? (ta.current?.closest('dialog') ?? document.body) : null;
  return <>
    <textarea ref={ta} {...rest} onInput={check} onClick={check} onBlur={() => setTimeout(() => setPop(null), 150)}
      onKeyDown={e => {
        if (pop) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPop({ ...pop, i: (pop.i + (e.key === 'ArrowDown' ? 1 : -1) + pop.list.length) % pop.list.length }); return; }
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(pop.list[pop.i]); return; }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPop(null); return; }
        }
        onKeyDown?.(e);
      }} />
    {pop && host && createPortal(
      <div className="mpop" role="listbox" style={{ left: pop.x, top: pop.y, width: pop.w }}>
        <div className="mp-h">Mention a person or team</div>
        {pop.list.map((x, i) => <div key={x.kind + x.id} role="option" aria-selected={i === pop.i} className={`mp-i ${i === pop.i ? 'on' : ''}`} onMouseDown={e => { e.preventDefault(); pick(x); }}>
          {x.kind === 'user' ? <Av id={x.id} size="sm" /> : <span className="mp-team" style={{ ['--tc' as string]: `var(${x.color})` }}><Ic n="user" s={12} /></span>}
          <b>{x.name}</b><small>{x.sub}</small></div>)}
      </div>, host)}
  </>;
});

// Renders stored text with @mentions highlighted.
export function Rich({ text, items, me }: { text: string; items: MentionItem[]; me: string }) {
  if (!items.length) return <>{text}</>;
  const names = items.map(x => x.name).sort((a, b) => b.length - a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp('@(' + names.join('|') + ')(?![\\w])', 'g');
  const out: React.ReactNode[] = []; let last = 0;
  for (const m of text.matchAll(re)) {
    const it = items.find(x => x.name === m[1])!;
    out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className={`mention ${it.kind}${it.kind === 'user' && it.id === me ? ' is-me' : ''}`} style={it.color ? { ['--tc' as string]: `var(${it.color})` } : undefined}>@{it.name}</span>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

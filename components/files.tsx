'use client';

import { useState } from 'react';
import { Ic, fmtSize } from './ui';

export const MAX_MB = 200;

// Picked-but-not-yet-uploaded files for a composer or form.
export function usePending() {
  const [files, setFiles] = useState<File[]>([]);
  return {
    files,
    add(list: FileList | null, onError: (m: string) => void) {
      const ok: File[] = [];
      for (const f of Array.from(list ?? [])) {
        if (!/^(image|video)\//.test(f.type)) { onError(`${f.name} is not an image or video`); continue; }
        if (f.size > MAX_MB * 1e6) { onError(`${f.name} is over ${MAX_MB} MB`); continue; }
        ok.push(f);
      }
      setFiles(x => [...x, ...ok]);
    },
    remove: (i: number) => setFiles(x => x.filter((_, j) => j !== i)),
    clear: () => setFiles([]),
  };
}
export type Pending = ReturnType<typeof usePending>;

export function PendChips({ p, inset }: { p: Pending; inset?: boolean }) {
  if (!p.files.length) return null;
  return <div className={`pend ${inset ? 'in' : ''}`}>{p.files.map((f, i) =>
    <span className="upchip" key={i}>{f.type.startsWith('video') ? <Ic n="play" s={12} /> : <Ic n="img" s={13} />}<span>{f.name}</span>
      <button type="button" onClick={() => p.remove(i)} aria-label={`Remove ${f.name}`}><Ic n="x" s={12} /></button></span>)}</div>;
}

export function AttachButton({ id, onPick, label }: { id: string; onPick: (l: FileList | null) => void; label?: string }) {
  return <>
    <input type="file" id={id} accept="image/*,video/*" multiple hidden onChange={e => { onPick(e.target.files); e.target.value = ''; }} />
    <label className={label ? 'btn sm' : 'tool'} htmlFor={id} title="Attach images or video"><Ic n="clip" s={label ? 14 : 16} />{label ?? <span className="sr">Attach</span>}</label>
  </>;
}

export interface FileInfo { id: string; name: string; mime: string; size: number; url: string }
export function Thumb({ f, onOpen, onRemove }: { f: FileInfo; onOpen: (f: FileInfo) => void; onRemove?: () => void }) {
  const video = f.mime.startsWith('video');
  return <div className={`att ${video ? 'video' : 'image'}`}>
    <button className="att-open" onClick={() => onOpen(f)} title={`Open ${f.name}`}>
      {video ? <video src={`${f.url}#t=0.1`} muted preload="metadata" /> : <img src={f.url} alt="" />}
      {video && <span className="play"><Ic n="play" /></span>}
    </button>
    <div className="att-meta"><span className="att-name">{f.name}</span><small>{video ? 'Video' : 'Image'} · {fmtSize(f.size)}</small></div>
    {onRemove && <button className="att-x" onClick={onRemove} aria-label={`Remove ${f.name}`} title="Remove"><Ic n="x" s={13} /></button>}
  </div>;
}

export function Lightbox({ f, onClose }: { f: FileInfo | null; onClose: () => void }) {
  if (!f) return null;
  const video = f.mime.startsWith('video');
  return <div className="lb-wrap" role="dialog" aria-modal="true" aria-label={f.name} onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <div className="lightbox">
      <div className="lb-head"><div><b>{f.name}</b><small>{video ? 'Video' : 'Image'} · {fmtSize(f.size)}</small></div>
        <span className="lb-act"><a className="btn sm" href={f.url} download={f.name} target="_blank" rel="noreferrer">Download</a><button className="icon-btn" autoFocus onClick={onClose} aria-label="Close"><Ic n="x" s={18} /></button></span></div>
      <div className="lb-body">{video ? <video src={f.url} controls autoPlay playsInline /> : <img src={f.url} alt={f.name} />}</div>
    </div>
  </div>;
}

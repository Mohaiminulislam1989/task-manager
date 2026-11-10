// Browser side: adds picked files to a form before it goes to a server action.
// With Vercel Blob set up, files go straight to Blob and the form only carries a reference;
// otherwise (local development) the file itself rides along in the form.
import { upload } from '@vercel/blob/client';

let direct: Promise<boolean> | null = null;
const canUploadDirect = () => direct ??= fetch('/api/upload').then(r => r.json()).then(j => !!j.direct).catch(() => false);

export async function addFiles(fd: FormData, key: string, files: File[]) {
  if (!files.length) return;
  if (!(await canUploadDirect())) { files.forEach(f => fd.append(key, f)); return; }
  for (const f of files) {
    const safe = f.name.replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file';
    const b = await upload(`attachments/${safe}`, f, { access: 'public', handleUploadUrl: '/api/upload', contentType: f.type, multipart: f.size > 20e6 });
    fd.append(`${key}:ref`, JSON.stringify({ url: b.url, name: f.name }));
  }
}

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/lib/auth';
import { UPLOAD_DIR } from '@/lib/files';

// Serves locally stored attachments (development, or when Vercel Blob is not configured). Signed-in users only.
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await currentUser())) return new Response('Not signed in', { status: 401 });
  const key = path.basename(decodeURIComponent((await params).key));
  try {
    const buf = await readFile(path.join(UPLOAD_DIR, key));
    const ext = path.extname(key).toLowerCase();
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }[ext] ?? 'application/octet-stream';
    const size = buf.length, range = req.headers.get('range');
    if (range && type.startsWith('video')) {
      const [s, e] = range.replace('bytes=', '').split('-').map(Number);
      const end = Number.isFinite(e) && e > 0 ? e : size - 1;
      return new Response(buf.subarray(s, end + 1), { status: 206, headers: { 'Content-Type': type, 'Content-Range': `bytes ${s}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - s + 1) } });
    }
    return new Response(buf, { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', ...(type === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}) } });
  } catch { return new Response('Not found', { status: 404 }); }
}

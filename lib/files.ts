import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_FILE_MB = 200;
export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Stores an image or video and returns a URL the browser can load.
// Uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set, otherwise local disk (development).
export async function storeFile(file: File): Promise<{ url: string; name: string; mime: string; size: number }> {
  if (!/^(image|video)\//.test(file.type)) throw new Error(`${file.name} is not an image or video`);
  if (file.size > MAX_FILE_MB * 1e6) throw new Error(`${file.name} is over ${MAX_FILE_MB} MB`);
  const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file';
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`attachments/${randomUUID()}/${safe}`, file, { access: 'public', contentType: file.type });
    return { url: blob.url, name: file.name, mime: file.type, size: file.size };
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const key = `${randomUUID()}-${safe}`;
  await writeFile(path.join(UPLOAD_DIR, key), Buffer.from(await file.arrayBuffer()));
  return { url: `/api/files/${encodeURIComponent(key)}`, name: file.name, mime: file.type, size: file.size };
}

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { currentUser } from '@/lib/auth';
import { MAX_FILE_MB } from '@/lib/files';

// Browsers upload attachments straight to Vercel Blob, so large videos never pass through
// a server function (Vercel caps those request bodies at about 4.5 MB).
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ direct: !!process.env.BLOB_READ_WRITE_TOKEN });
}

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: 'Direct uploads are not set up.' }, { status: 501 });
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body, request: req,
      onBeforeGenerateToken: async pathname => {
        if (!(await currentUser())) throw new Error('Please sign in again.');
        if (!pathname.startsWith('attachments/')) throw new Error('Bad upload path.');
        return { allowedContentTypes: ['image/*', 'video/*'], maximumSizeInBytes: MAX_FILE_MB * 1e6, addRandomSuffix: true };
      },
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Upload failed.' }, { status: 400 });
  }
}

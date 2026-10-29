import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';

const COOKIE = 'lb_session';
const key = () => {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret === 'change-me' || secret.length < 32) throw new Error('Set AUTH_SECRET to a random string of at least 32 characters.');
  return new TextEncoder().encode(secret);
};

export async function startSession(userId: string) {
  const token = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 30 * 24 * 3600 });
}

export async function endSession() { (await cookies()).delete(COOKIE); }

export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, String(payload.uid)));
    return u ?? null;
  } catch { return null; }
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}
export type Viewer = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

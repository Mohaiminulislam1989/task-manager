// First-time setup on a fresh database: creates the organisation and its Super admin.
// Usage: npx tsx scripts/create-admin.ts "Agency name" "Your Name" you@agency.com
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { db, schema as s } from '../db/index.ts';

const [orgName, name, email] = process.argv.slice(2);
if (!orgName || !name || !email) { console.error('Usage: npx tsx scripts/create-admin.ts "Agency name" "Your Name" you@agency.com'); process.exit(1); }
const password = randomBytes(9).toString('base64url');
const [org] = (await db.select().from(s.organizations)).length ? await db.select().from(s.organizations) : await db.insert(s.organizations).values({ name: orgName }).returning();
await db.insert(s.users).values({ organizationId: org.id, name, email: email.toLowerCase(), orgRole: 'super', passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true });
console.log(`Super admin created. Sign in as ${email.toLowerCase()} with the temporary password: ${password}`);
process.exit(0);

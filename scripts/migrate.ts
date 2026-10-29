import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
await migrate(drizzle(sql), { migrationsFolder: './db/migrations' });
await sql.end();
console.log('Migrations applied');

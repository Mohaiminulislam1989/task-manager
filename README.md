# Line Board

A production-line Kanban for agency work. Each project is a line of teams, each team owns its columns, and every column has a time estimate. Cards move left to right, team by team, from a shared **To do** backlog to **Done**.

- **Card dot** (top right): time in the current column. Green, yellow at 80% of the column's estimate, red when over.
- **Card colour**: the same rule against the task's overall deadline.
- **Roles**: Super admin, Head of projects, Project manager, Team lead, Team member. See *People & roles → What each role can do* in the app.
- **Moves**: members move cards inside their own team. Leads hand over to the next team, send back with a reason, start backlog tasks, and mark tasks done. Moving a task into To do or Done always needs a note. Only the project manager and admins reopen finished tasks.
- **Working hours**: every clock counts working time only, in the organisation's time zone, skipping days off and holidays. On the board, one day means one working day. The Super admin sets this on **Working hours** (account menu); everyone else can see it.
- **Editing**: team leads rename their team's columns and tasks. Project managers and admins rename anything.
- Comments, image and video attachments, @mentions of people or teams, in-app notifications, list view, PM dashboard, project builder.

## Stack

Next.js 16 (App Router, server actions), React 19, TypeScript, Postgres with Drizzle ORM, and Vercel Blob for attachments. Sign-in uses email and password with a signed session cookie.

The move and permission rules live in one place, `lib/rules.ts`. The server enforces them and the browser uses the same code to decide what to show. `npm test` covers them.

## Run it locally

You need Node 20 or newer and a Postgres database.

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and AUTH_SECRET
npm run db:migrate
npm run db:seed               # optional: demo agency data (wipes the database)
npm run dev
```

With the demo data, sign in as any of these with the password `demo1234`:

| Email | Role |
| --- | --- |
| sadia@agency.example | Super admin |
| imran@agency.example | Head of projects |
| mo@agency.example | Project manager |
| karim@agency.example | Team lead, Creative |
| rafi@agency.example | Team member, Creative |

To start with a real, empty organisation instead of demo data:

```bash
npm run create-admin -- "Your Agency" "Your Name" you@agency.com
```

It prints a temporary password. Sign in, choose your own password, set your time zone, working days and holidays on **Working hours**, then add people on **People & roles**. Each new person gets a temporary password to pass on, and is asked to change it the first time they sign in.

## Environment variables

| Name | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string (Neon, Vercel Postgres, Supabase or local). |
| `AUTH_SECRET` | Yes | Random string of 32+ characters for signing session cookies. Generate one with `openssl rand -base64 32`. |
| `BLOB_READ_WRITE_TOKEN` | On Vercel | Vercel Blob token for attachments. Without it, files are saved to `./uploads` on the server's disk, which only suits local use. |
| `DEMO_PASSWORD` | No | Password for the seeded demo accounts. Defaults to `demo1234`. |

## Deploy to Vercel

1. Import this repository in Vercel.
2. Add a Postgres database (for example Neon from the Vercel Marketplace) and a Blob store. Both set their environment variables on the project.
3. Add `AUTH_SECRET`.
4. Run the migrations against the production database once: `DATABASE_URL=... npm run db:migrate`.
5. Run `npm run create-admin` against the same database to create the first Super admin.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Rule tests (moves, notes, permissions, colours, mentions) |
| `npm run lint` | Type-check |
| `npm run db:generate` | Create a migration after changing `db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Load demo data (wipes the database) |
| `npm run create-admin` | Create the organisation and its first Super admin |

## Not in this version

Email notifications (in-app only for now), multiple organisations per deployment, and time-based alerts (the colours cover that).

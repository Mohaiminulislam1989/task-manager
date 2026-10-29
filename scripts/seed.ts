// Demo data for a marketing agency. Run: npm run db:seed  (wipes existing data!)
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, schema as s } from '../db/index.ts';

const H = 3600e3, now = Date.now(), t = (h: number) => new Date(now + h * H);
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo1234';

await db.execute(sql`truncate organizations, users, projects, teams, team_members, columns, column_owners, tasks, task_assignees, subtasks, stints, comments, attachments, task_events, notifications cascade`);
const [org] = await db.insert(s.organizations).values({ name: 'Our Agency' }).returning();
const hash = await bcrypt.hash(PASSWORD, 10);
const P: [string, string, number, 'super' | 'head' | 'pm' | null][] = [
  ['sadia', 'Sadia', 350, 'super'], ['imran', 'Imran', 60, 'head'], ['mo', 'Mohaiminul', 222, 'pm'],
  ['ayesha', 'Ayesha', 200, null], ['tanvir', 'Tanvir', 162, null], ['nadia', 'Nadia', 336, null], ['karim', 'Karim', 268, null],
  ['rafi', 'Rafi', 22, null], ['sumi', 'Sumi', 300, null], ['farhan', 'Farhan', 178, null], ['lina', 'Lina', 40, null], ['joy', 'Joy', 128, null],
];
const U: Record<string, string> = {};
for (const [key, name, hue, orgRole] of P) {
  const [u] = await db.insert(s.users).values({ organizationId: org.id, name, email: `${key}@agency.example`, passwordHash: hash, orgRole, hue, mustChangePassword: false }).returning();
  U[key] = u.id;
}

type Sub = [string, number, boolean];
type T = [string, string, string, number, number, number | null, string[], Sub[]];
async function project(name: string, teams: [string, string, string, string, string[]][], cols: [string, string, string, number, string[]][], tasks: T[]) {
  const [p] = await db.insert(s.projects).values({ organizationId: org.id, name, managerId: U.mo }).returning();
  const TM: Record<string, string> = {}, CM: Record<string, string> = {};
  for (const [i, [key, tname, color, lead, members]] of teams.entries()) {
    const [tm] = await db.insert(s.teams).values({ projectId: p.id, name: tname, color, lineOrder: i, leadId: U[lead] }).returning();
    TM[key] = tm.id;
    if (members.length) await db.insert(s.teamMembers).values(members.map(m => ({ teamId: tm.id, userId: U[m] })));
  }
  const pos: Record<string, number> = {};
  for (const [key, team, cname, est, owners] of cols) {
    const [c] = await db.insert(s.columns).values({ teamId: TM[team], name: cname, position: pos[team] = (pos[team] ?? -1) + 1, estimateMinutes: est * 60 }).returning();
    CM[key] = c.id;
    if (owners.length) await db.insert(s.columnOwners).values(owners.map(o => ({ columnId: c.id, userId: U[o] })));
  }
  const f = [0.7, 1.25, 0.9, 1.1, 0.6, 1.4];
  for (const [i, [title, desc, col, created, entered, deadline, who, subs]] of tasks.entries()) {
    const stage = col === 'todo' ? 'todo' : col === 'done' ? 'done' : 'line';
    const idx = stage === 'line' ? cols.findIndex(c => c[0] === col) : stage === 'done' ? cols.length : -1;
    // Rebuild plausible history: time spent in each earlier column, ending when the task entered its current one.
    const stints: { col: string; start: number; end: number }[] = [];
    let end = now + entered * H;
    for (let j = idx - 1; j >= 0; j--) { const ms = cols[j][3] * H * f[(i + j) % f.length]; stints.unshift({ col: CM[cols[j][0]], start: end - ms, end }); end -= ms; }
    const createdAt = new Date(Math.min(now + created * H, end));
    const [tk] = await db.insert(s.tasks).values({
      projectId: p.id, stage, columnId: stage === 'line' ? CM[col] : null, title, description: desc,
      deadlineAt: deadline == null ? null : t(deadline), createdAt, startedAt: stage === 'todo' ? null : createdAt, enteredColumnAt: t(entered),
      lastTeamId: stage === 'done' ? TM[cols.at(-1)![1]] : null, createdBy: U.mo,
    }).returning();
    if (who.length) await db.insert(s.taskAssignees).values(who.map(w => ({ taskId: tk.id, userId: U[w] })));
    if (subs.length) await db.insert(s.subtasks).values(subs.map(([st, due, done], k) => ({ taskId: tk.id, title: st, deadlineAt: t(due), done, position: k })));
    if (stints.length) await db.insert(s.stints).values(stints.map(x => ({ taskId: tk.id, columnId: x.col, startedAt: new Date(x.start), endedAt: new Date(x.end) })));
    await db.insert(s.taskEvents).values({ taskId: tk.id, userId: null, text: stage === 'todo' ? 'Added to the backlog' : 'Task created', createdAt });
  }
  return p.id;
}

await project('Glow & Co: winter skincare launch',
  [['acct', 'Client Strategy', '--t1', 'ayesha', ['tanvir', 'nadia']], ['creative', 'Creative', '--t2', 'karim', ['rafi', 'sumi']], ['perf', 'Media & Performance', '--t3', 'farhan', ['lina', 'joy']]],
  [['brief', 'acct', 'Client brief', 8, ['tanvir']], ['plan', 'acct', 'Strategy & media plan', 16, ['nadia']], ['copy', 'creative', 'Copywriting', 6, ['rafi']],
    ['design', 'creative', 'Design & video', 12, ['sumi']], ['review', 'creative', 'Internal review', 4, ['rafi', 'sumi']], ['setup', 'perf', 'Ad setup & tracking', 8, ['lina']], ['approve', 'perf', 'Client approval', 24, ['joy']]],
  [
    ['TikTok creator brief', 'Brief for 3 micro-creators: night-cream routine, 30 s vertical.', 'brief', -2, -2, 120, ['tanvir'], [['Shortlist creators', -1, true], ['Draft talking points', 6, false]]],
    ['Q4 media plan and budget split', 'Split the BDT 12 lakh budget across Meta, TikTok and Google. Target ROAS 3.0.', 'plan', -30, -14, 2, ['nadia'], [['Last year benchmarks', -4, true], ['Budget sheet for client', 4, false]]],
    ['Facebook carousel copy', 'Five cards, one per product. Bangla and English versions.', 'copy', -72, -1, 1.5, ['rafi'], [['English copy', -2, true], ['Bangla copy', 4, false]]],
    ['Launch reel 15 s and 30 s', 'Edit from the studio shoot. Logo end card, subtitles burned in.', 'design', -96, -14, -2, ['sumi'], [['Rough cut', -8, true], ['Colour grade', -1, false], ['Subtitles', 2, false]]],
    ['Instagram story set (8 frames)', 'Countdown stickers for launch week.', 'review', -48, -1, 96, ['rafi', 'sumi'], [['Check brand colours', 2, false]]],
    ['Google Search headlines, 15 variants', 'Responsive search ads. Keep under 30 characters, include the winter offer.', 'copy', -26, -2, 70, ['rafi'], [['First 8 headlines', 1, false], ['Descriptions', 3, false]]],
    ['Influencer caption pack', 'Captions and hashtags for the 3 creators, Bangla first.', 'copy', -30, -3, -1, ['rafi'], []],
    ['Meta pixel and UTM setup', 'Purchase and add-to-cart events on the Shopify store. UTMs for every ad set.', 'setup', -120, -5, -3, ['lina'], [['Test purchase event', 3, false]]],
    ['Google Search ads, round 1', 'Waiting on client sign-off for headlines and pricing claims.', 'approve', -144, -21, 4, ['joy'], [['Send preview link', -20, true], ['Follow-up call', 2, false]]],
    ['Ramadan campaign concept', 'Early ideas for a Ramadan gift-box push. No dates yet.', 'todo', -30, -30, null, [], []],
    ['Glow & Co case study video', 'Two-minute case study once the winter launch numbers are in.', 'todo', -8, -8, 504, ['sumi'], []],
    ['Retargeting ads, cart abandoners', 'Live since Saturday, CPC BDT 9.', 'done', -200, -40, -6, ['farhan'], [['Weekly report', -12, true]]],
  ]);
await project('Riverbank Bistro: website refresh',
  [['ux', 'UX & Content', '--t1', 'ayesha', ['tanvir']], ['web', 'Web Build', '--t3', 'farhan', ['lina']]],
  [['sitemap', 'ux', 'Sitemap', 8, ['ayesha']], ['wire', 'ux', 'Wireframes & copy', 24, ['tanvir']], ['build', 'web', 'Build', 40, ['lina']]],
  [
    ['Menu page copy', 'Seasonal menu with prices and allergens.', 'wire', -40, -20, 48, ['tanvir'], []],
    ['Online booking widget', 'Connect the table booking form to the restaurant email.', 'build', -80, -10, 2, ['lina'], [['Test booking emails', -2, false]]],
  ]);

console.log(`Seeded. Sign in as e.g. karim@agency.example (lead), mo@agency.example (PM) or sadia@agency.example (Super admin) with password "${PASSWORD}".`);
process.exit(0);

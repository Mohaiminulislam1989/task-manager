import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, roleIn, H, fmtDur, mentionsIn, type ProjectShape, type Task } from './rules.ts';

const p: ProjectShape = {
  id: 'p', name: 'Glow & Co', managerId: 'mo',
  teams: [
    { id: 'acct', name: 'Client Strategy', color: '--t1', lineOrder: 0, leadId: 'ayesha', memberIds: ['tanvir'] },
    { id: 'cre', name: 'Creative', color: '--t2', lineOrder: 1, leadId: 'karim', memberIds: ['rafi'] },
    { id: 'media', name: 'Media & Performance', color: '--t3', lineOrder: 2, leadId: 'farhan', memberIds: [] },
  ],
  columns: [
    { id: 'brief', teamId: 'acct', name: 'Brief', position: 0, estH: 8, ownerIds: [] },
    { id: 'plan', teamId: 'acct', name: 'Plan', position: 1, estH: 16, ownerIds: [] },
    { id: 'copy', teamId: 'cre', name: 'Copy', position: 0, estH: 6, ownerIds: [] },
    { id: 'design', teamId: 'cre', name: 'Design', position: 1, estH: 12, ownerIds: [] },
    { id: 'setup', teamId: 'media', name: 'Setup', position: 0, estH: 8, ownerIds: [] },
  ],
};
const task = (col: string, extra: Partial<Task> = {}): Task => ({ id: 't', title: 'T', desc: '', col, created: 0, entered: 0, started: 0, deadline: 100 * H, assignees: [], lastTeam: null, subtasks: [], ...extra });
const as = (who: string, org: 'super' | 'head' | 'pm' | null = null) => new Board(p, roleIn(p, who, org));

test('members move only inside their own team', () => {
  assert.equal(as('rafi').moveRule(task('copy'), 'design').ok, true);
  assert.equal(as('rafi').moveRule(task('brief'), 'plan').ok, false);
  assert.equal(as('rafi').moveRule(task('design'), 'setup').ok, false);
});

test('leads hand over from last column to next team first column only', () => {
  assert.deepEqual(as('karim').moveRule(task('design'), 'setup'), { ok: true, kind: 'handover' });
  assert.equal(as('karim').moveRule(task('copy'), 'setup').ok, false);
  assert.equal(as('farhan').moveRule(task('design'), 'setup').ok, false);
});

test('send back needs a comment and goes to previous team last column', () => {
  const r = as('karim').moveRule(task('copy'), 'plan');
  assert.equal(r.kind, 'back'); assert.equal(r.needsComment, true);
  assert.equal(as('karim').moveRule(task('copy'), 'brief').ok, false);
});

test('moves into To do and Done need a note; reopen is PM only', () => {
  const done = as('karim').moveRule(task('copy'), 'done');
  assert.equal(done.kind, 'done'); assert.equal(done.needsComment, true);
  assert.equal(as('karim').moveRule(task('copy'), 'todo').needsComment, true);
  assert.equal(as('rafi').moveRule(task('copy'), 'done').ok, false);
  assert.equal(as('karim').moveRule(task('done'), 'copy').ok, false);
  assert.equal(as('mo').moveRule(task('done', { deadline: null }), 'copy').needsDeadline, true);
  assert.equal(as('sadia', 'super').moveRule(task('done'), 'brief').ok, true);
});

test('starting a backlog task asks for a deadline and stays in own team', () => {
  assert.equal(as('karim').moveRule(task('todo', { deadline: null }), 'copy').needsDeadline, true);
  assert.equal(as('karim').moveRule(task('todo'), 'brief').ok, false);
  assert.equal(as('karim').moveRule(task('todo'), 'done').ok, true);
});

test('column dot turns yellow at 80% and red when over', () => {
  const b = as('karim');
  assert.equal(b.colStatus(task('copy'), 4 * H).lv, 'ok');
  assert.equal(b.colStatus(task('copy'), 5 * H).lv, 'warn');
  assert.equal(b.colStatus(task('copy'), 6 * H).lv, 'bad');
  assert.equal(b.dlStatus(task('copy', { deadline: null }), 0).lv, 'none');
  assert.equal(b.dlStatus(task('copy'), 101 * H).lv, 'bad');
});

test('mentions resolve longest names first', () => {
  const items = [{ kind: 'team' as const, id: 'm', name: 'Media & Performance' }, { kind: 'user' as const, id: 'r', name: 'Rafi' }];
  assert.deepEqual(mentionsIn('ping @Rafi and @Media & Performance', items).map(x => x.id), ['r', 'm']);
  assert.deepEqual(mentionsIn('email rafi@x.com', items), []);
});

test('task titles and column names: team lead or PM and above', () => {
  assert.equal(as('karim').canRenameTask(task('copy')), true);
  assert.equal(as('rafi').canRenameTask(task('copy')), false);
  assert.equal(as('ayesha').canRenameTask(task('copy')), false);
  assert.equal(as('ayesha').canRenameTask(task('todo')), true);
  assert.equal(as('mo').canRenameTask(task('setup')), true);
  assert.equal(as('karim').canEditCols('cre'), true);
  assert.equal(as('karim').canEditCols('acct'), false);
  assert.equal(as('imran', 'head').canEditCols('acct'), true);
});

test('team names: own lead or PM and above; project name: PM and above', () => {
  assert.equal(as('karim').canRenameTeam('cre'), true);
  assert.equal(as('karim').canRenameTeam('acct'), false);
  assert.equal(as('rafi').canRenameTeam('cre'), false);
  assert.equal(as('mo').canRenameTeam('acct'), true);
  assert.equal(as('mo').canRenameProject(), true);
  assert.equal(as('imran', 'head').canRenameProject(), true);
  assert.equal(as('karim').canRenameProject(), false);
});

test('durations never show 60 minutes', () => {
  assert.equal(fmtDur(3 * H + 59.7 * 60000), '4h 00m');
  assert.equal(fmtDur(-(2 * H + 30 * 60000)), '2h 30m');
  assert.equal(fmtDur(26 * H), '1d 2h');
});

test('working hours: only working time counts', async () => {
  const { workMs } = await import('./hours.ts');
  const wk = { tz: 'UTC', days: [1, 2, 3, 4, 5], start: 9 * 60, end: 18 * 60, holidays: [] as string[] };
  const at = (s: string) => Date.parse(s + 'Z');
  // Fri 17:00 to Mon 10:00 is one hour on Friday and one on Monday.
  assert.equal(workMs(wk, at('2026-10-30T17:00:00'), at('2026-11-02T10:00:00')), 2 * H);
  assert.equal(workMs(wk, at('2026-11-02T10:00:00'), at('2026-10-30T17:00:00')), -2 * H);
  // Nights don't count; a holiday Monday doesn't either.
  assert.equal(workMs(wk, at('2026-11-02T20:00:00'), at('2026-11-03T08:00:00')), 0);
  assert.equal(workMs({ ...wk, holidays: ['2026-11-02'] }, at('2026-10-30T17:00:00'), at('2026-11-03T10:00:00')), 2 * H);
  // A full week is five 9-hour days. No schedule means calendar time.
  assert.equal(workMs(wk, at('2026-11-02T00:00:00'), at('2026-11-09T00:00:00')), 45 * H);
  assert.equal(workMs(null, 0, 5 * H), 5 * H);
  // Time zones: Dhaka is UTC+6, so 09:00 there is 03:00 UTC. New York crosses daylight saving on 1 Nov 2026.
  const dhaka = { ...wk, tz: 'Asia/Dhaka', days: [0, 1, 2, 3, 4] };
  assert.equal(workMs(dhaka, at('2026-11-01T02:00:00'), at('2026-11-01T05:00:00')), 2 * H);
  const ny = { ...wk, tz: 'America/New_York', days: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(workMs(ny, at('2026-10-31T13:00:00'), at('2026-11-01T15:00:00')), 9 * H + 1 * H);
});

test('working hours drive the dot, the deadline colour and day lengths', () => {
  const at = (s: string) => Date.parse(s + 'Z');
  const wp = { ...p, hours: { tz: 'UTC', days: [1, 2, 3, 4, 5], start: 9 * 60, end: 18 * 60, holidays: [] } };
  const b = new Board(wp, roleIn(wp, 'pm', null));
  // Copy is a 6 h column. Entered Fri 16:00; by Mon 12:00 that is 2 h + 3 h = 5 h, so yellow, not red.
  const k = task('copy', { entered: at('2026-10-30T16:00:00'), started: at('2026-10-30T16:00:00'), deadline: at('2026-11-03T16:00:00') });
  assert.equal(b.colStatus(k, at('2026-11-02T12:00:00')).lv, 'warn');
  assert.equal(b.colStatus(k, at('2026-11-02T12:00:00')).left, 1 * H);
  // Deadline span is 2 + 9 + 7 = 18 working hours; 5 used.
  assert.equal(b.dlStatus(k, at('2026-11-02T12:00:00')).lv, 'ok');
  assert.equal(b.dlStatus(k, at('2026-11-02T12:00:00')).left, 13 * H);
  assert.equal(b.fmt(13 * H), '1d 4h');
  assert.equal(fmtDur(13 * H), '13h 00m');
});

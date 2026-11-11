import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWork, workMs, type WorkHours } from './hours.ts';

const h: WorkHours = { tz: 'Asia/Dhaka', days: [0, 1, 2, 3, 4], start: 9 * 60, end: 18 * 60, holidays: [] };
const at = (iso: string) => Date.parse(iso);

test('addWork skips nights and days off, and undoes workMs', () => {
  // Thu 2026-11-12 16:00 Dhaka + 4 working hours → Sun 2026-11-15 11:00 Dhaka (Fri and Sat off)
  assert.equal(addWork(h, at('2026-11-12T16:00:00+06:00'), 4 * 3600e3), at('2026-11-15T11:00:00+06:00'));
  const from = at('2026-11-10T10:30:00+06:00'), to = addWork(h, from, 23 * 3600e3);
  assert.equal(workMs(h, from, to), 23 * 3600e3);
  assert.equal(addWork(null, 0, 5), 5);
});

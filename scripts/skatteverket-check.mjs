import assert from 'node:assert/strict';

const day = 24 * 60 * 60 * 1000;
const state = (item, now, attentionDays = 14, staleDays = 2) => {
  if (['done', 'dismissed'].includes(item.task_status)) return 'done';
  const due = item.due_at ? new Date(item.due_at).getTime() : null;
  if (due !== null && due <= now.getTime()) return 'overdue';
  if (due !== null && due - now.getTime() <= attentionDays * day) return now.getDay() === 5 && due - now.getTime() <= 7 * day ? 'friday' : 'due_soon';
  if (item.last_seen_at && now.getTime() - new Date(item.last_seen_at).getTime() > staleDays * day) return 'stale';
  return 'normal';
};
const now = new Date('2026-08-14T09:00:00Z');
assert.equal(state({ task_status: 'open', due_at: '2026-08-13T09:00:00Z' }, now), 'overdue');
assert.equal(state({ task_status: 'open', due_at: '2026-08-20T09:00:00Z' }, now), 'friday');
assert.equal(state({ task_status: 'open', due_at: '2026-12-20T09:00:00Z', last_seen_at: '2026-08-10T09:00:00Z' }, now), 'stale');
assert.equal(state({ task_status: 'done', due_at: null }, now), 'done');
console.log('Skatteverket deadline checks passed');

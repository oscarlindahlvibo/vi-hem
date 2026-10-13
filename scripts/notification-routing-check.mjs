import fs from 'node:fs';import assert from 'node:assert/strict';
const source=fs.readFileSync('src/lib/utils.ts','utf8');const labels=source.split('export const NOTIFICATION_SETTING_LABELS:')[1].split('];')[0];
const ui=[...labels.matchAll(/key:\s*'([^']+)'/g)].map(m=>m[1]);
const sql=fs.readFileSync('supabase/migrations/20261021120000_admin_notification_routing.sql','utf8');
const db=[...sql.split('select array[')[1].split(']::text[]')[0].matchAll(/'([^']+)'/g)].map(m=>m[1]);
assert.deepEqual([...ui].sort(),[...db].sort());assert.equal(new Set(ui).size,ui.length);
assert.ok(ui.includes('calendar_reminder'));assert.ok(ui.includes('other_notifications'));
console.log(`PASS ${ui.length} notification categories match frontend and backend; future notifications covered`);

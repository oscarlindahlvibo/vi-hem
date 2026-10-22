// Kontroll av driftmeddelandenas hjälpfunktioner (src/modules/vibogruppen/notice-format.ts). Kör utan nätverk.
import assert from 'node:assert/strict';
import { isoToLocalInput, localInputToIso, noticeStatus, validateNoticeForm } from '../src/modules/vibogruppen/notice-format.ts';

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

check('lokal tid görs till absolut tid och tillbaka', () => {
  const iso = localInputToIso('2026-10-25T22:30');
  assert.ok(iso.endsWith('Z'));
  assert.equal(isoToLocalInput(iso), '2026-10-25T22:30');
  assert.equal(localInputToIso(''), null);
  assert.equal(isoToLocalInput(null), '');
});
check('status: planerad, pågår, avslutad och avstängd', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  assert.equal(noticeStatus({ active: true, show_from: '2026-10-23T00:00:00Z', show_until: '2026-10-24T00:00:00Z' }, now), 'planned');
  assert.equal(noticeStatus({ active: true, show_from: '2026-10-22T00:00:00Z', show_until: '2026-10-24T00:00:00Z' }, now), 'live');
  assert.equal(noticeStatus({ active: true, show_from: '2026-10-20T00:00:00Z', show_until: '2026-10-22T12:00:00Z' }, now), 'ended');
  assert.equal(noticeStatus({ active: false, show_from: '2026-10-22T00:00:00Z', show_until: '2026-10-24T00:00:00Z' }, now), 'off');
});
check('formuläret valideras', () => {
  const ok = { title: 'Underhåll', show_from: '2026-10-22T08:00', show_until: '2026-10-23T08:00', event_starts_at: '', event_ends_at: '', all_customers: true, customer_ids: [], surfaces: [] };
  assert.equal(validateNoticeForm(ok), null);
  assert.match(validateNoticeForm({ ...ok, title: ' ' }), /rubrik/);
  assert.match(validateNoticeForm({ ...ok, show_until: '2026-10-22T07:00' }), /Sluttiden/);
  assert.match(validateNoticeForm({ ...ok, show_from: '' }), /börja och sluta/);
  assert.match(validateNoticeForm({ ...ok, event_starts_at: '2026-10-23T02:00', event_ends_at: '2026-10-23T01:00' }), /Underhållets/);
  assert.match(validateNoticeForm({ ...ok, all_customers: false }), /minst en mottagare/);
  assert.equal(validateNoticeForm({ ...ok, all_customers: false, surfaces: ['viborent'] }), null);
});
console.log(`${passed} kontroller klara`);

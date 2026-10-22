// Kontroll av bannerlogiken för Vibogruppens egna appar (apps/_shared/notice-banner.ts). Kör utan nätverk och utan DOM.
import assert from 'node:assert/strict';
import { formatNoticeWindow, isBannerNotice, noticeDismissKey, startNoticeBanner, visibleBannerNotices } from '../apps/_shared/notice-banner.ts';

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };
const base = { id: 'a', title: 'Underhåll', body: '', severity: 'warning', kind: 'maintenance', show_from: '2026-10-22T08:00:00Z', show_until: '2026-10-24T08:00:00Z', event_starts_at: null, event_ends_at: null, updated_at: '2026-10-21T10:00:00Z' };
const now = new Date('2026-10-23T08:00:00Z');

check('visas bara inom visningsfönstret', () => {
  assert.equal(visibleBannerNotices([base], [], now).length, 1);
  assert.equal(visibleBannerNotices([base], [], new Date('2026-10-22T07:59:00Z')).length, 0);
  assert.equal(visibleBannerNotices([base], [], new Date('2026-10-24T08:00:00Z')).length, 0);
});
check('kritiska först och de går inte att dölja', () => {
  const critical = { ...base, id: 'c', severity: 'critical' };
  const info = { ...base, id: 'i', severity: 'info' };
  assert.deepEqual(visibleBannerNotices([info, base, critical], [], now).map((n) => n.id), ['c', 'a', 'i']);
  assert.equal(visibleBannerNotices([critical], [noticeDismissKey(critical)], now).length, 1);
});
check('dolt meddelande visas igen när det ändrats', () => {
  assert.equal(visibleBannerNotices([base], [noticeDismissKey(base)], now).length, 0);
  assert.equal(visibleBannerNotices([{ ...base, updated_at: '2026-10-22T09:00:00Z' }], [noticeDismissKey(base)], now).length, 1);
});
check('ogiltiga svar filtreras bort', () => {
  assert.equal(isBannerNotice(base), true);
  assert.equal(isBannerNotice({ ...base, severity: 'panik' }), false);
  assert.equal(isBannerNotice(null), false);
});
check('underhållsfönstret formateras', () => {
  assert.equal(formatNoticeWindow(null, null), '');
  assert.match(formatNoticeWindow('2026-10-23T20:00:00Z', '2026-10-23T21:30:00Z'), /kl\. \d\d:\d\d–\d\d:\d\d/);
});
check('utan konfiguration görs ingenting', () => {
  assert.equal(typeof startNoticeBanner({ surface: 'viborent' }), 'function');
});
console.log(`${passed} kontroller klara`);

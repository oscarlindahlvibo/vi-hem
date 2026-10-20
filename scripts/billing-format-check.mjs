// Kontroll av fakturamodulens formateringslogik (src/modules/vibogruppen/billing-format.ts). Kör utan nätverk.
import assert from 'node:assert/strict';
import { formatSek, monthKey, monthStartDate, previousMonth, statementCsv } from '../src/modules/vibogruppen/billing-format.ts';

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

check('belopp formateras med två decimaler och svensk tusentalsavgränsning', () => {
  assert.match(formatSek(1518.75), /^1\s518,75 kr$/);
  assert.equal(formatSek(5), '5,00 kr');
});
check('månadshantering över årsskifte', () => {
  assert.equal(previousMonth('2027-01'), '2026-12');
  assert.equal(previousMonth('2026-10'), '2026-09');
  assert.equal(monthStartDate('2026-09'), '2026-09-01');
  assert.equal(monthKey(new Date(2026, 8, 15)), '2026-09');
});
check('CSV har semikolon, decimalkomma och skydd mot formelinjektion', () => {
  const csv = statementCsv('JK; AB', {
    period: '2026-09-01', vat_rate: 25, ai_interpretations: 1, ai_pages: 2, total_ex_vat: 1010, vat_amount: 252.5, total_inc_vat: 1262.5,
    lines: [{ kind: 'hosting', description: 'Hosting', quantity: 1, unit: 'månad', unit_price: 1000, amount: 1000 }, { kind: 'ai', description: 'AI-tolkning (1 st)', quantity: 2, unit: 'sida', unit_price: 5, amount: 10 }],
    statement: null,
    interpretations: [{ id: 'a', created_at: '2026-09-02T08:00:00Z', source: 'jk', user_ref: '=HYPERLINK("x")', file_name: 'LTC.pdf', pages: 2, unit_price: 5, amount: 10 }],
  });
  assert.match(csv, /"JK; AB"/);
  assert.match(csv, /Att fakturera;;;;1262,50/);
  assert.match(csv, /AI-tolkning \(1 st\);2,00;sida;5,00;10,00/);
  assert.match(csv, /'=HYPERLINK/);
});
console.log(`${passed} kontroller klara`);

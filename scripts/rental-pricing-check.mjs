import assert from 'node:assert/strict';

function calculate({ start, end, quantity = 1, rules, vatRate = 25, deposit = 0 }) {
  const hours = (new Date(end) - new Date(start)) / 3600000;
  if (!(hours > 0) || quantity < 1) throw new Error('invalid period');
  const weekend = [5, 6].includes(new Date(start).getUTCDay());
  const candidates = rules.filter((rule) =>
    ['fixed_period', 'custom'].includes(rule.ruleType)
      || (rule.ruleType === 'weekend' && weekend && hours <= 72)
      || (rule.ruleType === 'hourly' && hours <= 24)
      || (rule.ruleType === 'daily' && hours <= 168)
      || (rule.ruleType === 'weekly' && hours >= 168),
  ).sort((a, b) => {
    if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0);
    const order = { fixed_period: 0, custom: 1, weekend: 2, hourly: 3, daily: 4, weekly: 5 };
    return (order[a.ruleType] ?? 6) - (order[b.ruleType] ?? 6);
  });
  const rule = candidates[0];
  assert.ok(rule, 'an active pricing rule must apply');
  const units = rule.ruleType === 'hourly' ? hours : rule.ruleType === 'daily' ? hours / 24 : rule.ruleType === 'weekly' ? hours / 168 : 1;
  const base = Math.ceil(units / (rule.duration || 1)) * rule.price;
  const subtotal = Math.round(base * quantity * 100) / 100;
  const vat = Math.round(subtotal * vatRate) / 100;
  return { subtotal, vat, total: subtotal + vat, deposit: deposit * quantity };
}

const daily = [{ ruleType: 'daily', price: 500, priority: 1 }];
assert.deepEqual(calculate({ start: '2026-08-10T09:00:00Z', end: '2026-08-11T09:00:00Z', rules: daily }), { subtotal: 500, vat: 125, total: 625, deposit: 0 });
assert.equal(calculate({ start: '2026-08-10T09:00:00Z', end: '2026-08-12T09:00:00Z', quantity: 2, rules: daily, vatRate: 12, deposit: 100 }).total, 2240);
assert.equal(calculate({ start: '2026-08-10T09:00:00Z', end: '2026-08-12T09:00:00Z', rules: [...daily, { ruleType: 'fixed_period', price: 1200, priority: 10 }] }).subtotal, 1200);
assert.equal(calculate({ start: '2026-08-10T09:00:00Z', end: '2026-08-10T12:00:00Z', rules: [
  { ruleType: 'hourly', price: 100, priority: 0 },
  { ruleType: 'daily', price: 500, priority: 0 },
  { ruleType: 'weekly', price: 2000, priority: 0 },
] }).subtotal, 300);
assert.equal(calculate({ start: '2026-08-10T09:00:00Z', end: '2026-08-10T12:00:00Z', rules: [
  { ruleType: 'daily', price: 500, priority: 0 },
  { ruleType: 'weekly', price: 2000, priority: 0 },
] }).subtotal, 500);
console.log('Rental pricing checks passed.');

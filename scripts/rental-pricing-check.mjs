import assert from 'node:assert/strict';

function calculate({ start, end, quantity = 1, rules, vatRate = 25, deposit = 0 }) {
  const hours = (new Date(end) - new Date(start)) / 3600000;
  if (!(hours > 0) || quantity < 1) throw new Error('invalid period');
  let base = 0;
  for (const rule of [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
    if (rule.ruleType === 'hourly') base = Math.max(base, Math.ceil(hours / (rule.duration || 1)) * rule.price);
    if (rule.ruleType === 'daily') base = Math.max(base, Math.ceil(hours / 24 / (rule.duration || 1)) * rule.price);
    if (rule.ruleType === 'weekly') base = Math.max(base, Math.ceil(hours / 168 / (rule.duration || 1)) * rule.price);
    if (rule.ruleType === 'weekend' && [5, 6].includes(new Date(start).getDay())) base = Math.max(base, rule.price);
    if (['fixed_period', 'custom'].includes(rule.ruleType)) base = Math.max(base, rule.price);
  }
  assert.ok(base > 0, 'an active pricing rule must apply');
  const subtotal = Math.round(base * quantity * 100) / 100;
  const vat = Math.round(subtotal * vatRate) / 100;
  return { subtotal, vat, total: subtotal + vat, deposit: deposit * quantity };
}

const daily = [{ ruleType: 'daily', price: 500, priority: 1 }];
assert.deepEqual(calculate({ start: '2026-08-10T09:00:00Z', end: '2026-08-11T09:00:00Z', rules: daily }), { subtotal: 500, vat: 125, total: 625, deposit: 0 });
assert.equal(calculate({ start: '2026-08-10T09:00:00Z', end: '2026-08-12T09:00:00Z', quantity: 2, rules: daily, vatRate: 12, deposit: 100 }).total, 2240);
assert.equal(calculate({ start: '2026-08-10T09:00:00Z', end: '2026-08-12T09:00:00Z', rules: [...daily, { ruleType: 'fixed_period', price: 1200, priority: 10 }] }).subtotal, 1200);
console.log('Rental pricing checks passed.');

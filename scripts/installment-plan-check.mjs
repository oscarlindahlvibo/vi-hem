import assert from 'node:assert/strict';

const cents = value => Math.round(value * 100);
const addMonthsWithDay = (dateString, months, day) => {
  const base = new Date(`${dateString}T00:00:00Z`);
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(Math.max(1, day), lastDay));
  return target.toISOString().slice(0, 10);
};
const calculateSchedule = ({ totalAmount, installmentCount, firstDueDate, intervalMonths, dayOfMonth }) => {
  const total = cents(totalAmount);
  const base = Math.floor(total / installmentCount);
  return Array.from({ length: installmentCount }, (_, index) => ({
    amount: (index === installmentCount - 1 ? total - base * (installmentCount - 1) : base) / 100,
    dueDate: addMonthsWithDay(firstDueDate, index * intervalMonths, dayOfMonth),
  }));
};
const allocate = (rows, amount) => {
  let remaining = cents(amount);
  return [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).flatMap(row => {
    if (remaining <= 0 || row.balanceRemaining <= 0) return [];
    const applied = Math.min(remaining, cents(row.balanceRemaining));
    remaining -= applied;
    return [{ id: row.id, amount: applied / 100 }];
  });
};

const schedule = calculateSchedule({ totalAmount: 1000, installmentCount: 3, firstDueDate: '2026-01-31', intervalMonths: 1, dayOfMonth: 31 });
assert.deepEqual(schedule.map(row => row.amount), [333.33, 333.33, 333.34]);
assert.deepEqual(schedule.map(row => row.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
assert.deepEqual(allocate([
  { id: 'newer', dueDate: '2026-02-01', balanceRemaining: 300 },
  { id: 'oldest', dueDate: '2026-01-01', balanceRemaining: 100 },
], 250), [{ id: 'oldest', amount: 100 }, { id: 'newer', amount: 150 }]);
console.log('Installment plan invariants passed');

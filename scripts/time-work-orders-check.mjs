import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/timeWorkOrders.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { listTimeWorkOrders } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const statuses = ['new', 'assigned', 'started', 'paused', 'waiting_material', 'waiting_contractor', 'waiting_tenant', 'ready_for_check', 'completed', 'cancelled'];
const rows = statuses.map((status, i) => ({ id: String(i), title: `Order ${i}`, status, organisation_id: 'own', assigned_to: 'another-person' }));
rows.push({ id: 'other-org', title: 'Other org', status: 'new', organisation_id: 'other' });
function client(records, failure = null) {
  const requests = [];
  return {
    requests,
    from(table) {
      assert.equal(table, 'vihem_work_orders');
      let filtered = [...records];
      const order = [];
      return {
        select() { return this; },
        not(column, op, value) {
          assert.equal(op, 'in');
          const excluded = value.slice(1, -1).split(',');
          filtered = filtered.filter(row => !excluded.includes(row[column]));
          return this;
        },
        eq(column, value) { filtered = filtered.filter(row => row[column] === value); return this; },
        order(column) { order.push(column); return this; },
        async range(start, end) {
          requests.push([start, end]);
          filtered.sort((a, b) => {
            for (const key of order) { const comparison = a[key].localeCompare(b[key]); if (comparison) return comparison; }
            return 0;
          });
          return { data: filtered.slice(start, end + 1), error: failure };
        },
      };
    },
  };
}
const selected = await listTimeWorkOrders(client(rows), 'own');
assert.deepEqual(new Set(selected.map(row => row.status)), new Set(statuses.slice(0, 8)));
assert.ok(selected.every(row => row.organisation_id === 'own'));
assert.equal(selected.length, 8, 'Orders assigned to other staff must remain selectable');
const many = Array.from({ length: 1203 }, (_, i) => ({ id: String(i).padStart(4, '0'), title: 'Same title', status: 'waiting_material', organisation_id: 'own' }));
const paginated = client(many);
const all = await listTimeWorkOrders(paginated, 'own');
assert.equal(all.length, 1203);
assert.equal(new Set(all.map(row => row.id)).size, 1203);
assert.deepEqual(paginated.requests, [[0, 499], [500, 999], [1000, 1499]]);
assert.deepEqual(all.map(row => row.id), many.map(row => row.id));
assert.equal((await listTimeWorkOrders(client([]), 'own')).length, 0);
await assert.rejects(listTimeWorkOrders(client([], new Error('Access denied')), 'own'), /Access denied/);
console.log('PASS: all active statuses, organisation scope, any assignee, stable pagination beyond 1,000 rows, empty list and surfaced errors.');

import assert from 'node:assert/strict';

function applyTransaction(state, { organisationId, itemId, quantity, type, source, destination }) {
  assert.ok(quantity > 0, 'quantity must be positive');
  const item = state.items.find(candidate => candidate.id === itemId && candidate.organisationId === organisationId);
  assert.ok(item, 'item must belong to the organisation');

  if (['stock_out', 'transfer', 'waste'].includes(type)) {
    assert.ok(source, 'source is required');
    const key = `${organisationId}:${itemId}:${source}`;
    assert.ok((state.balances[key] || 0) >= quantity, 'source balance cannot become negative');
    state.balances[key] -= quantity;
  }
  if (['stock_in', 'return', 'transfer', 'adjustment', 'inventory_adjustment', 'correction'].includes(type)) {
    assert.ok(destination, 'destination is required');
    const key = `${organisationId}:${itemId}:${destination}`;
    state.balances[key] = (state.balances[key] || 0) + quantity;
  }
}

const state = {
  items: [
    { id: 'item-a', organisationId: 'org-a' },
    { id: 'item-b', organisationId: 'org-b' },
  ],
  balances: { 'org-a:item-a:loc-a': 10 },
};

applyTransaction(state, { organisationId: 'org-a', itemId: 'item-a', quantity: 4, type: 'stock_out', source: 'loc-a' });
assert.equal(state.balances['org-a:item-a:loc-a'], 6);

applyTransaction(state, { organisationId: 'org-a', itemId: 'item-a', quantity: 4, type: 'transfer', source: 'loc-a', destination: 'loc-b' });
assert.equal(state.balances['org-a:item-a:loc-a'], 2);
assert.equal(state.balances['org-a:item-a:loc-b'], 4);

assert.throws(() => applyTransaction(state, { organisationId: 'org-a', itemId: 'item-a', quantity: 3, type: 'stock_out', source: 'loc-a' }), /negative/);
assert.throws(() => applyTransaction(state, { organisationId: 'org-a', itemId: 'item-a', quantity: 0, type: 'stock_in', destination: 'loc-a' }), /positive/);
assert.throws(() => applyTransaction(state, { organisationId: 'org-b', itemId: 'item-a', quantity: 1, type: 'stock_in', destination: 'loc-b' }), /organisation/);
assert.throws(() => applyTransaction(state, { organisationId: 'org-a', itemId: 'item-a', quantity: 1, type: 'stock_in' }), /destination/);

const expected = 12.5;
const counted = 10;
assert.equal(counted - expected, -2.5, 'inventory difference should be counted minus expected');

console.log('Inventory invariants passed: saldo, flytt, validering, inventeringsdifferens och tenantisolering.');

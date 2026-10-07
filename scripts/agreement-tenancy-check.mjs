import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../supabase/functions/_shared/agreement-tenancy.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { createTenancyFromAgreement } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const dateBlock = value => ({ block_type: 'date', content: { label: 'Tillträdesdatum', value } });
async function run(blocks, options = {}) {
  const writes = [], reads = [];
  const data = {
    vihem_agreements: { id: 'agreement', organisation_id: 'org', status: 'signed', document_type: 'agreement', current_version_id: 'frozen', ...options.agreement },
    vihem_agreement_entity_links: [{ entity_type: 'tenant', entity_id: 'tenant' }, { entity_type: 'apartment', entity_id: 'apartment' }],
    vihem_apartments: { id: 'apartment', property_id: 'property', organisation_id: 'org', rent: 8550 },
    vihem_profiles: { id: 'tenant', organisation_id: 'org' },
    vihem_tenancies: options.active || [],
    vihem_agreement_versions: options.missingVersion ? null : { blocks },
  };
  const db = { from(table) {
    const query = { select() { return this; }, eq(key, value) { reads.push({ table, key, value }); return this; },
      maybeSingle() { return Promise.resolve({ data: data[table] }); },
      insert(value) { writes.push({ table, value }); this.inserted = true; return this; },
      update(value) { writes.push({ table, value }); return this; },
      single() { return Promise.resolve({ data: { id: 'created' } }); },
      then(resolve, reject) { return Promise.resolve({ data: data[table] }).then(resolve, reject); },
    }; return query;
  } };
  const result = await createTenancyFromAgreement(db, 'agreement', null);
  return { result, writes, reads };
}
const actual = '2026-12-01 (Möblerad lägenhet Ekängsvägen 1F 1001 fr 2026-10-14)';
for (const value of [actual, '2026-12-01', ' 2026-12-01  ', '2026-12-01(kommentar)']) {
  const { result, writes, reads } = await run([dateBlock(value)]);
  assert.equal(result.status, 'created'); assert.equal(result.start_date, '2026-12-01');
  assert.equal(writes.find(w => w.table === 'vihem_tenancies').value.start_date, '2026-12-01');
  assert.ok(reads.some(r => r.table === 'vihem_agreement_versions' && r.key === 'id' && r.value === 'frozen'));
  assert.ok(writes.every(w => !['vihem_agreements', 'vihem_agreement_versions', 'vihem_agreement_signatures'].includes(w.table)));
}
for (const blocks of [[], [dateBlock('')], [dateBlock('2026-02-30')], [dateBlock('2026-13-01')], [dateBlock('2026-12-012')], [dateBlock('fr 2026-12-01')], [dateBlock('2026-12-01'), dateBlock('2026-10-14')]]) {
  const { result, writes } = await run(blocks); assert.equal(result.status, 'skipped'); assert.equal(writes.length, 0);
}
assert.equal((await run([dateBlock('2028-02-29')])).result.start_date, '2028-02-29');
for (const options of [{ agreement: { current_version_id: null } }, { missingVersion: true }, { agreement: { status: 'partially_signed' } }]) {
  const { result, writes } = await run([dateBlock(actual)], options); assert.equal(result.status, 'skipped'); assert.equal(writes.length, 0);
}
const existing = await run([dateBlock(actual)], { active: [{ id: 'existing', tenant_id: 'tenant' }] });
assert.equal(existing.result.status, 'exists'); assert.equal(existing.writes.length, 0);
console.log('Agreement tenancy checks passed: signed version, annotated dates, invalid/conflicting dates, no contract changes, idempotency.');

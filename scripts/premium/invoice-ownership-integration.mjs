// Runs only against an explicitly configured, isolated localhost QA database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const c = JSON.parse(fs.readFileSync(process.env.CHAT_QA_CONFIG, 'utf8'));
const url = c.url || 'http://127.0.0.1:18880';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const clients = {};
for (const who of ['oscar', 'tenant', 'outsider']) {
  const client = createClient(url, c.anon, { auth: { persistSession: false } });
  assert.equal((await client.auth.signInWithPassword({ email: c.users[who].email, password: c.user_password })).error, null);
  clients[who] = client;
}
assert.equal((await clients.oscar.from('vihem_organisations').select('name').eq('id', c.org).single()).data?.name, 'VI-HEM Chat QA');
const service = createClient(url, c.service, { auth: { persistSession: false } });
const [company, link, run, item, invoice] = Array.from({ length: 5 }, () => randomUUID());
const period = '2098-11-01';
const tenant = (await service.from('vihem_profiles').select('id,active').eq('id', c.users.tenant.id).single()).data;
assert.equal(tenant?.active, true);
const tenancy = await service.from('vihem_tenancies').select('id').eq('tenant_id', tenant.id).eq('organisation_id', c.org).eq('status', 'active').single();
assert.equal(tenancy.error, null);
const insert = async (table, row) => assert.equal((await service.from(table).insert(row)).error, null);
try {
  await insert('vihem_companies', { id: company, organisation_id: c.org, name: 'Disposable invoice ownership QA' });
  await insert('vihem_accounted_company_links', { id: link, organisation_id: c.org, company_id: company, accounted_base_url: 'https://qa.example.invalid', accounted_company_id: 'no-external-account', enabled: false });
  await insert('vihem_rent_billing_runs', { id: run, organisation_id: c.org, company_id: company, rent_period: period, due_date: '2098-11-30' });
  await insert('vihem_rent_billing_items', { id: item, organisation_id: c.org, company_id: company, run_id: run, tenancy_id: tenancy.data.id, tenant_id: tenant.id, rent_period: period, due_date: '2098-11-30', amount: 6200, total_amount: 6200 });
  await insert('vihem_accounted_invoice_links', { id: invoice, organisation_id: c.org, company_link_id: link, source_type: 'rental_billing', source_id: item, accounted_invoice_id: 'qa-only', total: 6200, remaining_amount: 1200, status: 'partially_paid' });
  const result = await clients.tenant.from('vihem_accounted_invoice_links').select('*').eq('id', invoice).single();
  assert.equal(result.error, null);
  assert.equal(result.data.total, 6200);
  assert.equal(result.data.remaining_amount, 1200);
  assert.deepEqual((await clients.tenant.from('vihem_rent_billing_items').select('id').eq('id', item)).data, [], 'internal billing items stay private');
  assert.deepEqual((await clients.outsider.from('vihem_accounted_invoice_links').select('id').eq('id', invoice)).data, []);
  assert.equal((await clients.tenant.rpc('vihem_owns_rent_invoice', { invoice_link_id: invoice })).data, true);
  assert.equal((await clients.outsider.rpc('vihem_owns_rent_invoice', { invoice_link_id: invoice })).data, false);
  const anon = createClient(url, c.anon, { auth: { persistSession: false } });
  assert.ok((await anon.rpc('vihem_owns_rent_invoice', { invoice_link_id: invoice })).error);
  assert.equal((await clients.oscar.from('vihem_accounted_invoice_links').select('id').eq('id', invoice)).data?.length, 1, 'admin company access preserved');
  assert.equal((await service.from('vihem_profiles').update({ active: false }).eq('id', tenant.id)).error, null);
  assert.equal((await clients.tenant.rpc('vihem_owns_rent_invoice', { invoice_link_id: invoice })).data, false);
  assert.deepEqual((await clients.tenant.from('vihem_accounted_invoice_links').select('id').eq('id', invoice)).data, []);
  console.log('PASS invoice ownership, amounts unchanged, billing notes private, admin access, foreign/anonymous/inactive denied. No external Accounted calls.');
} finally {
  assert.equal((await service.from('vihem_profiles').update({ active: tenant.active }).eq('id', tenant.id)).error, null);
  for (const [table, id] of [['vihem_accounted_invoice_links', invoice], ['vihem_rent_billing_runs', run], ['vihem_accounted_company_links', link], ['vihem_companies', company]]) {
    assert.equal((await service.from(table).delete().eq('id', id).eq('organisation_id', c.org)).error, null);
  }
}

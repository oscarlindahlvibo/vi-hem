// Skapar en demoanvändare med betald kurs (E2E-märkt – tas bort av e2e-cleanup.sql). Körs på servern efter e2e-setup.sql.
import { createClient } from '@supabase/supabase-js';
const ids = JSON.parse(process.env.E2E_IDS); const ORG = '38fe702d-e72c-49a2-9750-5e0b6934959b';
const admin = createClient(process.env.SUPABASE_URL, process.env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = 'demo@e2e.kp.test'; const password = 'Demo-Password-123';
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name: 'Demo', last_name: 'Deltagare' } }); if (error && !/already/.test(error.message)) throw error;
const uid = data?.user?.id ?? (await admin.rpc('vihem_kp_find_user', { p_email: email })).data[0].id;
await admin.from('vihem_kp_participants').upsert({ user_id: uid, organisation_id: ORG, email, first_name: 'Demo', last_name: 'Deltagare' });
const o = (await admin.rpc('vihem_kp_create_order', { p_org: ORG, p_buyer: uid, p_customer: null, p_buyer_type: 'private', p_items: [{ product_id: ids.product, quantity: 1 }], p_code: null, p_method: 'stripe', p_idem: 'demo-' + Date.now(), p_contact_email: email, p_billing: {}, p_terms: {} })).data;
await admin.rpc('vihem_kp_apply_payment', { p_order: o.order_id, p_provider: 'manual', p_ref: 'manual:demo-' + Date.now(), p_amount: o.total, p_detail: {} });
const asset = (await admin.from('vihem_kp_media_assets').select('bucket,storage_path').eq('id', ids.asset).single()).data;
const video = process.env.DEMO_VIDEO_B64 ? Buffer.from(process.env.DEMO_VIDEO_B64, 'base64') : new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
await admin.storage.from(asset.bucket).upload(asset.storage_path, video, { contentType: 'video/mp4', upsert: true });
console.log(JSON.stringify({ email, password, order: o.order_number }));

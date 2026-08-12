import React, { useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, Download, FileSpreadsheet, Home, MapPin, Package, Truck, Upload, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { createUserAccount } from '../lib/userAdmin';
import { Button, Card, EmptyState, PageHeader } from '../components/ui';

type ImportKind = 'properties' | 'apartments' | 'tenants' | 'inventory_locations' | 'inventory_items' | 'rental_products' | 'rental_pricing' | 'rental_assets';
type ImportRow = Record<string, string>;
type ImportResult = { row: number; status: 'created' | 'skipped' | 'error'; message: string; credentials?: { email: string; password: string } };

const columns: Record<ImportKind, string[]> = {
  properties: ['name', 'address', 'city', 'zip', 'description'],
  apartments: ['property_name', 'property_address', 'apartment_number', 'size', 'rooms', 'rent', 'floor', 'storage', 'parking', 'balcony', 'balcony_size', 'status', 'storage_id', 'parking_spot_id', 'cellar_id', 'mailbox_id', 'lock_cylinder_id', 'door_code', 'key_ids', 'network_outlet_ids', 'electricity_fuse_box', 'electricity_meter_id', 'water_meter_id', 'heat_meter_id', 'ventilation_unit_id', 'last_renovation_year', 'technical_notes'],
  tenants: ['name', 'email', 'phone', 'property_name', 'apartment_number', 'start_date', 'monthly_rent'],
  inventory_locations: ['name', 'type', 'code', 'parent_location', 'description'],
  inventory_items: ['article_number', 'name', 'description', 'category', 'manufacturer', 'supplier', 'supplier_article_number', 'barcode', 'unit', 'purchase_price', 'minimum_stock', 'target_stock', 'reorder_quantity', 'initial_location', 'initial_quantity', 'notes'],
  rental_products: ['name', 'slug', 'description', 'short_description', 'category', 'vat_rate', 'deposit', 'quantity', 'minimum_duration', 'maximum_duration', 'active', 'visible_publicly', 'pickup_instructions', 'return_instructions', 'location', 'sort_order', 'seo_title', 'seo_description'],
  rental_pricing: ['product_slug', 'rule_type', 'price', 'currency', 'duration', 'duration_unit', 'valid_from', 'valid_until', 'day_of_week', 'minimum_duration', 'maximum_duration', 'priority', 'active'],
  rental_assets: ['product_name', 'product_slug', 'name', 'internal_identifier', 'registration_number', 'serial_number', 'status', 'active', 'location', 'notes'],
};

const labels: Record<ImportKind, { title: string; description: string; icon: typeof Building2 }> = {
  properties: { title: 'Fastigheter', description: 'name, address, city och zip krävs.', icon: Building2 },
  apartments: { title: 'Lägenheter', description: 'Importera även storlek, hyra, förråd, parkering, lås, mätare, nätuttag, renoveringsår och tekniska anteckningar.', icon: Home },
  tenants: { title: 'Hyresgäster', description: 'name och email krävs. Lägenhet och hyresförhållande är valfria.', icon: Users },
  inventory_locations: { title: 'Lagerplatser', description: 'name och type krävs. Lägg överordnade platser före underordnade.', icon: MapPin },
  inventory_items: { title: 'Lagerartiklar', description: 'article_number och name krävs. initial_location och initial_quantity kan användas för startsaldo.', icon: Package },
  rental_products: { title: 'Uthyrningsprodukter', description: 'name och slug krävs. Produkten måste importeras innan dess fysiska objekt.', icon: Package },
  rental_pricing: { title: 'Uthyrningspriser', description: 'product_slug, rule_type och price krävs. Importera produkterna först.', icon: FileSpreadsheet },
  rental_assets: { title: 'Uthyrningsobjekt', description: 'product_name/product_slug och name krävs. Exempel: släp med regnummer eller serienummer.', icon: Truck },
};

const templateRows: Record<ImportKind, ImportRow[]> = {
  properties: [{ name: 'Ekängsvägen 1', address: 'Ekängsvägen 1', city: 'Virserum', zip: '57771', description: 'Exempelrad - ta bort före import' }],
  apartments: [{ property_name: 'Ekängsvägen 1', property_address: 'Ekängsvägen 1', apartment_number: '1001', size: '72', rooms: '3', rent: '8500', floor: '1', storage: 'Förråd 1001', parking: 'P-12', balcony: 'true', balcony_size: '8', status: 'vacant', storage_id: '', parking_spot_id: 'P-12', cellar_id: '', mailbox_id: '', lock_cylinder_id: '', door_code: '', key_ids: '[]', network_outlet_ids: '[]', electricity_fuse_box: '', electricity_meter_id: '', water_meter_id: '', heat_meter_id: '', ventilation_unit_id: '', last_renovation_year: '2020', technical_notes: '' }],
  tenants: [{ name: 'Anna Andersson', email: 'anna@example.com', phone: '070-1234567', property_name: 'Ekängsvägen 1', apartment_number: '1001', start_date: '2026-09-01', monthly_rent: '8500' }],
  inventory_locations: [{ name: 'Stora lagret', type: 'warehouse', code: 'EK-LAGER', parent_location: '', description: '' }],
  inventory_items: [{ article_number: 'SKR-000145', name: 'Trallskruv 4,8x55 C4', description: '', category: 'Bygg', manufacturer: '', supplier: 'Ahlsell', supplier_article_number: '', barcode: '', unit: 'st', purchase_price: '1.25', minimum_stock: '500', target_stock: '2000', reorder_quantity: '1500', initial_location: 'EK-LAGER', initial_quantity: '1240', notes: '' }],
  rental_products: [{ name: 'Släpvagn 750 kg', slug: 'slapvagn-750-kg', description: '', short_description: '', category: 'Släp', vat_rate: '25', deposit: '0', quantity: '1', minimum_duration: '1', maximum_duration: '', active: 'true', visible_publicly: 'true', pickup_instructions: '', return_instructions: '', location: '', sort_order: '0', seo_title: '', seo_description: '' }],
  rental_pricing: [{ product_slug: 'slapvagn-750-kg', rule_type: 'daily', price: '500', currency: 'SEK', duration: '1', duration_unit: 'day', valid_from: '', valid_until: '', day_of_week: '', minimum_duration: '', maximum_duration: '', priority: '0', active: 'true' }],
  rental_assets: [{ product_name: 'Släpvagn 750 kg', product_slug: 'slapvagn-750-kg', name: 'Släpvagn 1', internal_identifier: 'SLAP-001', registration_number: 'ABC123', serial_number: '', status: 'available', active: 'true', location: '', notes: '' }],
};

function clean(value: unknown) { return String(value ?? '').trim(); }
function readRows(file: File): Promise<ImportRow[]> {
  return file.arrayBuffer().then(buffer => {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return (XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), clean(value)])));
  });
}

function downloadCsv(kind: ImportKind) {
  const header = columns[kind].join(';');
  const sample = columns[kind].map(column => templateRows[kind][0][column] || '').join(';');
  const blob = new Blob([`\uFEFF${header}\n${sample}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `vi-hem-${kind}-mall.csv`; anchor.click(); URL.revokeObjectURL(url);
}

export function AdminImportPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const [kind, setKind] = useState<ImportKind>('properties');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const required = useMemo(() => {
    if (kind === 'properties') return ['name', 'address', 'city', 'zip'];
    if (kind === 'apartments') return ['property_name', 'apartment_number'];
    if (kind === 'tenants') return ['name', 'email'];
    if (kind === 'inventory_locations') return ['name', 'type'];
    if (kind === 'inventory_items') return ['article_number', 'name'];
    if (kind === 'rental_products') return ['name', 'slug'];
    if (kind === 'rental_pricing') return ['product_slug', 'rule_type', 'price'];
    return ['product_name', 'name'];
  }, [kind]);
  const rowErrors = useMemo(() => rows.map((row, index) => ({ row: index + 2, message: required.filter(field => !clean(row[field])).map(field => `saknar ${field}`).join(', ') })).filter(item => item.message), [rows, required]);

  function downloadExcelTemplate() {
    const workbook = XLSX.utils.book_new();
    (Object.keys(columns) as ImportKind[]).forEach(sheetKind => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(templateRows[sheetKind], { header: columns[sheetKind] }), labels[sheetKind].title));
    XLSX.writeFile(workbook, 'vi-hem-importmall.xlsx');
  }

  async function importRows() {
    if (!user?.organisation_id || rowErrors.length || !rows.length) return;
    setBusy(true); setError(''); setResults([]); const output: ImportResult[] = [];
    try {
      if (kind === 'properties') {
        const existing = (await supabase.from('vihem_properties').select('id,name,address').eq('organisation_id', user.organisation_id)).data || [];
        for (const [index, row] of rows.entries()) {
          const duplicate = existing.find(item => item.name.toLowerCase() === clean(row.name).toLowerCase() && item.address.toLowerCase() === clean(row.address).toLowerCase());
          if (duplicate) { output.push({ row: index + 2, status: 'skipped', message: 'Fastigheten finns redan.' }); continue; }
          const result = await supabase.from('vihem_properties').insert({ organisation_id: user.organisation_id, name: clean(row.name), address: clean(row.address), city: clean(row.city), zip: clean(row.zip), description: clean(row.description), contact_info: {} });
          output.push(result.error ? { row: index + 2, status: 'error', message: result.error.message } : { row: index + 2, status: 'created', message: 'Fastighet skapad.' });
        }
      } else if (kind === 'apartments') {
        const [properties, apartments] = await Promise.all([supabase.from('vihem_properties').select('id,name,address').eq('organisation_id', user.organisation_id), supabase.from('vihem_apartments').select('id,property_id,apartment_number').eq('organisation_id', user.organisation_id)]);
        for (const [index, row] of rows.entries()) {
          const property = (properties.data || []).find(item => item.name.toLowerCase() === clean(row.property_name).toLowerCase() && (!clean(row.property_address) || item.address.toLowerCase() === clean(row.property_address).toLowerCase()));
          if (!property) { output.push({ row: index + 2, status: 'error', message: `Hittar inte fastigheten "${row.property_name}".` }); continue; }
          if ((apartments.data || []).some(item => item.property_id === property.id && String(item.apartment_number) === clean(row.apartment_number))) { output.push({ row: index + 2, status: 'skipped', message: 'Lägenheten finns redan på fastigheten.' }); continue; }
          let keyIds: unknown[] = []; let networkOutletIds: unknown[] = [];
          try { if (clean(row.key_ids)) keyIds = JSON.parse(row.key_ids); if (clean(row.network_outlet_ids)) networkOutletIds = JSON.parse(row.network_outlet_ids); } catch { output.push({ row: index + 2, status: 'error', message: 'key_ids och network_outlet_ids måste vara giltig JSON, exempelvis [] eller ["K1"].' }); continue; }
          const result = await supabase.from('vihem_apartments').insert({ organisation_id: user.organisation_id, property_id: property.id, apartment_number: clean(row.apartment_number), size: Number(row.size) || 0, rooms: Number(row.rooms) || 0, rent: Number(row.rent) || 0, floor: Number(row.floor) || 0, storage: clean(row.storage), parking: clean(row.parking), balcony: ['true', '1', 'ja', 'yes'].includes(clean(row.balcony).toLowerCase()), balcony_size: Number(row.balcony_size) || 0, status: clean(row.status) || 'vacant', storage_id: clean(row.storage_id), parking_spot_id: clean(row.parking_spot_id), cellar_id: clean(row.cellar_id), mailbox_id: clean(row.mailbox_id), lock_cylinder_id: clean(row.lock_cylinder_id), door_code: clean(row.door_code), key_ids: keyIds, network_outlet_ids: networkOutletIds, electricity_fuse_box: clean(row.electricity_fuse_box), electricity_meter_id: clean(row.electricity_meter_id), water_meter_id: clean(row.water_meter_id), heat_meter_id: clean(row.heat_meter_id), ventilation_unit_id: clean(row.ventilation_unit_id), last_renovation_year: clean(row.last_renovation_year) ? Number(row.last_renovation_year) : null, technical_notes: clean(row.technical_notes) });
          output.push(result.error ? { row: index + 2, status: 'error', message: result.error.message } : { row: index + 2, status: 'created', message: 'Lägenhet skapad.' });
        }
      } else if (kind === 'inventory_locations') {
        const existing = (await supabase.from('vihem_inventory_locations').select('id,name,type,code,parent_location_id').eq('organisation_id', user.organisation_id)).data || [];
        for (const [index, row] of rows.entries()) {
          const parentName = clean(row.parent_location);
          const parent = parentName ? existing.find(item => item.code.toLowerCase() === parentName.toLowerCase() || item.name.toLowerCase() === parentName.toLowerCase()) : null;
          if (parentName && !parent) { output.push({ row: index + 2, status: 'error', message: `Hittar inte överordnad lagerplats "${parentName}".` }); continue; }
          const duplicate = existing.find(item => item.name.toLowerCase() === clean(row.name).toLowerCase() && item.parent_location_id === (parent?.id || null));
          if (duplicate) { output.push({ row: index + 2, status: 'skipped', message: 'Lagerplatsen finns redan på samma nivå.' }); continue; }
          const result = await supabase.from('vihem_inventory_locations').insert({ organisation_id: user.organisation_id, parent_location_id: parent?.id || null, name: clean(row.name), type: clean(row.type) || 'other', code: clean(row.code), description: clean(row.description), active: true, created_by: user.id }).select('id,name,type,code,parent_location_id').single();
          if (result.error) output.push({ row: index + 2, status: 'error', message: result.error.message });
          else { existing.push(result.data); output.push({ row: index + 2, status: 'created', message: 'Lagerplats skapad.' }); }
        }
      } else if (kind === 'inventory_items') {
        const [items, locations] = await Promise.all([
          supabase.from('vihem_inventory_stock_items').select('id,article_number').eq('organisation_id', user.organisation_id),
          supabase.from('vihem_inventory_locations').select('id,name,code').eq('organisation_id', user.organisation_id),
        ]);
        const existing = items.data || [];
        for (const [index, row] of rows.entries()) {
          if (existing.some(item => item.article_number.toLowerCase() === clean(row.article_number).toLowerCase())) { output.push({ row: index + 2, status: 'skipped', message: 'Lagerartikeln finns redan.' }); continue; }
          const initialQuantity = Number(row.initial_quantity) || 0;
          const locationName = clean(row.initial_location);
          const location = locationName ? (locations.data || []).find(item => item.code.toLowerCase() === locationName.toLowerCase() || item.name.toLowerCase() === locationName.toLowerCase()) : null;
          if (initialQuantity > 0 && !location) { output.push({ row: index + 2, status: 'error', message: `Startsaldot kräver en lagerplats som matchar "${locationName}".` }); continue; }
          const result = await supabase.from('vihem_inventory_stock_items').insert({ organisation_id: user.organisation_id, article_number: clean(row.article_number), name: clean(row.name), description: clean(row.description), category: clean(row.category), manufacturer: clean(row.manufacturer), supplier: clean(row.supplier), supplier_article_number: clean(row.supplier_article_number), barcode: clean(row.barcode), qr_identifier: crypto.randomUUID(), unit: clean(row.unit) || 'st', purchase_price: Number(row.purchase_price) || 0, minimum_stock: Number(row.minimum_stock) || 0, target_stock: Number(row.target_stock) || 0, reorder_quantity: Number(row.reorder_quantity) || 0, active: true, notes: clean(row.notes), created_by: user.id }).select('id').single();
          if (result.error) { output.push({ row: index + 2, status: 'error', message: result.error.message }); continue; }
          if (initialQuantity > 0) {
            const transaction = await supabase.rpc('vihem_inventory_apply_transaction', { p_item_id: result.data.id, p_quantity: initialQuantity, p_transaction_type: 'stock_in', p_source_location_id: null, p_destination_location_id: location?.id || null, p_project_id: null, p_work_order_id: null, p_other_reference: 'opening_balance_import', p_notes: 'Startsaldo från import' });
            if (transaction.error) { output.push({ row: index + 2, status: 'error', message: `Artikel skapad men startsaldo kunde inte läggas in: ${transaction.error.message}` }); continue; }
          }
          existing.push({ id: result.data.id, article_number: clean(row.article_number) });
          output.push({ row: index + 2, status: 'created', message: initialQuantity > 0 ? 'Lagerartikel och startsaldo skapade.' : 'Lagerartikel skapad.' });
        }
      } else if (kind === 'rental_products') {
        const existing = (await supabase.from('vihem_rental_products').select('id,name,slug').eq('organisation_id', user.organisation_id)).data || [];
        for (const [index, row] of rows.entries()) {
          if (existing.some(item => item.slug.toLowerCase() === clean(row.slug).toLowerCase())) { output.push({ row: index + 2, status: 'skipped', message: 'Uthyrningsprodukten finns redan.' }); continue; }
          const result = await supabase.from('vihem_rental_products').insert({ organisation_id: user.organisation_id, name: clean(row.name), slug: clean(row.slug), description: clean(row.description), short_description: clean(row.short_description), category: clean(row.category), images: [], active: clean(row.active).toLowerCase() !== 'false', visible_publicly: clean(row.visible_publicly).toLowerCase() === 'true', vat_rate: clean(row.vat_rate) ? Number(row.vat_rate) : null, deposit: Number(row.deposit) || 0, quantity: Number(row.quantity) || 0, minimum_duration: Number(row.minimum_duration) || 1, maximum_duration: clean(row.maximum_duration) ? Number(row.maximum_duration) : null, pickup_instructions: clean(row.pickup_instructions), return_instructions: clean(row.return_instructions), location: clean(row.location), sort_order: Number(row.sort_order) || 0, seo_title: clean(row.seo_title), seo_description: clean(row.seo_description), created_by: user.id }).select('id,name,slug').single();
          if (result.error) output.push({ row: index + 2, status: 'error', message: result.error.message });
          else { existing.push(result.data); output.push({ row: index + 2, status: 'created', message: 'Uthyrningsprodukt skapad.' }); }
        }
      } else if (kind === 'rental_pricing') {
        const [products, rules] = await Promise.all([
          supabase.from('vihem_rental_products').select('id,name,slug').eq('organisation_id', user.organisation_id),
          supabase.from('vihem_rental_pricing_rules').select('id,product_id,rule_type,price,duration,duration_unit,valid_from,valid_until').eq('organisation_id', user.organisation_id),
        ]);
        const existing = rules.data || [];
        for (const [index, row] of rows.entries()) {
          const product = (products.data || []).find(item => item.slug.toLowerCase() === clean(row.product_slug).toLowerCase());
          if (!product) { output.push({ row: index + 2, status: 'error', message: `Hittar inte uthyrningsprodukten med slug "${row.product_slug}".` }); continue; }
          const duration = Number(row.duration) || 1;
          const durationUnit = clean(row.duration_unit) || 'day';
          const price = Number(row.price) || 0;
          const duplicate = existing.some(item => item.product_id === product.id && item.rule_type === clean(row.rule_type) && Number(item.price) === price && Number(item.duration) === duration && item.duration_unit === durationUnit && item.valid_from === (clean(row.valid_from) || null) && item.valid_until === (clean(row.valid_until) || null));
          if (duplicate) { output.push({ row: index + 2, status: 'skipped', message: 'Prisregeln finns redan.' }); continue; }
          const dayOfWeek = clean(row.day_of_week).split(',').map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value >= 0 && value <= 6);
          const result = await supabase.from('vihem_rental_pricing_rules').insert({ organisation_id: user.organisation_id, product_id: product.id, asset_id: null, rule_type: clean(row.rule_type), price, currency: clean(row.currency) || 'SEK', duration, duration_unit: durationUnit, valid_from: clean(row.valid_from) || null, valid_until: clean(row.valid_until) || null, day_of_week: dayOfWeek, start_time: null, end_time: null, minimum_duration: clean(row.minimum_duration) ? Number(row.minimum_duration) : null, maximum_duration: clean(row.maximum_duration) ? Number(row.maximum_duration) : null, priority: Number(row.priority) || 0, active: clean(row.active).toLowerCase() !== 'false' }).select('id,product_id,rule_type,price,duration,duration_unit,valid_from,valid_until').single();
          if (result.error) output.push({ row: index + 2, status: 'error', message: result.error.message });
          else { existing.push(result.data); output.push({ row: index + 2, status: 'created', message: 'Prisregel skapad.' }); }
        }
      } else if (kind === 'rental_assets') {
        const [products, assets] = await Promise.all([
          supabase.from('vihem_rental_products').select('id,name,slug').eq('organisation_id', user.organisation_id),
          supabase.from('vihem_rental_assets').select('id,product_id,internal_identifier').eq('organisation_id', user.organisation_id),
        ]);
        const existing = assets.data || [];
        for (const [index, row] of rows.entries()) {
          const productName = clean(row.product_name); const productSlug = clean(row.product_slug);
          const product = (products.data || []).find(item => (productSlug && item.slug.toLowerCase() === productSlug.toLowerCase()) || (productName && item.name.toLowerCase() === productName.toLowerCase()));
          if (!product) { output.push({ row: index + 2, status: 'error', message: `Hittar inte uthyrningsprodukten "${productName || productSlug}".` }); continue; }
          const identifier = clean(row.internal_identifier);
          if (identifier && existing.some(item => item.product_id === product.id && item.internal_identifier.toLowerCase() === identifier.toLowerCase())) { output.push({ row: index + 2, status: 'skipped', message: 'Uthyrningsobjektet finns redan.' }); continue; }
          const result = await supabase.from('vihem_rental_assets').insert({ organisation_id: user.organisation_id, product_id: product.id, name: clean(row.name), internal_identifier: identifier, registration_number: clean(row.registration_number), serial_number: clean(row.serial_number), status: clean(row.status) || 'available', active: clean(row.active).toLowerCase() !== 'false', location: clean(row.location), notes: clean(row.notes) }).select('id,product_id,internal_identifier').single();
          if (result.error) output.push({ row: index + 2, status: 'error', message: result.error.message });
          else { existing.push(result.data); output.push({ row: index + 2, status: 'created', message: 'Uthyrningsobjekt skapat.' }); }
        }
      } else {
        const [properties, apartments] = await Promise.all([supabase.from('vihem_properties').select('id,name,address').eq('organisation_id', user.organisation_id), supabase.from('vihem_apartments').select('id,property_id,apartment_number').eq('organisation_id', user.organisation_id)]);
        for (const [index, row] of rows.entries()) {
          try {
            const property = (properties.data || []).find(item => item.name.toLowerCase() === clean(row.property_name).toLowerCase());
            const apartment = property && (apartments.data || []).find(item => item.property_id === property.id && String(item.apartment_number) === clean(row.apartment_number));
            const account = await createUserAccount({ name: clean(row.name), email: clean(row.email), phone: clean(row.phone), role: 'tenant', organisation_id: user.organisation_id });
            if (apartment && account.user_id) {
              const tenancy = await supabase.from('vihem_tenancies').insert({ organisation_id: user.organisation_id, tenant_id: account.user_id, property_id: property?.id || null, apartment_id: apartment.id, start_date: clean(row.start_date) || new Date().toISOString().slice(0, 10), monthly_rent: Number(row.monthly_rent) || 0, status: 'active' });
              if (tenancy.error) throw tenancy.error;
              await supabase.from('vihem_apartments').update({ status: 'rented' }).eq('id', apartment.id);
            }
            output.push({ row: index + 2, status: 'created', message: apartment ? 'Konto och hyresförhållande skapade.' : 'Konto skapat utan kopplad lägenhet.', credentials: { email: clean(row.email), password: account.temp_password } });
          } catch (rowError: any) { output.push({ row: index + 2, status: 'error', message: rowError?.message || 'Kunde inte skapa hyresgästen.' }); }
        }
      }
      setResults(output);
    } catch (importError: any) { setError(importError?.message || 'Importen kunde inte slutföras.'); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <PageHeader title="Importera data" subtitle="Lägg in boende-, lager- och uthyrningsdata med mall och förhandsgranskning." icon={FileSpreadsheet} />
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="p-5"><div className="mb-5 flex flex-wrap gap-2">{(Object.keys(labels) as ImportKind[]).map(value => { const Icon = labels[value].icon; return <Button key={value} size="sm" variant={kind === value ? 'primary' : 'secondary'} onClick={() => { setKind(value); setRows([]); setResults([]); setFileName(''); }}>{<Icon className="h-4 w-4" />}{labels[value].title}</Button>; })}</div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><h2 className="font-semibold text-blue-950">{labels[kind].title}</h2><p className="mt-1 text-sm text-blue-800">{labels[kind].description}</p><p className="mt-2 text-xs text-blue-700">Kolumner: {columns[kind].join(', ')}</p></div>
        <div className="mt-5 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => downloadCsv(kind)}><Download className="h-4 w-4" /> CSV-mall</Button><Button variant="secondary" onClick={downloadExcelTemplate}><Download className="h-4 w-4" /> Excel-mall (.xlsx)</Button><label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Upload className="h-4 w-4" /> Välj fil<input className="hidden" type="file" accept=".csv,.xlsx,.xls,.txt" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { setError(''); setRows(await readRows(file)); setFileName(file.name); setResults([]); } catch { setError('Filen kunde inte läsas. Använd mallen och kontrollera rubrikerna.'); } }} /></label></div>
        {fileName && <p className="mt-3 text-sm text-slate-600">Vald fil: <strong>{fileName}</strong> · {rows.length} rader</p>}
        {rowErrors.length > 0 && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p className="font-semibold">Importen kan inte starta ännu</p>{rowErrors.slice(0, 8).map(item => <p key={item.row}>Rad {item.row}: {item.message}</p>)}{rowErrors.length > 8 && <p>…och {rowErrors.length - 8} fler rader.</p>}</div>}
        {rows.length > 0 && <><div className="mt-5 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50"><tr>{columns[kind].map(column => <th key={column} className="px-3 py-2 font-semibold">{column}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={index} className="border-t border-slate-100">{columns[kind].map(column => <td key={column} className="max-w-[220px] truncate px-3 py-2">{row[column] || '—'}</td>)}</tr>)}</tbody></table></div>{rows.length > 10 && <p className="mt-2 text-xs text-slate-500">Visar de första 10 av {rows.length} rader.</p>}<Button className="mt-4" onClick={importRows} loading={busy} disabled={Boolean(rowErrors.length)}>Importera {rows.length} {labels[kind].title.toLowerCase()}</Button></>}
        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {results.length > 0 && <div className="mt-5 space-y-2"><h3 className="font-semibold">Importresultat</h3>{results.map(result => <div key={`${result.row}-${result.message}`} className={`rounded-lg border p-3 text-sm ${result.status === 'error' ? 'border-red-200 bg-red-50' : result.status === 'skipped' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="font-semibold">Rad {result.row}: {result.status === 'created' ? 'Skapad' : result.status === 'skipped' ? 'Hoppades över' : 'Fel'}</p><p>{result.message}</p>{result.credentials && <p className="mt-1 font-mono text-xs">Inloggning: {result.credentials.email} · tillfälligt lösenord: {result.credentials.password}</p>}</div>)}</div>}
      </Card>
      <Card className="h-fit p-5"><h2 className="font-semibold text-slate-900">Så gör du</h2><ol className="mt-3 space-y-3 text-sm text-slate-600"><li><strong>1.</strong> Ladda ner Excel-mallen eller CSV-mallen.</li><li><strong>2.</strong> Fyll i en rad per post och ändra inte kolumnrubrikerna.</li><li><strong>3.</strong> Importera boende i ordningen fastigheter, lägenheter, hyresgäster.</li><li><strong>4.</strong> För lager: importera lagerplatser före artiklar. Ange kod eller namn i <code>initial_location</code> om startsaldo ska läggas in.</li><li><strong>5.</strong> För uthyrning: importera produkter, priser och därefter fysiska objekt.</li><li><strong>6.</strong> Kontrollera förhandsvisningen och importresultatet.</li></ol><div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4" /> Hyresgäster får nya konton. Spara de tillfälliga lösenorden säkert och dela dem separat.</div><div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><CheckCircle2 className="mr-1 inline h-4 w-4" /> Befintliga poster hoppas över via organisationsbundna namn, koder, artikelnummer, sluggar och interna objekts-ID:n.</div></Card>
    </div>
  </div>;
}

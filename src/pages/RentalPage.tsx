import { useEffect, useMemo, useState } from 'react';
import { BedDouble, CalendarDays, Edit2, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../components/ui';

type Tab = 'overview' | 'calendar' | 'bookings' | 'products' | 'customers' | 'blocks' | 'settings';
type Product = { id: string; name: string; slug: string; description: string; category: string; images: string[]; active: boolean; visible_publicly: boolean; vat_rate: number | null; deposit: number; location: string };
type Asset = { id: string; product_id: string; name: string; internal_identifier: string; registration_number: string; serial_number: string; images: string[]; status: string; location: string; active: boolean };
type PriceRule = { id: string; product_id: string; asset_id: string | null; rule_type: string; price: number; currency: string; priority: number; active: boolean; valid_from: string | null; valid_until: string | null };
type Booking = { id: string; public_reference: string; product_id: string | null; status: string; start_at: string; end_at: string; total: number; customer_id: string | null };
type Block = { id: string; product_id: string; asset_id: string | null; start_at: string; end_at: string; block_type: string; reason: string };
type RentalCustomer = { id: string; first_name: string; last_name: string; company_name: string; email: string; phone: string; city: string; created_at: string };

const emptyProduct = { name: '', slug: '', description: '', category: '', vat_rate: '25', deposit: '0', location: '', active: true, visible_publicly: false };
const emptyAsset = { product_id: '', name: '', internal_identifier: '', registration_number: '', serial_number: '', status: 'available', location: '' };
const emptyPrice = { product_id: '', rule_type: 'daily', price: '', priority: '0' };
const emptyBlock = { product_id: '', asset_id: '', start_at: '', end_at: '', block_type: 'internal_use', reason: '', notes: '' };
const emptyBooking = { product_id: '', start_at: '', end_at: '', quantity: '1', first_name: '', last_name: '', company_name: '', email: '', phone: '', customer_notes: '' };
const emptyCustomer = { first_name: '', last_name: '', company_name: '', email: '', phone: '', address: '', postal_code: '', city: '', country: 'SE', notes: '' };
const emptySettings = { currency: 'SEK', vat_rate: '25', timezone: 'Europe/Stockholm', booking_prefix: 'VR', minimum_advance_hours: '0', maximum_advance_days: '730', default_return_buffer_minutes: '0', cancellation_policy: '', customer_support_email: '', customer_support_phone: '', terms_url: '', privacy_url: '' };

function money(value: number) {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(value || 0);
}

function dateTime(value: string) {
  return value ? new Date(value).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '-';
}

function priceRuleLabel(ruleType: string) {
  return ({ hourly: 'Timme', daily: 'Dygn', weekend: 'Helg', weekly: 'Vecka', fixed_period: 'Specialperiod', custom: 'Anpassat' } as Record<string, string>)[ruleType] || ruleType;
}

function ProductOverview({ products, assets, prices, onEditProduct, onEditAsset, onEditPrice, onNewAsset, onNewPrice }: { products: Product[]; assets: Asset[]; prices: PriceRule[]; onEditProduct: (product: Product) => void; onEditAsset: (asset: Asset) => void; onEditPrice: (price: PriceRule) => void; onNewAsset: (productId: string) => void; onNewPrice: (productId: string) => void }) {
  const [productId, setProductId] = useState(products[0]?.id || '');
  useEffect(() => { if (!products.some(product => product.id === productId)) setProductId(products[0]?.id || ''); }, [products, productId]);
  const product = products.find(item => item.id === productId);
  if (!product) return null;
  const productAssets = assets.filter(asset => asset.product_id === product.id);
  const productPrices = prices.filter(price => price.product_id === product.id);
  return <Card className="border-blue-100 bg-blue-50/30 p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Produktöversikt</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Pris och uthyrningsobjekt</h2><p className="mt-1 text-sm text-slate-500">Välj en produkt för att se och justera dess prisnivåer och fysiska exemplar.</p></div><div className="flex flex-wrap gap-2"><Select label="Produkt" value={product.id} onChange={event => setProductId(event.target.value)} options={products.map(item => ({ value: item.id, label: item.name }))} /><Button size="sm" variant="secondary" onClick={() => onEditProduct(product)}><Edit2 className="h-4 w-4" /> Redigera produkt</Button></div></div><div className="mt-5 grid gap-4 xl:grid-cols-2"><Card className="p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Priser</h3><p className="text-sm text-slate-500">Debiteringsnivåer som används av prisberäkningen.</p></div><Button size="sm" onClick={() => onNewPrice(product.id)}><Plus className="h-4 w-4" /> Lägg till</Button></div>{productPrices.length === 0 ? <p className="mt-4 text-sm text-slate-500">Inga prisregler upplagda.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2 pr-4">Nivå</th><th className="py-2 pr-4">Pris</th><th className="py-2 pr-4">Gäller</th><th className="py-2 text-right"> </th></tr></thead><tbody className="divide-y divide-slate-100">{productPrices.map(price => <tr key={price.id}><td className="py-3 pr-4 font-medium">{priceRuleLabel(price.rule_type)}</td><td className="py-3 pr-4 font-semibold">{money(price.price)} <span className="font-normal text-slate-500">/{price.rule_type === 'hourly' ? 'tim' : price.rule_type === 'weekly' ? 'vecka' : price.rule_type === 'weekend' ? 'helg' : 'dygn'}</span></td><td className="py-3 pr-4 text-slate-500">{price.valid_from || price.valid_until ? `${price.valid_from || '–'} – ${price.valid_until || '–'}` : 'Alltid'}</td><td className="py-3 text-right"><Button size="sm" variant="ghost" onClick={() => onEditPrice(price)} aria-label={`Redigera ${priceRuleLabel(price.rule_type)}`}><Edit2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>}</Card><Card className="p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Fysiska exemplar ({productAssets.length})</h3><p className="text-sm text-slate-500">Registreringsnummer, serienummer och aktuell placering.</p></div><Button size="sm" onClick={() => onNewAsset(product.id)}><Plus className="h-4 w-4" /> Lägg till</Button></div>{productAssets.length === 0 ? <p className="mt-4 text-sm text-slate-500">Inga assets upplagda för produkten.</p> : <div className="mt-3 divide-y divide-slate-100">{productAssets.map(asset => <div key={asset.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="font-medium text-slate-900">{asset.name}</p><p className="truncate text-sm text-slate-500">{asset.registration_number || asset.serial_number || asset.internal_identifier || 'Saknar identifierare'} · {asset.location || 'Ingen plats'}</p></div><div className="flex items-center gap-2"><Badge className={asset.status === 'available' ? 'bg-emerald-100 text-emerald-700' : asset.status === 'maintenance' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}>{asset.status === 'available' ? 'Tillgänglig' : asset.status === 'maintenance' ? 'Service' : asset.status}</Badge><Button size="sm" variant="ghost" onClick={() => onEditAsset(asset)} aria-label={`Redigera ${asset.name}`}><Edit2 className="h-4 w-4" /></Button></div></div>)}</div>}</Card></div></Card>;
}

export function RentalPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const organisationId = user?.organisation_id;
  const [tab, setTab] = useState<Tab>('overview');
  const [products, setProducts] = useState<Product[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [prices, setPrices] = useState<PriceRule[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [customers, setCustomers] = useState<RentalCustomer[]>([]);
  const [settingsForm, setSettingsForm] = useState(emptySettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [productModal, setProductModal] = useState(false);
  const [assetModal, setAssetModal] = useState(false);
  const [priceModal, setPriceModal] = useState(false);
  const [blockModal, setBlockModal] = useState(false);
  const [bookingModal, setBookingModal] = useState(false);
  const [customerModal, setCustomerModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [editingPrice, setEditingPrice] = useState<PriceRule | null>(null);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [assetForm, setAssetForm] = useState(emptyAsset);
  const [productImages, setProductImages] = useState<File[]>([]);
  const [assetImages, setAssetImages] = useState<File[]>([]);
  const [priceForm, setPriceForm] = useState(emptyPrice);
  const [blockForm, setBlockForm] = useState(emptyBlock);
  const [bookingForm, setBookingForm] = useState(emptyBooking);
  const [customerForm, setCustomerForm] = useState(emptyCustomer);
  const [saving, setSaving] = useState(false);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const assetById = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);

  async function fetchData() {
    if (!organisationId) return;
    setLoading(true);
    const [productResult, assetResult, priceResult, bookingResult, blockResult, customerResult, settingsResult] = await Promise.all([
      supabase.from('vihem_rental_products').select('*').eq('organisation_id', organisationId).order('sort_order').order('name'),
      supabase.from('vihem_rental_assets').select('*').eq('organisation_id', organisationId).order('name'),
      supabase.from('vihem_rental_pricing_rules').select('*').eq('organisation_id', organisationId).order('priority', { ascending: false }),
      supabase.from('vihem_rental_bookings').select('id,public_reference,status,start_at,end_at,total,customer_id,vihem_rental_booking_items(product_id)').eq('organisation_id', organisationId).order('start_at'),
      supabase.from('vihem_rental_blocks').select('*').eq('organisation_id', organisationId).order('start_at'),
      supabase.from('vihem_rental_customers').select('id,first_name,last_name,company_name,email,phone,city,created_at').eq('organisation_id', organisationId).order('created_at', { ascending: false }),
      supabase.from('vihem_rental_settings').select('*').eq('organisation_id', organisationId).maybeSingle(),
    ]);
    const firstError = productResult.error || assetResult.error || priceResult.error || bookingResult.error || blockResult.error || customerResult.error || settingsResult.error;
    if (firstError) setError(firstError.message);
    setProducts((productResult.data || []) as Product[]);
    setAssets((assetResult.data || []) as Asset[]);
    setPrices((priceResult.data || []) as PriceRule[]);
    setBookings(((bookingResult.data || []) as any[]).map(row => ({ ...row, product_id: row.vihem_rental_booking_items?.[0]?.product_id || null })));
    setBlocks((blockResult.data || []) as Block[]);
    setCustomers((customerResult.data || []) as RentalCustomer[]);
    if (settingsResult.data) setSettingsForm({ ...emptySettings, ...Object.fromEntries(Object.keys(emptySettings).map(key => [key, String(settingsResult.data[key] ?? emptySettings[key as keyof typeof emptySettings])])) } as typeof emptySettings);
    setLoading(false);
  }

  useEffect(() => { void fetchData(); }, [organisationId]);

  function openNewProduct() { setEditingProduct(null); setProductForm(emptyProduct); setProductImages([]); setProductModal(true); }
  function openNewAsset(productId = products[0]?.id || '') { setEditingAsset(null); setAssetForm({ ...emptyAsset, product_id: productId }); setAssetImages([]); setAssetModal(true); }
  function openEditAsset(asset: Asset) { setEditingAsset(asset); setAssetForm({ product_id: asset.product_id, name: asset.name, internal_identifier: asset.internal_identifier || '', registration_number: asset.registration_number || '', serial_number: asset.serial_number || '', status: asset.status, location: asset.location || '' }); setAssetImages([]); setAssetModal(true); }
  function openNewPrice(productId = products[0]?.id || '') { setEditingPrice(null); setPriceForm({ ...emptyPrice, product_id: productId }); setPriceModal(true); }
  function openEditPrice(price: PriceRule) { setEditingPrice(price); setPriceForm({ product_id: price.product_id, rule_type: price.rule_type, price: String(price.price), priority: String(price.priority || 0) }); setPriceModal(true); }
  function openEditProduct(product: Product) {
    setEditingProduct(product);
    setProductImages([]);
    setProductForm({ name: product.name, slug: product.slug, description: product.description || '', category: product.category || '', vat_rate: String(product.vat_rate ?? 25), deposit: String(product.deposit || 0), location: product.location || '', active: product.active, visible_publicly: product.visible_publicly });
    setProductModal(true);
  }

  async function saveProduct() {
    if (!organisationId || !productForm.name.trim()) return;
    setSaving(true); setError('');
    const payload = { ...productForm, organisation_id: organisationId, name: productForm.name.trim(), slug: (productForm.slug.trim() || productForm.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), vat_rate: Number(productForm.vat_rate) || 0, deposit: Number(productForm.deposit) || 0, updated_at: new Date().toISOString() };
    const result = editingProduct ? await supabase.from('vihem_rental_products').update(payload).eq('id', editingProduct.id).select('id').single() : await supabase.from('vihem_rental_products').insert({ ...payload, created_by: user?.id }).select('id').single();
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    const productId = editingProduct?.id || result.data?.id;
    if (productId && productImages.length) {
      const urls = await uploadImages(productImages, productId);
      if (urls.length) await supabase.from('vihem_rental_products').update({ images: [...(editingProduct?.images || []), ...urls], updated_at: new Date().toISOString() }).eq('id', productId);
    }
    setProductModal(false); await fetchData();
  }

  async function uploadImages(files: File[], entityId: string) {
    if (!organisationId) return [];
    const urls: string[] = [];
    for (const file of files) {
      const path = `${organisationId}/${entityId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      const upload = await supabase.storage.from('vihem-rental-images').upload(path, file, { upsert: false, contentType: file.type });
      if (upload.error) { setError(upload.error.message); continue; }
      urls.push(supabase.storage.from('vihem-rental-images').getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`Ta bort produkten "${product.name}"?`)) return;
    const { error: deleteError } = await supabase.from('vihem_rental_products').delete().eq('id', product.id);
    if (deleteError) setError(deleteError.message); else await fetchData();
  }

  async function saveAsset() {
    if (!organisationId || !assetForm.product_id || !assetForm.name.trim()) return;
    setSaving(true);
    const result = editingAsset
      ? await supabase.from('vihem_rental_assets').update({ ...assetForm, name: assetForm.name.trim(), updated_at: new Date().toISOString() }).eq('id', editingAsset.id).select('id').single()
      : await supabase.from('vihem_rental_assets').insert({ ...assetForm, organisation_id: organisationId, name: assetForm.name.trim() }).select('id').single();
    setSaving(false);
    if (result.error) setError(result.error.message); else {
      if (assetImages.length && result.data?.id) {
        const urls = await uploadImages(assetImages, result.data.id);
        if (urls.length) await supabase.from('vihem_rental_assets').update({ images: urls }).eq('id', result.data.id);
      }
      setAssetModal(false); setAssetForm(emptyAsset); setAssetImages([]); setEditingAsset(null); await fetchData();
    }
  }

  async function savePrice() {
    if (!organisationId || !priceForm.product_id || !priceForm.price) return;
    setSaving(true);
    const payload = { ...priceForm, price: Number(priceForm.price) || 0, priority: Number(priceForm.priority) || 0, currency: 'SEK', duration: 1, duration_unit: priceForm.rule_type === 'hourly' ? 'hour' : priceForm.rule_type === 'weekly' ? 'week' : 'day', updated_at: new Date().toISOString() };
    const result = editingPrice
      ? await supabase.from('vihem_rental_pricing_rules').update(payload).eq('id', editingPrice.id).select('id').single()
      : await supabase.from('vihem_rental_pricing_rules').insert({ ...payload, organisation_id: organisationId }).select('id').single();
    setSaving(false);
    if (result.error) setError(result.error.message); else { setPriceModal(false); setPriceForm(emptyPrice); setEditingPrice(null); await fetchData(); }
  }

  async function saveBlock() {
    if (!organisationId || !blockForm.product_id || !blockForm.start_at || !blockForm.end_at) return;
    setSaving(true);
    const result = await supabase.from('vihem_rental_blocks').insert({ ...blockForm, organisation_id: organisationId, asset_id: blockForm.asset_id || null, created_by: user?.id });
    setSaving(false);
    if (result.error) setError(result.error.message); else { setBlockModal(false); setBlockForm(emptyBlock); await fetchData(); }
  }

  async function saveBooking() {
    if (!bookingForm.product_id || !bookingForm.start_at || !bookingForm.end_at || !bookingForm.email.trim()) return;
    setSaving(true); setError('');
    const result = await supabase.rpc('vihem_create_rental_booking', {
      target_product_id: bookingForm.product_id,
      target_start_at: new Date(bookingForm.start_at).toISOString(),
      target_end_at: new Date(bookingForm.end_at).toISOString(),
      target_quantity: Math.max(1, Number(bookingForm.quantity) || 1),
      target_customer: { first_name: bookingForm.first_name, last_name: bookingForm.last_name, company_name: bookingForm.company_name, email: bookingForm.email, phone: bookingForm.phone },
      target_source: 'vihem',
      target_status: 'confirmed',
      target_customer_notes: bookingForm.customer_notes,
    });
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    setBookingModal(false); setBookingForm(emptyBooking); await fetchData();
  }

  async function saveCustomer() {
    if (!organisationId || (!customerForm.email.trim() && !customerForm.phone.trim())) return;
    setSaving(true); setError('');
    const result = await supabase.from('vihem_rental_customers').insert({ ...customerForm, organisation_id: organisationId });
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    setCustomerModal(false); setCustomerForm(emptyCustomer); await fetchData();
  }

  async function saveSettings() {
    if (!organisationId || user?.role !== 'admin') return;
    setSaving(true); setError('');
    const result = await supabase.from('vihem_rental_settings').upsert({ organisation_id: organisationId, ...settingsForm, vat_rate: Number(settingsForm.vat_rate) || 0, minimum_advance_hours: Number(settingsForm.minimum_advance_hours) || 0, maximum_advance_days: Number(settingsForm.maximum_advance_days) || 0, default_return_buffer_minutes: Number(settingsForm.default_return_buffer_minutes) || 0, updated_at: new Date().toISOString() }, { onConflict: 'organisation_id' });
    setSaving(false);
    if (result.error) setError(result.error.message); else setError('Inställningarna är sparade.');
  }

  if (loading) return <LoadingPage />;
  const today = new Date();
  const activeBookings = bookings.filter(booking => !['cancelled', 'completed'].includes(booking.status));
  const upcoming = activeBookings.filter(booking => new Date(booking.end_at) >= today).slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader title="Uthyrning" subtitle="Hantera ViboRents produkter, priser, assets, kunder, bokningar och interna spärrar." icon={BedDouble} />
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {tab === 'products' && <ProductOverview products={products} assets={assets} prices={prices} onEditProduct={openEditProduct} onEditAsset={openEditAsset} onEditPrice={openEditPrice} onNewAsset={openNewAsset} onNewPrice={openNewPrice} />}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {([['overview', 'Översikt'], ['calendar', 'Kalender'], ['bookings', 'Bokningar'], ['products', 'Produkter & assets'], ['customers', 'Kunder'], ['blocks', 'Spärrar'], ...(user?.role === 'admin' ? [['settings', 'Inställningar'] as [Tab, string]] : [])] as [Tab, string][]).map(([value, label]) => <Button key={value} size="sm" variant={tab === value ? 'primary' : 'secondary'} onClick={() => setTab(value)}>{label}</Button>)}
      </div>

      {tab === 'overview' && <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5"><p className="text-sm text-slate-500">Aktiva produkter</p><p className="mt-1 text-3xl font-bold">{products.filter(p => p.active).length}</p><Button className="mt-4" size="sm" onClick={() => setTab('products')}>Hantera produkter</Button></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">Uthyrningsobjekt</p><p className="mt-1 text-3xl font-bold">{assets.filter(a => a.active).length}</p><p className="mt-1 text-sm text-emerald-700">{assets.filter(a => a.status === 'available').length} tillgängliga</p></Card>
        <Card className="p-5"><p className="text-sm text-slate-500">Aktiva bokningar</p><p className="mt-1 text-3xl font-bold">{activeBookings.length}</p><Button className="mt-4" size="sm" onClick={() => setTab('bookings')}>Visa bokningar</Button></Card>
        <Card className="p-5 md:col-span-2"><h2 className="font-semibold">Kommande bokningar</h2>{upcoming.length === 0 ? <EmptyState title="Inga kommande bokningar" /> : <div className="mt-3 divide-y divide-slate-100">{upcoming.map(booking => <div key={booking.id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium">{booking.public_reference} · {productById.get(booking.product_id || '')?.name || 'Produkt'}</p><p className="text-sm text-slate-500">{dateTime(booking.start_at)} - {dateTime(booking.end_at)}</p></div><Badge className="bg-blue-100 text-blue-700">{booking.status}</Badge></div>)}</div>}</Card>
        <Card className="p-5"><h2 className="font-semibold">Snabbåtgärder</h2><div className="mt-3 grid gap-2"><Button size="sm" onClick={openNewProduct}><Plus className="h-4 w-4" /> Ny produkt</Button><Button size="sm" variant="secondary" onClick={() => setBlockModal(true)}><ShieldAlert className="h-4 w-4" /> Skapa spärr</Button></div></Card>
      </div>}

      {tab === 'products' && <div className="space-y-4"><div className="flex justify-end gap-2"><Button onClick={openNewProduct}><Plus className="h-4 w-4" /> Ny produkt</Button><Button variant="secondary" onClick={() => { setAssetForm({ ...emptyAsset, product_id: products[0]?.id || '' }); setAssetImages([]); setAssetModal(true); }}><Plus className="h-4 w-4" /> Ny asset</Button><Button variant="secondary" onClick={() => { setPriceForm({ ...emptyPrice, product_id: products[0]?.id || '' }); setPriceModal(true); }}><Plus className="h-4 w-4" /> Ny prisregel</Button></div><div className="grid gap-4 lg:grid-cols-2">{products.length === 0 ? <Card className="p-8"><EmptyState title="Inga produkter ännu" /></Card> : products.map(product => <Card key={product.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{product.name}</h2><p className="text-sm text-slate-500">{product.category || 'Okategoriserad'} · {product.location || 'Ingen plats'}</p></div><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => openEditProduct(product)} aria-label="Redigera produkt"><Edit2 className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => deleteProduct(product)} aria-label="Ta bort produkt"><Trash2 className="h-4 w-4 text-rose-600" /></Button></div></div>{Array.isArray(product.images) && product.images[0] && <img src={String(product.images[0])} alt="" className="mt-3 h-28 w-full rounded-lg object-cover" />}<p className="mt-3 text-sm text-slate-600">{product.description || 'Ingen beskrivning.'}</p><div className="mt-4 flex flex-wrap gap-2"><Badge className="bg-slate-100 text-slate-700">Moms {product.vat_rate ?? 25}%</Badge><Badge className="bg-slate-100 text-slate-700">Deposition {money(product.deposit)}</Badge>{product.visible_publicly && <Badge className="bg-emerald-100 text-emerald-700">Publik</Badge>}</div><div className="mt-4 border-t border-slate-100 pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assets</p>{assets.filter(asset => asset.product_id === product.id).map(asset => <div key={asset.id} className="flex items-center justify-between py-2 text-sm"><span>{asset.name} <span className="text-slate-400">({asset.registration_number || asset.internal_identifier || 'utan id'})</span></span><Badge className={asset.status === 'available' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>{asset.status}</Badge></div>)}{!assets.some(asset => asset.product_id === product.id) && <p className="py-2 text-sm text-slate-500">Inga individuella assets.</p>}</div></Card>)}</div></div>}

      {tab === 'bookings' && <Card className="overflow-hidden"><div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4"><div><h2 className="font-semibold">Bokningar</h2><p className="text-sm text-slate-500">Bokningar från viborent.se och intern administration visas här.</p></div><Button onClick={() => { setBookingForm({ ...emptyBooking, product_id: products[0]?.id || '' }); setBookingModal(true); }}><Plus className="h-4 w-4" /> Ny bokning</Button></div>{bookings.length === 0 ? <EmptyState title="Inga bokningar ännu" /> : <div className="divide-y divide-slate-100">{bookings.map(booking => <div key={booking.id} className="grid gap-2 p-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-center"><div><p className="font-semibold">{booking.public_reference}</p><p className="text-sm text-slate-500">{productById.get(booking.product_id || '')?.name || 'Produkt'}</p></div><p className="text-sm text-slate-600">{dateTime(booking.start_at)} - {dateTime(booking.end_at)}</p><Badge className="bg-slate-100 text-slate-700">{booking.status}</Badge><span className="font-semibold">{money(booking.total)}</span></div>)}</div>}</Card>}

      {tab === 'customers' && <Card className="overflow-hidden"><div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4"><div><h2 className="font-semibold">Uthyrningskunder</h2><p className="text-sm text-slate-500">Kunduppgifter återanvänds vid interna och publika bokningar.</p></div><Button onClick={() => setCustomerModal(true)}><Plus className="h-4 w-4" /> Ny kund</Button></div>{customers.length === 0 ? <EmptyState title="Inga kunder ännu" /> : <div className="divide-y divide-slate-100">{customers.map(customer => <div key={customer.id} className="flex flex-col gap-1 p-4 md:flex-row md:items-center md:justify-between"><div><p className="font-semibold">{[customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name || 'Namnlös kund'}</p><p className="text-sm text-slate-500">{customer.company_name && customer.company_name !== `${customer.first_name} ${customer.last_name}` ? `${customer.company_name} · ` : ''}{customer.email || customer.phone || 'Ingen kontaktuppgift'}</p></div><span className="text-sm text-slate-500">{customer.city || 'Ingen ort'}</span></div>)}</div>}</Card>}

      {tab === 'settings' && user?.role === 'admin' && <Card className="p-5"><div className="mb-5"><h2 className="font-semibold">Uthyrningsinställningar</h2><p className="text-sm text-slate-500">Dessa värden används av pris- och bokningsmotorn för organisationen.</p></div><div className="grid gap-4 sm:grid-cols-2"><Input label="Valuta" value={settingsForm.currency} onChange={e => setSettingsForm({ ...settingsForm, currency: e.target.value.toUpperCase() })} /><Input label="Standardmoms %" type="number" min="0" value={settingsForm.vat_rate} onChange={e => setSettingsForm({ ...settingsForm, vat_rate: e.target.value })} /><Input label="Bokningsprefix" value={settingsForm.booking_prefix} onChange={e => setSettingsForm({ ...settingsForm, booking_prefix: e.target.value.toUpperCase() })} /><Input label="Tidszon" value={settingsForm.timezone} onChange={e => setSettingsForm({ ...settingsForm, timezone: e.target.value })} /><Input label="Minsta framförhållning (timmar)" type="number" min="0" value={settingsForm.minimum_advance_hours} onChange={e => setSettingsForm({ ...settingsForm, minimum_advance_hours: e.target.value })} /><Input label="Max framförhållning (dagar)" type="number" min="0" value={settingsForm.maximum_advance_days} onChange={e => setSettingsForm({ ...settingsForm, maximum_advance_days: e.target.value })} /><Input label="Återlämningsbuffert (minuter)" type="number" min="0" value={settingsForm.default_return_buffer_minutes} onChange={e => setSettingsForm({ ...settingsForm, default_return_buffer_minutes: e.target.value })} /><Input label="Support e-post" type="email" value={settingsForm.customer_support_email} onChange={e => setSettingsForm({ ...settingsForm, customer_support_email: e.target.value })} /><Input label="Support telefon" value={settingsForm.customer_support_phone} onChange={e => setSettingsForm({ ...settingsForm, customer_support_phone: e.target.value })} /><Input label="Villkors-URL" value={settingsForm.terms_url} onChange={e => setSettingsForm({ ...settingsForm, terms_url: e.target.value })} /><Input label="Integritetspolicy-URL" value={settingsForm.privacy_url} onChange={e => setSettingsForm({ ...settingsForm, privacy_url: e.target.value })} /></div><div className="mt-5 flex justify-end"><Button onClick={saveSettings} loading={saving}>Spara inställningar</Button></div></Card>}

      {tab === 'calendar' && <Card className="p-5"><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-blue-600" /><h2 className="font-semibold">Uthyrningskalender</h2></div><div className="mt-4 grid gap-3">{[...activeBookings.map(booking => ({ kind: 'booking', id: booking.id, start: booking.start_at, end: booking.end_at, title: `${booking.public_reference} · ${productById.get(booking.product_id || '')?.name || 'Produkt'}` })), ...blocks.map(block => ({ kind: block.block_type, id: block.id, start: block.start_at, end: block.end_at, title: `${block.reason || 'Spärr'} · ${productById.get(block.product_id)?.name || 'Produkt'}${block.asset_id ? ` · ${assetById.get(block.asset_id)?.name || ''}` : ''}` }))].sort((a, b) => a.start.localeCompare(b.start)).map(item => <div key={`${item.kind}-${item.id}`} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-3 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${item.kind === 'booking' ? 'bg-blue-500' : 'bg-amber-500'}`} /><span className="font-medium">{item.title}</span></div><span className="text-sm text-slate-500">{dateTime(item.start)} - {dateTime(item.end)}</span></div>)}</div></Card>}

      {tab === 'blocks' && <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-200 p-4"><div><h2 className="font-semibold">Interna spärrar</h2><p className="text-sm text-slate-500">Spärrar produkter eller enskilda assets från publik bokning.</p></div><Button onClick={() => setBlockModal(true)}><Plus className="h-4 w-4" /> Ny spärr</Button></div>{blocks.length === 0 ? <EmptyState title="Inga spärrar ännu" /> : <div className="divide-y divide-slate-100">{blocks.map(block => <div key={block.id} className="p-4"><p className="font-semibold">{block.reason || 'Intern spärr'}</p><p className="text-sm text-slate-600">{productById.get(block.product_id)?.name || 'Produkt'}{block.asset_id ? ` · ${assetById.get(block.asset_id)?.name || ''}` : ''}</p><p className="text-sm text-slate-500">{dateTime(block.start_at)} - {dateTime(block.end_at)} · {block.block_type}</p></div>)}</div>}</Card>}

      <Modal open={productModal} onClose={() => setProductModal(false)} title={editingProduct ? 'Redigera produkt' : 'Ny uthyrningsprodukt'} size="lg"><div className="space-y-4"><Input label="Namn" value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} /><Input label="Slug" value={productForm.slug} onChange={e => setProductForm({ ...productForm, slug: e.target.value })} placeholder="slapvagn-750-kg" /><div className="grid gap-4 sm:grid-cols-2"><Input label="Kategori" value={productForm.category} onChange={e => setProductForm({ ...productForm, category: e.target.value })} placeholder="Släp, maskiner eller verktyg" /><Input label="Plats" value={productForm.location} onChange={e => setProductForm({ ...productForm, location: e.target.value })} /><Input label="Moms %" type="number" min="0" value={productForm.vat_rate} onChange={e => setProductForm({ ...productForm, vat_rate: e.target.value })} /><Input label="Deposition" type="number" min="0" value={productForm.deposit} onChange={e => setProductForm({ ...productForm, deposit: e.target.value })} /></div><Textarea label="Beskrivning" rows={4} value={productForm.description} onChange={e => setProductForm({ ...productForm, description: e.target.value })} /><Input label="Produktbilder" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={e => setProductImages(Array.from(e.target.files || []))} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={productForm.visible_publicly} onChange={e => setProductForm({ ...productForm, visible_publicly: e.target.checked })} /> Synlig på viborent.se</label><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setProductModal(false)}>Avbryt</Button><Button onClick={saveProduct} loading={saving}>Spara produkt</Button></div></div></Modal>

      <Modal open={assetModal} onClose={() => setAssetModal(false)} title="Nytt uthyrningsobjekt"><div className="space-y-4"><Select label="Produkt" value={assetForm.product_id} onChange={e => setAssetForm({ ...assetForm, product_id: e.target.value })} options={products.map(p => ({ value: p.id, label: p.name }))} /><Input label="Namn" value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="Släpvagn #1" /><div className="grid gap-4 sm:grid-cols-2"><Input label="Internt id" value={assetForm.internal_identifier} onChange={e => setAssetForm({ ...assetForm, internal_identifier: e.target.value })} /><Input label="Registreringsnummer" value={assetForm.registration_number} onChange={e => setAssetForm({ ...assetForm, registration_number: e.target.value.toUpperCase() })} placeholder="ABC123" /><Input label="Serienummer" value={assetForm.serial_number} onChange={e => setAssetForm({ ...assetForm, serial_number: e.target.value })} /><Input label="Plats" value={assetForm.location} onChange={e => setAssetForm({ ...assetForm, location: e.target.value })} /></div><Input label="Bilder på objektet" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={e => setAssetImages(Array.from(e.target.files || []))} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAssetModal(false)}>Avbryt</Button><Button onClick={saveAsset} loading={saving}>Spara asset</Button></div></div></Modal>

      <Modal open={priceModal} onClose={() => setPriceModal(false)} title="Ny prisregel"><div className="space-y-4"><Select label="Produkt" value={priceForm.product_id} onChange={e => setPriceForm({ ...priceForm, product_id: e.target.value })} options={products.map(p => ({ value: p.id, label: p.name }))} /><Select label="Prisnivå" value={priceForm.rule_type} onChange={e => setPriceForm({ ...priceForm, rule_type: e.target.value })} options={[{ value: 'hourly', label: 'Timme' }, { value: 'daily', label: 'Dygn' }, { value: 'weekend', label: 'Helg' }, { value: 'weekly', label: 'Vecka' }, { value: 'fixed_period', label: 'Specialperiod' }]} /><Input label="Pris exkl. moms" type="number" min="0" value={priceForm.price} onChange={e => setPriceForm({ ...priceForm, price: e.target.value })} /><Input label="Prioritet" type="number" value={priceForm.priority} onChange={e => setPriceForm({ ...priceForm, priority: e.target.value })} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setPriceModal(false)}>Avbryt</Button><Button onClick={savePrice} loading={saving}>Spara prisregel</Button></div></div></Modal>

      <Modal open={blockModal} onClose={() => setBlockModal(false)} title="Skapa intern spärr"><div className="space-y-4"><Select label="Produkt" value={blockForm.product_id} onChange={e => setBlockForm({ ...blockForm, product_id: e.target.value, asset_id: '' })} options={products.map(p => ({ value: p.id, label: p.name }))} /><Select label="Asset (valfritt)" value={blockForm.asset_id} onChange={e => setBlockForm({ ...blockForm, asset_id: e.target.value })} options={[{ value: '', label: 'Alla assets för produkten' }, ...assets.filter(a => a.product_id === blockForm.product_id).map(a => ({ value: a.id, label: a.name }))]} /><div className="grid gap-4 sm:grid-cols-2"><Input label="Start" type="datetime-local" value={blockForm.start_at} onChange={e => setBlockForm({ ...blockForm, start_at: e.target.value })} /><Input label="Slut" type="datetime-local" value={blockForm.end_at} onChange={e => setBlockForm({ ...blockForm, end_at: e.target.value })} /></div><Select label="Typ" value={blockForm.block_type} onChange={e => setBlockForm({ ...blockForm, block_type: e.target.value })} options={[{ value: 'internal_use', label: 'Intern användning' }, { value: 'maintenance', label: 'Service' }, { value: 'admin_block', label: 'Administrativ spärr' }, { value: 'unavailable', label: 'Otillgänglig' }]} /><Input label="Orsak" value={blockForm.reason} onChange={e => setBlockForm({ ...blockForm, reason: e.target.value })} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setBlockModal(false)}>Avbryt</Button><Button onClick={saveBlock} loading={saving}>Spara spärr</Button></div></div></Modal>

      <Modal open={bookingModal} onClose={() => setBookingModal(false)} title="Ny bokning"><div className="space-y-4"><Select label="Produkt" value={bookingForm.product_id} onChange={e => setBookingForm({ ...bookingForm, product_id: e.target.value })} options={products.map(p => ({ value: p.id, label: p.name }))} /><div className="grid gap-4 sm:grid-cols-2"><Input label="Start" type="datetime-local" value={bookingForm.start_at} onChange={e => setBookingForm({ ...bookingForm, start_at: e.target.value })} /><Input label="Slut" type="datetime-local" value={bookingForm.end_at} onChange={e => setBookingForm({ ...bookingForm, end_at: e.target.value })} /><Input label="Antal" type="number" min="1" value={bookingForm.quantity} onChange={e => setBookingForm({ ...bookingForm, quantity: e.target.value })} /><Input label="E-post" type="email" value={bookingForm.email} onChange={e => setBookingForm({ ...bookingForm, email: e.target.value })} /><Input label="Förnamn" value={bookingForm.first_name} onChange={e => setBookingForm({ ...bookingForm, first_name: e.target.value })} /><Input label="Efternamn" value={bookingForm.last_name} onChange={e => setBookingForm({ ...bookingForm, last_name: e.target.value })} /><Input label="Telefon" value={bookingForm.phone} onChange={e => setBookingForm({ ...bookingForm, phone: e.target.value })} /><Input label="Företag (valfritt)" value={bookingForm.company_name} onChange={e => setBookingForm({ ...bookingForm, company_name: e.target.value })} /></div><Textarea label="Kundanteckning" rows={3} value={bookingForm.customer_notes} onChange={e => setBookingForm({ ...bookingForm, customer_notes: e.target.value })} /><p className="text-xs text-slate-500">Pris och tillgänglighet räknas om och valideras på servern när bokningen sparas.</p><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setBookingModal(false)}>Avbryt</Button><Button onClick={saveBooking} loading={saving}>Skapa bokning</Button></div></div></Modal>

      <Modal open={customerModal} onClose={() => setCustomerModal(false)} title="Ny uthyrningskund"><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Input label="Förnamn" value={customerForm.first_name} onChange={e => setCustomerForm({ ...customerForm, first_name: e.target.value })} /><Input label="Efternamn" value={customerForm.last_name} onChange={e => setCustomerForm({ ...customerForm, last_name: e.target.value })} /><Input label="Företag" value={customerForm.company_name} onChange={e => setCustomerForm({ ...customerForm, company_name: e.target.value })} /><Input label="E-post" type="email" value={customerForm.email} onChange={e => setCustomerForm({ ...customerForm, email: e.target.value })} /><Input label="Telefon" value={customerForm.phone} onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })} /><Input label="Ort" value={customerForm.city} onChange={e => setCustomerForm({ ...customerForm, city: e.target.value })} /></div><Textarea label="Adress och anteckningar" rows={3} value={customerForm.address} onChange={e => setCustomerForm({ ...customerForm, address: e.target.value })} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCustomerModal(false)}>Avbryt</Button><Button onClick={saveCustomer} loading={saving}>Spara kund</Button></div></div></Modal>
    </div>
  );
}

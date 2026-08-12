import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Check, History, MapPin, Package, Plus, QrCode, ScanLine, ShoppingCart, Upload } from 'lucide-react';
import QRCode from 'qrcode';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../components/ui';

type Item = { id: string; article_number: string; name: string; category: string; supplier: string; barcode: string; qr_identifier: string; unit: string; purchase_price: number; minimum_stock: number; target_stock: number; reorder_quantity: number; notes: string; image_url: string; active: boolean };
type Location = { id: string; parent_location_id: string | null; name: string; type: string; code: string; active: boolean };
type Balance = { item_id: string; location_id: string; quantity: number };
type Tx = { id: string; item_id: string; quantity: number; transaction_type: string; source_location_id: string | null; destination_location_id: string | null; project_id: string | null; work_order_id: string | null; notes: string; created_at: string };
type Count = { id: string; name: string; location_id: string | null; category: string; status: string; started_at: string };
type CountLine = { id: string; count_id: string; item_id: string; location_id: string; expected_quantity: number; counted_quantity: number; difference: number };
type Form = { article_number: string; name: string; category: string; supplier: string; barcode: string; unit: string; purchase_price: string; minimum_stock: string; target_stock: string; reorder_quantity: string; image_url: string; notes: string };

const emptyForm: Form = { article_number: '', name: '', category: '', supplier: '', barcode: '', unit: 'st', purchase_price: '0', minimum_stock: '0', target_stock: '0', reorder_quantity: '0', image_url: '', notes: '' };
const locationTypes = [{ value: 'site', label: 'Plats' }, { value: 'warehouse', label: 'Lager' }, { value: 'room', label: 'Rum/förråd' }, { value: 'vehicle', label: 'Arbetsbil' }, { value: 'shelf', label: 'Hylla' }, { value: 'bin', label: 'Fack/låda' }, { value: 'other', label: 'Övrigt' }];

function formatNumber(value: number) { return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 3 }).format(value || 0); }
function locationPath(location: Location, locations: Location[]) {
  const parts: string[] = [];
  let current: Location | undefined = location;
  while (current && parts.length < 12) { parts.unshift(current.name); current = locations.find(item => item.id === current?.parent_location_id); }
  return parts.join(' / ');
}

export function InventoryPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [selectedCount, setSelectedCount] = useState<Count | null>(null);
  const [countModal, setCountModal] = useState(false);
  const [countForm, setCountForm] = useState({ name: '', location_id: '', category: '' });
  const [projects, setProjects] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'items' | 'locations' | 'counts' | 'transactions'>('overview');
  const [search, setSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const [itemModal, setItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [locationModal, setLocationModal] = useState(false);
  const [movementModal, setMovementModal] = useState(false);
  const [sessionMode, setSessionMode] = useState(false);
  const [sessionProject, setSessionProject] = useState('');
  const [labelItem, setLabelItem] = useState<Item | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [locationForm, setLocationForm] = useState({ name: '', type: 'warehouse', parent_location_id: '', code: '' });
  const [movement, setMovement] = useState({ item_id: '', quantity: '1', type: 'stock_out', source: '', destination: '', project: '', workOrder: '', notes: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    if (!user?.organisation_id) return;
    setLoading(true); setError('');
    const [itemsRes, locationsRes, balancesRes, txRes, countsRes, projectsRes, workOrdersRes] = await Promise.all([
      supabase.from('vihem_inventory_stock_items').select('*').eq('organisation_id', user.organisation_id).eq('active', true).order('name'),
      supabase.from('vihem_inventory_locations').select('*').eq('organisation_id', user.organisation_id).eq('active', true).order('name'),
      supabase.from('vihem_inventory_balances').select('item_id,location_id,quantity').eq('organisation_id', user.organisation_id),
      supabase.from('vihem_inventory_transactions').select('*').eq('organisation_id', user.organisation_id).order('created_at', { ascending: false }).limit(100),
      supabase.from('vihem_inventory_counts').select('*').eq('organisation_id', user.organisation_id).order('started_at', { ascending: false }).limit(30),
      supabase.from('vihem_customer_projects').select('*').eq('organisation_id', user.organisation_id).order('name'),
      supabase.from('vihem_work_orders').select('*').eq('organisation_id', user.organisation_id).order('created_at', { ascending: false }).limit(100),
    ]);
    const firstError = [itemsRes, locationsRes, balancesRes, txRes].find(result => result.error)?.error;
    if (firstError) setError(firstError.message);
    setItems((itemsRes.data || []) as Item[]); setLocations((locationsRes.data || []) as Location[]); setBalances((balancesRes.data || []) as Balance[]); setTransactions((txRes.data || []) as Tx[]); setCounts((countsRes.data || []) as Count[]);
    setProjects(projectsRes.data || []); setWorkOrders(workOrdersRes.data || []); setLoading(false);
  }
  useEffect(() => { load(); }, [user?.organisation_id]);

  const totals = useMemo(() => balances.reduce<Record<string, number>>((sum, row) => { sum[row.item_id] = (sum[row.item_id] || 0) + Number(row.quantity); return sum; }, {}), [balances]);
  const lowStock = useMemo(() => items.filter(item => Number(totals[item.id] || 0) <= Number(item.minimum_stock)), [items, totals]);
  const filteredItems = items.filter(item => `${item.name} ${item.article_number} ${item.barcode} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  const itemName = (id: string) => items.find(item => item.id === id)?.name || 'Okänd artikel';
  const locationName = (id: string | null) => id ? locationPath(locations.find(location => location.id === id) || { id, name: 'Okänd plats', parent_location_id: null, type: 'other', code: '', active: true }, locations) : '-';

  function openMovement(itemId = '') { setSessionMode(false); setSessionProject(''); setMovement({ item_id: itemId || items[0]?.id || '', quantity: '1', type: 'stock_out', source: balances.find(row => row.item_id === (itemId || items[0]?.id))?.location_id || locations[0]?.id || '', destination: locations[0]?.id || '', project: '', workOrder: '', notes: '' }); setError(''); setMessage(''); setMovementModal(true); }
  async function saveItem() {
    if (!user?.organisation_id || !isAdmin || !form.name.trim()) { setError('Ange ett artikelnamn.'); return; }
    const payload = { organisation_id: user.organisation_id, article_number: form.article_number.trim(), name: form.name.trim(), category: form.category.trim(), supplier: form.supplier.trim(), barcode: form.barcode.trim(), qr_identifier: form.barcode.trim() || crypto.randomUUID(), unit: form.unit.trim() || 'st', purchase_price: Number(form.purchase_price) || 0, minimum_stock: Number(form.minimum_stock) || 0, target_stock: Number(form.target_stock) || 0, reorder_quantity: Number(form.reorder_quantity) || 0, image_url: form.image_url.trim(), notes: form.notes.trim(), created_by: user.id };
    const result = editingItem
      ? await supabase.from('vihem_inventory_stock_items').update(payload).eq('id', editingItem.id)
      : await supabase.from('vihem_inventory_stock_items').insert(payload);
    if (result.error) { setError(result.error.message); return; } setItemModal(false); setEditingItem(null); setMessage(editingItem ? 'Artikel uppdaterad.' : 'Artikel skapad.'); await load();
  }
  async function uploadItemImage(file: File) {
    if (!user?.organisation_id) return;
    const path = `${user.organisation_id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const upload = await supabase.storage.from('vihem-inventory-images').upload(path, file, { upsert: false, contentType: file.type });
    if (upload.error) { setError(upload.error.message); return; }
    const imageUrl = supabase.storage.from('vihem-inventory-images').getPublicUrl(path).data.publicUrl;
    setForm(current => ({ ...current, image_url: imageUrl })); setMessage('Artikelbild uppladdad. Spara artikeln för att koppla bilden.');
  }
  async function saveLocation() {
    if (!user?.organisation_id || !isAdmin || !locationForm.name.trim()) { setError('Ange ett namn på lagerplatsen.'); return; }
    const { error: saveError } = await supabase.from('vihem_inventory_locations').insert({ organisation_id: user.organisation_id, name: locationForm.name.trim(), type: locationForm.type, parent_location_id: locationForm.parent_location_id || null, code: locationForm.code.trim(), created_by: user.id });
    if (saveError) { setError(saveError.message); return; } setLocationModal(false); setMessage('Lagerplats skapad.'); await load();
  }
  async function applyMovement() {
    if (!movement.item_id || Number(movement.quantity) <= 0) { setError('Välj artikel och ange ett antal större än noll.'); return; }
    const isIn = movement.type === 'stock_in' || movement.type === 'return';
    const isTransfer = movement.type === 'transfer';
    const { error: movementError } = await supabase.rpc('vihem_inventory_apply_transaction', { p_item_id: movement.item_id, p_quantity: Number(movement.quantity), p_transaction_type: movement.type, p_source_location_id: isIn ? null : movement.source || null, p_destination_location_id: (!isIn && !isTransfer) ? null : movement.destination || null, p_project_id: movement.project || null, p_work_order_id: movement.workOrder || null, p_other_reference: '', p_notes: movement.notes.trim() });
    if (movementError) { setError(movementError.message); return; }
    if (sessionMode && movement.type === 'stock_out') { setMovement(current => ({ ...current, item_id: '', quantity: '1', project: sessionProject || current.project, notes: '' })); setMessage('Materialet sparades. Scanna nästa artikel i samma session.'); await load(); return; }
    setMovementModal(false); setMessage('Lagerhändelsen sparades.'); await load();
  }
  async function startCount() {
    if (!user?.organisation_id || !countForm.name.trim()) { setError('Ange ett namn på inventeringen.'); return; }
    const { data, error: countError } = await supabase.from('vihem_inventory_counts').insert({ organisation_id: user.organisation_id, name: countForm.name.trim(), location_id: countForm.location_id || null, category: countForm.category.trim(), started_by: user.id }).select('*').single();
    if (countError) { setError(countError.message); return; }
    setCountModal(false); setSelectedCount(data as Count); setTab('counts'); setMessage('Inventering startad.'); await load();
  }
  async function recordCount(itemId: string, locationId: string, counted: string) {
    if (!selectedCount) return;
    const { error: countError } = await supabase.rpc('vihem_inventory_record_count', { p_count_id: selectedCount.id, p_item_id: itemId, p_location_id: locationId, p_counted_quantity: Number(counted) || 0 });
    if (countError) { setError(countError.message); return; }
    const { data } = await supabase.from('vihem_inventory_count_lines').select('*').eq('count_id', selectedCount.id).order('created_at');
    setCountLines((data || []) as CountLine[]); setMessage('Antalet sparades.');
  }
  async function approveCount(count: Count) {
    const { error: approveError } = await supabase.rpc('vihem_inventory_approve_count', { p_count_id: count.id });
    if (approveError) { setError(approveError.message); return; }
    setMessage('Inventeringen godkänd och differenserna bokförda.'); setSelectedCount(null); setCountLines([]); await load();
  }
  async function openCount(count: Count) {
    const { data, error: linesError } = await supabase.from('vihem_inventory_count_lines').select('*').eq('count_id', count.id).order('created_at');
    if (linesError) { setError(linesError.message); return; }
    setSelectedCount(count); setCountLines((data || []) as CountLine[]); setTab('counts');
  }
  async function printLocationLabel(location: Location) {
    const data = await QRCode.toDataURL(`${window.location.origin}/inventory?location=${location.id}`, { width: 160, margin: 1 });
    const popup = window.open('', '_blank'); if (!popup) return;
    popup.document.write(`<html><head><title>${location.name}</title><style>body{font-family:Arial;text-align:center;padding:24px}.label{width:260px;border:1px solid #ddd;padding:16px}img{width:150px}small{display:block;color:#475569;margin-top:8px}</style></head><body><div class="label"><strong>${location.name}</strong><small>${locationPath(location, locations)}</small><img src="${data}" /><small>VI-HEM lagerplats</small></div><script>window.print()</script></body></html>`); popup.document.close();
  }
  async function addToPurchaseList(item: Item) {
    if (!user?.organisation_id) return;
    const quantity = Number(item.target_stock) > Number(totals[item.id] || 0) ? Number(item.target_stock) - Number(totals[item.id] || 0) : Number(item.reorder_quantity || 0);
    const { data: existing } = await supabase.from('vihem_purchase_items').select('id,quantity').eq('organisation_id', user.organisation_id).eq('status', 'open').ilike('item_name', item.name).maybeSingle();
    const result = existing ? await supabase.from('vihem_purchase_items').update({ quantity: String(quantity || 1), notes: `Lågt lagersaldo (${formatNumber(Number(totals[item.id] || 0))} ${item.unit})` }).eq('id', existing.id) : await supabase.from('vihem_purchase_items').insert({ organisation_id: user.organisation_id, store_name: item.supplier || 'Övrigt', item_name: item.name, quantity: String(quantity || 1), notes: `Lågt lagersaldo (${formatNumber(Number(totals[item.id] || 0))} ${item.unit})`, priority: 'normal', created_by: user.id });
    if (result.error) setError(result.error.message); else setMessage('Artikeln lades på inköpslistan.');
  }
  async function scanImage(file: File) {
    if (!('BarcodeDetector' in window)) { setMessage('Kameran öppnades. Ange streckkoden i sökfältet om webbläsaren saknar streckkodsläsning.'); return; }
    try { const detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39'] }); const image = new Image(); image.src = URL.createObjectURL(file); await image.decode(); const codes = await detector.detect(image); if (codes[0]?.rawValue) { setBarcode(codes[0].rawValue); setSearch(codes[0].rawValue); setMessage(`Scannad kod: ${codes[0].rawValue}`); } else setMessage('Ingen kod hittades.'); } catch { setMessage('Kunde inte läsa koden från bilden.'); }
  }
  async function printLabel(item: Item) {
    const data = await QRCode.toDataURL(`${window.location.origin}/inventory?item=${item.id}`, { width: 160, margin: 1 });
    const popup = window.open('', '_blank'); if (!popup) return;
    popup.document.write(`<html><head><title>${item.name}</title><style>body{font-family:Arial;text-align:center;padding:24px}.label{width:260px;border:1px solid #ddd;padding:16px}img{width:150px}small{display:block;color:#475569;margin-top:8px}</style></head><body><div class="label"><strong>${item.name}</strong><small>${item.article_number || 'Saknar artikelnummer'}</small><img src="${data}" /><small>${item.unit} · VI-HEM lager</small></div><script>window.print()</script></body></html>`); popup.document.close();
  }

  if (loading) return <LoadingPage />;
  return <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <Modal open={countModal} onClose={() => setCountModal(false)} title="Starta inventering"><div className="space-y-4"><Input label="Namn" value={countForm.name} onChange={event => setCountForm({...countForm, name:event.target.value})} placeholder="Exempelvis Stora lagret augusti" /><Select label="Lagerplats (valfritt)" options={[{ value:'', label:'Alla lagerplatser' }, ...locations.map(location => ({ value:location.id, label:locationPath(location, locations) }))]} value={countForm.location_id} onChange={event => setCountForm({...countForm, location_id:event.target.value})} /><Input label="Kategori (valfritt)" value={countForm.category} onChange={event => setCountForm({...countForm, category:event.target.value})} /></div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setCountModal(false)}>Avbryt</Button><Button onClick={startCount}>Starta</Button></div></Modal>
    {tab === 'counts' && <Card className="mb-5 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Inventering</h2><p className="text-sm text-slate-500">Räkna och godkänn differenser spårbart.</p></div>{isAdmin && <Button onClick={() => { setCountForm({ name:'', location_id:'', category:'' }); setCountModal(true); }}><Plus className="h-4 w-4" /> Starta inventering</Button>}</div>{selectedCount ? <div className="mt-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"><div><p className="font-semibold">{selectedCount.name}</p><p className="text-sm text-slate-500">{selectedCount.location_id ? locationName(selectedCount.location_id) : 'Alla lagerplatser'} · {selectedCount.status === 'approved' ? 'Godkänd' : 'Pågår'}</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setSelectedCount(null)}>Till listan</Button>{isAdmin && selectedCount.status === 'open' && <Button size="sm" onClick={() => approveCount(selectedCount)}><Check className="h-4 w-4" /> Godkänn</Button>}</div></div>{balances.filter(row => !selectedCount.location_id || row.location_id === selectedCount.location_id).map(row => { const item = items.find(candidate => candidate.id === row.item_id); const line = countLines.find(candidate => candidate.item_id === row.item_id && candidate.location_id === row.location_id); return item ? <div key={item.id + row.location_id} className="grid gap-2 border-b border-slate-100 py-3 sm:grid-cols-[1fr_160px_140px] sm:items-center"><div><p className="font-medium">{item.name}</p><p className="text-xs text-slate-500">{locationName(row.location_id)} · saldo {formatNumber(row.quantity)} {item.unit}</p></div><Input aria-label={'Räknat antal ' + item.name} type="number" step="0.001" defaultValue={line ? String(line.counted_quantity) : ''} placeholder="Räknat antal" onBlur={event => recordCount(item.id, row.location_id, event.target.value)} /><Badge className={line && line.difference !== 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}>{line ? 'Differens ' + formatNumber(line.difference) : 'Ej räknad'}</Badge></div> : null; })}</div> : <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">{counts.length ? counts.map(count => <div key={count.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold">{count.name}</p><p className="text-sm text-slate-500">{count.status === 'approved' ? 'Godkänd' : 'Pågår'} · {new Date(count.started_at).toLocaleDateString('sv-SE')}</p></div><Button size="sm" variant="outline" onClick={() => openCount(count)}>Öppna</Button></div>) : <EmptyState title="Ingen inventering ännu" description="Starta en inventering för att räkna saldon." />}</div>}</Card>}
    <PageHeader title="Lager" subtitle="Material, lagerplatser och spårbara uttag i organisationen." icon={Package} action={<div className="flex flex-wrap gap-2"><Button onClick={() => openMovement()}><ScanLine className="h-4 w-4" /> Scanna / registrera</Button>{isAdmin && <Button variant="secondary" onClick={() => { setEditingItem(null); setForm(emptyForm); setError(''); setItemModal(true); }}><Plus className="h-4 w-4" /> Ny artikel</Button>}</div>} />
    {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}{message && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}
    <div className="mb-5 flex flex-wrap gap-2">{[['overview','Översikt'],['items','Artiklar'],['locations','Lagerplatser'],['counts','Inventering'],['transactions','Historik']].map(([value,label]) => <Button key={value} variant={tab === value ? 'primary' : 'secondary'} size="sm" onClick={() => setTab(value as typeof tab)}>{label}</Button>)}</div>
    {tab === 'overview' && <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Card className="p-4"><p className="text-xs font-semibold uppercase text-slate-500">Artiklar</p><p className="mt-2 text-2xl font-bold">{items.length}</p></Card><Card className="p-4"><p className="text-xs font-semibold uppercase text-slate-500">Lagerplatser</p><p className="mt-2 text-2xl font-bold">{locations.length}</p></Card><Card className="p-4"><p className="text-xs font-semibold uppercase text-slate-500">Lågt saldo</p><p className="mt-2 text-2xl font-bold text-amber-600">{lowStock.length}</p></Card><Card className="p-4"><p className="text-xs font-semibold uppercase text-slate-500">Rörelser</p><p className="mt-2 text-2xl font-bold">{transactions.length}</p></Card></div><Card className="p-5"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">Behöver beställas</h2><p className="text-sm text-slate-500">Lägg förslag på den gemensamma inköpslistan.</p></div><Button variant="secondary" size="sm" onClick={() => lowStock.forEach(addToPurchaseList)} disabled={!lowStock.length}><ShoppingCart className="h-4 w-4" /> Lägg alla på inköpslista</Button></div>{lowStock.length ? <div className="divide-y divide-slate-100">{lowStock.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{item.name}</p><p className="text-sm text-slate-500">Saldo {formatNumber(totals[item.id] || 0)} {item.unit} · minimum {formatNumber(item.minimum_stock)} {item.unit}</p></div><Button size="sm" variant="outline" onClick={() => addToPurchaseList(item)}><ShoppingCart className="h-4 w-4" /> Köp {formatNumber(Math.max(Number(item.target_stock) - Number(totals[item.id] || 0), Number(item.reorder_quantity || 0)) || 1)}</Button></div>)}</div> : <EmptyState title="Inga saldovarningar" description="Alla artiklar ligger över miniminivån." />}</Card></div>}
    {tab === 'items' && <Card className="overflow-hidden"><div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Sök namn, artikelnummer eller streckkod" className="min-w-[240px] flex-1" /><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><Upload className="h-4 w-4" /> Scanna bild<input className="hidden" type="file" accept="image/*" capture="environment" onChange={e => e.target.files?.[0] && scanImage(e.target.files[0])} /></label></div><div className="divide-y divide-slate-100">{filteredItems.length ? filteredItems.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="font-semibold text-slate-900">{item.name}</p><p className="text-sm text-slate-500">{item.article_number || 'Saknar artikelnummer'} · {item.category || 'Okategoriserad'} · {item.supplier || 'Ingen leverantör'}</p><p className="mt-1 text-sm">Totalt saldo: <strong>{formatNumber(totals[item.id] || 0)} {item.unit}</strong></p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => openMovement(item.id)}><ArrowRightLeft className="h-4 w-4" /> Uttag</Button><Button size="sm" variant="outline" onClick={() => printLabel(item)}><QrCode className="h-4 w-4" /> Etikett</Button>{isAdmin && <Button size="sm" variant="ghost" onClick={() => { setEditingItem(item); setForm({ article_number:item.article_number,name:item.name,category:item.category,supplier:item.supplier,barcode:item.barcode,unit:item.unit,purchase_price:String(item.purchase_price),minimum_stock:String(item.minimum_stock),target_stock:String(item.target_stock),reorder_quantity:String(item.reorder_quantity),image_url:item.image_url || '',notes:item.notes }); setItemModal(true); }}><Check className="h-4 w-4" /> Redigera</Button>}</div></div>) : <EmptyState title="Inga lagerartiklar" description="Skapa den första artikeln eller ändra sökningen." />}</div></Card>}
    {tab === 'locations' && <Card className="overflow-hidden"><div className="flex justify-end border-b border-slate-200 p-4">{isAdmin && <Button onClick={() => { setLocationForm({ name:'', type:'warehouse', parent_location_id:'', code:'' }); setLocationModal(true); }}><Plus className="h-4 w-4" /> Ny lagerplats</Button>}</div><div className="divide-y divide-slate-100">{locations.length ? locations.map(location => <div key={location.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><MapPin className="h-5 w-5 text-blue-600" /><div><p className="font-semibold">{locationPath(location, locations)}</p><p className="text-xs text-slate-500">{locationTypes.find(type => type.value === location.type)?.label || location.type} {location.code && `· ${location.code}`}</p></div></div><Button size="sm" variant="outline" onClick={() => printLocationLabel(location)}><QrCode className="h-4 w-4" /> Etikett</Button></div>) : <EmptyState title="Inga lagerplatser" description="Skapa exempelvis ett lager, en hylla eller en arbetsbil." />}</div></Card>}
    {tab === 'transactions' && <Card className="overflow-hidden"><div className="divide-y divide-slate-100">{transactions.length ? transactions.map(tx => <div key={tx.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold">{itemName(tx.item_id)} · {formatNumber(tx.quantity)}</p><p className="text-sm text-slate-500">{tx.transaction_type} · {locationName(tx.source_location_id)} → {locationName(tx.destination_location_id)}</p><p className="text-xs text-slate-400">{new Date(tx.created_at).toLocaleString('sv-SE')} {tx.notes && `· ${tx.notes}`}</p></div><History className="h-5 w-5 text-slate-400" /></div>) : <EmptyState title="Ingen historik ännu" description="När material tas ut eller läggs in visas det här." />}</div></Card>}
    <Modal open={itemModal} onClose={() => { setItemModal(false); setEditingItem(null); }} title={editingItem ? "Redigera lagerartikel" : "Ny lagerartikel"} size="lg"><div className="grid gap-4 sm:grid-cols-2"><Input label="Namn" value={form.name} onChange={e => setForm({...form,name:e.target.value})} /><Input label="Internt artikelnummer" value={form.article_number} onChange={e => setForm({...form,article_number:e.target.value})} /><Input label="Kategori" value={form.category} onChange={e => setForm({...form,category:e.target.value})} /><Input label="Leverantör" value={form.supplier} onChange={e => setForm({...form,supplier:e.target.value})} /><Input label="Streckkod" value={form.barcode} onChange={e => setForm({...form,barcode:e.target.value})} /><Input label="Bild-URL (valfritt)" value={form.image_url} onChange={e => setForm({...form,image_url:e.target.value})} placeholder="https://..." /><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"><Upload className="h-4 w-4" /> Ladda upp bild<input className="hidden" type="file" accept="image/*" capture="environment" onChange={event => event.target.files?.[0] && uploadItemImage(event.target.files[0])} /></label><Input label="Enhet" value={form.unit} onChange={e => setForm({...form,unit:e.target.value})} /><Input label="Inköpspris" type="number" step="0.01" value={form.purchase_price} onChange={e => setForm({...form,purchase_price:e.target.value})} /><Input label="Minsta saldo" type="number" step="0.001" value={form.minimum_stock} onChange={e => setForm({...form,minimum_stock:e.target.value})} /><Input label="Målsaldo" type="number" step="0.001" value={form.target_stock} onChange={e => setForm({...form,target_stock:e.target.value})} /><Input label="Beställningsmängd" type="number" step="0.001" value={form.reorder_quantity} onChange={e => setForm({...form,reorder_quantity:e.target.value})} /></div><Textarea className="mt-4" label="Anteckningar" value={form.notes} onChange={e => setForm({...form,notes:e.target.value})} /><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setItemModal(false)}>Avbryt</Button><Button onClick={saveItem}>Spara artikel</Button></div></Modal>
    <Modal open={locationModal} onClose={() => setLocationModal(false)} title="Ny lagerplats"><div className="space-y-4"><Input label="Namn" value={locationForm.name} onChange={e => setLocationForm({...locationForm,name:e.target.value})} /><Select label="Typ" options={locationTypes} value={locationForm.type} onChange={e => setLocationForm({...locationForm,type:e.target.value})} /><Select label="Överordnad plats" options={[{value:'',label:'Ingen, översta nivå'},...locations.map(location => ({value:location.id,label:locationPath(location,locations)}))]} value={locationForm.parent_location_id} onChange={e => setLocationForm({...locationForm,parent_location_id:e.target.value})} /><Input label="Kod" value={locationForm.code} onChange={e => setLocationForm({...locationForm,code:e.target.value})} /></div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setLocationModal(false)}>Avbryt</Button><Button onClick={saveLocation}>Spara plats</Button></div></Modal>
    <Modal open={movementModal} onClose={() => setMovementModal(false)} title="Scanna / registrera material" size="lg"><div className="space-y-4"><div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800"><ScanLine className="mr-2 inline h-4 w-4" /> Scanna artikel med kameran eller skriv streckkoden i listan över artiklar.</div><Input label="Streckkod" value={barcode} onChange={e => { setBarcode(e.target.value); const match = items.find(item => item.barcode === e.target.value); if (match) setMovement({...movement,item_id:match.id}); }} placeholder="EAN/QR-kod" /><Select label="Artikel" options={items.map(item => ({value:item.id,label:`${item.name} (${formatNumber(totals[item.id] || 0)} ${item.unit})`}))} value={movement.item_id} onChange={e => setMovement({...movement,item_id:e.target.value})} /><div className="grid gap-4 sm:grid-cols-2"><Select label="Händelse" options={[{value:'stock_out',label:'Ta ut material'},{value:'stock_in',label:'Inleverans'},{value:'return',label:'Återlämna'},{value:'transfer',label:'Flytta'}]} value={movement.type} onChange={e => setMovement({...movement,type:e.target.value})} /><Input label="Antal" type="number" min="0.001" step="0.001" value={movement.quantity} onChange={e => setMovement({...movement,quantity:e.target.value})} /></div>{movement.type !== 'stock_in' && movement.type !== 'return' && <Select label="Från lagerplats" options={locations.map(location => ({value:location.id,label:locationPath(location,locations)}))} value={movement.source} onChange={e => setMovement({...movement,source:e.target.value})} />}{movement.type !== 'stock_out' && <Select label="Till lagerplats" options={locations.map(location => ({value:location.id,label:locationPath(location,locations)}))} value={movement.destination} onChange={e => setMovement({...movement,destination:e.target.value})} />}<label className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm"><input type="checkbox" checked={sessionMode} onChange={event => setSessionMode(event.target.checked)} /> Fortsätt i materialsession</label>{sessionMode && <Select label="Projekt för hela sessionen" options={[{value:'',label:'Inget projekt'},...projects.map(project => ({value:project.id,label:project.name || project.title || 'Projekt'}))]} value={sessionProject} onChange={event => { setSessionProject(event.target.value); setMovement({...movement, project:event.target.value}); }} />}{movement.type === 'stock_out' && <div className="grid gap-4 sm:grid-cols-2"><Select label="Projekt (valfritt)" options={[{value:'',label:'Inget projekt'},...projects.map(project => ({value:project.id,label:project.name || project.title || 'Projekt'}))]} value={movement.project} onChange={e => setMovement({...movement,project:e.target.value})} /><Select label="Arbetsorder (valfritt)" options={[{value:'',label:'Ingen arbetsorder'},...workOrders.map(order => ({value:order.id,label:order.title || 'Arbetsorder'}))]} value={movement.workOrder} onChange={e => setMovement({...movement,workOrder:e.target.value})} /></div>}<Textarea label="Notering" value={movement.notes} onChange={e => setMovement({...movement,notes:e.target.value})} /></div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setMovementModal(false)}>Avbryt</Button><Button onClick={applyMovement}>Bekräfta</Button></div></Modal>
  </div>;
}

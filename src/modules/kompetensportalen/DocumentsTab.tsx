import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Card, EmptyState, Input, Select, StatusBadge } from '../../components/ui';
import { TabProps } from './KompetensportalenPage';
import { clean, db, dOnly, downloadCsv, kpAdmin, money, rowsToCsv } from './api';

type Doc = { key: string; type: 'receipt' | 'credit_receipt' | 'invoice'; number: string; date: string; order: string; customer: string; amount: number; status: string; statusTone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; receiptId?: string; detail: string };
const TYPE_LABEL: Record<string, string> = { receipt: 'Kvitto', credit_receipt: 'Kreditkvitto', invoice: 'Faktura' };
const INVOICE_STATUS: Record<string, string> = { draft: 'Utkast', sent: 'Skickad', paid: 'Betald', credited: 'Krediterad', overdue: 'Förfallen', needs_action: 'Kräver åtgärd', void: 'Makulerad' };

/** Samlar alla kvitton (kortbetalningar, kreditkvitton) och fakturor (via Accounted) som hör till Kompetensportalen på ett ställe. */
export function DocumentsTab(_p: TabProps) {
  const [docs, setDocs] = useState<Doc[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [type, setType] = useState(''); const [q, setQ] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const [r, o] = await Promise.all([
      db.from('vihem_kp_receipts').select('id,kind,receipt_number,issued_at,total,buyer_name,buyer_email,payment_reference,pdf_path,emailed_at,order:vihem_kp_orders(order_number,customer:vihem_kp_customers(name))').order('issued_at', { ascending: false }).limit(1000),
      db.from('vihem_kp_orders').select('id,order_number,created_at,total,invoice_status,invoice_link_id,contact_email,payment_method,customer:vihem_kp_customers(name)').eq('payment_method', 'invoice').order('created_at', { ascending: false }).limit(1000),
    ]);
    const linkIds = (o.data || []).map((x: any) => x.invoice_link_id).filter(Boolean);
    const links = linkIds.length ? (await db.from('vihem_accounted_invoice_links').select('id,accounted_invoice_number,invoice_date,due_date,status,total,remaining_amount').in('id', linkIds)).data || [] : [];
    const lm = new Map<string, any>(links.map((l: any) => [l.id, l]));
    const rows: Doc[] = [];
    for (const x of r.data || []) { const ord: any = Array.isArray(x.order) ? x.order[0] : x.order; const cust: any = ord && (Array.isArray(ord.customer) ? ord.customer[0] : ord.customer);
      rows.push({ key: `r-${x.id}`, type: x.kind, number: x.receipt_number, date: x.issued_at, order: ord?.order_number ?? '', customer: cust?.name || x.buyer_name || x.buyer_email, amount: Number(x.total) * (x.kind === 'credit_receipt' ? -1 : 1), status: x.pdf_path ? (x.emailed_at ? 'Skickat' : 'Ej skickat') : 'PDF skapas', statusTone: x.pdf_path && x.emailed_at ? 'success' : 'warning', receiptId: x.id, detail: x.payment_reference ?? '' }); }
    for (const x of o.data || []) { const cust: any = Array.isArray(x.customer) ? x.customer[0] : x.customer; const l = x.invoice_link_id ? lm.get(x.invoice_link_id) : null;
      const st = l?.status ?? x.invoice_status ?? 'needs_action';
      rows.push({ key: `i-${x.id}`, type: 'invoice', number: l?.accounted_invoice_number ?? '(ej skapad)', date: l?.invoice_date ?? x.created_at, order: x.order_number, customer: cust?.name || x.contact_email, amount: Number(l?.total ?? x.total), status: INVOICE_STATUS[st] ?? st, statusTone: st === 'paid' ? 'success' : st === 'credited' || st === 'void' ? 'neutral' : st === 'overdue' || st === 'needs_action' ? 'danger' : 'warning', detail: l?.due_date ? `Förfaller ${dOnly(l.due_date)}${l.remaining_amount != null ? ` · kvar ${money(l.remaining_amount, 2)}` : ''}` : (l ? '' : 'Kräver åtgärd under Ordrar → Fakturor') }); }
    rows.sort((a, b) => b.date.localeCompare(a.date)); setDocs(rows); setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const list = useMemo(() => docs.filter(d => (!type || d.type === type) && (!from || d.date.slice(0, 10) >= from) && (!to || d.date.slice(0, 10) <= to) && (!q || `${d.number} ${d.order} ${d.customer}`.toLowerCase().includes(q.toLowerCase()))), [docs, type, q, from, to]);
  const open = async (id: string) => { setBusy(id); setError(''); try { const r = await kpAdmin<{ url: string }>('receipt_pdf', { receipt_id: id }); window.open(r.url, '_blank', 'noopener'); } catch (e) { setError(clean((e as Error).message)); } setBusy(''); };
  const sum = (t: string) => list.filter(d => d.type === t).reduce((s, d) => s + d.amount, 0);
  const exportCsv = () => downloadCsv(rowsToCsv(['Typ', 'Nummer', 'Datum', 'Order', 'Kund', 'Belopp (SEK, inkl. moms)', 'Status', 'Referens'], list.map(d => [TYPE_LABEL[d.type], d.number, d.date.slice(0, 10), d.order, d.customer, d.amount.toFixed(2).replace('.', ','), d.status, d.detail])), `kvitton-och-fakturor-${new Date().toISOString().slice(0, 10)}.csv`);
  if (loading) return <p className="text-sm text-slate-500">Laddar…</p>;
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3"><Card className="p-3"><p className="text-xs text-slate-500">Kvitton (kort)</p><p className="text-lg font-semibold">{money(sum('receipt'), 2)}</p></Card><Card className="p-3"><p className="text-xs text-slate-500">Kreditkvitton</p><p className="text-lg font-semibold">{money(sum('credit_receipt'), 2)}</p></Card><Card className="p-3"><p className="text-xs text-slate-500">Fakturor (Accounted)</p><p className="text-lg font-semibold">{money(sum('invoice'), 2)}</p></Card></div>
    <div className="flex flex-wrap items-end gap-3"><Select label="Typ" value={type} onChange={e => setType(e.target.value)} options={[{ value: '', label: 'Alla' }, { value: 'receipt', label: 'Kvitton' }, { value: 'credit_receipt', label: 'Kreditkvitton' }, { value: 'invoice', label: 'Fakturor' }]} /><Input label="Från" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input label="Till" type="date" value={to} onChange={e => setTo(e.target.value)} /><Input label="Sök nummer, order eller kund" value={q} onChange={e => setQ(e.target.value)} /><Button className="ml-auto" variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" /> Exportera CSV</Button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!list.length ? <EmptyState title="Inga kvitton eller fakturor" description="Kvitton skapas automatiskt för varje kortbetalning och skickas till köparen. Fakturor för företagsköp skapas via Accounted när en order godkänns." /> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th className="p-2">Typ</th><th>Nummer</th><th>Datum</th><th>Order</th><th>Kund</th><th className="text-right">Belopp</th><th>Status</th><th /></tr></thead><tbody>
        {list.map(d => <tr key={d.key} className="border-t border-slate-100 align-top"><td className="p-2">{TYPE_LABEL[d.type]}</td><td className="font-medium">{d.number}</td><td>{dOnly(d.date)}</td><td>{d.order}</td><td>{d.customer}</td><td className="text-right">{money(d.amount, 2)}</td><td><StatusBadge tone={d.statusTone}>{d.status}</StatusBadge>{d.detail && <p className="text-xs text-slate-500">{d.detail}</p>}</td><td className="p-2 text-right">{d.receiptId && <Button size="sm" variant="secondary" loading={busy === d.receiptId} onClick={() => open(d.receiptId!)}>Öppna PDF</Button>}</td></tr>)}</tbody></table></div>}
    <p className="text-xs text-slate-500">Kvitton är oföränderliga och skapas av systemet. Fakturor skapas, krediteras och bokförs i Accounted – här visas deras nummer, förfallodag och betalstatus.</p></div>;
}

import { useEffect, useState } from 'react';
import { Button, Card, Input, StatusBadge } from '../../components/ui';
import { TabProps } from './KompetensportalenPage';
import { db, downloadCsv, kpAdmin, money, rowsToCsv, STATUS_LABEL, tone, clean } from './api';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function OverviewTab({ isAdmin }: TabProps) {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), 0, 1)));
  const [to, setTo] = useState(iso(today));
  const [data, setData] = useState<any>(null);
  const [caps, setCaps] = useState<any>(null);
  const [error, setError] = useState('');
  const load = async () => { setError(''); const { data, error } = await db.rpc('vihem_kp_overview', { p_from: from, p_to: to }); if (error) setError(clean(error.message)); else setData(data); };
  useEffect(() => { void load(); }, [from, to]);
  useEffect(() => { kpAdmin('capabilities').then(setCaps).catch(() => {}); }, []);
  const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
  const exportRows = (name: string, headers: string[], rows: any[][]) => downloadCsv(rowsToCsv(headers, rows), `kompetensportalen-${name}-${from}-${to}.csv`);
  if (error) return <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Laddar…</p>;
  const ordered = sum(data.orders_by_month, 'gross'), received = sum(data.received_by_month, 'received'), refunded = sum(data.refunded_by_month, 'refunded');
  const stat = (label: string, value: string | number, hint?: string) => <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>;
  const dep = (ok: boolean | undefined, label: string, note: string) => <li className="flex items-start justify-between gap-3"><span>{label}<span className="block text-xs text-slate-500">{note}</span></span><StatusBadge tone={ok ? 'success' : 'warning'}>{ok ? 'OK' : 'Saknas'}</StatusBadge></li>;
  return (
    <div className="space-y-5">
      {caps && isAdmin && (caps.stripe_key_present === false || !caps.accounted_linked || !caps.pii_key_present || !caps.mail_sender) && (
        <Card className="space-y-2 p-4"><h2 className="font-semibold">Driftklarhet</h2><ul className="space-y-2 text-sm">
          {dep(caps.stripe, 'Stripe-betalning', caps.stripe_key_present ? 'Nycklar finns – slå på "Kortbetalning aktiv" i Inställningar.' : 'Stripe-nycklar saknas på servern (se apps/kompetensportalen/deploy).')}
          {dep(caps.accounted_linked, 'Fakturering via Accounted', caps.accounted_linked ? 'WPE Sweden AB är kopplat.' : 'WPE Sweden AB är inte kopplat till Accounted i VI-HEM Ekonomi – fakturaköp kan inte faktureras automatiskt.')}
          {dep(caps.mail_sender || caps.smtp_available, 'E-postutskick', caps.mail_sender ? 'Avsändaradress satt.' : 'Ange avsändaradress i Inställningar (Google Workspace) – annars används SMTP-reserv.')}
          {dep(caps.pii_key_present, 'Kryptering av personnummer', caps.pii_key_present ? 'Nyckel finns.' : 'Krypteringsnyckel saknas – personnummer kan inte sparas.')}
        </ul></Card>)}
      <div className="flex flex-wrap items-end gap-3"><Input label="Från" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input label="Till" type="date" value={to} onChange={e => setTo(e.target.value)} /><Button variant="secondary" onClick={load}>Uppdatera</Button></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat('Ordervärde (inkl. moms)', money(ordered), 'Skapade ordrar – inte inbetalt')}{stat('Mottagna betalningar', money(received), 'Faktiskt inbetalt')}{stat('Återbetalt', money(refunded))}{stat('Öppna fakturor', data.invoices_open, 'Ej betalda fakturaordrar')}
        {stat('Sålda platser', data.seats.sold)}{stat('Oanvända platser', data.seats.unused)}{stat('Påbörjade', data.learning.started)}{stat('Genomförda', data.learning.completed)}
        {stat('Prov godkända', data.learning.exams_passed)}{stat('Prov underkända', data.learning.exams_failed)}{stat('Intyg som snart löper ut', data.certificates_expiring, 'Inom 90 dagar')}{stat('ID06 väntar/kräver åtgärd', (data.id06.pending ?? 0) + (data.id06.needs_action ?? 0) + (data.id06.failed ?? 0))}
      </div>
      <Card className="p-4"><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Månad för månad</h2><Button size="sm" variant="secondary" onClick={() => exportRows('manader', ['Månad', 'Ordrar', 'Netto', 'Moms', 'Brutto', 'Mottaget', 'Återbetalt'], data.orders_by_month.map((m: any) => [m.month, m.orders, m.net, m.vat, m.gross, data.received_by_month.find((r: any) => r.month === m.month)?.received ?? 0, data.refunded_by_month.find((r: any) => r.month === m.month)?.refunded ?? 0]))}>Exportera CSV</Button></div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500"><th>Månad</th><th>Ordrar</th><th>Netto</th><th>Moms</th><th>Ordervärde</th><th>Mottaget</th><th>Återbetalt</th></tr></thead><tbody>{data.orders_by_month.map((m: any) => <tr key={m.month} className="border-t border-slate-100"><td className="py-1.5">{m.month}</td><td>{m.orders}</td><td>{money(m.net)}</td><td>{money(m.vat)}</td><td>{money(m.gross)}</td><td>{money(data.received_by_month.find((r: any) => r.month === m.month)?.received)}</td><td>{money(data.refunded_by_month.find((r: any) => r.month === m.month)?.refunded)}</td></tr>)}</tbody></table></div>
        <p className="mt-2 text-xs text-slate-500">Ordervärde och mottagna betalningar redovisas separat: en faktura räknas som ordervärde tills den är betald.</p></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4"><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Omsättning per kurs (netto)</h2><Button size="sm" variant="secondary" onClick={() => exportRows('kurser', ['Kurs', 'Kod', 'Platser', 'Netto'], data.revenue_by_course.map((c: any) => [c.course, c.code, c.seats, c.net]))}>CSV</Button></div>
          <table className="w-full text-sm"><tbody>{data.revenue_by_course.map((c: any) => <tr key={c.code} className="border-t border-slate-100"><td className="py-1.5">{c.course}</td><td className="text-right text-slate-500">{c.seats} pl.</td><td className="text-right">{money(c.net)}</td></tr>)}{!data.revenue_by_course.length && <tr><td className="py-2 text-slate-500">Ingen försäljning i perioden.</td></tr>}</tbody></table></Card>
        <Card className="p-4"><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Försäljning per företagskund (netto)</h2><Button size="sm" variant="secondary" onClick={() => exportRows('foretag', ['Företag', 'Ordrar', 'Netto'], data.revenue_by_customer.map((c: any) => [c.customer, c.orders, c.net]))}>CSV</Button></div>
          <table className="w-full text-sm"><tbody>{data.revenue_by_customer.map((c: any) => <tr key={c.customer} className="border-t border-slate-100"><td className="py-1.5">{c.customer}</td><td className="text-right text-slate-500">{c.orders} ordrar</td><td className="text-right">{money(c.net)}</td></tr>)}{!data.revenue_by_customer.length && <tr><td className="py-2 text-slate-500">Inga företagsköp i perioden.</td></tr>}</tbody></table></Card>
      </div>
      <Card className="p-4"><h2 className="mb-2 font-semibold">Orderstatus i perioden</h2><div className="flex flex-wrap gap-2">{Object.entries(data.order_status).map(([s, n]) => <StatusBadge key={s} tone={tone(s)}>{STATUS_LABEL[s] ?? s}: {n as number}</StatusBadge>)}{!Object.keys(data.order_status).length && <span className="text-sm text-slate-500">Inga ordrar.</span>}</div></Card>
      {isAdmin && <Card className="space-y-2 p-4"><h2 className="font-semibold">Export</h2><p className="text-sm text-slate-500">CSV öppnas direkt i Excel. Exporterna loggas.</p><div className="flex flex-wrap gap-2">{['orders:Ordrar', 'participants:Deltagare', 'enrollments:Utbildningar', 'certificates:Certifikat'].map(x => { const [k, l] = x.split(':'); return <Button key={k} size="sm" variant="secondary" onClick={async () => { const r = await kpAdmin('export', { kind: k, from, to }); downloadCsv(r.csv, r.filename); }}>{l}</Button>; })}</div></Card>}
    </div>
  );
}

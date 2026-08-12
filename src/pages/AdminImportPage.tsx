import React, { useMemo, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, Download, FileSpreadsheet, Home, Upload, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { createUserAccount } from '../lib/userAdmin';
import { Button, Card, EmptyState, PageHeader } from '../components/ui';

type ImportKind = 'properties' | 'apartments' | 'tenants';
type ImportRow = Record<string, string>;
type ImportResult = { row: number; status: 'created' | 'skipped' | 'error'; message: string; credentials?: { email: string; password: string } };

const columns: Record<ImportKind, string[]> = {
  properties: ['name', 'address', 'city', 'zip', 'description'],
  apartments: ['property_name', 'property_address', 'apartment_number', 'size', 'rooms', 'rent', 'floor', 'status'],
  tenants: ['name', 'email', 'phone', 'property_name', 'apartment_number', 'start_date', 'monthly_rent'],
};

const labels: Record<ImportKind, { title: string; description: string; icon: typeof Building2 }> = {
  properties: { title: 'Fastigheter', description: 'name, address, city och zip krävs.', icon: Building2 },
  apartments: { title: 'Lägenheter', description: 'property_name och apartment_number krävs. Fastigheten måste redan finnas.', icon: Home },
  tenants: { title: 'Hyresgäster', description: 'name och email krävs. Lägenhet och hyresförhållande är valfria.', icon: Users },
};

const templateRows: Record<ImportKind, ImportRow[]> = {
  properties: [{ name: 'Ekängsvägen 1', address: 'Ekängsvägen 1', city: 'Virserum', zip: '57771', description: 'Exempelrad - ta bort före import' }],
  apartments: [{ property_name: 'Ekängsvägen 1', property_address: 'Ekängsvägen 1', apartment_number: '1001', size: '72', rooms: '3', rent: '8500', floor: '1', status: 'vacant' }],
  tenants: [{ name: 'Anna Andersson', email: 'anna@example.com', phone: '070-1234567', property_name: 'Ekängsvägen 1', apartment_number: '1001', start_date: '2026-09-01', monthly_rent: '8500' }],
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

  const required = useMemo(() => kind === 'properties' ? ['name', 'address', 'city', 'zip'] : kind === 'apartments' ? ['property_name', 'apartment_number'] : ['name', 'email'], [kind]);
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
          const result = await supabase.from('vihem_apartments').insert({ organisation_id: user.organisation_id, property_id: property.id, apartment_number: clean(row.apartment_number), size: Number(row.size) || 0, rooms: Number(row.rooms) || 0, rent: Number(row.rent) || 0, floor: Number(row.floor) || 0, status: clean(row.status) || 'vacant' });
          output.push(result.error ? { row: index + 2, status: 'error', message: result.error.message } : { row: index + 2, status: 'created', message: 'Lägenhet skapad.' });
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
    <PageHeader title="Importera boendedata" subtitle="Lägg in flera fastigheter, lägenheter och hyresgäster med mall och förhandsgranskning." icon={FileSpreadsheet} />
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
      <Card className="h-fit p-5"><h2 className="font-semibold text-slate-900">Så gör du</h2><ol className="mt-3 space-y-3 text-sm text-slate-600"><li><strong>1.</strong> Ladda ner Excel-mallen eller CSV-mallen.</li><li><strong>2.</strong> Fyll i en rad per fastighet, lägenhet eller hyresgäst. Ändra inte kolumnrubrikerna.</li><li><strong>3.</strong> Importera i ordningen fastigheter, lägenheter, hyresgäster.</li><li><strong>4.</strong> Kontrollera förhandsvisningen och importresultatet.</li></ol><div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4" /> Hyresgäster får nya konton. Spara de tillfälliga lösenorden säkert och dela dem separat.</div><div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900"><CheckCircle2 className="mr-1 inline h-4 w-4" /> Befintliga fastigheter och lägenheter hoppas över när namn/adress eller fastighet/lägenhetsnummer redan finns.</div></Card>
    </div>
  </div>;
}

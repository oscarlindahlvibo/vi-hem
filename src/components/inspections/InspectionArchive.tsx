import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw, Download } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../../lib/supabase';
import { inspectionFile, driveReference, retryInspectionArchive } from '../../lib/inspections/archive';
import { saveOrShareFile } from '../../lib/utils';
import { Button } from '../ui';
type ArchiveFile = { id: string; kind: string; filename: string; state: string; byte_size: number; version: number; created_at: string };
export function InspectionArchive({ inspection, canRetry }: { inspection: string; canRetry: boolean }) {
 const [files, setFiles] = useState<ArchiveFile[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState('');
 const load = useCallback(async () => {
  const result = await supabase.from('vihem_inspection_file_jobs').select('id,kind,filename,state,byte_size,version,created_at').eq('inspection_id', inspection).order('created_at', { ascending: false });
  if (result.error) setError('Arkivstatus kunde inte hämtas.'); else { setFiles(result.data); setError(''); }
 }, [inspection]);
 useEffect(() => { void load(); }, [load]);
 async function open(file: ArchiveFile) {
  setBusy(file.id); setError('');
  try {
   const response = await inspectionFile(driveReference(file.id));
   const blob = new Blob([response], { type: file.kind === 'protocol' ? 'application/pdf' : 'image/jpeg' });
   if (Capacitor.isNativePlatform()) await saveOrShareFile(blob, file.filename);
   else { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = file.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  } catch { setError('Filen kunde inte öppnas. Kontrollera anslutningen och försök igen.'); }
  finally { setBusy(''); }
 }
 async function retry(file: ArchiveFile) {
  setBusy(file.id); setError('');
  try { await retryInspectionArchive(file.id); await load(); }
  catch { setError('Arkiveringen kunde inte återupptas. För bilder: försök även via den lokala bildkön.'); }
  finally { setBusy(''); }
 }
 return <section className="rounded-xl border border-vihem-line p-4" aria-label="Besiktningens filarkiv">
  <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">Filer och dokumentversioner</h3><Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Uppdatera arkivstatus"><RefreshCw size={16}/></Button></div>
  {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  {!files.length && !error && <p className="mt-3 text-sm text-vihem-muted">Inga filer i det nya Drive-arkivet. Äldre bilder och protokoll behåller sina tidigare referenser.</p>}
  <ul className="mt-3 divide-y divide-vihem-line">{files.map(file => <li key={file.id} className="flex items-center gap-3 py-3">
   <FileText size={18} className="shrink-0 text-vihem-muted"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.filename}{file.kind === 'protocol' ? ` · Version ${file.version}` : ''}</p><p className="text-sm text-vihem-muted">{Math.ceil(file.byte_size / 1024)} kB · {file.state === 'verified' ? 'Sparad i Google Drive' : file.state === 'uploading' ? 'Arkiverar' : file.state === 'failed' ? 'Arkivering misslyckades' : 'Väntar på arkivering'}</p></div>
   {file.state === 'verified' ? <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void open(file)} aria-label={`Hämta ${file.filename}, version ${file.version}`}><Download size={16}/>Hämta</Button> : canRetry && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void retry(file)}>Försök igen</Button>}
  </li>)}</ul>
 </section>;
}

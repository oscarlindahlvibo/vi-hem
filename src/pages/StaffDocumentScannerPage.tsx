import React, { useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, FileCheck2, ReceiptText, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { DocumentCapture, type DocumentCaptureKind } from '../components/DocumentCapture';
import { archiveFileInGoogleDrive, buildDocumentArchiveFilename } from '../lib/googleDriveStorage';
import { Badge, Button, Card, EmptyState, Select, Textarea } from '../components/ui';
import type { FinanceCompany } from '../types';

interface StaffDocumentScannerPageProps {
  onNavigate: (page: string) => void;
}

const documentKindOptions = [
  { value: 'receipt', label: 'Kvitto' },
  { value: 'supplier_invoice', label: 'Leverantörsfaktura' },
];

export function StaffDocumentScannerPage({ onNavigate }: StaffDocumentScannerPageProps) {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<FinanceCompany[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [documentKind, setDocumentKind] = useState<DocumentCaptureKind>('receipt');
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [scanResetKey, setScanResetKey] = useState(0);

  const selectedCompany = useMemo(
    () => companies.find(company => company.id === companyId) ?? null,
    [companies, companyId],
  );

  useEffect(() => {
    const loadCompanies = async () => {
      if (!user?.organisation_id) return;
      setLoading(true);
      setError('');
      const { data, error: companyError } = await supabase
        .from('vihem_companies')
        .select('*')
        .eq('organisation_id', user.organisation_id)
        .eq('active', true)
        .order('name');

      if (companyError) {
        setError(companyError.message);
      } else {
        const rows = (data ?? []) as FinanceCompany[];
        setCompanies(rows);
        setCompanyId(current => current || rows[0]?.id || '');
      }
      setLoading(false);
    };

    void loadCompanies();
  }, [user?.organisation_id]);

  const submitScan = async () => {
    if (!file || !companyId) return;
    setSaving(true);
    setError('');
    setSuccess('');

    const fileBase64 = await fileToBase64(file);
    const { data, error: submitError } = await supabase.functions.invoke('vihem-ingest-supplier-invoice', {
      body: {
        source: 'staff_scanner',
        company_id: companyId,
        document_kind: documentKind,
        subject: documentKind === 'receipt' ? 'Scannat kvitto' : 'Scannad leverantörsfaktura',
        message: notes.trim(),
        file_name: file.name,
        content_type: file.type || 'application/octet-stream',
        file_base64: fileBase64,
      },
    });

    if (submitError || data?.error) {
      setError(data?.error || submitError?.message || 'Kunde inte skicka underlaget.');
      setSaving(false);
      return;
    }

    let driveMessage = '';
    if (data?.supplier_invoice_id && user?.organisation_id) {
      try {
        const archiveFile = new File([file], buildDocumentArchiveFilename({
          company: selectedCompany?.name,
          originalName: file.name,
        }), { type: file.type });
        const archived = await archiveFileInGoogleDrive({
          file: archiveFile,
          folder: 'Ekonomi/Underlag',
          organisation_id: user.organisation_id,
          source_type: 'supplier_invoice_attachment',
          source_id: data.supplier_invoice_id,
          source_key: data.supplier_invoice_id,
          created_by: user.id,
        });
        if (archived) {
          if (data.document_id) {
            await supabase.from('vihem_documents').update({
              storage_provider: 'google_drive',
              drive_file_id: archived.id,
              drive_web_url: archived.webViewLink || null,
              drive_folder_id: archived.folder_id || null,
              drive_synced_at: new Date().toISOString(),
            }).eq('id', data.document_id);
          }
          driveMessage = ' En kopia har sparats på Google Drive.';
        }
      } catch (archiveError) {
        console.warn('Google Drive-arkivering misslyckades', archiveError);
        driveMessage = ' Underlaget är inskickat, men Drive-kopian kunde inte skapas just nu.';
      }
    }

    setSuccess(`Underlaget är inskickat till OCR och admin-granskning.${driveMessage}`);
    setFile(null);
    setNotes('');
    setScanResetKey(prev => prev + 1);
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-24">
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><Camera className="h-5 w-5" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Underlag</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-950 sm:text-3xl">Scanna underlag</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Scanna kvitton och leverantörsfakturor utan att öppna ekonomin. Admin granskar alltid innan något bokförs.
          </p>
        </div>
        <Badge className="bg-emerald-50 text-emerald-700">
          <FileCheck2 className="h-4 w-4" />
          Till admin-granskning
        </Badge>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="mr-2 inline h-4 w-4" />
          {success}
        </div>
      )}

      {companies.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Camera className="h-8 w-8" />}
            title="Inga bolag upplagda"
            description="Admin behöver lägga upp minst ett bolag innan personal kan skicka in kvitton eller leverantörsfakturor."
            action={user?.role === 'admin' ? <Button onClick={() => onNavigate('finance')}>Öppna ekonomi</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <Card className="p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-bold text-slate-950">Vad vill du skicka in?</h2>
                <span className="text-xs font-medium text-slate-500">Steg 1 av 3</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Select
                  label="Typ av underlag"
                  value={documentKind}
                  options={documentKindOptions}
                  onChange={event => {
                    setDocumentKind(event.target.value as DocumentCaptureKind);
                    setFile(null);
                  }}
                />
                <Select
                  label="Bolag"
                  value={companyId}
                  options={companies.map(company => ({ value: company.id, label: company.name }))}
                  onChange={event => setCompanyId(event.target.value)}
                />
              </div>
            </Card>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold text-slate-950">Steg 2: fotografera eller välj fil</h2>
                <span className="text-xs font-medium text-slate-500">{file ? 'Klar' : 'Ej klar'}</span>
              </div>
              <DocumentCapture documentKind={documentKind} file={file} onFileChange={setFile} resetKey={scanResetKey} />
            </div>

            <Card className="p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold text-slate-950">Steg 3: skicka till granskning</h2>
                <span className="text-xs font-medium text-slate-500">Admin granskar</span>
              </div>
              <Textarea
                label="Kort kommentar till admin"
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Exempel: Material till badrum lgh 14, betalt med företagskort."
              />
              <div className="mt-4 flex justify-end">
                <Button onClick={submitScan} loading={saving} disabled={!file || !companyId}>
                  <Send className="h-4 w-4" />
                  Skicka till granskning
                </Button>
              </div>
            </Card>
          </div>

          <Card className="h-fit p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-600">
                <ReceiptText className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-bold text-slate-950">Så fungerar det</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Underlaget kopplas till {selectedCompany?.name || 'valt bolag'} och läggs som “behöver granskas”.
                  AI/OCR får föreslå tolkning, men admin måste kontrollera och godkänna innan något bokförs eller betalas.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Kunde inte läsa filen.'));
    reader.readAsDataURL(file);
  });
}

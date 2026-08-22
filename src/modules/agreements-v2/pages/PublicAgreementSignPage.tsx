// Public, unauthenticated signing page. Reached via /sign?token=... (see
// isAgreementSignRoute() in App.tsx, same convention as
// isGuestLaundryRoute()/GuestLaundryPage.tsx). No VI-HEM login, no Layout
// chrome -- a standalone mobile-first page.
import { useEffect, useState } from 'react';
import { declineSigning, getAttachmentDownloadUrl, getSignView, submitSignature, AgreementApiError } from '../api';
import type { PublicSignView } from '../types';
import { BlockRenderer } from '../components/BlockRenderer';
import { SignaturePad } from '../components/SignaturePad';
import { CheckCircle2, Download, FileText, XCircle } from 'lucide-react';

function getTokenFromUrl(): string {
  return new URLSearchParams(window.location.search).get('token') || '';
}

export function PublicAgreementSignPage() {
  const [token] = useState(getTokenFromUrl);
  const [view, setView] = useState<PublicSignView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'read' | 'sign' | 'signed' | 'declined'>('read');
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Länken saknar token.');
      setLoading(false);
      return;
    }
    getSignView(token)
      .then((data) => {
        setView(data);
        setSignatureName(data.signer.name || '');
        if (data.already_signed || data.signer.status === 'signed') setMode('signed');
        else if (data.signer.status === 'declined') setMode('declined');
      })
      .catch((err) => setError(err instanceof AgreementApiError ? err.message : 'Kunde inte ladda dokumentet.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSign = async () => {
    if (!signatureImage) { setError('Skriv din namnteckning innan du signerar.'); return; }
    if (!signatureName.trim()) { setError('Ange ditt namn.'); return; }
    setSaving(true);
    setError('');
    try {
      await submitSignature(token, { signature_image: signatureImage, signature_name: signatureName.trim() });
      setMode('signed');
    } catch (err) {
      setError(err instanceof AgreementApiError ? err.message : 'Signeringen misslyckades.');
    } finally {
      setSaving(false);
    }
  };

  const handleDecline = async () => {
    if (!confirm('Är du säker på att du vill avböja detta dokument?')) return;
    setSaving(true);
    try {
      await declineSigning(token);
      setMode('declined');
    } catch (err) {
      setError(err instanceof AgreementApiError ? err.message : 'Det gick inte att avböja.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadAttachment = async (attachmentId: string) => {
    try {
      const { url } = await getAttachmentDownloadUrl(token, attachmentId);
      window.open(url, '_blank');
    } catch {
      setError('Kunde inte öppna bilagan.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2 text-slate-400">
          <FileText className="h-5 w-5" />
          <span className="text-sm font-medium">VI-HEM</span>
        </div>

        {loading && <p className="text-sm text-slate-500">Laddar dokument...</p>}
        {error && !view && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {view && (
          <>
            <div className="mb-4 rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase text-slate-400">{view.agreement.document_number}</p>
              <h1 className="mt-0.5 text-xl font-bold text-slate-900">{view.agreement.title}</h1>
              <p className="mt-1 text-sm text-slate-500">Till: {view.signer.name}{view.signer.role_title ? ` (${view.signer.role_title})` : ''}</p>
            </div>

            {mode === 'signed' && (
              <div className="rounded-2xl bg-green-50 p-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
                <p className="mt-2 font-semibold text-green-900">Du har signerat detta dokument.</p>
              </div>
            )}
            {mode === 'declined' && (
              <div className="rounded-2xl bg-slate-100 p-6 text-center">
                <XCircle className="mx-auto h-10 w-10 text-slate-500" />
                <p className="mt-2 font-semibold text-slate-700">Du har avböjt detta dokument.</p>
              </div>
            )}

            {(mode === 'read' || mode === 'sign') && (
              <>
                <div className="mb-4 rounded-2xl bg-white p-5 shadow-sm">
                  <BlockRenderer blocks={view.version.blocks} parties={view.parties} signers={[view.signer]} />
                </div>

                {view.attachments.length > 0 && (
                  <div className="mb-4 rounded-2xl bg-white p-5 shadow-sm">
                    <p className="mb-2 text-sm font-semibold text-slate-700">Bilagor</p>
                    <div className="space-y-2">
                      {view.attachments.map((a) => (
                        <button key={a.id} onClick={() => handleDownloadAttachment(a.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                          <span>{a.name}</span>
                          <Download className="h-4 w-4 text-slate-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {mode === 'read' && (
                  <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4 shadow-lg">
                    <div className="mx-auto flex max-w-2xl gap-3">
                      <button onClick={handleDecline} disabled={saving} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600">
                        Avböj
                      </button>
                      {view.signer.signing_method === 'bankid' ? (
                        <button disabled className="flex-[2] rounded-xl bg-slate-300 py-3 text-sm font-semibold text-white">
                          BankID-signering kommer snart
                        </button>
                      ) : (
                        <button onClick={() => setMode('sign')} className="flex-[2] rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700">
                          Granska & signera
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {mode === 'sign' && (
                  <div className="rounded-2xl bg-white p-5 shadow-sm">
                    <p className="mb-3 text-sm font-semibold text-slate-700">Din signatur</p>
                    <input
                      type="text"
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                      placeholder="Ditt namn"
                      className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                    <SignaturePad onChange={setSignatureImage} />
                    {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
                    <div className="mt-4 flex gap-3">
                      <button onClick={() => setMode('read')} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600">
                        Tillbaka
                      </button>
                      <button onClick={handleSign} disabled={saving} className="flex-[2] rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                        {saving ? 'Signerar...' : 'Signera dokumentet'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

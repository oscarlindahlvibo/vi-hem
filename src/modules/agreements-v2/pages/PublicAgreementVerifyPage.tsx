// Public, unauthenticated document verification page. Reached via
// /verify?doc=...&code=... -- the link printed on every final signed PDF
// (see _shared/agreement-completion.ts). Lets a third party (a bank, a
// court, another company) independently confirm a document's signature
// record without needing a VI-HEM login or a signing token. Same
// no-Layout-chrome, standalone convention as PublicAgreementSignPage.tsx.
import { useEffect, useState } from 'react';
import { verifyDocument, AgreementApiError } from '../api';
import type { PublicVerificationResult } from '../types';
import { CheckCircle2, FileText, ShieldCheck, XCircle } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  signed: 'Signerat',
  accepted: 'Accepterat',
};

const METHOD_LABELS: Record<string, string> = {
  handwritten: 'Handskriven elektronisk signatur',
  bankid: 'BankID',
};

function getParamsFromUrl(): { doc: string; code: string } {
  const params = new URLSearchParams(window.location.search);
  return { doc: params.get('doc') || '', code: params.get('code') || '' };
}

export function PublicAgreementVerifyPage() {
  const [{ doc, code }] = useState(getParamsFromUrl);
  const [result, setResult] = useState<PublicVerificationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!doc || !code) {
      setError('Länken saknar dokumentnummer eller kod.');
      setLoading(false);
      return;
    }
    verifyDocument(doc, code)
      .then(setResult)
      .catch((err) => setError(err instanceof AgreementApiError ? err.message : 'Kunde inte verifiera dokumentet.'))
      .finally(() => setLoading(false));
  }, [doc, code]);

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <div className="mx-auto max-w-xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2 text-slate-400">
          <FileText className="h-5 w-5" />
          <span className="text-sm font-medium">VI-HEM — dokumentverifiering</span>
        </div>

        {loading && <p className="text-sm text-slate-500">Verifierar dokument...</p>}

        {error && !loading && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <XCircle className="mx-auto h-10 w-10 text-slate-400" />
            <p className="mt-2 font-semibold text-slate-700">{error}</p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-green-50 p-6 text-center shadow-sm">
              <ShieldCheck className="mx-auto h-10 w-10 text-green-600" />
              <p className="mt-2 font-semibold text-green-900">Dokumentet är verifierat äkta</p>
              <p className="mt-1 text-sm text-green-700">Uppgifterna nedan kommer direkt från VI-HEMs register.</p>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase text-slate-400">{result.document_number}</p>
              <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">{result.title}</h1>
              <p className="mt-2 text-sm text-slate-600">
                Status: <span className="font-medium text-slate-900">{STATUS_LABELS[result.status] || result.status}</span>
              </p>
              {result.completed_at && (
                <p className="mt-1 text-sm text-slate-600">
                  Slutfört: <span className="font-medium text-slate-900">{new Date(result.completed_at).toLocaleString('sv-SE')}</span>
                </p>
              )}
              {result.content_hash && (
                <p className="mt-1 break-all text-xs text-slate-400">Innehålls-ID (SHA-256): {result.content_hash}</p>
              )}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-slate-700">Signaturer</p>
              <div className="space-y-3">
                {result.signers.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    {s.status === 'signed' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-900">{s.name}{s.role_title ? ` (${s.role_title})` : ''}</p>
                      <p className="text-xs text-slate-500">{METHOD_LABELS[s.method] || s.method}</p>
                      {s.signed_at && <p className="text-xs text-slate-400">Signerat: {new Date(s.signed_at).toLocaleString('sv-SE')}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
import { Button } from '../../../components/ui';

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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setResult(null);
    if (!doc || !code) {
      setError('Länken saknar dokumentnummer eller kod.');
      setLoading(false);
      return;
    }
    verifyDocument(doc, code)
      .then(data => { if (active) setResult(data); })
      .catch((err) => { if (active) setError(err instanceof AgreementApiError && err.code !== 'EDGE_FUNCTION_ERROR' ? err.message : 'Kunde inte verifiera dokumentet.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [doc, code, attempt]);

  return (
    <div className="min-h-[100dvh] bg-slate-50 pb-16">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <div className="mb-4 flex items-center gap-2 text-vihem-navy">
          <FileText className="h-5 w-5" />
          <span className="text-sm font-medium">VI-HEM — dokumentverifiering</span>
        </div>

        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-slate-900">Kontrollera dokumentet</h1>
        <p className="mb-6 max-w-prose text-sm leading-relaxed text-slate-600">Här visas dokumentets registrerade status och signaturer. Kontrollera att dokumentnummer och parter stämmer med din handling.</p>
        {loading && <p role="status" className="text-sm text-slate-500">Verifierar dokument…</p>}

        {error && !loading && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <XCircle className="h-8 w-8 text-slate-400" />
            <p role="alert" className="mt-3 font-medium text-slate-800">{error}</p>
            <p className="mt-2 text-sm text-slate-600">Öppna verifieringslänken från dokumentet. Kontakta avsändaren om länken inte fungerar.</p>
            {doc && code && <Button className="mt-4" variant="secondary" onClick={() => setAttempt(previous => previous + 1)}>Försök igen</Button>}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-green-200 bg-green-50 p-5 sm:p-6">
              <ShieldCheck className="h-8 w-8 text-green-600" />
              <p className="mt-2 font-semibold text-green-900">Dokumentet är verifierat äkta</p>
              <p className="mt-1 text-sm text-green-700">Uppgifterna nedan kommer direkt från VI-HEMs register.</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <p className="text-xs font-medium uppercase text-slate-400">{result.document_number}</p>
              <h2 className="mt-1 break-words text-xl font-semibold tracking-tight text-slate-900">{result.title}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Status: <span className="font-medium text-slate-900">{STATUS_LABELS[result.status] || result.status}</span>
              </p>
              {result.completed_at && (
                <p className="mt-1 text-sm text-slate-600">
                  Slutfört: <span className="font-medium text-slate-900">{new Date(result.completed_at).toLocaleString('sv-SE')}</span>
                </p>
              )}
              {result.content_hash && (
                <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-slate-600">Teknisk dokumentidentitet</summary><p className="mt-2 break-all font-mono text-xs leading-relaxed text-slate-500">SHA-256: {result.content_hash}</p></details>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <p className="mb-3 text-sm font-semibold text-slate-700">Signaturer</p>
              <div className="space-y-3">
                {result.signers.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    {s.status === 'signed' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                    )}
                    <div className="min-w-0 break-words">
                      <p className="text-sm font-medium text-slate-900">{s.name}{s.role_title ? ` (${s.role_title})` : ''}</p>
                      <p className="text-sm text-slate-500">{METHOD_LABELS[s.method] || s.method}</p>
                      {s.signed_at && <p className="text-sm text-slate-500">Signerat: {new Date(s.signed_at).toLocaleString('sv-SE')}</p>}
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

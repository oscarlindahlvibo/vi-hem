// Public, unauthenticated signing page. Reached via /sign?token=... (see
// isAgreementSignRoute() in App.tsx, same convention as
// isGuestLaundryRoute()/GuestLaundryPage.tsx). No VI-HEM login, no Layout
// chrome -- a standalone mobile-first page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { declineSigning, getAttachmentDownloadUrl, getSignView, submitSignature, updatePackageSelection, AgreementApiError } from '../api';
import type { PublicSignView } from '../types';
import { BlockRenderer } from '../components/BlockRenderer';
import { SignaturePad } from '../components/SignaturePad';
import { useBankIdFlow } from '../../../hooks/useBankIdFlow';
import { initiateBankIDAgreementSign } from '../../../lib/bankid';
import { CheckCircle2, Download, FileText, ShieldCheck, XCircle } from 'lucide-react';
import { Button, Input, Modal } from '../../../components/ui';

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
  const submission = useRef(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [packageSelection, setPackageSelection] = useState<Record<string, boolean>>({});
  const [consentSelection, setConsentSelection] = useState<Record<string, boolean>>({});
  const allConsentsAccepted = (view?.version.blocks ?? []).filter(block => block.block_type === 'checkbox_consent').every(block => consentSelection[block.id]);
  const bankId = useBankIdFlow('sign', token);
  const bankIdBusy = bankId.status === 'starting' || bankId.status === 'redirecting' || bankId.status === 'pending';

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (!token) {
      setError('Länken saknar token.');
      setLoading(false);
      return;
    }
    getSignView(token)
      .then((data) => {
        if (!active) return;
        setView(data);
        setSignatureName(data.signer.name || '');
        setPackageSelection(Object.fromEntries(data.selected_package_ids.map((id) => [id, true])));
        if (data.already_signed || data.signer.status === 'signed') setMode('signed');
        else if (data.signer.status === 'declined') setMode('declined');
      })
      .catch((err) => { if (active) setError(err instanceof AgreementApiError && err.code !== 'EDGE_FUNCTION_ERROR' ? err.message : 'Kunde inte ladda dokumentet.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, attempt]);

  // The signature itself is already written to vihem_agreement_signatures
  // server-side by vihem-bankid's "collect" action once the order
  // completes (see that module's flow==="sign" +
  // agreement_signature_request_id branch) -- this just reflects it.
  useEffect(() => {
    if (bankId.status !== 'complete') return;
    setMode('signed');
    bankId.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId.status]);

  useEffect(() => {
    if (bankId.status === 'failed' && bankId.error) setError(bankId.error);
  }, [bankId.status, bankId.error]);

  // Optimistic: flips the checkbox immediately, persists in the
  // background. A tenant toggling tvättmaskin/internet on and off while
  // deciding shouldn't feel like it's waiting on a network round-trip each
  // click; if the save fails they'll see the error banner and can retry
  // (the checkbox itself doesn't roll back, since the next successful
  // toggle -- or signing -- reconciles it anyway).
  const handleTogglePackage = useCallback((blockId: string, selected: boolean) => {
    setPackageSelection((prev) => {
      const next = { ...prev, [blockId]: selected };
      const ids = Object.entries(next).filter(([, v]) => v).map(([id]) => id);
      updatePackageSelection(token, ids).catch((err) => setError(err instanceof AgreementApiError && err.code !== 'EDGE_FUNCTION_ERROR' ? err.message : 'Kunde inte spara valet.'));
      return next;
    });
  }, [token]);

  const checkConsent = () => {
    if (allConsentsAccepted) return true;
    setError('Kryssa i att du har läst och godkänner avtalsvillkoren innan du signerar.');
    return false;
  };

  const handleSign = async () => {
    if (submission.current || bankIdBusy) return;
    if (!checkConsent()) return;
    if (!signatureImage) { setError('Skriv din namnteckning innan du signerar.'); return; }
    if (!signatureName.trim()) { setError('Ange ditt namn.'); return; }
    submission.current = true;
    setSaving(true);
    setError('');
    try {
      await submitSignature(token, { signature_image: signatureImage, signature_name: signatureName.trim() });
      setMode('signed');
    } catch (err) {
      setError(err instanceof AgreementApiError && err.code !== 'EDGE_FUNCTION_ERROR' ? err.message : 'Signeringen misslyckades.');
    } finally {
      submission.current = false; setSaving(false);
    }
  };

  const handleDecline = async () => {
    if (submission.current || bankIdBusy) return;
    submission.current = true; setError('');
    setSaving(true);
    try {
      await declineSigning(token);
      setMode('declined'); setDeclineOpen(false);
    } catch (err) {
      setError(err instanceof AgreementApiError && err.code !== 'EDGE_FUNCTION_ERROR' ? err.message : 'Det gick inte att avböja.');
    } finally {
      submission.current = false; setSaving(false);
    }
  };

  const handleDownloadAttachment = async (attachmentId: string) => {
    // Opens the tab SYNCHRONOUSLY, inside the click handler's own call
    // stack, then redirects it once the URL resolves -- Safari/WebKit
    // (this page is often opened from an in-app browser, e.g. Meddelanden)
    // silently blocks `window.open()` as a popup the moment it happens
    // after an `await`, since it's no longer within the original click
    // gesture.
    const newTab = window.open('', '_blank');
    try {
      const { url } = await getAttachmentDownloadUrl(token, attachmentId);
      if (newTab) newTab.location.href = url;
      else setError('Kunde inte öppna bilagan (popup blockerad). Tillåt popup-fönster och försök igen.');
    } catch {
      newTab?.close();
      setError('Kunde inte öppna bilagan.');
    }
  };

  const resolveAttachmentUrl = useCallback(
    async (attachmentId: string) => (await getAttachmentDownloadUrl(token, attachmentId)).url,
    [token],
  );

  return (
    <div className="min-h-[100dvh] bg-slate-50 pb-[calc(7rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        <div className="mb-4 flex items-center gap-2 text-vihem-navy">
          <FileText className="h-5 w-5" />
          <span className="text-sm font-medium">VI-HEM</span>
        </div>

        {loading && <p role="status" className="text-sm text-slate-500">Laddar dokument…</p>}
        {error && !view && <section className="rounded-2xl border border-slate-200 bg-white p-6"><h1 className="text-xl font-semibold text-slate-900">Dokumentet kunde inte öppnas</h1><p role="alert" className="mt-3 text-sm text-red-700">{error}</p><p className="mt-3 text-sm leading-relaxed text-slate-600">Öppna länken från avsändarens meddelande. Kontakta avsändaren om länken har gått ut.</p>{token && <Button className="mt-4" variant="secondary" onClick={() => setAttempt(previous => previous + 1)}>Försök igen</Button>}</section>}

        {view && (
          <>
            <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
              <p className="text-xs font-medium uppercase text-slate-400">{view.agreement.document_number}</p>
              <h1 className="mt-0.5 break-words text-2xl font-semibold tracking-tight text-slate-900">{view.agreement.title}</h1>
              <p className="mt-1 text-sm text-slate-500">Till: {view.signer.name}{view.signer.role_title ? ` (${view.signer.role_title})` : ''}</p>
            </div>

            {mode === 'signed' && (
              <div className="rounded-2xl bg-green-50 p-6 text-center shadow-sm">
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
                <p className="mt-2 font-semibold text-green-900">Du har signerat detta dokument.</p>
              </div>
            )}
            {mode === 'declined' && (
              <div className="rounded-2xl bg-slate-100 p-6 text-center shadow-sm">
                <XCircle className="mx-auto h-10 w-10 text-slate-500" />
                <p className="mt-2 font-semibold text-slate-700">Du har avböjt detta dokument.</p>
              </div>
            )}

            {(mode === 'read' || mode === 'sign') && <ol aria-label="Signeringssteg" className="mb-5 flex items-center gap-6 text-sm"><li aria-current={mode === 'read' ? 'step' : undefined} className={mode === 'read' ? 'font-semibold text-vihem-navy' : 'text-slate-500'}>1. Läs och granska</li><li aria-current={mode === 'sign' ? 'step' : undefined} className={mode === 'sign' ? 'font-semibold text-vihem-navy' : 'text-slate-500'}>2. Signera</li></ol>}
            {(mode === 'read' || mode === 'sign') && (
              <>
                <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
                  <BlockRenderer
                    blocks={view.version.blocks}
                    parties={view.parties}
                    signers={[view.signer]}
                    attachments={view.attachments}
                    resolveAttachmentUrl={resolveAttachmentUrl}
                    packageSelection={packageSelection}
                    onTogglePackage={handleTogglePackage}
                    consentSelection={consentSelection}
                    onToggleConsent={saving || bankIdBusy ? undefined : (id, accepted) => setConsentSelection(previous => ({ ...previous, [id]: accepted }))}
                  />
                </div>

                {view.attachments.length > 0 && (
                  <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
                    <p className="mb-2 text-sm font-semibold text-slate-700">Bilagor</p>
                    <div className="space-y-2">
                      {view.attachments.map((a) => (
                        <button key={a.id} onClick={() => handleDownloadAttachment(a.id)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                          <span className="min-w-0 break-words">{a.name}</span>
                          <Download className="h-4 w-4 shrink-0 text-slate-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!allConsentsAccepted && <p className="mb-4 text-sm text-slate-600">Kryssa i godkännandet i avtalet innan du går vidare till signering.</p>}

                {mode === 'read' && (
                  <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
                    <div className="mx-auto flex max-w-3xl gap-3">
                      <Button variant="secondary" onClick={() => setDeclineOpen(true)} disabled={saving || bankIdBusy} className="shrink-0">
                        Avböj
                      </Button>
                      <Button onClick={() => { if (checkConsent()) setMode('sign'); }} disabled={!allConsentsAccepted || saving} className="min-w-0 flex-1">
                        Till signering
                      </Button>
                    </div>
                  </div>
                )}

                {mode === 'sign' && view.signer.signing_method === 'bankid' && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
                    <p className="mb-3 text-sm font-semibold text-slate-700">Signera med BankID</p>
                    {bankIdBusy ? (
                      <div className="rounded-xl border-2 border-vihem-navy/20 bg-slate-50 p-5 text-center">
                        {bankId.qrImage && (
                          <img src={bankId.qrImage} alt="QR-kod för BankID" className="mx-auto mb-3 h-44 w-44 rounded-lg border border-slate-200 bg-white p-2" />
                        )}
                        {bankId.launchUrl ? (
                          <a
                            href={bankId.launchUrl}
                            onClick={() => bankId.confirmLaunched()}
                            className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-vihem-navy px-4 py-3 text-sm font-semibold text-white hover:bg-vihem-navy/90"
                          >
                            <ShieldCheck className="h-4 w-4" /> Öppna BankID-appen
                          </a>
                        ) : (
                          <p className="text-sm text-slate-600">{bankId.message || 'Startar BankID...'}</p>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => { if (checkConsent()) void bankId.start(() => initiateBankIDAgreementSign(token)); }}
                        disabled={!allConsentsAccepted}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-vihem-navy py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-vihem-navy/90"
                      >
                        <ShieldCheck className="h-4 w-4" /> Starta BankID
                      </button>
                    )}
                    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
                    <div className="mt-4">
                      <Button variant="secondary" onClick={() => { setMode('read'); bankId.reset(); }} className="w-full">
                        Tillbaka
                      </Button>
                    </div>
                  </div>
                )}

                {mode === 'sign' && view.signer.signing_method !== 'bankid' && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8">
                    <p className="mb-3 text-sm font-semibold text-slate-700">Din signatur</p>
                    <Input
                      label="Namn för signaturen"
                      autoComplete="name"
                      type="text"
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                      placeholder="Ditt namn"
                      className="mb-3"
                    />
                    <SignaturePad onChange={setSignatureImage} />
                    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
                    <div className="mt-4 flex gap-3">
                      <Button variant="secondary" disabled={saving} onClick={() => setMode('read')} className="flex-1">
                        Tillbaka
                      </Button>
                      <Button onClick={handleSign} loading={saving} disabled={!allConsentsAccepted} className="flex-[2]">
                        Signera dokumentet
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      <Modal open={declineOpen} onClose={() => { if (!saving) setDeclineOpen(false); }} title="Avböj dokumentet?" footer={<><Button variant="secondary" disabled={saving} onClick={() => setDeclineOpen(false)}>Fortsätt granska</Button><Button variant="danger" loading={saving} onClick={() => void handleDecline()}>Avböj dokumentet</Button></>}><p className="text-sm leading-relaxed text-slate-600">Avsändaren får veta att du har avböjt dokumentet. Du kan fortsätta granska innan du bestämmer dig.</p>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</Modal>
    </div>
  );
}

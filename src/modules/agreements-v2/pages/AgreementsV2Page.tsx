// Avtal V2 (BETA) — central archive + editor. Single-file module page,
// same pattern as src/modules/finance-v2/pages/FinanceV2Page.tsx (several
// internal components in one file rather than a deep folder tree).
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  cancelAgreement,
  createAgreement,
  createTemplate,
  duplicateTemplate,
  getAgreement,
  getTemplate,
  listAgreements,
  listExistingPartyOptions,
  listTemplates,
  remindSigner,
  removeAttachment,
  saveBlocks,
  saveParties,
  saveSigners,
  saveTemplateBlocks,
  sendAgreement,
  updateAgreement,
  updateTemplate,
  uploadAttachment,
  AgreementApiError,
} from '../api';
import type {
  Agreement,
  AgreementAttachment,
  AgreementAuditEvent,
  AgreementBlock,
  AgreementDetail,
  AgreementDocumentType,
  AgreementListItem,
  AgreementParty,
  AgreementSigner,
  AgreementStatus,
  AgreementTemplate,
  ExistingPartyOption,
} from '../types';
import { BlockEditor } from '../components/BlockEditor';
import { BlockRenderer } from '../components/BlockRenderer';
import { Modal } from '../../../components/ui';
import { ArchiveIcon, ArrowLeft, Bell, FileSignature, FileText, Paperclip, Plus, Send, Trash2, Users, XCircle } from 'lucide-react';

function describeError(err: unknown): string {
  if (err instanceof AgreementApiError) return err.message;
  return err instanceof Error ? err.message : 'Ett okänt fel inträffade.';
}

const STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: 'Utkast',
  ready: 'Redo',
  sent: 'Skickad',
  viewed: 'Öppnad',
  partially_signed: 'Delsignerad',
  signed: 'Signerad',
  declined: 'Avböjd',
  expired: 'Utgången',
  cancelled: 'Avbruten',
  archived: 'Arkiverad',
  accepted: 'Accepterad',
  rejected: 'Avvisad',
};
const STATUS_COLORS: Record<AgreementStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  ready: 'bg-blue-100 text-blue-700',
  sent: 'bg-amber-100 text-amber-700',
  viewed: 'bg-amber-100 text-amber-700',
  partially_signed: 'bg-amber-100 text-amber-700',
  signed: 'bg-green-100 text-green-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-200 text-slate-500',
  archived: 'bg-slate-100 text-slate-500',
};

function Badge({ status }: { status: AgreementStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function AgreementsV2Page() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'archive' | 'templates'>('archive');
  const [selectedAgreementId, setSelectedAgreementId] = useState<string | null>(null);

  if (!user?.organisation_id) return null;

  if (selectedAgreementId) {
    return <AgreementEditor agreementId={selectedAgreementId} organisationId={user.organisation_id} onBack={() => setSelectedAgreementId(null)} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          Avtal & offerter
          <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">BETA</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">Ett centralt arkiv för avtal, offerter och andra dokument — kopplade eller fristående.</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {([['archive', 'Arkiv'], ['templates', 'Mallar']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium ${tab === key ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'archive' && <ArchiveTab organisationId={user.organisation_id} onOpen={setSelectedAgreementId} />}
      {tab === 'templates' && <TemplatesTab organisationId={user.organisation_id} />}
    </div>
  );
}

// ── Archive tab ──────────────────────────────────────────────────────────

function ArchiveTab({ organisationId, onOpen }: { organisationId: string; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<AgreementListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AgreementStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | AgreementDocumentType>('all');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listAgreements({
        status: statusFilter === 'all' ? undefined : statusFilter,
        document_type: typeFilter === 'all' ? undefined : typeFilter,
        search: search || undefined,
      });
      setItems(data);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök dokument, motpart, nummer..."
            className="w-64 rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            <option value="all">Alla statusar</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
            <option value="all">Alla typer</option>
            <option value="agreement">Avtal</option>
            <option value="offer">Offert</option>
            <option value="other">Övrigt</option>
          </select>
        </div>
        <button onClick={() => setNewOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Nytt dokument
        </button>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Laddar...</p>}

      {!loading && items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">Inga dokument matchar filtret ännu.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase text-slate-500">
                <th className="px-4 py-2">Dokument</th>
                <th className="px-4 py-2">Typ</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Skapad</th>
                <th className="px-4 py-2">Senast ändrad</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} onClick={() => onOpen(item.id)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{item.title || '(namnlöst dokument)'}</p>
                    <p className="text-xs text-slate-400">{item.document_number}</p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{item.document_type === 'agreement' ? 'Avtal' : item.document_type === 'offer' ? 'Offert' : 'Övrigt'}</td>
                  <td className="px-4 py-2.5"><Badge status={item.status} /></td>
                  <td className="px-4 py-2.5 text-slate-500">{new Date(item.created_at).toLocaleDateString('sv-SE')}</td>
                  <td className="px-4 py-2.5 text-slate-500">{new Date(item.updated_at).toLocaleDateString('sv-SE')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {newOpen && (
        <NewDocumentModal
          organisationId={organisationId}
          onClose={() => setNewOpen(false)}
          onCreated={(id) => { setNewOpen(false); onOpen(id); }}
        />
      )}
    </div>
  );
}

function NewDocumentModal({ organisationId, onClose, onCreated }: { organisationId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [documentType, setDocumentType] = useState<AgreementDocumentType>('agreement');
  const [title, setTitle] = useState('');
  const [templates, setTemplates] = useState<AgreementTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listTemplates({ status: 'active' }).then((t) => setTemplates(t.filter((x) => x.document_type === documentType))).catch(() => setTemplates([]));
  }, [documentType]);

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      const created = await createAgreement({ document_type: documentType, title, template_id: templateId || undefined });
      onCreated(created.id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900">Nytt dokument</h2>
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Vad vill du skapa?</p>
            <div className="grid grid-cols-3 gap-2">
              {([['agreement', 'Avtal'], ['offer', 'Offert'], ['other', 'Övrigt']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => { setDocumentType(value); setTemplateId(''); }}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${documentType === value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Titel</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="T.ex. Hyresavtal lgh 12A" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Utgångspunkt</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Tomt dokument</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">Avbryt</button>
            <button onClick={handleCreate} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Skapar...' : 'Skapa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Editor (wizard) ──────────────────────────────────────────────────────

type EditorStep = 'content' | 'parties' | 'signing' | 'attachments' | 'history';

function AgreementEditor({ agreementId, organisationId, onBack }: { agreementId: string; organisationId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<AgreementDetail | null>(null);
  const [step, setStep] = useState<EditorStep>('content');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Lifted OUT of the step components: they used to hold their own local
  // copy synced from `detail`, which React discards the moment a step
  // unmounts on tab switch -- any edit made but not yet explicitly saved
  // vanished the instant you clicked another tab. Living here instead means
  // switching tabs can never lose an in-progress edit, since this
  // component never unmounts while the editor is open. The explicit
  // "Spara"-buttons still persist to the backend exactly as before; this
  // only fixes what happens to unsaved edits in between.
  const [blocks, setBlocks] = useState<AgreementBlock[]>([]);
  const [parties, setParties] = useState<AgreementParty[]>([]);
  const [signers, setSigners] = useState<AgreementSigner[]>([]);

  // The last-PERSISTED shape of each, so we can tell whether the live state
  // above actually differs from what the backend has -- both for
  // auto-saving on tab switch and for deciding whether leaving the editor
  // needs to ask "save as draft first?". Updated after every successful
  // save (manual, auto-on-switch, or the initial load itself, which is
  // trivially "already saved").
  const [savedBlocks, setSavedBlocks] = useState<AgreementBlock[]>([]);
  const [savedParties, setSavedParties] = useState<AgreementParty[]>([]);
  const [savedSigners, setSavedSigners] = useState<AgreementSigner[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAgreement(agreementId);
      setDetail(data);
      setBlocks(data.blocks);
      setParties(data.parties);
      setSigners(data.signers);
      setSavedBlocks(data.blocks);
      setSavedParties(data.parties);
      setSavedSigners(data.signers);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [agreementId]);

  // Refreshes ONLY the read-only parts of `detail` (attachments, versions,
  // audit trail) -- deliberately does NOT touch blocks/parties/signers.
  // Uploading or removing an attachment (from the content step's inline
  // picker, or the Bilagor tab) used to call the full `load()` above, which
  // silently overwrote whatever unsaved edits were sitting in the lifted
  // blocks/parties/signers state -- the exact "everything disappears"
  // report this refactor was meant to fix, just reintroduced through a
  // different door. This is the narrow version that can't do that.
  const refreshDetail = useCallback(async () => {
    try {
      const data = await getAgreement(agreementId);
      setDetail(data);
    } catch (err) {
      setError(describeError(err));
    }
  }, [agreementId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-slate-500">Laddar dokument...</p>;
  if (error || !detail) return <p className="text-sm text-red-700">{error || 'Dokumentet kunde inte laddas.'}</p>;

  const { agreement } = detail;
  const editable = agreement.status === 'draft' || agreement.status === 'ready';

  const blocksDirty = editable && JSON.stringify(blocks) !== JSON.stringify(savedBlocks);
  const partiesDirty = editable && JSON.stringify(parties) !== JSON.stringify(savedParties);
  const signersDirty = editable && JSON.stringify(signers) !== JSON.stringify(savedSigners);
  const currentStepDirty = (step === 'content' && blocksDirty) || (step === 'parties' && partiesDirty) || (step === 'signing' && signersDirty);

  // Persists whichever step's data is currently unsaved. Used both when
  // switching tabs (silent auto-save -- "spara blocken automatiskt när man
  // växlar flik") and when leaving the editor entirely after the user
  // confirms they want to save as a draft first. Returns false on failure
  // so callers can decide not to proceed (e.g. not switch tabs) rather than
  // silently losing the edit.
  const saveCurrentStep = async (): Promise<boolean> => {
    try {
      if (step === 'content' && blocksDirty) {
        await saveBlocks(agreement.id, blocks);
        setSavedBlocks(blocks);
        setMessage('Innehållet sparades automatiskt.');
      } else if (step === 'parties' && partiesDirty) {
        await saveParties(agreement.id, parties);
        setSavedParties(parties);
        setMessage('Parterna sparades automatiskt.');
      } else if (step === 'signing' && signersDirty) {
        await saveSigners(agreement.id, signers);
        setSavedSigners(signers);
        setMessage('Signatärerna sparades automatiskt.');
      }
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    }
  };

  const handleTabClick = async (next: EditorStep) => {
    if (next === step) return;
    if (currentStepDirty) {
      const ok = await saveCurrentStep();
      if (!ok) return; // stay put -- don't switch away from a failed save
    }
    setStep(next);
  };

  const handleBack = async () => {
    if (currentStepDirty) {
      const wantsSave = confirm('Du har osparade ändringar i det här dokumentet. Spara som utkast innan du lämnar?');
      if (wantsSave) {
        const ok = await saveCurrentStep();
        if (!ok) return; // failed save -- stay so the error is visible and nothing is silently lost
      }
    }
    onBack();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={handleBack} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Tillbaka till arkivet
        </button>
        <div className="flex items-center gap-2">
          <Badge status={agreement.status} />
          {!['draft', 'ready', 'cancelled', 'signed', 'accepted', 'declined', 'rejected', 'archived'].includes(agreement.status) && null}
        </div>
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{agreement.title || '(namnlöst dokument)'}</h1>
        <p className="text-sm text-slate-400">{agreement.document_number}</p>
      </div>

      {message && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {([
          ['content', 'Innehåll', FileText],
          ['parties', 'Parter', Users],
          ['signing', 'Signering', FileSignature],
          ['attachments', 'Bilagor', Paperclip],
          ['history', 'Historik', ArchiveIcon],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => handleTabClick(key)}
            className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium ${step === key ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {step === 'content' && (
        <ContentStep
          agreementId={agreement.id}
          organisationId={organisationId}
          blocks={blocks}
          onBlocksChange={setBlocks}
          parties={parties}
          signers={signers}
          attachments={detail.attachments}
          editable={editable}
          onSaved={(m) => { setMessage(m); setSavedBlocks(blocks); }}
          onError={setError}
          onAttachmentsChanged={refreshDetail}
        />
      )}
      {step === 'parties' && (
        <PartiesStep
          agreementId={agreement.id}
          organisationId={organisationId}
          parties={parties}
          onPartiesChange={setParties}
          signers={signers}
          onSignersChange={setSigners}
          editable={editable}
          onSaved={(m) => { setMessage(m); setSavedParties(parties); }}
          onError={setError}
        />
      )}
      {step === 'signing' && (
        <SigningStep
          agreementId={agreement.id}
          agreementStatus={agreement.status}
          signers={signers}
          onSignersChange={setSigners}
          parties={parties}
          editable={editable}
          onSaved={(m) => { setMessage(m); setSavedSigners(signers); }}
          onError={setError}
          onSent={(m) => { setMessage(m); load(); }}
        />
      )}
      {step === 'attachments' && <AttachmentsStep detail={detail} organisationId={organisationId} editable={editable} onChanged={refreshDetail} onError={setError} />}
      {step === 'history' && <HistoryStep events={detail.audit_events} />}
    </div>
  );
}

function ContentStep({
  agreementId,
  organisationId,
  blocks,
  onBlocksChange,
  parties,
  signers,
  attachments,
  editable,
  onSaved,
  onError,
  onAttachmentsChanged,
}: {
  agreementId: string;
  organisationId: string;
  blocks: AgreementBlock[];
  onBlocksChange: (blocks: AgreementBlock[]) => void;
  parties: AgreementParty[];
  signers: AgreementSigner[];
  attachments: AgreementAttachment[];
  editable: boolean;
  onSaved: (m: string) => void;
  onError: (e: string) => void;
  onAttachmentsChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBlocks(agreementId, blocks);
      onSaved('Innehållet sparat.');
    } catch (err) {
      onError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUploadAttachment = async (file: File) => {
    const uploaded = await uploadAttachment({ organisationId, agreementId, file });
    onAttachmentsChanged();
    return { id: uploaded.id, name: uploaded.name };
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Block</p>
          <div className="flex gap-2">
            <button onClick={() => setPreview((v) => !v)} className="text-xs font-medium text-slate-500 underline lg:hidden">{preview ? 'Redigera' : 'Förhandsgranska'}</button>
            {editable && (
              <button onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {saving ? 'Sparar...' : 'Spara innehåll'}
              </button>
            )}
          </div>
        </div>
        {!editable && <p className="mb-2 text-xs text-amber-700">Dokumentet är skickat och kan inte längre redigeras direkt.</p>}
        <div className={preview ? 'hidden lg:block' : ''}>
          <BlockEditor
            blocks={blocks}
            onChange={onBlocksChange}
            attachments={attachments.map((a) => ({ id: a.id, name: a.name }))}
            onUploadAttachment={handleUploadAttachment}
          />
        </div>
      </div>
      <div className={preview ? '' : 'hidden lg:block'}>
        <p className="mb-2 text-sm font-medium text-slate-700">Förhandsgranskning</p>
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <BlockRenderer blocks={blocks} parties={parties} signers={signers} />
        </div>
      </div>
    </div>
  );
}

/** Turns a party's current name/email/phone into a draft signer, so
 * "same people on parties and signing" doesn't mean retyping them --
 * party_id is left null since a not-yet-saved party has no real id to
 * link to yet (see PartiesStep's quick-add button, which only offers this
 * for parties that already came from the system so profile_id can also be
 * carried across correctly). */
function signerDraftFromNames(name: string, email: string, phone: string, profileId: string | null = null): AgreementSigner {
  return {
    party_id: null,
    profile_id: profileId,
    name,
    email,
    phone,
    personal_number: '',
    role_title: '',
    signing_method: 'handwritten',
    signing_required: true,
    sign_order: null,
  };
}

function PartiesStep({
  agreementId,
  organisationId,
  parties,
  onPartiesChange,
  signers,
  onSignersChange,
  editable,
  onSaved,
  onError,
}: {
  agreementId: string;
  organisationId: string;
  parties: AgreementParty[];
  onPartiesChange: (parties: AgreementParty[]) => void;
  signers: AgreementSigner[];
  onSignersChange: (signers: AgreementSigner[]) => void;
  editable: boolean;
  onSaved: (m: string) => void;
  onError: (e: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const addParty = (party: AgreementParty, alsoSigner: boolean) => {
    onPartiesChange([...parties, party]);
    if (alsoSigner) {
      const sourceProfileId = party.source_type === 'tenant' || party.source_type === 'staff' ? party.source_id : null;
      onSignersChange([...signers, signerDraftFromNames(party.display_name, party.email, party.phone, sourceProfileId)]);
    }
  };
  const addManualParty = () => addParty({ party_type: 'manual', display_name: '', org_number: '', email: '', phone: '', address: '', source_type: null, source_id: null }, false);
  const updateParty = (i: number, patch: Partial<AgreementParty>) => onPartiesChange(parties.map((p, ii) => (ii === i ? { ...p, ...patch } : p)));
  const removeParty = (i: number) => onPartiesChange(parties.filter((_, ii) => ii !== i));
  const addAsSigner = (party: AgreementParty) => {
    const sourceProfileId = party.source_type === 'tenant' || party.source_type === 'staff' ? party.source_id : null;
    onSignersChange([...signers, signerDraftFromNames(party.display_name, party.email, party.phone, sourceProfileId)]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveParties(agreementId, parties);
      onSaved('Parter sparade.');
    } catch (err) {
      onError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        En part kan vara en intern juridisk person, en känd kontakt/kund i VI-HEM, eller helt manuellt angiven — det krävs inte att motparten redan finns i systemet.
      </p>
      {parties.map((party, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <select value={party.party_type} onChange={(e) => updateParty(i, { party_type: e.target.value as any })} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
                <option value="manual">Manuellt angiven</option>
                <option value="internal_org">Eget bolag</option>
                <option value="contact">Kontakt/kund i VI-HEM</option>
                <option value="company">Företag</option>
              </select>
              {party.source_type && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">Från systemet</span>}
            </div>
            <button onClick={() => removeParty(i)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input placeholder="Namn" value={party.display_name} onChange={(e) => updateParty(i, { display_name: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
            <input placeholder="Org.nr/pers.nr (valfritt)" value={party.org_number} onChange={(e) => updateParty(i, { org_number: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
            <input placeholder="E-post" value={party.email} onChange={(e) => updateParty(i, { email: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
            <input placeholder="Telefon" value={party.phone} onChange={(e) => updateParty(i, { phone: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
            <input placeholder="Adress" value={party.address} onChange={(e) => updateParty(i, { address: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm sm:col-span-2" />
          </div>
          <button onClick={() => addAsSigner(party)} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-600">
            <Plus className="h-3 w-3" /> Lägg också till som signatär
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        <button onClick={() => setPickerOpen(true)} className="flex items-center gap-1.5 text-sm font-medium text-blue-600"><Plus className="h-4 w-4" /> Välj från systemet</button>
        <button onClick={addManualParty} className="flex items-center gap-1.5 text-sm font-medium text-slate-500"><Plus className="h-4 w-4" /> Lägg till manuellt</button>
      </div>
      {editable && (
        <div>
          <button onClick={handleSave} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? 'Sparar...' : 'Spara parter'}
          </button>
        </div>
      )}
      <ExistingPartyPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} organisationId={organisationId} onPick={addParty} />
    </div>
  );
}

function ExistingPartyPickerModal({
  open,
  onClose,
  organisationId,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  organisationId: string;
  onPick: (party: AgreementParty, alsoSigner: boolean) => void;
}) {
  const [options, setOptions] = useState<ExistingPartyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listExistingPartyOptions(organisationId).then(setOptions).catch(() => setOptions([])).finally(() => setLoading(false));
  }, [open, organisationId]);

  const groups: { label: string; type: ExistingPartyOption['source_type'] }[] = [
    { label: 'Hyresgäster', type: 'tenant' },
    { label: 'Kunder', type: 'finance_customer' },
    { label: 'Personal', type: 'staff' },
  ];
  const query = search.trim().toLowerCase();
  const matches = (o: ExistingPartyOption) => !query || o.display_name.toLowerCase().includes(query) || o.email.toLowerCase().includes(query);

  return (
    <Modal open={open} onClose={onClose} title="Välj part från systemet">
      <div className="space-y-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök namn eller e-post..."
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        {loading && <p className="text-sm text-slate-500">Laddar...</p>}
        {!loading && groups.map((group) => {
          const items = options.filter((o) => o.source_type === group.type && matches(o));
          if (items.length === 0) return null;
          return (
            <div key={group.type}>
              <p className="mb-1.5 text-xs font-semibold uppercase text-slate-400">{group.label}</p>
              <div className="space-y-1.5">
                {items.map((o) => (
                  <div key={`${o.source_type}-${o.source_id}`} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{o.display_name}</p>
                      <p className="truncate text-xs text-slate-500">{o.email || o.phone || '—'}</p>
                    </div>
                    <div className="flex flex-shrink-0 gap-1.5">
                      <button
                        onClick={() => {
                          onPick({ party_type: o.party_type, display_name: o.display_name, org_number: o.org_number, email: o.email, phone: o.phone, address: o.address, source_type: o.source_type, source_id: o.source_id }, false);
                          onClose();
                        }}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Lägg till
                      </button>
                      <button
                        onClick={() => {
                          onPick({ party_type: o.party_type, display_name: o.display_name, org_number: o.org_number, email: o.email, phone: o.phone, address: o.address, source_type: o.source_type, source_id: o.source_id }, true);
                          onClose();
                        }}
                        className="rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        + Signatär
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!loading && options.filter(matches).length === 0 && <p className="text-sm text-slate-500">Inga träffar.</p>}
      </div>
    </Modal>
  );
}

function SigningStep({
  agreementId,
  agreementStatus,
  signers,
  onSignersChange,
  parties,
  editable,
  onSaved,
  onError,
  onSent,
}: {
  agreementId: string;
  agreementStatus: AgreementStatus;
  signers: AgreementSigner[];
  onSignersChange: (signers: AgreementSigner[]) => void;
  parties: AgreementParty[];
  editable: boolean;
  onSaved: (m: string) => void;
  onError: (e: string) => void;
  onSent: (m: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailChannel, setEmailChannel] = useState(true);
  const [smsChannel, setSmsChannel] = useState(false);

  const addSigner = () => onSignersChange([...signers, { party_id: null, profile_id: null, name: '', email: '', phone: '', personal_number: '', role_title: '', signing_method: 'handwritten', signing_required: true, sign_order: null }]);
  const addSignerFromParty = (party: AgreementParty) => {
    const sourceProfileId = party.source_type === 'tenant' || party.source_type === 'staff' ? party.source_id : null;
    onSignersChange([...signers, signerDraftFromNames(party.display_name, party.email, party.phone, sourceProfileId)]);
  };
  // Parties not already mirrored as a signer by name+email -- a light
  // heuristic (no hard party_id link exists for parties added before they
  // were ever saved), just enough to stop offering someone already added.
  const availableParties = parties.filter((p) => p.display_name && !signers.some((s) => s.name === p.display_name && s.email === p.email));
  const updateSigner = (i: number, patch: Partial<AgreementSigner>) => onSignersChange(signers.map((s, ii) => (ii === i ? { ...s, ...patch } : s)));
  const removeSigner = (i: number) => onSignersChange(signers.filter((_, ii) => ii !== i));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSigners(agreementId, signers);
      onSaved('Signatärer sparade.');
    } catch (err) {
      onError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      await saveSigners(agreementId, signers);
      const result = await sendAgreement(agreementId, { email: emailChannel, sms: smsChannel });
      const failed = result.delivery.filter((d) => !d.ok);
      onSent(failed.length === 0 ? 'Dokumentet skickades till alla signatärer.' : `Skickat, men ${failed.length} leverans(er) misslyckades — se historik.`);
    } catch (err) {
      onError(describeError(err));
    } finally {
      setSending(false);
    }
  };

  const handleRemind = async (signerId: string) => {
    try {
      await remindSigner(agreementId, signerId, smsChannel);
      onSent('Påminnelse skickad.');
    } catch (err) {
      onError(describeError(err));
    }
  };

  const handleCancel = async () => {
    if (!confirm('Avbryt dokumentet? Redan skickade signeringslänkar återkallas.')) return;
    try {
      await cancelAgreement(agreementId);
      onSent('Dokumentet avbröts.');
    } catch (err) {
      onError(describeError(err));
    }
  };

  return (
    <div className="space-y-4">
      {editable ? (
        <>
          <div className="space-y-3">
            {signers.map((signer, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase text-slate-400">Signatär {i + 1}</p>
                  <button onClick={() => removeSigner(i)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input placeholder="Namn" value={signer.name} onChange={(e) => updateSigner(i, { name: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                  <input placeholder="Roll/titel" value={signer.role_title} onChange={(e) => updateSigner(i, { role_title: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                  <input placeholder="E-post" value={signer.email} onChange={(e) => updateSigner(i, { email: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                  <input placeholder="Mobilnummer" value={signer.phone} onChange={(e) => updateSigner(i, { phone: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                  <input placeholder="Personnummer (för BankID)" value={signer.personal_number} onChange={(e) => updateSigner(i, { personal_number: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" />
                  <select value={signer.signing_method} onChange={(e) => updateSigner(i, { signing_method: e.target.value as any })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
                    <option value="handwritten">Handskriven signatur</option>
                    <option value="bankid">BankID (kommer snart)</option>
                  </select>
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={signer.signing_required} onChange={(e) => updateSigner(i, { signing_required: e.target.checked })} />
                  Signering krävs
                </label>
              </div>
            ))}
            {availableParties.length > 0 && (
              <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/40 p-3">
                <p className="mb-1.5 text-xs font-medium text-slate-600">Redan tillagd som part — lägg till som signatär med ett klick:</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableParties.map((p, i) => (
                    <button key={i} onClick={() => addSignerFromParty(p)} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">
                      + {p.display_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={addSigner} className="flex items-center gap-1.5 text-sm font-medium text-blue-600"><Plus className="h-4 w-4" /> Lägg till signatär manuellt</button>
          </div>
          <div>
            <button onClick={handleSave} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 disabled:opacity-50">
              {saving ? 'Sparar...' : 'Spara signatärer'}
            </button>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
            <p className="mb-2 text-sm font-semibold text-slate-900">Skicka för signering</p>
            <div className="mb-3 flex gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={emailChannel} onChange={(e) => setEmailChannel(e.target.checked)} /> E-post</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={smsChannel} onChange={(e) => setSmsChannel(e.target.checked)} /> SMS</label>
            </div>
            <p className="mb-3 text-xs text-slate-500">Innehållet fryses som en oföränderlig version i samma ögonblick dokumentet skickas — senare ändringar av t.ex. hyresgästens uppgifter påverkar aldrig ett redan skickat dokument.</p>
            <button onClick={handleSend} disabled={sending || signers.length === 0} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              <Send className="h-4 w-4" /> {sending ? 'Skickar...' : 'Skicka för signering'}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {signers.map((signer) => (
            <div key={signer.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
              <div>
                <p className="font-medium text-slate-900">{signer.name}</p>
                <p className="text-xs text-slate-500">{signer.role_title} · {signer.signing_method === 'bankid' ? 'BankID' : 'Handskriven signatur'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{signer.status}</span>
                {signer.status !== 'signed' && signer.status !== 'declined' && ['sent', 'viewed'].includes(agreementStatus) && (
                  <button onClick={() => handleRemind(signer.id!)} className="flex items-center gap-1 text-xs font-medium text-blue-600"><Bell className="h-3 w-3" /> Påminn</button>
                )}
              </div>
            </div>
          ))}
          {!['signed', 'accepted', 'declined', 'rejected', 'cancelled', 'archived'].includes(agreementStatus) && (
            <button onClick={handleCancel} className="flex items-center gap-1.5 text-sm font-medium text-red-600"><XCircle className="h-4 w-4" /> Avbryt dokumentet</button>
          )}
        </div>
      )}
    </div>
  );
}

function AttachmentsStep({ detail, organisationId, editable, onChanged, onError }: { detail: AgreementDetail; organisationId: string; editable: boolean; onChanged: () => void; onError: (e: string) => void }) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await uploadAttachment({ organisationId, agreementId: detail.agreement.id, file });
      onChanged();
    } catch (err) {
      onError(describeError(err));
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (attachment: AgreementAttachment) => {
    try {
      await removeAttachment(attachment.id);
      onChanged();
    } catch (err) {
      onError(describeError(err));
    }
  };

  return (
    <div className="space-y-3">
      {detail.attachments.length === 0 ? (
        <p className="text-sm text-slate-500">Inga bilagor ännu.</p>
      ) : (
        <div className="space-y-2">
          {detail.attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-sm font-medium text-slate-800">{a.name}</p>
                  <p className="text-xs text-slate-400">{(a.file_size / 1024).toFixed(0)} kB{a.included_in_version_id ? ' · ingår i skickad version' : ''}</p>
                </div>
              </div>
              {editable && !a.included_in_version_id && (
                <button onClick={() => handleRemove(a)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {editable && (
        <div>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
            className="text-sm"
          />
          {uploading && <p className="mt-1 text-xs text-slate-500">Laddar upp...</p>}
        </div>
      )}
    </div>
  );
}

function HistoryStep({ events }: { events: AgreementAuditEvent[] }) {
  const labels: Record<string, string> = {
    created: 'Dokumentet skapades',
    sent: 'Skickades för signering',
    sent_email: 'Skickades via e-post',
    sent_sms: 'Skickades via SMS',
    email_delivery_failed: 'Leverans via e-post misslyckades',
    sms_delivery_failed: 'Leverans via SMS misslyckades',
    reminder_sent: 'Påminnelse skickad',
    viewed: 'Signatär öppnade dokumentet',
    signed: 'Signatär signerade',
    declined: 'Signatär avböjde',
    completed: 'Dokumentet slutfördes',
    cancelled: 'Dokumentet avbröts',
  };
  return (
    <div className="space-y-3">
      {events.length === 0 && <p className="text-sm text-slate-500">Ingen historik ännu.</p>}
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2">
          <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-400" />
          <div>
            <p className="text-sm text-slate-800">{labels[e.event_type] || e.event_type}</p>
            <p className="text-xs text-slate-400">{new Date(e.created_at).toLocaleString('sv-SE')}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Templates tab ────────────────────────────────────────────────────────

function TemplatesTab({ organisationId }: { organisationId: string }) {
  const [templates, setTemplates] = useState<AgreementTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await listTemplates());
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (selectedId) {
    return <TemplateEditor templateId={selectedId} onBack={() => { setSelectedId(null); load(); }} />;
  }

  const handleCreate = async () => {
    setCreating(true);
    try {
      const t = await createTemplate({ name: 'Ny mall', document_type: 'agreement' });
      setSelectedId(t.id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateTemplate(id);
      load();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const handleArchive = async (id: string, status: AgreementTemplate['status']) => {
    try {
      await updateTemplate({ id, status: status === 'archived' ? 'active' : 'archived' });
      load();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={handleCreate} disabled={creating} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Ny mall
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Laddar...</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-slate-500">Inga mallar ännu.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-1 flex items-center justify-between">
                <p className="font-medium text-slate-900">{t.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs ${t.status === 'active' ? 'bg-green-100 text-green-700' : t.status === 'archived' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>{t.status}</span>
              </div>
              <p className="mb-3 text-xs text-slate-500">{t.document_type === 'agreement' ? 'Avtal' : t.document_type === 'offer' ? 'Offert' : 'Övrigt'}{t.category ? ` · ${t.category}` : ''}</p>
              <div className="flex gap-2 text-xs font-medium">
                <button onClick={() => setSelectedId(t.id)} className="text-blue-600">Redigera</button>
                <button onClick={() => handleDuplicate(t.id)} className="text-slate-500">Duplicera</button>
                <button onClick={() => handleArchive(t.id, t.status)} className="text-slate-500">{t.status === 'archived' ? 'Återställ' : 'Arkivera'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const [template, setTemplate] = useState<AgreementTemplate | null>(null);
  const [blocks, setBlocks] = useState<AgreementBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    getTemplate(templateId)
      .then((data) => { setTemplate(data.template); setBlocks(data.blocks); })
      .catch((err) => setError(describeError(err)))
      .finally(() => setLoading(false));
  }, [templateId]);

  const handleSaveMeta = async (patch: Partial<AgreementTemplate>) => {
    if (!template) return;
    try {
      const updated = await updateTemplate({ id: template.id, ...patch });
      setTemplate(updated);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const handleSaveBlocks = async () => {
    setSaving(true);
    try {
      await saveTemplateBlocks(templateId, blocks);
      setMessage('Mallens innehåll sparat.');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Laddar mall...</p>;
  if (error && !template) return <p className="text-sm text-red-700">{error}</p>;
  if (!template) return null;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Tillbaka till mallar
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={template.name} onChange={(e) => setTemplate({ ...template, name: e.target.value })} onBlur={() => handleSaveMeta({ name: template.name })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold" />
        <input value={template.category} onChange={(e) => setTemplate({ ...template, category: e.target.value })} onBlur={() => handleSaveMeta({ category: template.category })} placeholder="Kategori" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end">
        <button onClick={handleSaveBlocks} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Sparar...' : 'Spara innehåll'}
        </button>
      </div>
      <BlockEditor blocks={blocks} onChange={setBlocks} />
    </div>
  );
}

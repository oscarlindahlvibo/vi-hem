// Fredagsmöte-ombygget: den obligatoriska tre-fälts-uppdelningen för en
// överlämning. Ingen av dessa tre fält får någonsin blandas ihop --
// original_note stannar i käll-segmentet, internal_explanation är bara för
// den som senare granskar varför, forwarded_text är det ENDA mottagande
// segment någonsin ser (via get_meeting_handoffs_for_segment-RPC:n).
import React, { useState } from 'react';
import { Modal, Button, Textarea, Select } from '../../../components/ui';
import type { SegmentMeeting } from '../types';

interface HandoffComposerProps {
  open: boolean;
  onClose: () => void;
  sourceAgendaTitle?: string;
  targetOptions: { meeting: SegmentMeeting; label: string }[];
  defaultOriginalNote?: string;
  onSave: (input: {
    originalNote: string;
    internalExplanation: string;
    forwardedText: string;
    handoffTarget: 'next_segment' | 'later_meeting' | 'separate_meeting' | 'internal_follow_up_only' | 'no_handoff';
    targetMeetingId: string | null;
  }) => Promise<void>;
}

export function HandoffComposer({ open, onClose, sourceAgendaTitle, targetOptions, defaultOriginalNote, onSave }: HandoffComposerProps) {
  const [originalNote, setOriginalNote] = useState(defaultOriginalNote || '');
  const [internalExplanation, setInternalExplanation] = useState('');
  const [forwardedText, setForwardedText] = useState('');
  const [handoffTarget, setHandoffTarget] = useState<'next_segment' | 'later_meeting' | 'separate_meeting' | 'internal_follow_up_only' | 'no_handoff'>('next_segment');
  const [targetMeetingId, setTargetMeetingId] = useState(targetOptions[0]?.meeting.id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (handoffTarget !== 'internal_follow_up_only' && handoffTarget !== 'no_handoff' && !forwardedText.trim()) {
      setError('Skriv den text mottagande möte ska se innan du sparar.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        originalNote,
        internalExplanation,
        forwardedText,
        handoffTarget,
        targetMeetingId: (handoffTarget === 'next_segment' || handoffTarget === 'later_meeting') ? (targetMeetingId || null) : null,
      });
      setOriginalNote(''); setInternalExplanation(''); setForwardedText('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara överlämningen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Vidarebefordra${sourceAgendaTitle ? ' — ' + sourceAgendaTitle : ''}`} size="lg">
      <div className="space-y-4">
        <Textarea
          label="Original-anteckning (privat, stannar i det här mötet — syns aldrig för mottagande möte)"
          value={originalNote}
          onChange={e => setOriginalNote(e.target.value)}
          rows={3}
        />
        <Textarea
          label="Intern förklaring (för granskning senare, syns inte för mottagande möte)"
          value={internalExplanation}
          onChange={e => setInternalExplanation(e.target.value)}
          rows={2}
        />
        <Select
          label="Vad ska hända?"
          value={handoffTarget}
          onChange={e => setHandoffTarget(e.target.value as any)}
          options={[
            { value: 'next_segment', label: 'Till nästa delmöte' },
            { value: 'later_meeting', label: 'Till samma segment nästa fredag' },
            { value: 'separate_meeting', label: 'Separat uppföljningsmöte' },
            { value: 'internal_follow_up_only', label: 'Endast intern uppföljning' },
            { value: 'no_handoff', label: 'Ingen vidarebefordran' },
          ]}
        />
        {(handoffTarget === 'next_segment' || handoffTarget === 'later_meeting') && targetOptions.length > 0 && (
          <Select
            label="Mottagande möte"
            value={targetMeetingId}
            onChange={e => setTargetMeetingId(e.target.value)}
            options={targetOptions.map(o => ({ value: o.meeting.id, label: o.label }))}
          />
        )}
        {(handoffTarget === 'next_segment' || handoffTarget === 'later_meeting') && (
          <Textarea
            label="Text mottagande möte ska se (neutral, inga onödiga detaljer)"
            value={forwardedText}
            onChange={e => setForwardedText(e.target.value)}
            rows={3}
            placeholder='T.ex. "Peter behöver lämna kvittot från Beijer senast fredag kl 12."'
          />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Avbryt</Button>
          <Button variant="primary" onClick={handleSave} loading={saving} className="flex-1">Spara</Button>
        </div>
      </div>
    </Modal>
  );
}

export type TaxObligation = {
  id?: string;
  company_id: string;
  obligation_type: string;
  period: string;
  title: string;
  description?: string;
  due_at: string | null;
  amount?: number | null;
  official_status: string;
  verification_status: string;
  task_status: string;
  last_seen_at?: string | null;
  official_reference?: string;
};

export type TaxAttentionState = 'overdue' | 'due_soon' | 'stale' | 'friday' | 'normal' | 'done';

const DAY_MS = 24 * 60 * 60 * 1000;

export function getTaxAttentionState(
  obligation: Pick<TaxObligation, 'due_at' | 'task_status' | 'last_seen_at'>,
  now = new Date(),
  attentionDays = 14,
  staleDays = 2,
): TaxAttentionState {
  if (obligation.task_status === 'done' || obligation.task_status === 'dismissed') return 'done';
  const due = obligation.due_at ? new Date(obligation.due_at).getTime() : null;
  if (due !== null && due <= now.getTime()) return 'overdue';
  if (due !== null && due - now.getTime() <= attentionDays * DAY_MS) {
    if (now.getDay() === 5 && due - now.getTime() <= 7 * DAY_MS) return 'friday';
    return 'due_soon';
  }
  const lastSeen = obligation.last_seen_at ? new Date(obligation.last_seen_at).getTime() : null;
  if (lastSeen !== null && now.getTime() - lastSeen > staleDays * DAY_MS) return 'stale';
  return 'normal';
}

export function taxAttentionLabel(state: TaxAttentionState) {
  return {
    overdue: 'Försenad',
    due_soon: 'Förfaller snart',
    stale: 'Behöver verifieras',
    friday: 'Påminnelse fredag',
    normal: 'Under kontroll',
    done: 'Klar',
  }[state];
}

export function formatTaxAmount(value: number | null | undefined) {
  if (value === null || value === undefined) return 'Belopp saknas';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(value);
}

export function buildMockTaxObligations(companyId: string, now = new Date()): TaxObligation[] {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const nextMonth = new Date(Date.UTC(year, now.getUTCMonth() + 1, 12, 8));
  return [
    {
      company_id: companyId,
      obligation_type: 'vat',
      period: `${year}-${month}`,
      title: 'Momsdeklaration',
      description: 'Testunderlag från Skatteverket-adaptern.',
      due_at: nextMonth.toISOString(),
      amount: 0,
      official_status: 'open',
      verification_status: 'verified',
      task_status: 'open',
      official_reference: `MOCK-VAT-${year}-${month}`,
    },
    {
      company_id: companyId,
      obligation_type: 'agi',
      period: `${year}-${month}`,
      title: 'Arbetsgivardeklaration',
      description: 'Kontrollera löneunderlag innan rapportering.',
      due_at: new Date(Date.UTC(year, now.getUTCMonth() + 1, 12, 8)).toISOString(),
      amount: null,
      official_status: 'open',
      verification_status: 'warning',
      task_status: 'open',
      official_reference: `MOCK-AGI-${year}-${month}`,
    },
  ];
}

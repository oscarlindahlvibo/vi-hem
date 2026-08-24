import { supabase } from './supabase';

export type BankIDEnvironment = 'test' | 'production';
export interface BankIDConfig { environment: BankIDEnvironment; edgeFunctionUrl: string; }
export interface BankIDAuthOrder { orderRef: string; autoStartToken: string; qrImage?: string | null; }
export interface BankIDCollectResult { orderRef: string; status: 'pending' | 'failed' | 'complete'; hintCode?: string; error?: string; login_ready?: boolean; magic_link?: string | null; signed?: boolean; completionData?: { user: { personalNumber: string; name: string; givenName: string; surname: string }; signature: string; ocspResponse: string }; }
export interface BankIDSignOrder extends BankIDAuthOrder { userVisibleData: string; }
export interface BankIDResult { personalNumber: string; name: string; signature: string; autoStartToken: string; }

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('vihem-bankid', { body });
  if (error) throw new BankIDError('requestFailed', data?.error || error.message || 'BankID-anropet misslyckades.');
  if (data?.error) throw new BankIDError(String(data.hintCode || 'failed'), String(data.error));
  return data as T;
}

export function initiateBankIDAuth(_config: BankIDConfig, _endUserIp: string) {
  return invoke<BankIDAuthOrder>({ action: 'start_auth' });
}
export function initiateBankIDSign(_config: BankIDConfig, _endUserIp: string, userVisibleData: string, contractId: string) {
  return invoke<BankIDSignOrder>({ action: 'start_sign', user_visible_data: userVisibleData, contract_id: contractId });
}
export function collectBankIDOrder(_config: BankIDConfig, orderRef: string) { return invoke<BankIDCollectResult>({ action: 'collect', order_ref: orderRef }); }
export function cancelBankIDOrder(_config: BankIDConfig, orderRef: string) { return invoke<void>({ action: 'cancel', order_ref: orderRef }); }
export function generateBankIDQRContent(_qrStartToken: string, _qrStartSecret: string, _elapsedSeconds: number) { return ''; }

export function bankIDLaunchUrl(order: BankIDAuthOrder) {
  return order.autoStartToken ? `https://app.bankid.com/?autostarttoken=${encodeURIComponent(order.autoStartToken)}&redirect=${encodeURIComponent(window.location.origin)}` : '';
}
/** Normalizes an admin-typed personnummer (10 or 12 digits, with or
 * without a dash) into the 12-digit, no-separator form BankID's
 * CompletionData.User.PersonalNumber always uses -- vihem_profiles.bankid_personal_number
 * must be stored in this exact form for the auth "collect" lookup in
 * vihem-bankid/index.ts to match. Returns '' if it can't be normalized to
 * a plausible personnummer (caller should treat that as invalid input). */
export function normalizePersonalNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12) return digits;
  if (digits.length === 10) {
    const yy = parseInt(digits.slice(0, 2), 10);
    const currentYY = new Date().getFullYear() % 100;
    const century = yy <= currentYY ? '20' : '19';
    return century + digits;
  }
  return '';
}
export function formatPersonalNumber(pno: string) { const digits = pno.replace(/\D/g, ''); return digits.length === 12 ? `${digits.slice(0, 8)}-${digits.slice(8)}` : pno; }
export function maskPersonalNumber(pno: string) { const digits = pno.replace(/\D/g, ''); return digits.length === 12 ? `${digits.slice(0, 8)}-****` : '****'; }
export const BANKID_ENABLED = true;
export class BankIDNotConfiguredError extends Error { constructor(message = 'BankID är inte aktiverat. Kontakta systemadministratören.') { super(message); this.name = 'BankIDNotConfiguredError'; } }
export class BankIDError extends Error { constructor(public readonly hintCode: string, message: string) { super(message); this.name = 'BankIDError'; } }
export const BANKID_HINT_MESSAGES: Record<string, string> = { outstandingTransaction: 'Starta BankID-appen och godkänn.', noClient: 'Starta BankID-appen.', started: 'Söker efter BankID ...', userCallConfirm: 'Bekräfta i BankID-appen.', userSign: 'Skriv in din säkerhetskod i BankID-appen och välj Skriv under.', expiredTransaction: 'BankID-sessionen har gått ut. Försök igen.', userCancel: 'Åtgärden avbröts.', cancelled: 'Åtgärden avbröts.' };

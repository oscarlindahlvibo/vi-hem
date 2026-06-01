/**
 * BankID abstraction layer.
 *
 * This module defines the interface and types for Swedish BankID integration.
 * The actual BankID API calls must be made server-side (via a Supabase Edge
 * Function) because the RP certificate and API key must never be exposed to
 * the browser.
 *
 * Integration path when BankID is activated:
 *  1. Deploy a "bankid-auth" Edge Function that wraps the BankID RP API.
 *  2. Replace the stub implementations below with calls to that function.
 *  3. Store the BankID personal number in profiles.bankid_personal_number and
 *     set profiles.auth_method = 'bankid' | 'both'.
 *  4. For contract signing, call signContractWithBankID() — it returns the
 *     BankID signature token that is stored in
 *     contract_signatures.tenant_bankid_signature.
 *
 * BankID RP API documentation: https://www.bankid.com/en/utvecklare/guider/teknisk-integrationsguide
 * Test environment base URL:    https://appapi2.test.bankid.com/rp/v6.0
 * Production base URL:          https://appapi2.bankid.com/rp/v6.0
 */

export type BankIDEnvironment = 'test' | 'production';

export interface BankIDConfig {
  environment: BankIDEnvironment;
  /** Edge Function URL that proxies BankID RP API calls */
  edgeFunctionUrl: string;
}

export interface BankIDAuthOrder {
  orderRef: string;
  autoStartToken: string;
  qrStartToken: string;
  qrStartSecret: string;
}

export interface BankIDCollectResult {
  orderRef: string;
  status: 'pending' | 'failed' | 'complete';
  hintCode?: string;
  completionData?: {
    user: {
      personalNumber: string;
      name: string;
      givenName: string;
      surname: string;
    };
    signature: string;
    ocspResponse: string;
  };
}

export interface BankIDSignOrder extends BankIDAuthOrder {
  userVisibleData: string;
}

/** Result returned to the application after a successful auth or sign flow */
export interface BankIDResult {
  personalNumber: string;
  name: string;
  signature: string;
  /** BankID autoStartToken — used to deep-link the BankID app on the same device */
  autoStartToken: string;
}

// ---------------------------------------------------------------------------
// Stub implementations — replace the bodies when the Edge Function is ready
// ---------------------------------------------------------------------------

/**
 * Initiates a BankID authentication order.
 * Returns an order that the UI uses to render QR code or deep-link button.
 *
 * Replace the stub body with:
 *   const res = await fetch(`${config.edgeFunctionUrl}/auth`, { method: 'POST', ... });
 */
export async function initiateBankIDAuth(
  _config: BankIDConfig,
  _endUserIp: string,
): Promise<BankIDAuthOrder> {
  throw new BankIDNotConfiguredError();
}

/**
 * Initiates a BankID signing order for a contract.
 * `userVisibleData` is shown to the user in the BankID app (base64-encoded).
 */
export async function initiateBankIDSign(
  _config: BankIDConfig,
  _endUserIp: string,
  _userVisibleData: string,
): Promise<BankIDSignOrder> {
  throw new BankIDNotConfiguredError();
}

/**
 * Polls BankID for the result of an auth or sign order.
 * Call every 2 seconds until status is 'complete' or 'failed'.
 */
export async function collectBankIDOrder(
  _config: BankIDConfig,
  _orderRef: string,
): Promise<BankIDCollectResult> {
  throw new BankIDNotConfiguredError();
}

/**
 * Cancels a pending BankID order (user dismissed the dialog).
 */
export async function cancelBankIDOrder(
  _config: BankIDConfig,
  _orderRef: string,
): Promise<void> {
  throw new BankIDNotConfiguredError();
}

/**
 * Generates the animated QR code data string for each 1-second interval.
 * The QR content must be re-generated every second while the order is pending.
 *
 * Formula per BankID spec:
 *   qrAuthCode = HMAC-SHA256(qrStartSecret, "<elapsed_seconds>")
 *   qrData     = "bankid." + qrStartToken + "." + elapsed + "." + qrAuthCode
 */
export function generateBankIDQRContent(
  _qrStartToken: string,
  _qrStartSecret: string,
  _elapsedSeconds: number,
): string {
  throw new BankIDNotConfiguredError();
}

// ---------------------------------------------------------------------------
// Helper: format personal number (YYYYMMDDXXXX → YYYYMMDD-XXXX)
// ---------------------------------------------------------------------------

export function formatPersonalNumber(pno: string): string {
  const digits = pno.replace(/\D/g, '');
  if (digits.length === 12) {
    return `${digits.slice(0, 8)}-${digits.slice(8)}`;
  }
  return pno;
}

export function maskPersonalNumber(pno: string): string {
  const digits = pno.replace(/\D/g, '');
  if (digits.length === 12) {
    return `${digits.slice(0, 8)}-****`;
  }
  return '****';
}

// ---------------------------------------------------------------------------
// Feature flag — set to true once the Edge Function is deployed and configured
// ---------------------------------------------------------------------------

export const BANKID_ENABLED = false;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class BankIDNotConfiguredError extends Error {
  constructor() {
    super(
      'BankID är inte aktiverat. Kontakta systemadministratören för att konfigurera BankID-integration.',
    );
    this.name = 'BankIDNotConfiguredError';
  }
}

export class BankIDError extends Error {
  constructor(
    public readonly hintCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankIDError';
  }
}

/** Maps BankID hintCodes to Swedish user-facing messages */
export const BANKID_HINT_MESSAGES: Record<string, string> = {
  outstandingTransaction: 'Starta BankID-appen och godkänn.',
  noClient: 'Starta BankID-appen.',
  started: 'Söker efter BankID, det kan ta en liten stund ...',
  userMrtd: 'Bearbeta din MrtD ...',
  userCallConfirm: 'Bekräfta i BankID-appen.',
  userSign: 'Skriv in din säkerhetskod i BankID-appen och välj Skriv under.',
  expiredTransaction: 'BankID-sessionen har gått ut. Försök igen.',
  certificateErr: 'Det BankID du försöker använda är för gammalt eller spärrat.',
  userCancel: 'Åtgärden avbröts.',
  cancelled: 'Åtgärden avbröts.',
  startFailed: 'BankID-appen verkar inte finnas i din dator eller telefon. Installera den och hämta ett BankID hos din internetbank.',
};

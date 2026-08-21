export type AccountedIntegration = {
  config?: Record<string, unknown> | null;
};

type AccountedCredentials = {
  token?: string;
  api_key?: string;
  bearer_token?: string;
};

export function createAccountedService(integration: AccountedIntegration, secret: string) {
  const config = integration.config || {};
  const baseUrl = String(config.base_url || config.accounted_base_url || '').trim().replace(/\/$/, '');
  const companyId = String(config.accounted_company_id || config.external_tenant_id || '').trim();
  if (!baseUrl) throw new Error('Accounted saknar API-bas-URL. Ange den i bokföringskopplingen.');
  if (!companyId) throw new Error('Accounted saknar company-id. Ange det i bokföringskopplingen.');

  const credentials = parseCredentials(secret);
  const token = credentials.bearer_token || credentials.api_key || credentials.token;
  if (!token) throw new Error('Accounted saknar API-token.');

  async function request(path: string, options: { method?: string; body?: unknown; idempotencyKey?: string } = {}) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) {
      const detail = typeof payload?.error === 'string' ? payload.error : text.slice(0, 500);
      throw new Error(`Accounted svarade ${response.status}: ${detail}`);
    }
    return payload?.data ?? payload;
  }

  return {
    companyId,
    async testConnection() {
      return request(`/companies/${encodeURIComponent(companyId)}`);
    },
    async sync(item: any, entity: any) {
      if (item.action === 'delete' || item.action === 'void') {
        throw new Error('Accounted-synken stöder inte radering eller makulering från VI-HEM ännu.');
      }
      const path = accountedPath(companyId, item.entity_type);
      const body = accountedPayload(item.entity_type, entity);
      const result = await request(path, {
        method: 'POST',
        body,
        idempotencyKey: `vihem-${item.id}`,
      });
      const externalId = String(result?.id || result?.reference || result?.number || result?.invoiceNumber || '');
      if (!externalId) throw new Error('Accounted returnerade inget externt id.');
      return { external_id: externalId };
    },
  };
}

function parseCredentials(secret: string): AccountedCredentials {
  const value = secret.trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return parsed as AccountedCredentials;
  } catch { /* rå token */ }
  return { token: value };
}

function accountedPath(companyId: string, entityType: string) {
  const resource = entityType === 'supplier_invoice' ? 'supplier-invoices' : `${entityType}s`;
  return `/companies/${encodeURIComponent(companyId)}/${resource}`;
}

function accountedPayload(entityType: string, entity: any) {
  if (entityType === 'customer') return {
    name: entity.name,
    email: entity.invoice_email || entity.email || undefined,
    phone: entity.phone || undefined,
    organisationNumber: entity.organisation_number || undefined,
    address: entity.address_line1 || undefined,
    postalCode: entity.postal_code || undefined,
    city: entity.city || undefined,
    country: entity.country_code || 'SE',
  };
  if (entityType === 'supplier') return {
    name: entity.name,
    email: entity.email || undefined,
    phone: entity.phone || undefined,
    organisationNumber: entity.organisation_number || undefined,
    address: entity.address_line1 || undefined,
    postalCode: entity.postal_code || undefined,
    city: entity.city || undefined,
    country: entity.country_code || 'SE',
  };
  if (entityType === 'invoice') return {
    customerId: entity.customer?.external_accounting_id || undefined,
    invoiceNumber: entity.invoice_number || undefined,
    invoiceDate: entity.invoice_date,
    dueDate: entity.due_date,
    currency: entity.currency || 'SEK',
    lines: (entity.lines || []).map((line: any) => ({
      description: line.description || 'Rad',
      quantity: Number(line.quantity || 1),
      unitPrice: Number(line.unit_price || 0),
      vatRate: Number(line.vat_rate || 0),
      accountCode: line.account_code || undefined,
    })),
  };
  if (entityType === 'supplier_invoice') return {
    supplierId: entity.supplier?.external_accounting_id || undefined,
    invoiceNumber: entity.supplier_invoice_number || undefined,
    invoiceDate: entity.invoice_date,
    dueDate: entity.due_date,
    currency: entity.currency || 'SEK',
    totalAmount: Number(entity.total_amount || 0),
    lines: (entity.lines || []).map((line: any) => ({
      description: line.description || 'Rad',
      amount: Number(line.line_total_excl_vat || 0),
      vatRate: Number(line.vat_rate || 0),
      accountCode: line.account_code || undefined,
    })),
  };
  if (entityType === 'payment') return {
    invoiceId: entity.invoice?.external_accounting_id || undefined,
    amount: Number(entity.amount || 0),
    paymentDate: entity.payment_date,
  };
  throw new Error(`Accounted-adaptern saknar stöd för ${entityType}.`);
}

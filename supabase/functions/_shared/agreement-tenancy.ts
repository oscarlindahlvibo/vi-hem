// Turns a signed residential lease (Avtal V2) into the actual tenancy:
// connects the linked tenant to the linked apartment, marks the apartment
// rented and brings its ordinary rent in line with what was signed.
// Previously signing a lease left the apartment vacant at its old rent
// and staff had to link tenant + apartment by hand afterwards.
//
// Values come from the FROZEN version (what the tenant actually signed),
// never the draft: monthly rent from the price table's "hyra" row (not the
// deposit) and the start date from the "Tillträdesdatum" date block.
//
// Idempotent and conservative -- it never creates a second active tenancy
// and never takes over an apartment that already has a different active
// tenant; it reports why it didn't instead.

export type TenancyFromAgreementResult =
  | { status: "created"; tenancy_id: string; monthly_rent: number; start_date: string; apartment_rent_updated: boolean }
  | { status: "exists"; tenancy_id: string }
  | { status: "skipped"; reason: string }
  | { status: "conflict"; reason: string };

function toNumber(value: unknown): number | null {
  const n = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function extractRent(blocks: any[]): { rent: number | null; vat: number } {
  for (const block of blocks) {
    if (block?.block_type !== "price_table") continue;
    for (const item of block.content?.items || []) {
      const description = String(item?.description || "");
      if (!/hyra/i.test(description) || /depos/i.test(description)) continue;
      const unit = toNumber(item.unit_price);
      const qty = toNumber(item.quantity) ?? 1;
      if (unit !== null && unit > 0) return { rent: Math.round(unit * qty * 100) / 100, vat: toNumber(item.vat_rate) ?? 0 };
    }
  }
  return { rent: null, vat: 0 };
}

function extractStartDate(blocks: any[]): string | null {
  const dates = new Set<string>();
  for (const block of blocks) {
    if (block?.block_type !== "date") continue;
    if (!/tillträd|inflytt|start/i.test(String(block.content?.label || ""))) continue;
    // A signed date may include a note about a different temporary apartment.
    // Only the leading date belongs to this linked tenancy; never scan the note.
    const value = String(block.content?.value || "").trim();
    const match = /^(\d{4}-\d{2}-\d{2})(?=$|\s|\()/.exec(value);
    if (!match) return null;
    const date = match[1];
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
    dates.add(date);
  }
  // Missing, invalid or conflicting dates need staff review, never today's date.
  return dates.size === 1 ? [...dates][0] : null;
}

export async function createTenancyFromAgreement(db: any, agreementId: string, actorId: string | null): Promise<TenancyFromAgreementResult> {
  const { data: agreement } = await db
    .from("vihem_agreements")
    .select("id, organisation_id, status, document_type, document_number, current_version_id")
    .eq("id", agreementId)
    .maybeSingle();
  if (!agreement) return { status: "skipped", reason: "Dokumentet hittades inte." };
  if (agreement.document_type !== "agreement" || agreement.status !== "signed") return { status: "skipped", reason: "Bara signerade avtal kan skapa ett hyresförhållande." };

  const { data: links } = await db.from("vihem_agreement_entity_links").select("entity_type, entity_id").eq("agreement_id", agreementId);
  const tenantId = (links || []).find((l: any) => l.entity_type === "tenant")?.entity_id;
  const apartmentId = (links || []).find((l: any) => l.entity_type === "apartment")?.entity_id;
  if (!tenantId || !apartmentId) return { status: "skipped", reason: "Avtalet är inte kopplat till både hyresgäst och lägenhet." };

  const [{ data: apartment }, { data: tenant }] = await Promise.all([
    db.from("vihem_apartments").select("id, property_id, rent, status, organisation_id").eq("id", apartmentId).maybeSingle(),
    db.from("vihem_profiles").select("id, organisation_id").eq("id", tenantId).maybeSingle(),
  ]);
  if (!apartment || !tenant) return { status: "skipped", reason: "Hyresgästen eller lägenheten finns inte längre." };
  if (apartment.organisation_id !== agreement.organisation_id || tenant.organisation_id !== agreement.organisation_id) {
    return { status: "skipped", reason: "Hyresgäst och lägenhet tillhör inte samma organisation som avtalet." };
  }

  const { data: active } = await db.from("vihem_tenancies").select("id, tenant_id").eq("apartment_id", apartmentId).eq("status", "active");
  const same = (active || []).find((t: any) => t.tenant_id === tenantId);
  if (same) return { status: "exists", tenancy_id: same.id };
  if ((active || []).length > 0) return { status: "conflict", reason: "Lägenheten har redan en annan aktiv hyresgäst." };

  if (!agreement.current_version_id) return { status: "skipped", reason: "Avtalet saknar en fryst version. Hyresförhållandet behöver granskas." };
  const { data: version } = await db.from("vihem_agreement_versions").select("blocks").eq("id", agreement.current_version_id).eq("agreement_id", agreementId).maybeSingle();
  if (!version || !Array.isArray(version.blocks)) return { status: "skipped", reason: "Den signerade avtalsversionen kunde inte läsas." };
  const blocks: any[] = version.blocks;
  const { rent, vat } = extractRent(blocks);
  const startDate = extractStartDate(blocks);
  if (!startDate) return { status: "skipped", reason: "Tillträdesdatumet i det signerade avtalet saknas eller är otydligt. Hyresförhållandet behöver granskas innan det skapas." };
  const monthlyRent = rent ?? Number(apartment.rent ?? 0);

  const { data: tenancy, error } = await db.from("vihem_tenancies").insert({
    tenant_id: tenantId,
    apartment_id: apartmentId,
    property_id: apartment.property_id,
    organisation_id: agreement.organisation_id,
    start_date: startDate,
    monthly_rent: monthlyRent,
    rent_vat_rate: vat,
    status: "active",
  }).select("id").single();
  if (error || !tenancy) return { status: "skipped", reason: `Kunde inte skapa hyresförhållandet: ${error?.message || "okänt fel"}` };

  const apartmentUpdate: Record<string, unknown> = { status: "rented" };
  const rentUpdated = rent !== null && rent !== Number(apartment.rent);
  if (rentUpdated) apartmentUpdate.rent = rent;
  await db.from("vihem_apartments").update(apartmentUpdate).eq("id", apartmentId);

  await db.from("vihem_agreement_audit_events").insert({
    agreement_id: agreementId,
    event_type: "tenancy_created",
    actor_type: actorId ? "staff" : "system",
    metadata: { tenancy_id: tenancy.id, tenant_id: tenantId, apartment_id: apartmentId, monthly_rent: monthlyRent, start_date: startDate, apartment_rent_updated: rentUpdated, previous_apartment_rent: apartment.rent },
  });

  return { status: "created", tenancy_id: tenancy.id, monthly_rent: monthlyRent, start_date: startDate, apartment_rent_updated: rentUpdated };
}

// Dynamic-field resolution + immutable version freezing for Avtal V2.
//
// Dynamic fields are written as {{namespace.field}} inside a block's text
// content (e.g. a paragraph block's `content.text`, or a dedicated
// dynamic_field block's `content.token`). Resolution happens ONCE, at
// freeze time (when an agreement is sent for signing) -- resolved values
// are baked into the version's `blocks` jsonb so a later change to the
// underlying tenant/apartment/org record can never retroactively alter a
// signed document. See 20260822110000_agreements_v2_core.sql's header for
// the full rationale.
//
// Deliberately NOT locked to a fixed set of tokens: `context` is an open
// namespace -> {field -> value} map assembled by the caller (typically from
// vihem_agreement_entity_links), and any {{namespace.field}} not present in
// it resolves to an empty string rather than throwing, so an agreement
// author can reference a field that happens not to apply to this
// particular agreement's links without breaking the freeze.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface AgreementBlock {
  id: string;
  block_type: string;
  content: Record<string, unknown>;
}

export type DynamicFieldContext = Record<string, Record<string, string>>;

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\}\}/g;

export function resolveTokensInText(text: string, context: DynamicFieldContext): string {
  return text.replace(TOKEN_RE, (_match, ns: string, field: string) => {
    const value = context[ns]?.[field];
    return value !== undefined && value !== null ? String(value) : "";
  });
}

/** Recursively resolves {{ns.field}} tokens in every string value of a block's content. */
function resolveBlockContent(content: Record<string, unknown>, context: DynamicFieldContext): Record<string, unknown> {
  const resolveValue = (value: unknown): unknown => {
    if (typeof value === "string") return resolveTokensInText(value, context);
    if (Array.isArray(value)) return value.map(resolveValue);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveValue(v);
      return out;
    }
    return value;
  };
  return resolveValue(content) as Record<string, unknown>;
}

export function resolveBlocks(blocks: AgreementBlock[], context: DynamicFieldContext): AgreementBlock[] {
  return blocks.map((b) => ({ ...b, content: resolveBlockContent(b.content, context) }));
}

/**
 * Loads {{namespace.field}} context from an agreement's entity links
 * (vihem_agreement_entity_links) plus a few always-available namespaces
 * (today, organisation). Not an exhaustive registry of every possible
 * field -- callers/templates can reference any field that exists on the
 * relevant table; unmapped ones simply resolve empty (see module header).
 */
export async function buildDynamicFieldContext(
  adminClient: SupabaseClient,
  organisationId: string,
): Promise<DynamicFieldContext> {
  const today = new Date().toISOString().slice(0, 10);
  const context: DynamicFieldContext = {
    today: { date: today, iso: today },
  };

  const { data: org } = await adminClient
    .from("vihem_organisations")
    .select("name")
    .eq("id", organisationId)
    .maybeSingle();
  if (org) context.organisation = { name: org.name || "" };

  return context;
}

/** Merges per-entity-link field data (tenant, apartment, property, ...) into a base context. */
export function mergeEntityContext(
  base: DynamicFieldContext,
  namespace: string,
  fields: Record<string, unknown>,
): DynamicFieldContext {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    flat[k] = String(v);
  }
  return { ...base, [namespace]: { ...(base[namespace] || {}), ...flat } };
}

/**
 * Canonical JSON serialisation (recursively sorted object keys, no
 * whitespace) so the same logical content always hashes identically
 * regardless of key insertion order -- required for content_hash to be a
 * meaningful, reproducible integrity check rather than an accident of JS
 * object iteration order.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash of a frozen version's content -- the exact thing every signature request/signature pins itself to. */
export async function hashBlocks(blocks: AgreementBlock[]): Promise<string> {
  return sha256Hex(canonicalJson(blocks));
}

// Shared by the send action (freeze) and the editor's live preview
// (vihem-agreements-admin get_preview_context) so a preview can never
// resolve differently from what the signer is actually sent.
export async function mergeLinkedEntity(db: any, context: DynamicFieldContext, entityType: string, entityId: string): Promise<DynamicFieldContext> {
  try {
    switch (entityType) {
      case "tenant": {
        // vihem_profiles has no general personal_number column (only
        // bankid_personal_number, populated post-login, not a reliable
        // general-purpose field) -- selecting it here would error. Caught
        // by re-checking the actual schema while building the party
        // picker below, not by the earlier end-to-end test (which never
        // exercised a 'tenant' entity link).
        const { data } = await db.from("vihem_profiles").select("name, email, phone").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "tenant", data) : context;
      }
      case "apartment": {
        // address lives on the parent property, not the apartment row
        // itself (vihem_apartments has no address column) -- joined here
        // so {{apartment.address}} still resolves per the brief's example
        // token list.
        const { data } = await db
          .from("vihem_apartments")
          .select("apartment_number, size, rooms, property:property_id(address)")
          .eq("id", entityId)
          .maybeSingle();
        if (!data) return context;
        const property = data.property as { address?: string } | { address?: string }[] | null;
        const address = Array.isArray(property) ? property[0]?.address : property?.address;
        return mergeEntityContext(context, "apartment", { apartment_number: data.apartment_number, size: data.size, rooms: data.rooms, address: address || "" });
      }
      case "property": {
        const { data } = await db.from("vihem_properties").select("name, address").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "property", data) : context;
      }
      case "finance_customer": {
        const { data } = await db.from("vihem_finance_customers").select("name, email, phone, organisation_number").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "customer", data) : context;
      }
      case "customer_project": {
        // vihem_customer_projects has no "title" column (only name +
        // customer_name) -- another mismatch caught by re-checking the
        // actual schema rather than trusting the earlier assumption.
        const { data } = await db.from("vihem_customer_projects").select("name, customer_name").eq("id", entityId).maybeSingle();
        return data ? mergeEntityContext(context, "project", { name: data.name || "", customer_name: data.customer_name || "" }) : context;
      }
      default:
        return context;
    }
  } catch {
    return context;
  }
}

/** Base (today/organisation) context + one namespace per linked entity. */
export async function buildContextFromLinks(
  db: any,
  organisationId: string,
  links: Array<{ entity_type: string; entity_id: string }>,
): Promise<DynamicFieldContext> {
  let context = await buildDynamicFieldContext(db, organisationId);
  for (const link of links) {
    context = await mergeLinkedEntity(db, context, link.entity_type, link.entity_id);
  }
  return context;
}

import { useState } from "react";
import { Button } from "../../../components/ui";
import { supabase } from "../../../lib/supabase";
import type { Board, Batch, Entry } from "./types";
import { flagLabels } from "./types";
import type { Mutate } from "./AvailabilityPattern";
import { SnowForm } from "./Forms";
import { money, exportSnowBatch } from "./presentation";
export function Billing({
  board,
  mutate,
  busy,
  from,
  to,
  refresh,
}: {
  board: Board;
  mutate: Mutate;
  busy: boolean;
  from: string;
  to: string;
  refresh: () => Promise<void>;
}) {
  const [review, setReview] = useState<Entry | null>(null),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [reconcile, setReconcile] = useState<Batch | null>(null),
    [release, setRelease] = useState<Batch | null>(null);
  const groups = new Map<string, Entry[]>();
  board.entries
    .filter((e) => e.end_time && e.status === "approved" && !e.reserved)
    .forEach((e) => {
      const c = board.clients.find((c) => c.id === e.snow_client_id);
      const k = `${c?.finance_customer_id}:${c?.company_id}:${c?.invoice_reference}`;
      groups.set(k, [...(groups.get(k) || []), e]);
    });
  async function accounted(batch: Batch, reconcileInvoiceId?: string) {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      const { error } = await supabase.functions.invoke(
        "vihem-snow-accounted",
        {
          body: {
            batch_id: batch.id,
            ...(reconcileInvoiceId
              ? { reconcile_invoice_id: reconcileInvoiceId }
              : {}),
          },
        },
      );
      if (error) throw error;
      await refresh();
    } catch {
      setError(
        "Accounted kunde inte bekräftas. Underlaget är låst. Stäm av eventuellt befintligt utkast i Accounted – skapa inte en ny kopia.",
      );
      await refresh().catch(() => {});
      if (reconcileInvoiceId)
        throw Error(
          "Det befintliga utkastet kunde inte stämmas av. Kontrollera UUID, kund, referens och belopp.",
        );
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="snow-panel">
      <header>
        <h2>Granskning och fakturaunderlag</h2>
        <p>
          Tidsgodkännande skapar aldrig faktura. Granska priser och
          kunduppgifter, lås ett underlag och skapa sedan uttryckligen ett
          utkast i Accounted.
        </p>
      </header>
      <h3>Pass som behöver hanteras</h3>
      {board.entries
        .filter(
          (e) =>
            e.end_time && !e.reserved && (e.status !== "approved" || !e.priced),
        )
        .map((e) => (
          <div className="snow-review" key={e.id}>
            <div>
              <strong>
                {board.clients.find((c) => c.id === e.snow_client_id)?.name}
              </strong>
              <p>
                {e.total_minutes} min ·{" "}
                {e.snow_review_flags
                  .map((f) => flagLabels[f] || f)
                  .join(", ") ||
                  (!e.priced ? "Prisbild saknas" : "Inväntar granskning")}
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setReview(e)}
            >
              Granska och godkänn
            </Button>
          </div>
        ))}
      <h3>Ofakturerat, godkänt arbete</h3>
      {[...groups.entries()].map(([key, entries]) => {
        const c = board.clients.find((c) => c.id === entries[0].snow_client_id),
          lines = entries.flatMap((e) => e.valuation || []),
          net = lines.reduce((n, l) => n + Number(l.net), 0),
          vat = lines.reduce((n, l) => n + Number(l.vat), 0);
        return (
          <article className="snow-invitation" key={key}>
            <strong>
              {entries
                .map(
                  (e) =>
                    board.clients.find((c) => c.id === e.snow_client_id)?.name,
                )
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(" / ")}
            </strong>
            <p>
              {entries.length} pass · Referens:{" "}
              {c?.invoice_reference || "saknas"} · {money(net)} + {money(vat)}{" "}
              moms
            </p>
            <details>
              <summary>Visa specifikation</summary>
              {entries.map((e) => (
                <p key={e.id}>
                  {new Date(e.start_time).toLocaleDateString("sv-SE", {
                    timeZone: "Europe/Stockholm",
                  })}{" "}
                  ·{" "}
                  {board.resources.find((r) => r.id === e.snow_resource_id)
                    ?.name || "Handarbete"}{" "}
                  · {e.total_minutes} min ·{" "}
                  {e.priced ? "Prisbild sparad" : "Pris saknas"}
                </p>
              ))}
            </details>
            <Button
              disabled={
                busy ||
                entries.some((e) => !e.priced) ||
                !c?.company_id ||
                !c?.finance_customer_id
              }
              onClick={() =>
                void mutate("invoice_prepare", {
                  entries: entries.map((e) => e.id),
                  company_id: c?.company_id,
                  reference: c?.invoice_reference,
                  from,
                  to,
                }).catch(() => {})
              }
            >
              Lås granskat fakturaunderlag
            </Button>
          </article>
        );
      })}
      <h3>Låsta underlag</h3>
      {board.batches.map((b) => (
        <article className="snow-invitation" key={b.id}>
          <strong>
            {b.snapshot.customer.name} · {money(b.snapshot.gross)}
          </strong>
          <p>
            Kundens del {money(b.snapshot.customer_payable)} · RUT{" "}
            {money(b.snapshot.rut)}
          </p>
          <p>
            {b.state === "cancelled"
              ? "Återöppnat för rättelse · tidigare underlag bevarat"
              : b.state === "draft_created"
                ? `Utkast bekräftat i Accounted · ${b.accounted_invoice_id}`
                : b.state === "uncertain"
                  ? "Extern status okänd – underlaget förblir reserverat"
                  : b.state === "processing"
                    ? "Överföring pågår"
                    : "Granskat och låst · inte fakturerat"}
          </p>
          <div className="snow-inline">
            <Button variant="secondary" onClick={() => exportSnowBatch(b)}>
              Exportera specifikation (CSV / Excel)
            </Button>
            {["uncertain", "processing"].includes(b.state) && (
              <Button variant="secondary" onClick={() => setReconcile(b)}>
                Stäm av befintligt utkast
              </Button>
            )}
            {b.state === "prepared" && (
              <Button variant="ghost" onClick={() => setRelease(b)}>
                Återöppna för rättelse
              </Button>
            )}
            {b.state === "prepared" && (
              <Button disabled={sending} onClick={() => void accounted(b)}>
                {b.state === "prepared"
                  ? "Skapa utkast i Accounted"
                  : "Kontrollera / säkert återförsök"}
              </Button>
            )}
          </div>
        </article>
      ))}
      {!groups.size && !board.batches.length && (
        <p className="snow-empty">Inga fakturaunderlag i perioden.</p>
      )}
      {release && (
        <SnowForm
          title="Återöppna underlag som aldrig överförts"
          busy={busy}
          onClose={() => setRelease(null)}
          fields={[
            {
              key: "reason",
              label: "Orsak (minst fyra tecken)",
              required: true,
            },
          ]}
          onSave={(v) =>
            mutate("invoice_release", {
              batch_id: release.id,
              reason: v.reason,
            })
          }
        />
      )}
      {reconcile && (
        <SnowForm
          title="Stäm av ett befintligt Accounted-utkast"
          busy={sending}
          onClose={() => setReconcile(null)}
          fields={[
            {
              key: "invoice_id",
              label: "Utkastets UUID från Accounted (inga nya fakturor skapas)",
              required: true,
            },
          ]}
          onSave={(v) => accounted(reconcile, v.invoice_id)}
        />
      )}
      {review && (
        <SnowForm
          title="Godkänn efter manuell granskning"
          busy={busy}
          onClose={() => setReview(null)}
          fields={[
            {
              key: "reason",
              label: "Kontroll och orsak (sparas i revisionshistoriken)",
              required: true,
            },
          ]}
          onSave={(v) =>
            mutate("review", { entry_id: review.id, reason: v.reason })
          }
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

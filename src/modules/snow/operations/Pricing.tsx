import { useState } from "react";
import { Button } from "../../../components/ui";
import type { Board } from "./types";
import { kindLabels } from "./types";
import { SnowForm } from "./Forms";
import { options } from "./presentation";
import type { Mutate } from "./AvailabilityPattern";
import { calendarDay } from "../availability";
export function Pricing({
  board,
  mutate,
  busy,
}: {
  board: Board;
  mutate: Mutate;
  busy: boolean;
}) {
  const [create, setCreate] = useState(false);
  return (
    <section className="snow-panel">
      <header>
        <h2>Prislistor och historiska prisversioner</h2>
        <p>
          Arbete, maskin, material och resor hålls åtskilda. Inga exempelpriser
          är aktiva. Godkända pass behåller sin sparade prisbild när en ny
          prisversion skapas.
        </p>
      </header>
      {board.admin && (
        <Button onClick={() => setCreate(true)}>Ny prisversion</Button>
      )}
      <div className="snow-resource-grid">
        {board.prices.map((p) => (
          <article key={p.id}>
            <strong>{p.label}</strong>
            <p>
              {kindLabels[p.kind]} ·{" "}
              {p.client_id
                ? board.clients.find((c) => c.id === p.client_id)?.name
                : "Organisationens standard"}
            </p>
            <p>
              {Number(p.amount).toLocaleString("sv-SE")} kr exkl. moms /{" "}
              {p.mode === "hour"
                ? "timme"
                : p.mode === "fixed"
                  ? "fast pris"
                  : "enhet"}{" "}
              · {p.vat_rate}% moms
            </p>
            <p>
              Giltig {p.valid_from}–{p.valid_until || "tills vidare"}
            </p>
            <p>
              {p.from_minutes}–{p.to_minutes || "∞"} min ·{" "}
              {p.rut_eligible
                ? "Arbetsrad kan prövas för RUT"
                : "Ingen RUT på denna kostnad"}
            </p>
          </article>
        ))}
      </div>
      {!board.prices.length && (
        <p className="snow-empty">
          Administrationen behöver lägga upp era avtalade priser.
        </p>
      )}
      {create && (
        <SnowForm
          title="Ny prisversion"
          busy={busy}
          onClose={() => setCreate(false)}
          initial={{
            activity: "snow_plowing",
            kind: "labor",
            mode: "hour",
            vat_rate: "25",
            includes_vat: "false",
            minimum_quantity: "0",
            round_minutes: "1",
            from_minutes: "0",
            valid_from: calendarDay(),
            rut_eligible: "false",
          }}
          fields={[
            {
              key: "client_id",
              label: "Uppdrag",
              options: options(board.clients, "Standard för alla uppdrag"),
            },
            {
              key: "activity",
              label: "Tjänst",
              options: [
                { value: "snow_plowing", label: "Snöröjning" },
                { value: "snow_sanding", label: "Halkbekämpning / sandning" },
              ],
            },
            {
              key: "kind",
              label: "Kostnadstyp",
              options: Object.entries(kindLabels).map(([value, label]) => ({
                value,
                label,
              })),
            },
            { key: "label", label: "Benämning på fakturan", required: true },
            {
              key: "mode",
              label: "Prismodell",
              options: [
                { value: "hour", label: "Per timme" },
                { value: "fixed", label: "Fast belopp inom tidsintervallet" },
                {
                  value: "quantity",
                  label: "Per registrerad material-/reseenhet",
                },
              ],
            },
            {
              key: "amount",
              label: "Belopp i kronor",
              type: "number",
              required: true,
            },
            {
              key: "includes_vat",
              label: "Angivet belopp",
              options: [
                { value: "false", label: "Exklusive moms" },
                { value: "true", label: "Inklusive moms" },
              ],
            },
            {
              key: "vat_rate",
              label: "Moms (%)",
              options: [
                { value: "25", label: "25%" },
                { value: "12", label: "12%" },
                { value: "6", label: "6%" },
                { value: "0", label: "0% – kontrollera tillämplighet" },
              ],
            },
            {
              key: "minimum_quantity",
              label: "Minsta debitering (timmar för timpris)",
              type: "number",
            },
            {
              key: "round_minutes",
              label: "Avrundning uppåt till minuter",
              type: "number",
            },
            {
              key: "from_minutes",
              label: "Från minuter (över denna gräns)",
              type: "number",
            },
            {
              key: "to_minutes",
              label: "Till och med minuter (tomt = obegränsat)",
              type: "number",
            },
            {
              key: "valid_from",
              label: "Giltig från",
              type: "date",
              required: true,
            },
            { key: "valid_until", label: "Giltig till", type: "date" },
            {
              key: "rut_eligible",
              label: "Endast arbetskostnad kan prövas för RUT",
              options: [
                { value: "false", label: "Nej" },
                {
                  value: "true",
                  label: "Ja – berättigad arbetsrad, kontroll krävs",
                },
              ],
            },
          ]}
          onSave={(v) =>
            mutate("price", {
              ...v,
              includes_vat: v.includes_vat === "true",
              rut_eligible: v.rut_eligible === "true",
            })
          }
        />
      )}
    </section>
  );
}

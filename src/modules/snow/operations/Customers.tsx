import { useState } from "react";
import { supabase } from "../../../lib/supabase";
import { Button, Input, Select } from "../../../components/ui";
import type { Board, Customer, Assignment } from "./types";
import type { Mutate } from "./AvailabilityPattern";
import { SnowForm } from "./Forms";
import { options } from "./presentation";
const customerFields = [
  { key: "name", label: "Namn / företag", required: true },
  { key: "email", label: "E-post", type: "email" },
  { key: "phone", label: "Telefon" },
  { key: "address", label: "Adress" },
  { key: "postal_code", label: "Postnummer" },
  { key: "city", label: "Ort" },
];
export function Customers({
  board,
  mutate,
  busy,
  onWork,
}: {
  board: Board;
  mutate: Mutate;
  busy: boolean;
  onWork: () => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Customer[]>([]),
    [customer, setCustomer] = useState<Customer | null>(null),
    [create, setCreate] = useState(false),
    [extra, setExtra] = useState(false),
    [link, setLink] = useState<Assignment | null>(null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  async function search() {
    const { data, error } = await supabase.rpc("vihem_snow_customers", {
      p_query: query,
    });
    if (error) setError(error.message);
    else {
      setResults(data as Customer[]);
      setError("");
    }
  }
  return (
    <section className="snow-panel">
      <header>
        <h2>Kunder och extrauppdrag</h2>
        <p>
          Sök i ekonomins befintliga kundregister innan du skapar en ny kund.
          Saknade fakturauppgifter stoppar faktureringen, inte registreringen av
          arbete.
        </p>
      </header>
      <div className="snow-inline">
        <Input
          label="Sök kund (minst två tecken)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="secondary" onClick={() => void search()}>
          Sök kund
        </Button>
        <Button variant="secondary" onClick={() => setCreate(true)}>
          Ny kund
        </Button>
      </div>
      {results.map((c) => (
        <button
          className="snow-customer"
          key={c.id}
          onClick={() => setCustomer(c)}
          aria-pressed={customer?.id === c.id}
        >
          <strong>{c.name}</strong>
          <span>
            {c.address_line1} {c.city}
          </span>
        </button>
      ))}
      {customer && (
        <div className="snow-inline">
          <strong>Vald kund: {customer.name}</strong>
          <Button onClick={() => setExtra(true)}>Nytt extrauppdrag</Button>
          {board.admin && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Komplettera fakturauppgifter
            </Button>
          )}
        </div>
      )}
      {board.admin && (
        <div className="divide-y">
          {board.clients.map((c) => (
            <div className="snow-inline py-3" key={c.id}>
              <strong>{c.name}</strong>
              <span>
                {c.finance_customer_id ? "Kundkopplad" : "Juridisk kund saknas"}{" "}
                · {c.company_id ? "Bolag valt" : "Bolag saknas"}
              </span>
              <Button variant="ghost" onClick={() => setLink(c)}>
                Koppla kund / bolag
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {create && (
        <SnowForm
          title="Ny kund i ekonomiregistret"
          busy={busy}
          onClose={() => setCreate(false)}
          initial={{ customer_type: "private" }}
          fields={[
            {
              key: "customer_type",
              label: "Typ",
              options: [
                { value: "private", label: "Privatperson" },
                { value: "company", label: "Företag" },
              ],
            },
            ...customerFields,
          ]}
          onSave={async (v) => {
            await mutate("customer_create", v);
            setQuery(v.name);
            const { data } = await supabase.rpc("vihem_snow_customers", {
              p_query: v.name,
            });
            setResults(data || []);
          }}
        />
      )}
      {extra && customer && (
        <SnowForm
          title={`Extrauppdrag · ${customer.name}`}
          busy={busy}
          onClose={() => setExtra(false)}
          initial={{
            name: `Extraarbete · ${customer.name}`,
            rut_requested: "false",
          }}
          fields={[
            { key: "name", label: "Uppdrag / adress", required: true },
            { key: "instructions", label: "Utförande och prisöverenskommelse" },
            {
              key: "rut_requested",
              label: "Kunden önskar RUT (måste granskas före fakturering)",
              options: [
                { value: "false", label: "Nej" },
                { value: "true", label: "Ja · granskning krävs" },
              ],
            },
          ]}
          onSave={async (v) => {
            await mutate("extra_assignment", {
              ...v,
              customer_id: customer.id,
              rut_requested: v.rut_requested === "true",
            });
            onWork();
          }}
        />
      )}
      {link && (
        <SnowForm
          title={`Fakturakoppling · ${link.name}`}
          busy={busy}
          onClose={() => setLink(null)}
          initial={{
            finance_customer_id: link.finance_customer_id || customer?.id || "",
            company_id: link.company_id || "",
            reference: link.invoice_reference,
            cost_center: link.cost_center,
          }}
          fields={[
            {
              key: "finance_customer_id",
              label: "Juridisk kund (sök och välj ovan)",
              options: options([
                ...results,
                ...(link.finance_customer_id &&
                !results.some((c) => c.id === link.finance_customer_id) &&
                customer?.id !== link.finance_customer_id
                  ? [
                      {
                        id: link.finance_customer_id,
                        name: "Nuvarande kundkoppling",
                      },
                    ]
                  : []),
                ...(customer && !results.some((c) => c.id === customer.id)
                  ? [customer]
                  : []),
              ]),
            },
            {
              key: "company_id",
              label: "Fakturerande bolag",
              options: options(board.companies),
            },
            { key: "reference", label: "Kundens fakturareferens" },
            { key: "cost_center", label: "Kostnadsställe" },
          ]}
          onSave={(v) =>
            mutate("assignment", { ...v, id: link.id, revision: link.revision })
          }
        />
      )}
      {editing && customer && (
        <SnowForm
          title="Faktureringsuppgifter / RUT"
          busy={busy}
          onClose={() => setEditing(false)}
          initial={{
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            address: customer.address_line1,
            postal_code: customer.postal_code,
            city: customer.city,
            tax_checked: "false",
          }}
          fields={[
            ...customerFields,
            {
              key: "personnummer",
              label:
                "Personnummer för RUT (12 siffror) – endast administration",
              type: "password",
            },
            { key: "housing", label: "Fastighetsbeteckning (RUT)" },
            {
              key: "tax_checked",
              label: "Villkor och kunduppgifter granskade för RUT",
              options: [
                { value: "false", label: "Ej granskade" },
                { value: "true", label: "Granskade av administration" },
              ],
            },
          ]}
          onSave={(v) =>
            mutate("customer_update", {
              ...v,
              id: customer.id,
              revision: customer.revision,
              tax_checked: v.tax_checked === "true",
            })
          }
        />
      )}
      <p className="snow-hint">
        En digital kundsignering är inte aktiverad. Dokumentera
        prisöverenskommelsen och kontrollera uppgifterna före fakturering.
      </p>
    </section>
  );
}

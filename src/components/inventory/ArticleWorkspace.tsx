import { ArrowDownLeft, ArrowRightLeft, Package, QrCode } from "lucide-react";
import { Button, Modal, Tabs } from "../ui";
import { useEffect, useState } from "react";
interface Article {
  id: string;
  name: string;
  article_number: string;
  category: string;
  supplier: string;
  unit: string;
  purchase_price: number;
  minimum_stock: number;
  notes: string;
  image_url: string;
}
interface Movement {
  id: string;
  item_id: string;
  quantity: number;
  transaction_type: string;
  source_location_id: string | null;
  destination_location_id: string | null;
  notes: string;
  created_at: string;
}
const labels: Record<string, string> = {
  stock_in: "Inleverans",
  stock_out: "Uttag",
  transfer: "Förflyttning",
  return: "Återlämning",
  adjustment: "Justering",
  inventory_adjustment: "Inventering",
  waste: "Kassation",
  correction: "Rättelse",
};
const number = (n: number) =>
  new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 3 }).format(n);
export function ArticleWorkspace({
  article,
  balances,
  movements,
  locationName,
  onClose,
  onMove,
  onPrint,
}: {
  article: Article | null;
  balances: { item_id: string; location_id: string; quantity: number }[];
  movements: Movement[];
  locationName: (id: string | null) => string;
  onClose: () => void;
  onMove: (id: string, type: string, source?: string) => void;
  onPrint: (item: Article) => void;
}) {
  const [tab, setTab] = useState("stock");
  useEffect(() => {
    setTab("stock");
  }, [article?.id]);
  if (!article) return null;
  const stock = balances.filter((b) => b.item_id === article.id),
    total = stock.reduce((n, b) => n + Number(b.quantity), 0),
    history = movements.filter((m) => m.item_id === article.id);
  return (
    <Modal
      mobileFullscreen
      open
      onClose={onClose}
      title={article.name}
      size="xl"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onMove(article.id, "stock_in")}
          >
            <ArrowDownLeft className="h-4 w-4" />
            Inleverans
          </Button>
          <Button onClick={() => onMove(article.id, "stock_out")}>
            <ArrowRightLeft className="h-4 w-4" />
            Ta ut material
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 sm:grid-cols-[112px_1fr]">
        {article.image_url ? (
          <img
            src={article.image_url}
            alt={article.name}
            className="h-16 w-16 sm:h-28 sm:w-28 rounded-2xl object-contain bg-vihem-soft"
          />
        ) : (
          <div className="flex h-16 w-16 sm:h-28 sm:w-28 items-center justify-center rounded-2xl bg-vihem-soft text-vihem-muted">
            <Package className="h-9 w-9" />
          </div>
        )}
        <div>
          <p className="text-sm text-vihem-muted">
            {[article.article_number, article.category, article.supplier]
              .filter(Boolean)
              .join(" · ") || "Lagerartikel"}
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-vihem-navy">
            {number(total)}{" "}
            <span className="text-base font-normal text-vihem-muted">
              {article.unit} i lager
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-vihem-muted">
            <span>
              Minsta saldo {number(article.minimum_stock)} {article.unit}
            </span>
            <span>Inköpspris {number(article.purchase_price)} kr</span>
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: "stock", label: `Lagerplatser (${stock.length})` },
            { key: "history", label: "Rörelser" },
            { key: "info", label: "Artikelinformation" },
          ]}
        />
      </div>
      {tab === "stock" && (
        <div className="mt-4 divide-y divide-vihem-line">
          {stock.map((b) => (
            <div
              key={b.location_id}
              className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-vihem-navy">
                  {locationName(b.location_id)}
                </p>
                <p className="mt-1 text-sm tabular-nums text-vihem-muted">
                  {number(b.quantity)} {article.unit}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={b.quantity <= 0}
                onClick={() => onMove(article.id, "transfer", b.location_id)}
                aria-label={`Flytta från ${locationName(b.location_id)}`}
              >
                <ArrowRightLeft className="h-4 w-4" />
                Flytta
              </Button>
            </div>
          ))}
          {!stock.length && (
            <p className="py-8 text-sm text-vihem-muted">
              Inget saldo registrerat. Börja med en inleverans.
            </p>
          )}
        </div>
      )}
      {tab === "history" && (
        <section className="mt-4">
          <p className="mb-3 text-xs text-vihem-muted">
            Visar artikelns rörelser bland de 100 senaste i organisationen.
          </p>
          <div className="divide-y divide-vihem-line">
            {history.map((m) => (
              <article key={m.id} className="py-3">
                <div className="flex justify-between gap-4">
                  <p className="font-medium">
                    {labels[m.transaction_type] || m.transaction_type}
                  </p>
                  <p className="shrink-0 font-medium tabular-nums">
                    {number(m.quantity)} {article.unit}
                  </p>
                </div>
                <p className="mt-1 text-sm text-vihem-muted">
                  {[
                    m.source_location_id && locationName(m.source_location_id),
                    m.destination_location_id &&
                      locationName(m.destination_location_id),
                  ]
                    .filter(Boolean)
                    .join(" → ")}
                </p>
                {m.notes && (
                  <p className="mt-2 whitespace-pre-wrap text-sm">{m.notes}</p>
                )}
                <time className="mt-2 block text-xs text-vihem-muted">
                  {new Date(m.created_at).toLocaleString("sv-SE", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </article>
            ))}
            {!history.length && (
              <p className="py-8 text-sm text-vihem-muted">
                Inga rörelser i den hämtade historiken.
              </p>
            )}
          </div>
        </section>
      )}
      {tab === "info" && (
        <section className="mt-5 space-y-5">
          {article.notes && (
            <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed">
              {article.notes}
            </p>
          )}
          <Button variant="secondary" onClick={() => onPrint(article)}>
            <QrCode className="h-4 w-4" />
            Skriv ut artikeletikett
          </Button>
        </section>
      )}
    </Modal>
  );
}

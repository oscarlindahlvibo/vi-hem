import { useEffect, useRef, useState } from "react";
import { ApiError, type BankIdResult, type BankIdStart } from "../lib/api";

const HINTS: Record<string, string> = {
  outstandingTransaction: "Starta BankID-appen.", noClient: "Starta BankID-appen.", userSign: "Skriv din säkerhetskod i BankID-appen.", started: "Söker efter BankID…",
  userCancel: "Avbrutet i BankID-appen.", expiredTransaction: "BankID-sessionen gick ut. Försök igen.", startFailed: "BankID kunde inte startas. Försök igen.", no_personal_number: "BankID gav inget personnummer.",
};

/** Startar BankID, visar QR-kod och knapp för samma enhet, och pollar tills det är klart. Själva beslutet (inloggning/länkning) tas av servern. */
export function BankIdButton({ label, start, collect, onDone, className = "btn ghost" }: { label: string; start: () => Promise<BankIdStart>; collect: (orderRef: string) => Promise<BankIdResult>; onDone: (r: BankIdResult) => void; className?: string }) {
  const [order, setOrder] = useState<BankIdStart | null>(null);
  const [hint, setHint] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (!order) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await collect(order.orderRef);
        if (stop || !alive.current) return;
        if (r.status === "pending") { setHint(HINTS[r.hintCode ?? ""] ?? "Väntar på BankID…"); return void (timer = window.setTimeout(tick, 2000)); }
        setOrder(null);
        if (r.status === "failed") { setError(HINTS[r.hintCode ?? ""] ?? "BankID-identifieringen misslyckades. Försök igen."); return; }
        onDone(r);
      } catch (e) { if (!stop && alive.current) { setOrder(null); setError((e as ApiError).message); } }
    };
    let timer = window.setTimeout(tick, 1500);
    return () => { stop = true; window.clearTimeout(timer); };
  }, [order]);
  const begin = async () => { setBusy(true); setError(""); setHint(""); try { setOrder(await start()); } catch (e) { setError((e as ApiError).message); } setBusy(false); };
  if (!order) return <div><button type="button" className={className} disabled={busy} onClick={begin}>{busy ? "Startar BankID…" : label}</button>{error && <p className="notice error" role="alert" style={{ marginTop: 10 }}>{error}</p>}</div>;
  return <div className="card" style={{ margin: 0, textAlign: "center" }} aria-live="polite">
    <p><strong>Identifiera dig med BankID</strong></p>
    {order.qrImage && <img src={/^(data:|https:)/.test(order.qrImage) ? order.qrImage : `data:image/png;base64,${order.qrImage}`} alt="QR-kod att skanna med BankID-appen" width={180} height={180} />}
    {order.autoStartUrl && <p><a className="btn primary" href={order.autoStartUrl}>Öppna BankID på den här enheten</a></p>}
    <p className="fine" role="status">{hint || "Väntar på BankID…"}</p>
    <button type="button" className="text-link" onClick={() => setOrder(null)}>Avbryt</button>
  </div>;
}

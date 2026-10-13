import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type BankIdResult, type BankIdStart } from "../lib/api";

const HINTS: Record<string, string> = {
  outstandingTransaction: "Starta BankID-appen.", noClient: "Starta BankID-appen.", userSign: "Skriv din säkerhetskod i BankID-appen.", started: "Söker efter BankID…",
  userCancel: "Avbrutet i BankID-appen.", expiredTransaction: "BankID-sessionen gick ut. Försök igen.", startFailed: "BankID kunde inte startas. Försök igen.", cancelled: "Avbrutet.", no_personal_number: "BankID gav inget personnummer.",
};
const QR_REFRESH_MS = 5000; // BankSignerings QR-bild gäller bara kort tid och måste hämtas om med ny cache-parameter var 5:e sekund
const POLL_MS = 2000;
const MAX_POLLS = 90; // ca 3 minuter, samma som BankID-orderns livslängd
const RESUME_MS = 3 * 60 * 1000;
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const withStamp = (url: string) => `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;

type SignupInfo = { orderRef: string; given: string; surname: string };

/** BankID-flöde som speglar VI-HEM: QR-koden hämtas om var 5:e sekund, på mobil används knapp som öppnar BankID-appen (med återgång till sidan),
 * pågående order återupptas när man kommer tillbaka, och status pollas var 2:a sekund. Själva beslutet (inloggning/länkning) tas av servern. */
export function BankIdButton({ intent, label, start, collect, onDone, signup, returnPath, className = "btn ghost" }: {
  intent: "auth" | "link"; label: string; start: () => Promise<BankIdStart>; collect: (orderRef: string) => Promise<BankIdResult>; onDone: (r: BankIdResult) => void;
  signup?: (p: { order_ref: string; email: string; accepted_privacy: boolean; consent_identity: boolean }) => Promise<{ message: string }>; returnPath: string; className?: string;
}) {
  const storageKey = `kp_bankid_pending_${intent}`;
  const [order, setOrder] = useState<BankIdStart | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [hint, setHint] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [su, setSu] = useState<SignupInfo | null>(null); const [done, setDone] = useState("");
  const alive = useRef(true); const cancelled = useRef(false); const pollTimer = useRef<number | null>(null); const qrTimer = useRef<number | null>(null);

  const stop = useCallback(() => { if (pollTimer.current) window.clearTimeout(pollTimer.current); if (qrTimer.current) window.clearInterval(qrTimer.current); pollTimer.current = null; qrTimer.current = null; }, []);
  const clearPending = useCallback(() => { try { localStorage.removeItem(storageKey); } catch { /* valfritt */ } }, [storageKey]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancelled.current = true; stop(); }; }, [stop]);

  const finish = useCallback((message?: string) => { stop(); clearPending(); setOrder(null); setQr(null); if (message) setError(message); }, [stop, clearPending]);

  const poll = useCallback((orderRef: string, attempt: number, netFails = 0) => {
    if (cancelled.current) return;
    pollTimer.current = window.setTimeout(async () => {
      if (cancelled.current || !alive.current) return;
      if (attempt >= MAX_POLLS) return finish("BankID-sessionen tog för lång tid. Försök igen.");
      if (document.visibilityState === "hidden") { setHint("Väntar på att du återgår från BankID-appen…"); return poll(orderRef, attempt, netFails); }
      try {
        const r = await collect(orderRef);
        if (cancelled.current || !alive.current) return;
        if (r.status === "pending") { setHint(HINTS[r.hintCode ?? ""] ?? "Väntar på godkännande i BankID-appen…"); return poll(orderRef, attempt + 1, 0); }
        if (r.status === "failed") return finish(HINTS[r.hintCode ?? ""] ?? "BankID-identifieringen misslyckades. Försök igen.");
        // klart
        if (r.signup_available && signup) { stop(); clearPending(); setOrder(null); setQr(null); setSu({ orderRef, given: r.given_name ?? "", surname: r.surname ?? "" }); return; }
        finish(); onDone(r);
      } catch (e) {
        if (cancelled.current || !alive.current) return;
        if ((e as ApiError).code === "E_NETWORK" && netFails < 15) return poll(orderRef, attempt + 1, netFails + 1); // kort nätavbrott medan BankID-appen är i förgrunden
        finish((e as ApiError).message || "BankID-anropet misslyckades.");
      }
    }, POLL_MS);
  }, [collect, finish, onDone, signup, stop, clearPending]);

  const begin = (o: BankIdStart) => {
    cancelled.current = false; setOrder(o); setError(""); setHint("");
    try { localStorage.setItem(storageKey, JSON.stringify({ orderRef: o.orderRef, startedAt: Date.now() })); } catch { /* valfritt */ }
    if (o.qrImage) { setQr(withStamp(o.qrImage)); qrTimer.current = window.setInterval(() => setQr(withStamp(o.qrImage!)), QR_REFRESH_MS); }
    poll(o.orderRef, 0);
  };
  const startFlow = async () => { stop(); setBusy(true); setError(""); try { begin(await start()); } catch (e) { setError((e as ApiError).message); } setBusy(false); };

  // Återuppta när BankID-appen skickar tillbaka webbläsaren (kan landa i ny flik): ordern ligger i localStorage
  useEffect(() => {
    let raw: string | null = null; try { raw = localStorage.getItem(storageKey); } catch { raw = null; }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { orderRef: string; startedAt: number };
      if (!saved.orderRef || Date.now() - saved.startedAt > RESUME_MS) return clearPending();
      cancelled.current = false; setOrder({ orderRef: saved.orderRef, autoStartToken: "", autoStartUrl: "", qrImage: null }); setHint("Slutför BankID-godkännandet…"); poll(saved.orderRef, 0);
    } catch { clearPending(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const launchUrl = order?.autoStartToken ? `https://app.bankid.com/?autostarttoken=${encodeURIComponent(order.autoStartToken)}&redirect=${encodeURIComponent(`${window.location.origin}${returnPath}`)}` : order?.autoStartUrl || "";
  const cancel = () => { cancelled.current = true; finish(); };

  const [f, setF] = useState({ email: "", privacy: false, consent: false }); const [suBusy, setSuBusy] = useState(false);
  const submitSignup = async (e: FormEvent) => { e.preventDefault(); if (!su || !signup) return; setSuBusy(true); setError(""); try { const r = await signup({ order_ref: su.orderRef, email: f.email.trim(), accepted_privacy: f.privacy, consent_identity: f.consent }); setSu(null); setDone(r.message); } catch (err) { setError((err as ApiError).message); } setSuBusy(false); };

  if (done) return <p className="notice ok" role="status">{done}</p>;
  if (su) return <form onSubmit={submitSignup} className="card" style={{ margin: 0, display: "grid", gap: 12 }}>
    <p><strong>Du är identifierad{su.given ? `, ${su.given} ${su.surname}` : ""}.</strong> Det finns inget konto för detta BankID ännu. Ange din e-postadress så skapar vi kontot åt dig.</p>
    <label>E-post<input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
    <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> Jag samtycker till att mitt personnummer sparas krypterat för identitetskontroll och eventuell ID06-registrering.</label>
    <label className="check"><input type="checkbox" checked={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.checked })} /> Jag har tagit del av integritetspolicyn.</label>
    {error && <p className="notice error" role="alert">{error}</p>}
    <button className="btn primary" disabled={suBusy || !f.privacy || !f.consent}>{suBusy ? "Skapar konto…" : "Skapa konto"}</button>
    <button type="button" className="text-link" onClick={() => { setSu(null); setError(""); }}>Avbryt</button></form>;
  if (!order) return <div><button type="button" className={className} disabled={busy} onClick={startFlow}>{busy ? "Startar BankID…" : label}</button>{error && <p className="notice error" role="alert" style={{ marginTop: 10 }}>{error}</p>}</div>;
  const mobile = isMobile();
  return <div className="card" style={{ margin: 0, textAlign: "center" }} aria-live="polite">
    <p><strong>Identifiera dig med BankID</strong></p>
    {mobile && launchUrl && <p><a className="btn primary" href={launchUrl}>Öppna BankID-appen</a></p>}
    {qr && <img src={qr} alt="QR-kod att skanna med BankID-appen. Koden uppdateras automatiskt." width={176} height={176} style={{ background: "#fff", padding: 8, borderRadius: 12, border: "1px solid var(--line)" }} />}
    {!mobile && launchUrl && <p className="fine"><a href={launchUrl}>Har du BankID på den här enheten? Öppna appen här</a></p>}
    <p className="fine" role="status">{hint || (qr ? "Skanna QR-koden med BankID-appen." : "Väntar på BankID…")}</p>
    <button type="button" className="text-link" onClick={cancel}>Avbryt</button>
  </div>;
}

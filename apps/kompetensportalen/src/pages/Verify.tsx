import { FormEvent, useEffect, useState } from "react";
import { ApiError, pub } from "../lib/api";
import { CERT_LABEL, dateOnly } from "../lib/format";
import { navigate, useLocation } from "../lib/router";
import { useSeo } from "../lib/seo";

const BADGE: Record<string, [string, string, string]> = { valid: ["Giltigt", "ok", "Intyget är giltigt."], expired: ["Utgånget", "warn", "Intyget har passerat sitt slutdatum."], revoked: ["Återkallat", "error", "Intyget är återkallat och gäller inte längre."], superseded: ["Ersatt", "warn", "Intyget har ersatts av ett nyare intyg."] };

export function VerifyPage() {
  const { search } = useLocation(); const initial = search.get("kod") || "";
  const [code, setCode] = useState(initial); const [res, setRes] = useState<any>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useSeo({ title: "Verifiera intyg | Kompetensportalen", description: "Kontrollera äktheten och giltigheten av ett intyg från Kompetensportalen med verifieringskod eller intygsnummer.", noindex: !!initial });
  async function run(c: string) { setBusy(true); setError(""); setRes(null); try { setRes(await pub.verify(c.trim())); } catch (e) { setError((e as ApiError).message); } setBusy(false); }
  useEffect(() => { if (initial) void run(initial); }, [initial]);
  function submit(e: FormEvent) { e.preventDefault(); navigate(`/verifiera?kod=${encodeURIComponent(code.trim())}`); if (code.trim() === initial) void run(code); }
  return <section className="section narrow"><p className="eyebrow">Verifiering</p><h1>Verifiera intyg</h1><p className="lead">Ange verifieringskoden eller intygsnumret, eller skanna QR-koden på intyget.</p>
    <form onSubmit={submit} className="row" style={{ alignItems: "flex-end" }}><label style={{ flex: 1, minWidth: 220 }}>Verifieringskod eller intygsnummer<input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="t.ex. K7M2Q9XA4BTE" autoComplete="off" /></label><button className="btn primary" disabled={busy}>{busy ? "Kontrollerar…" : "Verifiera"}</button></form>
    <div aria-live="polite">{error && <p className="notice error">{error}</p>}
      {res && !res.found && <p className="notice error" style={{ marginTop: 18 }}>Inget intyg hittades med den koden. Kontrollera att du skrivit rätt.</p>}
      {res?.found && (() => { const [label, tone, text] = BADGE[res.status] ?? ["Okänd", "muted", ""]; return <div className="card" style={{ marginTop: 18 }}><p><span className={`status ${tone}`}>{label}</span></p><p className="muted">{text}{res.replaced_by_number ? ` Ersatt av ${res.replaced_by_number}.` : ""}</p>
        <dl><div><dt>Namn</dt><dd>{res.holder_name}</dd></div><div><dt>Utbildning</dt><dd>{res.course_title}</dd></div><div><dt>Typ</dt><dd>{CERT_LABEL[res.kind]}</dd></div><div><dt>Genomförd</dt><dd>{dateOnly(res.completed_on)}</dd></div><div><dt>Giltigt till</dt><dd>{res.valid_until ? dateOnly(res.valid_until) : "Ingen utgångstid"}</dd></div><div><dt>Intygsnummer</dt><dd>{res.certificate_number}</dd></div><div><dt>Utfärdare</dt><dd>{res.issuer}</dd></div>{res.id06_registered && <div><dt>ID06 Kompetensdatabas</dt><dd>Registrerad</dd></div>}</dl>
        <p className="fine">{res.kind === "competence_proof" ? "Detta är ett kompetensbevis utfärdat av utbildningsföretaget och ingen myndighetscertifiering." : "Detta är ett utbildningsintyg och ingen myndighetscertifiering."} Av integritetsskäl visas inga personnummer eller provresultat.</p></div>; })()}</div></section>;
}

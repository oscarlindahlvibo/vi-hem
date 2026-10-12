import { FormEvent, useEffect, useState } from "react";
import { ApiError, pub, supabase } from "../lib/api";
import { Link, navigate, useLocation } from "../lib/router";
import { useSeo } from "../lib/seo";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/mina-sidor");

export function Login() {
  const { search } = useLocation(); const next = safeNext(search.get("next"));
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [unconfirmed, setUnconfirmed] = useState(false), [note, setNote] = useState("");
  useSeo({ title: "Logga in | Kompetensportalen", noindex: true });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setUnconfirmed(false);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }); setBusy(false);
    if (!error) return navigate(next);
    if (/confirm/i.test(error.message)) { setUnconfirmed(true); setError("Din e-postadress är inte bekräftad ännu. Kontrollera din inkorg eller be om en ny länk."); } else setError("Fel e-postadress eller lösenord.");
  }
  return <section className="section narrow"><div className="card"><p className="eyebrow">Mina sidor</p><h1>Logga in</h1>
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}><label>E-post<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Lösenord<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p className="notice error" role="alert">{error}</p>}{note && <p className="notice ok" role="status">{note}</p>}
      <button className="btn primary" disabled={busy}>{busy ? "Loggar in…" : "Logga in"}</button></form>
    {unconfirmed && <p><button className="text-link" onClick={async () => { const r = await pub.resendVerification(email).catch(() => null); setNote(r?.message ?? "Försök igen om en stund."); }}>Skicka ny bekräftelselänk</button></p>}
    <p><Link to="/glomt-losenord" className="text-link">Glömt lösenordet?</Link></p><hr /><p>Ny hos oss? <Link to={`/skapa-konto?next=${encodeURIComponent(next)}`} className="text-link">Skapa konto</Link></p></div></section>;
}

export function Register() {
  const { search } = useLocation(); const next = safeNext(search.get("next"));
  const [f, setF] = useState({ first_name: "", last_name: "", email: "", password: "", accepted_privacy: false }); const [state, setState] = useState<"idle" | "busy" | "done">("idle"); const [error, setError] = useState("");
  useSeo({ title: "Skapa konto | Kompetensportalen", noindex: true });
  async function submit(e: FormEvent) { e.preventDefault(); setState("busy"); setError(""); try { await pub.register(f); setState("done"); } catch (err) { setError((err as ApiError).message); setState("idle"); } }
  if (state === "done") return <section className="section narrow"><div className="card"><h1>Kontrollera din e-post</h1><p>Vi har skickat en länk för att bekräfta <strong>{f.email}</strong>. Klicka på länken och logga sedan in för att fortsätta.</p><p className="fine">Hittar du inget mejl? Titta i skräpposten eller <Link to="/logga-in" className="text-link">be om en ny länk</Link>.</p><Link className="btn primary" to={`/logga-in?next=${encodeURIComponent(next)}`}>Till inloggning</Link></div></section>;
  return <section className="section narrow"><div className="card"><p className="eyebrow">Nytt konto</p><h1>Skapa konto</h1><p className="muted">Kontot behövs för att köpa, genomföra utbildningar och hämta dina intyg.</p>
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}><div className="grid2"><label>Förnamn<input required autoComplete="given-name" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></label><label>Efternamn<input required autoComplete="family-name" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></label></div>
      <label>E-post<input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label>Lösenord<input type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><span className="fine">Minst 10 tecken med både bokstäver och siffror.</span></label>
      <label className="check"><input type="checkbox" checked={f.accepted_privacy} onChange={(e) => setF({ ...f, accepted_privacy: e.target.checked })} /> Jag har tagit del av <Link to="/integritet" className="text-link">integritetspolicyn</Link>.</label>
      {error && <p className="notice error" role="alert">{error}</p>}<button className="btn primary" disabled={state === "busy" || !f.accepted_privacy}>{state === "busy" ? "Skapar…" : "Skapa konto"}</button></form>
    <p>Har du redan konto? <Link to={`/logga-in?next=${encodeURIComponent(next)}`} className="text-link">Logga in</Link></p></div></section>;
}

export function ConfirmEmail() {
  const { search } = useLocation(); const [state, setState] = useState<"busy" | "ok" | "error">("busy"); const [msg, setMsg] = useState("");
  useSeo({ title: "Bekräfta e-post | Kompetensportalen", noindex: true });
  useEffect(() => { pub.verifyEmail(search.get("token") || "").then(() => setState("ok")).catch((e) => { setMsg((e as ApiError).message); setState("error"); }); }, []);
  return <section className="section narrow"><div className="card"><h1>{state === "ok" ? "E-postadressen är bekräftad" : state === "busy" ? "Bekräftar…" : "Det gick inte"}</h1>{state === "ok" && <><p>Ditt konto är aktiverat. Du kan nu logga in.</p><Link className="btn primary" to="/logga-in">Logga in</Link></>}{state === "error" && <><p className="notice error">{msg}</p><Link className="btn ghost" to="/logga-in">Be om ny länk</Link></>}</div></section>;
}

export function ForgotPassword() {
  const [email, setEmail] = useState(""); const [done, setDone] = useState(""); const [busy, setBusy] = useState(false);
  useSeo({ title: "Glömt lösenord | Kompetensportalen", noindex: true });
  return <section className="section narrow"><div className="card"><h1>Glömt lösenord</h1>{done ? <p className="notice ok" role="status">{done}</p> : <form style={{ display: "grid", gap: 14 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await pub.requestReset(email).catch((err) => ({ message: (err as ApiError).message })); setDone(r.message); setBusy(false); }}><label>E-post<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label><button className="btn primary" disabled={busy}>Skicka återställningslänk</button></form>}<p><Link to="/logga-in" className="text-link">Tillbaka till inloggning</Link></p></div></section>;
}

export function ResetPassword() {
  const { search } = useLocation(); const [password, setPassword] = useState(""); const [state, setState] = useState<"idle" | "busy" | "done">("idle"); const [error, setError] = useState("");
  useSeo({ title: "Nytt lösenord | Kompetensportalen", noindex: true });
  async function submit(e: FormEvent) { e.preventDefault(); setState("busy"); setError(""); try { await pub.resetPassword(search.get("token") || "", password); setState("done"); } catch (err) { setError((err as ApiError).message); setState("idle"); } }
  return <section className="section narrow"><div className="card"><h1>Nytt lösenord</h1>{state === "done" ? <><p className="notice ok" role="status">Lösenordet är uppdaterat.</p><Link className="btn primary" to="/logga-in">Logga in</Link></> : <form style={{ display: "grid", gap: 14 }} onSubmit={submit}><label>Nytt lösenord<input type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /><span className="fine">Minst 10 tecken med både bokstäver och siffror.</span></label>{error && <p className="notice error" role="alert">{error}</p>}<button className="btn primary" disabled={state === "busy"}>Spara lösenord</button></form>}</div></section>;
}

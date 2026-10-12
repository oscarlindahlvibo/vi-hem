export const money = (v: number | string, decimals = 0) => new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(v || 0));
export const dateOnly = (v?: string | null, tz = "Europe/Stockholm") => (v ? new Date(v.length === 10 ? `${v}T12:00:00` : v).toLocaleDateString("sv-SE", { dateStyle: "long", timeZone: tz }) : "");
export const dateTime = (v: string, tz = "Europe/Stockholm") => new Date(v).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
export const duration = (minutes: number) => { if (minutes < 60) return `${minutes} min`; const h = Math.floor(minutes / 60), m = minutes % 60; return m ? `${h} tim ${m} min` : `${h} tim`; };
export const validityLabel = (months: number | null) => { if (!months) return "Ingen utgångstid"; if (months % 12 === 0) return `${months / 12} år`; return `${months} månader`; };
export const FORM_LABEL: Record<string, string> = { self_paced: "Digital utbildning (egen takt)", instructor_led: "Lärarledd utbildning", hybrid: "Blandad: digitalt + lärarledd" };
export const CERT_LABEL: Record<string, string> = { training_certificate: "Utbildningsintyg", competence_proof: "Kompetensbevis" };
export const statusLabel: Record<string, string> = { not_started: "Ej påbörjad", in_progress: "Pågår", awaiting_identity: "Väntar på identitetsverifiering", completed: "Genomförd", expired: "Utgången", cancelled: "Avbruten", revoked: "Återkallad",
  pending_payment: "Väntar på betalning", awaiting_invoice_approval: "Väntar på godkännande", invoiced: "Fakturerad", paid: "Betald", fulfilled: "Levererad", failed: "Misslyckades", refunded: "Återbetald", partially_refunded: "Delvis återbetald",
  issued: "Giltigt", valid: "Giltigt", revoked_cert: "Återkallat", superseded: "Ersatt" };
export const slugToTitle = (s: string) => s.replace(/-/g, " ");

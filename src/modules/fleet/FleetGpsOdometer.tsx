import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { Button, Card, Input, Modal } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";

type Estimate = {
  baseline_km: number;
  baseline_at: string;
  distance_km: number;
  last_at: string;
  gap_count: number;
  late_samples: number;
  rejected_segments: number;
  needs_calibration: boolean;
  calibration_revision: number;
};
const km = (value: number) =>
  new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }).format(value);
const stamp = (value: string) =>
  new Date(value).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" });

export function FleetGpsOdometer({ vehicleId, onCalibrated }: {
  vehicleId: string;
  onCalibrated: (valueKm: number) => void;
}) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loadError, setLoadError] = useState("");
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [formRevision, setFormRevision] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  useUnsavedChanges(value, open && value !== "");
  const load = useCallback(async () => {
    try {
    const { data, error } = await supabase.from("vihem_fleet_gps_odometer")
      .select("baseline_km,baseline_at,distance_km,last_at,gap_count,late_samples,rejected_segments,needs_calibration,calibration_revision")
      .eq("vehicle_id", vehicleId).maybeSingle();
    if (error) setLoadError("GPS-mätaren kunde inte hämtas. Försök uppdatera igen.");
    else { setEstimate(data); setLoadError(""); setReady(true); }
    } catch { setLoadError("GPS-mätaren kunde inte hämtas. Kontrollera anslutningen och försök igen."); }
  }, [vehicleId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  const save = async () => {
    if (lock.current) return;
    const parsed = Number(value.trim().replace(",", "."));
    if (!value.trim() || !Number.isFinite(parsed) || parsed < 0 || parsed > 10000000) {
      setError("Ange bilens avlästa mätarställning i km, utan tusentalsmellanslag."); return;
    }
    lock.current = true; setBusy(true); setError("");
    try {
      const { error } = await supabase.rpc("vihem_fleet_calibrate_gps_odometer", {
        p_vehicle: vehicleId, p_km: parsed, p_revision: formRevision,
      });
      if (error) {
        if (error.code === "40001") { setConflict(true); await load(); }
        throw Error(error.message || "Kunde inte spara avstämningen. Försök igen.");
      }
      onCalibrated(parsed); setOpen(false); setValue("");
      setNotice("Avläsningen sparad. GPS-beräkningen börjar nu från detta värde.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunde inte spara. Ditt värde finns kvar.");
    } finally { lock.current = false; setBusy(false); }
  };
  const warnings = estimate ? estimate.gap_count + estimate.late_samples + estimate.rejected_segments : 0;
  return <>
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Gauge className="h-5 w-5" />Beräknad mätarställning</h3>
          {estimate ? <>
            <p className="mt-2 text-3xl font-semibold tabular-nums">≈ {km(Number(estimate.baseline_km) + Number(estimate.distance_km))} km</p>
            <p className="mt-1 text-sm text-slate-600">Avläst {km(estimate.baseline_km)} km + {km(estimate.distance_km)} km GPS-sträcka</p>
          </> : <p className="mt-2 max-w-xl text-sm text-slate-600">Ange bilens aktuella mätarställning. Därefter läggs GPS-beräknad körsträcka till, även om OBD-mätare saknas.</p>}
        </div>
        <Button type="button" variant="secondary" disabled={!ready || !!loadError} onClick={() => {
          setFormRevision(estimate?.calibration_revision ?? null); setError(""); setConflict(false); setOpen(true);
        }}>{estimate ? "Stäm av mot bilen" : "Ange startvärde"}</Button>
      </div>
      {estimate && <div className="mt-3 space-y-1 text-xs text-slate-500">
        <p>Manuell avläsning {stamp(estimate.baseline_at)} · GPS uppdaterad {stamp(estimate.last_at)}</p>
        <p>Uppskattning, inte uppmätt OBD. GPS-summan finns kvar även när positionshistorik gallras. Enhetens egen räknare används inte.</p>
        {Date.now() - Date.parse(estimate.last_at) > 300000 && <p className="text-amber-800">Inaktuell GPS-position. Senare körsträcka kan saknas.</p>}
        {(warnings > 0 || estimate.needs_calibration) && <p role="status" className="text-sm text-amber-800">
          {estimate.needs_calibration ? "GPS-enhetens tilldelning har ändrats. Beräkningen är pausad tills du stämmer av mot bilen." :
            `Kontrollera mot bilen: ${estimate.gap_count} GPS-avbrott, ${estimate.late_samples} sena poster och ${estimate.rejected_segments} orimliga hopp. Sträcka kan saknas.`}
        </p>}
      </div>}
      {loadError && <div role="alert" className="mt-3 text-sm text-red-700">{loadError} <Button type="button" variant="ghost" onClick={() => void load()}>Uppdatera</Button></div>}
      {notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
    </Card>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title={estimate ? "Stäm av mätarställning" : "Starta GPS-mätare"}
      footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Avbryt</Button>
        {conflict ? <Button type="button" onClick={() => { setFormRevision(estimate?.calibration_revision ?? null); setConflict(false); setError(""); }}>Bekräfta senaste avstämning</Button> :
          <Button type="button" loading={busy} onClick={() => void save()}>Spara avläsning</Button>}</>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Läs av mätaren när bilen står stilla och GPS-enheten är online. Ange kilometer, även om fordonet i övrigt använder svenska mil.</p>
        <Input label="Avläst mätarställning (km)" type="number" inputMode="decimal" min="0" max="10000000" step="0.1" disabled={busy} value={value} onChange={e => setValue(e.target.value)} />
        <p className="text-sm text-slate-600">Avläsningen registreras som manuell fordonsmätare. GPS-uppskattningen börjar från när du sparar. Tidigare resor räknas inte om, och efterföljande GPS-uppskattningar skriver inte över avläst serviceunderlag.</p>
        {estimate && <p className="text-sm">Senaste avstämning: {km(estimate.baseline_km)} km, {stamp(estimate.baseline_at)}. Vid ny avstämning sparas föregående uppskattning i fordonshistoriken.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  </>;
}

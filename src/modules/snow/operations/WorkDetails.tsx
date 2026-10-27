import { useState } from "react";
import { Button, Modal } from "../../../components/ui";
import { supabase } from "../../../lib/supabase";
import { SnowForm } from "./Forms";
import type { Board } from "./types";
interface ItemRequest {
  p_id: string;
  p_entry: string;
  p_price: string;
  p_quantity: number;
  p_comment: string;
}
interface Photo {
  id: string;
  path: string;
  ready: boolean;
}
export function WorkDetails({
  entryId,
  category,
  board,
}: {
  entryId: string;
  category: string;
  board: Board | null;
}) {
  const storageKey = `vihem.snow.item:${entryId}`;
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState<ItemRequest | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch {
      return null;
    }
  });
  async function sendItem(request: ItemRequest) {
    localStorage.setItem(storageKey, JSON.stringify(request));
    setPending(request);
    setBusy(true);
    try {
      const { error } = await supabase.rpc("vihem_snow_add_item", request);
      if (error) {
        if (/^[0-9A-Z]{5}$/.test(error.code || "")) {
          localStorage.removeItem(storageKey);
          setPending(null);
        }
        throw error;
      }
      localStorage.removeItem(storageKey);
      setPending(null);
      setSaved("Material / resa är registrerad på passet.");
    } finally {
      setBusy(false);
    }
  }
  const [item, setItem] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [photos, setPhotos] = useState<Photo[]>([]),
    [image, setImage] = useState("");
  async function list() {
    const { data, error } = await supabase
      .from("vihem_snow_photos")
      .select("id,path,ready")
      .eq("entry_id", entryId)
      .eq("ready", true);
    if (error) throw error;
    setPhotos(data || []);
  }
  async function upload(file: File) {
    if (busy) return;
    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[file.type];
    if (!extension || file.size > 10 * 1024 * 1024) {
      setError("Välj JPEG, PNG eller WebP, högst10 MB.");
      return;
    }
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      const { data: path, error } = await supabase.rpc("vihem_snow_photo", {
        p_id: id,
        p_entry: entryId,
        p_extension: extension,
        p_complete: false,
      });
      if (error) throw error;
      const { error: uploadError } = await supabase.storage
        .from("vihem-snow-photos")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      const { error: completeError } = await supabase.rpc("vihem_snow_photo", {
        p_id: id,
        p_entry: entryId,
        p_extension: extension,
        p_complete: true,
      });
      if (completeError) throw completeError;
      await list();
    } catch {
      setError(
        "Bilden kunde inte bekräftas. Tidrapporten påverkas inte. Behåll originalbilden och försök igen när anslutningen fungerar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="snow-panel">
      <div className="snow-inline">
        <Button
          variant="secondary"
          disabled={!!pending || busy}
          onClick={() => setItem(true)}
        >
          Material / resa
        </Button>
        <label className="cursor-pointer rounded-lg border px-4 py-3 text-sm font-semibold">
          Bifoga arbetsbild
          <input
            aria-label="Bifoga arbetsbild"
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </label>
        <Button
          variant="ghost"
          onClick={() =>
            void list().catch(() => setError("Bilderna kunde inte hämtas."))
          }
        >
          Visa arbetsbilder
        </Button>
      </div>
      {saved && <p role="status">{saved}</p>}
      {pending && (
        <p role="status">
          Materialregistreringen är ännu inte bekräftad.{" "}
          <Button
            disabled={busy}
            onClick={() =>
              void sendItem(pending).catch(() =>
                setError(
                  "Servern kunde inte bekräfta registreringen. Försök samma registrering igen.",
                ),
              )
            }
          >
            Återförsök samma registrering
          </Button>
        </p>
      )}
      {photos.map((p) => (
        <Button
          key={p.id}
          variant="secondary"
          onClick={() => {
            void supabase.storage
              .from("vihem-snow-photos")
              .createSignedUrl(p.path, 120)
              .then(({ data, error }) => {
                if (error) setError(error.message);
                else setImage(data.signedUrl);
              });
          }}
        >
          Öppna arbetsbild
        </Button>
      ))}
      {busy && <p role="status">Laddar upp bild…</p>}
      {error && <p role="alert">{error}</p>}
      {item && (
        <SnowForm
          title="Material eller resa"
          busy={busy}
          onClose={() => setItem(false)}
          fields={[
            {
              key: "price_id",
              label: "Prisrad",
              options: [
                { value: "", label: "Välj avtalad rad" },
                ...(board?.prices
                  .filter(
                    (p) =>
                      p.activity === category &&
                      ["material", "travel"].includes(p.kind),
                  )
                  .map((p) => ({
                    value: p.id,
                    label: `${p.label} · ${p.amount} kr exkl. moms`,
                  })) || []),
              ],
              required: true,
            },
            {
              key: "quantity",
              label: "Antal avtalade enheter",
              type: "number",
              required: true,
            },
            { key: "comment", label: "Utfört arbete / kommentar" },
          ]}
          onSave={async (v) => {
            await sendItem({
              p_id: crypto.randomUUID(),
              p_entry: entryId,
              p_price: v.price_id,
              p_quantity: Number(v.quantity),
              p_comment: v.comment || "",
            });
          }}
        />
      )}
      <Modal
        open={!!image}
        onClose={() => setImage("")}
        title="Privat arbetsbild"
      >
        <img
          src={image || undefined}
          alt="Bifogad arbetsbild"
          className="max-h-[70vh] w-full object-contain"
        />
      </Modal>
    </section>
  );
}

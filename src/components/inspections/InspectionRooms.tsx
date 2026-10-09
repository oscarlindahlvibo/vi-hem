import {
  Camera,
  Check,
  ChevronDown,
  ImagePlus,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button, Input, Textarea, Modal } from "../ui";
import { useState } from "react";
export type InspectionRoom = {
  name: string;
  condition: string;
  notes: string;
  photos: string[];
  reviewed?: boolean;
};
// Preserve the four existing inspection conditions; review is workflow metadata, not approval.
const conditions = [
  ["excellent", "Utmärkt"],
  ["good", "Bra"],
  ["fair", "Godkänd"],
  ["poor", "Dålig"],
];
export function InspectionRooms({
  rooms,
  change,
  add,
  remove,
  camera,
  upload,
  removePhoto,
  busy,
}: {
  rooms: InspectionRoom[];
  change: (index: number, patch: Partial<InspectionRoom>) => void;
  add: () => void;
  remove: (index: number) => void;
  camera: (index: number) => void;
  upload: (files: File[], index: number) => void;
  removePhoto: (url: string, index: number) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<number | null>(0);
  const [rename, setRename] = useState<number | null>(null),
    [pendingRemove, setPendingRemove] = useState<number | null>(null);
  const reviewed = rooms.filter((r) => r.reviewed).length;
  return (
    <section aria-label="Rumsobservationer" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-vihem-ink">
            Gå igenom rummen
          </h3>
          <p className="mt-1 text-sm text-vihem-muted">
            {reviewed} av {rooms.length} markerade som genomgångna
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            add();
            setExpanded(rooms.length);
          }}
        >
          <Plus size={16} />
          Lägg till rum
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label="Genomgångna rum"
        aria-valuenow={reviewed}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, rooms.length)}
        className="h-1.5 overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className="h-full rounded-full bg-vihem-blue transition-[width] motion-reduce:transition-none"
          style={{
            width: rooms.length ? `${(reviewed / rooms.length) * 100}%` : "0%",
          }}
        />
      </div>
      <p className="text-sm text-vihem-muted">
        Välj skick, lägg till bilder och markera varje rum när du är klar.
      </p>
      <div className="divide-y divide-vihem-line overflow-hidden rounded-xl border border-vihem-line">
        {rooms.map((room, i) => (
          <div key={i} className="bg-white">
            <button
              type="button"
              aria-expanded={expanded === i}
              aria-controls={`inspection-room-${i}`}
              className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-vihem-canvas"
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${room.reviewed ? "bg-blue-50 text-vihem-blue" : "bg-vihem-canvas text-vihem-muted"}`}
              >
                {room.reviewed ? <Check size={17} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-vihem-ink">
                  {room.name || "Nytt rum"}
                </span>
                <span className="mt-0.5 block text-sm text-vihem-muted">
                  {conditions.find(
                    ([value]) => value === room.condition,
                  )?.[1] || room.condition}
                  {room.photos.length
                    ? " · " + room.photos.length + " bilder"
                    : ""}
                </span>
              </span>
              <ChevronDown
                size={18}
                className={`text-vihem-muted transition-transform motion-reduce:transition-none ${expanded === i ? "rotate-180" : ""}`}
              />
            </button>
            {expanded === i && (
              <div id={`inspection-room-${i}`} className="space-y-4 px-4 pb-5">
                {(rename === i || !room.name) && (
                  <Input
                    label="Rumsnamn"
                    autoFocus={rename === i}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setRename(null);
                      }
                    }}
                    value={room.name}
                    onChange={(e) =>
                      change(i, { name: e.target.value, reviewed: false })
                    }
                  />
                )}
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-vihem-ink">
                    Rummets skick
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {conditions.map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={room.condition === value}
                        onClick={() =>
                          change(i, { condition: value, reviewed: false })
                        }
                        className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${room.condition === value ? "border-blue-600 bg-blue-50 text-blue-800" : "border-vihem-line bg-white text-vihem-muted hover:bg-vihem-canvas"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <Textarea
                  label="Noteringar"
                  rows={3}
                  placeholder={
                    room.condition === "poor"
                      ? "Beskriv vad som behöver åtgärdas…"
                      : "Beskriv observationer eller lämna tomt…"
                  }
                  value={room.notes}
                  onChange={(e) =>
                    change(i, { notes: e.target.value, reviewed: false })
                  }
                />
                <div className="flex flex-wrap gap-3">
                  {room.photos.map((url, pi) => (
                    <div key={url + pi} className="relative">
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Öppna bild ${pi + 1} för ${room.name}`}
                      >
                        <img
                          src={url}
                          alt={`${room.name}, bild ${pi + 1}`}
                          className="h-24 w-24 rounded-lg object-cover"
                        />
                      </a>
                      <button
                        type="button"
                        aria-label={`Ta bort bild ${pi + 1} för ${room.name}`}
                        className="vihem-icon-button absolute -right-2 -top-2 rounded-full bg-white text-red-700 shadow-sm"
                        disabled={busy}
                        onClick={() => removePhoto(url, i)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => camera(i)}
                  >
                    <Camera size={17} />
                    Ta bilder
                  </Button>
                  <label
                    className={`vihem-touch-target flex cursor-pointer items-center gap-2 rounded-xl border border-vihem-line px-3 text-sm font-medium ${busy ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <ImagePlus size={17} />
                    Välj bilder
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={busy}
                      className="sr-only"
                      aria-label={`Välj bilder för ${room.name}`}
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        e.target.value = "";
                        if (files.length) upload(files, i);
                      }}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-vihem-line pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPendingRemove(i)}
                  >
                    <Trash2 size={16} />
                    Ta bort rum
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRename(rename === i ? null : i)}
                  >
                    <Pencil size={16} />
                    {rename === i ? "Klart" : "Byt namn"}
                  </Button>
                  <Button
                    variant={room.reviewed ? "secondary" : "primary"}
                    disabled={busy}
                    onClick={() => {
                      change(i, { reviewed: !room.reviewed });
                      if (!room.reviewed && i < rooms.length - 1)
                        setExpanded(i + 1);
                    }}
                  >
                    <Check size={17} />
                    {room.reviewed
                      ? "Markerat som genomgånget"
                      : "Rum genomgånget"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        title="Ta bort rum?"
        size="sm"
      >
        <p className="text-sm text-vihem-muted">
          {pendingRemove !== null
            ? rooms[pendingRemove]?.name || "Rummet"
            : "Rummet"}{" "}
          och dess noteringar tas bort från besiktningen när du sparar.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPendingRemove(null)}>
            Avbryt
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (pendingRemove !== null) {
                remove(pendingRemove);
                setExpanded(Math.max(0, pendingRemove - 1));
                setRename(null);
              }
              setPendingRemove(null);
            }}
          >
            Ta bort rum
          </Button>
        </div>
      </Modal>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ImagePlus,
  ShieldCheck,
  Bell,
  KeyRound,
  Trash2,
  UserRound,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { clearAvatarPhotos } from "../lib/avatarPhotos";
import { prepareChatImage } from "../lib/chatMedia";
import { Avatar, Button, Card, Modal, PageHeader } from "../components/ui";

export function ProfilePage() {
  const { user, refreshProfile, bankIDAvailable } = useAuth();
  const [organisation, setOrganisation] = useState(""),
    [photo, setPhoto] = useState<ImageBitmap | null>(null),
    [fileBusy, setFileBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [remove, setRemove] = useState(false);
  const [zoom, setZoom] = useState(1),
    [x, setX] = useState(50),
    [y, setY] = useState(50);
  const canvas = useRef<HTMLCanvasElement>(null),
    picker = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null),
    operation = useRef(false),
    request = useRef(0);
  useEffect(() => {
    let live = true;
    if (user?.organisation_id)
      void supabase
        .from("vihem_organisations")
        .select("name")
        .eq("id", user.organisation_id)
        .single()
        .then(({ data }) => {
          if (live) setOrganisation(data?.name || "");
        });
    return () => {
      live = false;
    };
  }, [user?.organisation_id]);
  useEffect(
    () => () => {
      photo?.close();
    },
    [photo],
  );
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  useEffect(() => {
    if (!photo || !canvas.current) return;
    const side = Math.min(photo.width, photo.height) / zoom;
    const ctx = canvas.current.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 512, 512);
    ctx.drawImage(
      photo,
      ((photo.width - side) * x) / 100,
      ((photo.height - side) * y) / 100,
      side,
      side,
      0,
      0,
      512,
      512,
    );
  }, [photo, zoom, x, y]);
  async function select(file?: File) {
    if (!file) return;
    const epoch = ++request.current;
    setError("");
    setMessage("");
    setFileBusy(true);
    try {
      if (
        file.size > 10 * 1024 * 1024 ||
        !(
          /\.(heic|heif)$/i.test(file.name) ||
          [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
          ].includes(file.type)
        )
      )
        throw Error("Välj JPEG, PNG, WebP eller HEIC, högst 10 MB.");
      const image = await createImageBitmap(await prepareChatImage(file));
      if (epoch !== request.current) {
        image.close();
        return;
      }
      setPhoto(image);
      setX(50);
      setY(50);
      setZoom(1);
    } catch (err) {
      if (epoch === request.current)
        setError(
          err instanceof Error ? err.message : "Bilden kunde inte öppnas.",
        );
    } finally {
      if (epoch === request.current) setFileBusy(false);
    }
  }
  async function save(clear = false) {
    if (operation.current) return;
    operation.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (clear) {
        const { error } = await supabase.rpc("vihem_set_profile_photo", {
          path: null,
        });
        if (error) throw Error("Profilbilden kunde inte tas bort.");
      } else {
        const preview = canvas.current;
        if (!preview)
          throw Error("Förhandsvisningen saknas. Välj bilden igen.");
        const blob = await new Promise<Blob | null>((resolve) =>
          preview.toBlob(resolve, "image/jpeg", 0.9),
        );
        if (!blob) throw Error("Bilden kunde inte beskäras.");
        const data = new FormData();
        data.append(
          "file",
          new File([blob], "profilbild.jpg", { type: "image/jpeg" }),
        );
        const { error } = await supabase.functions.invoke(
          "vihem-profile-photo",
          { body: data },
        );
        if (error)
          throw Error(
            "Profilbilden kunde inte sparas. Kontrollera anslutningen och försök igen.",
          );
      }
      clearAvatarPhotos();
      const result = await refreshProfile();
      if (result.error)
        throw Error(
          "Bilden sparades, men profilen kunde inte uppdateras. Ladda om sidan.",
        );
      setPhoto(null);
      setRemove(false);
      setMessage(
        clear ? "Profilbilden är borttagen." : "Profilbilden är sparad.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunde inte spara.");
    } finally {
      operation.current = false;
      setSaving(false);
    }
  }
  if (!user) return null;
  const security = (type: string) =>
    window.dispatchEvent(
      new CustomEvent("vihem-profile-security", { detail: type }),
    );
  const role = {
    admin: "Administratör",
    staff: "Personal",
    tenant: "Hyresgäst",
    superadmin: "Plattformsadministratör",
    screen: "Skärmkonto",
  }[user.role];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Din profil"
        subtitle="Din identitet, profilbild och personliga inställningar."
        icon={UserRound}
      />
      <Card className="p-5 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar
            name={user.name}
            userId={user.id}
            src={user.avatar_url}
            size="xl"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight text-vihem-ink">
              {user.name}
            </h2>
            <p className="mt-1 text-sm text-vihem-muted">
              {role}
              {organisation ? " · " + organisation : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={fileBusy}
                onClick={() => picker.current?.click()}
              >
                <ImagePlus size={17} />
                Byt profilbild
              </Button>
              <Button
                variant="ghost"
                disabled={fileBusy}
                onClick={() => camera.current?.click()}
              >
                <Camera size={17} />
                Ta foto
              </Button>
              {(user.avatar_path || user.avatar_url) && (
                <Button variant="ghost" onClick={() => setRemove(true)}>
                  <Trash2 size={17} />
                  Ta bort
                </Button>
              )}
            </div>
          </div>
        </div>
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          hidden
          onChange={(e) => {
            void select(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="user"
          hidden
          onChange={(e) => {
            void select(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <p className="mt-5 text-sm text-vihem-muted">
          Bilden beskärs till en kvadrat och visas som en cirkulär avatar.
          Kameraval beror på din enhet.
        </p>
      </Card>
      {message && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {message}
        </p>
      )}
      {error && !photo && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-vihem-ink">
            Kontaktuppgifter
          </h2>
          <dl className="mt-4 space-y-4">
            <div>
              <dt className="text-sm text-vihem-muted">E-post</dt>
              <dd className="mt-1 break-words text-sm font-medium">
                {user.email}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-vihem-muted">Telefon</dt>
              <dd className="mt-1 text-sm font-medium">
                {user.phone || "Telefonnummer saknas"}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-sm text-vihem-muted">
            Kontakta administratören om dina kontouppgifter behöver ändras.
          </p>
        </Card>
        <Card className="p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-vihem-ink">
            Inställningar & säkerhet
          </h2>
          <div className="mt-3 space-y-1">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => security("notifications")}
            >
              <Bell size={18} />
              Notisinställningar
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => security("password")}
            >
              <KeyRound size={18} />
              Byt lösenord
            </Button>
            {bankIDAvailable && (
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => security("bankid")}
              >
                <ShieldCheck size={18} />
                {user.bankid_linked_at ? "BankID är kopplat" : "Koppla BankID"}
              </Button>
            )}
          </div>
        </Card>
      </div>
      <Modal
        open={!!photo}
        onClose={() => {
          if (!saving) setPhoto(null);
        }}
        title="Anpassa profilbild"
        size="sm"
      >
        <div className="space-y-5">
          <canvas
            ref={canvas}
            width={512}
            height={512}
            aria-label="Förhandsvisning av beskärningen"
            className="mx-auto aspect-square w-60 max-w-full rounded-full bg-slate-100"
          />
          <label className="block text-sm font-medium">
            Zoom
            <input
              aria-label="Zooma profilbild"
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="mt-2 block min-h-11 w-full accent-blue-600"
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-medium">
              Horisontellt
              <input
                aria-label="Centrera horisontellt"
                type="range"
                min={0}
                max={100}
                value={x}
                onChange={(e) => setX(Number(e.target.value))}
                className="mt-2 block min-h-11 w-full accent-blue-600"
              />
            </label>
            <label className="text-sm font-medium">
              Vertikalt
              <input
                aria-label="Centrera vertikalt"
                type="range"
                min={0}
                max={100}
                value={y}
                onChange={(e) => setY(Number(e.target.value))}
                className="mt-2 block min-h-11 w-full accent-blue-600"
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => setPhoto(null)}
            >
              Avbryt
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Spara profilbild
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={remove}
        onClose={() => {
          if (!saving) setRemove(false);
        }}
        title="Ta bort profilbild?"
        size="sm"
      >
        <p className="text-sm text-vihem-muted">
          Dina initialer visas i stället. Dina övriga kontouppgifter ändras
          inte.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => setRemove(false)}
          >
            Avbryt
          </Button>
          <Button
            variant="danger"
            loading={saving}
            onClick={() => void save(true)}
          >
            Ta bort bild
          </Button>
        </div>
      </Modal>
    </div>
  );
}

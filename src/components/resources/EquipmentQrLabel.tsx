import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button, Modal } from "../ui";
export function EquipmentQrLabel({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true;
    void QRCode.toDataURL(`vihem:equipment:${id}`, { width: 480, margin: 2 })
      .then((url) => {
        if (active) setImage(url);
      })
      .catch(() => {
        if (active) setError("QR-koden kunde inte skapas.");
      });
    return () => {
      active = false;
    };
  }, [id, open]);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        QR-etikett
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="QR-etikett för utrustning"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Stäng
          </Button>
        }
      >
        <p className="font-semibold">{name}</p>
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        {image && (
          <>
            <img
              src={image}
              alt={`QR-kod för ${name}`}
              className="mx-auto w-60"
            />
            <a
              className="vihem-focus mt-3 inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-4 text-sm font-semibold text-blue-700"
              href={image}
              download={`utrustning-${id}.png`}
            >
              Spara etikettbild
            </a>
          </>
        )}
        <p className="mt-3 text-sm text-slate-500">
          Fäst etiketten på maskinen. Personal skannar den under Material &
          utrustning eller i en arbetsorder. Koden ger ingen åtkomst utan
          inloggning.
        </p>
      </Modal>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal } from "../ui";
export function ResourceScanner({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const delivered = useRef(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    active.current = true;
    generation.current += 1;
    delivered.current = false;
    let controls: { stop: () => void } | undefined;
    setError("");
    setCode("");
    void import("@zxing/browser")
      .then(async ({ BrowserMultiFormatReader }) => {
        if (stopped || !video.current) return;
        controls = await new BrowserMultiFormatReader().decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          video.current,
          (result) => {
            if (result && !stopped && !delivered.current) {
              delivered.current = true;
              onCode(result.getText());
            }
          },
        );
        if (stopped) controls.stop();
      })
      .catch(() => {
        if (!stopped)
          setError(
            "Kameran kunde inte öppnas. Tillåt kameraåtkomst, välj ett foto eller skriv koden.",
          );
      });
    const element = video.current;
    return () => {
      stopped = true;
      active.current = false;
      generation.current += 1;
      controls?.stop();
      (element?.srcObject as MediaStream | null)
        ?.getTracks()
        .forEach((t) => t.stop());
    };
  }, [open, onCode]);
  async function photo(file?: File) {
    if (!file) return;
    const token = generation.current;
    setError("");
    const url = URL.createObjectURL(file);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(
        url,
      );
      if (
        active.current &&
        token === generation.current &&
        !delivered.current
      ) {
        delivered.current = true;
        onCode(result.getText());
      }
    } catch {
      if (active.current && token === generation.current)
        setError(
          "Ingen kod hittades i bilden. Försök med en skarpare bild eller skriv koden.",
        );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Skanna material eller utrustning"
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Stäng
        </Button>
      }
    >
      <div className="space-y-4">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className="aspect-square w-full rounded-xl bg-slate-950 object-cover"
          aria-label="Kameravy för skanning"
        />
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <label className="block text-sm font-medium">
          Läs kod från foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="mt-2 block w-full text-sm"
            onChange={(e) => void photo(e.target.files?.[0])}
          />
        </label>
        <p className="text-xs text-slate-500">
          QR- och streckkoder läses lokalt. Fotot laddas inte upp.
        </p>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim() && !delivered.current) {
              delivered.current = true;
              onCode(code.trim());
            }
          }}
        >
          <Input
            label="Skriv eller klistra in kod"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" disabled={!code.trim()}>
            Läs
          </Button>
        </form>
      </div>
    </Modal>
  );
}

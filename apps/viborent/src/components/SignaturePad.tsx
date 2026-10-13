import { useEffect, useRef } from "react";

export function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const ink = useRef(false);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ratio = window.devicePixelRatio || 1, width = canvas.clientWidth || 400;
    canvas.width = width * ratio; canvas.height = 160 * ratio;
    const ctx = canvas.getContext("2d")!; ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#0b2e3a";
  }, []);
  const point = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  return (
    <div className="signature">
      <canvas
        ref={ref} aria-label="Signaturyta – rita din signatur"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const p = point(e); const c = ref.current!.getContext("2d")!; c.beginPath(); c.moveTo(p.x, p.y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const p = point(e); const c = ref.current!.getContext("2d")!; c.lineTo(p.x, p.y); c.stroke(); ink.current = true; }}
        onPointerUp={() => { drawing.current = false; if (ink.current) onChange(ref.current!.toDataURL("image/png")); }}
        onPointerCancel={() => { drawing.current = false; }}
      />
      <button type="button" className="text-link" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); ink.current = false; onChange(""); }} disabled={!value}>Rensa signatur</button>
    </div>
  );
}

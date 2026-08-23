// Handwritten-signature capture: finger/stylus/mouse via pointer events
// (works for touch, pen, and mouse uniformly, unlike separate touch/mouse
// handlers) so it behaves the same on the mobile signing page as on
// desktop. A standalone Avtal V2 component -- NOT the legacy SignaturePad
// inlined in ApartmentPage.tsx, which stays untouched.
import { useEffect, useRef } from 'react';

export function SignaturePad({ onChange, height = 180 }: { onChange: (dataUrl: string | null) => void; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const hasStrokeRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }
  }, [height]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const point = pointFromEvent(e);
    if (ctx && lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    lastPointRef.current = point;
    hasStrokeRef.current = true;
  };

  const finishStroke = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) onChange(hasStrokeRef.current ? canvas.toDataURL('image/png') : null);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        style={{ height, touchAction: 'none' }}
        className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white transition-colors"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerLeave={finishStroke}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Skriv din namnteckning ovan med finger, penna eller mus.</p>
        <button type="button" onClick={clear} className="text-xs font-medium text-slate-500 underline transition-colors hover:text-slate-700">Rensa</button>
      </div>
    </div>
  );
}

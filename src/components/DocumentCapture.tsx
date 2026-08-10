import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Badge, Button } from './ui';

export type DocumentCaptureKind = 'receipt' | 'supplier_invoice';

type DocumentCaptureCornerKey = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';
type DocumentCaptureCorners = Record<DocumentCaptureCornerKey, { x: number; y: number }>;

interface DocumentCaptureProps {
  documentKind: DocumentCaptureKind;
  file: File | null;
  onFileChange: (file: File | null) => void;
}

export function DocumentCapture({ documentKind, file, onFileChange }: DocumentCaptureProps) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const [scannerReady, setScannerReady] = useState(false);
  const [scannerCapturing, setScannerCapturing] = useState(false);
  const [scannerImageDataUrl, setScannerImageDataUrl] = useState('');
  const [scannerCorners, setScannerCorners] = useState<DocumentCaptureCorners | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const lastSignatureRef = useRef<number | null>(null);
  const stableFramesRef = useRef(0);
  const activeCornerRef = useRef<DocumentCaptureCornerKey | null>(null);

  const scannerFrame = useMemo(() => (
    documentKind === 'receipt'
      ? { left: 28, top: 4, width: 44, height: 92, label: 'Långt kvitto' }
      : { left: 13, top: 6, width: 74, height: 88, label: 'A4/faktura' }
  ), [documentKind]);

  const defaultCorners = useCallback((): DocumentCaptureCorners => ({
    topLeft: { x: scannerFrame.left, y: scannerFrame.top },
    topRight: { x: scannerFrame.left + scannerFrame.width, y: scannerFrame.top },
    bottomRight: { x: scannerFrame.left + scannerFrame.width, y: scannerFrame.top + scannerFrame.height },
    bottomLeft: { x: scannerFrame.left, y: scannerFrame.top + scannerFrame.height },
  }), [scannerFrame]);

  const stopScanner = useCallback(() => {
    if (scanIntervalRef.current) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    lastSignatureRef.current = null;
    stableFramesRef.current = 0;
    setScannerReady(false);
    setScannerCapturing(false);
  }, []);

  const createAdjustedFile = useCallback(async (
    imageDataUrl = scannerImageDataUrl,
    corners = scannerCorners,
    message = 'Justerad beskärning sparad.',
  ) => {
    const canvas = canvasRef.current;
    if (!canvas || !imageDataUrl || !corners) return;

    const image = new Image();
    image.src = imageDataUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Kunde inte läsa bilden.'));
    });

    const xValues = Object.values(corners).map(corner => corner.x);
    const yValues = Object.values(corners).map(corner => corner.y);
    const minX = Math.max(0, Math.min(...xValues));
    const maxX = Math.min(100, Math.max(...xValues));
    const minY = Math.max(0, Math.min(...yValues));
    const maxY = Math.min(100, Math.max(...yValues));
    const cropX = Math.round(image.naturalWidth * (minX / 100));
    const cropY = Math.round(image.naturalHeight * (minY / 100));
    const cropWidth = Math.max(80, Math.round(image.naturalWidth * ((maxX - minX) / 100)));
    const cropHeight = Math.max(80, Math.round(image.naturalHeight * ((maxY - minY) / 100)));
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) return;

    const prefix = documentKind === 'receipt' ? 'kvitto' : 'faktura';
    const fileName = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    onFileChange(new File([blob], fileName, { type: 'image/jpeg' }));
    setScannerMessage(message);
  }, [documentKind, onFileChange, scannerCorners, scannerImageDataUrl]);

  const captureImage = useCallback(async (automatic = false) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0 || scannerCapturing) return;

    setScannerCapturing(true);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setScannerCapturing(false);
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const corners = defaultCorners();
    setScannerImageDataUrl(imageDataUrl);
    setScannerCorners(corners);
    await createAdjustedFile(
      imageDataUrl,
      corners,
      automatic ? 'Dokumentet fångades automatiskt. Justera hörnen vid behov.' : 'Bilden är sparad. Justera hörnen vid behov.',
    );
    setScannerOpen(false);
    stopScanner();
  }, [createAdjustedFile, defaultCorners, scannerCapturing, stopScanner]);

  const moveCorner = useCallback((clientX: number, clientY: number) => {
    const activeCorner = activeCornerRef.current;
    const preview = previewRef.current;
    if (!activeCorner || !preview) return;

    const rect = preview.getBoundingClientRect();
    const x = Math.min(98, Math.max(2, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(98, Math.max(2, ((clientY - rect.top) / rect.height) * 100));
    setScannerCorners(prev => prev ? ({ ...prev, [activeCorner]: { x, y } }) : prev);
  }, []);

  const handleCornerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeCornerRef.current) return;
    event.preventDefault();
    moveCorner(event.clientX, event.clientY);
  }, [moveCorner]);

  const stopCornerDrag = useCallback(() => {
    activeCornerRef.current = null;
  }, []);

  const analyseFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;

    const width = 96;
    const height = 72;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    context.drawImage(
      video,
      video.videoWidth * (scannerFrame.left / 100),
      video.videoHeight * (scannerFrame.top / 100),
      video.videoWidth * (scannerFrame.width / 100),
      video.videoHeight * (scannerFrame.height / 100),
      0,
      0,
      width,
      height,
    );
    const data = context.getImageData(0, 0, width, height).data;
    let contrast = 0;
    let centerLight = 0;
    let centerSamples = 0;
    let signature = 0;

    for (let y = 8; y < height - 8; y += 4) {
      for (let x = 8; x < width - 8; x += 4) {
        const index = (y * width + x) * 4;
        const rightIndex = (y * width + x + 2) * 4;
        const downIndex = ((y + 2) * width + x) * 4;
        const lum = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
        const rightLum = data[rightIndex] * 0.299 + data[rightIndex + 1] * 0.587 + data[rightIndex + 2] * 0.114;
        const downLum = data[downIndex] * 0.299 + data[downIndex + 1] * 0.587 + data[downIndex + 2] * 0.114;
        contrast += Math.abs(lum - rightLum) + Math.abs(lum - downLum);
        signature += lum * ((x % 13) + (y % 17) + 1);
        if (x > 18 && x < width - 18 && y > 12 && y < height - 12) {
          centerLight += lum;
          centerSamples += 1;
        }
      }
    }

    const normalizedContrast = contrast / 700;
    const normalizedLight = centerSamples ? centerLight / centerSamples : 0;
    const lastSignature = lastSignatureRef.current;
    const motion = lastSignature === null ? 9999 : Math.abs(signature - lastSignature) / 100000;
    lastSignatureRef.current = signature;

    const hasDocumentLikeFrame = normalizedContrast > 18 && normalizedLight > 55 && normalizedLight < 235;
    const stable = motion < 24;
    if (hasDocumentLikeFrame && stable) stableFramesRef.current += 1;
    else stableFramesRef.current = Math.max(0, stableFramesRef.current - 1);

    if (!hasDocumentLikeFrame) setScannerMessage('Placera dokumentet innanför ramen.');
    else if (!stable) setScannerMessage('Håll mobilen stilla.');
    else setScannerMessage('Dokument hittat, håller fokus...');

    if (stableFramesRef.current >= 5) void captureImage(true);
  }, [captureImage, scannerFrame]);

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner();
      return;
    }

    let cancelled = false;
    const start = async () => {
      try {
        setScannerMessage('Startar kamera...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setScannerReady(true);
        setScannerMessage('Placera dokumentet innanför ramen.');
        scanIntervalRef.current = window.setInterval(analyseFrame, 450);
      } catch (scannerError) {
        setScannerMessage(scannerError instanceof Error ? scannerError.message : 'Kunde inte starta kameran.');
        setScannerReady(false);
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [analyseFrame, scannerOpen, stopScanner]);

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-bold text-slate-950">Dokumentscanner</p>
          <p className="text-sm text-slate-600">
            Öppna kameran, håll {documentKind === 'receipt' ? 'kvittot' : 'dokumentet'} inom ramen och låt appen ta bilden när den är stabil.
          </p>
          <Badge className="mt-2 bg-blue-100 text-blue-700">{scannerFrame.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setScannerOpen(prev => !prev);
              setScannerMessage('');
            }}
          >
            <Camera className="h-4 w-4" />
            {scannerOpen ? 'Stäng kamera' : 'Öppna scanner'}
          </Button>
          {scannerOpen && (
            <Button onClick={() => captureImage(false)} disabled={!scannerReady || scannerCapturing}>
              Ta bild nu
            </Button>
          )}
        </div>
      </div>
      {scannerOpen && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-900 bg-slate-950">
          <div className={`relative max-h-[78vh] w-full bg-slate-950 ${documentKind === 'receipt' ? 'aspect-[9/16] sm:aspect-[3/4]' : 'aspect-[3/4] sm:aspect-video'}`}>
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
            <div className="pointer-events-none absolute inset-0 bg-slate-950/20" />
            <div
              className="pointer-events-none absolute rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(15,23,42,0.38)]"
              style={{
                left: `${scannerFrame.left}%`,
                top: `${scannerFrame.top}%`,
                width: `${scannerFrame.width}%`,
                height: `${scannerFrame.height}%`,
              }}
            >
              <span className="absolute -left-0.5 -top-0.5 h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-blue-400" />
              <span className="absolute -right-0.5 -top-0.5 h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-blue-400" />
              <span className="absolute -bottom-0.5 -left-0.5 h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-blue-400" />
              <span className="absolute -bottom-0.5 -right-0.5 h-8 w-8 rounded-br-2xl border-b-4 border-r-4 border-blue-400" />
            </div>
            <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-slate-950/75 px-4 py-3 text-sm font-semibold text-white">
              {scannerMessage || 'Placera dokumentet innanför ramen.'}
            </div>
          </div>
        </div>
      )}
      {scannerImageDataUrl && scannerCorners && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold text-slate-950">Justera hörn</p>
              <p className="text-sm text-slate-500">Dra de blå hörnen om ramen missade någon del av dokumentet.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setScannerCorners(defaultCorners())}>
                Återställ ram
              </Button>
              <Button size="sm" onClick={() => createAdjustedFile()}>
                Använd justerad beskärning
              </Button>
            </div>
          </div>
          <div
            ref={previewRef}
            className="relative max-h-[70vh] touch-none overflow-hidden rounded-xl bg-slate-950"
            onPointerMove={handleCornerPointerMove}
            onPointerUp={stopCornerDrag}
            onPointerCancel={stopCornerDrag}
            onPointerLeave={stopCornerDrag}
          >
            <img
              src={scannerImageDataUrl}
              alt="Scannat underlag"
              className="block max-h-[70vh] w-full object-contain"
              draggable={false}
            />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polygon
                points={`${scannerCorners.topLeft.x},${scannerCorners.topLeft.y} ${scannerCorners.topRight.x},${scannerCorners.topRight.y} ${scannerCorners.bottomRight.x},${scannerCorners.bottomRight.y} ${scannerCorners.bottomLeft.x},${scannerCorners.bottomLeft.y}`}
                fill="rgba(37,99,235,0.12)"
                stroke="rgba(59,130,246,0.95)"
                strokeWidth="0.8"
              />
            </svg>
            {(Object.entries(scannerCorners) as Array<[DocumentCaptureCornerKey, { x: number; y: number }]>).map(([corner, point]) => (
              <button
                key={corner}
                type="button"
                aria-label="Dra hörn"
                className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow-lg"
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                onPointerDown={event => {
                  activeCornerRef.current = corner;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  moveCorner(event.clientX, event.clientY);
                }}
              />
            ))}
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
      <label className="mt-4 block text-sm font-semibold text-slate-700">
        {documentKind === 'receipt' ? 'Kvittofil eller kamerabild' : 'Fakturafil'}
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
          capture={documentKind === 'receipt' ? 'environment' : undefined}
          onChange={event => onFileChange(event.target.files?.[0] ?? null)}
          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-blue-700"
        />
        {file && (
          <span className="mt-2 block text-xs font-medium text-slate-500">
            {file.name} · {Math.round(file.size / 1024)} kB
          </span>
        )}
      </label>
    </div>
  );
}

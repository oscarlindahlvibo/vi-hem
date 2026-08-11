import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { Badge, Button } from './ui';

export type DocumentCaptureKind = 'receipt' | 'supplier_invoice';

type DocumentCaptureCornerKey = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';
type DocumentCaptureCorners = Record<DocumentCaptureCornerKey, { x: number; y: number }>;

interface DocumentCaptureProps {
  documentKind: DocumentCaptureKind;
  file: File | null;
  onFileChange: (file: File | null) => void;
  resetKey?: number | string;
}

export function DocumentCapture({ documentKind, file, onFileChange, resetKey }: DocumentCaptureProps) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMessage, setScannerMessage] = useState('');
  const [scannerReady, setScannerReady] = useState(false);
  const [scannerCapturing, setScannerCapturing] = useState(false);
  const [scannerImageDataUrl, setScannerImageDataUrl] = useState('');
  const [scannerCorners, setScannerCorners] = useState<DocumentCaptureCorners | null>(null);
  const [liveCorners, setLiveCorners] = useState<DocumentCaptureCorners | null>(null);
  const [activeCorner, setActiveCorner] = useState<DocumentCaptureCornerKey | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const imagePreviewRef = useRef<HTMLImageElement | null>(null);
  const magnifierCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraPreviewRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const lastSignatureRef = useRef<number | null>(null);
  const stableFramesRef = useRef(0);
  const activeCornerRef = useRef<DocumentCaptureCornerKey | null>(null);
  const analysisBusyRef = useRef(false);

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

  const clearScanPreview = useCallback(() => {
    setScannerImageDataUrl('');
    setScannerCorners(null);
    setLiveCorners(null);
    setScannerMessage('');
    setActiveCorner(null);
    activeCornerRef.current = null;
  }, []);

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
    analysisBusyRef.current = false;
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

  const detectDocumentCorners = useCallback(async (imageDataUrl: string): Promise<DocumentCaptureCorners | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const image = new Image();
    image.src = imageDataUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Kunde inte läsa bilden.'));
    });

    const width = 180;
    const height = Math.max(120, Math.round(width * (image.naturalHeight / image.naturalWidth)));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const luminance = (x: number, y: number) => {
      const index = (y * width + x) * 4;
      return pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    };

    const search = {
      left: Math.max(2, Math.round(width * ((scannerFrame.left - 10) / 100))),
      right: Math.min(width - 3, Math.round(width * ((scannerFrame.left + scannerFrame.width + 10) / 100))),
      top: Math.max(2, Math.round(height * ((scannerFrame.top - 5) / 100))),
      bottom: Math.min(height - 3, Math.round(height * ((scannerFrame.top + scannerFrame.height + 5) / 100))),
    };

    const border = [
      ...Array.from({ length: width }, (_, x) => luminance(x, 1)),
      ...Array.from({ length: width }, (_, x) => luminance(x, height - 2)),
      ...Array.from({ length: height }, (_, y) => luminance(1, y)),
      ...Array.from({ length: height }, (_, y) => luminance(width - 2, y)),
    ].sort((a, b) => a - b);
    const backgroundLight = border[Math.floor(border.length * 0.5)] ?? 120;
    const threshold = Math.min(225, Math.max(145, backgroundLight + 18));
    const mask = new Uint8Array(width * height);
    for (let y = search.top; y <= search.bottom; y += 1) {
      for (let x = search.left; x <= search.right; x += 1) {
        const index = (y * width + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const paperLike = Math.min(red, green, blue) >= threshold - 18 &&
          Math.max(red, green, blue) - Math.min(red, green, blue) < 125;
        if (paperLike) mask[y * width + x] = 1;
      }
    }

    let best: { area: number; minX: number; maxX: number; minY: number; maxY: number; topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } } | null = null;
    const queue: Array<[number, number]> = [];
    for (let y = search.top; y <= search.bottom; y += 1) {
      for (let x = search.left; x <= search.right; x += 1) {
        if (!mask[y * width + x]) continue;
        mask[y * width + x] = 0;
        queue.push([x, y]);
        let area = 0;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let topLeft = { x, y };
        let topRight = { x, y };
        let bottomRight = { x, y };
        let bottomLeft = { x, y };
        while (queue.length) {
          const [currentX, currentY] = queue.pop()!;
          area += 1;
          minX = Math.min(minX, currentX);
          maxX = Math.max(maxX, currentX);
          minY = Math.min(minY, currentY);
          maxY = Math.max(maxY, currentY);
          if (currentX + currentY < topLeft.x + topLeft.y) topLeft = { x: currentX, y: currentY };
          if (currentX - currentY > topRight.x - topRight.y) topRight = { x: currentX, y: currentY };
          if (currentX + currentY > bottomRight.x + bottomRight.y) bottomRight = { x: currentX, y: currentY };
          if (currentX - currentY < bottomLeft.x - bottomLeft.y) bottomLeft = { x: currentX, y: currentY };
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (!dx && !dy) continue;
              const nextX = currentX + dx;
              const nextY = currentY + dy;
              if (nextX < search.left || nextX > search.right || nextY < search.top || nextY > search.bottom) continue;
              const nextIndex = nextY * width + nextX;
              if (mask[nextIndex]) {
                mask[nextIndex] = 0;
                queue.push([nextX, nextY]);
              }
            }
          }
        }
        if (area > (best?.area ?? 0)) best = { area, minX, maxX, minY, maxY, topLeft, topRight, bottomRight, bottomLeft };
      }
    }

    if (!best || best.area < width * height * 0.025 || best.maxX - best.minX < width * 0.2 || best.maxY - best.minY < height * 0.16) return null;

    const padX = width * 0.008;
    const padY = height * 0.008;
    const point = (corner: { x: number; y: number }, extraX: number, extraY: number) => ({
      x: Math.max(1, Math.min(99, ((corner.x + extraX) / width) * 100)),
      y: Math.max(1, Math.min(99, ((corner.y + extraY) / height) * 100)),
    });

    return {
      topLeft: point(best.topLeft, -padX, -padY),
      topRight: point(best.topRight, padX, -padY),
      bottomRight: point(best.bottomRight, padX, padY),
      bottomLeft: point(best.bottomLeft, -padX, padY),
    };
  }, [scannerFrame]);

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
    const corners = await detectDocumentCorners(imageDataUrl) ?? defaultCorners();
    setScannerImageDataUrl(imageDataUrl);
    setScannerCorners(corners);
    setLiveCorners(null);
    await createAdjustedFile(
      imageDataUrl,
      corners,
      automatic ? 'Dokumentet fångades automatiskt. Justera hörnen vid behov.' : 'Bilden är sparad. Justera hörnen vid behov.',
    );
    setScannerOpen(false);
    stopScanner();
  }, [createAdjustedFile, defaultCorners, detectDocumentCorners, scannerCapturing, stopScanner]);

  const moveCorner = useCallback((clientX: number, clientY: number) => {
    const activeCorner = activeCornerRef.current;
    const preview = imagePreviewRef.current ?? previewRef.current;
    if (!activeCorner || !preview) return;

    const rect = preview.getBoundingClientRect();
    const x = Math.min(98, Math.max(2, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(98, Math.max(2, ((clientY - rect.top) / rect.height) * 100));
    setScannerCorners(prev => prev ? ({ ...prev, [activeCorner]: { x, y } }) : prev);
    setActiveCorner(activeCorner);
  }, []);

  const handleCornerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeCornerRef.current) return;
    event.preventDefault();
    moveCorner(event.clientX, event.clientY);
  }, [moveCorner]);

  const mapCameraPoint = useCallback((point: { x: number; y: number }) => {
    const video = videoRef.current;
    const viewport = cameraPreviewRef.current;
    if (!video || !viewport || !video.videoWidth || !video.videoHeight) return point;

    // The video uses object-cover. Convert image coordinates through the same
    // scale/crop so the live polygon stays over the document on every phone.
    const rect = viewport.getBoundingClientRect();
    const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const renderedWidth = video.videoWidth * scale;
    const renderedHeight = video.videoHeight * scale;
    const offsetX = (renderedWidth - rect.width) / 2;
    const offsetY = (renderedHeight - rect.height) / 2;
    return {
      x: ((point.x / 100 * renderedWidth - offsetX) / rect.width) * 100,
      y: ((point.y / 100 * renderedHeight - offsetY) / rect.height) * 100,
    };
  }, []);

  const cameraCorners = liveCorners ?? defaultCorners();
  const cameraPolygon = (Object.values(cameraCorners) as Array<{ x: number; y: number }>)
    .map(point => liveCorners ? mapCameraPoint(point) : point);

  const stopCornerDrag = useCallback(() => {
    activeCornerRef.current = null;
    setActiveCorner(null);
  }, []);

  useEffect(() => {
    const canvas = magnifierCanvasRef.current;
    const point = activeCorner && scannerCorners ? scannerCorners[activeCorner] : null;
    if (!canvas || !point || !scannerImageDataUrl) return;

    const image = new Image();
    image.onload = () => {
      const size = 112;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = size;
      canvas.height = size;
      context.fillStyle = '#020617';
      context.fillRect(0, 0, size, size);

      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / 2.2;
      const centerX = image.naturalWidth * point.x / 100;
      const centerY = image.naturalHeight * point.y / 100;
      const sourceLeft = centerX - sourceSize / 2;
      const sourceTop = centerY - sourceSize / 2;
      const scale = size / sourceSize;
      const visibleLeft = Math.max(0, sourceLeft);
      const visibleTop = Math.max(0, sourceTop);
      const visibleRight = Math.min(image.naturalWidth, sourceLeft + sourceSize);
      const visibleBottom = Math.min(image.naturalHeight, sourceTop + sourceSize);
      if (visibleRight > visibleLeft && visibleBottom > visibleTop) {
        context.drawImage(
          image,
          visibleLeft,
          visibleTop,
          visibleRight - visibleLeft,
          visibleBottom - visibleTop,
          (visibleLeft - sourceLeft) * scale,
          (visibleTop - sourceTop) * scale,
          (visibleRight - visibleLeft) * scale,
          (visibleBottom - visibleTop) * scale,
        );
      }
    };
    image.src = scannerImageDataUrl;
  }, [activeCorner, scannerCorners, scannerImageDataUrl]);

  useEffect(() => {
    clearScanPreview();
  }, [clearScanPreview, documentKind, resetKey]);

  const analyseFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || analysisBusyRef.current || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;

    analysisBusyRef.current = true;

    try {
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

      const hasDocumentLikeFrame = normalizedContrast > 18 && normalizedLight > 55 && normalizedLight < 245;
      const stable = motion < 24;
      const fullCanvas = document.createElement('canvas');
      const fullWidth = 240;
      const fullHeight = Math.max(160, Math.round(fullWidth * (video.videoHeight / video.videoWidth)));
      fullCanvas.width = fullWidth;
      fullCanvas.height = fullHeight;
      fullCanvas.getContext('2d')?.drawImage(video, 0, 0, fullWidth, fullHeight);
      const detected = await detectDocumentCorners(fullCanvas.toDataURL('image/jpeg', 0.68));
      if (detected) setLiveCorners(detected);

      if (hasDocumentLikeFrame && stable && detected) stableFramesRef.current += 1;
      else stableFramesRef.current = Math.max(0, stableFramesRef.current - 1);

      if (!detected) setScannerMessage('Placera dokumentet innanför ramen.');
      else if (!stable) setScannerMessage('Dokument hittat. Håll mobilen stilla.');
      else setScannerMessage('Dokument hittat, håller fokus...');

      if (stableFramesRef.current >= 5) void captureImage(true);
    } finally {
      analysisBusyRef.current = false;
    }
  }, [captureImage, detectDocumentCorners, scannerFrame]);

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
        <div className="fixed inset-0 z-[100] bg-slate-950">
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-slate-950/75 px-4 py-3 text-white backdrop-blur">
            <div>
              <p className="text-sm font-bold">Scanna {documentKind === 'receipt' ? 'kvitto' : 'faktura'}</p>
              <p className="text-xs text-slate-300">{scannerFrame.label}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setScannerOpen(false)}>
              <X className="h-4 w-4" />
              Stäng
            </Button>
          </div>
          <div ref={cameraPreviewRef} className="relative h-[100dvh] w-screen bg-slate-950">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
            <div className="pointer-events-none absolute inset-0 bg-slate-950/20" />
            <div className="pointer-events-none absolute inset-0 shadow-[0_0_0_999px_rgba(15,23,42,0.38)]" />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
              <polygon
                points={cameraPolygon.map(point => `${point.x},${point.y}`).join(' ')}
                fill="rgba(37,99,235,0.12)"
                stroke={liveCorners ? 'rgba(96,165,250,0.98)' : 'rgba(255,255,255,0.8)'}
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {cameraPolygon.map((point, index) => (
              <span
                key={`camera-corner-${index}`}
                className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow-lg"
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              />
            ))}
            <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+20px)] left-4 right-4 flex flex-col gap-3">
              <div className="rounded-xl bg-slate-950/75 px-4 py-3 text-center text-sm font-semibold text-white">
                {scannerMessage || 'Placera dokumentet innanför ramen.'}
              </div>
              <Button onClick={() => captureImage(false)} disabled={!scannerReady || scannerCapturing} className="w-full justify-center py-4">
                <Camera className="h-5 w-5" />
                Ta bild nu
              </Button>
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
              ref={imagePreviewRef}
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
                  setActiveCorner(corner);
                  event.currentTarget.setPointerCapture(event.pointerId);
                  moveCorner(event.clientX, event.clientY);
                }}
              />
            ))}
            {activeCorner && scannerCorners[activeCorner] && (
              <div
                className="pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-[125%] rounded-full border-4 border-white bg-slate-950 shadow-2xl ring-2 ring-blue-500"
                style={{
                  left: `${scannerCorners[activeCorner].x}%`,
                  top: `${scannerCorners[activeCorner].y}%`,
                }}
              >
                <canvas ref={magnifierCanvasRef} className="h-full w-full rounded-full" />
                <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/80" />
                <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/80" />
              </div>
            )}
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

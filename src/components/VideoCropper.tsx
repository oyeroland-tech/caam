import React, { useEffect, useRef, useState } from 'react';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatermarkBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function VideoCropper({
  video,
  crop,
  setCrop,
  bottomSafety = 42,
  lockCrop = false,
}: {
  video: HTMLVideoElement | null;
  crop: CropRect;
  setCrop: React.Dispatch<React.SetStateAction<CropRect>>;
  bottomSafety?: number;
  lockCrop?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [overlay, setOverlay] = useState<WatermarkBox | null>(null);

  useEffect(() => {
    if (!video) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let cancelled = false;

    const render = () => {
      if (cancelled || !video) return;

      const srcW = video.videoWidth || 1280;
      const srcH = video.videoHeight || 720;

      const safeCrop: CropRect = {
        x: Math.max(0, crop.x),
        y: Math.max(0, crop.y),
        width: crop.width > 0 ? crop.width : srcW,
        height: crop.height > 0 ? crop.height : srcH - bottomSafety,
      };

      safeCrop.width = Math.min(safeCrop.width, srcW - safeCrop.x);
      safeCrop.height = Math.min(safeCrop.height, srcH - safeCrop.y);

      canvas.width = safeCrop.width;
      canvas.height = safeCrop.height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        video,
        safeCrop.x,
        safeCrop.y,
        safeCrop.width,
        safeCrop.height,
        0,
        0,
        canvas.width,
        canvas.height
      );

      if (overlay) {
        const x = Math.max(0, overlay.x - safeCrop.x);
        const y = Math.max(0, overlay.y - safeCrop.y);
        const w = Math.min(overlay.width, safeCrop.width - x);
        const h = Math.min(overlay.height, safeCrop.height - y);

        if (w > 8 && h > 8) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.96)';
          ctx.fillRect(x, y, w, h);
        }
      }

      rafId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [video, crop, bottomSafety, overlay]);

  useEffect(() => {
    if (!video || lockCrop) return;

    const sample = document.createElement('canvas');
    const sampleCtx = sample.getContext('2d');
    if (!sampleCtx) return;

    const detectWatermark = () => {
      const sourceW = video.videoWidth || 1280;
      const sourceH = video.videoHeight || 720;
      if (!sourceW || !sourceH) return;

      const reducedW = 640;
      const reducedH = Math.round((sourceH / sourceW) * reducedW);

      sample.width = reducedW;
      sample.height = reducedH;

      sampleCtx.drawImage(video, 0, 0, reducedW, reducedH);
      const image = sampleCtx.getImageData(0, 0, reducedW, reducedH);
      const data = image.data;
      const rowScores = new Float32Array(reducedH);

      for (let y = 0; y < reducedH; y++) {
        let score = 0;
        for (let x = 0; x < reducedW; x++) {
          const idx = (y * reducedW + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lum > 200 && a > 80) score += 1;
        }
        rowScores[y] = score;
      }

      const threshold = Math.max(8, Math.max(...rowScores) * 0.12);
      let bestStart = -1;
      let bestEnd = -1;
      let currentStart = -1;

      for (let y = 0; y < reducedH; y++) {
        if (rowScores[y] > threshold) {
          if (currentStart === -1) currentStart = y;
        } else if (currentStart !== -1) {
          const span = y - currentStart;
          if (bestStart === -1 || span > bestEnd - bestStart) {
            bestStart = currentStart;
            bestEnd = y - 1;
          }
          currentStart = -1;
        }
      }

      if (currentStart !== -1) {
        const span = reducedH - currentStart;
        if (bestStart === -1 || span > bestEnd - bestStart) {
          bestStart = currentStart;
          bestEnd = reducedH - 1;
        }
      }

      if (bestStart === -1 || bestEnd === -1) {
        setOverlay(null);
        return;
      }

      const y1 = Math.round((bestStart / reducedH) * sourceH);
      const y2 = Math.round((bestEnd / reducedH) * sourceH);

      setOverlay({
        x: 0,
        y: Math.max(0, y1 - bottomSafety),
        width: sourceW,
        height: Math.max(24, y2 - y1 + bottomSafety * 2),
      });
    };

    detectWatermark();
    const timer = window.setInterval(detectWatermark, 1500);
    return () => clearInterval(timer);
  }, [video, bottomSafety, lockCrop]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full rounded-2xl bg-black"
      style={{ display: 'block' }}
    />
  );
}

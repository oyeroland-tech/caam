import React, { useEffect, useRef, useState, useCallback } from 'react';

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
  confidence: number;
  detectedAt?: number;
}

export interface VideoCropperProps {
  video: HTMLVideoElement | null;
  crop?: CropRect;
  setCrop?: (crop: CropRect) => void;
  bottomSafety?: number;
  lockCrop?: boolean;
  className?: string;
  storageKey?: string;
  /** Coordonnées de la zone du filigrane mobile à masquer (en % par rapport au crop ou à la vidéo) */
  activeWatermarkBox?: { x: number; y: number; width: number; height: number } | null;
  /** Active ou désactive la reconstitution par trame propre enregistrée */
  enableSmartReconstruction?: boolean;
  onFrame?: (now: DOMHighResTimeStamp, metadata?: VideoFrameCallbackMetadata) => void;
}

const DEFAULT_CROP: CropRect = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

export const VideoCropper: React.FC<VideoCropperProps> = ({
  video,
  crop = DEFAULT_CROP,
  setCrop,
  bottomSafety = 0,
  lockCrop = false,
  className = '',
  storageKey,
  activeWatermarkBox = null,
  enableSmartReconstruction = true,
  onFrame,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Buffer hors-écran pour stocker la dernière frame "propre" (sans filigrane au moment où il est absent)
  const cleanSnapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasCleanSnapshotRef = useRef<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(video);
  videoRef.current = video;

  // Persistance locale du crop
  const effectiveCrop = React.useMemo(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`videocropper_crop_${storageKey}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.x === 'number' && typeof parsed.width === 'number') {
            return parsed as CropRect;
          }
        }
      } catch (err) {
        console.warn('Erreur lecture localStorage:', err);
      }
    }
    return crop;
  }, [storageKey, crop]);

  const cropRef = useRef<CropRect>(effectiveCrop);
  cropRef.current = effectiveCrop;

  const bottomSafetyRef = useRef<number>(bottomSafety);
  bottomSafetyRef.current = Math.max(0, Math.min(30, bottomSafety));

  const watermarkBoxRef = useRef(activeWatermarkBox);
  watermarkBoxRef.current = activeWatermarkBox;

  const enableReconRef = useRef(enableSmartReconstruction);
  enableReconRef.current = enableSmartReconstruction;

  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragAction, setDragAction] = useState<'move' | 'nw' | 'ne' | 'se' | 'sw' | null>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialCrop: CropRect }>(
    {
      mouseX: 0,
      mouseY: 0,
      initialCrop: effectiveCrop,
    }
  );

  const updateCrop = useCallback(
    (newCrop: CropRect) => {
      if (storageKey && typeof window !== 'undefined') {
        try {
          localStorage.setItem(`videocropper_crop_${storageKey}`, JSON.stringify(newCrop));
        } catch (err) {
          console.warn('Erreur écriture localStorage:', err);
        }
      }
      if (setCrop) {
        setCrop(newCrop);
      }
    },
    [storageKey, setCrop]
  );

  const safeCrop = {
    x: Math.max(0, Math.min(95, effectiveCrop.x || 0)),
    y: Math.max(0, Math.min(95, effectiveCrop.y || 0)),
    width: Math.max(5, Math.min(100 - (effectiveCrop.x || 0), effectiveCrop.width || 100)),
    height: Math.max(5, Math.min(100 - (effectiveCrop.y || 0), effectiveCrop.height || 100)),
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false,
    });
    if (!ctx) return;

    // Initialisation du canvas cache pour la trame de secours
    if (!cleanSnapshotCanvasRef.current) {
      cleanSnapshotCanvasRef.current = document.createElement('canvas');
    }

    let isMounted = true;
    let frameCallbackId: number | null = null;
    let animFrameId: number | null = null;
    let lastCanvasWidth = 0;
    let lastCanvasHeight = 0;

    const renderLoop = (now: DOMHighResTimeStamp, metadata?: VideoFrameCallbackMetadata) => {
      if (!isMounted) return;

      const currentVideo = videoRef.current;
      if (
        currentVideo &&
        currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        currentVideo.videoWidth > 0 &&
        currentVideo.videoHeight > 0
      ) {
        const vw = currentVideo.videoWidth;
        const vh = currentVideo.videoHeight;

        const currentCrop = cropRef.current;
        const safetyFactor = Math.max(0, Math.min(0.3, bottomSafetyRef.current / 100));
        const effectiveVh = vh * (1 - safetyFactor);

        const normCrop = {
          x: (Math.max(0, Math.min(95, currentCrop.x)) / 100) * vw,
          y: (Math.max(0, Math.min(95, currentCrop.y)) / 100) * effectiveVh,
          w: (Math.max(5, Math.min(100, currentCrop.width)) / 100) * vw,
          h: (Math.max(5, Math.min(100, currentCrop.height)) / 100) * effectiveVh,
        };

        const sx = Math.max(0, Math.min(vw - 1, normCrop.x));
        const sy = Math.max(0, Math.min(effectiveVh - 1, normCrop.y));
        const sw = Math.max(1, Math.min(vw - sx, normCrop.w));
        const sh = Math.max(1, Math.min(effectiveVh - sy, normCrop.h));

        const targetWidth = Math.round(sw);
        const targetHeight = Math.round(sh);

        if (lastCanvasWidth !== targetWidth || lastCanvasHeight !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          lastCanvasWidth = targetWidth;
          lastCanvasHeight = targetHeight;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          if (cleanSnapshotCanvasRef.current) {
            cleanSnapshotCanvasRef.current.width = targetWidth;
            cleanSnapshotCanvasRef.current.height = targetHeight;
          }
        }

        // 1. Dessin de la vidéo courante
        ctx.drawImage(currentVideo, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

        const activeWm = watermarkBoxRef.current;
        const enableRecon = enableReconRef.current;
        const cleanCanvas = cleanSnapshotCanvasRef.current;

        if (!activeWm) {
          // Si aucun filigrane n'est détecté sur cette frame, on met à jour notre snapshot "propre" en arrière-plan (zéro coût CPU lourd)
          if (enableRecon && cleanCanvas) {
            const cleanCtx = cleanCanvas.getContext('2d');
            if (cleanCtx) {
              cleanCtx.drawImage(canvas, 0, 0);
              hasCleanSnapshotRef.current = true;
            }
          }
        } else if (activeWm && enableRecon && hasCleanSnapshotRef.current && cleanCanvas) {
          // 2. Si le filigrane est présent et qu'on a une image propre de secours :
          // On applique un masquage local ultra-rapide par le GPU en redessinant uniquement la zone saine mémorisée
          const wx = (activeWm.x / 100) * targetWidth;
          const wy = (activeWm.y / 100) * targetHeight;
          const ww = (activeWm.width / 100) * targetWidth;
          const wh = (activeWm.height / 100) * targetHeight;

          ctx.save();
          ctx.beginPath();
          // Léger effet adouci sur les bords du patch pour éviter un carré trop net
          ctx.rect(wx, wy, ww, wh);
          ctx.clip();

          // Recopie de la texture saine enregistrée au moment où le filigrane était absent
          ctx.drawImage(cleanCanvas, wx, wy, ww, wh, wx, wy, ww, wh);
          ctx.restore();
        } else if (activeWm && (!hasCleanSnapshotRef.current || !enableRecon)) {
          // Fallback de secours discret : un léger flou texturé ou un voile opaque très doux si pas encore de snapshot
          ctx.save();
          const wx = (activeWm.x / 100) * targetWidth;
          const wy = (activeWm.y / 100) * targetHeight;
          const ww = (activeWm.width / 100) * targetWidth;
          const wh = (activeWm.height / 100) * targetHeight;
          
          ctx.fillStyle = 'rgba(20, 20, 20, 0.4)'; // Voile semi-transparent discret
          ctx.filter = 'blur(8px)'; // Flou GPU natif accéléré
          ctx.fillRect(wx, wy, ww, wh);
          ctx.restore();
        }

        if (onFrameRef.current) {
          try {
            onFrameRef.current(now, metadata);
          } catch {}
        }
      }

      if (currentVideo && 'requestVideoFrameCallback' in currentVideo) {
        frameCallbackId = currentVideo.requestVideoFrameCallback(renderLoop);
      } else {
        animFrameId = requestAnimationFrame((t) => renderLoop(t));
      }
    };

    const activeVideo = videoRef.current;
    if (activeVideo && 'requestVideoFrameCallback' in activeVideo) {
      frameCallbackId = activeVideo.requestVideoFrameCallback(renderLoop);
    } else {
      animFrameId = requestAnimationFrame((t) => renderLoop(t));
    }

    return () => {
      isMounted = false;
      const targetVid = videoRef.current;
      if (targetVid && 'cancelVideoFrameCallback' in targetVid && frameCallbackId !== null) {
        targetVid.cancelVideoFrameCallback(frameCallbackId);
      }
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
      }
    };
  }, [video]);

  const handleMouseDown = (action: 'move' | 'nw' | 'ne' | 'se' | 'sw', e: React.MouseEvent) => {
    if (lockCrop || !setCrop) return;
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    setDragAction(action);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialCrop: { ...safeCrop },
    };
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !dragAction || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const deltaXPercent = ((e.clientX - dragStartRef.current.mouseX) / rect.width) * 100;
      const deltaYPercent = ((e.clientY - dragStartRef.current.mouseY) / rect.height) * 100;
      const init = dragStartRef.current.initialCrop;

      let nextX = init.x;
      let nextY = init.y;
      let nextW = init.width;
      let nextH = init.height;

      if (dragAction === 'move') {
        nextX = Math.max(0, Math.min(100 - init.width, init.x + deltaXPercent));
        nextY = Math.max(0, Math.min(100 - init.height, init.y + deltaYPercent));
      } else if (dragAction === 'se') {
        nextW = Math.max(10, Math.min(100 - init.x, init.width + deltaXPercent));
        nextH = Math.max(10, Math.min(100 - init.y, init.height + deltaYPercent));
      } else if (dragAction === 'sw') {
        const potentialX = Math.max(0, Math.min(init.x + init.width - 10, init.x + deltaXPercent));
        nextW = init.width + (init.x - potentialX);
        nextX = potentialX;
        nextH = Math.max(10, Math.min(100 - init.y, init.height + deltaYPercent));
      } else if (dragAction === 'ne') {
        const potentialY = Math.max(0, Math.min(init.y + init.height - 10, init.y + deltaYPercent));
        nextH = init.height + (init.y - potentialY);
        nextY = potentialY;
        nextW = Math.max(10, Math.min(100 - init.x, init.width + deltaXPercent));
      } else if (dragAction === 'nw') {
        const potentialX = Math.max(0, Math.min(init.x + init.width - 10, init.x + deltaXPercent));
        const potentialY = Math.max(0, Math.min(init.y + init.height - 10, init.y + deltaYPercent));
        nextW = init.width + (init.x - potentialX);
        nextH = init.height + (init.y - potentialY);
        nextX = potentialX;
        nextY = potentialY;
      }

      updateCrop({
        x: Math.round(nextX * 10) / 10,
        y: Math.round(nextY * 10) / 10,
        width: Math.round(nextW * 10) / 10,
        height: Math.round(nextH * 10) / 10,
      });
    },
    [isDragging, dragAction, updateCrop]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragAction(null);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden flex items-center justify-center select-none ${className}`}
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full object-contain pointer-events-none"
        style={{ imageRendering: 'auto' }}
      />

      {!lockCrop && setCrop && (
        <div
          className="absolute border-2 border-emerald-400 bg-emerald-500/10 cursor-move transition-shadow shadow-[0_0_15px_rgba(52,211,153,0.3)]"
          style={{
            left: `${safeCrop.x}%`,
            top: `${safeCrop.y}%`,
            width: `${safeCrop.width}%`,
            height: `${safeCrop.height}%`,
          }}
          onMouseDown={(e) => handleMouseDown('move', e)}
        >
          <div
            className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-sm cursor-nwse-resize shadow"
            onMouseDown={(e) => handleMouseDown('nw', e)}
          />
          <div
            className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-sm cursor-nesw-resize shadow"
            onMouseDown={(e) => handleMouseDown('ne', e)}
          />
          <div
            className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-sm cursor-nesw-resize shadow"
            onMouseDown={(e) => handleMouseDown('sw', e)}
          />
          <div
            className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-emerald-500 rounded-sm cursor-nwse-resize shadow"
            onMouseDown={(e) => handleMouseDown('se', e)}
          />

          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20">
            <div className="border-r border-b border-white/60" />
            <div className="border-r border-b border-white/60" />
            <div className="border-b border-white/60" />
            <div className="border-r border-b border-white/60" />
            <div className="border-r border-b border-white/60" />
            <div className="border-b border-white/60" />
            <div className="border-r border-b border-white/60" />
            <div className="border-r border-b border-white/60" />
            <div />
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoCropper;

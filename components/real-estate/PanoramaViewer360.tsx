'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Compass,
  Expand,
  Eye,
  Minimize,
  Play,
  Pause,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
} from 'lucide-react';
import { LatLngPoint, PanoramaScene } from '@/lib/types';

interface PanoramaViewer360Props {
  panoramas: PanoramaScene[];
  propertyTitle: string;
  coordinates?: LatLngPoint;
  streetViewAvailable?: boolean;
}

export function PanoramaViewer360({
  panoramas,
  propertyTitle,
  coordinates,
  streetViewAvailable = false,
}: PanoramaViewer360Props) {
  const orderedScenes = [...(panoramas || [])].sort((a, b) => a.order - b.order);
  const primaryScene =
    orderedScenes.find((s) => s.isPrimary) || orderedScenes[0] || null;

  const [activeSceneId, setActiveSceneId] = useState<string>(
    primaryScene?.id || ''
  );
  const [yaw, setYaw] = useState<number>(primaryScene?.initialYaw || 0);
  const [pitch, setPitch] = useState<number>(primaryScene?.initialPitch || 0);
  const [zoomFov, setZoomFov] = useState<number>(75);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'pano' | 'streetview'>('pano');
  const [imageStatus, setImageStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; yaw: number; pitch: number }>({
    x: 0,
    y: 0,
    yaw: 0,
    pitch: 0,
  });

  const activeScene =
    orderedScenes.find((s) => s.id === activeSceneId) || primaryScene;

  useEffect(() => {
    if (primaryScene && !orderedScenes.some((s) => s.id === activeSceneId)) {
      queueMicrotask(() => {
        setActiveSceneId(primaryScene.id);
      });
    }
  }, [orderedScenes, primaryScene, activeSceneId]);

  // Load equirectangular image into memory for interactive 360° projection
  useEffect(() => {
    if (!activeScene?.imageUrl) {
      queueMicrotask(() => {
        setImageStatus('error');
      });
      return;
    }
    queueMicrotask(() => {
      setImageStatus('loading');
    });
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageStatus('ready');
    };
    img.onerror = () => {
      setImageStatus('error');
    };
    img.src = activeScene.imageUrl;
  }, [activeScene?.imageUrl]);

  // Draw equirectangular panorama viewport slice with spherical perspective grid
  const renderPanoramaFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || imageStatus !== 'ready') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const imgW = img.naturalWidth || 2048;
    const imgH = img.naturalHeight || 1024;

    // Normalize yaw into [0, 360)
    const normYaw = ((yaw % 360) + 360) % 360;
    const clampedPitch = Math.max(-65, Math.min(65, pitch));

    // Map FOV (40..100 deg) to source width slice
    const sliceWidth = (zoomFov / 360) * imgW * 1.45;
    const sliceHeight = (zoomFov / 180) * imgH * 1.15;

    const centerX = (normYaw / 360) * imgW;
    const centerY = ((90 - clampedPitch) / 180) * imgH;

    const sy = Math.max(0, Math.min(imgH - sliceHeight, centerY - sliceHeight / 2));
    const sx = ((centerX - sliceWidth / 2) % imgW + imgW) % imgW;

    if (sx + sliceWidth <= imgW) {
      ctx.drawImage(img, sx, sy, sliceWidth, sliceHeight, 0, 0, w, h);
    } else {
      // Seamless 360° horizontal wrap-around
      const firstPartW = imgW - sx;
      const secondPartW = sliceWidth - firstPartW;
      const destFirstW = (firstPartW / sliceWidth) * w;
      ctx.drawImage(img, sx, sy, firstPartW, sliceHeight, 0, 0, destFirstW, h);
      ctx.drawImage(
        img,
        0,
        sy,
        secondPartW,
        sliceHeight,
        destFirstW,
        0,
        w - destFirstW,
        h
      );
    }

    // Subtle horizon crosshair & cardinal HUD overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 18, 0, Math.PI * 2);
    ctx.stroke();
  }, [yaw, pitch, zoomFov, imageStatus]);

  useEffect(() => {
    renderPanoramaFrame();
  }, [renderPanoramaFrame]);

  // Smooth auto-rotation when idle
  useEffect(() => {
    if (!autoRotate || viewMode !== 'pano' || imageStatus !== 'ready') return;
    const timer = window.setInterval(() => {
      if (!isDraggingRef.current) {
        setYaw((prev) => (prev + 0.35) % 360);
      }
    }, 40);
    return () => window.clearInterval(timer);
  }, [autoRotate, viewMode, imageStatus]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    setAutoRotate(false);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      yaw,
      pitch,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const sensitivity = zoomFov / 320;
    setYaw(((dragStartRef.current.yaw - dx * sensitivity) % 360 + 360) % 360);
    setPitch(
      Math.max(-65, Math.min(65, dragStartRef.current.pitch + dy * sensitivity * 0.7))
    );
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen().catch(() => {});
      }
      setIsFullscreen(true);
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  const getCardinalLabel = (deg: number) => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const norm = ((deg % 360) + 360) % 360;
    return `${dirs[Math.round(norm / 45) % 8]} · ${Math.round(norm)}°`;
  };

  if (!orderedScenes.length) {
    return (
      <div className="p-6 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <div className="font-semibold">
            Mandatory Real-Estate 360° Panorama Missing
          </div>
          <p>
            Every real-estate listing requires at least one valid 2:1 equirectangular 360° panorama before publication. This draft cannot be published until an owner uploads or configures a 360° scene.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none flex flex-col' : ''
      }`}
    >
      {/* Top Bar */}
      <div className="px-4 py-2.5 bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-semibold text-[var(--ps-text)]">
            Interactive 360° Equirectangular Property Viewer
          </span>
          <span className="text-xs text-[var(--ps-text-muted)]">
            · {activeScene?.name || 'Panorama 1'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {streetViewAvailable && coordinates && (
            <div className="flex items-center bg-[var(--ps-bg)] p-0.5 rounded-lg border border-[var(--ps-border)]">
              <button
                type="button"
                onClick={() => setViewMode('pano')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${
                  viewMode === 'pano'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'text-[var(--ps-text-muted)]'
                }`}
              >
                Owner 360° Pano
              </button>
              <button
                type="button"
                onClick={() => setViewMode('streetview')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md ${
                  viewMode === 'streetview'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'text-[var(--ps-text-muted)]'
                }`}
              >
                Street View Check
              </button>
            </div>
          )}

          <span className="text-[11px] font-mono tabular-nums text-[var(--ps-text-muted)] px-2 py-0.5 bg-[var(--ps-bg)] rounded border border-[var(--ps-border)]">
            Heading: {getCardinalLabel(yaw)}
          </span>
        </div>
      </div>

      {/* Dedicated Synthetic 360° Media Disclosure Strip (Never obscures the 360° canvas horizon) */}
      <div
        data-testid="panorama-demo-disclosure"
        className="px-3.5 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-200 flex flex-wrap items-center justify-between gap-2"
      >
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-emerald-300">
            DEMONSTRATION 360° MEDIA — SYNTHETIC PANORAMA
          </span>
          <span className="text-slate-400 hidden sm:inline">
            · 2:1 Equirectangular ({activeScene?.width || 2048}×{activeScene?.height || 1024}px)
          </span>
        </div>
        <span className="text-[10px] text-slate-300">
          Drag left/right (360°) &amp; up/down (±65° pitch) · Not an actual photo of {propertyTitle}
        </span>
      </div>

      {/* Main 360 Canvas Viewport */}
      <div
        className={`relative bg-slate-950 select-none ${
          isFullscreen ? 'flex-1' : 'h-64 sm:h-96'
        }`}
      >
        {viewMode === 'pano' ? (
          <>
            <canvas
              ref={canvasRef}
              width={1024}
              height={512}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              aria-label={`Interactive 360 degree panorama for ${propertyTitle}`}
              data-testid="panorama-360-canvas"
              data-yaw={Math.round(yaw)}
              data-pitch={Math.round(pitch)}
              data-fov={zoomFov}
              data-active-scene-id={activeScene?.id || ''}
              className="w-full h-full object-cover cursor-grab active:cursor-grabbing touch-none"
            />

            {imageStatus === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 text-white text-xs">
                Loading 360° equirectangular scene...
              </div>
            )}

            {/* Interactive Controls Overlay (Responsive & Compact on Mobile) */}
            <div className="absolute bottom-2.5 left-2.5 right-2.5 sm:left-auto sm:right-3 flex flex-wrap items-center justify-between sm:justify-end gap-1 bg-slate-950/85 backdrop-blur-xs px-2 py-1 rounded-lg border border-white/15 text-white text-[11px]">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setAutoRotate(false);
                    setYaw((y) => (y - 45 + 360) % 360);
                  }}
                  aria-label="Pan 360 view left"
                  className="px-1.5 py-1 rounded hover:bg-white/15 font-mono text-[10px]"
                  title="Pan Left 45°"
                >
                  ◀ 45°
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoRotate(false);
                    setYaw((y) => (y + 45) % 360);
                  }}
                  aria-label="Pan 360 view right"
                  className="px-1.5 py-1 rounded hover:bg-white/15 font-mono text-[10px]"
                  title="Pan Right 45°"
                >
                  45° ▶
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoRotate(false);
                    setPitch((p) => Math.min(65, p + 15));
                  }}
                  aria-label="Tilt 360 view up"
                  className="px-1.5 py-1 rounded hover:bg-white/15 font-mono text-[10px]"
                  title="Tilt Up 15°"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoRotate(false);
                    setPitch((p) => Math.max(-65, p - 15));
                  }}
                  aria-label="Tilt 360 view down"
                  className="px-1.5 py-1 rounded hover:bg-white/15 font-mono text-[10px]"
                  title="Tilt Down 15°"
                >
                  ▼
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setAutoRotate((p) => !p)}
                  aria-label={autoRotate ? 'Pause 360 rotation' : 'Start 360 rotation'}
                  className="p-1.5 rounded hover:bg-white/15"
                  title={autoRotate ? 'Pause auto-rotate' : 'Auto-rotate 360°'}
                >
                  {autoRotate ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setZoomFov((z) => Math.max(40, z - 10))}
                  aria-label="Zoom in 360 view"
                  className="p-1.5 rounded hover:bg-white/15"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoomFov((z) => Math.min(100, z + 10))}
                  aria-label="Zoom out 360 view"
                  className="p-1.5 rounded hover:bg-white/15"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setYaw(activeScene?.initialYaw || 0);
                    setPitch(0);
                    setZoomFov(75);
                  }}
                  aria-label="Reset 360 orientation"
                  className="p-1.5 rounded hover:bg-white/15"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={
                    isFullscreen ? 'Exit fullscreen 360 view' : 'Fullscreen 360 view'
                  }
                  className="p-1.5 rounded hover:bg-white/15"
                >
                  {isFullscreen ? (
                    <Minimize className="w-3.5 h-3.5" />
                  ) : (
                    <Expand className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-white bg-slate-900">
            <Eye className="w-8 h-8 text-sky-400 mb-2" />
            <h4 className="text-sm font-semibold">
              Google Street View Supplemental Option
            </h4>
            <p className="text-xs text-slate-300 max-w-md mt-1">
              Street View is offered only as a supplemental option when genuine coverage exists near ({coordinates?.lat.toFixed(4)}, {coordinates?.lng.toFixed(4)}). The owner-uploaded equirectangular 360° scenes remain the primary mandatory property panorama.
            </p>
            {coordinates && (
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coordinates.lat},${coordinates.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 px-3.5 py-2 rounded-lg bg-sky-500 text-slate-950 font-semibold text-xs hover:bg-sky-400"
              >
                Check External Google Street View Coverage
              </a>
            )}
          </div>
        )}
      </div>

      {/* Scene Selector Thumbnails */}
      <div className="p-3 bg-[var(--ps-surface)] border-t border-[var(--ps-border)] flex items-center gap-2 overflow-x-auto">
        <span className="text-xs font-medium text-[var(--ps-text-muted)] shrink-0">
          Scenes ({orderedScenes.length}):
        </span>
        {orderedScenes.map((scene) => {
          const active = scene.id === activeScene?.id && viewMode === 'pano';
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => {
                setViewMode('pano');
                setActiveSceneId(scene.id);
                setYaw(scene.initialYaw || 0);
                setPitch(scene.initialPitch || 0);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <span>{scene.name}</span>
              {scene.isPrimary && (
                <span className="text-[10px] opacity-75">(Primary)</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PanoramaViewer360;


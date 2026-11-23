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
  Sparkles,
} from 'lucide-react';
import type { LatLngPoint } from '@/lib/types';

export interface PublicPanorama360Scene {
  id: string;
  label: string;
  url: string;
  width?: number;
  height?: number;
}

export interface Panorama360ViewerProps {
  scenes: PublicPanorama360Scene[];
  listingTitle: string;
  coordinates?: LatLngPoint | null;
  className?: string;
}

/**
 * Public Multi-View Named 360° Equirectangular Panorama Viewer.
 * Renders crisp clickable View Switcher Pills (e.g., `Main Counter` | `Hallway` | `Rooftop`)
 * whenever a listing has one or more named `panoramas_360` scenes.
 */
export function Panorama360Viewer({
  scenes,
  listingTitle,
  coordinates,
  className = '',
}: Panorama360ViewerProps) {
  const validScenes = (scenes || []).filter((s) => Boolean(s?.url?.trim()));
  const [activeSceneId, setActiveSceneId] = useState<string>(
    validScenes[0]?.id || ''
  );
  const [yaw, setYaw] = useState<number>(0);
  const [pitch, setPitch] = useState<number>(0);
  const [zoomFov, setZoomFov] = useState<number>(75);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [imageStatus, setImageStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  }>({
    x: 0,
    y: 0,
    yaw: 0,
    pitch: 0,
  });

  const activeScene =
    validScenes.find((s) => s.id === activeSceneId) || validScenes[0] || null;

  useEffect(() => {
    if (
      validScenes.length > 0 &&
      !validScenes.some((s) => s.id === activeSceneId)
    ) {
      setActiveSceneId(validScenes[0].id);
    }
  }, [validScenes, activeSceneId]);

  useEffect(() => {
    if (!activeScene?.url) {
      setImageStatus('error');
      return;
    }
    setImageStatus('loading');
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageStatus('ready');
    };
    img.onerror = () => {
      setImageStatus('error');
    };
    img.src = activeScene.url;
  }, [activeScene?.url]);

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

    const normYaw = ((yaw % 360) + 360) % 360;
    const clampedPitch = Math.max(-65, Math.min(65, pitch));

    const sliceWidth = (zoomFov / 360) * imgW * 1.45;
    const sliceHeight = (zoomFov / 180) * imgH * 1.15;

    const centerX = (normYaw / 360) * imgW;
    const centerY = ((90 - clampedPitch) / 180) * imgH;

    const sy = Math.max(
      0,
      Math.min(imgH - sliceHeight, centerY - sliceHeight / 2)
    );
    const sx = (((centerX - sliceWidth / 2) % imgW) + imgW) % imgW;

    if (sx + sliceWidth <= imgW) {
      ctx.drawImage(img, sx, sy, sliceWidth, sliceHeight, 0, 0, w, h);
    } else {
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

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 18, 0, Math.PI * 2);
    ctx.stroke();
  }, [yaw, pitch, zoomFov, imageStatus]);

  useEffect(() => {
    renderPanoramaFrame();
  }, [renderPanoramaFrame]);

  useEffect(() => {
    if (!autoRotate || imageStatus !== 'ready') return;
    const timer = window.setInterval(() => {
      if (!isDraggingRef.current) {
        setYaw((prev) => (prev + 0.35) % 360);
      }
    }, 40);
    return () => window.clearInterval(timer);
  }, [autoRotate, imageStatus]);

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
    setYaw(
      (((dragStartRef.current.yaw - dx * sensitivity) % 360) + 360) % 360
    );
    setPitch(
      Math.max(
        -65,
        Math.min(65, dragStartRef.current.pitch + dy * sensitivity * 0.7)
      )
    );
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  const getCardinalLabel = (deg: number) => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const norm = ((deg % 360) + 360) % 360;
    return `${dirs[Math.round(norm / 45) % 8]} · ${Math.round(norm)}°`;
  };

  if (validScenes.length === 0 || !activeScene) return null;

  return (
    <section
      ref={containerRef}
      data-testid="public-panorama-360-viewer"
      className={`rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-[95] rounded-none flex flex-col' : ''
      } ${className}`}
    >
      {/* Header Bar + Named View Switcher Pills */}
      <div className="px-4 py-3 bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              360° Virtual Tour ({validScenes.length}{' '}
              {validScenes.length === 1 ? 'Scene' : 'Scenes'})
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
              <Sparkles className="w-3 h-3" />
              {activeScene.label || 'Main 360° View'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono tabular-nums text-[var(--ps-text-muted)] px-2 py-0.5 bg-[var(--ps-bg)] rounded border border-[var(--ps-border)]">
              Heading: {getCardinalLabel(yaw)}
            </span>
            {coordinates && (
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coordinates.lat},${coordinates.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              >
                <Eye className="w-3 h-3" />
                Street View
              </a>
            )}
          </div>
        </div>

        {/* Clickable Multi-View Named Switcher Pills */}
        {validScenes.length > 1 && (
          <div
            role="tablist"
            aria-label="360 degree tour scenes"
            data-testid="panorama-360-view-switcher-pills"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
          >
            {validScenes.map((scene, idx) => {
              const active = scene.id === activeScene.id;
              return (
                <button
                  key={scene.id || idx}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`panorama-360-pill-${idx}`}
                  onClick={() => {
                    setActiveSceneId(scene.id);
                    setYaw(0);
                    setPitch(0);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    active
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border border-[var(--ps-border)] hover:border-emerald-500/60'
                  }`}
                >
                  <Compass className="w-3 h-3" />
                  <span>{scene.label || `View ${idx + 1}`}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main 360° Equirectangular Viewport */}
      <div
        className={`relative bg-slate-950 select-none ${
          isFullscreen ? 'flex-1' : 'h-72 sm:h-96'
        }`}
      >
        <canvas
          ref={canvasRef}
          width={1024}
          height={512}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label={`Interactive 360 degree panorama: ${activeScene.label} at ${listingTitle}`}
          data-testid="panorama-360-canvas"
          className="w-full h-full object-cover cursor-grab active:cursor-grabbing touch-none"
        />

        {imageStatus === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 text-white text-xs">
            Loading 360° view ({activeScene.label})...
          </div>
        )}

        {imageStatus === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950 p-4">
            {/* Fallback to direct image/iframe when CORS blocks canvas drawImage */}
            <img
              src={activeScene.url}
              alt={activeScene.label}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Controls Overlay */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 sm:left-auto sm:right-3 flex flex-wrap items-center justify-between sm:justify-end gap-1 bg-slate-950/85 backdrop-blur-xs px-2.5 py-1.5 rounded-xl border border-white/15 text-white text-[11px]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setAutoRotate(false);
                setYaw((y) => (y - 45 + 360) % 360);
              }}
              className="px-1.5 py-1 rounded hover:bg-white/15 font-mono text-[10px] cursor-pointer"
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
              className="px-1.5 py-1 rounded hover:bg-white/15 font-mono text-[10px] cursor-pointer"
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
              className="px-1.5 py-1 rounded hover:bg-white/15 font-mono text-[10px] cursor-pointer"
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
              className="px-1.5 py-1 rounded hover:bg-white/15 font-mono text-[10px] cursor-pointer"
              title="Tilt Down 15°"
            >
              ▼
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAutoRotate((p) => !p)}
              className="p-1.5 rounded hover:bg-white/15 cursor-pointer"
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
              className="p-1.5 rounded hover:bg-white/15 cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomFov((z) => Math.min(100, z + 10))}
              className="p-1.5 rounded hover:bg-white/15 cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setYaw(0);
                setPitch(0);
                setZoomFov(75);
              }}
              className="p-1.5 rounded hover:bg-white/15 cursor-pointer"
              title="Reset view"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 rounded hover:bg-white/15 cursor-pointer"
              title="Fullscreen"
            >
              {isFullscreen ? (
                <Minimize className="w-3.5 h-3.5" />
              ) : (
                <Expand className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default Panorama360Viewer;

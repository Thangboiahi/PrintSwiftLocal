'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { AnimatePresence, motion } from 'framer-motion';
import { Compass, Loader2 } from 'lucide-react';

export type MapActivityStatus = 'idle' | 'moving' | 'loading';

export interface MapStatusPillProps {
  statusOverride?: MapActivityStatus;
  mapMode?: 'standard' | 'real_estate' | 'directions';
  onStatusChange?: (status: MapActivityStatus) => void;
}

export function MapStatusPill({
  statusOverride,
  mapMode = 'standard',
  onStatusChange,
}: MapStatusPillProps) {
  const map = useMap();
  const [mapStatus, setMapStatus] = useState<MapActivityStatus>('idle');
  const isDraggingRef = useRef(false);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (!map) return;

    let idleTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateStatus = (nextStatus: MapActivityStatus) => {
      setMapStatus(nextStatus);
      onStatusChangeRef.current?.(nextStatus);
    };

    const handleDragStart = () => {
      isDraggingRef.current = true;
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
      updateStatus('moving');
    };

    const handleBoundsChanged = () => {
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
      if (isDraggingRef.current) {
        updateStatus('moving');
      } else {
        updateStatus('loading');
      }
    };

    const handleIdle = () => {
      isDraggingRef.current = false;
      if (idleTimeout) {
        clearTimeout(idleTimeout);
      }
      idleTimeout = setTimeout(() => {
        updateStatus('idle');
      }, 220);
    };

    // Strictly bind to Google Maps dragstart, bounds_changed, and idle events
    const dragStartListener = map.addListener('dragstart', handleDragStart);
    const boundsChangedListener = map.addListener(
      'bounds_changed',
      handleBoundsChanged
    );
    const idleListener = map.addListener('idle', handleIdle);

    return () => {
      if (idleTimeout) {
        clearTimeout(idleTimeout);
      }
      dragStartListener.remove();
      boundsChangedListener.remove();
      idleListener.remove();
    };
  }, [map]);

  const effectiveStatus =
    statusOverride && statusOverride !== 'idle' ? statusOverride : mapStatus;
  const statusLabel =
    effectiveStatus === 'moving'
      ? 'Moving...'
      : effectiveStatus === 'loading'
        ? 'Loading area...'
        : null;

  return (
    <div
      data-testid="map-status-pill-container"
      data-map-mode={mapMode}
      data-map-status={effectiveStatus}
      className="pointer-events-none absolute top-12 sm:top-14 left-1/2 z-40 -translate-x-1/2"
    >
      <AnimatePresence mode="wait">
        {statusLabel && (
          <motion.div
            key={effectiveStatus}
            initial={{ opacity: 0, y: -10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            role="status"
            aria-live="polite"
            data-testid="map-status-pill"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 px-3.5 py-1.5 text-xs font-semibold text-[var(--ps-text)] shadow-lg backdrop-blur-md"
          >
            {effectiveStatus === 'moving' ? (
              <Compass className="h-3.5 w-3.5 animate-pulse text-[var(--ps-accent)]" />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ps-accent)]" />
            )}
            <AnimatePresence mode="wait">
              <motion.span
                key={statusLabel}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14 }}
              >
                {statusLabel}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default MapStatusPill;

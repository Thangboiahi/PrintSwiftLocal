'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bookmark,
  BookmarkCheck,
  Eye,
  Navigation,
  Pin,
  Ruler,
  Trash2,
  X,
} from 'lucide-react';
import type { Listing } from '@/lib/types';

export interface MapLongPressTarget {
  kind: 'map' | 'listing';
  lat: number;
  lng: number;
  label: string;
  screenX: number;
  screenY: number;
  listing?: Listing;
}

export interface MapLongPressMenuProps {
  target: MapLongPressTarget | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isSavedListing?: boolean;
  onClose: () => void;
  onSetPickup: (target: MapLongPressTarget) => void;
  onSetDropoff: (target: MapLongPressTarget) => void;
  onDirectionsHere: (target: MapLongPressTarget) => void;
  onSaveCustomMarker?: (lat: number, lng: number, label: string) => void;
  onMeasureFromHere?: (lat: number, lng: number) => void;
  onViewListingSummary?: (listing: Listing) => void;
  onToggleSaveListing?: (listingId: string) => void;
}

export function MapLongPressMenu({
  target,
  containerRef,
  isSavedListing = false,
  onClose,
  onSetPickup,
  onSetDropoff,
  onDirectionsHere,
  onSaveCustomMarker,
  onMeasureFromHere,
  onViewListingSummary,
  onToggleSaveListing,
}: MapLongPressMenuProps) {
  const [isNamingMarker, setIsNamingMarker] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsNamingMarker(false);
    setCustomLabel(target?.label || '');
  }, [target?.lat, target?.lng, target?.kind, target?.listing?.id]);

  useEffect(() => {
    if (!target) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [target, onClose]);

  if (!target) return null;

  // Clamp popover inside the map container viewport
  const rect = containerRef.current?.getBoundingClientRect();
  const containerW = rect?.width || 360;
  const containerH = rect?.height || 480;
  const menuW = 248;
  const menuH = target.kind === 'listing' ? 250 : isNamingMarker ? 290 : 265;

  const clampedLeft = Math.max(
    10,
    Math.min(target.screenX - menuW / 2, containerW - menuW - 10)
  );
  const preferAbove = target.screenY > menuH + 24;
  const clampedTop = preferAbove
    ? Math.max(10, target.screenY - menuH - 14)
    : Math.max(10, Math.min(target.screenY + 14, containerH - menuH - 10));

  return (
    <AnimatePresence>
      <div
        className="pointer-events-none absolute inset-0 z-[45]"
        data-testid="map-long-press-overlay"
      >
        {/* Subtle click-away scrim */}
        <div
          className="pointer-events-auto absolute inset-0"
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
        />

        {/* Pulsing target beacon at exact screen point for open map long-press */}
        {target.kind === 'map' && (
          <div
            aria-hidden="true"
            style={{
              left: `${target.screenX}px`,
              top: `${target.screenY}px`,
            }}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          >
            <span className="block h-8 w-8 rounded-full bg-[var(--ps-accent)]/25 animate-ping" />
            <span className="absolute inset-2 rounded-full border-2 border-white bg-[var(--ps-accent)] shadow-lg" />
          </div>
        )}

        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.94, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 6 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          style={{
            left: `${clampedLeft}px`,
            top: `${clampedTop}px`,
            width: `${menuW}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          data-testid="map-long-press-menu"
          data-menu-kind={target.kind}
          role="dialog"
          aria-label={
            target.kind === 'listing'
              ? `Quick actions for ${target.label}`
              : 'Map point quick actions'
          }
          className="pointer-events-auto absolute rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/98 backdrop-blur-md shadow-2xl overflow-hidden text-xs text-[var(--ps-text)]"
        >
          {/* Compact Header */}
          <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60">
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[var(--ps-text)] truncate">
                {target.label}
              </div>
              <div className="text-[10px] font-mono text-[var(--ps-text-muted)]">
                {target.lat.toFixed(5)}°, {target.lng.toFixed(5)}°
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close quick actions"
              className="h-6 w-6 rounded-lg flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface)] shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Action List */}
          <div className="p-1.5 space-y-1">
            <button
              type="button"
              data-testid="long-press-set-pickup-btn"
              onClick={() => {
                onSetPickup(target);
                onClose();
              }}
              className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-left text-[11px] font-semibold hover:bg-emerald-500/12 text-[var(--ps-text)] transition-colors"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-extrabold text-white shrink-0">
                A
              </span>
              <span className="truncate">
                {target.kind === 'listing'
                  ? 'Pick N Drop From Here (Pin A)'
                  : 'Set Pickup (Pin A)'}
              </span>
            </button>

            <button
              type="button"
              data-testid="long-press-set-dropoff-btn"
              onClick={() => {
                onSetDropoff(target);
                onClose();
              }}
              className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-left text-[11px] font-semibold hover:bg-indigo-500/12 text-[var(--ps-text)] transition-colors"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-extrabold text-white shrink-0">
                B
              </span>
              <span className="truncate">
                {target.kind === 'listing'
                  ? 'Pick N Drop To Here (Pin B)'
                  : 'Set Dropoff (Pin B)'}
              </span>
            </button>

            <button
              type="button"
              data-testid="long-press-directions-btn"
              onClick={() => {
                onDirectionsHere(target);
                onClose();
              }}
              className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-left text-[11px] font-semibold hover:bg-sky-500/12 text-[var(--ps-text)] transition-colors"
            >
              <Navigation className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span className="truncate">
                {target.kind === 'listing'
                  ? 'Directions / Route'
                  : 'Directions / Route Here'}
              </span>
            </button>

            {target.kind === 'listing' && target.listing ? (
              <>
                {onViewListingSummary && (
                  <button
                    type="button"
                    data-testid="long-press-view-summary-btn"
                    onClick={() => {
                      onViewListingSummary(target.listing!);
                      onClose();
                    }}
                    className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-left text-[11px] font-semibold hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)] transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                    <span className="truncate">View Summary</span>
                  </button>
                )}

                {onToggleSaveListing && (
                  <button
                    type="button"
                    data-testid="long-press-bookmark-btn"
                    onClick={() => {
                      onToggleSaveListing(target.listing!.id);
                      onClose();
                    }}
                    className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-left text-[11px] font-semibold hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)] transition-colors"
                  >
                    {isSavedListing ? (
                      <BookmarkCheck className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    ) : (
                      <Bookmark className="w-3.5 h-3.5 text-[var(--ps-text-muted)] shrink-0" />
                    )}
                    <span className="truncate">
                      {isSavedListing ? 'Saved in Bookmarks' : 'Save / Bookmark'}
                    </span>
                  </button>
                )}
              </>
            ) : (
              <>
                {onSaveCustomMarker &&
                  (isNamingMarker ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        onSaveCustomMarker(
                          target.lat,
                          target.lng,
                          customLabel.trim() || target.label
                        );
                        onClose();
                      }}
                      className="px-1.5 py-1 space-y-1.5 border-t border-[var(--ps-border)] mt-1 pt-1.5"
                    >
                      <input
                        type="text"
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        placeholder="Short marker label..."
                        maxLength={48}
                        autoFocus
                        data-testid="long-press-marker-label-input"
                        className="w-full h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] text-[var(--ps-text)] focus:outline-none focus:border-[var(--ps-accent)]"
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setIsNamingMarker(false)}
                          className="h-7 px-2 rounded-lg text-[10px] font-semibold text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          data-testid="long-press-confirm-save-marker-btn"
                          className="h-7 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold"
                        >
                          Save Pin
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      data-testid="long-press-save-marker-btn"
                      onClick={() => setIsNamingMarker(true)}
                      className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-left text-[11px] font-semibold hover:bg-teal-500/12 text-[var(--ps-text)] transition-colors"
                    >
                      <Pin className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                      <span className="truncate">Save Marker</span>
                    </button>
                  ))}

                {onMeasureFromHere && (
                  <button
                    type="button"
                    data-testid="long-press-measure-btn"
                    onClick={() => {
                      onMeasureFromHere(target.lat, target.lng);
                      onClose();
                    }}
                    className="w-full h-8 px-2.5 rounded-xl flex items-center gap-2 text-left text-[11px] font-semibold hover:bg-amber-500/12 text-[var(--ps-text)] transition-colors"
                  >
                    <Ruler className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate">Measure From Here</span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="long-press-clear-btn"
                  onClick={onClose}
                  className="w-full h-7 px-2.5 rounded-xl flex items-center gap-2 text-left text-[10px] font-semibold text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                >
                  <Trash2 className="w-3 h-3 shrink-0" />
                  <span>Clear</span>
                </button>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default MapLongPressMenu;

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  Compass,
  MapPin,
  Package,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { PickNDropPanel } from '@/components/pickndrop/PickNDropPanel';
import { CrossHubBanner } from '@/components/hub/CrossHubBanner';
import { ModulePausedGuard } from '@/components/shared/ModulePausedGuard';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type { DeliveryTripType, PickNDropPoint } from '@/lib/pick-n-drop/types';

export default function PickNDropStandalonePage() {
  const router = useRouter();
  const { activeHub } = useAppConfig();
  const activeHubName = activeHub?.name || 'Churachandpur';
  const activeHubSlug = activeHub?.slug || 'churachandpur';

  const [pickup, setPickup] = useState<PickNDropPoint | null>(null);
  const [dropoff, setDropoff] = useState<PickNDropPoint | null>(null);
  const [activePinTarget, setActivePinTarget] = useState<
    'pickup' | 'dropoff' | null
  >(null);
  const [tripType, setTripType] = useState<DeliveryTripType>('one_way');
  const [requestedHubParam, setRequestedHubParam] = useState<string | null>(
    null
  );

  // Hydrate optional ?pickupLat=&pickupLng=&pickupLabel=&hub= query params
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const hubParam = params.get('hub')?.trim() || null;
    if (hubParam) {
      setRequestedHubParam(hubParam);
    }
    const latRaw = params.get('pickupLat');
    const lngRaw = params.get('pickupLng');
    const labelRaw = params.get('pickupLabel')?.trim() || '';
    const lat = latRaw ? Number.parseFloat(latRaw) : NaN;
    const lng = lngRaw ? Number.parseFloat(lngRaw) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setPickup({
        lat,
        lng,
        label: labelRaw || `Pickup (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      });
    }
  }, []);

  return (
    <ModulePausedGuard module="pick_n_drop">
      <div
        data-testid="pick-n-drop-standalone-page"
        className="mx-auto w-full max-w-4xl px-3 sm:px-5 py-4 sm:py-6 space-y-4 bg-[var(--ps-bg)] text-[var(--ps-text)]"
      >
        <CrossHubBanner
          itemHubId={requestedHubParam}
          itemTypeLabel="Pick N Drop pickup"
        />

        {/* Compact Standalone Header */}
        <header className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/25">
                <Truck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Pick N Drop</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-text-muted)]">
                <MapPin className="w-3 h-3 text-[var(--ps-accent)]" aria-hidden="true" />
                <span>{activeHubName} Hub</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                <span>OTP Handover · {tripType === 'two_way' ? 'Two-Way' : 'One-Way'}</span>
              </span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--ps-text)]">
              Instant Local Courier, Gas &amp; Doorstep Rides
            </h1>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Send parcels, groceries, LPG cylinders, or book a quick local ride across {activeHubName} with verified drivers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              href="/activity?tab=pick_n_drop"
              data-testid="pnd-standalone-activity-link"
              className="h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5 transition-colors"
            >
              <ClipboardList className="w-3.5 h-3.5 text-[var(--ps-accent)]" aria-hidden="true" />
              <span>My Deliveries</span>
            </Link>
            <Link
              href={`/explore?hub=${encodeURIComponent(activeHubSlug)}&mode=pick_n_drop`}
              data-testid="pnd-standalone-map-link"
              className="h-9 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 transition-opacity"
            >
              <Compass className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pin on Map</span>
            </Link>
          </div>
        </header>

        {/* Main Pick N Drop Panel */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden shadow-2xs">
          <PickNDropPanel
            isActive
            showPanelHeader={false}
            onBackToListings={() => router.push('/explore')}
            pickup={pickup}
            dropoff={dropoff}
            onChangePickup={setPickup}
            onChangeDropoff={setDropoff}
            activePinTarget={activePinTarget}
            onSelectPinTarget={(target) => {
              setActivePinTarget(target);
              if (target) {
                router.push(
                  `/explore?hub=${encodeURIComponent(activeHubSlug)}&mode=pick_n_drop`
                );
              }
            }}
            onTripTypeChange={setTripType}
          />
        </section>

        {/* Quick tip footer */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ps-text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" aria-hidden="true" />
            <span>
              Ordering from a local shop or restaurant? Use 1-tap Pick N Drop directly inside their storefront.
            </span>
          </span>
          <Link
            href="/marketplace"
            className="font-semibold text-[var(--ps-accent)] hover:underline whitespace-nowrap"
          >
            Browse Shop &amp; Food →
          </Link>
        </div>
      </div>
    </ModulePausedGuard>
  );
}

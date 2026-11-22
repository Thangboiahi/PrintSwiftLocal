'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type {
  DeliveryServiceMode,
  DeliveryTripType,
  PickNDropPoint,
} from '@/lib/pick-n-drop/types';
import {
  buildExplorePickNDropUrl,
  patchPickNDropDraft,
  readPickNDropDraft,
} from '@/lib/pick-n-drop/draft-context';

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
  const [serviceType, setServiceType] = useState<DeliveryServiceMode>('parcel');
  const [vehicleTypeSlug, setVehicleTypeSlug] = useState<string | null>(null);
  const [hasHydratedDraft, setHasHydratedDraft] = useState(false);
  const [requestedHubParam, setRequestedHubParam] = useState<string | null>(
    null
  );

  // Hydrate shared draft + optional URL query params (?pickupListingId=, ?pickupLat=&pickupLng=, ?dropoffLat=&dropoffLng=, ?hub=)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = readPickNDropDraft();
    const params = new URLSearchParams(window.location.search);
    const hubParam = params.get('hub')?.trim() || null;
    if (hubParam) {
      setRequestedHubParam(hubParam);
    }

    const parsePt = (
      latKey: string,
      lngKey: string,
      labelKey: string,
      fallbackPrefix: string
    ): PickNDropPoint | null => {
      const latRaw = params.get(latKey);
      const lngRaw = params.get(lngKey);
      const lat = latRaw ? Number.parseFloat(latRaw) : NaN;
      const lng = lngRaw ? Number.parseFloat(lngRaw) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const labelRaw = params.get(labelKey)?.trim() || '';
      return {
        lat,
        lng,
        label:
          labelRaw || `${fallbackPrefix} (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      };
    };

    const urlPickup = parsePt('pickupLat', 'pickupLng', 'pickupLabel', 'Pickup');
    const urlDropoff = parsePt(
      'dropoffLat',
      'dropoffLng',
      'dropoffLabel',
      'Dropoff'
    );

    setServiceType(saved.serviceType);
    setTripType(saved.tripMode);
    setVehicleTypeSlug(saved.vehicleTypeSlug);
    setPickup(urlPickup || saved.pickup || null);
    setDropoff(urlDropoff || saved.dropoff || null);
    setHasHydratedDraft(true);

    if (urlPickup) {
      patchPickNDropDraft({ pickup: urlPickup });
    }
    if (urlDropoff) {
      patchPickNDropDraft({ dropoff: urlDropoff });
    }

    const pickupListingId = params.get('pickupListingId')?.trim() || '';
    if (urlPickup || !pickupListingId || !isSupabaseConfigured()) return;

    let active = true;
    const hydrateListingPickup = async () => {
      try {
        const { data } = await supabase
          .from('listings')
          .select('id, hub_id, title, locality, lat, lng')
          .eq('id', pickupListingId)
          .maybeSingle();
        if (!active || !data) return;
        const row = data as {
          hub_id?: string | null;
          title?: string | null;
          locality?: string | null;
          lat?: number | null;
          lng?: number | null;
        };
        if (row.hub_id && !hubParam) {
          setRequestedHubParam(row.hub_id);
        }
        const rLat = Number(row.lat);
        const rLng = Number(row.lng);
        if (Number.isFinite(rLat) && Number.isFinite(rLng)) {
          const title = (row.title || 'Pickup Location').trim();
          const locality = (row.locality || '').trim();
          const nextPt = {
            lat: rLat,
            lng: rLng,
            label: locality ? `${title} (${locality})` : title,
            listingId: pickupListingId,
          };
          setPickup(nextPt);
          patchPickNDropDraft({ pickup: nextPt });
        }
      } catch {
        // Non-blocking
      }
    };
    void hydrateListingPickup();
    return () => {
      active = false;
    };
  }, []);

  const handleChangePickup = useCallback((point: PickNDropPoint | null) => {
    setPickup(point);
    patchPickNDropDraft({ pickup: point });
  }, []);

  const handleChangeDropoff = useCallback((point: PickNDropPoint | null) => {
    setDropoff(point);
    patchPickNDropDraft({ dropoff: point });
  }, []);

  const handleOpenMapPinMode = useCallback(
    (target: 'pickup' | 'dropoff' | null) => {
      setActivePinTarget(target);
      const nextDraft = patchPickNDropDraft({
        serviceType,
        tripMode: tripType,
        vehicleTypeSlug,
        pickup,
        dropoff,
        activePinTarget: target,
      });
      router.push(buildExplorePickNDropUrl(activeHubSlug, nextDraft, target));
    },
    [
      activeHubSlug,
      dropoff,
      pickup,
      router,
      serviceType,
      tripType,
      vehicleTypeSlug,
    ]
  );

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
                <MapPin
                  className="w-3 h-3 text-[var(--ps-accent)]"
                  aria-hidden="true"
                />
                <span>{activeHubName} Hub</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                <span>
                  OTP Handover ·{' '}
                  {tripType === 'two_way' ? 'Two-Way' : 'One-Way'}
                </span>
              </span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--ps-text)]">
              Instant Local Courier, Gas &amp; Doorstep Rides
            </h1>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Send parcels, groceries, LPG cylinders, or book a quick local ride
              across {activeHubName} with verified drivers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              href="/activity?tab=pick_n_drop"
              data-testid="pnd-standalone-activity-link"
              className="h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5 transition-colors"
            >
              <ClipboardList
                className="w-3.5 h-3.5 text-[var(--ps-accent)]"
                aria-hidden="true"
              />
              <span>My Deliveries</span>
            </Link>
            <button
              type="button"
              onClick={() => handleOpenMapPinMode(null)}
              data-testid="pnd-standalone-map-link"
              className="h-9 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 transition-opacity"
            >
              <Compass className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pin on Map</span>
            </button>
          </div>
        </header>

        {/* Main Pick N Drop Panel */}
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden shadow-2xs p-3 sm:p-4">
          {hasHydratedDraft && (
            <PickNDropPanel
              isActive
              showPanelHeader={false}
              onBackToListings={() => router.push('/explore')}
              pickup={pickup}
              dropoff={dropoff}
              onChangePickup={handleChangePickup}
              onChangeDropoff={handleChangeDropoff}
              activePinTarget={activePinTarget}
              onSelectPinTarget={(target) => {
                if (target) {
                  handleOpenMapPinMode(target);
                } else {
                  setActivePinTarget(null);
                }
              }}
              onTripTypeChange={setTripType}
              initialServiceMode={serviceType}
              initialTripType={tripType}
              initialVehicleSlug={vehicleTypeSlug}
              onDraftMetaChange={(meta) => {
                setServiceType(meta.serviceType);
                setTripType(meta.tripMode);
                setVehicleTypeSlug(meta.vehicleTypeSlug);
              }}
            />
          )}
        </section>

        {/* Quick tip footer */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ps-text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <Package
              className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0"
              aria-hidden="true"
            />
            <span>
              Ordering from a local shop or restaurant? Use 1-tap Pick N Drop
              directly inside their storefront.
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

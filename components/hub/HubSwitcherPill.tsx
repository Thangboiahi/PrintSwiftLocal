'use client';

import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  Loader2,
  MapPin,
} from 'lucide-react';
import { useHub } from '@/components/providers/AppConfigProvider';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { CityRequestModal } from './CityRequestModal';

const ACTION_DETECT_GPS = '__detect_gps__';
const ACTION_REQUEST_CITY = '__request_city__';
const COMING_SOON_PREFIX = '__coming_soon__:';

export interface HubSwitcherPillProps {
  variant?: 'header' | 'drawer' | 'logo-pill';
  onActionComplete?: () => void;
  className?: string;
}

export function HubSwitcherPill({
  variant = 'logo-pill',
  onActionComplete,
  className = '',
}: HubSwitcherPillProps) {
  const { hubs, activeHub, isSwitchingHub, switchHub, detectHubByGPS } =
    useHub();

  const [isDetectingGps, setIsDetectingGps] = useState(false);
  const [requestModalState, setRequestModalState] = useState<{
    open: boolean;
    city: string;
    state: string;
    note?: string;
    lat?: number;
    lng?: number;
  }>({
    open: false,
    city: '',
    state: '',
  });

  const selectOptions = useMemo<CustomSelectOption[]>(() => {
    // 1. Existing active hubs first
    const activeOptions: CustomSelectOption[] = hubs
      .filter((h) => h.status === 'active')
      .map((h) => ({
        value: h.slug,
        label: `${h.name} Hub`,
        description: `${h.state} · Active (${h.service_radius_km} km service area)`,
      }));

    // 2. Existing coming soon hubs labeled
    const comingSoonOptions: CustomSelectOption[] = hubs
      .filter((h) => h.status === 'coming_soon')
      .map((h) => ({
        value: `${COMING_SOON_PREFIX}${h.slug}`,
        label: `${h.name} (Coming Soon)`,
        description: `${h.state} · Tap to request launch notifications`,
      }));

    // 3. Detect via GPS
    const gpsOption: CustomSelectOption = {
      value: ACTION_DETECT_GPS,
      label: 'Detect via GPS',
      description: 'Auto-switch to the closest active hub for your coordinates',
    };

    // 4. Request a New Hub option at the bottom
    const requestOption: CustomSelectOption = {
      value: ACTION_REQUEST_CITY,
      label: 'Request a New Hub',
      description: 'Vote for PrintSwift Local expansion to your town or district',
    };

    return [
      ...activeOptions,
      ...comingSoonOptions,
      gpsOption,
      requestOption,
    ];
  }, [hubs]);

  const handleSelectValue = async (nextVal: string) => {
    if (!nextVal) return;

    if (nextVal === ACTION_DETECT_GPS) {
      setIsDetectingGps(true);
      try {
        const res = await detectHubByGPS();
        if (res.is_within_service_area && res.matched_hub) {
          await switchHub(res.matched_hub.slug);
          onActionComplete?.();
          return;
        }
        setRequestModalState({
          open: true,
          city: '',
          state: '',
          lat: res.lat,
          lng: res.lng,
          note:
            res.error ||
            (res.nearest_hub
              ? `You are ${res.distance_km?.toFixed(1) ?? ''} km from ${res.nearest_hub.name} Hub. Request your city below!`
              : "We aren't live in your exact area yet — request your city below!"),
        });
      } finally {
        setIsDetectingGps(false);
      }
      return;
    }

    if (nextVal === ACTION_REQUEST_CITY) {
      setRequestModalState({
        open: true,
        city: '',
        state: '',
      });
      return;
    }

    if (nextVal.startsWith(COMING_SOON_PREFIX)) {
      const targetSlug = nextVal.slice(COMING_SOON_PREFIX.length);
      const comingSoonHub = hubs.find((h) => h.slug === targetSlug);
      setRequestModalState({
        open: true,
        city: comingSoonHub?.name || targetSlug,
        state: comingSoonHub?.state || '',
        note: `${comingSoonHub?.name || 'This hub'} is launching soon! Leave your contact to get notified first.`,
      });
      return;
    }

    if (nextVal !== activeHub?.slug) {
      await switchHub(nextVal);
    }
    onActionComplete?.();
  };

  return (
    <>
      <div className={`relative inline-flex items-center ${className}`.trim()}>
        <div
          className={
            variant === 'drawer'
              ? 'w-full'
              : 'inline-flex items-center'
          }
        >
          <div className="relative w-full">
            <CustomSelectModal
              id={`hub-switcher-${variant}`}
              testId={`hub-switcher-${variant}`}
              label={
                variant === 'drawer'
                  ? 'Active Service Hub'
                  : 'Select Service Hub'
              }
              options={selectOptions}
              value={activeHub?.slug || 'churachandpur'}
              onChange={(val) => void handleSelectValue(val)}
              placeholder="Select Service Hub"
              className="opacity-0 absolute inset-0 w-full h-full z-10 cursor-pointer [&_button]:min-h-0 [&_button]:h-full [&_button]:w-full"
            />

            {variant === 'logo-pill' ? (
              <div
                data-testid="hub-switcher-logo-pill"
                className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] leading-none font-semibold text-slate-600 dark:text-slate-400 hover:text-theme-primary transition-colors cursor-pointer group/hub select-none pointer-events-none py-0.5"
              >
                {isSwitchingHub || isDetectingGps ? (
                  <Loader2 className="w-2.5 h-2.5 text-theme-primary animate-spin shrink-0" />
                ) : (
                  <MapPin className="w-2.5 h-2.5 text-theme-primary shrink-0" />
                )}
                <span className="max-w-[85px] sm:max-w-[125px] truncate">
                  {activeHub?.name || 'Churachandpur'}
                </span>
                <ChevronDown className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 group-hover/hub:text-theme-primary transition-colors shrink-0" />
              </div>
            ) : variant === 'drawer' ? (
              <div
                data-testid="hub-switcher-drawer-display"
                className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-between gap-2 text-xs font-semibold text-[var(--ps-text)] pointer-events-none"
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <MapPin className="w-3.5 h-3.5 text-theme-primary shrink-0" />
                  <span className="truncate">{activeHub?.name || 'Churachandpur'} Hub</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                  {(isSwitchingHub || isDetectingGps) && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  <span>Switch</span>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                </span>
              </div>
            ) : (
              <div
                data-testid="hub-switcher-header-pill"
                className="h-8 px-2 sm:px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center gap-1 sm:gap-1.5 text-xs font-semibold text-[var(--ps-text)] transition-colors pointer-events-none"
              >
                {isSwitchingHub || isDetectingGps ? (
                  <Loader2 className="w-3.5 h-3.5 text-theme-primary animate-spin shrink-0" />
                ) : (
                  <MapPin className="w-3.5 h-3.5 text-theme-primary shrink-0" />
                )}
                <span className="max-w-[78px] sm:max-w-[130px] truncate">
                  {activeHub?.name || 'Churachandpur'}
                </span>
                <ChevronDown className="w-3 h-3 text-[var(--ps-text-muted)] shrink-0" />
              </div>
            )}
          </div>
        </div>
      </div>

      <CityRequestModal
        open={requestModalState.open}
        onClose={() => setRequestModalState((prev) => ({ ...prev, open: false }))}
        initialCity={requestModalState.city}
        initialState={requestModalState.state}
        initialNote={requestModalState.note}
        lat={requestModalState.lat}
        lng={requestModalState.lng}
        onSuccess={() => onActionComplete?.()}
      />
    </>
  );
}

export default HubSwitcherPill;

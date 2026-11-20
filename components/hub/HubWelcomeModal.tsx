'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BellPlus,
  CheckCircle2,
  Clock,
  Compass,
  Loader2,
  MapPin,
  Navigation,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useHub } from '@/components/providers/AppConfigProvider';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import type { ServiceHubRecord } from '@/lib/config/types';

export function HubWelcomeModal() {
  const {
    hubs,
    activeHub,
    hasExplicitHubChoice,
    isSwitchingHub,
    switchHub,
    detectHubByGPS,
    dismissHubWelcome,
  } = useHub();
  const { session } = useAuth();
  const { setStatus } = useAppStatus();

  const [isClientReady, setIsClientReady] = useState(false);
  const [hasUrlHubParam, setHasUrlHubParam] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null);
  const [outOfAreaInfo, setOutOfAreaInfo] = useState<{
    nearestHubName?: string;
    distanceKm?: number | null;
    lat?: number;
    lng?: number;
    errorText?: string;
  } | null>(null);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestedCity, setRequestedCity] = useState('');
  const [requestedState, setRequestedState] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestSuccessMsg, setRequestSuccessMsg] = useState<string | null>(
    null
  );
  const [requestErrorMsg, setRequestErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    queueMicrotask(() => {
      const params = new URLSearchParams(window.location.search);
      const urlHub = (params.get('hub') || '').trim();
      setHasUrlHubParam(Boolean(urlHub));
      setIsClientReady(true);
    });
  }, []);

  const isOpen =
    isClientReady &&
    !hasUrlHubParam &&
    (!hasExplicitHubChoice || Boolean(welcomeBanner));

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setWelcomeBanner(null);
        dismissHubWelcome();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, dismissHubWelcome]);

  const handleClose = () => {
    setWelcomeBanner(null);
    dismissHubWelcome();
  };

  const handleSelectActiveHub = async (hub: ServiceHubRecord) => {
    if (hub.status !== 'active') return;
    await switchHub(hub.slug);
    setWelcomeBanner(`Welcome to ${hub.name} Hub`);
    window.setTimeout(() => {
      setWelcomeBanner(null);
      dismissHubWelcome();
    }, 900);
  };

  const handleDetectGps = async () => {
    setIsDetecting(true);
    setOutOfAreaInfo(null);
    setRequestErrorMsg(null);
    setRequestSuccessMsg(null);

    try {
      const res = await detectHubByGPS();
      if (res.is_within_service_area && res.matched_hub) {
        await switchHub(res.matched_hub.slug);
        setWelcomeBanner(`Welcome to ${res.matched_hub.name} Hub`);
        window.setTimeout(() => {
          setWelcomeBanner(null);
          dismissHubWelcome();
        }, 1200);
        return;
      }

      setOutOfAreaInfo({
        nearestHubName: res.nearest_hub?.name,
        distanceKm: res.distance_km,
        lat: res.lat,
        lng: res.lng,
        errorText: res.error,
      });
      setShowRequestForm(true);
    } finally {
      setIsDetecting(false);
    }
  };

  const handlePrefillComingSoon = (hub: ServiceHubRecord) => {
    setRequestedCity(hub.name);
    setRequestedState(hub.state || '');
    setShowRequestForm(true);
    setRequestSuccessMsg(null);
    setRequestErrorMsg(null);
  };

  const handleSubmitCityRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const cityClean = requestedCity.trim();
    if (cityClean.length < 2) {
      setRequestErrorMsg('Please enter your city or town name.');
      return;
    }

    setIsSubmittingRequest(true);
    setRequestErrorMsg(null);
    setRequestSuccessMsg(null);
    setStatus('saving', 'Submitting city request');

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/hubs/request-city', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          requested_city: cityClean,
          state: requestedState.trim() || null,
          contact_info: contactInfo.trim() || null,
          lat: outOfAreaInfo?.lat ?? null,
          lng: outOfAreaInfo?.lng ?? null,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!res.ok) {
        setRequestErrorMsg(
          data.error || 'Could not submit city request. Please try again.'
        );
        setStatus('error', 'Request failed');
        return;
      }

      setStatus('success', 'City request recorded');
      setRequestSuccessMsg(
        `Thanks! We've logged demand for ${cityClean}. You can explore an active hub below in the meantime.`
      );
      setRequestedCity('');
      setRequestedState('');
      setContactInfo('');
    } catch {
      setRequestErrorMsg('Network error while submitting request.');
      setStatus('error', 'Network error');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  if (!isClientReady || typeof document === 'undefined') return null;

  const activeHubs = hubs.filter((h) => h.status === 'active');
  const comingSoonHubs = hubs.filter((h) => h.status === 'coming_soon');

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={handleClose}
          data-testid="hub-welcome-modal-backdrop"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hub-welcome-modal-title"
            data-testid="hub-welcome-modal"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', damping: 28, stiffness: 340 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md max-h-[86dvh] overflow-y-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-theme-primary text-[var(--color-primary-foreground)] flex items-center justify-center shrink-0">
                  <Compass className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="hub-welcome-modal-title"
                    className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate"
                  >
                    Choose Your Service Hub
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    Local places, Pick N Drop &amp; rates tailored to your city
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Dismiss hub selection"
                data-testid="hub-welcome-dismiss-btn"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3.5">
              {/* Matched Welcome Toast Banner */}
              {welcomeBanner && (
                <div
                  role="status"
                  data-testid="hub-welcome-matched-toast"
                  className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/12 px-3.5 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{welcomeBanner}</span>
                </div>
              )}

              {/* Primary GPS Auto-Detect Button */}
              <button
                type="button"
                onClick={() => void handleDetectGps()}
                disabled={isDetecting || isSwitchingHub}
                data-testid="hub-welcome-detect-gps-btn"
                className="w-full h-9 rounded-xl bg-theme-primary text-[var(--color-primary-foreground)] px-3.5 text-xs font-bold inline-flex items-center justify-center gap-2 shadow-xs hover:opacity-95 disabled:opacity-60 transition-opacity cursor-pointer"
              >
                {isDetecting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Detecting Nearest Hub…</span>
                  </>
                ) : (
                  <>
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Detect My Location (GPS)</span>
                  </>
                )}
              </button>

              {/* Out-of-Area Friendly Card + Inline Request My City Form */}
              {outOfAreaInfo && (
                <div
                  data-testid="hub-welcome-out-of-area-card"
                  className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 space-y-2"
                >
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 leading-snug">
                    {outOfAreaInfo.errorText ||
                      "We aren't live in your exact area yet — explore an active hub below or request your city!"}
                  </p>
                  {outOfAreaInfo.nearestHubName &&
                    typeof outOfAreaInfo.distanceKm === 'number' && (
                      <p className="text-[11px] text-amber-700/90 dark:text-amber-300/90">
                        Nearest active hub:{' '}
                        <strong>{outOfAreaInfo.nearestHubName}</strong> (
                        {outOfAreaInfo.distanceKm.toFixed(1)} km away)
                      </p>
                    )}
                </div>
              )}

              {/* Active Hubs Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <span>Active Regional Hubs</span>
                  <span>{activeHubs.length} Live</span>
                </div>

                <div className="space-y-1.5">
                  {activeHubs.map((hub) => {
                    const isCurrent = activeHub?.slug === hub.slug;
                    return (
                      <div
                        key={hub.id}
                        data-testid={`hub-welcome-card-${hub.slug}`}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-all ${
                          isCurrent
                            ? 'border-theme-primary bg-theme-primary/5 dark:bg-theme-primary/15'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                        }`}
                      >
                        <div className="min-w-0 flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                            <MapPin className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                {hub.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                Live
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {hub.state} · {hub.service_radius_km} km radius
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={isSwitchingHub}
                          data-testid={`hub-welcome-select-${hub.slug}`}
                          onClick={() => void handleSelectActiveHub(hub)}
                          className={`h-8 px-3 rounded-lg text-xs font-bold shrink-0 transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-theme-primary text-[var(--color-primary-foreground)]'
                              : 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:border-theme-primary'
                          }`}
                        >
                          {isCurrent ? 'Selected' : 'Select'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Coming Soon Hubs Section */}
              {comingSoonHubs.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Expanding Soon
                  </div>
                  <div className="space-y-1.5">
                    {comingSoonHubs.map((hub) => (
                      <div
                        key={hub.id}
                        data-testid={`hub-welcome-coming-soon-${hub.slug}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/40 p-2.5"
                      >
                        <div className="min-w-0 flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                {hub.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                Coming Soon
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {hub.state}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handlePrefillComingSoon(hub)}
                          data-testid={`hub-welcome-notify-${hub.slug}`}
                          className="h-8 px-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                        >
                          <BellPlus className="w-3 h-3" />
                          <span>Notify / Request</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Request My City Toggle / Inline Form */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                {!showRequestForm ? (
                  <button
                    type="button"
                    onClick={() => setShowRequestForm(true)}
                    data-testid="hub-welcome-open-request-form-btn"
                    className="w-full h-8 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-theme-primary inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-theme-primary" />
                    <span>Don&apos;t see your town? Request My City</span>
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => void handleSubmitCityRequest(e)}
                    data-testid="hub-welcome-request-city-form"
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        Request My City
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowRequestForm(false)}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        Hide
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={requestedCity}
                        onChange={(e) => setRequestedCity(e.target.value)}
                        placeholder="City / Town (e.g. Imphal, Ukhrul)"
                        data-testid="hub-request-city-input"
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                      />
                      <input
                        type="text"
                        value={requestedState}
                        onChange={(e) => setRequestedState(e.target.value)}
                        placeholder="State (e.g. Manipur, Mizoram)"
                        data-testid="hub-request-state-input"
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={contactInfo}
                        onChange={(e) => setContactInfo(e.target.value)}
                        placeholder="WhatsApp or Email for launch alert (optional)"
                        data-testid="hub-request-contact-input"
                        className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                      />
                      <button
                        type="submit"
                        disabled={isSubmittingRequest}
                        data-testid="hub-request-submit-btn"
                        className="h-8 px-3 rounded-lg bg-theme-primary text-[var(--color-primary-foreground)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-50 shrink-0 cursor-pointer"
                      >
                        {isSubmittingRequest ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3 h-3" />
                        )}
                        <span>Submit</span>
                      </button>
                    </div>

                    {requestErrorMsg && (
                      <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        {requestErrorMsg}
                      </p>
                    )}
                    {requestSuccessMsg && (
                      <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        {requestSuccessMsg}
                      </p>
                    )}
                  </form>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default HubWelcomeModal;

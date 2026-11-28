'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useHydrated } from '@/hooks/useHydrated';
import {
  ArrowLeft,
  Check,
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
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';

export interface UnifiedHubModalProps {
  open: boolean;
  onClose: () => void;
  initialView?: 'list' | 'request';
  initialCity?: string;
  initialState?: string;
}

export function UnifiedHubModal({
  open,
  onClose,
  initialView = 'list',
  initialCity = '',
  initialState = '',
}: UnifiedHubModalProps) {
  const { hubs, activeHub, switchHub, detectHubByGPS, isSwitchingHub } = useHub();
  const { session } = useAuth();
  const { setStatus } = useAppStatus();

  const isHydrated = useHydrated();
  const [view, setView] = useState<'list' | 'request'>(initialView);
  const [city, setCity] = useState(initialCity);
  const [state, setState] = useState(initialState);
  const [contactInfo, setContactInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDetectingGps, setIsDetectingGps] = useState(false);
  const [gpsFeedback, setGpsFeedback] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Reset or sync when modal is opened
  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setView(initialView);
        setCity(initialCity);
        setState(initialState);
        setContactInfo('');
        setFeedback(null);
        setGpsFeedback(null);
      });
    }
  }, [open, initialView, initialCity, initialState]);

  if (!isHydrated || !open || typeof document === 'undefined') return null;

  const activeHubs = hubs.filter((h) => h.status === 'active');
  const comingSoonHubs = hubs.filter((h) => h.status === 'coming_soon');

  const handleDetectGPS = async () => {
    setIsDetectingGps(true);
    setGpsFeedback(null);
    setStatus('locating', 'Detecting nearest hub via GPS…');

    try {
      const result = await detectHubByGPS();
      if (!result) {
        setGpsFeedback('Unable to retrieve GPS coordinates.');
        setStatus('error', 'Location unavailable');
        return;
      }

      if (result.matched_hub && result.is_within_service_area) {
        setGpsFeedback(`You are in ${result.matched_hub.name}!`);
        await switchHub(result.matched_hub.slug);
        setStatus('success', `Switched to ${result.matched_hub.name}`);
        setTimeout(() => {
          onClose();
        }, 800);
      } else if (result.nearest_hub) {
        const km = result.distance_km ? Math.round(result.distance_km) : 0;
        setGpsFeedback(
          `Nearest hub is ${result.nearest_hub.name} (${km} km away). DD oodle has not launched in your immediate area yet!`
        );
        setStatus('idle');
      } else {
        setGpsFeedback('No nearby service hubs detected for your location.');
        setStatus('idle');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'GPS detection failed';
      setGpsFeedback(msg);
      setStatus('error', 'GPS detection failed');
    } finally {
      setIsDetectingGps(false);
    }
  };

  const handleSelectHub = async (hubSlug: string) => {
    if (hubSlug === activeHub?.slug) {
      onClose();
      return;
    }
    await switchHub(hubSlug);
    onClose();
  };

  const handleComingSoonClick = (hubName: string, hubState: string) => {
    setCity(hubName);
    setState(hubState);
    setView('request');
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const cityClean = city.trim();
    if (cityClean.length < 2) {
      setFeedback({
        type: 'error',
        text: 'Please enter a valid city or town name.',
      });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    setStatus('saving', 'Submitting expansion request…');

    try {
      const res = await fetch('/api/hubs/request-city', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city_name: cityClean,
          state_name: state.trim() || undefined,
          contact_info: contactInfo.trim() || undefined,
          notes: 'Requested via DD oodle Unified Hub Modal',
          user_id: session?.user?.id || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || data?.error) {
        throw new Error(data?.error || 'Failed to submit request');
      }

      setFeedback({
        type: 'success',
        text: `Thank you! Your request for "${cityClean}" has been registered. We will notify you when DD oodle expands to your area.`,
      });
      setStatus('success', 'Request registered');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to submit request';
      setFeedback({ type: 'error', text: msg });
      setStatus('error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unified-hub-modal-title"
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl"
      >
        <AnimatePresence mode="wait">
          {view === 'list' ? (
            <motion.div
              key="hub-list-view"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18 }}
              className="p-5 sm:p-6 space-y-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] shadow-xs">
                    <DDoodleLogo variant="icon" size={26} />
                  </div>
                  <div>
                    <h2
                      id="unified-hub-modal-title"
                      className="text-base sm:text-lg font-bold text-slate-900 dark:text-white"
                    >
                      Choose Your Service Hub
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Local places, Pick N Drop &amp; rates tailored to your hub
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close hub selector"
                  className="rounded-full p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* GPS Auto-Detect Button */}
              <div>
                <button
                  type="button"
                  onClick={() => void handleDetectGPS()}
                  disabled={isDetectingGps || isSwitchingHub}
                  className="w-full flex items-center justify-center gap-2 h-10 px-4 rounded-2xl bg-theme-primary text-theme-primary-foreground font-bold text-xs sm:text-sm shadow-md hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isDetectingGps ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Navigation className="w-4 h-4" />
                  )}
                  <span>
                    {isDetectingGps
                      ? 'Locating your current coordinates…'
                      : 'Detect My Location (GPS)'}
                  </span>
                </button>

                {gpsFeedback && (
                  <p
                    role="status"
                    className="mt-2 text-xs text-center text-slate-600 dark:text-slate-300 font-medium px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/60"
                  >
                    {gpsFeedback}
                  </p>
                )}
              </div>

              {/* Active Hubs List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                  <span>Active Regional Hubs</span>
                  <span>{activeHubs.length} Online</span>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {activeHubs.map((hub) => {
                    const isCurrent = hub.slug === activeHub?.slug;
                    return (
                      <div
                        key={hub.id}
                        className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                          isCurrent
                            ? 'border-theme-primary/50 bg-theme-primary/[0.04] dark:bg-theme-primary/10 shadow-sm'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900 dark:text-white">
                              {hub.name}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              ({hub.state})
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            Radius: {hub.service_radius_km} km · Languages:{' '}
                            {hub.supported_languages.join(', ')}
                          </p>
                        </div>

                        {isCurrent ? (
                          <span className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-bold bg-theme-primary text-theme-primary-foreground shadow-sm">
                            <Check className="w-3.5 h-3.5" />
                            <span>Selected</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSelectHub(hub.slug)}
                            disabled={isSwitchingHub}
                            className="shrink-0 h-8 px-3.5 rounded-full text-xs font-bold border border-slate-300 dark:border-slate-700 hover:bg-theme-primary hover:text-theme-primary-foreground hover:border-transparent transition-all cursor-pointer"
                          >
                            Select
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Expanding Soon List */}
              {comingSoonHubs.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                    Expanding Soon
                  </div>

                  <div className="space-y-2">
                    {comingSoonHubs.map((hub) => (
                      <div
                        key={hub.id}
                        className="flex items-center justify-between p-3 rounded-2xl border border-dashed border-amber-300 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20"
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900 dark:text-white">
                              {hub.name}
                            </span>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                              COMING SOON
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {hub.state} · Launch pipeline
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleComingSoonClick(hub.name, hub.state)}
                          className="shrink-0 h-8 px-3 rounded-full text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer"
                        >
                          Notify / Request
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bottom Footer CTA */}
              <div className="border-t border-slate-100 dark:border-slate-800/80 pt-3 flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Don&apos;t see your town?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCity('');
                    setState('');
                    setView('request');
                  }}
                  className="text-xs font-bold text-theme-primary hover:underline cursor-pointer"
                >
                  Request a New Hub →
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="hub-request-view"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.18 }}
              className="p-5 sm:p-6 space-y-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 pb-4">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setView('list');
                      setFeedback(null);
                    }}
                    className="p-1 rounded-full text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    aria-label="Back to service hubs"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div>
                    <h2
                      id="unified-hub-modal-title"
                      className="text-base sm:text-lg font-bold text-slate-900 dark:text-white"
                    >
                      Request a New Hub
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Bring DD oodle to your town or district
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="rounded-full p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {feedback?.type === 'success' ? (
                <div className="space-y-4 py-4 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <Check className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Request Received!
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto">
                      {feedback.text}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setView('list');
                      setFeedback(null);
                    }}
                    className="h-9 px-4 rounded-xl bg-theme-primary text-theme-primary-foreground font-bold text-xs shadow hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    ← Back to Active Hubs
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmitRequest} className="space-y-3.5">
                  {feedback?.type === 'error' && (
                    <div
                      role="alert"
                      className="p-2.5 rounded-xl text-xs font-medium bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400"
                    >
                      {feedback.text}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      City / Town Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g. Imphal, Shillong, Champhai…"
                      className="w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-theme-primary/30"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      State / Region (Optional)
                    </label>
                    <input
                      type="text"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="e.g. Manipur, Mizoram, Meghalaya…"
                      className="w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-theme-primary/30"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      WhatsApp or Email (Optional)
                    </label>
                    <input
                      type="text"
                      value={contactInfo}
                      onChange={(e) => setContactInfo(e.target.value)}
                      placeholder="For launch notification"
                      className="w-full h-9 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-theme-primary/30"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setView('list')}
                      className="h-9 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-theme-primary text-theme-primary-foreground text-xs font-bold shadow hover:opacity-95 transition-opacity disabled:opacity-50 cursor-pointer"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>Submit Request</span>
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body
  );
}

export default UnifiedHubModal;

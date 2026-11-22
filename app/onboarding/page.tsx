'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  AtSign,
  BellPlus,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Send,
  Sparkles,
  Store,
  User,
} from 'lucide-react';
import { AvatarCropUploader } from '@/components/auth/AvatarCropUploader';
import { PartnerOnboardingClient } from '@/components/onboarding/PartnerOnboardingClient';
import { useHub } from '@/components/providers/AppConfigProvider';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import { ProfileSkeleton } from '@/components/shared/Skeletons';
import {
  LocalityCombobox,
  type LocalitySelection,
} from '@/components/ui/LocalityCombobox';
import { syncAuthenticatedProfileRole, useAuth } from '@/lib/auth';
import type { ServiceHubRecord } from '@/lib/config/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  clearPendingReferralCode,
  readPendingReferralCode,
} from '@/lib/referrals/pending-ref';
import {
  PHONE_REGEX,
  USERNAME_REGEX,
  formatPhone,
  formatUsername,
  mapSupabaseAuthError,
  resolveInitialRole,
} from '@/lib/validators';

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trackParam = searchParams.get('track');
  const { user, session, isLoading: authLoading } = useAuth();
  const { hubs, activeHub, switchHub, detectHubByGPS } = useHub();
  const { setStatus } = useAppStatus();

  const [viewMode, setViewMode] = useState<'partner' | 'profile_setup'>(
    trackParam ? 'partner' : 'profile_setup'
  );
  const [hasCompletedProfile, setHasCompletedProfile] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');

  // Multi-Hub & Default Locality State (Phase 68-A)
  const [selectedHubSlug, setSelectedHubSlug] = useState<string>(
    activeHub?.slug || 'churachandpur'
  );
  const [selectedLocality, setSelectedLocality] =
    useState<LocalitySelection | null>(null);
  const [isDetectingGps, setIsDetectingGps] = useState(false);
  const [gpsToastMessage, setGpsToastMessage] = useState<string | null>(null);
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
  const [requestContact, setRequestContact] = useState('');
  const [isSubmittingCityRequest, setIsSubmittingCityRequest] = useState(false);
  const [cityRequestFeedback, setCityRequestFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [nameError, setNameError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedHubRecord =
    hubs.find((h) => h.slug === selectedHubSlug) || activeHub;

  useEffect(() => {
    const slug = activeHub?.slug;
    if (slug && !selectedHubSlug) {
      queueMicrotask(() => {
        setSelectedHubSlug((prev) => prev || slug);
      });
    }
  }, [activeHub?.slug, selectedHubSlug]);

  useEffect(() => {
    let active = true;

    async function inspectProfile() {
      if (!isSupabaseConfigured()) {
        if (active) setIsCheckingProfile(false);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const activeUser = sessionData?.session?.user ?? user;

      if (!activeUser) {
        if (active) {
          setViewMode('partner');
          setIsCheckingProfile(false);
        }
        return;
      }

      const metaName =
        (activeUser.user_metadata?.full_name as string | undefined) ||
        (activeUser.user_metadata?.name as string | undefined) ||
        activeUser.email?.split('@')[0] ||
        '';
      const metaPhone = activeUser.phone || '';

      const { data: profileRow } = await supabase
        .from('profiles')
        .select(
          'id, full_name, name, username, phone, bio, avatar_url, role, role_type, default_hub_id'
        )
        .eq('id', activeUser.id)
        .maybeSingle();

      if (!active) return;

      const typedProfile = profileRow as {
        full_name?: string | null;
        name?: string | null;
        username?: string | null;
        phone?: string | null;
        bio?: string | null;
        avatar_url?: string | null;
        role?: string | null;
        role_type?: string | null;
        default_hub_id?: string | null;
      } | null;

      if (typedProfile?.full_name || typedProfile?.name || metaName) {
        setFullName(
          String(typedProfile?.full_name || typedProfile?.name || metaName)
        );
      }

      if (typedProfile?.username) {
        setUsername(formatUsername(typedProfile.username));
      } else if (activeUser.email?.includes('@')) {
        setUsername(formatUsername(activeUser.email.split('@')[0]));
      }

      if (typedProfile?.phone || metaPhone) {
        setPhone(String(typedProfile?.phone || metaPhone));
      }

      if (typedProfile?.bio) {
        setBio(typedProfile.bio);
      }

      if (typedProfile?.avatar_url) {
        setAvatarUrl(typedProfile.avatar_url);
      }

      if (typedProfile?.default_hub_id) {
        const matched = hubs.find((h) => h.id === typedProfile.default_hub_id);
        if (matched && matched.status === 'active') {
          setSelectedHubSlug(matched.slug);
        }
      }

      const isComplete = Boolean(
        (typedProfile?.role || typedProfile?.role_type) &&
          typedProfile?.full_name
      );
      setHasCompletedProfile(isComplete);

      if (trackParam || isComplete) {
        setViewMode('partner');
      } else {
        setViewMode('profile_setup');
      }

      setIsCheckingProfile(false);
    }

    if (!authLoading) {
      void inspectProfile();
    }

    return () => {
      active = false;
    };
  }, [user, authLoading, hubs, trackParam]);

  const handleSelectActiveHub = async (hub: ServiceHubRecord) => {
    if (hub.status !== 'active') return;
    setSelectedHubSlug(hub.slug);
    setSelectedLocality(null);
    setGpsToastMessage(`Welcome to ${hub.name} Hub`);
    await switchHub(hub.slug);
  };

  const handleDetectGps = async () => {
    setIsDetectingGps(true);
    setOutOfAreaInfo(null);
    setGpsToastMessage(null);
    setCityRequestFeedback(null);

    try {
      const res = await detectHubByGPS();
      if (res.is_within_service_area && res.matched_hub) {
        setSelectedHubSlug(res.matched_hub.slug);
        setSelectedLocality(null);
        setGpsToastMessage(`Welcome to ${res.matched_hub.name} Hub`);
        await switchHub(res.matched_hub.slug);
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
      setIsDetectingGps(false);
    }
  };

  const handleSubmitCityRequest = async () => {
    const cleanCity = requestedCity.trim();
    if (cleanCity.length < 2) {
      setCityRequestFeedback({
        type: 'error',
        text: 'Please enter a valid city or town name.',
      });
      return;
    }

    setIsSubmittingCityRequest(true);
    setCityRequestFeedback(null);
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
          requested_city: cleanCity,
          state: requestedState.trim() || null,
          contact_info: requestContact.trim() || phone.trim() || null,
          lat: outOfAreaInfo?.lat ?? null,
          lng: outOfAreaInfo?.lng ?? null,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!res.ok) {
        setCityRequestFeedback({
          type: 'error',
          text: payload.error || 'Could not submit city request.',
        });
        setStatus('error', 'Request failed');
        return;
      }

      setStatus('success', 'City request recorded');
      setCityRequestFeedback({
        type: 'success',
        text: `Thanks! We've logged demand for ${cleanCity}. Choose an active hub above to continue setup.`,
      });
      setRequestedCity('');
      setRequestedState('');
    } catch {
      setCityRequestFeedback({
        type: 'error',
        text: 'Network error while submitting request.',
      });
      setStatus('error', 'Network error');
    } finally {
      setIsSubmittingCityRequest(false);
    }
  };

  const validateFields = (): boolean => {
    const cleanedName = fullName.trim();
    const cleanedUsername = formatUsername(username);
    const cleanedPhone = phone.trim();
    let isValid = true;

    if (!cleanedName || cleanedName.length < 2) {
      setNameError('Please enter your full name (at least 2 characters).');
      isValid = false;
    } else {
      setNameError(null);
    }

    if (!cleanedUsername || !USERNAME_REGEX.test(cleanedUsername)) {
      setUsernameError(
        'Username must be 3–20 lowercase letters, numbers, or underscores.'
      );
      isValid = false;
    } else {
      setUsernameError(null);
    }

    if (!cleanedPhone || !PHONE_REGEX.test(cleanedPhone)) {
      setPhoneError(
        'Please enter a valid 10-digit Indian phone number (e.g., +91 9862011223).'
      );
      isValid = false;
    } else {
      setPhoneError(null);
    }

    return isValid;
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validateFields()) {
      setErrorMessage(
        'Please review and fix the highlighted account information fields.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const cleanedName = fullName.trim();
      const cleanedUsername = formatUsername(username);
      const cleanedPhone = phone.trim();
      const chosenHub =
        hubs.find((h) => h.slug === selectedHubSlug && h.status === 'active') ||
        activeHub;

      if (chosenHub?.slug) {
        await switchHub(chosenHub.slug);
      }

      if (typeof window !== 'undefined' && selectedLocality?.display_name) {
        try {
          window.localStorage.setItem(
            'psl_default_locality',
            JSON.stringify({
              id: selectedLocality.id || null,
              slug: selectedLocality.slug || null,
              display_name: selectedLocality.display_name,
              hub_id: chosenHub?.id || null,
            })
          );
        } catch {
          // ignore storage error
        }
      }

      if (isSupabaseConfigured()) {
        const { data: sessionData } = await supabase.auth.getSession();
        const activeUser = sessionData?.session?.user ?? user;

        if (activeUser?.id) {
          // Role is strictly assigned via resolveInitialRole — no self-service promotion to owner
          const lockedRole = resolveInitialRole(activeUser.email);

          const baseProfilePayload: Record<string, unknown> = {
            id: activeUser.id,
            email: activeUser.email ?? null,
            username: cleanedUsername,
            full_name: cleanedName,
            phone: cleanedPhone,
            bio: bio.trim() || null,
            avatar_url: avatarUrl.trim() || null,
            role: lockedRole,
            default_hub_id: chosenHub?.id || null,
            locality_id: selectedLocality?.id || null,
            updated_at: new Date().toISOString(),
          };

          // Attempt saving with default_locality_id first, falling back gracefully if column is absent
          const { error: upsertWithDefaultLocError } = await supabase
            .from('profiles')
            .upsert(
              {
                ...baseProfilePayload,
                default_locality_id: selectedLocality?.id || null,
              },
              { onConflict: 'id' }
            );

          if (upsertWithDefaultLocError) {
            const { error: fallbackUpsertError } = await supabase
              .from('profiles')
              .upsert(baseProfilePayload, { onConflict: 'id' });

            if (fallbackUpsertError) {
              throw fallbackUpsertError;
            }
          }

          await syncAuthenticatedProfileRole(
            activeUser,
            sessionData?.session ?? session ?? null,
            true
          );

          // Pass V6-B: Apply pending ?ref=CODE referral for OAuth / onboarding signups
          const pendingRef = readPendingReferralCode();
          if (pendingRef) {
            try {
              await supabase.rpc('apply_referral_code', {
                p_code: pendingRef,
                p_referral_type: 'user_signup',
                p_hub_id: chosenHub?.id || null,
              });
            } catch {
              // Non-blocking: invalid or self-referral codes safely ignored
            } finally {
              clearPendingReferralCode();
            }
          }
        }
      }

      router.push('/');
    } catch (err) {
      setErrorMessage(mapSupabaseAuthError(err));
      setIsSubmitting(false);
    }
  };

  if (isCheckingProfile && !trackParam) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-10">
        <div className="w-full max-w-lg mx-auto p-6">
          <ProfileSkeleton />
        </div>
      </main>
    );
  }

  if (trackParam || viewMode === 'partner' || !user) {
    return (
      <PartnerOnboardingClient
        showProfileSetupLink={Boolean(user) && !hasCompletedProfile}
        onSwitchToProfileSetup={() => setViewMode('profile_setup')}
      />
    );
  }

  const activeHubs = hubs.filter((h) => h.status === 'active');
  const comingSoonHubs = hubs.filter((h) => h.status === 'coming_soon');

  return (
    <main
      data-testid="onboarding-page"
      className="min-h-screen flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-10"
    >
      <div className="w-full max-w-lg mx-auto p-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] shadow-sm space-y-5">
        <div className="space-y-2 border-b border-gray-200 dark:border-gray-800 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <DDoodleLogo variant="mark" size={36} />
              <div>
                <span className="text-sm font-extrabold tracking-tight text-[var(--ps-text)] block">
                  DD oodle
                </span>
                <span className="text-[11px] text-[var(--ps-text-muted)]">
                  Complete Your Profile &amp; Regional Hub Setup
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setViewMode('partner')}
              data-testid="switch-to-partner-onboarding-btn"
              className="h-8 px-2.5 rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 text-[var(--ps-accent)] text-[11px] font-bold inline-flex items-center gap-1.5 hover:bg-[var(--ps-accent)]/15 transition-colors cursor-pointer"
            >
              <Store className="w-3.5 h-3.5 shrink-0" />
              <span>Partner / Driver Apply</span>
              <ArrowRight className="w-3 h-3 shrink-0" />
            </button>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            data-testid="onboarding-error-banner"
            className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form
          onSubmit={handleCompleteOnboarding}
          noValidate
          data-testid="onboarding-form"
          className="space-y-4"
        >
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-theme-primary">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Welcome to DD oodle</span>
            </div>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
              Finish your profile &amp; home hub
            </h1>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)] leading-relaxed">
              New accounts start as verified community visitors. Choose your home service hub and neighborhood for tailored maps, Pick N Drop rates, and local bulletins.
            </p>
          </div>

          {/* Step 1: Service Hub Detection & Selection */}
          <div
            data-testid="onboarding-hub-selection-section"
            className="rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] p-3.5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[var(--ps-text)]">
                1. Choose Your Home Service Hub
              </span>
              <button
                type="button"
                onClick={() => void handleDetectGps()}
                disabled={isDetectingGps}
                data-testid="onboarding-detect-hub-gps-btn"
                className="h-8 px-2.5 rounded-lg bg-theme-primary text-theme-primary-foreground text-[11px] font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60 cursor-pointer"
              >
                {isDetectingGps ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Navigation className="w-3.5 h-3.5" />
                )}
                <span>Detect My Location (GPS)</span>
              </button>
            </div>

            {gpsToastMessage && (
              <div
                role="status"
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/12 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{gpsToastMessage}</span>
              </div>
            )}

            {outOfAreaInfo && (
              <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                <p className="font-semibold">
                  {outOfAreaInfo.errorText ||
                    "We aren't live in your exact area yet — explore an active hub below or request your city!"}
                </p>
                {outOfAreaInfo.nearestHubName &&
                  typeof outOfAreaInfo.distanceKm === 'number' && (
                    <p className="text-[11px]">
                      Nearest hub: <strong>{outOfAreaInfo.nearestHubName}</strong>{' '}
                      ({outOfAreaInfo.distanceKm.toFixed(1)} km away)
                    </p>
                  )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {activeHubs.map((hub) => {
                const isSelected = selectedHubRecord?.slug === hub.slug;
                return (
                  <button
                    key={hub.id}
                    type="button"
                    data-testid={`onboarding-select-hub-${hub.slug}`}
                    onClick={() => void handleSelectActiveHub(hub)}
                    className={`p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-theme-primary bg-theme-primary/8 dark:bg-theme-primary/15 ring-1 ring-theme-primary/30'
                        : 'border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] hover:border-theme-primary/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-theme-primary shrink-0" />
                        <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                          {hub.name}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--ps-text-muted)] truncate mt-0.5">
                        {hub.state} · Active
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        isSelected
                          ? 'bg-theme-primary text-theme-primary-foreground'
                          : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {isSelected ? 'Selected' : 'Select'}
                    </span>
                  </button>
                );
              })}

              {comingSoonHubs.map((hub) => (
                <div
                  key={hub.id}
                  className="p-2.5 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-[var(--ps-surface)]/50 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                        {hub.name}
                      </span>
                    </div>
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                      Coming Soon
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRequestedCity(hub.name);
                      setRequestedState(hub.state || '');
                      setShowRequestForm(true);
                    }}
                    className="h-7 px-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <BellPlus className="w-3 h-3" />
                    <span>Notify</span>
                  </button>
                </div>
              ))}
            </div>

            {showRequestForm && (
              <div className="pt-2 border-t border-gray-200 dark:border-gray-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[var(--ps-text)]">
                    Request My City
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowRequestForm(false)}
                    className="text-[10px] font-semibold text-[var(--ps-text-muted)] cursor-pointer"
                  >
                    Hide
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={requestedCity}
                    onChange={(e) => setRequestedCity(e.target.value)}
                    placeholder="City / Town name"
                    className="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-[var(--ps-surface)] text-xs text-[var(--ps-text)]"
                  />
                  <input
                    type="text"
                    value={requestedState}
                    onChange={(e) => setRequestedState(e.target.value)}
                    placeholder="State (optional)"
                    className="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-[var(--ps-surface)] text-xs text-[var(--ps-text)]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={requestContact}
                    onChange={(e) => setRequestContact(e.target.value)}
                    placeholder="Contact for launch alert (optional)"
                    className="flex-1 h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-[var(--ps-surface)] text-xs text-[var(--ps-text)]"
                  />
                  <button
                    type="button"
                    disabled={isSubmittingCityRequest}
                    onClick={() => void handleSubmitCityRequest()}
                    className="h-8 px-3 rounded-lg bg-theme-primary text-theme-primary-foreground text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    {isSubmittingCityRequest ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    <span>Request</span>
                  </button>
                </div>
                {cityRequestFeedback && (
                  <p
                    className={`text-[11px] font-medium ${
                      cityRequestFeedback.type === 'error'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {cityRequestFeedback.text}
                  </p>
                )}
              </div>
            )}

            {/* Default Locality inside Selected Hub */}
            <div className="pt-1">
              <LocalityCombobox
                id="onboarding-locality-combobox"
                hubId={selectedHubRecord?.id || null}
                label={`Default Neighborhood / Veng in ${selectedHubRecord?.name || 'Hub'} (Optional)`}
                placeholder={`Search locality in ${selectedHubRecord?.name || 'your hub'}…`}
                value={
                  selectedLocality
                    ? {
                        id: selectedLocality.id,
                        display_name: selectedLocality.display_name,
                      }
                    : null
                }
                onSelect={(loc) => setSelectedLocality(loc)}
                onClear={() => setSelectedLocality(null)}
                allowCreate={true}
              />
            </div>
          </div>

          <AvatarCropUploader
            userId={user?.id || 'onboarding'}
            currentAvatarUrl={avatarUrl}
            onUploadComplete={(url) => setAvatarUrl(url)}
          />

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-full-name"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Full Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="onboarding-full-name"
                type="text"
                required
                aria-invalid={Boolean(nameError)}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                placeholder="e.g., Thangboi Haokip"
                data-testid="onboarding-name-input"
                className="w-full h-9 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-10 pr-4 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {nameError && (
              <p
                role="alert"
                className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
              >
                {nameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-username"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Username <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <AtSign className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="onboarding-username"
                type="text"
                required
                value={username}
                onChange={(e) => {
                  setUsername(formatUsername(e.target.value));
                  if (usernameError) setUsernameError(null);
                }}
                placeholder="username"
                data-testid="onboarding-username-input"
                className="w-full h-9 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-10 pr-4 text-xs font-mono text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {usernameError && (
              <p
                role="alert"
                className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
              >
                {usernameError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-phone"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Contact Phone Number <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Phone className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="onboarding-phone"
                type="tel"
                required
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhone(e.target.value));
                  if (phoneError) setPhoneError(null);
                }}
                placeholder="+91 9862011223"
                data-testid="onboarding-phone-input"
                className="w-full h-9 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-10 pr-4 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {phoneError && (
              <p
                role="alert"
                className="text-[11px] font-medium text-rose-600 dark:text-rose-400"
              >
                {phoneError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="onboarding-bio"
              className="block text-xs font-semibold text-[var(--ps-text)]"
            >
              Short Bio (Optional)
            </label>
            <div className="relative">
              <FileText className="h-4 w-4 text-[var(--ps-text-muted)] absolute left-3.5 top-2.5 pointer-events-none" />
              <textarea
                id="onboarding-bio"
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell the community about yourself…"
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] pl-10 pr-4 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            data-testid="onboarding-submit-btn"
            className="w-full inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-sm transition hover:opacity-95 disabled:opacity-60 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Saving Profile…</span>
              </>
            ) : (
              <>
                <span>Complete Setup</span>
                <CheckCircle2 className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 py-10">
          <div className="w-full max-w-lg mx-auto p-6">
            <ProfileSkeleton />
          </div>
        </main>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}

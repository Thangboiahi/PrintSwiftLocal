'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Phone,
  Sparkles,
  Store,
  X,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';
import { useAuth } from '@/lib/store';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { PHONE_REGEX } from '@/lib/validators';

export type FeaturedSlotSection =
  | 'featured_places'
  | 'featured_products'
  | 'featured_properties'
  | 'featured_vehicles';

export type FeaturedEntityType = 'listing' | 'product' | 'menu_item' | 'vehicle';

interface OwnedFeatureableItem {
  id: string;
  title: string;
  entityType: FeaturedEntityType;
  slotSection: FeaturedSlotSection;
  subtitle: string;
}

export interface GetFeaturedModalProps {
  open: boolean;
  onClose: () => void;
  hubId: string | null;
  hubName: string;
  defaultSection?: FeaturedSlotSection;
  onRequireSignIn?: () => void;
}

const DURATION_OPTIONS: Array<{
  days: number;
  feeInr: number;
  label: string;
  description: string;
}> = [
  {
    days: 7,
    feeInr: 199,
    label: '7 Days · ₹199',
    description: '1 week priority homepage spotlight',
  },
  {
    days: 15,
    feeInr: 349,
    label: '15 Days · ₹349',
    description: '2 weeks featured placement (Most Popular)',
  },
  {
    days: 30,
    feeInr: 599,
    label: '30 Days · ₹599',
    description: 'Full month top-of-hub homepage feature',
  },
];

function generateFeaturedRequestCode(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `DDF-${yy}${mm}-${rand}`;
}

export function GetFeaturedModal({
  open,
  onClose,
  hubId,
  hubName,
  defaultSection = 'featured_places',
  onRequireSignIn,
}: GetFeaturedModalProps) {
  const { user } = useAuth();
  const { setStatus } = useAppStatus();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [loadingItems, setLoadingItems] = useState(false);
  const [ownedItems, setOwnedItems] = useState<OwnedFeatureableItem[]>([]);
  const [selectedItemKey, setSelectedItemKey] = useState<string>('');
  const [durationDays, setDurationDays] = useState<string>('15');
  const [preferredContact, setPreferredContact] = useState<'whatsapp' | 'phone'>(
    'whatsapp'
  );
  const [contactPhone, setContactPhone] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user?.id || !isSupabaseConfigured()) return;
    let active = true;
    setLoadingItems(true);
    setErrorMsg(null);
    setSubmittedCode(null);

    const loadOwnedEntities = async () => {
      try {
        const [profileRes, listingsRes, vehiclesRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('phone')
            .eq('id', user.id)
            .maybeSingle(),
          supabase
            .from('listings')
            .select('id, title, locality, listing_vertical, hub_id')
            .eq('owner_id', user.id)
            .eq('lifecycle_status', 'active')
            .limit(40),
          supabase
            .from('vehicle_listings')
            .select('id, title, stand_locality, hub_id')
            .eq('owner_id', user.id)
            .eq('is_active', true)
            .limit(20),
        ]);

        if (!active) return;

        if (profileRes.data?.phone) {
          setContactPhone((prev) => prev || String(profileRes.data?.phone || ''));
        }

        const collected: OwnedFeatureableItem[] = [];
        const listingIds: string[] = [];

        if (Array.isArray(listingsRes.data)) {
          for (const row of listingsRes.data as Array<Record<string, unknown>>) {
            const id = String(row.id || '');
            if (!id) continue;
            listingIds.push(id);
            const vertical = String(row.listing_vertical || 'general');
            const section: FeaturedSlotSection =
              vertical === 'real_estate'
                ? 'featured_properties'
                : 'featured_places';
            collected.push({
              id,
              title: String(row.title || 'My Listing').replace(
                /^\[SAMPLE\]\s*/i,
                ''
              ),
              entityType: 'listing',
              slotSection: section,
              subtitle: `${vertical.replace(/_/g, ' ')} · ${String(row.locality || hubName)}`,
            });
          }
        }

        if (listingIds.length > 0) {
          const { data: prodRows } = await supabase
            .from('marketplace_products')
            .select('id, title, price, unit')
            .in('listing_id', listingIds)
            .limit(30);
          if (active && Array.isArray(prodRows)) {
            for (const p of prodRows as Array<Record<string, unknown>>) {
              const id = String(p.id || '');
              if (!id) continue;
              collected.push({
                id,
                title: String(p.title || 'Product').replace(
                  /^\[SAMPLE\]\s*/i,
                  ''
                ),
                entityType: 'product',
                slotSection: 'featured_products',
                subtitle: `Product · ₹${Number(p.price || 0).toLocaleString('en-IN')}/${String(p.unit || 'unit')}`,
              });
            }
          }
        }

        if (Array.isArray(vehiclesRes.data)) {
          for (const v of vehiclesRes.data as Array<Record<string, unknown>>) {
            const id = String(v.id || '');
            if (!id) continue;
            collected.push({
              id,
              title: String(v.title || 'Vehicle').replace(
                /^\[SAMPLE\]\s*/i,
                ''
              ),
              entityType: 'vehicle',
              slotSection: 'featured_vehicles',
              subtitle: `Vehicle · ${String(v.stand_locality || hubName)}`,
            });
          }
        }

        setOwnedItems(collected);
        const preferred =
          collected.find((c) => c.slotSection === defaultSection) ||
          collected[0];
        if (preferred) {
          setSelectedItemKey(`${preferred.entityType}:${preferred.id}`);
        }
      } catch {
        // Non-blocking
      } finally {
        if (active) setLoadingItems(false);
      }
    };

    void loadOwnedEntities();
    return () => {
      active = false;
    };
  }, [open, user?.id, hubName, defaultSection]);

  const itemOptions: CustomSelectOption[] = useMemo(
    () =>
      ownedItems.map((item) => ({
        value: `${item.entityType}:${item.id}`,
        label: item.title,
        description: item.subtitle,
      })),
    [ownedItems]
  );

  const durationSelectOptions: CustomSelectOption[] = useMemo(
    () =>
      DURATION_OPTIONS.map((d) => ({
        value: String(d.days),
        label: d.label,
        description: d.description,
      })),
    []
  );

  const selectedItem = useMemo(
    () =>
      ownedItems.find((i) => `${i.entityType}:${i.id}` === selectedItemKey) ||
      null,
    [ownedItems, selectedItemKey]
  );

  const selectedDuration =
    DURATION_OPTIONS.find((d) => String(d.days) === durationDays) ||
    DURATION_OPTIONS[1];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !selectedItem || !hubId || isSubmitting) return;
    setErrorMsg(null);

    const cleanPhone = contactPhone.trim();
    if (!PHONE_REGEX.test(cleanPhone)) {
      setErrorMsg('Please enter a valid 10-digit Indian phone number.');
      return;
    }

    const ok = await confirm({
      title: `Submit Featured Request for "${selectedItem.title}"?`,
      description: `Duration: ${selectedDuration.days} days (Quoted ₹${selectedDuration.feeInr}). Our ${hubName} Hub Manager will contact you via ${preferredContact === 'whatsapp' ? 'WhatsApp' : 'Phone'} on ${cleanPhone} to activate your slot.`,
      confirmLabel: 'Confirm & Submit Request',
      cancelLabel: 'Review',
      variant: 'default',
    });
    if (!ok) return;

    setIsSubmitting(true);
    setStatus('saving', 'Submitting featured request…');

    try {
      const requestCode = generateFeaturedRequestCode();
      const { error } = await supabase.from('featured_requests').insert({
        request_code: requestCode,
        hub_id: hubId,
        requester_id: user.id,
        slot_section: selectedItem.slotSection,
        entity_type: selectedItem.entityType,
        entity_id: selectedItem.id,
        duration_days: selectedDuration.days,
        quoted_fee_inr: selectedDuration.feeInr,
        preferred_contact: preferredContact,
        contact_phone: cleanPhone,
        notes: notes.trim() || null,
        status: 'submitted',
      });

      if (error) throw new Error(error.message);
      setSubmittedCode(requestCode);
      setStatus('success', `Featured request ${requestCode} submitted!`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to submit request.';
      setErrorMsg(msg);
      setStatus('error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="get-featured-modal-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isSubmitting && onClose()}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18 }}
            data-testid="get-featured-modal"
            className="relative z-10 w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-5 py-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="get-featured-modal-title"
                    className="text-sm font-extrabold text-[var(--ps-text)] truncate"
                  >
                    Get Featured in {hubName}
                  </h2>
                  <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                    Homepage spotlight managed by local hub team
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={onClose}
                aria-label="Close modal"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-bg)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {!user ? (
                <div className="text-center space-y-3 py-3">
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Sign in to feature your verified business, product, property,
                    or vehicle on the {hubName} homepage.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onRequireSignIn?.();
                    }}
                    className="h-9 px-4 rounded-xl bg-theme-primary text-theme-primary-foreground text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <span>Sign In to Continue</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : submittedCode ? (
                <div className="text-center space-y-3 py-3">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                      Request Submitted ({submittedCode})
                    </h3>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Our {hubName} Hub Manager will reach out on{' '}
                      <strong>{contactPhone}</strong> to confirm and activate
                      your featured slot.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 px-4 rounded-xl bg-theme-primary text-theme-primary-foreground text-xs font-bold"
                  >
                    Done
                  </button>
                </div>
              ) : loadingItems ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[var(--ps-text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--ps-accent)]" />
                  <span>Loading your active listings…</span>
                </div>
              ) : ownedItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-center space-y-3">
                  <Store className="w-7 h-7 mx-auto text-[var(--ps-accent)]" />
                  <div className="space-y-1">
                    <div className="font-bold text-sm text-[var(--ps-text)]">
                      No Active Listings Yet
                    </div>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Apply as a verified Business Partner first so we can list
                      and feature your shop, products, property, or vehicle in{' '}
                      {hubName}.
                    </p>
                  </div>
                  <Link
                    href="/onboarding?track=business&intent=featured"
                    onClick={onClose}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground hover:opacity-95"
                  >
                    <span>Apply as Business Partner</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3.5">
                  {errorMsg && (
                    <div
                      role="alert"
                      className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400"
                    >
                      {errorMsg}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--ps-text)]">
                      Select Listing, Product, Property or Vehicle
                    </label>
                    <CustomSelectModal
                      label="Choose item to feature"
                      options={itemOptions}
                      value={selectedItemKey}
                      onChange={setSelectedItemKey}
                      placeholder="Select item"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--ps-text)]">
                      Spotlight Duration
                    </label>
                    <CustomSelectModal
                      label="Choose featured duration"
                      options={durationSelectOptions}
                      value={durationDays}
                      onChange={setDurationDays}
                      placeholder="Select duration"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPreferredContact('whatsapp')}
                      className={`h-9 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                        preferredContact === 'whatsapp'
                          ? 'border-emerald-500 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreferredContact('phone')}
                      className={`h-9 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                        preferredContact === 'phone'
                          ? 'border-sky-500 bg-sky-500/12 text-sky-700 dark:text-sky-300'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Phone Call</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    <PhoneInputWithCountry
                      id="get-featured-contact-phone"
                      label="Callback Phone / WhatsApp Number"
                      required
                      value={contactPhone}
                      onChange={(next) => setContactPhone(next)}
                      variant="sm"
                      testId="get-featured-phone-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--ps-text)]">
                      Notes (Optional)
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Preferred start date or badge text…"
                      className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || !selectedItem}
                    className="w-full h-9 rounded-xl bg-theme-primary text-theme-primary-foreground text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>
                      Request Featured ({selectedDuration.label})
                    </span>
                  </button>
                </form>
              )}
            </div>
          </motion.div>
          {confirmDialog}
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default GetFeaturedModal;

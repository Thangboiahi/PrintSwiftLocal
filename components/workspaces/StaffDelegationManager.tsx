'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  StaffDelegationRecord,
  StaffPermissionsJson,
  addDelegate,
  fetchDelegations,
  removeDelegate,
} from '@/lib/supabase/delegations';
import { StaffDelegationSkeleton } from '@/components/shared/Skeletons';
import {
  formatSubscriptionLimitValue,
  getLimit,
  type EffectiveEntitlements,
} from '@/lib/subscriptions/feature-catalog';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

const VERTICAL_SCOPE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'print_queue', label: 'Print Queue' },
  { key: 'booking_checkin', label: 'Booking & Check-In Desk' },
  { key: 'kitchen_shop_stock', label: 'Kitchen & Shop Stock' },
  { key: 'property_visits', label: 'Property Visits' },
  { key: 'enquiries', label: 'Enquiries' },
];

export interface StaffDelegationManagerProps {
  listingId: string;
  listingTitle?: string;
}

const PERMISSION_OPTIONS: Array<{
  key: keyof StaffPermissionsJson;
  label: string;
  description: string;
}> = [
  {
    key: 'can_edit_details',
    label: 'Can Edit Details',
    description: 'Update descriptions, contact details, and hours',
  },
  {
    key: 'can_manage_media',
    label: 'Can Manage Media',
    description: 'Upload or update gallery images and 360° panoramas',
  },
  {
    key: 'can_manage_catalogue',
    label: 'Can Manage Catalogue',
    description: 'Add or edit products, prices, and stock availability',
  },
  {
    key: 'can_reply_enquiries',
    label: 'Can Reply Enquiries',
    description: 'View and respond to visitor enquiry messages',
  },
  {
    key: 'can_reply_reviews',
    label: 'Can Reply Reviews',
    description: 'Post official owner/agent responses to customer reviews',
  },
  {
    key: 'can_view_analytics',
    label: 'Can View Analytics',
    description: 'Access listing views, map impressions, and click metrics',
  },
];

export function StaffDelegationManager({
  listingId,
  listingTitle,
}: StaffDelegationManagerProps) {
  const { user: authUser } = useAuth();
  const [delegations, setDelegations] = useState<StaffDelegationRecord[]>([]);
  const [maxStaffMembers, setMaxStaffMembers] = useState<number>(3);
  const [selectedVerticalScopes, setSelectedVerticalScopes] = useState<
    string[]
  >(['kitchen_shop_stock', 'enquiries']);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Add Delegate Form State
  const [staffEmail, setStaffEmail] = useState<string>('');
  const [permissions, setPermissions] = useState<StaffPermissionsJson>({
    can_edit_details: true,
    can_manage_media: true,
    can_manage_catalogue: false,
    can_reply_enquiries: true,
    can_reply_reviews: false,
    can_view_analytics: true,
  });
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadDelegations = useCallback(async () => {
    if (!listingId) {
      setIsLoading(false);
      return;
    }

    try {
      const records = await fetchDelegations(listingId);
      setDelegations(records);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to load staff delegations for this listing.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [listingId]);

  useEffect(() => {
    let active = true;
    async function init() {
      await Promise.resolve();
      if (!active) return;
      await loadDelegations();
    }
    void init();
    return () => {
      active = false;
    };
  }, [loadDelegations]);

  // Pass R5: Load composable max_staff_members quota from get_effective_entitlements()
  useEffect(() => {
    if (!authUser?.id || !isSupabaseConfigured()) return;
    let active = true;
    const loadQuota = async () => {
      try {
        const { data, error } = await supabase.rpc(
          'get_effective_entitlements',
          {
            p_user_id: authUser.id,
            p_listing_id: listingId || null,
          }
        );
        if (!active || error || !data || typeof data !== 'object') return;
        const cap =
          getLimit(data as EffectiveEntitlements, 'max_staff_members') || 3;
        setMaxStaffMembers(cap);
      } catch {
        // Non-blocking fallback
      }
    };
    void loadQuota();
    return () => {
      active = false;
    };
  }, [authUser?.id, listingId]);

  const toggleVerticalScope = (scopeKey: string) => {
    setSelectedVerticalScopes((prev) =>
      prev.includes(scopeKey)
        ? prev.filter((k) => k !== scopeKey)
        : [...prev, scopeKey]
    );
  };

  const isStaffQuotaReached =
    maxStaffMembers >= 0 && delegations.length >= maxStaffMembers;

  const togglePermission = (key: keyof StaffPermissionsJson) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleAddDelegate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedEmail = staffEmail.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter the staff member’s registered email address.');
      return;
    }

    const hasAnyPermission = Object.values(permissions).some(Boolean);
    if (!hasAnyPermission) {
      setErrorMessage('Please grant at least one permission to the staff delegate.');
      return;
    }

    if (isStaffQuotaReached) {
      setErrorMessage(
        `Staff quota reached (${delegations.length}/${formatSubscriptionLimitValue(maxStaffMembers)}). Upgrade your subscription plan to add more staff.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await addDelegate(listingId, trimmedEmail, permissions);
      // Persist granular vertical_scopes on listing_staff_assignments if present
      if (isSupabaseConfigured() && created.staff_id) {
        try {
          await supabase.from('listing_staff_assignments').upsert(
            {
              listing_id: listingId,
              staff_user_id: created.staff_id,
              status: 'active',
              vertical_scopes: selectedVerticalScopes,
            },
            { onConflict: 'listing_id,staff_user_id' }
          );
        } catch {
          // Non-blocking when table not migrated yet
        }
      }
      setDelegations((prev) => [created, ...prev]);
      setStaffEmail('');
      setSuccessMessage(
        `Assigned ${created.staff_name} (${created.staff_email}) to this listing.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not assign staff delegate. Verify the email exists in profiles.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveDelegate = async (delegation: StaffDelegationRecord) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setRemovingId(delegation.id);

    try {
      await removeDelegate(delegation.id);
      setDelegations((prev) => prev.filter((d) => d.id !== delegation.id));
      setSuccessMessage(
        `Removed ${delegation.staff_name} (${delegation.staff_email}) from this listing.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to remove staff delegation.'
      );
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section
      data-testid="staff-delegation-manager"
      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 sm:p-5 space-y-5 text-xs"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--ps-accent)]" />
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Staff &amp; Agent Delegation Manager
            </h4>
          </div>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Assign local team members or agents by email with granular JSON
            permissions{listingTitle ? ` for "${listingTitle}"` : ''}.
          </p>
        </div>

        <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text)] tabular-nums">
          <Shield className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
          <span>
            {delegations.length} / {formatSubscriptionLimitValue(maxStaffMembers)} Staff
          </span>
        </span>
      </div>

      {/* Feedback Banners */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="delegation-error-banner"
          className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-700 dark:text-rose-300"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          data-testid="delegation-success-banner"
          className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Current Assigned Staff List */}
      <div className="space-y-2.5">
        <div className="font-bold text-[var(--ps-text)]">
          Current Listing Team
        </div>

        {isLoading ? (
          <StaffDelegationSkeleton count={2} />
        ) : delegations.length === 0 ? (
          <div
            data-testid="delegations-empty"
            className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 text-center text-[var(--ps-text-muted)]"
          >
            No staff members or agents are currently assigned to this listing.
          </div>
        ) : (
          <div className="space-y-2" data-testid="delegations-list">
            {delegations.map((del) => {
              const activePermissionLabels = PERMISSION_OPTIONS.filter(
                (opt) => Boolean(del.permissions?.[opt.key])
              );

              return (
                <div
                  key={del.id}
                  data-testid={`delegation-row-${del.id}`}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 sm:flex-row sm:items-center"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-[var(--ps-text)] text-xs">
                        {del.staff_name}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
                        <Mail className="h-3 w-3" />
                        <span>{del.staff_email}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {activePermissionLabels.length > 0 ? (
                        activePermissionLabels.map((perm) => (
                          <span
                            key={String(perm.key)}
                            className="rounded-md bg-[var(--ps-accent)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--ps-accent)]"
                          >
                            {perm.label}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-[var(--ps-text-muted)]">
                          Read-only access
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleRemoveDelegate(del)}
                    disabled={removingId === del.id}
                    data-testid={`remove-delegate-btn-${del.id}`}
                    className="inline-flex items-center justify-center gap-1.5 self-start sm:self-center rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    {removingId === del.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    <span>Remove</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add New Staff Member Form */}
      <form
        onSubmit={handleAddDelegate}
        className="space-y-4 border-t border-[var(--ps-border)] pt-4"
        noValidate
      >
        <div className="font-bold text-[var(--ps-text)] flex items-center gap-1.5">
          <UserPlus className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
          <span>Add Staff Member by Email</span>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="delegate-staff-email"
            className="block font-semibold text-[var(--ps-text)]"
          >
            Staff Registered Email Address <span className="text-rose-500">*</span>
          </label>
          <input
            id="delegate-staff-email"
            type="email"
            required
            value={staffEmail}
            onChange={(e) => setStaffEmail(e.target.value)}
            placeholder="e.g., agent@printswift.local"
            disabled={isSubmitting}
            data-testid="delegate-email-input"
            className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] disabled:opacity-60"
          />
        </div>

        <div className="space-y-2">
          <span className="block font-semibold text-[var(--ps-text)]">
            Grant Permissions
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PERMISSION_OPTIONS.map((opt) => {
              const checked = Boolean(permissions[opt.key]);
              return (
                <label
                  key={String(opt.key)}
                  className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer transition ${
                    checked
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10'
                      : 'border-[var(--ps-border)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePermission(opt.key)}
                    disabled={isSubmitting}
                    data-testid={`delegate-perm-${String(opt.key)}`}
                    className="mt-0.5 rounded border-[var(--ps-border)]"
                  />
                  <div className="space-y-0.5">
                    <div className="font-bold text-[var(--ps-text)] text-xs">
                      {opt.label}
                    </div>
                    <div className="text-[10px] text-[var(--ps-text-muted)] leading-snug">
                      {opt.description}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Pass R5: Granular Vertical Desk Scopes */}
        <div className="space-y-2">
          <span className="block font-semibold text-[var(--ps-text)]">
            Operational Vertical Scopes
          </span>
          <div className="flex flex-wrap gap-1.5">
            {VERTICAL_SCOPE_OPTIONS.map((scope) => {
              const active = selectedVerticalScopes.includes(scope.key);
              return (
                <button
                  key={scope.key}
                  type="button"
                  data-testid={`delegate-scope-${scope.key}`}
                  onClick={() => toggleVerticalScope(scope.key)}
                  className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border-[var(--ps-accent)]/45'
                      : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {active ? '✓ ' : '+ '}
                  {scope.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || isStaffQuotaReached}
            data-testid="add-delegate-submit-btn"
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95 disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Assigning Staff...</span>
              </>
            ) : (
              <>
                <UserPlus className="h-3.5 w-3.5" />
                <span>Assign Staff Member</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

export default StaffDelegationManager;

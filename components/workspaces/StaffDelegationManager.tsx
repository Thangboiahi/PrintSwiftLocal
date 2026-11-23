'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Edit3,
  Loader2,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  StaffDelegationRecord,
  StaffPermissionsJson,
  addDelegateByUserId,
  fetchDelegations,
  removeDelegate,
  updateDelegatePermissions,
} from '@/lib/supabase/delegations';
import { StaffDelegationSkeleton } from '@/components/shared/Skeletons';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import {
  UserUsernameSearch,
  type PublicUsernameProfile,
} from '@/components/ui/UserUsernameSearch';
import { isUuid } from '@/lib/payments/types';
import {
  formatSubscriptionLimitValue,
  getLimit,
  hasFeature,
  type EffectiveEntitlements,
} from '@/lib/subscriptions/feature-catalog';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { ListingVertical } from '@/lib/verticals/types';

export interface StagedStaffDelegation {
  staff_id: string;
  staff_username: string;
  staff_name: string;
  staff_avatar_url?: string | null;
  permissions: StaffPermissionsJson;
  vertical_scopes: string[];
}

export interface StaffDelegationManagerProps {
  listingId: string | null | undefined;
  listingTitle?: string;
  listingVertical?: ListingVertical;
  /** Optional staged staff array for brand-new unsaved listings (mode === 'create') */
  stagedStaff?: StagedStaffDelegation[];
  onChangeStagedStaff?: (next: StagedStaffDelegation[]) => void;
}

const CORE_PERMISSION_OPTIONS: Array<{
  key: keyof StaffPermissionsJson;
  label: string;
  shortLabel: string;
  description: string;
  verticals?: ListingVertical[];
}> = [
  {
    key: 'can_edit_details',
    label: 'Edit Details',
    shortLabel: 'Edit Details',
    description: 'Update descriptions, contact details, and hours',
  },
  {
    key: 'can_manage_media',
    label: 'Manage Media',
    shortLabel: 'Manage Media',
    description: 'Upload or update gallery photos and 360° views',
  },
  {
    key: 'can_manage_catalogue',
    label: 'Manage Catalogue / Menu',
    shortLabel: 'Catalogue/Menu',
    description: 'Add or edit products, dishes, prices, and stock',
    verticals: ['shop_catalogue', 'restaurant_food', 'print_digital', 'general'],
  },
  {
    key: 'can_reply_enquiries',
    label: 'Reply Enquiries',
    shortLabel: 'Reply Enquiries',
    description: 'View and respond to visitor enquiry messages',
  },
  {
    key: 'can_reply_reviews',
    label: 'Reply Reviews',
    shortLabel: 'Reply Reviews',
    description: 'Post official responses to customer reviews',
  },
  {
    key: 'can_view_analytics',
    label: 'View Analytics',
    shortLabel: 'View Analytics',
    description: 'Access listing views, map impressions, and click metrics',
  },
];

const VERTICAL_SCOPE_OPTIONS: Array<{
  key: string;
  label: string;
  description: string;
  verticals: ListingVertical[];
}> = [
  {
    key: 'print_queue',
    label: 'Print Orders',
    description: 'Process live DD oodle Print & counter print jobs',
    verticals: ['print_digital'],
  },
  {
    key: 'kitchen_shop_stock',
    label: 'Food / Shop Orders',
    description: 'Accept kitchen/storefront orders & toggle stock',
    verticals: ['restaurant_food', 'shop_catalogue'],
  },
  {
    key: 'booking_checkin',
    label: 'Booking Calendar',
    description: 'Manage slots, walk-in blocks & Check-In OTPs',
    verticals: ['booking_venue', 'hotel_stay', 'restaurant_food'],
  },
  {
    key: 'property_visits',
    label: 'Site Visits',
    description: 'Review & approve property site visit requests',
    verticals: ['real_estate'],
  },
  {
    key: 'enquiries',
    label: 'Direct Enquiries Desk',
    description: 'Follow up on public callbacks & lead messages',
    verticals: [
      'general',
      'print_digital',
      'restaurant_food',
      'shop_catalogue',
      'booking_venue',
      'hotel_stay',
      'real_estate',
      'public_civic',
    ],
  },
];

function getDefaultScopesForVertical(v: ListingVertical): string[] {
  if (v === 'print_digital') return ['print_queue', 'enquiries'];
  if (v === 'restaurant_food' || v === 'shop_catalogue')
    return ['kitchen_shop_stock', 'enquiries'];
  if (v === 'booking_venue' || v === 'hotel_stay')
    return ['booking_checkin', 'enquiries'];
  if (v === 'real_estate') return ['property_visits', 'enquiries'];
  return ['enquiries'];
}

function getDefaultPermissionsForVertical(
  v: ListingVertical
): StaffPermissionsJson {
  return {
    can_edit_details: true,
    can_manage_media: true,
    can_manage_catalogue:
      v === 'shop_catalogue' || v === 'restaurant_food' || v === 'print_digital',
    can_reply_enquiries: true,
    can_reply_reviews: false,
    can_view_analytics: true,
  };
}

export function StaffDelegationManager({
  listingId,
  listingTitle,
  listingVertical = 'general',
  stagedStaff = [],
  onChangeStagedStaff,
}: StaffDelegationManagerProps) {
  const { user: authUser } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const validListingId =
    typeof listingId === 'string' && isUuid(listingId) ? listingId.trim() : null;
  const isDraftStagingMode = !validListingId;

  const { entitlements } = useEffectiveEntitlements(
    authUser?.id,
    validListingId
  );

  const [delegations, setDelegations] = useState<StaffDelegationRecord[]>([]);
  const [maxStaffMembers, setMaxStaffMembers] = useState<number>(3);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(validListingId));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Step A: Search by @username first (no permission wall before user is selected!)
  const [selectedCandidate, setSelectedCandidate] =
    useState<PublicUsernameProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Step B: Individual permissions for the selected candidate
  const [candidatePermissions, setCandidatePermissions] =
    useState<StaffPermissionsJson>(() =>
      getDefaultPermissionsForVertical(listingVertical)
    );
  const [candidateScopes, setCandidateScopes] = useState<string[]>(() =>
    getDefaultScopesForVertical(listingVertical)
  );

  // Per-Staff Inline Edit State
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editPermissionsDraft, setEditPermissionsDraft] =
    useState<StaffPermissionsJson>({});
  const [editScopesDraft, setEditScopesDraft] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Reset candidate defaults when vertical changes
  useEffect(() => {
    setCandidatePermissions(getDefaultPermissionsForVertical(listingVertical));
    setCandidateScopes(getDefaultScopesForVertical(listingVertical));
  }, [listingVertical]);

  const loadDelegations = useCallback(async () => {
    if (!validListingId) {
      setDelegations([]);
      setIsLoading(false);
      return;
    }

    try {
      const records = await fetchDelegations(validListingId);
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
  }, [validListingId]);

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

  // Load composable max_staff_members quota
  useEffect(() => {
    if (!authUser?.id || !isSupabaseConfigured()) return;
    let active = true;
    const loadQuota = async () => {
      try {
        const { data, error } = await supabase.rpc(
          'get_effective_entitlements',
          {
            p_user_id: authUser.id,
            p_listing_id: validListingId,
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
  }, [authUser?.id, validListingId]);

  // Filter core permissions & vertical scopes relevant to this vertical + owner entitlements
  const relevantCorePermissions = useMemo(
    () =>
      CORE_PERMISSION_OPTIONS.filter(
        (opt) => !opt.verticals || opt.verticals.includes(listingVertical)
      ),
    [listingVertical]
  );

  const relevantVerticalScopes = useMemo(() => {
    const anyProEnabled =
      hasFeature(entitlements, 'print_online_orders') ||
      hasFeature(entitlements, 'booking_slots') ||
      hasFeature(entitlements, 'hotel_multi_room') ||
      hasFeature(entitlements, 'restaurant_table_booking') ||
      hasFeature(entitlements, 'shop_basket_checkout') ||
      hasFeature(entitlements, 'restaurant_menu_ordering') ||
      hasFeature(entitlements, 'real_estate_site_visit_queue');

    return VERTICAL_SCOPE_OPTIONS.filter((scope) => {
      if (!scope.verticals.includes(listingVertical)) return false;
      if (!anyProEnabled) return true;
      switch (scope.key) {
        case 'print_queue':
          return hasFeature(entitlements, 'print_online_orders');
        case 'booking_checkin':
          return (
            hasFeature(entitlements, 'booking_slots') ||
            hasFeature(entitlements, 'hotel_multi_room') ||
            hasFeature(entitlements, 'restaurant_table_booking')
          );
        case 'kitchen_shop_stock':
          return (
            hasFeature(entitlements, 'shop_basket_checkout') ||
            hasFeature(entitlements, 'restaurant_menu_ordering')
          );
        case 'property_visits':
          return hasFeature(entitlements, 'real_estate_site_visit_queue');
        default:
          return true;
      }
    });
  }, [listingVertical, entitlements]);

  // Unified team list (saved delegations OR staged draft members)
  const displayTeam: StaffDelegationRecord[] = useMemo(() => {
    if (!isDraftStagingMode) return delegations;
    return stagedStaff.map((s) => ({
      id: `staged-${s.staff_id}`,
      listing_id: 'draft',
      staff_id: s.staff_id,
      staff_username: s.staff_username,
      staff_name: s.staff_name,
      staff_email: `@${s.staff_username}`,
      staff_avatar_url: s.staff_avatar_url || null,
      permissions: s.permissions,
      vertical_scopes: s.vertical_scopes,
      granted_at: new Date().toISOString(),
      isStagedDraft: true,
    }));
  }, [isDraftStagingMode, delegations, stagedStaff]);

  const existingStaffIds = useMemo(() => {
    const ids = displayTeam.map((d) => d.staff_id);
    if (authUser?.id) ids.push(authUser.id);
    return ids;
  }, [displayTeam, authUser?.id]);

  const isStaffQuotaReached =
    maxStaffMembers >= 0 && displayTeam.length >= maxStaffMembers;

  const toggleCandidatePermission = (key: keyof StaffPermissionsJson) => {
    setCandidatePermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const toggleCandidateScope = (scopeKey: string) => {
    setCandidateScopes((prev) =>
      prev.includes(scopeKey)
        ? prev.filter((k) => k !== scopeKey)
        : [...prev, scopeKey]
    );
  };

  const handleAddSelectedCandidate = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedCandidate) {
      setErrorMessage('Please search and select a team member by @username first.');
      return;
    }

    const hasAnyPerm =
      Object.values(candidatePermissions).some(Boolean) ||
      candidateScopes.length > 0;
    if (!hasAnyPerm) {
      setErrorMessage(
        `Please grant at least one permission or operational scope for @${selectedCandidate.username}.`
      );
      return;
    }

    if (isStaffQuotaReached) {
      setErrorMessage(
        `Staff quota reached (${displayTeam.length}/${formatSubscriptionLimitValue(
          maxStaffMembers
        )}). Upgrade your subscription plan to add more staff.`
      );
      return;
    }

    const ok = await confirm({
      title: isDraftStagingMode
        ? `Stage @${selectedCandidate.username} for Team?`
        : `Add @${selectedCandidate.username} to Team?`,
      description: isDraftStagingMode
        ? `@${selectedCandidate.username} (${selectedCandidate.full_name}) will be staged in this draft with their custom permissions and invited automatically when you submit the listing.`
        : `Grant these individual permissions and scopes to @${selectedCandidate.username} (${selectedCandidate.full_name})${
            listingTitle ? ` on "${listingTitle}"` : ''
          }?`,
      confirmLabel: isDraftStagingMode
        ? `Stage @${selectedCandidate.username}`
        : `Add @${selectedCandidate.username} to Team`,
    });
    if (!ok) return;

    if (isDraftStagingMode) {
      const nextEntry: StagedStaffDelegation = {
        staff_id: selectedCandidate.id,
        staff_username: selectedCandidate.username.replace(/^@+/, ''),
        staff_name: selectedCandidate.full_name,
        staff_avatar_url: selectedCandidate.avatar_url || null,
        permissions: { ...candidatePermissions },
        vertical_scopes: [...candidateScopes],
      };
      const filtered = stagedStaff.filter(
        (s) => s.staff_id !== selectedCandidate.id
      );
      onChangeStagedStaff?.([...filtered, nextEntry]);
      setSuccessMessage(
        `Staged @${nextEntry.staff_username} (${nextEntry.staff_name}) — will be assigned on Submit.`
      );
      setSelectedCandidate(null);
      setSearchQuery('');
      setCandidatePermissions(getDefaultPermissionsForVertical(listingVertical));
      setCandidateScopes(getDefaultScopesForVertical(listingVertical));
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await addDelegateByUserId(
        validListingId!,
        selectedCandidate,
        candidatePermissions,
        candidateScopes
      );
      setDelegations((prev) => [
        created,
        ...prev.filter((d) => d.staff_id !== created.staff_id),
      ]);
      setSuccessMessage(
        `Added @${created.staff_username} (${created.staff_name}) to the listing team.`
      );
      setSelectedCandidate(null);
      setSearchQuery('');
      setCandidatePermissions(getDefaultPermissionsForVertical(listingVertical));
      setCandidateScopes(getDefaultScopesForVertical(listingVertical));
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not assign staff delegate.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditStaff = (del: StaffDelegationRecord) => {
    setEditingStaffId(del.staff_id);
    setEditPermissionsDraft({ ...del.permissions });
    setEditScopesDraft([...(del.vertical_scopes || ['enquiries'])]);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSaveEditedStaff = async (del: StaffDelegationRecord) => {
    const hasAnyPerm =
      Object.values(editPermissionsDraft).some(Boolean) ||
      editScopesDraft.length > 0;
    if (!hasAnyPerm) {
      setErrorMessage(
        `Please keep at least one active permission for @${del.staff_username}.`
      );
      return;
    }

    if (isDraftStagingMode) {
      const updated = stagedStaff.map((s) =>
        s.staff_id === del.staff_id
          ? {
              ...s,
              permissions: { ...editPermissionsDraft },
              vertical_scopes: [...editScopesDraft],
            }
          : s
      );
      onChangeStagedStaff?.(updated);
      setEditingStaffId(null);
      setSuccessMessage(
        `Updated individual permissions for @${del.staff_username}.`
      );
      return;
    }

    if (!validListingId) return;
    setIsSavingEdit(true);
    try {
      await updateDelegatePermissions(
        del.id,
        validListingId,
        del.staff_id,
        editPermissionsDraft,
        editScopesDraft
      );
      setDelegations((prev) =>
        prev.map((item) =>
          item.id === del.id
            ? {
                ...item,
                permissions: { ...editPermissionsDraft },
                vertical_scopes: [...editScopesDraft],
              }
            : item
        )
      );
      setEditingStaffId(null);
      setSuccessMessage(
        `Saved updated permissions for @${del.staff_username}.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to update staff permissions.'
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleRemoveDelegate = async (delegation: StaffDelegationRecord) => {
    const ok = await confirm({
      title: `Remove @${delegation.staff_username}?`,
      description: isDraftStagingMode
        ? `Remove @${delegation.staff_username} (${delegation.staff_name}) from this draft team?`
        : `Revoke all workspace access for @${delegation.staff_username} (${delegation.staff_name}) on this listing?`,
      confirmLabel: 'Remove from Team',
      variant: 'danger',
    });
    if (!ok) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    if (isDraftStagingMode) {
      onChangeStagedStaff?.(
        stagedStaff.filter((s) => s.staff_id !== delegation.staff_id)
      );
      setSuccessMessage(
        `Removed @${delegation.staff_username} from staged team.`
      );
      return;
    }

    setRemovingId(delegation.id);
    try {
      await removeDelegate(delegation.id, validListingId, delegation.staff_id);
      setDelegations((prev) => prev.filter((d) => d.id !== delegation.id));
      setSuccessMessage(
        `Removed @${delegation.staff_username} (${delegation.staff_name}) from this listing.`
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
          <div className="flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 text-[var(--ps-accent)]" />
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Staff &amp; Operator Team Delegation
            </h4>
            {isDraftStagingMode && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                <Sparkles className="h-2.5 w-2.5" />
                Draft Staging Mode — Saved on Submit
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Search registered members by <span className="font-bold">@username</span> and configure individual permissions per staff member
            {listingTitle ? ` for "${listingTitle}"` : ''}.
          </p>
        </div>

        <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text)] tabular-nums">
          <Shield className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
          <span>
            {displayTeam.length} / {formatSubscriptionLimitValue(maxStaffMembers)} Staff
          </span>
        </span>
      </div>

      {/* Feedback Banners */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="delegation-error-banner"
          className="flex items-start justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-700 dark:text-rose-300"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="shrink-0 opacity-75 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          data-testid="delegation-success-banner"
          className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="shrink-0 opacity-75 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* STEP A: Search by @username First (NO Premature Permission Wall!) */}
      <div className="space-y-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-[var(--ps-text)] flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>Add Team Member by @username</span>
          </div>
          <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
            Step 1: Select User
          </span>
        </div>

        <UserUsernameSearch
          selectedUser={selectedCandidate}
          onSelect={(user) => {
            setSelectedCandidate(user);
            if (user) {
              setCandidatePermissions(
                getDefaultPermissionsForVertical(listingVertical)
              );
              setCandidateScopes(getDefaultScopesForVertical(listingVertical));
            }
          }}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          excludeUserIds={existingStaffIds}
          disabled={isSubmitting || isStaffQuotaReached}
          placeholder="Search team member by @username or name (e.g. @test_staff)..."
          helperText="Private email addresses and phone numbers are never exposed. Permissions appear once a user is selected."
          testId="staff-delegation-username-search"
        />

        {/* STEP B: Individual Per-Staff Permission Configuration (Shown ONLY after a user is selected!) */}
        {selectedCandidate && (
          <div
            data-testid="configure-candidate-permissions-card"
            className="mt-3 space-y-3.5 rounded-xl border border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/5 p-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-2.5">
              <div>
                <h5 className="text-xs font-extrabold text-[var(--ps-text)]">
                  Configure Permissions for @{selectedCandidate.username}
                </h5>
                <p className="text-[10px] text-[var(--ps-text-muted)]">
                  Tailored for {listingVertical.replace(/_/g, ' ')} • Each staff member can have their own distinct permission set.
                </p>
              </div>
              <span className="rounded-full bg-[var(--ps-accent)]/15 px-2.5 py-0.5 text-[10px] font-bold text-[var(--ps-accent)]">
                Step 2: Set Individual Access
              </span>
            </div>

            {/* Operational Desk Scopes */}
            {relevantVerticalScopes.length > 0 && (
              <div className="space-y-1.5">
                <span className="block text-[11px] font-bold text-[var(--ps-text)]">
                  Operational Desk Scopes
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {relevantVerticalScopes.map((scope) => {
                    const checked = candidateScopes.includes(scope.key);
                    return (
                      <label
                        key={scope.key}
                        className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer transition ${
                          checked
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-[var(--ps-border)] bg-[var(--ps-surface)] hover:bg-[var(--ps-surface-alt)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCandidateScope(scope.key)}
                          disabled={isSubmitting}
                          data-testid={`candidate-scope-${scope.key}`}
                          className="mt-0.5 rounded border-[var(--ps-border)] accent-emerald-600"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-[var(--ps-text)] text-xs">
                            {scope.label}
                          </div>
                          <div className="text-[10px] text-[var(--ps-text-muted)] leading-snug">
                            {scope.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Core Listing Permissions */}
            <div className="space-y-1.5">
              <span className="block text-[11px] font-bold text-[var(--ps-text)]">
                Listing &amp; Content Permissions
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {relevantCorePermissions.map((opt) => {
                  const checked = Boolean(candidatePermissions[opt.key]);
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
                        onChange={() => toggleCandidatePermission(opt.key)}
                        disabled={isSubmitting}
                        data-testid={`delegate-perm-${String(opt.key)}`}
                        className="mt-0.5 rounded border-[var(--ps-border)] accent-[var(--ps-accent)]"
                      />
                      <div className="space-y-0.5 min-w-0">
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

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setSelectedCandidate(null);
                  setSearchQuery('');
                }}
                className="min-h-[38px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting || isStaffQuotaReached}
                onClick={() => void handleAddSelectedCandidate()}
                data-testid="add-delegate-submit-btn"
                className="min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 py-2 text-xs font-bold text-[var(--btn-primary-fg)] shadow-xs transition hover:opacity-95 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Assigning...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>
                      Add @{selectedCandidate.username} to Team
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Current Listing Team List */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[var(--ps-text)]">
            Current Listing Team ({displayTeam.length})
          </span>
        </div>

        {isLoading ? (
          <StaffDelegationSkeleton count={2} />
        ) : displayTeam.length === 0 ? (
          <div
            data-testid="delegations-empty"
            className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 text-center text-[var(--ps-text-muted)]"
          >
            No staff members assigned yet. Search by <span className="font-bold">@username</span> above to add your first team member.
          </div>
        ) : (
          <div className="space-y-2.5" data-testid="delegations-list">
            {displayTeam.map((del) => {
              const isEditingThis = editingStaffId === del.staff_id;
              const activePermissionLabels = CORE_PERMISSION_OPTIONS.filter(
                (opt) => Boolean(del.permissions?.[opt.key])
              );
              const activeScopeLabels = VERTICAL_SCOPE_OPTIONS.filter((s) =>
                (del.vertical_scopes || []).includes(s.key)
              );

              return (
                <div
                  key={del.id}
                  data-testid={`delegation-row-${del.id}`}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ps-accent)]/15 text-xs font-black uppercase text-[var(--ps-accent)] overflow-hidden">
                        {del.staff_avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={del.staff_avatar_url}
                            alt={del.staff_username}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (del.staff_name || del.staff_username || 'S').slice(0, 1)
                        )}
                      </div>

                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-extrabold text-[var(--ps-text)] text-xs">
                            @{del.staff_username}
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)]">
                            · {del.staff_name}
                          </span>
                          {del.isStagedDraft && (
                            <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                              Will be invited on Submit
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {activeScopeLabels.map((sc) => (
                            <span
                              key={sc.key}
                              className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                            >
                              {sc.label}
                            </span>
                          ))}
                          {activePermissionLabels.map((perm) => (
                            <span
                              key={String(perm.key)}
                              className="rounded-md bg-[var(--ps-accent)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--ps-accent)]"
                            >
                              {perm.shortLabel}
                            </span>
                          ))}
                          {activePermissionLabels.length === 0 &&
                            activeScopeLabels.length === 0 && (
                              <span className="text-[11px] text-[var(--ps-text-muted)]">
                                Read-only access
                              </span>
                            )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-start sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          isEditingThis
                            ? setEditingStaffId(null)
                            : handleOpenEditStaff(del)
                        }
                        data-testid={`edit-delegate-btn-${del.id}`}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>
                          {isEditingThis ? 'Close' : 'Edit Permissions'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleRemoveDelegate(del)}
                        disabled={removingId === del.id}
                        data-testid={`remove-delegate-btn-${del.id}`}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                      >
                        {removingId === del.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>

                  {/* Per-Staff Individual Permission Editor */}
                  {isEditingThis && (
                    <div
                      data-testid={`edit-permissions-panel-${del.id}`}
                      className="rounded-xl border border-[var(--ps-accent)]/40 bg-[var(--ps-bg)] p-3 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-extrabold text-[var(--ps-text)]">
                          Edit Individual Permissions for @{del.staff_username}
                        </span>
                      </div>

                      {relevantVerticalScopes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {relevantVerticalScopes.map((sc) => {
                            const checked = editScopesDraft.includes(sc.key);
                            return (
                              <label
                                key={sc.key}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                                  checked
                                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setEditScopesDraft((prev) =>
                                      prev.includes(sc.key)
                                        ? prev.filter((k) => k !== sc.key)
                                        : [...prev, sc.key]
                                    )
                                  }
                                  className="accent-emerald-600"
                                />
                                <span>{sc.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {relevantCorePermissions.map((opt) => {
                          const checked = Boolean(editPermissionsDraft[opt.key]);
                          return (
                            <label
                              key={String(opt.key)}
                              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold cursor-pointer ${
                                checked
                                  ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/15 text-[var(--ps-text)]'
                                  : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setEditPermissionsDraft((prev) => ({
                                    ...prev,
                                    [opt.key]: !prev[opt.key],
                                  }))
                                }
                                className="accent-[var(--ps-accent)]"
                              />
                              <span>{opt.label}</span>
                            </label>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingStaffId(null)}
                          className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1 text-xs font-semibold text-[var(--ps-text-muted)] cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={isSavingEdit}
                          onClick={() => void handleSaveEditedStaff(del)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[var(--btn-primary-bg)] px-3 py-1 text-xs font-bold text-[var(--btn-primary-fg)] cursor-pointer disabled:opacity-50"
                        >
                          {isSavingEdit ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          <span>Save Permissions</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmDialog}
    </section>
  );
}

export default StaffDelegationManager;

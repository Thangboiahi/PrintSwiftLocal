'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  PauseCircle,
  PlayCircle,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { StaffDelegationSkeleton } from '@/components/shared/Skeletons';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { FormModal } from '@/components/ui/FormModal';
import { PhoneInputWithCountry } from '@/components/ui/PhoneInputWithCountry';
import {
  UserUsernameSearch,
  type PublicUsernameProfile,
} from '@/components/ui/UserUsernameSearch';
import { isUuid } from '@/lib/payments/types';
import { useAuth } from '@/lib/store';
import {
  formatSubscriptionLimitValue,
  getLimit,
  hasFeature,
} from '@/lib/subscriptions/feature-catalog';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  StaffDelegationRecord,
  StaffPermissionsJson,
  addDelegateByUserId,
  fetchDelegations,
  lookupUserProfileByContact,
  removeDelegate,
  updateDelegatePermissions,
  updateDelegateStatus,
} from '@/lib/supabase/delegations';
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
  /** Optional list of owner listings so the Invite modal can target any listing directly */
  availableListings?: Array<{
    id: string;
    title: string;
    vertical: ListingVertical;
  }>;
  onChangeTargetListingId?: (listingId: string) => void;
  /** Optional jump CTA to Plans & Trials when staff seats are disabled or full */
  onUpgradePlan?: () => void;
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
  availableListings,
  onChangeTargetListingId,
  onUpgradePlan,
  stagedStaff = [],
  onChangeStagedStaff,
}: StaffDelegationManagerProps) {
  const { user: authUser } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();
  const validListingId =
    typeof listingId === 'string' && isUuid(listingId) ? listingId.trim() : null;
  const isDraftStagingMode = !validListingId;

  const { entitlements } = useEffectiveEntitlements(
    authUser?.id,
    validListingId
  );

  const [delegations, setDelegations] = useState<StaffDelegationRecord[]>([]);
  const [seatQuota, setSeatQuota] = useState<{
    used: number;
    limit: number | null;
    enabled: boolean;
  }>({ used: 0, limit: 3, enabled: true });
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(validListingId));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Invite Staff FormModal state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteTargetListingId, setInviteTargetListingId] = useState<string>(
    validListingId || ''
  );
  const [lookupMode, setLookupMode] = useState<'username' | 'phone' | 'email'>(
    'username'
  );
  const [selectedCandidate, setSelectedCandidate] =
    useState<PublicUsernameProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [contactInput, setContactInput] = useState<string>('');
  const [contactLookupError, setContactLookupError] = useState<string | null>(
    null
  );
  const [isLookingUpContact, setIsLookingUpContact] = useState(false);
  const [candidatePermissions, setCandidatePermissions] =
    useState<StaffPermissionsJson>(() =>
      getDefaultPermissionsForVertical(listingVertical)
    );
  const [candidateScopes, setCandidateScopes] = useState<string[]>(() =>
    getDefaultScopesForVertical(listingVertical)
  );
  const [inviteSubmitAttempted, setInviteSubmitAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Permissions FormModal state
  const [editingDelegate, setEditingDelegate] =
    useState<StaffDelegationRecord | null>(null);
  const [editPermissionsDraft, setEditPermissionsDraft] =
    useState<StaffPermissionsJson>({});
  const [editScopesDraft, setEditScopesDraft] = useState<string[]>([]);
  const [editSubmitAttempted, setEditSubmitAttempted] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const currentAuthUserId = authUser?.id || null;

  const loadSeatSummary = useCallback(async () => {
    if (!currentAuthUserId || !isSupabaseConfigured()) return;
    try {
      const { data, error } = await supabase.rpc(
        'get_owner_workspace_summary',
        { p_target_owner_id: currentAuthUserId }
      );
      if (!error && data && typeof data === 'object') {
        const raw = data as Record<string, unknown>;
        const quotaObj = (raw.quota_usage || {}) as Record<
          string,
          Record<string, unknown>
        >;
        const activeStaff = quotaObj.active_staff;
        if (activeStaff) {
          setSeatQuota({
            used: Number(activeStaff.used ?? 0),
            limit:
              typeof activeStaff.limit === 'number' ? activeStaff.limit : null,
            enabled: Boolean(activeStaff.enabled ?? true),
          });
          return;
        }
      }
      // Fallback to effective entitlements
      const cap = getLimit(entitlements, 'max_staff_members');
      const enabled =
        hasFeature(entitlements, 'staff_delegation') ||
        (cap !== null && cap !== 0);
      setSeatQuota((prev) => ({
        used: prev.used,
        limit: cap !== null && cap < 0 ? null : cap,
        enabled,
      }));
    } catch {
      // Safe fallback
    }
  }, [currentAuthUserId, entitlements]);

  const loadDelegations = useCallback(async () => {
    if (!validListingId) {
      setDelegations([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
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
    const timer = window.setTimeout(() => {
      void loadDelegations();
      void loadSeatSummary();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDelegations, loadSeatSummary]);

  const activeVertical: ListingVertical = useMemo(() => {
    if (inviteTargetListingId && availableListings) {
      const found = availableListings.find(
        (l) => l.id === inviteTargetListingId
      );
      if (found) return found.vertical;
    }
    return listingVertical;
  }, [inviteTargetListingId, availableListings, listingVertical]);

  const relevantCorePermissions = useMemo(
    () =>
      CORE_PERMISSION_OPTIONS.filter(
        (opt) => !opt.verticals || opt.verticals.includes(activeVertical)
      ),
    [activeVertical]
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
      if (!scope.verticals.includes(activeVertical)) return false;
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
  }, [activeVertical, entitlements]);

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
      status: 'active',
      granted_at: new Date().toISOString(),
      isStagedDraft: true,
    }));
  }, [isDraftStagingMode, delegations, stagedStaff]);

  const activeCountLocal = useMemo(
    () =>
      displayTeam.filter((d) => !d.status || d.status === 'active').length,
    [displayTeam]
  );

  const effectiveUsedSeats = Math.max(seatQuota.used, activeCountLocal);
  const isStaffingDisabled =
    !seatQuota.enabled || (seatQuota.limit !== null && seatQuota.limit === 0);
  const isStaffQuotaReached =
    isStaffingDisabled ||
    (seatQuota.limit !== null && effectiveUsedSeats >= seatQuota.limit);

  const authUserId = authUser?.id;
  const existingStaffIds = useMemo(() => {
    const ids = displayTeam.map((d) => d.staff_id);
    if (authUserId) ids.push(authUserId);
    return ids;
  }, [displayTeam, authUserId]);

  const openInviteModal = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setInviteTargetListingId(validListingId || availableListings?.[0]?.id || '');
    setLookupMode('username');
    setSelectedCandidate(null);
    setSearchQuery('');
    setContactInput('');
    setContactLookupError(null);
    setCandidatePermissions(getDefaultPermissionsForVertical(listingVertical));
    setCandidateScopes(getDefaultScopesForVertical(listingVertical));
    setInviteSubmitAttempted(false);
    setIsInviteModalOpen(true);
  };

  const handleLookupByContact = async () => {
    setContactLookupError(null);
    const trimmed = contactInput.trim();
    if (!trimmed) {
      setContactLookupError(
        lookupMode === 'phone'
          ? 'Enter a valid 10-digit +91 mobile number.'
          : 'Enter a registered email address.'
      );
      return;
    }
    if (lookupMode === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setContactLookupError('Please enter a valid email address.');
      return;
    }
    if (lookupMode === 'phone' && trimmed.replace(/\D/g, '').length < 10) {
      setContactLookupError('Please enter a complete 10-digit mobile number.');
      return;
    }

    setIsLookingUpContact(true);
    try {
      const found = await lookupUserProfileByContact(trimmed);
      if (!found) {
        setContactLookupError(
          'No registered user account found with that contact. Ask them to sign up first or search by @username.'
        );
        return;
      }
      if (existingStaffIds.includes(found.id)) {
        setContactLookupError(
          `@${found.username} is already on this listing or is the listing owner.`
        );
        return;
      }
      setSelectedCandidate(found);
      setContactLookupError(null);
    } catch (err) {
      setContactLookupError(
        err instanceof Error ? err.message : 'Unable to look up account.'
      );
    } finally {
      setIsLookingUpContact(false);
    }
  };

  const inviteValidationErrors = useMemo(() => {
    const errs: string[] = [];
    if (!isDraftStagingMode && !isUuid(inviteTargetListingId)) {
      errs.push('Select a valid target listing.');
    }
    if (!selectedCandidate) {
      errs.push('Search and select a registered team member first.');
    }
    const hasAnyPerm =
      Object.values(candidatePermissions).some(Boolean) ||
      candidateScopes.length > 0;
    if (!hasAnyPerm) {
      errs.push('Select at least one permission or operational desk scope.');
    }
    if (isStaffQuotaReached) {
      errs.push(
        isStaffingDisabled
          ? 'Delegated staff seats are disabled on your current plan.'
          : `Active staff seat quota reached (${effectiveUsedSeats}/${seatQuota.limit}).`
      );
    }
    return errs;
  }, [
    isDraftStagingMode,
    inviteTargetListingId,
    selectedCandidate,
    candidatePermissions,
    candidateScopes,
    isStaffQuotaReached,
    isStaffingDisabled,
    effectiveUsedSeats,
    seatQuota.limit,
  ]);

  const handleInviteSubmit = async () => {
    if (!selectedCandidate || inviteValidationErrors.length > 0) return;

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
      setIsInviteModalOpen(false);
      return;
    }

    const targetId = inviteTargetListingId || validListingId!;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const created = await addDelegateByUserId(
        targetId,
        selectedCandidate,
        candidatePermissions,
        candidateScopes
      );
      if (targetId === validListingId) {
        setDelegations((prev) => [
          created,
          ...prev.filter((d) => d.staff_id !== created.staff_id),
        ]);
      } else {
        onChangeTargetListingId?.(targetId);
      }
      setSuccessMessage(
        `Delegated @${created.staff_username} (${created.staff_name}) successfully.`
      );
      setIsInviteModalOpen(false);
      void loadSeatSummary();
    } catch (err) {
      // Gracefully surface server-side v18a max_staff trigger errors
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not assign staff delegate.'
      );
      setIsInviteModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditPermissionsModal = (del: StaffDelegationRecord) => {
    setEditingDelegate(del);
    setEditPermissionsDraft({ ...del.permissions });
    setEditScopesDraft([...(del.vertical_scopes || ['enquiries'])]);
    setEditSubmitAttempted(false);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const editValidationError = useMemo(() => {
    const hasAnyPerm =
      Object.values(editPermissionsDraft).some(Boolean) ||
      editScopesDraft.length > 0;
    return hasAnyPerm
      ? null
      : 'Keep at least one active permission or desk scope.';
  }, [editPermissionsDraft, editScopesDraft]);

  const handleSaveEditedStaff = async () => {
    if (!editingDelegate || editValidationError) return;

    if (isDraftStagingMode) {
      const updated = stagedStaff.map((s) =>
        s.staff_id === editingDelegate.staff_id
          ? {
              ...s,
              permissions: { ...editPermissionsDraft },
              vertical_scopes: [...editScopesDraft],
            }
          : s
      );
      onChangeStagedStaff?.(updated);
      setEditingDelegate(null);
      setSuccessMessage(
        `Updated permissions for @${editingDelegate.staff_username}.`
      );
      return;
    }

    if (!validListingId) return;
    setIsSavingEdit(true);
    try {
      await updateDelegatePermissions(
        editingDelegate.id,
        validListingId,
        editingDelegate.staff_id,
        editPermissionsDraft,
        editScopesDraft
      );
      setDelegations((prev) =>
        prev.map((item) =>
          item.id === editingDelegate.id
            ? {
                ...item,
                permissions: { ...editPermissionsDraft },
                vertical_scopes: [...editScopesDraft],
              }
            : item
        )
      );
      setEditingDelegate(null);
      setSuccessMessage(
        `Saved updated permissions for @${editingDelegate.staff_username}.`
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to update staff permissions.'
      );
      setEditingDelegate(null);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleToggleSuspendStaff = async (del: StaffDelegationRecord) => {
    if (isDraftStagingMode) return;
    const isCurrentlyActive = !del.status || del.status === 'active';
    const nextStatus: 'suspended' | 'active' = isCurrentlyActive
      ? 'suspended'
      : 'active';

    const ok = await confirm({
      title: isCurrentlyActive
        ? `Suspend @${del.staff_username}?`
        : `Reactivate @${del.staff_username}?`,
      description: isCurrentlyActive
        ? `Temporarily pause workspace access for @${del.staff_username} (${del.staff_name}) on this listing.`
        : `Restore active delegated staff access for @${del.staff_username} (${del.staff_name})? This counts toward your plan's active staff seat quota.`,
      caution: isCurrentlyActive
        ? 'Database RLS immediately cuts off all operational access for suspended staff until reactivated.'
        : 'Server-side quota validation will verify your active staff seat limit before reactivating.',
      confirmLabel: isCurrentlyActive ? 'Suspend Staff' : 'Reactivate Staff',
      variant: 'warning',
    });
    if (!ok) return;

    setBusyRowId(del.id);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await updateDelegateStatus(del.id, nextStatus);
      setDelegations((prev) =>
        prev.map((item) =>
          item.id === del.id ? { ...item, status: nextStatus } : item
        )
      );
      setSuccessMessage(
        isCurrentlyActive
          ? `Suspended @${del.staff_username} — RLS access revoked immediately.`
          : `Reactivated @${del.staff_username}.`
      );
      void loadSeatSummary();
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to update staff status.'
      );
    } finally {
      setBusyRowId(null);
    }
  };

  const handleRevokeDelegate = async (delegation: StaffDelegationRecord) => {
    const ok = await confirm({
      title: `Revoke & Remove @${delegation.staff_username}?`,
      description: isDraftStagingMode
        ? `Remove @${delegation.staff_username} (${delegation.staff_name}) from this draft team?`
        : `Permanently revoke all delegated workspace access for @${delegation.staff_username} (${delegation.staff_name})?`,
      caution:
        'Database RLS revokes access immediately. The staff member will no longer see your listings, orders, enquiries, or stock.',
      impactSummary: [
        `Revoked delegate: @${delegation.staff_username}`,
        listingTitle ? `Listing: ${listingTitle}` : 'Active listing delegation',
      ],
      confirmLabel: 'Revoke Access',
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

    setBusyRowId(delegation.id);
    try {
      await removeDelegate(delegation.id, validListingId, delegation.staff_id);
      setDelegations((prev) => prev.filter((d) => d.id !== delegation.id));
      setSuccessMessage(
        `Revoked access for @${delegation.staff_username} (${delegation.staff_name}).`
      );
      void loadSeatSummary();
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to revoke staff delegation.'
      );
    } finally {
      setBusyRowId(null);
    }
  };

  const seatPct =
    seatQuota.limit && seatQuota.limit > 0
      ? Math.min(100, Math.round((effectiveUsedSeats / seatQuota.limit) * 100))
      : 0;

  return (
    <section
      data-testid="staff-delegation-manager"
      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4 text-xs shadow-xs"
    >
      {/* Header + Live Staff Seat Meter */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 text-[var(--ps-accent)]" />
            <h4 className="text-sm font-bold text-[var(--ps-text)]">
              Team &amp; Staff Delegation
            </h4>
            {isDraftStagingMode && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                <Sparkles className="h-2.5 w-2.5" />
                Draft Staging Mode
              </span>
            )}
          </div>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Delegate operational scopes to trusted team members
            {listingTitle ? ` for "${listingTitle}"` : ''}. Staff inherit your active subscription capabilities and cannot access billing or delete listings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isStaffQuotaReached}
            onClick={openInviteModal}
            data-testid="open-invite-staff-modal-btn"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <UserPlus className="h-4 w-4" />
            <span>Invite / Delegate Staff</span>
          </button>
        </div>
      </div>

      {/* Live Staff Seat Meter */}
      <div
        data-testid="staff-seat-meter"
        className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]">
            <Shield className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
            <span>
              Active Staff Seats:{' '}
              <span className="font-mono">
                {effectiveUsedSeats} /{' '}
                {seatQuota.limit === null
                  ? 'Unlimited'
                  : formatSubscriptionLimitValue(seatQuota.limit)}
              </span>
            </span>
          </span>
          {isStaffQuotaReached && onUpgradePlan && (
            <button
              type="button"
              onClick={onUpgradePlan}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-[var(--ps-accent)] px-3 text-[11px] font-bold text-[var(--ps-accent-fg)] cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Upgrade Plan for More Seats</span>
            </button>
          )}
        </div>

        {seatQuota.limit !== null && seatQuota.limit > 0 && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ps-surface-alt)]">
            <div
              className={`h-full rounded-full transition-all ${
                seatPct >= 100
                  ? 'bg-rose-500'
                  : seatPct >= 80
                    ? 'bg-amber-500'
                    : 'bg-[var(--ps-accent)]'
              }`}
              style={{ width: `${seatPct}%` }}
            />
          </div>
        )}

        {isStaffingDisabled ? (
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            Delegated staff seats are not enabled on your current plan. Upgrade your plan to invite team members.
          </p>
        ) : isStaffQuotaReached ? (
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            All active staff seats on your plan are in use. Suspend/revoke an inactive seat or upgrade your subscription to add more staff.
          </p>
        ) : null}
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
            className="shrink-0 opacity-75 hover:opacity-100 cursor-pointer"
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
            className="shrink-0 opacity-75 hover:opacity-100 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Team List */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-bold text-[var(--ps-text)]">
            Delegated Team Members ({displayTeam.length})
          </span>
        </div>

        {isLoading ? (
          <StaffDelegationSkeleton count={2} />
        ) : displayTeam.length === 0 ? (
          <div
            data-testid="delegations-empty"
            className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-[var(--ps-text-muted)]"
          >
            No staff members assigned to this listing yet. Click{' '}
            <strong className="text-[var(--ps-text)]">
              Invite / Delegate Staff
            </strong>{' '}
            to add a team member.
          </div>
        ) : (
          <div className="space-y-2.5" data-testid="delegations-list">
            {displayTeam.map((del) => {
              const isSuspended =
                del.status && del.status !== 'active';
              const isBusy = busyRowId === del.id;
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
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ps-accent)]/15 text-xs font-black uppercase text-[var(--ps-accent)] overflow-hidden">
                        {del.staff_avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={del.staff_avatar_url}
                            alt={del.staff_username}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          (del.staff_name || del.staff_username || 'S').slice(
                            0,
                            1
                          )
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
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                              isSuspended
                                ? 'border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                                : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {isSuspended ? del.status : 'Active'}
                          </span>
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
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openEditPermissionsModal(del)}
                        data-testid={`edit-delegate-btn-${del.id}`}
                        className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Permissions</span>
                      </button>

                      {!isDraftStagingMode && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleToggleSuspendStaff(del)}
                          className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 cursor-pointer"
                        >
                          {isSuspended ? (
                            <>
                              <PlayCircle className="h-3.5 w-3.5" />
                              <span>Reactivate</span>
                            </>
                          ) : (
                            <>
                              <PauseCircle className="h-3.5 w-3.5" />
                              <span>Suspend</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRevokeDelegate(del)}
                        data-testid={`remove-delegate-btn-${del.id}`}
                        className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Revoke</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Invite / Delegate Staff FormModal */}
      <FormModal
        isOpen={isInviteModalOpen}
        title="Invite / Delegate Staff Member"
        subtitle="Assign a registered team member to operate your listing with tailored permissions."
        hints={[
          'Search by @username, +91 phone number, or registered email.',
          'Each staff member can have distinct scopes across enquiries, catalogue, bookings, or print queue.',
        ]}
        cautions={[
          'Delegated staff gain immediate operational access upon confirmation, but are strictly blocked by RLS from deleting listings or changing billing plans.',
        ]}
        isDirty={Boolean(selectedCandidate) || Boolean(contactInput.trim())}
        isValid={inviteValidationErrors.length === 0}
        validationSummary={inviteSubmitAttempted ? inviteValidationErrors : []}
        onSubmitAttempt={() => setInviteSubmitAttempted(true)}
        submitLabel={
          selectedCandidate
            ? `Delegate @${selectedCandidate.username}`
            : 'Assign Staff Member'
        }
        confirmSubmitTitle={
          selectedCandidate
            ? `Grant Delegated Staff Access to @${selectedCandidate.username}?`
            : 'Confirm Staff Delegation'
        }
        confirmSubmitDescription="Confirm the target listing and operational scopes for this team member."
        confirmSubmitCaution="Server-side plan quota enforcement will verify your active staff seat limit."
        confirmSubmitImpact={
          selectedCandidate
            ? [
                `Member: @${selectedCandidate.username} (${selectedCandidate.full_name})`,
                `Scopes: ${candidateScopes.join(', ') || 'Standard'}`,
              ]
            : undefined
        }
        confirmSubmitVariant="warning"
        isSubmitting={isSubmitting}
        onSubmit={handleInviteSubmit}
        onClose={() => setIsInviteModalOpen(false)}
      >
        <div className="space-y-4">
          {availableListings && availableListings.length > 1 && (
            <div>
              <CustomSelectModal
                label="Target Business Listing *"
                value={inviteTargetListingId}
                onChange={(val) => {
                  setInviteTargetListingId(val);
                  const found = availableListings.find((l) => l.id === val);
                  if (found) {
                    setCandidatePermissions(
                      getDefaultPermissionsForVertical(found.vertical)
                    );
                    setCandidateScopes(
                      getDefaultScopesForVertical(found.vertical)
                    );
                  }
                }}
                options={availableListings.map((l) => ({
                  value: l.id,
                  label: l.title,
                  description: l.vertical.replace(/_/g, ' '),
                }))}
              />
            </div>
          )}

          {/* Account Lookup Mode Switcher */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'username', label: 'Search @username' },
                  { id: 'phone', label: 'Lookup by +91 Phone' },
                  { id: 'email', label: 'Lookup by Email' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setLookupMode(tab.id);
                    setContactLookupError(null);
                  }}
                  className={`min-h-[38px] rounded-xl border px-3 text-xs font-semibold cursor-pointer ${
                    lookupMode === tab.id
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {lookupMode === 'username' ? (
              <UserUsernameSearch
                selectedUser={selectedCandidate}
                onSelect={setSelectedCandidate}
                query={searchQuery}
                onQueryChange={setSearchQuery}
                excludeUserIds={existingStaffIds}
                disabled={isSubmitting || isStaffQuotaReached}
                placeholder="Search team member by @username or name..."
                helperText="Select a verified account to configure their permissions below."
                testId="staff-delegation-username-search"
              />
            ) : (
              <div className="space-y-2">
                {lookupMode === 'phone' ? (
                  <PhoneInputWithCountry
                    label="Staff Member Mobile Number (+91)"
                    value={contactInput}
                    onChange={(val) => {
                      setContactInput(val);
                      setContactLookupError(null);
                    }}
                  />
                ) : (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[var(--ps-text)]">
                      Staff Member Registered Email
                    </label>
                    <input
                      type="email"
                      value={contactInput}
                      onChange={(e) => {
                        setContactInput(e.target.value);
                        setContactLookupError(null);
                      }}
                      placeholder="staff@example.com"
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isLookingUpContact}
                    onClick={() => void handleLookupByContact()}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 px-3.5 text-xs font-bold text-[var(--ps-accent)] cursor-pointer disabled:opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>
                      {isLookingUpContact ? 'Looking up…' : 'Find Account'}
                    </span>
                  </button>
                  {selectedCandidate && (
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>
                        Selected: @{selectedCandidate.username} (
                        {selectedCandidate.full_name})
                      </span>
                    </span>
                  )}
                </div>

                {contactLookupError && (
                  <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    {contactLookupError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Permissions & Desk Scopes */}
          <div className="space-y-3 border-t border-[var(--ps-border)] pt-3">
            {relevantVerticalScopes.length > 0 && (
              <div className="space-y-1.5">
                <span className="block text-xs font-bold text-[var(--ps-text)]">
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
                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCandidateScopes((prev) =>
                              prev.includes(scope.key)
                                ? prev.filter((k) => k !== scope.key)
                                : [...prev, scope.key]
                            )
                          }
                          className="mt-0.5 rounded accent-emerald-600"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-[var(--ps-text)] text-xs">
                            {scope.label}
                          </div>
                          <div className="text-[10px] text-[var(--ps-text-muted)]">
                            {scope.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <span className="block text-xs font-bold text-[var(--ps-text)]">
                Listing &amp; Content Permissions
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {relevantCorePermissions.map((opt) => {
                  const checked = Boolean(candidatePermissions[opt.key]);
                  return (
                    <label
                      key={String(opt.key)}
                      className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer transition ${
                        checked
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setCandidatePermissions((prev) => ({
                            ...prev,
                            [opt.key]: !prev[opt.key],
                          }))
                        }
                        className="mt-0.5 rounded accent-[var(--ps-accent)]"
                      />
                      <div className="min-w-0">
                        <div className="font-bold text-[var(--ps-text)] text-xs">
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)]">
                          {opt.description}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </FormModal>

      {/* Edit Staff Permissions FormModal */}
      <FormModal
        isOpen={Boolean(editingDelegate)}
        title={
          editingDelegate
            ? `Edit Permissions — @${editingDelegate.staff_username}`
            : 'Edit Permissions'
        }
        subtitle={editingDelegate ? editingDelegate.staff_name : undefined}
        isDirty={Boolean(editingDelegate)}
        isValid={!editValidationError}
        validationSummary={
          editSubmitAttempted && editValidationError
            ? [editValidationError]
            : []
        }
        onSubmitAttempt={() => setEditSubmitAttempted(true)}
        submitLabel="Save Permissions"
        confirmSubmitTitle={
          editingDelegate
            ? `Update Permissions for @${editingDelegate.staff_username}?`
            : 'Update Staff Permissions?'
        }
        confirmSubmitDescription="Updated scopes take effect immediately on the staff member's next workspace action."
        confirmSubmitVariant="warning"
        isSubmitting={isSavingEdit}
        onSubmit={handleSaveEditedStaff}
        onClose={() => setEditingDelegate(null)}
      >
        <div className="space-y-4">
          {relevantVerticalScopes.length > 0 && (
            <div className="space-y-1.5">
              <span className="block text-xs font-bold text-[var(--ps-text)]">
                Operational Desk Scopes
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {relevantVerticalScopes.map((sc) => {
                  const checked = editScopesDraft.includes(sc.key);
                  return (
                    <label
                      key={sc.key}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold cursor-pointer ${
                        checked
                          ? 'border-emerald-500/50 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
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
            </div>
          )}

          <div className="space-y-1.5">
            <span className="block text-xs font-bold text-[var(--ps-text)]">
              Listing &amp; Content Permissions
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {relevantCorePermissions.map((opt) => {
                const checked = Boolean(editPermissionsDraft[opt.key]);
                return (
                  <label
                    key={String(opt.key)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold cursor-pointer ${
                      checked
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-text)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
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
          </div>
        </div>
      </FormModal>

      {confirmDialog}
    </section>
  );
}

export default StaffDelegationManager;

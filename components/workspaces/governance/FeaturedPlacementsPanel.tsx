'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Calendar,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import {
  DragHandleButton,
  MobileOrderButtons,
  SortablePreviewItem,
  useTouchSafeSensors,
} from '@/components/ui/SortablePreview';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { buildWhatsAppUrl } from '@/lib/utils/whatsapp';

interface FeaturedSlotRow {
  id: string;
  hub_id: string;
  slot_section: string;
  entity_type: string;
  entity_id: string;
  priority: number;
  badge_label: string;
  starts_at: string;
  expires_at: string | null;
  is_active: boolean;
  entityTitle?: string;
}

interface FeaturedRequestRow {
  id: string;
  request_code: string;
  hub_id: string;
  requester_id: string;
  slot_section: string;
  entity_type: string;
  entity_id: string;
  duration_days: number;
  quoted_fee_inr: number;
  preferred_contact: 'whatsapp' | 'phone';
  contact_phone: string;
  notes: string | null;
  status: string;
  created_at: string;
  entityTitle?: string;
}

interface SearchableEntityOption {
  id: string;
  title: string;
  entityType: 'listing' | 'product' | 'vehicle';
  hubId: string;
  subtitle: string;
}

export interface FeaturedPlacementsPanelProps {
  scopeHubId?: string | null;
  scopeHubName?: string;
  onNotice?: (n: { type: 'success' | 'error'; text: string }) => void;
}

const SECTION_OPTIONS: CustomSelectOption[] = [
  { value: 'featured_places', label: 'Featured Places' },
  { value: 'featured_products', label: 'Featured Products' },
  { value: 'featured_properties', label: 'Featured Properties' },
  { value: 'featured_vehicles', label: 'Featured Vehicles' },
];

function formatSectionLabel(section: string): string {
  const match = SECTION_OPTIONS.find((o) => o.value === section);
  return match ? match.label : section.replace(/_/g, ' ');
}

function normalizeSectionPriorities(rows: FeaturedSlotRow[]): FeaturedSlotRow[] {
  const grouped = new Map<string, FeaturedSlotRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.slot_section) || [];
    list.push(row);
    grouped.set(row.slot_section, list);
  }
  const normalized: FeaturedSlotRow[] = [];
  for (const list of grouped.values()) {
    const sorted = [...list].sort((a, b) => a.priority - b.priority);
    sorted.forEach((item, idx) => {
      normalized.push({
        ...item,
        priority: (idx + 1) * 10,
      });
    });
  }
  return normalized;
}

export function FeaturedPlacementsPanel({
  scopeHubId = null,
  scopeHubName = 'All Hubs',
  onNotice,
}: FeaturedPlacementsPanelProps) {
  const { user } = useAuth();
  const { setStatus } = useAppStatus();
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();
  const sensors = useTouchSafeSensors();

  const [subTab, setSubTab] = useState<'slots' | 'requests'>('slots');
  const [activeSectionFilter, setActiveSectionFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<FeaturedSlotRow[]>([]);
  const [draftSlots, setDraftSlots] = useState<FeaturedSlotRow[]>([]);
  const [requests, setRequests] = useState<FeaturedRequestRow[]>([]);
  const [searchableEntities, setSearchableEntities] = useState<
    SearchableEntityOption[]
  >([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Quick Add Slot form state (sequence is managed via Drag & Drop, never hardcoded priority numbers)
  const [selectedEntityKey, setSelectedEntityKey] = useState('');
  const [slotSection, setSlotSection] = useState('featured_places');
  const [badgeLabel, setBadgeLabel] = useState('Featured');
  const [expiryDays, setExpiryDays] = useState('15');
  const [addTouched, setAddTouched] = useState<Record<string, boolean>>({});
  const [addSubmitted, setAddSubmitted] = useState(false);
  const [isSavingSlot, setIsSavingSlot] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);

  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let slotsQ = supabase
        .from('featured_slots')
        .select('*')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });
      let reqQ = supabase
        .from('featured_requests')
        .select('*')
        .order('created_at', { ascending: false });
      let listingsQ = supabase
        .from('listings')
        .select('id, title, locality, listing_vertical, hub_id')
        .eq('lifecycle_status', 'active')
        .limit(80);
      let productsQ = supabase
        .from('marketplace_products')
        .select('id, title, hub_id, price')
        .limit(50);
      let vehiclesQ = supabase
        .from('vehicle_listings')
        .select('id, title, hub_id, stand_locality')
        .eq('is_active', true)
        .limit(40);

      if (scopeHubId) {
        slotsQ = slotsQ.eq('hub_id', scopeHubId);
        reqQ = reqQ.eq('hub_id', scopeHubId);
        listingsQ = listingsQ.eq('hub_id', scopeHubId);
        productsQ = productsQ.eq('hub_id', scopeHubId);
        vehiclesQ = vehiclesQ.eq('hub_id', scopeHubId);
      }

      const [slotsRes, reqRes, listingsRes, productsRes, vehiclesRes] =
        await Promise.all([slotsQ, reqQ, listingsQ, productsQ, vehiclesQ]);

      const titleMap = new Map<string, string>();
      const entityPool: SearchableEntityOption[] = [];

      for (const l of (listingsRes.data || []) as Array<Record<string, unknown>>) {
        const id = String(l.id || '');
        const cleanTitle = String(l.title || 'Listing').replace(
          /^\[SAMPLE\]\s*/i,
          ''
        );
        titleMap.set(id, cleanTitle);
        entityPool.push({
          id,
          title: cleanTitle,
          entityType: 'listing',
          hubId: String(l.hub_id || scopeHubId || ''),
          subtitle: `${String(l.listing_vertical || 'general').replace(/_/g, ' ')} · ${String(l.locality || '')}`,
        });
      }
      for (const p of (productsRes.data || []) as Array<Record<string, unknown>>) {
        const id = String(p.id || '');
        const cleanTitle = String(p.title || 'Product').replace(
          /^\[SAMPLE\]\s*/i,
          ''
        );
        titleMap.set(id, cleanTitle);
        entityPool.push({
          id,
          title: cleanTitle,
          entityType: 'product',
          hubId: String(p.hub_id || scopeHubId || ''),
          subtitle: `Product · ₹${Number(p.price || 0).toLocaleString('en-IN')}`,
        });
      }
      for (const v of (vehiclesRes.data || []) as Array<Record<string, unknown>>) {
        const id = String(v.id || '');
        const cleanTitle = String(v.title || 'Vehicle').replace(
          /^\[SAMPLE\]\s*/i,
          ''
        );
        titleMap.set(id, cleanTitle);
        entityPool.push({
          id,
          title: cleanTitle,
          entityType: 'vehicle',
          hubId: String(v.hub_id || scopeHubId || ''),
          subtitle: `Vehicle · ${String(v.stand_locality || '')}`,
        });
      }

      const mappedSlots = ((slotsRes.data || []) as FeaturedSlotRow[]).map(
        (s) => ({
          ...s,
          entityTitle: titleMap.get(s.entity_id) || s.entity_id.slice(0, 8),
        })
      );

      setSearchableEntities(entityPool);
      setSlots(mappedSlots);
      setDraftSlots(mappedSlots);
      setRequests(
        ((reqRes.data || []) as FeaturedRequestRow[]).map((r) => ({
          ...r,
          entityTitle: titleMap.get(r.entity_id) || r.entity_id.slice(0, 8),
        }))
      );
    } finally {
      setLoading(false);
    }
  }, [scopeHubId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void loadData();
      }
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  const entitySelectOptions: CustomSelectOption[] = useMemo(
    () =>
      searchableEntities.map((e) => ({
        value: `${e.entityType}:${e.id}`,
        label: e.title,
        description: e.subtitle,
      })),
    [searchableEntities]
  );

  // Field-level & submit-time validation for Quick Add
  const addValidationErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!selectedEntityKey) {
      errs.entity = 'Select an active listing, product, or vehicle.';
    }
    const trimmedBadge = badgeLabel.trim();
    if (trimmedBadge.length > 28) {
      errs.badge = 'Badge label must be 28 characters or fewer.';
    }
    if (expiryDays.trim() !== '') {
      const daysNum = Number(expiryDays);
      if (!Number.isInteger(daysNum) || daysNum < 0 || daysNum > 365) {
        errs.expiryDays = 'Duration must be a whole number between 0 and 365.';
      }
    }
    return errs;
  }, [badgeLabel, expiryDays, selectedEntityKey]);

  const pendingOrderChanges = useMemo(() => {
    const dbById = new Map(slots.map((s) => [s.id, s]));
    return draftSlots.filter((draft) => {
      const orig = dbById.get(draft.id);
      return orig && orig.priority !== draft.priority;
    });
  }, [draftSlots, slots]);

  const reorderSection = useCallback(
    (sectionKey: string, orderedIds: string[]) => {
      const rankMap = new Map(orderedIds.map((id, idx) => [id, (idx + 1) * 10]));
      setDraftSlots((prev) =>
        prev.map((row) =>
          row.slot_section === sectionKey && rankMap.has(row.id)
            ? { ...row, priority: rankMap.get(row.id)! }
            : row
        )
      );
    },
    []
  );

  const handleSectionDragEnd = useCallback(
    (sectionKey: string, sectionRows: FeaturedSlotRow[], event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = sectionRows.findIndex((r) => r.id === String(active.id));
      const newIndex = sectionRows.findIndex((r) => r.id === String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(sectionRows, oldIndex, newIndex);
      reorderSection(
        sectionKey,
        reordered.map((r) => r.id)
      );
    },
    [reorderSection]
  );

  const handleMoveCard = useCallback(
    (sectionKey: string, sectionRows: FeaturedSlotRow[], index: number, delta: -1 | 1) => {
      const targetIndex = index + delta;
      if (targetIndex < 0 || targetIndex >= sectionRows.length) return;
      const reordered = arrayMove(sectionRows, index, targetIndex);
      reorderSection(
        sectionKey,
        reordered.map((r) => r.id)
      );
    },
    [reorderSection]
  );

  const handleSaveOrder = async () => {
    if (pendingOrderChanges.length === 0) return;

    const impactedSections = Array.from(
      new Set(
        pendingOrderChanges.map((row) => formatSectionLabel(row.slot_section))
      )
    );

    const ok = await confirm({
      title: 'Save Featured Display Sequence?',
      description:
        'This updates the live display order of featured spotlight cards on the hub homepage.',
      impactSummary: [
        `${pendingOrderChanges.length} featured slot${pendingOrderChanges.length === 1 ? '' : 's'} reordered`,
        `Sections: ${impactedSections.join(', ')}`,
      ],
      confirmLabel: 'Save Sequence',
      variant: 'info',
    });
    if (!ok) return;

    setIsSavingOrder(true);
    setStatus('saving', 'Saving featured display sequence…');
    try {
      const normalizedAll = normalizeSectionPriorities(draftSlots);
      const changedRows = normalizedAll.filter((row) => {
        const orig = slots.find((s) => s.id === row.id);
        return orig && orig.priority !== row.priority;
      });

      const results = await Promise.all(
        changedRows.map((row) =>
          supabase
            .from('featured_slots')
            .update({ priority: row.priority })
            .eq('id', row.id)
        )
      );
      const firstError = results.find((r) => r.error)?.error;
      if (firstError) throw new Error(firstError.message);

      setStatus('success', 'Featured display sequence saved.');
      onNotice?.({
        type: 'success',
        text: `Updated display sequence for ${changedRows.length} featured slot${changedRows.length === 1 ? '' : 's'}.`,
      });
      await loadData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save featured sequence.';
      setStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsSavingOrder(false);
    }
  };

  const handleAddSlot = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setAddSubmitted(true);
    if (Object.keys(addValidationErrors).length > 0) {
      return;
    }

    const picked = searchableEntities.find(
      (item) => `${item.entityType}:${item.id}` === selectedEntityKey
    );
    if (!picked) {
      onNotice?.({ type: 'error', text: 'Select an entity to feature first.' });
      return;
    }
    const targetHubId = scopeHubId || picked.hubId;
    if (!targetHubId) {
      onNotice?.({ type: 'error', text: 'Target hub is required.' });
      return;
    }

    const existingSectionRows = draftSlots.filter(
      (s) => s.slot_section === slotSection
    );
    const nextPriority =
      existingSectionRows.length > 0
        ? Math.max(...existingSectionRows.map((s) => s.priority)) + 10
        : 10;

    const ok = await confirm({
      title: `Feature "${picked.title}" on Homepage?`,
      description: `Publishes "${picked.title}" into ${formatSectionLabel(slotSection)}. You can drag cards below to adjust display position anytime.`,
      impactSummary: [
        `Entity: ${picked.title} (${picked.entityType})`,
        `Section: ${formatSectionLabel(slotSection)}`,
        `Duration: ${expiryDays && Number(expiryDays) > 0 ? `${expiryDays} days` : 'Permanent until removed'}`,
      ],
      confirmLabel: 'Publish Featured Slot',
      variant: 'info',
    });
    if (!ok) return;

    setIsSavingSlot(true);
    setStatus('saving', 'Publishing featured slot…');
    try {
      const daysNum = Number.parseInt(expiryDays, 10);
      const expiresAt =
        Number.isFinite(daysNum) && daysNum > 0
          ? new Date(Date.now() + daysNum * 86400000).toISOString()
          : null;

      const { error } = await supabase.from('featured_slots').upsert(
        {
          hub_id: targetHubId,
          slot_section: slotSection,
          entity_type: picked.entityType,
          entity_id: picked.id,
          priority: nextPriority,
          badge_label: badgeLabel.trim() || 'Featured',
          starts_at: new Date().toISOString(),
          expires_at: expiresAt,
          is_active: true,
          set_by: user?.id || null,
        },
        { onConflict: 'hub_id,slot_section,entity_type,entity_id' }
      );
      if (error) throw new Error(error.message);
      setStatus('success', `Featured "${picked.title}" on homepage.`);
      onNotice?.({
        type: 'success',
        text: `Featured "${picked.title}" in ${formatSectionLabel(slotSection)}.`,
      });
      setSelectedEntityKey('');
      setAddTouched({});
      setAddSubmitted(false);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save slot.';
      setStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    } finally {
      setIsSavingSlot(false);
    }
  };

  const handleRemoveSlot = async (slot: FeaturedSlotRow) => {
    const ok = await confirm({
      title: `Remove "${slot.entityTitle}" from Homepage Featured?`,
      description:
        'This immediately removes the featured spotlight from the hub homepage.',
      confirmLabel: 'Remove Slot',
      variant: 'danger',
    });
    if (!ok) return;
    setStatus('saving', 'Removing featured slot…');
    const { error } = await supabase
      .from('featured_slots')
      .delete()
      .eq('id', slot.id);
    if (error) {
      setStatus('error', error.message);
      onNotice?.({ type: 'error', text: error.message });
      return;
    }
    setStatus('success', 'Featured slot removed.');
    await loadData();
  };

  const handleApproveRequest = async (reqRow: FeaturedRequestRow) => {
    const ok = await confirm({
      title: `Approve & Feature "${reqRow.entityTitle}"?`,
      description: `Publishes immediately to ${formatSectionLabel(reqRow.slot_section)} for ${reqRow.duration_days} days and notifies the merchant.`,
      impactSummary: [
        `Request: ${reqRow.request_code}`,
        `Duration: ${reqRow.duration_days} days`,
      ],
      confirmLabel: 'Approve & Feature Now',
      variant: 'info',
    });
    if (!ok) return;
    setStatus('saving', 'Approving featured request…');
    try {
      const expiryDate = new Date();
      expiryDate.setDate(
        expiryDate.getDate() + Math.max(1, reqRow.duration_days)
      );
      const expiresAt = expiryDate.toISOString();

      const existingSectionRows = draftSlots.filter(
        (s) => s.slot_section === reqRow.slot_section
      );
      const nextPriority =
        existingSectionRows.length > 0
          ? Math.max(...existingSectionRows.map((s) => s.priority)) + 10
          : 10;

      const { error: slotErr } = await supabase.from('featured_slots').upsert(
        {
          hub_id: reqRow.hub_id,
          slot_section: reqRow.slot_section,
          entity_type: reqRow.entity_type,
          entity_id: reqRow.entity_id,
          priority: nextPriority,
          badge_label: 'Featured',
          starts_at: new Date().toISOString(),
          expires_at: expiresAt,
          is_active: true,
          set_by: user?.id || null,
        },
        { onConflict: 'hub_id,slot_section,entity_type,entity_id' }
      );
      if (slotErr) throw new Error(slotErr.message);

      await supabase
        .from('featured_requests')
        .update({
          status: 'approved',
          reviewer_id: user?.id || null,
          reviewer_notes: `Approved & featured for ${reqRow.duration_days} days.`,
        })
        .eq('id', reqRow.id);

      await supabase.from('notifications').insert({
        user_id: reqRow.requester_id,
        title: 'Homepage Featured Placement Live!',
        message: `Your featured request (${reqRow.request_code}) for "${reqRow.entityTitle}" is now live for ${reqRow.duration_days} days.`,
        type: 'featured_approved',
        action_url: '/',
        is_read: false,
      });

      setStatus('success', `${reqRow.request_code} approved & live!`);
      onNotice?.({
        type: 'success',
        text: `${reqRow.request_code} approved & featured on homepage.`,
      });
      await loadData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to approve request.';
      setStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    }
  };

  const handleRejectDeleteRequest = async (reqRow: FeaturedRequestRow) => {
    const ok = await confirm({
      title: `Reject & Delete Request ${reqRow.request_code}?`,
      description:
        'The merchant will be notified and this rejected featured request will be permanently deleted.',
      confirmLabel: 'Reject & Delete',
      variant: 'danger',
    });
    if (!ok) return;
    setStatus('saving', 'Rejecting & deleting request…');
    try {
      await supabase.from('notifications').insert({
        user_id: reqRow.requester_id,
        title: 'Featured Placement Request Not Approved',
        message: `Your featured request (${reqRow.request_code}) for "${reqRow.entityTitle}" was not approved at this time. Contact your local Hub Manager for details.`,
        type: 'featured_rejected',
        action_url: '/workspace',
        is_read: false,
      });

      const { error } = await supabase
        .from('featured_requests')
        .delete()
        .eq('id', reqRow.id);
      if (error) throw new Error(error.message);

      setStatus('success', `${reqRow.request_code} rejected & deleted.`);
      await loadData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to reject request.';
      setStatus('error', msg);
      onNotice?.({ type: 'error', text: msg });
    }
  };

  const isFiltering = Boolean(searchQuery.trim());

  const groupedSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sectionKeys =
      activeSectionFilter === 'all'
        ? SECTION_OPTIONS.map((o) => o.value)
        : [activeSectionFilter];

    const extraKeys = Array.from(
      new Set(draftSlots.map((s) => s.slot_section))
    ).filter(
      (k) =>
        !SECTION_OPTIONS.some((o) => o.value === k) &&
        (activeSectionFilter === 'all' || activeSectionFilter === k)
    );

    const allKeys = [...sectionKeys, ...extraKeys];

    return allKeys
      .map((sectionKey) => {
        const rows = draftSlots
          .filter((s) => s.slot_section === sectionKey)
          .filter((s) =>
            !q
              ? true
              : (s.entityTitle || '').toLowerCase().includes(q) ||
                s.badge_label.toLowerCase().includes(q) ||
                s.entity_type.toLowerCase().includes(q)
          )
          .sort((a, b) => a.priority - b.priority);
        return {
          sectionKey,
          label: formatSectionLabel(sectionKey),
          rows,
        };
      })
      .filter((group) => group.rows.length > 0 || activeSectionFilter !== 'all');
  }, [activeSectionFilter, draftSlots, searchQuery]);

  const totalFilteredSlots = useMemo(
    () => groupedSections.reduce((acc, g) => acc + g.rows.length, 0),
    [groupedSections]
  );

  const pendingReqCount = requests.filter(
    (r) => r.status === 'submitted' || r.status === 'under_review'
  ).length;

  return (
    <div
      data-testid="featured-placements-panel"
      className="space-y-4 pb-20 text-xs text-[var(--ps-text)]"
    >
      {/* Header + Sub-Tab Switcher */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-[var(--ps-text)] truncate">
              Homepage Featured Placements ({scopeHubName})
            </h3>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Drag live preview cards to control homepage spotlight sequence &amp;
              review merchant &ldquo;Get Featured&rdquo; requests.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('slots')}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              subTab === 'slots'
                ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
            }`}
          >
            Active Slots ({slots.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('requests')}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'requests'
                ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
            }`}
          >
            <span>Incoming Requests</span>
            {pendingReqCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                {pendingReqCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            aria-label="Refresh featured placements"
            className="min-h-[44px] min-w-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
          >
            <RefreshCw
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {subTab === 'slots' ? (
        <div className="space-y-4">
          {/* Quick Add Featured Slot */}
          <form
            onSubmit={(e) => void handleAddSlot(e)}
            noValidate
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                <span>Add Entity to Homepage Featured Slots</span>
              </div>
              <span className="text-[11px] text-[var(--ps-text-muted)]">
                New slots append to the end — drag cards below to reorder.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-start">
              <div className="lg:col-span-4 space-y-1">
                <CustomSelectModal
                  label="Select Listing / Product / Vehicle"
                  options={entitySelectOptions}
                  value={selectedEntityKey}
                  onChange={(val) => {
                    setSelectedEntityKey(val);
                    setAddTouched((prev) => ({ ...prev, entity: true }));
                  }}
                  placeholder="Pick active entity..."
                />
                {(addTouched.entity || addSubmitted) &&
                  addValidationErrors.entity && (
                    <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                      {addValidationErrors.entity}
                    </p>
                  )}
              </div>

              <div className="lg:col-span-3">
                <CustomSelectModal
                  label="Homepage Section"
                  options={SECTION_OPTIONS}
                  value={slotSection}
                  onChange={setSlotSection}
                  placeholder="Section"
                />
              </div>

              <div className="lg:col-span-2 space-y-1">
                <input
                  type="text"
                  value={badgeLabel}
                  onChange={(e) => {
                    setBadgeLabel(e.target.value);
                    setAddTouched((prev) => ({ ...prev, badge: true }));
                  }}
                  onBlur={() =>
                    setAddTouched((prev) => ({ ...prev, badge: true }))
                  }
                  placeholder="Badge (e.g. Featured)"
                  aria-label="Featured badge label"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                />
                {(addTouched.badge || addSubmitted) &&
                  addValidationErrors.badge && (
                    <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                      {addValidationErrors.badge}
                    </p>
                  )}
              </div>

              <div className="lg:col-span-3 flex items-start gap-2">
                <div className="w-24 shrink-0 space-y-1">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={expiryDays}
                    onChange={(e) => {
                      setExpiryDays(e.target.value);
                      setAddTouched((prev) => ({ ...prev, expiryDays: true }));
                    }}
                    onBlur={() =>
                      setAddTouched((prev) => ({ ...prev, expiryDays: true }))
                    }
                    title="Days until auto-expiry (0 = Permanent)"
                    placeholder="Days (0=∞)"
                    aria-label="Duration in days"
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-mono text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                  />
                  {(addTouched.expiryDays || addSubmitted) &&
                    addValidationErrors.expiryDays && (
                      <p className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
                        {addValidationErrors.expiryDays}
                      </p>
                    )}
                </div>

                <button
                  type="submit"
                  disabled={isSavingSlot}
                  className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSavingSlot ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Add Slot</span>
                </button>
              </div>
            </div>
          </form>

          {/* Draggable Live Preview Cards */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveSectionFilter('all')}
                  className={`min-h-[44px] rounded-xl px-3 text-xs font-semibold border transition-colors cursor-pointer ${
                    activeSectionFilter === 'all'
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  All Sections ({draftSlots.length})
                </button>
                {SECTION_OPTIONS.map((opt) => {
                  const count = draftSlots.filter(
                    (s) => s.slot_section === opt.value
                  ).length;
                  const active = activeSectionFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setActiveSectionFilter(opt.value)}
                      className={`min-h-[44px] rounded-xl px-3 text-xs font-semibold border transition-colors cursor-pointer ${
                        active
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {opt.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <WorkspaceTableToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search featured cards..."
              filteredCount={totalFilteredSlots}
              totalCount={draftSlots.length}
            />

            {isFiltering && (
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Clear the search filter to drag and reorder featured cards.
              </p>
            )}

            {loading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-32 rounded-2xl border border-[var(--ps-border)] dd-shimmer"
                  />
                ))}
              </div>
            ) : groupedSections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] py-10 text-center text-[var(--ps-text-muted)]">
                No active featured slots yet. Add one above or approve an
                incoming request.
              </div>
            ) : (
              <div className="space-y-5">
                {groupedSections.map((group) => (
                  <div key={group.sectionKey} className="space-y-2.5">
                    <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text)]">
                        {group.label}
                      </h4>
                      <span className="text-[11px] font-medium text-[var(--ps-text-muted)]">
                        {group.rows.length} card
                        {group.rows.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {group.rows.length === 0 ? (
                      <p className="py-4 text-center text-[11px] text-[var(--ps-text-muted)]">
                        No featured cards in {group.label}.
                      </p>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(event) =>
                          handleSectionDragEnd(
                            group.sectionKey,
                            group.rows,
                            event
                          )
                        }
                      >
                        <SortableContext
                          items={group.rows.map((r) => r.id)}
                          strategy={rectSortingStrategy}
                        >
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {group.rows.map((slot, idx) => (
                              <SortablePreviewItem
                                key={slot.id}
                                id={slot.id}
                                dragLabel={`Drag to reorder ${slot.entityTitle || 'featured slot'}`}
                                disabled={isFiltering}
                              >
                                {({ dragHandleProps, isDragging }) => (
                                  <div
                                    className={`flex flex-col justify-between rounded-2xl border bg-[var(--ps-bg)] p-3.5 transition-shadow ${
                                      isDragging
                                        ? 'border-[var(--ps-accent)] shadow-lg'
                                        : 'border-[var(--ps-border)]'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex items-start gap-2 min-w-0">
                                        {!isFiltering && (
                                          <DragHandleButton
                                            handleProps={dragHandleProps}
                                          />
                                        )}
                                        <div className="min-w-0 pt-0.5">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="inline-flex items-center rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] px-1.5 py-0.5 text-[10px] font-mono font-bold text-[var(--ps-text)]">
                                              #{idx + 1}
                                            </span>
                                            <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                              {slot.badge_label}
                                            </span>
                                          </div>
                                          <p className="mt-1.5 text-sm font-bold text-[var(--ps-text)] truncate">
                                            {slot.entityTitle}
                                          </p>
                                          <p className="text-[11px] uppercase tracking-wide text-[var(--ps-text-muted)]">
                                            {slot.entity_type}
                                          </p>
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleRemoveSlot(slot)
                                        }
                                        aria-label={`Remove ${slot.entityTitle}`}
                                        className="min-h-[44px] min-w-[44px] shrink-0 rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400 inline-flex items-center justify-center hover:bg-rose-500/20 cursor-pointer"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>

                                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-2.5">
                                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
                                        <Calendar className="h-3.5 w-3.5 shrink-0" />
                                        <span>
                                          {slot.expires_at
                                            ? `Ends ${new Date(slot.expires_at).toLocaleDateString('en-IN')}`
                                            : 'Permanent'}
                                        </span>
                                      </span>
                                      {!isFiltering && (
                                        <MobileOrderButtons
                                          canMoveUp={idx > 0}
                                          canMoveDown={idx < group.rows.length - 1}
                                          itemLabel={slot.entityTitle || 'featured slot'}
                                          onMoveUp={() =>
                                            handleMoveCard(
                                              group.sectionKey,
                                              group.rows,
                                              idx,
                                              -1
                                            )
                                          }
                                          onMoveDown={() =>
                                            handleMoveCard(
                                              group.sectionKey,
                                              group.rows,
                                              idx,
                                              1
                                            )
                                          }
                                        />
                                      )}
                                    </div>
                                  </div>
                                )}
                              </SortablePreviewItem>
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sticky Batched Order Save Bar */}
          {pendingOrderChanges.length > 0 && (
            <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ps-accent)]/40 bg-[var(--ps-surface)] px-4 py-3 shadow-lg">
              <div className="text-xs font-semibold text-[var(--ps-text)]">
                {pendingOrderChanges.length} featured card
                {pendingOrderChanges.length === 1 ? '' : 's'} reordered —
                unsaved sequence changes
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDraftSlots(slots)}
                  disabled={isSavingOrder}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer disabled:opacity-50"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>Discard</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveOrder()}
                  disabled={isSavingOrder}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-90 cursor-pointer disabled:opacity-50"
                >
                  {isSavingOrder ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Order</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <ResponsiveTableScroll minWidthClass="min-w-[700px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <th className="py-2 pr-3">Code &amp; Entity</th>
                  <th className="py-2 px-3">Section &amp; Duration</th>
                  <th className="py-2 px-3">Contact</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 pl-3 text-right">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-border)]/70">
                {requests.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-6 text-center text-[var(--ps-text-muted)]"
                    >
                      No incoming &ldquo;Get Featured&rdquo; requests right now.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 pr-3">
                        <div className="font-bold text-[var(--ps-text)]">
                          {r.entityTitle}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                          {r.request_code}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="capitalize font-semibold">
                          {formatSectionLabel(r.slot_section)}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)]">
                          {r.duration_days}d · ₹
                          {Number(r.quoted_fee_inr || 0).toLocaleString('en-IN')}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`tel:${r.contact_phone.replace(/[^+\d]/g, '')}`}
                            className="min-h-[44px] px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] inline-flex items-center gap-1.5 text-[11px] font-semibold hover:border-[var(--ps-accent)]"
                          >
                            <Phone className="w-3.5 h-3.5 text-sky-500" />
                            <span>Call</span>
                          </a>
                          <a
                            href={buildWhatsAppUrl(
                              r.contact_phone,
                              `Hi! Regarding your DD oodle Featured Request (${r.request_code}) for "${r.entityTitle}" (${r.duration_days} days, ₹${r.quoted_fee_inr}).`
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[44px] px-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5 text-[11px] font-semibold"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>WhatsApp</span>
                          </a>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                            r.status === 'approved'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {r.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => void handleApproveRequest(r)}
                              className="min-h-[44px] px-3 rounded-xl bg-emerald-600 text-white font-bold inline-flex items-center gap-1.5 hover:bg-emerald-700 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Approve &amp; Feature</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleRejectDeleteRequest(r)}
                            className="min-h-[44px] px-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1.5 hover:bg-rose-500/20 cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Reject &amp; Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

export default FeaturedPlacementsPanel;

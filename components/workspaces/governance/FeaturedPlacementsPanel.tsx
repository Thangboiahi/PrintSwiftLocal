'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
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

export function FeaturedPlacementsPanel({
  scopeHubId = null,
  scopeHubName = 'All Hubs',
  onNotice,
}: FeaturedPlacementsPanelProps) {
  const { user } = useAuth();
  const { setStatus } = useAppStatus();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [subTab, setSubTab] = useState<'slots' | 'requests'>('slots');
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<FeaturedSlotRow[]>([]);
  const [requests, setRequests] = useState<FeaturedRequestRow[]>([]);
  const [searchableEntities, setSearchableEntities] = useState<
    SearchableEntityOption[]
  >([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Quick Add Slot form state
  const [selectedEntityKey, setSelectedEntityKey] = useState('');
  const [slotSection, setSlotSection] = useState('featured_places');
  const [priority, setPriority] = useState('10');
  const [badgeLabel, setBadgeLabel] = useState('Featured');
  const [expiryDays, setExpiryDays] = useState('15');
  const [isSavingSlot, setIsSavingSlot] = useState(false);

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

      setSearchableEntities(entityPool);
      setSlots(
        ((slotsRes.data || []) as FeaturedSlotRow[]).map((s) => ({
          ...s,
          entityTitle: titleMap.get(s.entity_id) || s.entity_id.slice(0, 8),
        }))
      );
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
    void loadData();
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

  const handleAddSlot = async () => {
    const picked = searchableEntities.find(
      (e) => `${e.entityType}:${e.id}` === selectedEntityKey
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
          priority: Number.parseInt(priority, 10) || 10,
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
        text: `Featured "${picked.title}" in ${slotSection.replace(/_/g, ' ')}.`,
      });
      setSelectedEntityKey('');
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
      description: `Publishes immediately to ${reqRow.slot_section.replace(/_/g, ' ')} for ${reqRow.duration_days} days and notifies the merchant.`,
      confirmLabel: 'Approve & Feature Now',
      variant: 'default',
    });
    if (!ok) return;
    setStatus('saving', 'Approving featured request…');
    try {
      const expiresAt = new Date(
        Date.now() + Math.max(1, reqRow.duration_days) * 86400000
      ).toISOString();

      const { error: slotErr } = await supabase.from('featured_slots').upsert(
        {
          hub_id: reqRow.hub_id,
          slot_section: reqRow.slot_section,
          entity_type: reqRow.entity_type,
          entity_id: reqRow.entity_id,
          priority: 10,
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

  const filteredSlots = slots.filter((s) =>
    !searchQuery.trim()
      ? true
      : (s.entityTitle || '')
          .toLowerCase()
          .includes(searchQuery.trim().toLowerCase()) ||
        s.slot_section.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  const pendingReqCount = requests.filter(
    (r) => r.status === 'submitted' || r.status === 'under_review'
  ).length;

  return (
    <div
      data-testid="featured-placements-panel"
      className="space-y-4 text-xs text-[var(--ps-text)]"
    >
      {/* Header + Sub-Tab Switcher */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-[var(--ps-text)] truncate">
              Homepage Featured Placements ({scopeHubName})
            </h3>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Curate active homepage spotlights &amp; review merchant &ldquo;Get
              Featured&rdquo; requests.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubTab('slots')}
            className={`h-8 px-3 rounded-lg text-xs font-bold transition-colors ${
              subTab === 'slots'
                ? 'bg-theme-primary text-theme-primary-foreground'
                : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
            }`}
          >
            Active Slots ({slots.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('requests')}
            className={`h-8 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
              subTab === 'requests'
                ? 'bg-theme-primary text-theme-primary-foreground'
                : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
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
            className="h-8 w-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {subTab === 'slots' ? (
        <div className="space-y-4">
          {/* Quick Add Featured Slot */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              <span>Add Entity to Homepage Featured Slots</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <div className="lg:col-span-2">
                <CustomSelectModal
                  label="Select Listing / Product / Vehicle"
                  options={entitySelectOptions}
                  value={selectedEntityKey}
                  onChange={setSelectedEntityKey}
                  placeholder="Pick active entity..."
                />
              </div>
              <CustomSelectModal
                label="Homepage Section"
                options={SECTION_OPTIONS}
                value={slotSection}
                onChange={setSlotSection}
                placeholder="Section"
              />
              <input
                type="text"
                value={badgeLabel}
                onChange={(e) => setBadgeLabel(e.target.value)}
                placeholder="Badge (e.g. Featured)"
                className="h-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)]"
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  title="Days until auto-expiry (0 = Permanent)"
                  placeholder="Days (0=∞)"
                  className="w-20 h-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-xs font-mono text-[var(--ps-text)]"
                />
                <input
                  type="number"
                  min={1}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  title="Sort priority (lower = first)"
                  placeholder="Prio"
                  className="w-16 h-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-xs font-mono text-[var(--ps-text)]"
                />
                <button
                  type="button"
                  disabled={isSavingSlot || !selectedEntityKey}
                  onClick={() => void handleAddSlot()}
                  className="flex-1 h-9 px-3 rounded-xl bg-theme-primary text-theme-primary-foreground font-bold text-xs inline-flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {isSavingSlot ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Add</span>
                </button>
              </div>
            </div>
          </div>

          {/* Active Slots Table */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <WorkspaceTableToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search featured slots..."
              filteredCount={filteredSlots.length}
              totalCount={slots.length}
            />
            <ResponsiveTableScroll minWidthClass="min-w-[640px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)]">
                    <th className="py-2 pr-3">Entity</th>
                    <th className="py-2 px-3">Section</th>
                    <th className="py-2 px-3">Badge / Prio</th>
                    <th className="py-2 px-3">Expires</th>
                    <th className="py-2 pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ps-border)]/70">
                  {filteredSlots.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-6 text-center text-[var(--ps-text-muted)]"
                      >
                        No active featured slots yet. Add one above or approve
                        an incoming request.
                      </td>
                    </tr>
                  ) : (
                    filteredSlots.map((slot) => (
                      <tr key={slot.id}>
                        <td className="py-2.5 pr-3 font-bold text-[var(--ps-text)]">
                          {slot.entityTitle}
                          <div className="text-[10px] font-normal text-[var(--ps-text-muted)] uppercase">
                            {slot.entity_type}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 capitalize">
                          {slot.slot_section.replace(/_/g, ' ')}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                            {slot.badge_label} · #{slot.priority}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-[var(--ps-text-muted)]">
                          {slot.expires_at
                            ? new Date(slot.expires_at).toLocaleDateString(
                                'en-IN'
                              )
                            : 'Permanent'}
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleRemoveSlot(slot)}
                            className="h-7 px-2.5 rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold inline-flex items-center gap-1 hover:bg-rose-500/20"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Remove</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ResponsiveTableScroll>
          </div>
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
                          {r.slot_section.replace(/_/g, ' ')}
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
                            className="h-7 px-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] inline-flex items-center gap-1 text-[10px] font-semibold hover:border-[var(--ps-accent)]"
                          >
                            <Phone className="w-3 h-3 text-sky-500" />
                            <span>Call</span>
                          </a>
                          <a
                            href={buildWhatsAppUrl(
                              r.contact_phone,
                              `Hi! Regarding your DD oodle Featured Request (${r.request_code}) for "${r.entityTitle}" (${r.duration_days} days, ₹${r.quoted_fee_inr}).`
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-7 px-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1 text-[10px] font-semibold"
                          >
                            <MessageCircle className="w-3 h-3" />
                            <span>WhatsApp</span>
                          </a>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
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
                              className="h-7 px-2.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1 hover:bg-emerald-700"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Approve &amp; Feature</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleRejectDeleteRequest(r)}
                            className="h-7 px-2.5 rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold inline-flex items-center gap-1 hover:bg-rose-500/20"
                          >
                            <XCircle className="w-3 h-3" />
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

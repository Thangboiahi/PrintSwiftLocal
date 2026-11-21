'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Compass,
  Edit2,
  Globe,
  Loader2,
  MapPin,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Shield,
  ShieldCheck,
  Trash2,
  Truck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { useHub } from '@/components/providers/AppConfigProvider';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import type {
  HubVehicleRateItem,
  ServiceHubRecord,
  ServiceHubStatus,
} from '@/lib/config/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { MasterControlTabSharedProps } from './PaymentsGatewayTab';

interface HubManagerRow {
  id: string;
  hub_id: string;
  user_id: string;
  can_confirm_manual_payments: boolean;
  can_edit_rates: boolean;
  is_active: boolean;
  created_at: string;
  profile?: {
    id: string;
    full_name?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    role?: string | null;
  } | null;
  hub?: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

interface HubRequestRow {
  id: string;
  requested_city: string;
  state?: string | null;
  contact_info?: string | null;
  note?: string | null;
  created_at: string;
}

interface VehicleTypeRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  base_fare_inr: number;
  per_km_rate_inr: number;
  wait_per_10min_inr: number;
  free_wait_minutes: number;
  two_way_multiplier: number;
  max_weight_kg: number;
  supported_modes: string[];
  is_active: boolean;
}

type InnerTab = 'service_hubs' | 'hub_managers' | 'hub_requests' | 'rate_cards';

const STATUS_OPTIONS: CustomSelectOption[] = [
  { value: 'active', label: 'Active', description: 'Available for full customer operations' },
  { value: 'coming_soon', label: 'Coming Soon', description: 'Visible with launch countdown & waitlist' },
  { value: 'paused', label: 'Paused', description: 'Temporarily paused due to local conditions' },
];

export function HubsAndRatesTab({
  onNotify,
  refreshGlobalConfig,
}: MasterControlTabSharedProps) {
  const { hubs } = useHub();

  const [activeTab, setActiveTab] = useState<InnerTab>('service_hubs');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // 1. Service Hubs state
  const [localHubs, setLocalHubs] = useState<ServiceHubRecord[]>([]);
  const [editingHub, setEditingHub] = useState<ServiceHubRecord | null>(null);
  const [isCreatingHub, setIsCreatingHub] = useState(false);
  const [hubForm, setHubForm] = useState<{
    id?: string;
    name: string;
    slug: string;
    state: string;
    center_lat: string;
    center_lng: string;
    service_radius_km: string;
    default_zoom: string;
    supported_languages: string;
    default_language: string;
    status: ServiceHubStatus;
    is_default: boolean;
    sort_order: string;
    print_orders_enabled: boolean;
    print_orders_pause_message: string;
  }>({
    name: '',
    slug: '',
    state: 'Manipur',
    center_lat: '24.3333',
    center_lng: '93.6833',
    service_radius_km: '25',
    default_zoom: '14',
    supported_languages: 'en, paite, manipuri',
    default_language: 'en',
    status: 'active',
    is_default: false,
    sort_order: '10',
    print_orders_enabled: true,
    print_orders_pause_message: '',
  });

  // 2. Hub Managers state
  const [managers, setManagers] = useState<HubManagerRow[]>([]);
  const [profiles, setProfiles] = useState<
    Array<{ id: string; full_name?: string | null; email?: string | null; phone?: string | null }>
  >([]);
  const [isAssigningManager, setIsAssigningManager] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [assignHubId, setAssignHubId] = useState<string>('');
  const [assignCanConfirmPayments, setAssignCanConfirmPayments] = useState(false);
  const [assignCanEditRates, setAssignCanEditRates] = useState(false);

  // 3. Expansion Requests state
  const [expansionRequests, setExpansionRequests] = useState<HubRequestRow[]>([]);

  // 4. Hub Rate Cards state
  const [selectedRateHubId, setSelectedRateHubId] = useState<string>('');
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeRow[]>([]);
  const [hubRates, setHubRates] = useState<Record<string, Partial<HubVehicleRateItem>>>({});
  const [savingRateVehicleId, setSavingRateVehicleId] = useState<string | null>(null);

  // Fetch all data
  const loadData = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      // Parallel queries
      const [
        hubsRes,
        managersRes,
        requestsRes,
        vehicleTypesRes,
        ratesRes,
        profilesRes,
      ] = await Promise.all([
        supabase
          .from('service_hubs')
          .select('*')
          .order('sort_order', { ascending: true }),
        supabase
          .from('hub_managers')
          .select('*, profile:profiles(id, full_name, name, email, phone, role), hub:service_hubs(id, name, slug)')
          .order('created_at', { ascending: false }),
        supabase
          .from('hub_requests')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('vehicle_types')
          .select('*')
          .order('sort_order', { ascending: true }),
        supabase
          .from('hub_vehicle_rates')
          .select('*'),
        supabase
          .from('profiles')
          .select('id, full_name, email, phone')
          .limit(50),
      ]);

      if (hubsRes.data) {
        const fetchedHubs = hubsRes.data as ServiceHubRecord[];
        setLocalHubs(fetchedHubs);
        if (!selectedRateHubId && fetchedHubs.length > 0) {
          const defaultHub = fetchedHubs.find((h) => h.is_default) || fetchedHubs[0];
          setSelectedRateHubId(defaultHub.id);
        }
      }

      if (managersRes.data) {
        setManagers(managersRes.data as unknown as HubManagerRow[]);
      }

      if (requestsRes.data) {
        setExpansionRequests(requestsRes.data as HubRequestRow[]);
      }

      if (vehicleTypesRes.data) {
        setVehicleTypes(vehicleTypesRes.data as VehicleTypeRow[]);
      }

      if (ratesRes.data) {
        const map: Record<string, Partial<HubVehicleRateItem>> = {};
        for (const row of ratesRes.data as Array<Record<string, unknown>>) {
          const key = `${row.hub_id}_${row.vehicle_type_id}`;
          map[key] = {
            id: String(row.id),
            hub_id: String(row.hub_id),
            vehicle_type_id: String(row.vehicle_type_id),
            is_enabled_in_hub: Boolean(row.is_enabled_in_hub),
            base_fare_inr: Number(row.base_fare_inr || 0),
            per_km_rate_inr: Number(row.per_km_rate_inr || 0),
            wait_per_10min_inr: Number(row.wait_per_10min_inr || 0),
            free_wait_minutes: Number(row.free_wait_minutes || 0),
            two_way_multiplier: Number(row.two_way_multiplier || 1.75),
          };
        }
        setHubRates(map);
      }

      if (profilesRes.data) {
        setProfiles(profilesRes.data as Array<{ id: string; full_name?: string | null; email?: string | null; phone?: string | null }>);
      }
    } catch (err) {
      console.error('Error loading hubs data:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedRateHubId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData(false);
    });
  }, [loadData]);

  // Set default hub in form if editing
  const handleOpenEditHub = (hub: ServiceHubRecord) => {
    setEditingHub(hub);
    setIsCreatingHub(false);
    const rawPrintSwitch = (
      hub.module_switches as Record<string, unknown> | undefined
    )?.print_orders;
    const printEnabled =
      typeof rawPrintSwitch === 'boolean'
        ? rawPrintSwitch
        : rawPrintSwitch && typeof rawPrintSwitch === 'object'
          ? Boolean(
              (rawPrintSwitch as { enabled?: boolean }).enabled ?? true
            )
          : true;
    const printPauseMessage =
      rawPrintSwitch && typeof rawPrintSwitch === 'object'
        ? String(
            (rawPrintSwitch as { pause_message?: string }).pause_message || ''
          )
        : '';
    setHubForm({
      id: hub.id,
      name: hub.name,
      slug: hub.slug,
      state: hub.state,
      center_lat: String(hub.center_lat),
      center_lng: String(hub.center_lng),
      service_radius_km: String(hub.service_radius_km),
      default_zoom: String(hub.default_zoom || 14),
      supported_languages: (hub.supported_languages || ['en']).join(', '),
      default_language: hub.default_language || 'en',
      status: hub.status,
      is_default: Boolean(hub.is_default),
      sort_order: String(hub.sort_order || 10),
      print_orders_enabled: printEnabled,
      print_orders_pause_message: printPauseMessage,
    });
  };

  const handleOpenCreateHub = () => {
    setEditingHub(null);
    setIsCreatingHub(true);
    setHubForm({
      name: '',
      slug: '',
      state: 'Manipur',
      center_lat: '24.3333',
      center_lng: '93.6833',
      service_radius_km: '25',
      default_zoom: '14',
      supported_languages: 'en, paite, manipuri',
      default_language: 'en',
      status: 'active',
      is_default: false,
      sort_order: String((localHubs.length + 1) * 10),
      print_orders_enabled: true,
      print_orders_pause_message: '',
    });
  };

  const handleSaveHub = async () => {
    const name = hubForm.name.trim();
    let slug = hubForm.slug.trim().toLowerCase();
    if (!name) {
      onNotify?.({ type: 'error', text: 'Hub name is required.' });
      return;
    }
    if (!slug) {
      slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    const languages = hubForm.supported_languages
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);

    setBusyKey('save:hub');
    setAppStatus('saving', `Saving hub "${name}"...`);

    try {
      const mergedSwitches: ServiceHubRecord['module_switches'] = {
        ...(editingHub?.module_switches || {}),
        print_orders: {
          enabled: hubForm.print_orders_enabled,
          pause_message: hubForm.print_orders_pause_message.trim(),
        },
      };

      const payload: Partial<ServiceHubRecord> = {
        name,
        slug,
        state: hubForm.state.trim() || 'Manipur',
        center_lat: parseFloat(hubForm.center_lat) || 24.3333,
        center_lng: parseFloat(hubForm.center_lng) || 93.6833,
        service_radius_km: parseFloat(hubForm.service_radius_km) || 25,
        default_zoom: parseInt(hubForm.default_zoom, 10) || 14,
        supported_languages: languages.length > 0 ? languages : ['en'],
        default_language: hubForm.default_language.trim().toLowerCase() || 'en',
        status: hubForm.status,
        is_default: hubForm.is_default,
        sort_order: parseInt(hubForm.sort_order, 10) || 10,
        module_switches: mergedSwitches,
      };

      if (hubForm.is_default) {
        // Clear is_default from any other hub
        await supabase
          .from('service_hubs')
          .update({ is_default: false })
          .neq('id', editingHub?.id || '00000000-0000-0000-0000-000000000000');
      }

      if (editingHub?.id) {
        const { error } = await supabase
          .from('service_hubs')
          .update(payload)
          .eq('id', editingHub.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('service_hubs')
          .insert(payload);
        if (error) throw error;
      }

      setAppStatus('success', `Hub "${name}" saved successfully.`);
      onNotify?.({ type: 'success', text: `Service Hub "${name}" saved.` });
      setEditingHub(null);
      setIsCreatingHub(false);
      await loadData(true);
      await refreshGlobalConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save hub.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  // Toggle Hub Manager permission
  const handleToggleManagerPermission = async (
    manager: HubManagerRow,
    field: 'can_confirm_manual_payments' | 'can_edit_rates' | 'is_active',
    currentVal: boolean
  ) => {
    const newVal = !currentVal;
    setBusyKey(`toggle:${manager.id}:${field}`);
    setAppStatus('saving', 'Updating manager permission...');

    try {
      const { error } = await supabase
        .from('hub_managers')
        .update({ [field]: newVal })
        .eq('id', manager.id);

      if (error) throw error;

      setManagers((prev) =>
        prev.map((m) => (m.id === manager.id ? { ...m, [field]: newVal } : m))
      );
      setAppStatus('success', 'Manager permission updated.');
      onNotify?.({ type: 'success', text: 'Hub Manager permission updated.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update manager.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  // Assign new hub manager
  const handleAssignHubManager = async () => {
    if (!selectedProfileId) {
      onNotify?.({ type: 'error', text: 'Select a user profile.' });
      return;
    }
    if (!assignHubId) {
      onNotify?.({ type: 'error', text: 'Select a service hub.' });
      return;
    }

    setBusyKey('assign:manager');
    setAppStatus('saving', 'Assigning hub manager...');

    try {
      // 1. Insert into hub_managers
      const { error: insErr } = await supabase.from('hub_managers').upsert(
        {
          hub_id: assignHubId,
          user_id: selectedProfileId,
          can_confirm_manual_payments: assignCanConfirmPayments,
          can_edit_rates: assignCanEditRates,
          is_active: true,
        },
        { onConflict: 'hub_id,user_id' }
      );

      if (insErr) throw insErr;

      // 2. Set role in profiles to hub_manager if currently normal user
      await supabase
        .from('profiles')
        .update({ role: 'hub_manager' })
        .eq('id', selectedProfileId)
        .in('role', ['user', 'customer']);

      setAppStatus('success', 'Hub Manager assigned successfully.');
      onNotify?.({ type: 'success', text: 'User assigned as Hub Manager.' });
      setIsAssigningManager(false);
      setSelectedProfileId('');
      setAssignCanConfirmPayments(false);
      setAssignCanEditRates(false);
      await loadData(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to assign manager.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  // Remove hub manager assignment
  const handleRemoveManager = async (managerId: string) => {
    setBusyKey(`delete:manager:${managerId}`);
    try {
      const { error } = await supabase
        .from('hub_managers')
        .delete()
        .eq('id', managerId);
      if (error) throw error;

      setManagers((prev) => prev.filter((m) => m.id !== managerId));
      onNotify?.({ type: 'info', text: 'Manager assignment removed.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove manager.';
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  // Save rate card row for a vehicle in selected hub
  const handleSaveVehicleRate = async (vehicle: VehicleTypeRow) => {
    if (!selectedRateHubId) return;

    const key = `${selectedRateHubId}_${vehicle.id}`;
    const rateData = hubRates[key] || {};

    setSavingRateVehicleId(vehicle.id);
    setAppStatus('saving', `Saving ${vehicle.name} rates for active hub...`);

    try {
      const payload = {
        hub_id: selectedRateHubId,
        vehicle_type_id: vehicle.id,
        is_enabled_in_hub: rateData.is_enabled_in_hub ?? true,
        base_fare_inr: rateData.base_fare_inr ?? vehicle.base_fare_inr,
        per_km_rate_inr: rateData.per_km_rate_inr ?? vehicle.per_km_rate_inr,
        wait_per_10min_inr: rateData.wait_per_10min_inr ?? vehicle.wait_per_10min_inr,
        free_wait_minutes: rateData.free_wait_minutes ?? vehicle.free_wait_minutes,
        two_way_multiplier: rateData.two_way_multiplier ?? vehicle.two_way_multiplier,
      };

      const { error } = await supabase
        .from('hub_vehicle_rates')
        .upsert(payload, { onConflict: 'hub_id,vehicle_type_id' });

      if (error) throw error;

      setAppStatus('success', `${vehicle.name} rates saved.`);
      onNotify?.({
        type: 'success',
        text: `${vehicle.name} rates updated for this hub.`,
      });
      await refreshGlobalConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save vehicle rate.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setSavingRateVehicleId(null);
    }
  };

  const hubOptions: CustomSelectOption[] = useMemo(
    () =>
      localHubs.map((h) => ({
        value: h.id,
        label: `${h.name} (${h.state})`,
        description: `Status: ${h.status}${h.is_default ? ' · Default' : ''}`,
      })),
    [localHubs]
  );

  const profileOptions: CustomSelectOption[] = useMemo(
    () =>
      profiles.map((p) => ({
        value: p.id,
        label: p.full_name || p.email || p.phone || p.id.slice(0, 8),
        description: p.email || p.phone || 'Registered user',
      })),
    [profiles]
  );

  return (
    <div className="space-y-4">
      {/* Sub-Header & 4 Compact Inner Tabs */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
              <Globe className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <span>Multi-Hub Operations &amp; Local Rate Cards</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Manage branches, assign branch managers, tune per-hub vehicle rates, and inspect city expansion demand.
            </p>
          </div>
          <button
            type="button"
            disabled={isRefreshing || isLoading}
            onClick={() => void loadData(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Dense Sub-Tabs Bar */}
        <div className="mt-2.5 flex items-center gap-1 overflow-x-auto">
          {[
            { id: 'service_hubs', label: `Service Hubs (${localHubs.length})`, icon: Building2 },
            { id: 'hub_managers', label: `Hub Managers (${managers.length})`, icon: Users },
            { id: 'rate_cards', label: 'Hub Rate Cards', icon: Truck },
            { id: 'hub_requests', label: `Expansion Requests (${expansionRequests.length})`, icon: Compass },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as InnerTab)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                  active
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: SERVICE HUBS */}
      {activeTab === 'service_hubs' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Registered Geographic Service Hubs
            </span>
            <button
              type="button"
              onClick={handleOpenCreateHub}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create New Hub</span>
            </button>
          </div>

          {/* Hub Form Drawer / Modal */}
          {(isCreatingHub || editingHub) && (
            <div className="rounded-xl border border-sky-300 bg-sky-50/50 p-4 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/20">
              <div className="flex items-center justify-between border-b border-sky-200 pb-2 dark:border-sky-900">
                <h4 className="text-xs font-bold text-sky-950 dark:text-sky-200">
                  {editingHub ? `Edit Hub: ${editingHub.name}` : 'Provision New Service Hub'}
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setEditingHub(null);
                    setIsCreatingHub(false);
                  }}
                  className="rounded p-1 text-slate-500 hover:bg-sky-100 dark:hover:bg-sky-900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Hub Display Name *
                  </span>
                  <input
                    type="text"
                    value={hubForm.name}
                    onChange={(e) => setHubForm({ ...hubForm, name: e.target.value })}
                    placeholder="e.g. Aizawl"
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Slug (URL Key) *
                  </span>
                  <input
                    type="text"
                    value={hubForm.slug}
                    onChange={(e) => setHubForm({ ...hubForm, slug: e.target.value.toLowerCase() })}
                    placeholder="e.g. aizawl"
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    State / Region *
                  </span>
                  <input
                    type="text"
                    value={hubForm.state}
                    onChange={(e) => setHubForm({ ...hubForm, state: e.target.value })}
                    placeholder="e.g. Mizoram"
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Operational Status
                  </span>
                  <CustomSelectModal
                    label="Hub Status"
                    options={STATUS_OPTIONS}
                    value={hubForm.status}
                    onChange={(v) => setHubForm({ ...hubForm, status: v as ServiceHubStatus })}
                  />
                </div>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Center Latitude
                  </span>
                  <input
                    type="number"
                    step="0.0001"
                    value={hubForm.center_lat}
                    onChange={(e) => setHubForm({ ...hubForm, center_lat: e.target.value })}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Center Longitude
                  </span>
                  <input
                    type="number"
                    step="0.0001"
                    value={hubForm.center_lng}
                    onChange={(e) => setHubForm({ ...hubForm, center_lng: e.target.value })}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Geofence Radius (km)
                  </span>
                  <input
                    type="number"
                    value={hubForm.service_radius_km}
                    onChange={(e) => setHubForm({ ...hubForm, service_radius_km: e.target.value })}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Default Map Zoom
                  </span>
                  <input
                    type="number"
                    value={hubForm.default_zoom}
                    onChange={(e) => setHubForm({ ...hubForm, default_zoom: e.target.value })}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>
              </div>

              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Supported Languages (comma-separated)
                  </span>
                  <input
                    type="text"
                    value={hubForm.supported_languages}
                    onChange={(e) => setHubForm({ ...hubForm, supported_languages: e.target.value })}
                    placeholder="en, paite, manipuri, mizo"
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Default Language
                  </span>
                  <input
                    type="text"
                    value={hubForm.default_language}
                    onChange={(e) => setHubForm({ ...hubForm, default_language: e.target.value })}
                    placeholder="en"
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <div className="flex items-center gap-4 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hubForm.is_default}
                      onChange={(e) => setHubForm({ ...hubForm, is_default: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Default Fallback Hub
                    </span>
                  </label>
                </div>
              </div>

              {/* Hub Print & Digital Ordering Switch */}
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hubForm.print_orders_enabled}
                    onChange={(e) =>
                      setHubForm({
                        ...hubForm,
                        print_orders_enabled: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                      <Printer className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                      <span>Print &amp; Digital Ordering (`print_orders`)</span>
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Enable or pause online print ordering for this hub.
                    </p>
                  </div>
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Print Orders Pause Notice (Optional)
                  </span>
                  <input
                    type="text"
                    value={hubForm.print_orders_pause_message}
                    onChange={(e) =>
                      setHubForm({
                        ...hubForm,
                        print_orders_pause_message: e.target.value,
                      })
                    }
                    placeholder="e.g. District power outage — online print ordering paused temporarily"
                    className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-sky-200 pt-2.5 dark:border-sky-900">
                <button
                  type="button"
                  onClick={() => {
                    setEditingHub(null);
                    setIsCreatingHub(false);
                  }}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyKey === 'save:hub'}
                  onClick={() => void handleSaveHub()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {busyKey === 'save:hub' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Hub Configuration</span>
                </button>
              </div>
            </div>
          )}

          {/* Hubs Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {localHubs.map((hub) => (
              <div
                key={hub.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-bold text-slate-900 dark:text-white">
                          {hub.name}
                        </h4>
                        {hub.is_default && (
                          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {hub.state} · <code className="font-mono text-sky-600 dark:text-sky-400">{hub.slug}</code>
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        hub.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : hub.status === 'coming_soon'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {hub.status}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                      <span>
                        Coords: {hub.center_lat.toFixed(4)}, {hub.center_lng.toFixed(4)} ({hub.service_radius_km} km radius)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Globe className="h-3 w-3 text-slate-400 shrink-0" />
                      <span>
                        Languages: {(hub.supported_languages || ['en']).join(', ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Printer className="h-3 w-3 text-slate-400 shrink-0" />
                      <span>
                        Print Orders:{' '}
                        {(() => {
                          const rawSw = (
                            hub.module_switches as Record<string, unknown> | undefined
                          )?.print_orders;
                          const enabled =
                            typeof rawSw === 'boolean'
                              ? rawSw
                              : rawSw && typeof rawSw === 'object'
                                ? Boolean((rawSw as { enabled?: boolean }).enabled ?? true)
                                : true;
                          return enabled ? (
                            <strong className="text-emerald-600 dark:text-emerald-400">
                              Active
                            </strong>
                          ) : (
                            <strong className="text-amber-600 dark:text-amber-400">
                              Paused
                            </strong>
                          );
                        })()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-3.5 flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800">
                  <span className="text-[10px] text-slate-400">
                    Sort Order: {hub.sort_order}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenEditHub(hub)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Edit2 className="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: HUB MANAGERS ASSIGNMENTS */}
      {activeTab === 'hub_managers' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Assigned Branch &amp; Hub Managers
              </span>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Managers operate locally with isolated catalog/fleet views and scoped UPI approval delegation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAssigningManager(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>Assign Manager</span>
            </button>
          </div>

          {/* Assign Manager Modal / Form */}
          {isAssigningManager && (
            <div className="rounded-xl border border-sky-300 bg-sky-50/50 p-4 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/20">
              <div className="flex items-center justify-between border-b border-sky-200 pb-2 dark:border-sky-900">
                <h4 className="text-xs font-bold text-sky-950 dark:text-sky-200">
                  Assign User as Hub Manager
                </h4>
                <button
                  type="button"
                  onClick={() => setIsAssigningManager(false)}
                  className="rounded p-1 text-slate-500 hover:bg-sky-100 dark:hover:bg-sky-900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Select User Profile
                  </span>
                  <CustomSelectModal
                    label="Select Profile"
                    options={profileOptions}
                    value={selectedProfileId}
                    onChange={setSelectedProfileId}
                    placeholder="Choose user profile..."
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Select Assigned Service Hub
                  </span>
                  <CustomSelectModal
                    label="Select Hub"
                    options={hubOptions}
                    value={assignHubId}
                    onChange={setAssignHubId}
                    placeholder="Choose hub..."
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-6 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignCanConfirmPayments}
                    onChange={(e) => setAssignCanConfirmPayments(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Can Confirm Manual UPI Payments
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Allows 1-click fulfillment of UPI orders for this hub (defaults to false).
                    </p>
                  </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignCanEditRates}
                    onChange={(e) => setAssignCanEditRates(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Can Edit Local Rate Cards
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Allows modifying base fares and per-km vehicle pricing in this hub.
                    </p>
                  </div>
                </label>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAssigningManager(false)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyKey === 'assign:manager'}
                  onClick={() => void handleAssignHubManager()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {busyKey === 'assign:manager' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Assignment</span>
                </button>
              </div>
            </div>
          )}

          {/* Managers List */}
          {managers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/50">
              No Hub Managers assigned yet. Super-Admin manages all hubs by default.
            </div>
          ) : (
            <ResponsiveTableScroll
              minWidthClass="min-w-[640px]"
              showSwipeHint={true}
              swipeHintLabel="Swipe ↔ to view manager roles & delegations"
            >
              <div className="space-y-2 p-1">
                {managers.map((m) => {
                  const profile = m.profile;
                  const hub = m.hub;
                  return (
                    <div
                      key={m.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-white">
                            {profile?.full_name || profile?.name || profile?.email || 'Manager Profile'}
                          </span>
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                            {hub?.name || 'Assigned Hub'}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              m.is_active
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {m.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {profile?.email} {profile?.phone ? `· ${profile.phone}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Permission Badges / Toggles */}
                        <button
                          type="button"
                          onClick={() =>
                            void handleToggleManagerPermission(
                              m,
                              'can_confirm_manual_payments',
                              m.can_confirm_manual_payments
                            )
                          }
                          className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold transition ${
                            m.can_confirm_manual_payments
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                              : 'border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800'
                          }`}
                        >
                          <ShieldCheck className="h-3 w-3" />
                          <span>UPI Approval: {m.can_confirm_manual_payments ? 'ON' : 'OFF'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void handleToggleManagerPermission(
                              m,
                              'can_edit_rates',
                              m.can_edit_rates
                            )
                          }
                          className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold transition ${
                            m.can_edit_rates
                              ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300'
                              : 'border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800'
                          }`}
                        >
                          <Truck className="h-3 w-3" />
                          <span>Rates Edit: {m.can_edit_rates ? 'ON' : 'OFF'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void handleToggleManagerPermission(m, 'is_active', m.is_active)
                          }
                          className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {m.is_active ? 'Deactivate' : 'Activate'}
                        </button>

                        <button
                          type="button"
                          disabled={busyKey === `delete:manager:${m.id}`}
                          onClick={() => void handleRemoveManager(m.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ResponsiveTableScroll>
          )}
        </div>
      )}

      {/* TAB 3: HUB RATE CARDS */}
      {activeTab === 'rate_cards' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Target Service Hub:
              </span>
              <div className="w-56">
                <CustomSelectModal
                  label="Select Hub"
                  options={hubOptions}
                  value={selectedRateHubId}
                  onChange={setSelectedRateHubId}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Rates set here override platform defaults for orders created within this hub.
            </p>
          </div>

          <div className="space-y-2.5">
            {vehicleTypes.map((vehicle) => {
              const key = `${selectedRateHubId}_${vehicle.id}`;
              const currentRate = hubRates[key] || {
                is_enabled_in_hub: true,
                base_fare_inr: vehicle.base_fare_inr,
                per_km_rate_inr: vehicle.per_km_rate_inr,
                wait_per_10min_inr: vehicle.wait_per_10min_inr,
                free_wait_minutes: vehicle.free_wait_minutes,
                two_way_multiplier: vehicle.two_way_multiplier,
              };

              const isSaving = savingRateVehicleId === vehicle.id;

              return (
                <div
                  key={vehicle.id}
                  className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 font-bold text-sky-600 dark:bg-sky-950/60 dark:text-sky-300">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-bold text-slate-900 dark:text-white">
                            {vehicle.name}
                          </h4>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            {vehicle.slug}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Max Weight: {vehicle.max_weight_kg}kg · Modes: {vehicle.supported_modes?.join(', ')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setHubRates((prev) => ({
                            ...prev,
                            [key]: {
                              ...currentRate,
                              is_enabled_in_hub: !(currentRate.is_enabled_in_hub ?? true),
                            },
                          }))
                        }
                        className={`h-7 rounded-md px-2.5 text-[11px] font-bold ${
                          currentRate.is_enabled_in_hub ?? true
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                        }`}
                      >
                        {currentRate.is_enabled_in_hub ?? true ? 'Enabled in Hub' : 'Disabled in Hub'}
                      </button>

                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void handleSaveVehicleRate(vehicle)}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-600 px-2.5 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                        {isSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        <span>Save</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Base Fare (₹)
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={currentRate.base_fare_inr ?? vehicle.base_fare_inr}
                        onChange={(e) =>
                          setHubRates((prev) => ({
                            ...prev,
                            [key]: {
                              ...currentRate,
                              base_fare_inr: Number(e.target.value) || 0,
                            },
                          }))
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>

                    <label className="space-y-0.5">
                      <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Per-Km Rate (₹)
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={currentRate.per_km_rate_inr ?? vehicle.per_km_rate_inr}
                        onChange={(e) =>
                          setHubRates((prev) => ({
                            ...prev,
                            [key]: {
                              ...currentRate,
                              per_km_rate_inr: Number(e.target.value) || 0,
                            },
                          }))
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>

                    <label className="space-y-0.5">
                      <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Wait / 10m (₹)
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={currentRate.wait_per_10min_inr ?? vehicle.wait_per_10min_inr}
                        onChange={(e) =>
                          setHubRates((prev) => ({
                            ...prev,
                            [key]: {
                              ...currentRate,
                              wait_per_10min_inr: Number(e.target.value) || 0,
                            },
                          }))
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>

                    <label className="space-y-0.5">
                      <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Free Wait (min)
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={currentRate.free_wait_minutes ?? vehicle.free_wait_minutes}
                        onChange={(e) =>
                          setHubRates((prev) => ({
                            ...prev,
                            [key]: {
                              ...currentRate,
                              free_wait_minutes: Number(e.target.value) || 0,
                            },
                          }))
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>

                    <label className="space-y-0.5">
                      <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                        Round Trip Multiplier
                      </span>
                      <input
                        type="number"
                        step="0.05"
                        min={1}
                        value={currentRate.two_way_multiplier ?? vehicle.two_way_multiplier}
                        onChange={(e) =>
                          setHubRates((prev) => ({
                            ...prev,
                            [key]: {
                              ...currentRate,
                              two_way_multiplier: Number(e.target.value) || 1.75,
                            },
                          }))
                        }
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 font-mono text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: CITY EXPANSION REQUESTS */}
      {activeTab === 'hub_requests' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">
              Visitor City Expansion Requests ({expansionRequests.length})
            </h4>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Logged automatically whenever out-of-area visitors submit the &quot;Request My City&quot; form from GPS detection.
            </p>
          </div>

          {expansionRequests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/50">
              No expansion requests captured yet.
            </div>
          ) : (
            <ResponsiveTableScroll
              minWidthClass="min-w-[540px]"
              showSwipeHint={true}
              swipeHintLabel="Swipe ↔ to view request details"
            >
              <div className="space-y-2 p-1">
                {expansionRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {req.requested_city}
                        </span>
                        {req.state && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            {req.state}
                          </span>
                        )}
                      </div>
                      {req.note && (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          &quot;{req.note}&quot;
                        </p>
                      )}
                      {req.contact_info && (
                        <p className="text-[11px] text-sky-600 dark:text-sky-400">
                          Contact: {req.contact_info}
                        </p>
                      )}
                    </div>

                    <span className="text-[10px] text-slate-400 shrink-0">
                      {new Date(req.created_at).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </ResponsiveTableScroll>
          )}
        </div>
      )}
    </div>
  );
}

export default HubsAndRatesTab;

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  KeyRound,
  Loader2,
  MapPin,
  Package,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Truck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/store';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { getSignedPodUrl, uploadDeliveryPod } from '@/lib/supabase/storage';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import {
  CONTAINER_LABELS,
  DELIVERY_STATUS_META,
  SERVICE_MODE_META,
  type DeliveryOrderRecord,
  type DeliveryOrderStatus,
  type DeliveryTransactionRecord,
  type DriverRecord,
  type VehicleRecord,
  type VehicleTypeItem,
} from '@/lib/pick-n-drop/types';

export interface PickNDropConsoleProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

type ConsoleSubTab = 'dispatch' | 'fleet';
type DispatchFilter =
  | 'all'
  | 'payment_submitted'
  | 'escrow_held'
  | 'in_progress'
  | 'delivered_pending_confirm'
  | 'completed';

export function PickNDropConsole({ onNotice }: PickNDropConsoleProps) {
  const { user: authUser, role: syncedRole } = useAuth();
  const [subTab, setSubTab] = useState<ConsoleSubTab>('dispatch');
  const [dispatchFilter, setDispatchFilter] = useState<DispatchFilter>('all');
  const [dispatchSearch, setDispatchSearch] = useState('');
  const [serviceModeFilter, setServiceModeFilter] = useState<
    'all' | 'parcel' | 'passenger' | 'gas'
  >('all');
  const [driverSearch, setDriverSearch] = useState('');
  const [driverKycFilter, setDriverKycFilter] = useState<
    'all' | 'verified' | 'pending'
  >('all');
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleAvailFilter, setVehicleAvailFilter] = useState<
    'all' | 'available' | 'unavailable'
  >('all');

  const [orders, setOrders] = useState<DeliveryOrderRecord[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeItem[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [consoleBanner, setConsoleBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Per-order interactive state
  const [assignDriverMap, setAssignDriverMap] = useState<
    Record<string, string>
  >({});
  const [assignVehicleMap, setAssignVehicleMap] = useState<
    Record<string, string>
  >({});
  const [otpInputMap, setOtpInputMap] = useState<Record<string, string>>({});
  const [podFileMap, setPodFileMap] = useState<Record<string, File | null>>({});
  const [signedPodUrls, setSignedPodUrls] = useState<Record<string, string>>(
    {}
  );
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  // Fleet Management Forms
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverLicense, setNewDriverLicense] = useState('');
  const [newDriverProfileId, setNewDriverProfileId] = useState('');
  const [newDriverKyc, setNewDriverKyc] = useState(true);
  const [isSavingDriver, setIsSavingDriver] = useState(false);

  const [newPlateNumber, setNewPlateNumber] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newRcNumber, setNewRcNumber] = useState('');
  const [newVehicleTypeId, setNewVehicleTypeId] = useState('');
  const [newVehicleDriverId, setNewVehicleDriverId] = useState('');
  const [isSavingVehicle, setIsSavingVehicle] = useState(false);
  const [togglingVehicleId, setTogglingVehicleId] = useState<string | null>(
    null
  );
  const [togglingDriverKycId, setTogglingDriverKycId] = useState<string | null>(
    null
  );

  const isMediator = useMemo(() => {
    const r = String(syncedRole || '').toLowerCase();
    return r === 'owner' || r === 'admin' || r === 'super_admin';
  }, [syncedRole]);

  const emitNotice = useCallback(
    (type: 'success' | 'error' | 'info', text: string) => {
      setConsoleBanner({ type, text });
      onNotice?.({ type, text });
    },
    [onNotice]
  );

  const loadConsoleData = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [ordersRes, vtRes, driversRes, vehiclesRes, txRes] =
        await Promise.all([
          supabase
            .from('delivery_orders')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(60),
          supabase
            .from('vehicle_types')
            .select('*')
            .order('base_fare_inr', { ascending: true }),
          supabase
            .from('drivers')
            .select('*')
            .order('created_at', { ascending: false }),
          supabase
            .from('vehicles')
            .select('*')
            .order('updated_at', { ascending: false }),
          supabase
            .from('delivery_transactions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200),
        ]);

      const vtList = ((vtRes.data || []) as VehicleTypeItem[]).map((vt) => ({
        ...vt,
        base_fare_inr: Number(vt.base_fare_inr),
        per_km_rate_inr: Number(vt.per_km_rate_inr),
        wait_per_10min_inr: Number(vt.wait_per_10min_inr),
        two_way_multiplier: Number(vt.two_way_multiplier),
      }));
      const driverList = (driversRes.data || []) as DriverRecord[];
      const vehicleList = (vehiclesRes.data || []) as VehicleRecord[];

      const vtMap = new Map(vtList.map((v) => [v.id, v]));
      const drMap = new Map(driverList.map((d) => [d.id, d]));
      const vhMap = new Map(vehicleList.map((v) => [v.id, v]));
      const txMap = new Map<string, DeliveryTransactionRecord[]>();
      for (const tx of (txRes.data || []) as DeliveryTransactionRecord[]) {
        const list = txMap.get(tx.order_id) || [];
        list.push(tx);
        txMap.set(tx.order_id, list);
      }

      const hydratedOrders: DeliveryOrderRecord[] = (
        (ordersRes.data || []) as DeliveryOrderRecord[]
      ).map((o) => ({
        ...o,
        distance_km: Number(o.distance_km),
        quoted_fare_inr: Number(o.quoted_fare_inr),
        declared_value_inr: Number(o.declared_value_inr || 0),
        vehicle_type: vtMap.get(o.vehicle_type_id) || null,
        driver: o.driver_id ? drMap.get(o.driver_id) || null : null,
        vehicle: o.vehicle_id ? vhMap.get(o.vehicle_id) || null : null,
        transactions: txMap.get(o.id) || [],
      }));

      setVehicleTypes(vtList);
      setDrivers(driverList);
      setVehicles(vehicleList);
      setOrders(hydratedOrders);

      if (vtList.length > 0) {
        setNewVehicleTypeId((prev) => prev || vtList[0].id);
      }
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to load Pick N Drop dispatch console.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [emitNotice]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void loadConsoleData();
      }
    });
    return () => {
      active = false;
    };
  }, [loadConsoleData]);

  // Options for <CustomSelectModal /> pickers (zero native <select>)
  const driverSelectOptions: CustomSelectOption[] = useMemo(
    () =>
      drivers
        .filter((d) => d.is_active)
        .map((d) => ({
          value: d.id,
          label: `${d.full_name} (${d.phone})`,
          description: `License: ${d.license_no}${d.kyc_verified ? ' • KYC Verified' : ''}`,
        })),
    [drivers]
  );

  const vehicleSelectOptions: CustomSelectOption[] = useMemo(
    () =>
      vehicles.map((v) => {
        const vt = vehicleTypes.find((t) => t.id === v.vehicle_type_id);
        return {
          value: v.id,
          label: `${v.plate_number} — ${v.model_name || vt?.name || 'Vehicle'}`,
          description: `${vt?.name || ''} • ${v.is_available ? 'Available' : 'Busy'}`,
        };
      }),
    [vehicles, vehicleTypes]
  );

  const vehicleTypeSelectOptions: CustomSelectOption[] = useMemo(
    () =>
      vehicleTypes.map((vt) => ({
        value: vt.id,
        label: vt.name,
        description: `Base ₹${vt.base_fare_inr} • ₹${vt.per_km_rate_inr}/km • Max ${vt.max_weight_kg} kg`,
      })),
    [vehicleTypes]
  );

  const filteredOrders = useMemo(() => {
    const q = dispatchSearch.trim().toLowerCase();
    return orders.filter((o) => {
      if (dispatchFilter === 'in_progress') {
        if (
          !['driver_assigned', 'picked_up', 'in_transit', 'return_in_transit'].includes(
            o.status
          )
        ) {
          return false;
        }
      } else if (dispatchFilter !== 'all' && o.status !== dispatchFilter) {
        return false;
      }
      if (serviceModeFilter !== 'all' && o.service_mode !== serviceModeFilter) {
        return false;
      }
      if (!q) return true;
      const utrMatch = (o.transactions || []).some((t) =>
        (t.upi_utr_ref || '').toLowerCase().includes(q)
      );
      return (
        o.order_code.toLowerCase().includes(q) ||
        (o.pickup_address || '').toLowerCase().includes(q) ||
        (o.pickup_landmark || '').toLowerCase().includes(q) ||
        (o.dropoff_address || '').toLowerCase().includes(q) ||
        (o.dropoff_landmark || '').toLowerCase().includes(q) ||
        (o.sender_phone || '').toLowerCase().includes(q) ||
        (o.recipient_name || '').toLowerCase().includes(q) ||
        (o.recipient_phone || '').toLowerCase().includes(q) ||
        (o.driver?.full_name || '').toLowerCase().includes(q) ||
        utrMatch
      );
    });
  }, [orders, dispatchFilter, serviceModeFilter, dispatchSearch]);

  const filteredDrivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    return drivers.filter((d) => {
      if (driverKycFilter === 'verified' && !d.kyc_verified) return false;
      if (driverKycFilter === 'pending' && d.kyc_verified) return false;
      if (!q) return true;
      return (
        d.full_name.toLowerCase().includes(q) ||
        (d.phone || '').toLowerCase().includes(q) ||
        (d.license_no || '').toLowerCase().includes(q)
      );
    });
  }, [drivers, driverSearch, driverKycFilter]);

  const filteredVehicles = useMemo(() => {
    const q = vehicleSearch.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (vehicleAvailFilter === 'available' && !v.is_available) return false;
      if (vehicleAvailFilter === 'unavailable' && v.is_available) return false;
      if (!q) return true;
      const vt = vehicleTypes.find((t) => t.id === v.vehicle_type_id);
      const dr = drivers.find((d) => d.id === v.driver_id);
      return (
        v.plate_number.toLowerCase().includes(q) ||
        (v.model_name || '').toLowerCase().includes(q) ||
        (vt?.name || '').toLowerCase().includes(q) ||
        (dr?.full_name || '').toLowerCase().includes(q)
      );
    });
  }, [vehicles, vehicleTypes, drivers, vehicleSearch, vehicleAvailFilter]);

  const hasDispatchFilters =
    dispatchSearch.trim() !== '' ||
    dispatchFilter !== 'all' ||
    serviceModeFilter !== 'all';
  const hasDriverFilters =
    driverSearch.trim() !== '' || driverKycFilter !== 'all';
  const hasVehicleFilters =
    vehicleSearch.trim() !== '' || vehicleAvailFilter !== 'all';

  const counts = useMemo(() => {
    return {
      paymentSubmitted: orders.filter((o) => o.status === 'payment_submitted')
        .length,
      escrowHeld: orders.filter((o) => o.status === 'escrow_held').length,
      inProgress: orders.filter((o) =>
        ['driver_assigned', 'picked_up', 'in_transit', 'return_in_transit'].includes(
          o.status
        )
      ).length,
      pendingConfirm: orders.filter(
        (o) => o.status === 'delivered_pending_confirm'
      ).length,
    };
  }, [orders]);

  // ACTION 1: Verify UPI & Hold Escrow
  const handleVerifyUpiAndHoldEscrow = async (order: DeliveryOrderRecord) => {
    setBusyOrderId(order.id);
    setAppStatus('saving', 'Verifying UPI escrow');
    try {
      const latestUpi = order.transactions?.find(
        (t) => t.tx_type === 'upi_payment'
      );

      const { error: updateErr } = await supabase
        .from('delivery_orders')
        .update({
          status: 'escrow_held',
          mediator_id: authUser?.id || null,
        })
        .eq('id', order.id);

      if (updateErr) throw new Error(updateErr.message);

      await supabase.from('delivery_transactions').insert({
        order_id: order.id,
        tx_type: 'escrow_hold',
        amount_inr: order.quoted_fare_inr,
        upi_utr_ref: latestUpi?.upi_utr_ref || null,
        recorded_by: authUser?.id || null,
        notes: 'Mediator verified manual UPI payment and locked funds in escrow',
      });

      await supabase.from('delivery_order_events').insert({
        order_id: order.id,
        actor_id: authUser?.id || null,
        event_type: 'escrow_verified',
        payload: {
          upi_utr_ref: latestUpi?.upi_utr_ref || null,
          amount_inr: order.quoted_fare_inr,
        },
      });

      setAppStatus('success', 'Escrow held');
      emitNotice(
        'success',
        `Verified UPI payment for ${order.order_code}. Funds held in escrow — ready for driver assignment.`
      );
      await loadConsoleData();
    } catch (err) {
      setAppStatus('error', 'Escrow update failed');
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to verify UPI escrow.'
      );
    } finally {
      setBusyOrderId(null);
    }
  };

  // ACTION 2: Assign Available Driver & Vehicle
  const handleAssignDriverVehicle = async (order: DeliveryOrderRecord) => {
    const selectedDriverId = assignDriverMap[order.id] || order.driver_id || '';
    const selectedVehicleId =
      assignVehicleMap[order.id] || order.vehicle_id || '';

    if (!selectedDriverId) {
      emitNotice('error', 'Please select a driver to assign to this order.');
      return;
    }

    setBusyOrderId(order.id);
    setAppStatus('saving', 'Assigning driver');
    try {
      const { error } = await supabase
        .from('delivery_orders')
        .update({
          driver_id: selectedDriverId,
          vehicle_id: selectedVehicleId || null,
          mediator_id: order.mediator_id || authUser?.id || null,
          status: 'driver_assigned',
        })
        .eq('id', order.id);

      if (error) throw new Error(error.message);

      await supabase.from('delivery_order_events').insert({
        order_id: order.id,
        actor_id: authUser?.id || null,
        event_type: 'driver_assigned',
        payload: {
          driver_id: selectedDriverId,
          vehicle_id: selectedVehicleId || null,
        },
      });

      setAppStatus('success', 'Driver assigned');
      emitNotice(
        'success',
        `Assigned driver to ${order.order_code}. Ready for Pickup OTP handover.`
      );
      await loadConsoleData();
    } catch (err) {
      setAppStatus('error', 'Assign failed');
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to assign driver.'
      );
    } finally {
      setBusyOrderId(null);
    }
  };

  // ACTION 3: Driver / Mediator Handover OTP Verification via SECURITY DEFINER RPC
  const handleVerifyStageOtp = async (
    order: DeliveryOrderRecord,
    stage: 'pickup' | 'dropoff' | 'return'
  ) => {
    const otpCode = (otpInputMap[order.id] || '').trim();
    if (!/^\d{6}$/.test(otpCode)) {
      emitNotice('error', 'Please enter the exact 6-digit handover OTP.');
      return;
    }

    let podPath: string | null = null;
    const requiresPod = order.pod_required !== false;
    if (stage === 'dropoff') {
      const podFile = podFileMap[order.id];
      if (requiresPod && !podFile) {
        emitNotice(
          'error',
          'A Proof of Delivery (POD) photo upload is mandatory before verifying the Dropoff OTP.'
        );
        return;
      }

      if (podFile) {
        setBusyOrderId(order.id);
        setAppStatus('uploading', 'Uploading private POD');
        try {
          const uploaded = await uploadDeliveryPod(order.id, podFile);
          podPath = uploaded.path;
        } catch (err) {
          setBusyOrderId(null);
          setAppStatus('error', 'POD upload failed');
          emitNotice(
            'error',
            err instanceof Error
              ? err.message
              : 'Failed to upload private POD photo.'
          );
          return;
        }
      }
    }

    setBusyOrderId(order.id);
    setAppStatus('saving', `Verifying ${stage} OTP`);
    try {
      const { data, error } = await supabase.rpc('verify_delivery_otp', {
        p_order_id: order.id,
        p_stage: stage,
        p_otp: otpCode,
        p_pod_path: podPath,
      });

      if (error) throw new Error(error.message);

      const result = data as {
        ok?: boolean;
        error?: string;
        status?: DeliveryOrderStatus;
        attempts_remaining?: number;
      } | null;

      if (!result?.ok) {
        const extra =
          typeof result?.attempts_remaining === 'number'
            ? ` (${result.attempts_remaining} attempts remaining)`
            : '';
        throw new Error((result?.error || 'Invalid OTP.') + extra);
      }

      setOtpInputMap((prev) => ({ ...prev, [order.id]: '' }));
      setPodFileMap((prev) => ({ ...prev, [order.id]: null }));
      setAppStatus('success', `${stage} verified`);
      emitNotice(
        'success',
        `${order.order_code}: ${stage.toUpperCase()} OTP verified! Status is now "${result.status?.replace(/_/g, ' ')}".`
      );
      await loadConsoleData();
    } catch (err) {
      setAppStatus('error', 'OTP rejected');
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'OTP verification failed.'
      );
    } finally {
      setBusyOrderId(null);
    }
  };

  // ACTION 4: Load Private POD 5-minute Signed URL
  const handleInspectSignedPod = async (order: DeliveryOrderRecord) => {
    if (!order.pod_storage_path) return;
    setBusyOrderId(order.id);
    try {
      const signed = await getSignedPodUrl(order.pod_storage_path, 300);
      setSignedPodUrls((prev) => ({ ...prev, [order.id]: signed }));
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Unable to sign private POD URL.'
      );
    } finally {
      setBusyOrderId(null);
    }
  };

  // ACTION 5: Mediator Final Confirmation & Payout Settlement RPC
  const handleConfirmCompletionAndReleasePayout = async (
    order: DeliveryOrderRecord
  ) => {
    setBusyOrderId(order.id);
    setAppStatus('saving', 'Releasing escrow payout');
    try {
      const { data, error } = await supabase.rpc('mediator_confirm_delivery', {
        p_order_id: order.id,
      });

      if (error) throw new Error(error.message);

      const res = data as {
        driver_payout_inr?: number;
        platform_commission_inr?: number;
        pod_purge_at?: string;
      } | null;

      setAppStatus('success', 'Payout released');
      emitNotice(
        'success',
        `${order.order_code} completed! Driver payout ₹${res?.driver_payout_inr ?? '—'} & commission ₹${res?.platform_commission_inr ?? '—'} recorded. POD scheduled for 48h auto-purge.`
      );
      await loadConsoleData();
    } catch (err) {
      setAppStatus('error', 'Settlement failed');
      emitNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to confirm delivery settlement.'
      );
    } finally {
      setBusyOrderId(null);
    }
  };

  // FLEET ACTION 1: Add Driver
  const handleAddDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !newDriverName.trim() ||
      !newDriverPhone.trim() ||
      !newDriverLicense.trim()
    ) {
      emitNotice(
        'error',
        'Driver full name, phone, and driving license number are required.'
      );
      return;
    }

    setIsSavingDriver(true);
    setAppStatus('saving', 'Adding driver');
    try {
      const { error } = await supabase.from('drivers').insert({
        full_name: newDriverName.trim(),
        phone: newDriverPhone.trim(),
        license_no: newDriverLicense.trim(),
        profile_id: newDriverProfileId.trim() || null,
        kyc_verified: newDriverKyc,
        is_active: true,
      });

      if (error) throw new Error(error.message);

      setNewDriverName('');
      setNewDriverPhone('');
      setNewDriverLicense('');
      setNewDriverProfileId('');
      setAppStatus('success', 'Driver added');
      emitNotice('success', 'Added new driver to the Vehicle Pool.');
      await loadConsoleData();
    } catch (err) {
      setAppStatus('error', 'Save failed');
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to add driver.'
      );
    } finally {
      setIsSavingDriver(false);
    }
  };

  // FLEET ACTION 1B: Toggle Driver KYC Approve / Revoke
  const handleToggleDriverKyc = async (driver: DriverRecord) => {
    setTogglingDriverKycId(driver.id);
    const nextKyc = !driver.kyc_verified;
    setAppStatus('saving', nextKyc ? 'Approving Driver KYC' : 'Revoking Driver KYC');
    try {
      const { error } = await supabase
        .from('drivers')
        .update({ kyc_verified: nextKyc })
        .eq('id', driver.id);
      if (error) throw new Error(error.message);

      setDrivers((prev) =>
        prev.map((d) =>
          d.id === driver.id ? { ...d, kyc_verified: nextKyc } : d
        )
      );
      setAppStatus('success', nextKyc ? 'KYC Approved' : 'KYC Revoked');
      emitNotice(
        'success',
        nextKyc
          ? `Approved KYC verification for ${driver.full_name}.`
          : `Revoked KYC verification for ${driver.full_name}.`
      );
    } catch (err) {
      setAppStatus('error', 'KYC update failed');
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update driver KYC.'
      );
    } finally {
      setTogglingDriverKycId(null);
    }
  };

  // FLEET ACTION 2: Add Vehicle
  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlateNumber.trim() || !newVehicleTypeId) {
      emitNotice('error', 'Plate number and vehicle type are required.');
      return;
    }

    setIsSavingVehicle(true);
    setAppStatus('saving', 'Adding vehicle');
    try {
      const { error } = await supabase.from('vehicles').insert({
        plate_number: newPlateNumber.trim().toUpperCase(),
        model_name: newModelName.trim() || null,
        rc_number: newRcNumber.trim() || null,
        vehicle_type_id: newVehicleTypeId,
        driver_id: newVehicleDriverId || null,
        is_available: true,
      });

      if (error) throw new Error(error.message);

      setNewPlateNumber('');
      setNewModelName('');
      setNewRcNumber('');
      setNewVehicleDriverId('');
      setAppStatus('success', 'Vehicle added');
      emitNotice('success', 'Registered vehicle in the Vehicle Pool.');
      await loadConsoleData();
    } catch (err) {
      setAppStatus('error', 'Save failed');
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to register vehicle.'
      );
    } finally {
      setIsSavingVehicle(false);
    }
  };

  // FLEET ACTION 3: Toggle Vehicle Availability
  const handleToggleVehicleAvailability = async (vehicle: VehicleRecord) => {
    setTogglingVehicleId(vehicle.id);
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({ is_available: !vehicle.is_available })
        .eq('id', vehicle.id);

      if (error) throw new Error(error.message);

      setVehicles((prev) =>
        prev.map((v) =>
          v.id === vehicle.id ? { ...v, is_available: !v.is_available } : v
        )
      );
      setAppStatus('success', 'Availability updated');
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to toggle availability.'
      );
    } finally {
      setTogglingVehicleId(null);
    }
  };

  return (
    <div data-testid="pick-n-drop-console" className="space-y-4 min-w-0 max-w-full overflow-x-clip">
      {/* Header & Sub-Tab Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-[var(--ps-text)]">
            <Truck className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>Pick N Drop Escrow, Dispatch &amp; Vehicle Pool</span>
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Verify manual UPI UTR payments, assign drivers, verify asymmetric OTP handovers with private POD photos, and release escrow settlements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
          <div className="flex max-w-full overflow-x-auto no-scrollbar rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-1">
            <button
              type="button"
              data-testid="pnd-console-subtab-dispatch"
              onClick={() => setSubTab('dispatch')}
              className={`inline-flex h-8 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                subTab === 'dispatch'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Package className="h-3.5 w-3.5 shrink-0" />
              Escrow &amp; Dispatch ({orders.length})
            </button>
            <button
              type="button"
              data-testid="pnd-console-subtab-fleet"
              onClick={() => setSubTab('fleet')}
              className={`inline-flex h-8 shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                subTab === 'fleet'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Users className="h-3.5 w-3.5 shrink-0" />
              Fleet ({drivers.length} / {vehicles.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => void loadConsoleData()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            Sync
          </button>
        </div>
      </div>

      {consoleBanner && (
        <div
          role="status"
          className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            consoleBanner.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : consoleBanner.type === 'error'
                ? 'border-rose-500/35 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                : 'border-blue-500/35 bg-blue-500/10 text-blue-800 dark:text-blue-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {consoleBanner.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            {consoleBanner.text}
          </span>
          <button
            type="button"
            onClick={() => setConsoleBanner(null)}
            className="rounded p-1 hover:bg-black/5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* SUB-TAB 1: ESCROW & DISPATCH QUEUE */}
      {subTab === 'dispatch' && (
        <div className="space-y-3 min-w-0">
          <WorkspaceTableToolbar
            searchQuery={dispatchSearch}
            onSearchChange={setDispatchSearch}
            searchPlaceholder="Search order code, address, sender, phone, UTR…"
            filteredCount={filteredOrders.length}
            totalCount={orders.length}
            countLabel="orders"
            hasActiveFilters={hasDispatchFilters}
            onResetFilters={() => {
              setDispatchSearch('');
              setDispatchFilter('all');
              setServiceModeFilter('all');
            }}
          >
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: 'all', label: 'All Modes' },
                  { id: 'parcel', label: 'Parcel' },
                  { id: 'passenger', label: 'Passenger' },
                  { id: 'gas', label: 'Gas' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setServiceModeFilter(m.id)}
                  className={`inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold transition-colors ${
                    serviceModeFilter === m.id
                      ? 'bg-[var(--ps-text)] text-[var(--ps-bg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </WorkspaceTableToolbar>

          {/* Compact Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${orders.length})` },
                {
                  id: 'payment_submitted',
                  label: `Verify UPI (${counts.paymentSubmitted})`,
                },
                {
                  id: 'escrow_held',
                  label: `Assign Driver (${counts.escrowHeld})`,
                },
                {
                  id: 'in_progress',
                  label: `Active Transit (${counts.inProgress})`,
                },
                {
                  id: 'delivered_pending_confirm',
                  label: `Confirm & Payout (${counts.pendingConfirm})`,
                },
                { id: 'completed', label: 'Completed' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setDispatchFilter(pill.id)}
                className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                  dispatchFilter === pill.id
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-12 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
              <span>Loading Pick N Drop queue…</span>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center text-xs text-[var(--ps-text-muted)] space-y-2">
              <p>No delivery orders match this search or filter right now.</p>
              {hasDispatchFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setDispatchSearch('');
                    setDispatchFilter('all');
                    setServiceModeFilter('all');
                  }}
                  className="inline-flex h-8 items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <ResponsiveTableScroll
              minWidthClass="min-w-[660px]"
              wrapperClassName="border-none bg-transparent shadow-none"
              swipeHintLabel="Swipe ↔ to view escrow & OTP handover actions"
            >
            <div className="space-y-3">
              {filteredOrders.map((order) => {
                const statusMeta =
                  DELIVERY_STATUS_META[order.status] ||
                  DELIVERY_STATUS_META.awaiting_payment;
                const latestUpiTx = order.transactions?.find(
                  (t) => t.tx_type === 'upi_payment'
                );
                const isBusy = busyOrderId === order.id;

                const nextOtpStage: 'pickup' | 'dropoff' | 'return' | null =
                  order.status === 'driver_assigned'
                    ? 'pickup'
                    : order.status === 'picked_up' ||
                        order.status === 'in_transit'
                      ? 'dropoff'
                      : order.status === 'return_in_transit'
                        ? 'return'
                        : null;

                return (
                  <div
                    key={order.id}
                    data-testid={`console-order-${order.order_code}`}
                    className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
                  >
                    {/* Top Row */}
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--ps-border)] pb-2.5">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-[var(--ps-text)]">
                            {order.order_code}
                          </span>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                          <span className="rounded-md bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                            {order.service_mode
                              ? `${SERVICE_MODE_META[order.service_mode]?.shortLabel || order.service_mode} • `
                              : ''}
                            {order.trip_type === 'two_way'
                              ? 'Two-Way Return'
                              : 'One-Way'}
                            {order.service_mode === 'passenger'
                              ? ` • ${order.passenger_count || 1} Pax`
                              : order.service_mode === 'gas'
                                ? ` • ${order.cylinder_count || 1} Cyl`
                                : order.container_type
                                  ? ` • ${CONTAINER_LABELS[order.container_type]}`
                                  : ''}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)]">
                          {order.vehicle_type?.name || 'Vehicle'} •{' '}
                          {order.distance_km} km • Placed{' '}
                          {new Date(order.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-mono text-base font-extrabold text-[var(--ps-text)]">
                          ₹{order.quoted_fare_inr.toFixed(2)}
                        </div>
                        {order.declared_value_inr > 0 && (
                          <div className="text-[10px] text-[var(--ps-text-muted)]">
                            Declared: ₹{order.declared_value_inr}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Route & Contacts */}
                    <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 space-y-1">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <div>
                            <div className="font-semibold text-[var(--ps-text)]">
                              A: {order.pickup_address}
                            </div>
                            <div className="text-[11px] text-[var(--ps-text-muted)]">
                              Sender: {order.sender_phone}
                              {order.pickup_landmark
                                ? ` • ${order.pickup_landmark}`
                                : ''}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 space-y-1">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
                          <div>
                            <div className="font-semibold text-[var(--ps-text)]">
                              B: {order.dropoff_address}
                            </div>
                            <div className="text-[11px] text-[var(--ps-text-muted)]">
                              {order.recipient_name
                                ? `Recipient: ${order.recipient_name} (${order.recipient_phone || order.sender_phone})`
                                : `Contact: ${order.sender_phone}`}
                              {order.dropoff_landmark
                                ? ` • ${order.dropoff_landmark}`
                                : ''}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {order.instructions && (
                      <div className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-[11px] text-[var(--ps-text-muted)]">
                        <strong className="text-[var(--ps-text)]">
                          Instructions &amp; Landmarks:
                        </strong>{' '}
                        {order.instructions}
                      </div>
                    )}

                    {/* STEP A: Verify UPI Payment & Hold Escrow */}
                    {isMediator && order.status === 'payment_submitted' && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
                        <div className="space-y-0.5 text-xs">
                          <div className="font-bold text-sky-800 dark:text-sky-200">
                            Submitted UPI UTR:{' '}
                            <span className="font-mono">
                              {latestUpiTx?.upi_utr_ref || 'Not recorded'}
                            </span>
                          </div>
                          {latestUpiTx?.payment_proof_path && (
                            <a
                              href={latestUpiTx.payment_proof_path}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-accent)] hover:underline"
                            >
                              <Eye className="h-3 w-3" />
                              View Payment Receipt Screenshot
                            </a>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={isBusy}
                          data-testid={`verify-upi-escrow-btn-${order.order_code}`}
                          onClick={() => void handleVerifyUpiAndHoldEscrow(order)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5" />
                          )}
                          Verify UPI &amp; Hold Escrow
                        </button>
                      </div>
                    )}

                    {/* STEP B: Assign Driver & Vehicle (CustomSelectModal) */}
                    {isMediator &&
                      (order.status === 'escrow_held' ||
                        order.status === 'driver_assigned') && (
                        <div className="space-y-2 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
                          <div className="text-xs font-bold text-indigo-800 dark:text-indigo-200">
                            {order.driver
                              ? `Assigned: ${order.driver.full_name} (${order.vehicle?.plate_number || 'No vehicle'}) — Reassign if needed`
                              : 'Assign Driver & Vehicle from Fleet Pool'}
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <CustomSelectModal
                              placeholder="Select Driver"
                              options={driverSelectOptions}
                              value={
                                assignDriverMap[order.id] ??
                                order.driver_id ??
                                ''
                              }
                              onChange={(val) =>
                                setAssignDriverMap((prev) => ({
                                  ...prev,
                                  [order.id]: val,
                                }))
                              }
                              testId={`assign-driver-select-${order.order_code}`}
                            />
                            <CustomSelectModal
                              placeholder="Select Vehicle"
                              options={vehicleSelectOptions}
                              value={
                                assignVehicleMap[order.id] ??
                                order.vehicle_id ??
                                ''
                              }
                              onChange={(val) =>
                                setAssignVehicleMap((prev) => ({
                                  ...prev,
                                  [order.id]: val,
                                }))
                              }
                              testId={`assign-vehicle-select-${order.order_code}`}
                            />
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleAssignDriverVehicle(order)
                              }
                              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                              {isBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <UserCheck className="h-4 w-4" />
                              )}
                              Assign Driver
                            </button>
                          </div>
                        </div>
                      )}

                    {/* STEP C: Driver Handover OTP Verification (+ Mandatory Private POD on Dropoff) */}
                    {nextOtpStage && (
                      <div className="space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-xs font-bold text-violet-800 dark:text-violet-200">
                            <KeyRound className="h-3.5 w-3.5" />
                            Driver Handover Verification —{' '}
                            {nextOtpStage.toUpperCase()} OTP
                          </span>
                          <span className="text-[10px] text-[var(--ps-text-muted)]">
                            5-attempt lockout enforced server-side
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={otpInputMap[order.id] || ''}
                            onChange={(e) =>
                              setOtpInputMap((prev) => ({
                                ...prev,
                                [order.id]: e.target.value.replace(/\D/g, ''),
                              }))
                            }
                            placeholder={`Enter 6-digit ${nextOtpStage} OTP`}
                            data-testid={`otp-verify-input-${order.order_code}`}
                            className="h-8 w-44 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tracking-widest text-[var(--ps-text)]"
                          />

                          {nextOtpStage === 'dropoff' &&
                            order.pod_required !== false && (
                              <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-violet-500/50 bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                                <Camera className="h-3.5 w-3.5 shrink-0" />
                                <span className="max-w-[160px] truncate">
                                  {podFileMap[order.id]?.name ||
                                    'Upload Mandatory POD Photo *'}
                                </span>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  capture="environment"
                                  className="hidden"
                                  onChange={(e) =>
                                    setPodFileMap((prev) => ({
                                      ...prev,
                                      [order.id]: e.target.files?.[0] || null,
                                    }))
                                  }
                                />
                              </label>
                            )}

                          <button
                            type="button"
                            disabled={isBusy}
                            data-testid={`otp-verify-btn-${order.order_code}`}
                            onClick={() =>
                              void handleVerifyStageOtp(order, nextOtpStage)
                            }
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            Verify {nextOtpStage} OTP
                          </button>
                        </div>
                      </div>
                    )}

                    {/* STEP D: Mediator Final Confirmation & 5m Signed POD Inspection */}
                    {isMediator &&
                      order.status === 'delivered_pending_confirm' && (
                        <div className="space-y-2.5 rounded-xl border border-teal-500/35 bg-teal-500/5 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-bold text-teal-800 dark:text-teal-200">
                              Delivered — Inspect Private POD &amp; Release
                              Escrow Payout
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {order.pod_storage_path && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleInspectSignedPod(order)
                                  }
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-teal-500/40 bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-teal-700 dark:text-teal-300"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  View POD (5m Signed URL)
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isBusy}
                                data-testid={`confirm-release-payout-btn-${order.order_code}`}
                                onClick={() =>
                                  void handleConfirmCompletionAndReleasePayout(
                                    order
                                  )
                                }
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                              >
                                {isBusy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                )}
                                Confirm Completion &amp; Release Payout
                              </button>
                            </div>
                          </div>

                          {signedPodUrls[order.id] && (
                            <div className="overflow-hidden rounded-xl border border-[var(--ps-border)] bg-black/5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={signedPodUrls[order.id]}
                                alt={`Private POD for ${order.order_code}`}
                                className="max-h-64 w-full object-contain"
                              />
                            </div>
                          )}
                        </div>
                      )}

                    {/* Completed 48h POD Auto-Purge Notice */}
                    {order.status === 'completed' && order.pod_purge_at && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-800 dark:text-emerald-200">
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {order.pod_storage_path
                            ? `Escrow settled • Private POD auto-purges on ${new Date(order.pod_purge_at).toLocaleString()}`
                            : 'Escrow settled • Private POD has been auto-purged for privacy.'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </ResponsiveTableScroll>
          )}
        </div>
      )}

      {/* SUB-TAB 2: FLEET MANAGEMENT (DRIVERS & VEHICLES) */}
      {subTab === 'fleet' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 min-w-0">
          {/* Drivers Management */}
          <section className="space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 min-w-0">
            <div>
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Registered Drivers ({drivers.length})
              </h3>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Add verified local Churachandpur drivers to the standalone Vehicle Pool.
              </p>
            </div>

            {isMediator && (
              <form
                onSubmit={handleAddDriver}
                className="space-y-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    required
                    value={newDriverName}
                    onChange={(e) => setNewDriverName(e.target.value)}
                    placeholder="Driver Full Name *"
                    className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                  />
                  <input
                    type="tel"
                    required
                    value={newDriverPhone}
                    onChange={(e) => setNewDriverPhone(e.target.value)}
                    placeholder="Phone (+91...) *"
                    className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                  />
                  <input
                    type="text"
                    required
                    value={newDriverLicense}
                    onChange={(e) => setNewDriverLicense(e.target.value)}
                    placeholder="Driving License No. *"
                    className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                  />
                  <input
                    type="text"
                    value={newDriverProfileId}
                    onChange={(e) => setNewDriverProfileId(e.target.value)}
                    placeholder="Linked User UUID (optional)"
                    className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 font-mono text-[11px] text-[var(--ps-text)]"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-[var(--ps-text)]">
                    <input
                      type="checkbox"
                      checked={newDriverKyc}
                      onChange={(e) => setNewDriverKyc(e.target.checked)}
                      className="h-4 w-4 accent-emerald-600"
                    />
                    KYC Verified
                  </label>
                  <button
                    type="submit"
                    disabled={isSavingDriver}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] disabled:opacity-60"
                  >
                    {isSavingDriver ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add Driver
                  </button>
                </div>
              </form>
            )}

            {drivers.length > 0 && (
              <WorkspaceTableToolbar
                searchQuery={driverSearch}
                onSearchChange={setDriverSearch}
                searchPlaceholder="Search driver name, phone, DL…"
                filteredCount={filteredDrivers.length}
                totalCount={drivers.length}
                countLabel="drivers"
                hasActiveFilters={hasDriverFilters}
                onResetFilters={() => {
                  setDriverSearch('');
                  setDriverKycFilter('all');
                }}
              >
                <div className="flex items-center gap-1">
                  {(['all', 'verified', 'pending'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setDriverKycFilter(st)}
                      className={`inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold capitalize ${
                        driverKycFilter === st
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {st === 'all' ? 'All' : st === 'verified' ? 'KYC OK' : 'Pending'}
                    </button>
                  ))}
                </div>
              </WorkspaceTableToolbar>
            )}

            <ResponsiveTableScroll
              minWidthClass="min-w-[440px]"
              wrapperClassName="border-none bg-transparent shadow-none"
              swipeHintLabel="Swipe ↔ to manage driver KYC"
            >
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {drivers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] p-4 text-center text-xs text-[var(--ps-text-muted)]">
                  No drivers registered yet.
                </div>
              ) : filteredDrivers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] p-4 text-center text-xs text-[var(--ps-text-muted)] space-y-2">
                  <p>No drivers match your search or KYC filter.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setDriverSearch('');
                      setDriverKycFilter('all');
                    }}
                    className="inline-flex h-7 items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)]"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                filteredDrivers.map((driver) => (
                  <div
                    key={driver.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--ps-text)]">
                        {driver.full_name}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--ps-text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {driver.phone}
                        </span>
                        <span>DL: {driver.license_no}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          driver.kyc_verified
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {driver.kyc_verified ? 'KYC Verified' : 'Pending KYC'}
                      </span>
                      {isMediator && (
                        <button
                          type="button"
                          disabled={togglingDriverKycId === driver.id}
                          onClick={() => void handleToggleDriverKyc(driver)}
                          data-testid={`driver-kyc-toggle-${driver.id}`}
                          className={`h-7 rounded-lg border px-2 text-[10px] font-bold transition-colors disabled:opacity-60 ${
                            driver.kyc_verified
                              ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20'
                              : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25'
                          }`}
                        >
                          {togglingDriverKycId === driver.id
                            ? 'Saving…'
                            : driver.kyc_verified
                              ? 'Revoke'
                              : 'Approve'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            </ResponsiveTableScroll>
          </section>

          {/* Vehicles Management */}
          <section className="space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 min-w-0">
            <div>
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Vehicle Pool ({vehicles.length})
              </h3>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Manage Two-Wheelers, E-Rickshaws, Mini Vans, and Pickup Trucks with live availability toggles.
              </p>
            </div>

            {isMediator && (
              <form
                onSubmit={handleAddVehicle}
                className="space-y-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    required
                    value={newPlateNumber}
                    onChange={(e) => setNewPlateNumber(e.target.value)}
                    placeholder="Plate No. (e.g. MN02A1234) *"
                    className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 font-mono text-xs uppercase text-[var(--ps-text)]"
                  />
                  <input
                    type="text"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder="Model (e.g. Bolero Pickup)"
                    className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                  />
                  <CustomSelectModal
                    placeholder="Vehicle Type *"
                    options={vehicleTypeSelectOptions}
                    value={newVehicleTypeId}
                    onChange={setNewVehicleTypeId}
                    testId="fleet-vehicle-type-select"
                  />
                  <CustomSelectModal
                    placeholder="Assign Default Driver (opt.)"
                    options={driverSelectOptions}
                    value={newVehicleDriverId}
                    onChange={setNewVehicleDriverId}
                    testId="fleet-vehicle-driver-select"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={newRcNumber}
                    onChange={(e) => setNewRcNumber(e.target.value)}
                    placeholder="RC Number (optional)"
                    className="h-8 flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                  />
                  <button
                    type="submit"
                    disabled={isSavingVehicle}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] disabled:opacity-60"
                  >
                    {isSavingVehicle ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Add Vehicle
                  </button>
                </div>
              </form>
            )}

            {vehicles.length > 0 && (
              <WorkspaceTableToolbar
                searchQuery={vehicleSearch}
                onSearchChange={setVehicleSearch}
                searchPlaceholder="Search plate, model, type, driver…"
                filteredCount={filteredVehicles.length}
                totalCount={vehicles.length}
                countLabel="vehicles"
                hasActiveFilters={hasVehicleFilters}
                onResetFilters={() => {
                  setVehicleSearch('');
                  setVehicleAvailFilter('all');
                }}
              >
                <div className="flex items-center gap-1">
                  {(['all', 'available', 'unavailable'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setVehicleAvailFilter(st)}
                      className={`inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold capitalize ${
                        vehicleAvailFilter === st
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {st === 'all' ? 'All' : st === 'available' ? 'Avail' : 'Busy'}
                    </button>
                  ))}
                </div>
              </WorkspaceTableToolbar>
            )}

            <ResponsiveTableScroll
              minWidthClass="min-w-[440px]"
              wrapperClassName="border-none bg-transparent shadow-none"
              swipeHintLabel="Swipe ↔ to toggle vehicle availability"
            >
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {vehicles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] p-4 text-center text-xs text-[var(--ps-text-muted)]">
                  No vehicles registered yet.
                </div>
              ) : filteredVehicles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] p-4 text-center text-xs text-[var(--ps-text-muted)] space-y-2">
                  <p>No vehicles match your search or availability filter.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setVehicleSearch('');
                      setVehicleAvailFilter('all');
                    }}
                    className="inline-flex h-7 items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)]"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                filteredVehicles.map((vehicle) => {
                  const vt = vehicleTypes.find(
                    (t) => t.id === vehicle.vehicle_type_id
                  );
                  const assignedDr = drivers.find(
                    (d) => d.id === vehicle.driver_id
                  );
                  return (
                    <div
                      key={vehicle.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-[var(--ps-text)]">
                            {vehicle.plate_number}
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)]">
                            {vehicle.model_name || vt?.name}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)]">
                          {vt?.name || 'Vehicle'} • Driver:{' '}
                          {assignedDr?.full_name || 'Unassigned'}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={togglingVehicleId === vehicle.id}
                        onClick={() =>
                          void handleToggleVehicleAvailability(vehicle)
                        }
                        className={`h-7 shrink-0 rounded-lg border px-2.5 text-[10px] font-bold transition-colors ${
                          vehicle.is_available
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'border-slate-400/40 bg-slate-500/10 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {togglingVehicleId === vehicle.id
                          ? 'Saving…'
                          : vehicle.is_available
                            ? 'Available'
                            : 'Unavailable'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            </ResponsiveTableScroll>
          </section>
        </div>
      )}
    </div>
  );
}

export default PickNDropConsole;

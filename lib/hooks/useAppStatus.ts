'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type AppStatusType =
  | 'idle'
  | 'updating_map'
  | 'locating'
  | 'routing'
  | 'fetching_listings'
  | 'loading_more'
  | 'saving'
  | 'uploading'
  | 'switching_role'
  | 'syncing'
  | 'syncing_prefs'
  | 'offline'
  | 'reconnecting'
  | 'success'
  | 'error';

export interface AppStatusSnapshot {
  status: AppStatusType;
  label: string;
}

export const APP_STATUS_LABELS: Record<AppStatusType, string> = {
  idle: '',
  updating_map: 'Updating map',
  locating: 'Locating',
  routing: 'Routing',
  fetching_listings: 'Loading listings',
  loading_more: 'Loading more',
  saving: 'Saving',
  uploading: 'Uploading',
  switching_role: 'Switching role',
  syncing: 'Syncing hub',
  syncing_prefs: 'Syncing prefs',
  offline: 'Offline',
  reconnecting: 'Reconnecting',
  success: 'Done',
  error: 'Error',
};

const TRANSIENT_LOADING_STATUSES = new Set<AppStatusType>([
  'updating_map',
  'locating',
  'routing',
  'fetching_listings',
  'loading_more',
  'saving',
  'uploading',
  'switching_role',
  'syncing',
  'syncing_prefs',
  'reconnecting',
]);

const SUCCESS_DISMISS_MS = 1500;
const ERROR_DISMISS_MS = 3000;
const SAFETY_TIMEOUT_MS = 10000;

const INITIAL_APP_STATUS_SNAPSHOT: AppStatusSnapshot = Object.freeze({
  status: 'idle',
  label: '',
});

const listeners = new Set<() => void>();
let currentSnapshot: AppStatusSnapshot = INITIAL_APP_STATUS_SNAPSHOT;
let activeTimer: ReturnType<typeof setTimeout> | null = null;
let networkSubscriberCount = 0;

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function clearActiveTimer() {
  if (activeTimer !== null) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
}

function commitSnapshot(next: AppStatusSnapshot) {
  if (
    currentSnapshot.status === next.status &&
    currentSnapshot.label === next.label
  ) {
    return;
  }
  currentSnapshot = next;
  notifyListeners();
}

export function setAppStatus(
  status: AppStatusType,
  customLabel?: string
): void {
  clearActiveTimer();

  if (status === 'idle') {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      commitSnapshot({
        status: 'offline',
        label: APP_STATUS_LABELS.offline,
      });
      return;
    }
    commitSnapshot(INITIAL_APP_STATUS_SNAPSHOT);
    return;
  }

  const label =
    typeof customLabel === 'string' && customLabel.trim().length > 0
      ? customLabel.trim()
      : APP_STATUS_LABELS[status];

  commitSnapshot({ status, label });

  if (status === 'success') {
    activeTimer = setTimeout(() => {
      activeTimer = null;
      clearAppStatus();
    }, SUCCESS_DISMISS_MS);
  } else if (status === 'error') {
    activeTimer = setTimeout(() => {
      activeTimer = null;
      clearAppStatus();
    }, ERROR_DISMISS_MS);
  } else if (TRANSIENT_LOADING_STATUSES.has(status)) {
    activeTimer = setTimeout(() => {
      activeTimer = null;
      clearAppStatus();
    }, SAFETY_TIMEOUT_MS);
  }
}

export function clearAppStatus(): void {
  clearActiveTimer();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    commitSnapshot({
      status: 'offline',
      label: APP_STATUS_LABELS.offline,
    });
    return;
  }
  commitSnapshot(INITIAL_APP_STATUS_SNAPSHOT);
}

function handleWindowOffline() {
  setAppStatus('offline');
}

function handleWindowOnline() {
  if (
    currentSnapshot.status === 'offline' ||
    currentSnapshot.status === 'reconnecting'
  ) {
    clearActiveTimer();
    commitSnapshot(INITIAL_APP_STATUS_SNAPSHOT);
  }
}

function subscribeAppStatus(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getAppStatusSnapshot(): AppStatusSnapshot {
  return currentSnapshot;
}

function getAppStatusServerSnapshot(): AppStatusSnapshot {
  return INITIAL_APP_STATUS_SNAPSHOT;
}

export interface UseAppStatusResult {
  status: AppStatusType;
  label: string;
  setStatus: (status: AppStatusType, customLabel?: string) => void;
  clearStatus: () => void;
}

export function useAppStatus(): UseAppStatusResult {
  const snapshot = useSyncExternalStore(
    subscribeAppStatus,
    getAppStatusSnapshot,
    getAppStatusServerSnapshot
  );

  // Register global browser online/offline listeners once across all mounted consumers
  useEffect(() => {
    if (typeof window === 'undefined') return;
    networkSubscriberCount += 1;
    if (networkSubscriberCount === 1) {
      window.addEventListener('offline', handleWindowOffline);
      window.addEventListener('online', handleWindowOnline);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setAppStatus('offline');
      }
    }

    return () => {
      networkSubscriberCount = Math.max(0, networkSubscriberCount - 1);
      if (networkSubscriberCount === 0) {
        window.removeEventListener('offline', handleWindowOffline);
        window.removeEventListener('online', handleWindowOnline);
      }
    };
  }, []);

  const setStatus = useCallback(
    (nextStatus: AppStatusType, customLabel?: string) => {
      setAppStatus(nextStatus, customLabel);
    },
    []
  );

  const clearStatus = useCallback(() => {
    clearAppStatus();
  }, []);

  return {
    status: snapshot.status,
    label: snapshot.label,
    setStatus,
    clearStatus,
  };
}

export default useAppStatus;

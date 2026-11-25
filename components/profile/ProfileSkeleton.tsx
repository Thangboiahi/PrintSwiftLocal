import React from 'react';

export function ProfileSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading profile"
      data-testid="profile-skeleton"
      className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5"
    >
      {/* Top Identity Skeleton */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="dd-shimmer h-20 w-20 rounded-full shrink-0" />
        <div className="flex-1 space-y-2.5">
          <div className="dd-shimmer h-6 w-48 rounded-lg" />
          <div className="dd-shimmer h-4 w-32 rounded-md" />
          <div className="dd-shimmer h-4 w-64 rounded-md" />
        </div>
        <div className="dd-shimmer h-11 w-32 rounded-xl shrink-0" />
      </div>

      {/* Workspace Hats & Quick Actions Grid Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
        <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
        <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
        <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
      </div>

      <span className="sr-only">Loading profile...</span>
    </div>
  );
}

export default ProfileSkeleton;

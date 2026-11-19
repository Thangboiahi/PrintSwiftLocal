import React from 'react';

export function ProfileSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading profile"
      data-testid="profile-skeleton"
      className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 animate-pulse"
    >
      {/* Top Identity Skeleton: w-24 h-24 rounded-full avatar + two text lines for name/role */}
      <div className="flex flex-col items-center text-center pb-8 border-b border-slate-100 dark:border-slate-800">
        <div className="w-24 h-24 rounded-full bg-slate-200 dark:bg-slate-800" />
        <div className="w-40 h-6 bg-slate-200 dark:bg-slate-800 rounded mt-4" />
        <div className="w-24 h-4 bg-slate-200 dark:bg-slate-800 rounded mt-2" />
      </div>

      {/* Grid Skeleton: four h-20 skeleton cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
        <div className="h-20 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-20 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-20 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-20 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </div>

      <span className="sr-only">Loading profile...</span>
    </div>
  );
}

export default ProfileSkeleton;

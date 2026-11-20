export default function VehicleDetailLoading() {
  return (
    <div className="min-h-dvh bg-[var(--ps-bg)] px-3 sm:px-5 pt-4 pb-20">
      <div className="mx-auto max-w-6xl space-y-4 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-8 w-36 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)]" />
          <div className="flex gap-2">
            <div className="h-8 w-20 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)]" />
            <div className="h-8 w-24 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)]" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 space-y-4">
            <div className="aspect-[16/10] w-full rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)]" />
            <div className="h-44 w-full rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)]" />
            <div className="h-40 w-full rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)]" />
          </div>
          <div className="lg:col-span-5">
            <div className="h-[520px] w-full rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)]" />
          </div>
        </div>
      </div>
    </div>
  );
}

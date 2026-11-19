'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BadgeCheck,
  Bike,
  Building2,
  Car,
  Compass,
  Flame,
  Globe,
  KeyRound,
  Languages,
  MapPin,
  Megaphone,
  Navigation,
  Package,
  Palette,
  Pin,
  PlayCircle,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sliders,
  Sparkles,
  Star,
  Store,
  Truck,
  Users,
  Wallet,
  Wifi,
} from 'lucide-react';
import type {
  DeliveryServiceMode,
  VehicleTypeItem,
} from '@/lib/pick-n-drop/types';

export interface LandingListingPreview {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  locality: string;
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string | null;
}

export interface LandingMarketPreview {
  id: string;
  title: string;
  price: number;
  unit: string;
  category: string;
  inStock: boolean;
  thumbnailUrl: string | null;
  shopName: string;
  shopLocality: string;
}

export interface LandingBulletinPreview {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  isPinned: boolean;
  hasVideo: boolean;
  authorName: string;
  createdAt: string;
}

export interface LandingSnapshot {
  counts: {
    listings: number;
    marketplaceProducts: number;
    bulletins: number;
    vehicleTypes: number;
  };
  featuredListings: LandingListingPreview[];
  latestProducts: LandingMarketPreview[];
  latestBulletins: LandingBulletinPreview[];
  vehicleTypes: VehicleTypeItem[];
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const SECTION_VIEWPORT = { once: true, amount: 0.16 } as const;

const CONTAINER_VARIANTS = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.04,
    },
  },
};

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.42,
      ease: EASE_OUT_EXPO,
    },
  },
};

const POPULAR_LOCALITIES = [
  'New Lamka',
  'Tuibong',
  'Rengkai',
  'Zenhang Lamka',
  'Central Lamka',
];

const PICK_N_DROP_MODES: {
  id: DeliveryServiceMode;
  label: string;
  shortDesc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'parcel',
    label: 'Parcel',
    shortDesc: 'Documents, shop orders, boxes & bulk sacks across town',
    icon: Package,
  },
  {
    id: 'passenger',
    label: 'Ride (Taxi)',
    shortDesc: 'Point-to-point passenger rides with transparent local fares',
    icon: Car,
  },
  {
    id: 'gas',
    label: 'LPG Gas',
    shortDesc: 'Safe domestic cylinder pickup, refill & return to doorstep',
    icon: Flame,
  },
];

function formatCategoryLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatShortDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Recent';
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
    }).format(date);
  } catch {
    return 'Recent';
  }
}

function renderVehicleIcon(slug: string, className = 'h-4 w-4') {
  const s = slug.toLowerCase();
  if (s.includes('scooty') || s.includes('bike') || s.includes('cycle')) {
    return <Bike className={className} />;
  }
  if (s.includes('pickup') || s.includes('bolero') || s.includes('van')) {
    return <Truck className={className} />;
  }
  return <Car className={className} />;
}

interface ResilientThumbProps {
  src: string | null;
  alt: string;
  fallbackIcon: React.ReactNode;
  className?: string;
}

function ResilientThumb({
  src,
  alt,
  fallbackIcon,
  className = 'h-32 w-full',
}: ResilientThumbProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`relative flex items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 ${className}`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 text-theme-primary shadow-xs">
          {fallbackIcon}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden bg-slate-100 dark:bg-slate-800 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
    </div>
  );
}

export default function LandingClient({
  snapshot,
}: {
  snapshot: LandingSnapshot;
}) {
  const router = useRouter();
  const [heroQuery, setHeroQuery] = useState('');
  const [activePndMode, setActivePndMode] =
    useState<DeliveryServiceMode>('parcel');

  const filteredVehicles = useMemo(() => {
    const matches = snapshot.vehicleTypes.filter((vehicle) =>
      Array.isArray(vehicle.supported_modes)
        ? vehicle.supported_modes.includes(activePndMode)
        : true
    );
    return matches.length > 0 ? matches : snapshot.vehicleTypes.slice(0, 4);
  }, [snapshot.vehicleTypes, activePndMode]);

  const activeModeMeta =
    PICK_N_DROP_MODES.find((m) => m.id === activePndMode) ??
    PICK_N_DROP_MODES[0];

  const handleHeroSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = heroQuery.trim();
    if (trimmed) {
      router.push(`/explore?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push('/explore');
    }
  };

  const liveStats = [
    {
      label: 'Verified Places',
      value: snapshot.counts.listings,
      suffix: '+',
      icon: MapPin,
      href: '/explore',
    },
    {
      label: 'Market Items',
      value: snapshot.counts.marketplaceProducts,
      suffix: '',
      icon: ShoppingBag,
      href: '/marketplace',
    },
    {
      label: 'Active Bulletins',
      value: snapshot.counts.bulletins,
      suffix: '',
      icon: Megaphone,
      href: '/bulletin',
    },
    {
      label: 'Fleet Types',
      value: snapshot.counts.vehicleTypes,
      suffix: '',
      icon: Truck,
      href: '/explore?mode=pick_n_drop',
    },
  ];

  return (
    <div className="w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* ================================================================= */}
      {/* 1. HERO SECTION (ABOVE THE FOLD)                                   */}
      {/* ================================================================= */}
      <section className="relative overflow-hidden border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950">
        {/* Subtle low-opacity ambient radial mesh glow — never a solid color wall */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <motion.div
            animate={{
              x: [0, 18, -10, 0],
              y: [0, -14, 10, 0],
              opacity: [0.7, 1, 0.7],
            }}
            transition={{
              duration: 14,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute -top-24 left-1/4 h-72 w-72 sm:h-96 sm:w-96 rounded-full bg-theme-primary/[0.06] dark:bg-theme-primary/[0.12] blur-3xl"
          />
          <motion.div
            animate={{
              x: [0, -20, 12, 0],
              y: [0, 16, -12, 0],
              opacity: [0.6, 0.95, 0.6],
            }}
            transition={{
              duration: 18,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute -bottom-28 right-1/5 h-72 w-72 sm:h-96 sm:w-96 rounded-full bg-theme-accent/[0.06] dark:bg-theme-accent/[0.10] blur-3xl"
          />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-8 sm:px-6 sm:pt-10 sm:pb-12 lg:px-8">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={CONTAINER_VARIANTS}
            className="mx-auto max-w-3xl text-center"
          >
            {/* Live District Status Pill */}
            <motion.div
              variants={ITEM_VARIANTS}
              className="mb-4 flex justify-center"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200 shadow-xs">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span>
                  Churachandpur District • Live Directory &amp; Logistics
                </span>
              </div>
            </motion.div>

            {/* Editorial Display Headline */}
            <motion.h1
              variants={ITEM_VARIANTS}
              className="text-balance text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-5xl sm:leading-[1.08]"
            >
              Discover, trade, and move across{' '}
              <span className="text-theme-primary">Churachandpur</span>.
            </motion.h1>

            <motion.p
              variants={ITEM_VARIANTS}
              className="mx-auto mt-3 max-w-2xl text-pretty text-xs leading-relaxed text-slate-600 dark:text-slate-400 sm:text-sm"
            >
              One fast local platform uniting interactive neighborhood maps,
              verified shop catalogues, community notices, and escrow-backed
              Pick N Drop delivery.
            </motion.p>

            {/* Interactive Quick-Search Form */}
            <motion.form
              variants={ITEM_VARIANTS}
              onSubmit={handleHeroSearch}
              className="mx-auto mt-5 flex max-w-xl items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-sm focus-within:border-theme-primary/60 focus-within:ring-2 focus-within:ring-theme-primary/20 transition-all"
            >
              <div className="flex flex-1 items-center gap-2 pl-2">
                <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  value={heroQuery}
                  onChange={(e) => setHeroQuery(e.target.value)}
                  placeholder="Search shops, pharmacies, Tuibong, New Lamka..."
                  aria-label="Search Churachandpur directory"
                  className="h-8 w-full bg-transparent text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-theme-primary px-3.5 text-xs font-semibold text-[hsl(var(--color-primary-foreground))] shadow-xs transition-opacity hover:opacity-90 active:scale-[0.98]"
              >
                <span>Search</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </motion.form>

            {/* Quick-Action Pills */}
            <motion.div
              variants={ITEM_VARIANTS}
              className="mt-3.5 flex flex-wrap items-center justify-center gap-2"
            >
              <Link
                href="/explore"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Compass className="h-3.5 w-3.5 text-theme-primary" />
                <span>Explore Map</span>
              </Link>
              <Link
                href="/explore?mode=pick_n_drop"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Truck className="h-3.5 w-3.5 text-theme-primary" />
                <span>Pick N Drop</span>
              </Link>
              <Link
                href="/marketplace"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <ShoppingBag className="h-3.5 w-3.5 text-theme-primary" />
                <span>Marketplace</span>
              </Link>
              <Link
                href="/bulletin"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Megaphone className="h-3.5 w-3.5 text-theme-primary" />
                <span>Bulletin</span>
              </Link>
            </motion.div>
          </motion.div>

          {/* Animated Live Stats Bar */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={CONTAINER_VARIANTS}
            className="mt-7 grid grid-cols-2 gap-2.5 sm:mt-9 lg:grid-cols-4"
          >
            {liveStats.map((stat) => {
              const Icon = stat.icon;
              return (
                <motion.div key={stat.label} variants={ITEM_VARIANTS}>
                  <Link
                    href={stat.href}
                    className="group flex items-center justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-3.5 py-2.5 shadow-sm transition-all hover:border-theme-primary/40"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {stat.label}
                      </p>
                      <p className="mt-0.5 text-lg font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white sm:text-xl">
                        {stat.value.toLocaleString('en-IN')}
                        {stat.suffix}
                      </p>
                    </div>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary transition-transform duration-200 group-hover:scale-105">
                      <Icon className="h-4 w-4" />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 2. 4-PILLAR ASYMMETRIC BENTO FEATURE GRID                          */}
      {/* ================================================================= */}
      <section className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Core Platform
              </p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                Four pillars built for everyday district life
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Real-time directory, commerce, announcements &amp; logistics
            </p>
          </motion.div>

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
            {/* Pillar 1: Interactive Discovery Map (7 cols) */}
            <motion.div
              variants={ITEM_VARIANTS}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="lg:col-span-7"
            >
              <Link
                href="/explore"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                      <Navigation className="h-4 w-4" />
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                      Interactive Discovery Map
                    </h3>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Explore clustered local shops, clinics, sports turfs, and
                      land plots with GPS routing, 360° panoramas, and drawn
                      real-estate polygons.
                    </p>
                  </div>
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200/80 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    <MapPin className="h-3 w-3 text-theme-primary" />
                    {snapshot.counts.listings} places
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    'Live Clusters',
                    '360° Views',
                    'Land Polygons',
                    'GPS Routing',
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300"
                    >
                      {item}
                    </div>
                  ))}
                </div>

                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary group-hover:underline">
                  <span>Open Interactive Map</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </motion.div>

            {/* Pillar 2: Local Marketplace (5 cols) */}
            <motion.div
              variants={ITEM_VARIANTS}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="lg:col-span-5"
            >
              <Link
                href="/marketplace"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                      <ShoppingBag className="h-4 w-4" />
                    </div>
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      {snapshot.counts.marketplaceProducts} items
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                    Local Marketplace
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Browse direct shop catalogues with real-time stock status,
                    transparent unit pricing, and one-tap WhatsApp enquiry.
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-medium">
                  {['Shop Catalogues', 'Live Stock', 'WhatsApp Direct'].map(
                    (tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-300"
                      >
                        {tag}
                      </span>
                    )
                  )}
                </div>

                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary group-hover:underline">
                  <span>Browse Marketplace</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </motion.div>

            {/* Pillar 3: Community Bulletin (5 cols) */}
            <motion.div
              variants={ITEM_VARIANTS}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="lg:col-span-5"
            >
              <Link
                href="/bulletin"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                      <Megaphone className="h-4 w-4" />
                    </div>
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      {snapshot.counts.bulletins} active
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                    Community Bulletin
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Accountable local announcements, verified job boards, event
                    flyers, and embedded YouTube video notices from subscribers.
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-medium">
                  {['Job Boards', 'Video Notices', 'Verified Authors'].map(
                    (tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-300"
                      >
                        {tag}
                      </span>
                    )
                  )}
                </div>

                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary group-hover:underline">
                  <span>Read District Bulletin</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </motion.div>

            {/* Pillar 4: Pick N Drop Logistics (7 cols) */}
            <motion.div
              variants={ITEM_VARIANTS}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="lg:col-span-7"
            >
              <Link
                href="/explore?mode=pick_n_drop"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary text-[hsl(var(--color-primary-foreground))]">
                      <Truck className="h-4 w-4" />
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                      Pick N Drop Logistics
                    </h3>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Pin Point A &amp; Point B right on the Explore map for
                      one-way or round-trip Parcel delivery, Taxi rides, or LPG
                      Gas cylinder refills with OTP-verified handovers.
                    </p>
                  </div>
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-md bg-theme-primary/10 px-2 py-1 text-[10px] font-semibold text-theme-primary">
                    Escrow Protected
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <Package className="h-3.5 w-3.5 text-theme-primary shrink-0" />
                    <span>Parcel</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <Car className="h-3.5 w-3.5 text-theme-primary shrink-0" />
                    <span>Taxi Ride</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <Flame className="h-3.5 w-3.5 text-theme-primary shrink-0" />
                    <span>LPG Gas</span>
                  </div>
                </div>

                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary group-hover:underline">
                  <span>Book Pick N Drop on Map</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ================================================================= */}
      {/* 3. INTERACTIVE PICK N DROP MODE SHOWCASE                           */}
      {/* ================================================================= */}
      <section className="border-y border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={SECTION_VIEWPORT}
            variants={CONTAINER_VARIANTS}
          >
            <motion.div
              variants={ITEM_VARIANTS}
              className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
            >
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                  Live Vehicle Pool &amp; Rates
                </p>
                <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                  Pick N Drop — Transparent Local Fares
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {activeModeMeta.shortDesc}
                </p>
              </div>

              {/* 3-Tab Mode Switcher */}
              <div
                role="tablist"
                aria-label="Pick N Drop Service Modes"
                className="inline-flex rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 p-1 shadow-xs"
              >
                {PICK_N_DROP_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const isActive = activePndMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActivePndMode(mode.id)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-theme-primary text-[hsl(var(--color-primary-foreground))] shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>

            {/* Animated Vehicle Cards Grid */}
            <div className="mt-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activePndMode}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {filteredVehicles.map((vehicle) => {
                    const oneWayStart = Math.round(vehicle.base_fare_inr);
                    const twoWayStart = Math.round(
                      vehicle.base_fare_inr * (vehicle.two_way_multiplier || 1.7)
                    );
                    return (
                      <div
                        key={vehicle.id}
                        className="flex flex-col justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm transition-colors hover:border-theme-primary/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                              {renderVehicleIcon(vehicle.slug, 'h-4 w-4')}
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                                {vehicle.name}
                              </h3>
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                                Up to {vehicle.max_weight_kg} kg • ₹
                                {vehicle.per_km_rate_inr}/km
                              </p>
                            </div>
                          </div>
                          {vehicle.max_dimensions && (
                            <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300">
                              {vehicle.max_dimensions}
                            </span>
                          )}
                        </div>

                        <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-slate-200/70 dark:border-slate-800 pt-3">
                          <div className="rounded-lg bg-slate-100/90 dark:bg-slate-800/80 px-2.5 py-1.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              One-Way Base
                            </p>
                            <p className="mt-0.5 text-sm font-extrabold tabular-nums text-slate-900 dark:text-white">
                              ₹{oneWayStart}
                            </p>
                          </div>
                          <div className="rounded-lg bg-theme-primary/10 px-2.5 py-1.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-theme-primary">
                              Two-Way Base
                            </p>
                            <p className="mt-0.5 text-sm font-extrabold tabular-nums text-theme-primary">
                              ₹{twoWayStart}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </div>

            <motion.div
              variants={ITEM_VARIANTS}
              className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3"
            >
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Live distance quotes calculate automatically when you drop
                Point A &amp; Point B pins on the map.
              </p>
              <Link
                href="/explore?mode=pick_n_drop"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-theme-primary px-3.5 text-xs font-semibold text-[hsl(var(--color-primary-foreground))] shadow-xs transition-opacity hover:opacity-90"
              >
                <span>Book on Explore Map</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 4. LIVE DISTRICT FEED PREVIEWS                                     */}
      {/* ================================================================= */}
      <section className="mx-auto max-w-6xl space-y-9 px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
        {/* 4A. Featured Places */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-3.5 flex items-center justify-between gap-2"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Live Directory
              </p>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                Featured Places
              </h2>
            </div>
            <Link
              href="/explore"
              className="inline-flex items-center gap-1 text-xs font-medium text-theme-primary hover:underline"
            >
              <span>View All</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>

          {snapshot.featuredListings.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-2 lg:grid-cols-4 md:overflow-visible md:pb-0">
              {snapshot.featuredListings.map((listing) => (
                <motion.div
                  key={listing.id}
                  variants={ITEM_VARIANTS}
                  className="w-[240px] shrink-0 snap-start md:w-auto"
                >
                  <Link
                    href={`/explore?q=${encodeURIComponent(listing.title)}`}
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-colors hover:border-theme-primary/40"
                  >
                    <ResilientThumb
                      src={listing.imageUrl}
                      alt={listing.title}
                      fallbackIcon={<Building2 className="h-4 w-4" />}
                      className="h-28 w-full"
                    />
                    <div className="flex flex-1 flex-col justify-between p-3">
                      <div>
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-theme-primary">
                            {formatCategoryLabel(listing.category)}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-bold tabular-nums text-slate-900 dark:text-white">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {listing.rating.toFixed(1)}
                          </span>
                        </div>
                        <h3 className="mt-1 line-clamp-1 text-xs font-semibold text-slate-900 dark:text-white sm:text-sm">
                          {listing.title}
                        </h3>
                      </div>
                      <p className="mt-2 flex items-center gap-1 truncate text-[11px] text-slate-600 dark:text-slate-400">
                        <MapPin className="h-3 w-3 shrink-0 text-theme-primary" />
                        <span className="truncate">{listing.locality}</span>
                      </p>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 text-center text-xs text-slate-600 dark:text-slate-400">
              Explore live verified businesses, services, and landmarks across
              Churachandpur on the interactive map.
            </div>
          )}
        </motion.div>

        {/* 4B. Fresh on Marketplace */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-3.5 flex items-center justify-between gap-2"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Direct Shop Catalogues
              </p>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                Fresh on Marketplace
              </h2>
            </div>
            <Link
              href="/marketplace"
              className="inline-flex items-center gap-1 text-xs font-medium text-theme-primary hover:underline"
            >
              <span>View All</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>

          {snapshot.latestProducts.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-2 lg:grid-cols-4 md:overflow-visible md:pb-0">
              {snapshot.latestProducts.map((product) => (
                <motion.div
                  key={product.id}
                  variants={ITEM_VARIANTS}
                  className="w-[240px] shrink-0 snap-start md:w-auto"
                >
                  <Link
                    href="/marketplace"
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-colors hover:border-theme-primary/40"
                  >
                    <ResilientThumb
                      src={product.thumbnailUrl}
                      alt={product.title}
                      fallbackIcon={<ShoppingBag className="h-4 w-4" />}
                      className="h-28 w-full"
                    />
                    <div className="flex flex-1 flex-col justify-between p-3">
                      <div>
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {product.category}
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
                              product.inStock
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {product.inStock ? 'In Stock' : 'Check Stock'}
                          </span>
                        </div>
                        <h3 className="mt-1 line-clamp-1 text-xs font-semibold text-slate-900 dark:text-white sm:text-sm">
                          {product.title}
                        </h3>
                        <p className="mt-1 text-sm font-extrabold tabular-nums text-theme-primary">
                          ₹{product.price.toLocaleString('en-IN')}
                          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
                            {' '}
                            / {product.unit}
                          </span>
                        </p>
                      </div>
                      <p className="mt-2 flex items-center gap-1 truncate text-[11px] text-slate-600 dark:text-slate-400">
                        <Store className="h-3 w-3 shrink-0 text-theme-primary" />
                        <span className="truncate">
                          {product.shopName} • {product.shopLocality}
                        </span>
                      </p>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 text-center text-xs text-slate-600 dark:text-slate-400">
              Local shop owners publish fresh stock and daily essentials on the
              PrintSwift Marketplace.
            </div>
          )}
        </motion.div>

        {/* 4C. Latest Bulletins */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-3.5 flex items-center justify-between gap-2"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Community Notices
              </p>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                Latest Bulletins
              </h2>
            </div>
            <Link
              href="/bulletin"
              className="inline-flex items-center gap-1 text-xs font-medium text-theme-primary hover:underline"
            >
              <span>View All</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>

          {snapshot.latestBulletins.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {snapshot.latestBulletins.map((bulletin) => (
                <motion.div key={bulletin.id} variants={ITEM_VARIANTS}>
                  <Link
                    href="/bulletin"
                    className="group flex h-full flex-col justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm transition-colors hover:border-theme-primary/40"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {bulletin.isPinned && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-theme-primary">
                              <Pin className="h-2.5 w-2.5" />
                              Pinned
                            </span>
                          )}
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {formatCategoryLabel(bulletin.category)}
                          </span>
                        </div>
                        {bulletin.hasVideo && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-theme-primary">
                            <PlayCircle className="h-3 w-3" />
                            Video
                          </span>
                        )}
                      </div>

                      <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900 dark:text-white group-hover:text-theme-primary transition-colors">
                        {bulletin.title}
                      </h3>
                      {bulletin.excerpt && (
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          {bulletin.excerpt}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-200/70 dark:border-slate-800 pt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="truncate font-medium">
                        {bulletin.authorName}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatShortDate(bulletin.createdAt)}
                      </span>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 text-center text-xs text-slate-600 dark:text-slate-400">
              Stay updated with verified job posts, district events, and
              official announcements on the Bulletin board.
            </div>
          )}
        </motion.div>
      </section>

      {/* ================================================================= */}
      {/* 5. TRUST, SECURITY & ESCROW BAND                                   */}
      {/* ================================================================= */}
      <section className="border-y border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-11 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={SECTION_VIEWPORT}
            variants={CONTAINER_VARIANTS}
          >
            <motion.div variants={ITEM_VARIANTS} className="mb-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Trust &amp; Accountability
              </p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                Built on verified handovers and transparent local escrow
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: BadgeCheck,
                  title: 'Verified Local Businesses',
                  desc: 'Listings tied to real Churachandpur owners, direct phone contacts, and accurate map pins.',
                },
                {
                  icon: KeyRound,
                  title: 'Asymmetric OTP Handovers',
                  desc: 'Distinct Pickup, Dropoff, and Return OTPs stay hidden from drivers until physical verification.',
                },
                {
                  icon: Wallet,
                  title: 'Mediator-Verified UPI Escrow',
                  desc: 'Prepaid UPI fares are verified by vetted dispatch bookers and released only on safe delivery.',
                },
                {
                  icon: ShieldCheck,
                  title: '48-Hour Private POD Audit',
                  desc: 'Proof-of-Delivery images live in private encrypted storage with automated 48-hour privacy purge.',
                },
              ].map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <motion.div
                    key={pillar.title}
                    variants={ITEM_VARIANTS}
                    className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm"
                  >
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-white">
                      {pillar.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {pillar.desc}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 6. PARTNER & ROLE FUNNELS ("BUILT FOR EVERY LOCAL ROLE")           */}
      {/* ================================================================= */}
      <section className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div variants={ITEM_VARIANTS} className="mb-5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
              Partner With PrintSwift Local
            </p>
            <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
              Built for every local role
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {[
              {
                icon: Store,
                badge: 'Businesses',
                title: 'Shop & Business Owners',
                desc: 'Claim your storefront on the map, showcase 360° panoramas, and publish real-time Marketplace inventory with WhatsApp enquiries.',
                primaryLabel: 'Open Workspace',
                primaryHref: '/workspace',
                secondaryLabel: 'Create Account',
                secondaryHref: '/signup',
              },
              {
                icon: Truck,
                badge: 'Fleet Pool',
                title: 'Local Drivers & Riders',
                desc: 'Join the PrintSwift Vehicle Pool with your Scooty, Cycle Rickshaw, E-Rickshaw, Van, or Pickup for steady jobs and transparent payouts.',
                primaryLabel: 'Apply as Driver',
                primaryHref: '/contact',
                secondaryLabel: 'Sign Up',
                secondaryHref: '/signup',
              },
              {
                icon: Users,
                badge: 'Publishers',
                title: 'Advertisers & Organizers',
                desc: 'Publish structured rich-text notices, recruitment drives, and YouTube video updates directly to Churachandpur Bulletin readers.',
                primaryLabel: 'View Bulletin Plans',
                primaryHref: '/bulletin',
                secondaryLabel: 'Contact Team',
                secondaryHref: '/contact',
              },
            ].map((role) => {
              const Icon = role.icon;
              return (
                <motion.div
                  key={role.title}
                  variants={ITEM_VARIANTS}
                  whileHover={{ y: -2 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                        {role.badge}
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
                      {role.title}
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {role.desc}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 pt-2">
                    <Link
                      href={role.primaryHref}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-semibold text-[hsl(var(--color-primary-foreground))] transition-opacity hover:opacity-90"
                    >
                      <span>{role.primaryLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    <Link
                      href={role.secondaryHref}
                      className="inline-flex h-8 items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
                    >
                      {role.secondaryLabel}
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* ================================================================= */}
      {/* 7. REGIONAL ACCESSIBILITY & CUSTOMIZATION STRIP                    */}
      {/* ================================================================= */}
      <section className="mx-auto max-w-6xl px-4 pb-9 sm:px-6 sm:pb-12 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={ITEM_VARIANTS}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Designed for Local Accessibility</span>
              </div>
              <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                Your language, your palette, your reading density
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Languages className="h-3.5 w-3.5 shrink-0 text-theme-primary" />
                  <span>English, Manipuri &amp; Paite interface support</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Palette className="h-3.5 w-3.5 shrink-0 text-theme-primary" />
                  <span>Unified 3-tier custom themes &amp; dark mode</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Sliders className="h-3.5 w-3.5 shrink-0 text-theme-primary" />
                  <span>Adjustable root UI scaling for comfort</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Wifi className="h-3.5 w-3.5 shrink-0 text-theme-primary" />
                  <span>Lightweight, resilient mobile performance</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/settings"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800 px-4 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Palette className="h-3.5 w-3.5 text-theme-primary" />
                <span>Customize in Settings</span>
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ================================================================= */}
      {/* 8. COMMERCIAL DISTRICT FOOTER                                      */}
      {/* ================================================================= */}
      <footer className="border-t border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 pt-8 pb-20 sm:pt-10 landscape:pb-8 lg:pb-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-7 md:grid-cols-12">
            {/* Brand Block */}
            <div className="md:col-span-5">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-theme-primary text-[hsl(var(--color-primary-foreground))]">
                  <Globe className="h-4 w-4" />
                </div>
                <span className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-white">
                  PrintSwift Local
                </span>
              </div>
              <p className="mt-2.5 max-w-sm text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Churachandpur&apos;s community-first digital directory, shop
                marketplace, public bulletin board, and escrow-protected Pick N
                Drop delivery network.
              </p>
            </div>

            {/* Quick Navigation */}
            <div className="md:col-span-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                Navigation
              </h3>
              <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {[
                  { label: 'Home', href: '/' },
                  { label: 'Explore Map', href: '/explore' },
                  { label: 'Marketplace', href: '/marketplace' },
                  { label: 'Community Bulletin', href: '/bulletin' },
                  { label: 'About & Contact', href: '/contact' },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="transition-colors hover:text-theme-primary"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Popular Localities */}
            <div className="md:col-span-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                Popular Localities
              </h3>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {POPULAR_LOCALITIES.map((locality) => (
                  <Link
                    key={locality}
                    href={`/explore?q=${encodeURIComponent(locality)}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors hover:border-theme-primary hover:text-theme-primary"
                  >
                    <MapPin className="h-3 w-3 text-theme-primary" />
                    <span>{locality}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-2 border-t border-slate-200/70 dark:border-slate-800 pt-4 text-[11px] text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} PrintSwift Local • Churachandpur
              District, Manipur
            </p>
            <div className="flex items-center gap-4">
              <Link href="/about" className="hover:text-theme-primary">
                About
              </Link>
              <Link href="/contact" className="hover:text-theme-primary">
                Support &amp; Dispatch
              </Link>
              <Link href="/settings" className="hover:text-theme-primary">
                Preferences
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

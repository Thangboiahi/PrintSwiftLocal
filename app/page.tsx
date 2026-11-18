import React from 'react';
import Link from 'next/link';
import { Compass, ShieldCheck, Users, ArrowRight, MapPin, Sparkles } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-full flex flex-col justify-between bg-gradient-to-b from-white via-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-white">
      {/* Hero Section */}
      <section className="relative px-4 sm:px-6 lg:px-8 pt-12 pb-16 md:pt-20 md:pb-24 max-w-5xl mx-auto text-center flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 text-xs font-semibold mb-6 shadow-xs">
          <Sparkles className="w-3.5 h-3.5" />
          <span>PrintSwift Local · Lamka Geospatial Directory</span>
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white max-w-4xl leading-tight">
          Discover Churachandpur Like Never Before
        </h1>

        <p className="mt-5 text-base sm:text-lg md:text-xl text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
          The ultimate local map for real estate, businesses, and essential services.
        </p>

        {/* CTA Buttons */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
          <Link
            href="/explore"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-sm sm:text-base hover:bg-blue-700 shadow-md hover:shadow-lg transition-all"
          >
            <Compass className="w-5 h-5" />
            <span>Open Map</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
          <Link
            href="/signup"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-semibold text-sm sm:text-base border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-xs transition-all"
          >
            <span>Create Account</span>
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section className="px-4 sm:px-6 lg:px-8 py-12 max-w-6xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          {/* Card 1: Interactive Discovery */}
          <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-5">
              <MapPin className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Interactive Discovery
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Navigate Lamka with ultra-responsive vector maps, 360° virtual property panoramas, and instant category filters tailored for local discovery.
            </p>
          </div>

          {/* Card 2: Verified Listings */}
          <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-5">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Verified Listings
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Every property, enterprise, and public landmark adheres to strict spatial coordinates and officer verification standards for dependable local data.
            </p>
          </div>

          {/* Card 3: Community Driven */}
          <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 rounded-2xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-5">
              <Users className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              Community Driven
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Empowering local business owners, residents, and visitors across Churachandpur District with dedicated workspaces and direct enquiry tools.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-xs py-8 px-4 sm:px-6 lg:px-8 mt-12">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <p>© 2026 PrintSwift Local · Churachandpur (Lamka). All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-4 sm:gap-6 font-medium">
            <Link href="/explore" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              Open Map
            </Link>
            <Link href="/about" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              About
            </Link>
            <Link href="/contact" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              Contact
            </Link>
            <Link href="/signup" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              Sign Up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

'use client';
import { useState, useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin } from 'lucide-react';
import Link from 'next/link';

function BrandLogoStatusInner() {
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('PrintSwift');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 1. Turn OFF loading when the route finishes changing
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
      setStatusText('PrintSwift');
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  // 2. Intercept internal link clicks to turn ON loading
  useEffect(() => {
    const handleLinkClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a');
      if (
        target &&
        target.href &&
        target.href.startsWith(window.location.origin) &&
        target.target !== '_blank'
      ) {
        const currentUrl = window.location.href.split('#')[0];
        const targetUrl = target.href.split('#')[0];
        if (currentUrl !== targetUrl) {
          setIsLoading(true);
          setStatusText('Loading...');
        }
      }
    };

    // Custom event listener for non-routing API calls
    const handleCustomStatus = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setIsLoading(customEvent.detail.loading);
        setStatusText(customEvent.detail.text || 'PrintSwift');
      }
    };

    document.addEventListener('click', handleLinkClick);
    window.addEventListener('app_status', handleCustomStatus);

    return () => {
      document.removeEventListener('click', handleLinkClick);
      window.removeEventListener('app_status', handleCustomStatus);
    };
  }, []);

  return (
    <Link className="flex items-center gap-3 group outline-none" href="/">
      {/* Logo Icon with Spinning Padding Loop */}
      <div className="relative flex items-center justify-center p-1.5">
        {isLoading && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
            className="absolute inset-0 rounded-full border-[3px] border-blue-600/20 dark:border-blue-500/20 border-t-blue-600 dark:border-t-blue-500"
          />
        )}
        <div
          className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white transition-transform duration-300 ${
            isLoading ? 'scale-90' : 'group-hover:scale-105'
          }`}
        >
          <MapPin size={18} strokeWidth={2.5} />
        </div>
      </div>

      {/* Animated Text Replacement */}
      <div className="overflow-hidden relative h-7 w-32 flex items-center">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={statusText}
            initial={{ y: 20, opacity: 0, filter: 'blur(4px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: -20, opacity: 0, filter: 'blur(4px)' }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
            className={`absolute left-0 whitespace-nowrap font-bold ${
              isLoading
                ? 'text-blue-600 dark:text-blue-400 text-sm tracking-wide'
                : 'text-slate-900 dark:text-white text-xl tracking-tight'
            }`}
          >
            {statusText}
          </motion.span>
        </AnimatePresence>
      </div>
    </Link>
  );
}

function BrandLogoFallback() {
  return (
    <Link className="flex items-center gap-3 group outline-none" href="/">
      <div className="relative flex items-center justify-center p-1.5">
        <div className="relative z-10 flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white group-hover:scale-105 transition-transform duration-300">
          <MapPin size={18} strokeWidth={2.5} />
        </div>
      </div>
      <div className="overflow-hidden relative h-7 w-32 flex items-center">
        <span className="absolute left-0 whitespace-nowrap font-bold text-slate-900 dark:text-white text-xl tracking-tight">
          PrintSwift
        </span>
      </div>
    </Link>
  );
}

export function BrandLogoStatus() {
  return (
    <Suspense fallback={<BrandLogoFallback />}>
      <BrandLogoStatusInner />
    </Suspense>
  );
}

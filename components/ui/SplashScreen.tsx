'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMounted } from '@/lib/hooks/useIsMounted';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';

export function SplashScreen() {
  const isMounted = useIsMounted();
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  if (!isMounted) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="ddoodle-splash-screen"
          data-testid="global-splash-screen"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-primary)] px-6"
        >
          <motion.div
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="relative flex flex-col items-center gap-4"
          >
            <div className="relative flex items-center justify-center rounded-3xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-6 py-5 shadow-xl">
              <DDoodleLogo variant="full" size={48} showTagline />
              <motion.div
                animate={{ scale: [1, 1.18], opacity: [0.35, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: 'easeOut' }}
                className="pointer-events-none absolute inset-0 rounded-3xl border-2 border-theme-primary/40"
              />
            </div>

            <div className="h-1 w-28 overflow-hidden rounded-full bg-[var(--ps-border)] relative">
              <motion.div
                className="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-[#1D7578] via-[#C89B32] to-[#E5BD57]"
                initial={{ left: '-50%' }}
                animate={{ left: '100%' }}
                transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

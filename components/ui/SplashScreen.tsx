'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin } from 'lucide-react';
import { useIsMounted } from '@/lib/hooks/useIsMounted';

export function SplashScreen() {
  const isMounted = useIsMounted();
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Hide the splash screen after 1.5 seconds of hydration/loading
    const timer = setTimeout(() => setIsVisible(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!isMounted) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="printswift-splash-screen"
          data-testid="global-splash-screen"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950"
        >
          {/* Logo Container */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="relative flex items-center justify-center w-20 h-20 bg-blue-600 text-white rounded-full shadow-2xl mb-6"
          >
            <MapPin size={40} strokeWidth={2.5} />
            {/* Pulsing Ring Effect */}
            <motion.div
              animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'easeOut' }}
              className="absolute inset-0 rounded-full border-4 border-blue-600"
            />
          </motion.div>

          {/* Brand Text */}
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight"
          >
            PrintSwift
          </motion.h1>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

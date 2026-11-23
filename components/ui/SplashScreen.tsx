'use client';

import React, { useEffect, useState } from 'react';
import DDoodleLogo from '@/components/ui/DDoodleLogo';

export function SplashScreen() {
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    try {
      const hasSeen =
        sessionStorage.getItem('ddoodle_splash_seen') ||
        sessionStorage.getItem('ps_splash_seen');
      if (hasSeen) {
        return;
      }
      sessionStorage.setItem('ddoodle_splash_seen', '1');
      sessionStorage.setItem('ps_splash_seen', '1');
    } catch {
      return;
    }

    const fadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, 350);

    const hideTimer = setTimeout(() => {
      setVisible(false);
    }, 650);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#060B19] transition-opacity duration-300 pointer-events-none ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="relative flex flex-col items-center">
        <div className="absolute -inset-8 rounded-full bg-gradient-to-tr from-blue-500/20 via-orange-500/15 to-emerald-500/20 blur-2xl animate-pulse" />
        <div className="relative transform transition-transform duration-500 scale-100">
          <DDoodleLogo variant="icon" size={48} />
        </div>
        <div className="mt-6 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" />
        </div>
      </div>
    </div>
  );
}

export default SplashScreen;

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    let active = true;

    async function verifySession() {
      if (!isSupabaseConfigured()) {
        if (active) {
          router.replace('/login');
        }
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!active) return;

        if (session === null) {
          router.replace('/login');
          return;
        }

        setIsVerified(true);
      } catch {
        if (active) {
          router.replace('/login');
        }
      }
    }

    void verifySession();

    let unsubscribe: (() => void) | undefined;
    if (isSupabaseConfigured()) {
      const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        if (!nextSession) {
          setIsVerified(false);
          router.replace('/login');
        } else {
          setIsVerified(true);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [router]);

  if (!isVerified) {
    return (
      <div
        data-testid="protected-route-loading"
        className="w-full py-12 flex items-center justify-center bg-[var(--ps-bg)] px-4"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ps-accent)]" />
          <p className="text-xs font-medium text-[var(--ps-text-muted)]">
            Verifying session…
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default ProtectedRoute;

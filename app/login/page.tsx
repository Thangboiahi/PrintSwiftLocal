'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { AuthModal } from '@/components/auth/AuthModal';

export default function LoginPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--ps-bg)] px-4 py-12 text-[var(--ps-text)]">
      <AuthModal
        open={true}
        initialView="login"
        onClose={() => router.push('/')}
      />
    </main>
  );
}

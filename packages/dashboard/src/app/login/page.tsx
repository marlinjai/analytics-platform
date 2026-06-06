'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

// Login is now handled by auth-brain at auth.lumitra.co.
// This page exists only to redirect users who land on /login directly.

function LoginRedirect() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const authBrainUrl = process.env.NEXT_PUBLIC_AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';
    const next = searchParams.get('callbackUrl') ?? searchParams.get('next') ?? window.location.origin;
    const loginUrl = new URL('/login', authBrainUrl);
    loginUrl.searchParams.set('next', next);
    window.location.replace(loginUrl.toString());
  }, [searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950">
      <p className="text-sm text-gray-400">Redirecting to login...</p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginRedirect />
    </Suspense>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type State = 'loading' | 'success' | 'error';

export default function AcceptInvitePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<State>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setErrorMessage('Invalid invitation link — no token found.');
      setState('error');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/invitations/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;

        if (res.status === 401) {
          // Not logged in — redirect to login with a callbackUrl back here
          const callbackUrl = encodeURIComponent(`/accept-invite?token=${token}`);
          router.replace(`/login?callbackUrl=${callbackUrl}`);
          return;
        }

        if (res.ok) {
          setState('success');
        } else {
          const data = await res.json().catch(() => ({}));
          setErrorMessage(data.error ?? 'Something went wrong. Please try again.');
          setState('error');
        }
      } catch {
        if (!cancelled) {
          setErrorMessage('Network error. Please check your connection and try again.');
          setState('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
          <p className="text-sm text-gray-400">Accepting invitation…</p>
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
        <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <svg
              className="h-6 w-6 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mb-2 text-lg font-semibold text-gray-100">You&apos;re in!</h1>
          <p className="mb-6 text-sm text-gray-400">
            You have successfully joined the project. Head to the dashboard to get started.
          </p>
          <button
            onClick={() => router.push('/')}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
          >
            Go to dashboard
          </button>
        </div>
      </div>
    );
  }

  // error state
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <svg
            className="h-6 w-6 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="mb-2 text-lg font-semibold text-gray-100">Invitation error</h1>
        <p className="mb-6 text-sm text-gray-400">{errorMessage}</p>
        <button
          onClick={() => router.push('/')}
          className="w-full rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-600 transition"
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );
}

'use client';

import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';

function CliAuthContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const [status, setStatus] = useState<'idle' | 'approving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleApprove = async () => {
    if (!code) return;
    setStatus('approving');
    try {
      const res = await fetch('/api/cli-auth/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: code }),
      });
      if (res.ok) {
        setStatus('success');
      } else {
        const data = await res.json();
        setErrorMsg(data.error || 'Failed to authorize');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error');
      setStatus('error');
    }
  };

  if (!code) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-100">Invalid Link</h1>
        <p className="mt-2 text-sm text-gray-400">
          No device code found. Run <code className="rounded bg-gray-800 px-1.5 py-0.5 text-sm">npx lumitra init</code> to start the authentication flow.
        </p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
          <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-100">Authorized</h1>
        <p className="mt-2 text-sm text-gray-400">
          You can close this tab and return to your terminal.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6 rounded-xl border border-gray-800 bg-gray-900 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-100">Authorize CLI</h1>
        <p className="mt-2 text-sm text-gray-400">
          The Lumitra CLI is requesting access to your account.
          Verify the code below matches what you see in your terminal.
        </p>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4 text-center">
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">Device Code</p>
        <p className="font-mono text-3xl font-bold tracking-widest text-gray-100">{code.toUpperCase()}</p>
      </div>

      {status === 'error' && (
        <div className="rounded-lg border border-red-600/50 bg-red-500/10 p-3 text-center">
          <p className="text-sm text-red-400">{errorMsg}</p>
          <p className="mt-1 text-xs text-gray-500">
            Run <code className="rounded bg-gray-800 px-1 py-0.5">npx lumitra init</code> again to get a new code.
          </p>
        </div>
      )}

      {status !== 'error' && (
        <button
          onClick={handleApprove}
          disabled={status === 'approving'}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {status === 'approving' ? 'Authorizing...' : 'Authorize'}
        </button>
      )}
    </div>
  );
}

export default function CliAuthPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950">
      <Suspense fallback={
        <div className="text-center">
          <div className="h-8 w-48 animate-pulse rounded bg-gray-800 mx-auto" />
        </div>
      }>
        <CliAuthContent />
      </Suspense>
    </main>
  );
}

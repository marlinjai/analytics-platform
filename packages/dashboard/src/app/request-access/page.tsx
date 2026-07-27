'use client';

/**
 * Landing page for a signed-in user whose account does not carry the analytics
 * app grant. Reached from the dashboard layout gate (redirect to
 * /request-access). It lives OUTSIDE the (dashboard) route group on purpose:
 * the grant gate wraps that group, so putting this page inside it would loop.
 *
 * The user is authenticated (middleware still requires the session cookie for
 * this path), just not granted. This is a real destination with a next step,
 * never an empty app or a dead end: they can request access, or sign out to
 * switch to an account that has the grant.
 */

export default function RequestAccessPage() {
  function signOut() {
    // Same pattern as the account page: a same-site form POST to auth-brain's
    // logout endpoint ends the SHARED session and returns here, letting the
    // user retry with a different account.
    const authBrainUrl = process.env.NEXT_PUBLIC_AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${authBrainUrl}/api/auth/logout?return_to=${encodeURIComponent(
      window.location.origin,
    )}`;
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center shadow-xl">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-gray-700 bg-gray-800">
          <svg
            className="h-6 w-6 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <h1 className="text-lg font-semibold text-gray-100">Analytics access needed</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          You are signed in, but your account has not been granted access to Analytics yet.
          Access is managed per company: an admin needs to enable the Analytics app for your
          company before you can continue.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-gray-400">
          Ask your workspace administrator to grant your company the Analytics app, then reload
          this page.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 transition hover:bg-white"
          >
            I have access now, reload
          </button>
          <button
            onClick={signOut}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-800 hover:text-gray-100"
          >
            Sign out and switch account
          </button>
        </div>
      </div>
    </main>
  );
}

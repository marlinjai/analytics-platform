'use client';

import { useEffect, useState, useCallback } from 'react';
import { SkeletonKeyList } from '@/components/ui/Skeleton';

// ── Types ────────────────────────────────────────────────────────────────────

interface UserInfo {
  id: string;
  email: string;
  name: string | null;
}

interface AccountKey {
  id: string;
  prefix: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// ── Account API Keys Section ─────────────────────────────────────────────────

function AccountKeysSection() {
  const [keys, setKeys] = useState<AccountKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/account/keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/account/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setRevealedKey(data.key.fullKey);
        setLabel('');
        loadKeys();
      }
    } catch { /* ignore */ }
    setCreating(false);
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Revoke this account key? Any tools using it will lose access.')) return;
    await fetch(`/api/account/keys/${keyId}`, { method: 'DELETE' });
    loadKeys();
    if (revealedKey) setRevealedKey(null);
  };

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeKeys = keys.filter((k) => !k.revoked_at);

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-100">Account API Keys</h2>
      <p className="mb-4 text-sm text-gray-400">
        Account keys grant access to all your projects and can create new projects programmatically.
        Use these for CI/CD pipelines, Claude Code, and agent automation.
      </p>

      {loading ? (
        <SkeletonKeyList rows={2} />
      ) : activeKeys.length === 0 && !revealedKey ? (
        <p className="mb-4 text-sm text-gray-500">No account keys yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-gray-800">
          {activeKeys.map((key) => (
            <li key={key.id} className="flex items-center justify-between py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-100">{key.label}</p>
                <p className="text-xs text-gray-400">
                  {key.prefix}*** &middot; Created{' '}
                  {new Date(key.created_at).toLocaleDateString()}
                  {key.last_used_at && (
                    <> &middot; Last used {new Date(key.last_used_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <button
                onClick={() => handleRevoke(key.id)}
                className="shrink-0 rounded px-3 py-1 text-sm font-medium text-red-400 hover:bg-red-400/10 transition"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {revealedKey && (
        <div className="mb-4 rounded-lg border border-yellow-600/50 bg-yellow-500/10 p-4">
          <p className="mb-2 text-sm font-semibold text-yellow-300">
            Copy this key now — it won&apos;t be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="block flex-1 break-all rounded bg-gray-800 px-3 py-2 text-sm text-gray-100">
              {revealedKey}
            </code>
            <button
              onClick={() => copyKey(revealedKey)}
              className="shrink-0 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-600 transition"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="account-key-label" className="mb-1 block text-sm text-gray-400">
            Label
          </label>
          <input
            id="account-key-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Claude Code"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={creating || !label.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {creating ? 'Creating...' : 'Create account key'}
        </button>
      </form>
    </section>
  );
}

// ── Main Account Page ────────────────────────────────────────────────────────

export default function AccountPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.email) setUser(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6 md:p-10">
      <h1 className="text-2xl font-bold text-gray-100">Account</h1>

      {/* Profile */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-100">Profile</h2>
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-48 rounded bg-gray-800" />
            <div className="h-4 w-32 rounded bg-gray-800" />
          </div>
        ) : user ? (
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xl font-medium text-white">
              {(user.name?.[0] || user.email[0] || '?').toUpperCase()}
            </div>
            <div>
              {user.name && <p className="text-base font-medium text-gray-100">{user.name}</p>}
              <p className="text-sm text-gray-400">{user.email}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Could not load profile.</p>
        )}

        <div className="mt-6 border-t border-gray-800 pt-4">
          <button
            onClick={() => { window.location.href = '/api/auth/signout'; }}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-gray-100 transition"
          >
            Sign out
          </button>
        </div>
      </section>

      {/* Account API Keys */}
      <AccountKeysSection />
    </div>
  );
}

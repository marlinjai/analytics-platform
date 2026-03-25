'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SessionSummary } from '@analytics-platform/shared';
import { SkeletonSessionList } from '@/components/ui/Skeleton';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

interface Props {
  sessions: SessionSummary[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onDelete?: (sessionId: string) => void;
  projectId?: string | null;
}

export function SessionList({ sessions, loading, hasMore, onLoadMore, onDelete, projectId }: Props) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (loading && sessions.length === 0) {
    return <SkeletonSessionList rows={6} />;
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">No sessions with replay data found</p>
        <p className="max-w-md text-center text-xs text-gray-600">
          Session replay requires the tracker to call <code className="rounded bg-gray-800 px-1">enableReplay()</code> after
          user consent. Sessions without replay are filtered out.
        </p>
      </div>
    );
  }

  const handleDelete = async (sessionId: string) => {
    if (!projectId || !onDelete) return;
    if (!confirm(`Delete session ${sessionId.slice(0, 8)}...? This removes all events for this session from ClickHouse.`)) return;
    setDeletingId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/replay?projectId=${projectId}`, { method: 'DELETE' });
      if (res.ok) onDelete(sessionId);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="px-4 py-3 font-medium">Session</th>
            <th className="px-4 py-3 font-medium">Replay</th>
            <th className="px-4 py-3 font-medium">Duration</th>
            <th className="px-4 py-3 font-medium">Pages</th>
            <th className="px-4 py-3 font-medium">Device</th>
            <th className="px-4 py-3 font-medium">Country</th>
            <th className="px-4 py-3 font-medium">Started</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.sessionId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="px-4 py-3">
                <Link
                  href={`/replay/${s.sessionId}${projectId ? `?projectId=${projectId}` : ''}`}
                  className="text-blue-400 hover:text-blue-300"
                >
                  {s.sessionId.slice(0, 8)}...
                </Link>
              </td>
              <td className="px-4 py-3">
                {s.hasReplay ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                    {s.replayChunks} chunks
                  </span>
                ) : (
                  <span className="text-xs text-gray-600">&mdash;</span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-300">{formatDuration(s.duration)}</td>
              <td className="px-4 py-3 text-gray-300">{s.pageviews}</td>
              <td className="px-4 py-3 text-gray-400">{s.deviceType ?? '—'}</td>
              <td className="px-4 py-3 text-gray-400">{s.country || '—'}</td>
              <td className="px-4 py-3 text-gray-400">
                {new Date(s.startedAt).toLocaleString()}
              </td>
              <td className="px-2 py-3">
                <button
                  onClick={() => handleDelete(s.sessionId)}
                  disabled={deletingId === s.sessionId}
                  className="rounded p-1 text-gray-600 transition-colors hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50"
                  title="Delete session"
                >
                  {deletingId === s.sessionId ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  )}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <div className="border-t border-gray-800 px-4 py-3 text-center">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="text-sm text-blue-400 hover:text-blue-300 disabled:text-gray-600"
          >
            {loading ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

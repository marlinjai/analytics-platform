'use client';

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
  projectId?: string | null;
}

export function SessionList({ sessions, loading, hasMore, onLoadMore, projectId }: Props) {
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
                  <span className="text-xs text-gray-600">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-300">{formatDuration(s.duration)}</td>
              <td className="px-4 py-3 text-gray-300">{s.pageviews}</td>
              <td className="px-4 py-3 text-gray-400">{s.deviceType ?? '—'}</td>
              <td className="px-4 py-3 text-gray-400">{s.country || '—'}</td>
              <td className="px-4 py-3 text-gray-400">
                {new Date(s.startedAt).toLocaleString()}
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

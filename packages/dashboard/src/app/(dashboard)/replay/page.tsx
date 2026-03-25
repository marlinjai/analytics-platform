'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import type { SessionSummary } from '@analytics-platform/shared';
import { SessionList } from '@/components/replay/SessionList';
import { DateRangePicker } from '@/components/layout/DateRangePicker';
import { useCurrentProjectId } from '@/components/layout/ProjectSwitcher';

export default function ReplayListPage() {
  return <Suspense><ReplayListPageInner /></Suspense>;
}

function ReplayListPageInner() {
  const projectId = useCurrentProjectId();
  const [from, setFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString());
  const [to, setTo] = useState(() => new Date().toISOString());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const fetchSessions = useCallback(async (append = false) => {
    if (!projectId) return;
    setLoading(true);

    const params = new URLSearchParams({ projectId, from, to });
    if (append && cursor) params.set('cursor', cursor);

    try {
      const res = await fetch(`/api/sessions?${params}`);
      if (res.ok) {
        const data = await res.json();
        const replaySessions = (data.sessions as SessionSummary[]).filter((s) => s.hasReplay);
        setSessions((prev) => append ? [...prev, ...replaySessions] : replaySessions);
        setCursor(data.nextCursor);
        setHasMore(!!data.nextCursor);
      }
    } catch {
      // Network error
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to, cursor]);

  useEffect(() => {
    setCursor(null);
    fetchSessions(false);
  }, [projectId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <SessionList
        sessions={sessions}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={() => fetchSessions(true)}
        onDelete={(id) => setSessions((prev) => prev.filter((s) => s.sessionId !== id))}
        projectId={projectId}
      />
    </div>
  );
}

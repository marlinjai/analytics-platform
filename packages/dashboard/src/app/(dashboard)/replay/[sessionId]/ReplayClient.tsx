'use client';

import { useEffect, useState } from 'react';
import { ReplayPlayer } from '@/components/replay/ReplayPlayer';

/**
 * Client half of the replay page. Behaviour is unchanged from when this was the
 * page component: it reads `projectId` from the URL and loads the replay. The
 * active-company boundary is enforced by the Server Component parent
 * (page.tsx -> requireProjectInScope) BEFORE this renders, and again by the
 * /api/sessions/[sessionId]/replay route it calls.
 */
export function ReplayClient({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const projectId = new URLSearchParams(window.location.search).get('projectId');
    if (!projectId) return;

    fetch(`/api/sessions/${sessionId}/replay?projectId=${projectId}`)
      .then((r) => r.json())
      .then((data) => {
        const allEvents = (data.chunks as unknown[][]).flat();
        setEvents(allEvents);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-sm text-gray-500">Loading replay...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-100">
        Session {sessionId.slice(0, 8)}...
      </h2>
      <ReplayPlayer events={events} />
    </div>
  );
}

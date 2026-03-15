'use client';

import { useEffect, useState, use } from 'react';
import { ReplayPlayer } from '@/components/replay/ReplayPlayer';
import { ReplayTimeline } from '@/components/replay/ReplayTimeline';

export default function ReplayPlayerPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [events, setEvents] = useState<unknown[]>([]);
  const [speed, setSpeed] = useState(1);
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

  const timelineEvents = events
    .filter((e): e is { type: string; timestamp: number; data?: { href?: string } } =>
      typeof e === 'object' && e !== null && 'type' in e && 'timestamp' in e
    )
    .map((e) => ({
      type: String(e.type),
      timestamp: e.timestamp,
      url: e.data?.href,
    }));

  const duration = events.length > 0
    ? ((events[events.length - 1] as { timestamp: number })?.timestamp -
       (events[0] as { timestamp: number })?.timestamp) / 1000
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-100">
          Session {sessionId.slice(0, 8)}...
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Speed:</span>
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                speed === s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      <ReplayPlayer events={events} speed={speed} />
      <ReplayTimeline events={timelineEvents} duration={duration} />
    </div>
  );
}

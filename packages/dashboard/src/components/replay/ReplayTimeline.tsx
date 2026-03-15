'use client';

interface TimelineEvent {
  type: string;
  timestamp: number;
  url?: string;
}

interface Props {
  events: TimelineEvent[];
  duration: number;
}

export function ReplayTimeline({ events, duration }: Props) {
  if (events.length === 0 || duration === 0) return null;

  const startTime = events[0]?.timestamp ?? 0;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-300">Timeline</h3>
      <div className="relative h-8 rounded-lg bg-gray-800">
        {events.map((event, i) => {
          const offset = ((event.timestamp - startTime) / (duration * 1000)) * 100;
          const color = event.type === 'click' ? 'bg-blue-400' : event.type === 'pageview' ? 'bg-green-400' : 'bg-gray-400';

          return (
            <div
              key={i}
              className={`absolute top-1 h-6 w-1.5 rounded-full ${color}`}
              style={{ left: `${Math.min(offset, 99)}%` }}
              title={`${event.type}${event.url ? ` — ${event.url}` : ''}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-gray-500">
        <span>0:00</span>
        <span>
          {Math.floor(duration / 60)}:{String(Math.round(duration % 60)).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}

'use client';

import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { TimeseriesPoint } from '@analytics-platform/shared';
import { SkeletonChart } from '@/components/ui/Skeleton';

type Interval = 'five_minute' | 'hour' | 'day' | 'week' | 'month';

interface Props {
  data: TimeseriesPoint[];
  loading: boolean;
  interval?: Interval;
}

// ── Formatting helpers ──────────────────────────────────────

function tickFormatter(interval: Interval) {
  return (value: string) => {
    const d = new Date(value);
    switch (interval) {
      case 'five_minute':
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      case 'hour': {
        // If range ≤ 24h just show hour, otherwise "Mon 14:00"
        return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      }
      case 'day':
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      case 'week':
        return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
      case 'month':
        return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      default:
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
  };
}

function tooltipLabel(interval: Interval, value: string): string {
  const d = new Date(value);
  switch (interval) {
    case 'five_minute': {
      const end = new Date(d.getTime() + 5 * 60_000);
      return `${d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
    case 'hour': {
      const end = new Date(d.getTime() + 60 * 60_000);
      return `${d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
    case 'day':
      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    case 'week': {
      const end = new Date(d.getTime() + 6 * 24 * 60 * 60_000);
      return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
    case 'month':
      return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    default:
      return d.toLocaleDateString();
  }
}

/** Compute a reasonable tick interval so labels don't crowd. */
function tickInterval(dataLength: number): number | undefined {
  if (dataLength <= 12) return 0; // show every label
  if (dataLength <= 30) return Math.floor(dataLength / 10);
  if (dataLength <= 100) return Math.floor(dataLength / 12);
  return Math.floor(dataLength / 10);
}

// ── Custom tooltip ──────────────────────────────────────────

interface TooltipPayloadEntry {
  dataKey?: string;
  value?: number;
  color?: string;
  name?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  interval: Interval;
}

function CustomTooltip({ active, payload, label, interval }: CustomTooltipProps) {
  if (!active || !payload?.length || !label) return null;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-gray-400">{tooltipLabel(interval, label)}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-sm font-semibold" style={{ color: entry.color }}>
          {(entry.value ?? 0).toLocaleString()}{' '}
          <span className="font-normal text-gray-400">{entry.name}</span>
        </p>
      ))}
    </div>
  );
}

// ── Chart component ─────────────────────────────────────────

export function TimeseriesChart({ data, loading, interval = 'day' }: Props) {
  if (loading) {
    return <SkeletonChart />;
  }

  if (data.length === 0) {
    return (
      <div className="flex min-h-[300px] items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">No data for this period</p>
      </div>
    );
  }

  const hasVisitors = data.some((d) => d.visitors > 0);
  const tick = tickInterval(data.length);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <h3 className="mb-4 text-sm font-medium text-gray-300">Pageviews &amp; Visitors</h3>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="blueAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />

          <XAxis
            dataKey="timestamp"
            stroke="#374151"
            tick={{ fill: '#6b7280', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={tickFormatter(interval)}
            interval={tick}
            angle={interval === 'week' ? -20 : 0}
            textAnchor={interval === 'week' ? 'end' : 'middle'}
          />

          <YAxis
            stroke="#374151"
            tick={{ fill: '#6b7280', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
          />

          <Tooltip
            content={<CustomTooltip interval={interval} />}
            cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 2' }}
          />

          <Legend
            iconType="line"
            wrapperStyle={{ fontSize: 12, color: '#9ca3af', paddingTop: 8 }}
          />

          <Line
            type="monotone"
            dataKey="count"
            name="Pageviews"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#3b82f6', stroke: '#1d4ed8', strokeWidth: 2 }}
          />

          {hasVisitors && (
            <Line
              type="monotone"
              dataKey="visitors"
              name="Unique Visitors"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#8b5cf6', stroke: '#6d28d9', strokeWidth: 2 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

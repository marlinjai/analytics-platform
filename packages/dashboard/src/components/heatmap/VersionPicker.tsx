'use client';

import type { PageVersion } from '@analytics-platform/shared';

interface Props {
  versions: PageVersion[];
  selected: string | null;
  onChange: (pageHash: string | null) => void;
  loading?: boolean;
}

export function VersionPicker({ versions, selected, onChange, loading }: Props) {
  if (loading) {
    return <div className="h-10 w-64 animate-pulse rounded-lg bg-gray-800" />;
  }

  if (versions.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No page versions detected yet. Deploy with the updated tracker to start
        capturing versions.
      </p>
    );
  }

  return (
    <select
      value={selected ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
    >
      <option value="">Current (live page)</option>
      {versions.map((v) => (
        <option key={v.pageHash} value={v.pageHash}>
          v{v.pageHash.slice(0, 6)} — {formatDateRange(v.firstSeen, v.lastSeen)}{' '}
          ({v.eventCount} events)
        </option>
      ))}
    </select>
  );
}

function formatDateRange(from: string, to: string): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(from)} – ${fmt(to)}`;
}

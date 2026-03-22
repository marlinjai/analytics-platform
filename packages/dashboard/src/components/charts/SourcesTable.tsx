'use client';

import type { TopSource } from '@analytics-platform/shared';

interface Props {
  sources: TopSource[];
  loading: boolean;
  onFilterClick?: (domain: string) => void;
}

function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`;
}

export function SourcesTable({ sources, loading, onFilterClick }: Props) {
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-4 py-3">
        <h3 className="text-sm font-medium text-gray-300">Top Sources</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-2 font-medium">Referrer</th>
              <th className="px-4 py-2 font-medium">Visitors</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                  No referrer data yet
                </td>
              </tr>
            ) : (
              sources.map((source) => (
                <tr
                  key={source.domain}
                  className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${onFilterClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onFilterClick?.(source.domain)}
                >
                  <td className="flex items-center gap-2 px-4 py-2 text-gray-300">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getFaviconUrl(source.domain)}
                      alt=""
                      width={16}
                      height={16}
                      className="shrink-0 rounded-sm"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className="max-w-xs truncate">{source.domain}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-100">{source.visitors.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

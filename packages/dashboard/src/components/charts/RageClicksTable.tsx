'use client';

import type { RageClickRow } from '@/lib/queries/advanced';

interface Props {
  data: RageClickRow[];
  loading: boolean;
}

const HIGH_THRESHOLD = 10; // occurrences to consider "high"

export function RageClicksTable({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-gray-800" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">No rage clicks detected in this period</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">Selector</th>
              <th className="px-4 py-3 font-medium">Page</th>
              <th className="px-4 py-3 font-medium text-right">Occurrences</th>
              <th className="px-4 py-3 font-medium text-right">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const isHigh = row.count >= HIGH_THRESHOLD;
              return (
                <tr
                  key={`${row.selector}-${row.url}-${idx}`}
                  className={`border-b border-gray-800/50 ${isHigh ? 'bg-red-950/20' : 'hover:bg-gray-800/30'}`}
                >
                  <td className="max-w-[240px] truncate px-4 py-2 font-mono text-xs text-gray-300" title={row.selector}>
                    {row.selector}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-gray-400" title={row.url}>
                    {row.url}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        isHigh
                          ? 'bg-red-900/50 text-red-300'
                          : 'bg-orange-900/40 text-orange-300'
                      }`}
                    >
                      {isHigh && (
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                      {row.count.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-300">
                    {row.sessions.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

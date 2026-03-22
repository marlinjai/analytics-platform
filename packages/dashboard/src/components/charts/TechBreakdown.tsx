'use client';

import type { BreakdownRow } from '@analytics-platform/shared';

interface Props {
  title: string;
  rows: BreakdownRow[];
  loading: boolean;
}

export function TechBreakdown({ title, rows, loading }: Props) {
  const maxVisitors = rows[0]?.visitors ?? 1;

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
        <h3 className="text-sm font-medium text-gray-300">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Visitors</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                  No data yet
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const pct = Math.round((row.visitors / maxVisitors) * 100);
                return (
                  <tr
                    key={row.name}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-gray-300">{row.name || 'Unknown'}</span>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-gray-800">
                          <div
                            className="h-full rounded-full bg-indigo-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-gray-100">{row.visitors.toLocaleString()}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { TopPage } from '@analytics-platform/shared';
import { SkeletonTableRows } from '@/components/ui/Skeleton';

type SortKey = 'views' | 'visitors';

interface Props {
  pages: TopPage[];
  loading: boolean;
}

export function TopPagesTable({ pages, loading }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>('views');

  const sorted = [...pages].sort((a, b) => b[sortBy] - a[sortBy]);

  if (loading) {
    return <SkeletonTableRows rows={5} cols={3} />;
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-4 py-3">
        <h3 className="text-sm font-medium text-gray-300">Top Pages</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-2 font-medium">URL</th>
              <th
                className="cursor-pointer px-4 py-2 font-medium hover:text-gray-300"
                onClick={() => setSortBy('views')}
              >
                Views {sortBy === 'views' && '↓'}
              </th>
              <th
                className="cursor-pointer px-4 py-2 font-medium hover:text-gray-300"
                onClick={() => setSortBy('visitors')}
              >
                Visitors {sortBy === 'visitors' && '↓'}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                  No page data yet
                </td>
              </tr>
            ) : (
              sorted.map((page) => (
                <tr key={page.url} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="max-w-xs truncate px-4 py-2 text-gray-300">{page.url}</td>
                  <td className="px-4 py-2 text-gray-100">{page.views.toLocaleString()}</td>
                  <td className="px-4 py-2 text-gray-100">{page.visitors.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

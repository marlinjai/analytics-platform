'use client';

import type { CountryRow } from '@analytics-platform/shared';

interface Props {
  countries: CountryRow[];
  loading: boolean;
  onFilterClick?: (country: string) => void;
}

/** Convert a 2-letter ISO country code to a flag emoji */
function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  const codePoints = [...code.toUpperCase()].map(
    (ch) => 0x1f1e0 + ch.charCodeAt(0) - 'A'.charCodeAt(0)
  );
  return String.fromCodePoint(...codePoints);
}

export function CountriesTable({ countries, loading, onFilterClick }: Props) {
  const maxVisitors = countries[0]?.visitors ?? 1;

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
        <h3 className="text-sm font-medium text-gray-300">Countries</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-2 font-medium">Country</th>
              <th className="px-4 py-2 font-medium">Visitors</th>
            </tr>
          </thead>
          <tbody>
            {countries.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-gray-500">
                  No country data yet
                </td>
              </tr>
            ) : (
              countries.map((row) => {
                const pct = Math.round((row.visitors / maxVisitors) * 100);
                const flag = countryCodeToFlag(row.countryCode);
                return (
                  <tr
                    key={row.country}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${onFilterClick ? 'cursor-pointer' : ''}`}
                    onClick={() => onFilterClick?.(row.country)}
                  >
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-2 text-gray-300">
                          {flag && <span aria-hidden="true">{flag}</span>}
                          {row.country || 'Unknown'}
                        </span>
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

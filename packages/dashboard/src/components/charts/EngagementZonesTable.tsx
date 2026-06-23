'use client';

import { useEffect, useState } from 'react';
import type { DeviceType } from '@analytics-platform/shared';

interface SelectorRow {
  selector: string;
  count: number;
  sessions: number;
}

interface Props {
  projectId: string;
  url: string;
  dateRange: { from: string; to: string };
  deviceType: DeviceType | '';
  /** Scope the ranked elements to a single experiment arm via the by-variant MV. */
  experimentId?: string;
  variant?: string;
}

// ---------------------------------------------------------------------------
// Selector prettifier
// ---------------------------------------------------------------------------

/** Map of tag names to human-readable type labels */
const TAG_LABELS: Record<string, string> = {
  a: 'Link',
  button: 'Button',
  input: 'Input',
  select: 'Select',
  textarea: 'Textarea',
  img: 'Image',
  video: 'Video',
  form: 'Form',
  nav: 'Nav',
  header: 'Header',
  footer: 'Footer',
  section: 'Section',
  div: 'Div',
  span: 'Span',
  li: 'List Item',
  ul: 'List',
  ol: 'List',
  p: 'Paragraph',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  label: 'Label',
  svg: 'SVG',
  path: 'SVG',
};

/** Extract the last meaningful segment from a CSS selector */
function prettifySelector(selector: string): string {
  // Split on combinators (>, +, ~, space) and take the last segment
  const parts = selector.split(/\s*[>+~ ]\s*/).filter(Boolean);
  const last = parts[parts.length - 1] ?? selector;

  // Trim :nth-child(...) and similar pseudo-selectors for display
  return last.replace(/::?[\w-]+(\([^)]*\))?/g, '').trim() || selector;
}

/** Extract the tag name from a selector segment */
function extractTag(selector: string): string {
  const parts = selector.split(/\s*[>+~ ]\s*/).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  const match = last.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  return match?.[1] ? match[1].toLowerCase() : '';
}

/** Get a human-readable element type label */
function getTypeLabel(selector: string): string {
  const tag = extractTag(selector);
  return TAG_LABELS[tag] ?? (tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : 'Element');
}

// ---------------------------------------------------------------------------
// Type badge colors
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Button: { bg: 'bg-blue-900/40', text: 'text-blue-300' },
  Link: { bg: 'bg-cyan-900/40', text: 'text-cyan-300' },
  Input: { bg: 'bg-amber-900/40', text: 'text-amber-300' },
  Select: { bg: 'bg-amber-900/40', text: 'text-amber-300' },
  Textarea: { bg: 'bg-amber-900/40', text: 'text-amber-300' },
  Image: { bg: 'bg-purple-900/40', text: 'text-purple-300' },
  Nav: { bg: 'bg-emerald-900/40', text: 'text-emerald-300' },
  Form: { bg: 'bg-rose-900/40', text: 'text-rose-300' },
};

const DEFAULT_TYPE_COLOR = { bg: 'bg-gray-800', text: 'text-gray-400' };

// ---------------------------------------------------------------------------
// Heat bar colors (warm gradient based on proportion)
// ---------------------------------------------------------------------------

function heatColor(ratio: number): string {
  if (ratio > 0.75) return 'bg-red-500';
  if (ratio > 0.5) return 'bg-orange-500';
  if (ratio > 0.25) return 'bg-amber-500';
  return 'bg-yellow-500/80';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EngagementZonesTable({
  projectId,
  url,
  dateRange,
  deviceType,
  experimentId,
  variant,
}: Props) {
  const [data, setData] = useState<SelectorRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !url) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const params = new URLSearchParams({
      projectId,
      url,
      from: dateRange.from,
      to: dateRange.to,
    });
    if (deviceType) params.set('deviceType', deviceType);
    if (experimentId && variant) {
      params.set('experiment_id', experimentId);
      params.set('variant', variant);
    }

    fetch(`/api/heatmap/by-selector?${params}`)
      .then((r) => r.json())
      .then((json) => {
        const selectors: SelectorRow[] = (json.selectors ?? []).map(
          (s: Record<string, unknown>) => ({
            selector: String(s.selector ?? ''),
            count: Number(s.count ?? 0),
            sessions: Number(s.sessions ?? 0),
          }),
        );
        // Sort by clicks descending
        selectors.sort((a, b) => b.count - a.count);
        setData(selectors);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [projectId, url, dateRange.from, dateRange.to, deviceType, experimentId, variant]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-gray-800" />
        ))}
      </div>
    );
  }

  // Empty state
  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-gray-800 bg-gray-900">
        <p className="text-sm text-gray-500">No click data for this page</p>
      </div>
    );
  }

  const maxCount = data[0]?.count ?? 1;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-3 font-medium">Element</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Clicks</th>
              <th className="px-4 py-3 font-medium text-right">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const ratio = row.count / maxCount;
              const typeLabel = getTypeLabel(row.selector);
              const colors = TYPE_COLORS[typeLabel] ?? DEFAULT_TYPE_COLOR;

              return (
                <tr
                  key={`${row.selector}-${idx}`}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30"
                >
                  {/* Element — prettified selector */}
                  <td
                    className="max-w-[260px] truncate px-4 py-2 font-mono text-xs text-gray-300"
                    title={row.selector}
                  >
                    {prettifySelector(row.selector)}
                  </td>

                  {/* Type badge */}
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
                    >
                      {typeLabel}
                    </span>
                  </td>

                  {/* Clicks with heat bar */}
                  <td className="min-w-[160px] px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-right text-gray-100">
                        {row.count.toLocaleString()}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                        <div
                          className={`h-full rounded-full transition-all ${heatColor(ratio)}`}
                          style={{ width: `${Math.max(ratio * 100, 2)}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* Sessions */}
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

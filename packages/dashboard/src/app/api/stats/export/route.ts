import { NextRequest, NextResponse } from 'next/server';
import {
  getTopPages,
  getTopSources,
  getBrowserBreakdown,
  getOsBreakdown,
  getDeviceBreakdown,
  getCountryBreakdown,
} from '@/lib/queries/stats';
import { auth } from '@/lib/auth';
import { checkProjectMembership } from '@/lib/auth-check';
import type { DashboardFilters } from '@analytics-platform/shared';

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\n');
}

function sectionCsv(title: string, headers: string[], rows: string[][]): string {
  return `${title}\n${rowsToCsv(headers, rows)}\n`;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const projectId = params.get('projectId');
  const from = params.get('from');
  const to = params.get('to');
  const format = params.get('format') ?? 'csv';

  if (!projectId || !from || !to) {
    return NextResponse.json({ error: 'Missing projectId, from, or to' }, { status: 400 });
  }

  if (!['csv', 'json'].includes(format)) {
    return NextResponse.json({ error: 'Invalid format. Use csv or json.' }, { status: 400 });
  }

  if (!(await checkProjectMembership(session.user.id, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const filters: DashboardFilters = {
    page: params.get('page') ?? undefined,
    country: params.get('country') ?? undefined,
    browser: params.get('browser') ?? undefined,
    os: params.get('os') ?? undefined,
    device: params.get('device') ?? undefined,
    source: params.get('source') ?? undefined,
    environment: params.get('environment') ?? 'production',
  };

  const dateRange = { from, to };

  const [pages, sources, browsers, osRows, devices, countries] = await Promise.all([
    getTopPages(projectId, dateRange, filters),
    getTopSources(projectId, dateRange, filters),
    getBrowserBreakdown(projectId, dateRange, filters),
    getOsBreakdown(projectId, dateRange, filters),
    getDeviceBreakdown(projectId, dateRange, filters),
    getCountryBreakdown(projectId, dateRange, filters),
  ]);

  const fromSlug = from.slice(0, 10);
  const toSlug = to.slice(0, 10);
  const filename = `analytics-${projectId.slice(0, 8)}-${fromSlug}-${toSlug}`;

  if (format === 'json') {
    return new NextResponse(
      JSON.stringify({ pages, sources, browsers, os: osRows, devices, countries }, null, 2),
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}.json"`,
        },
      }
    );
  }

  // CSV format — multiple sections in one file
  const sections: string[] = [];

  sections.push(
    sectionCsv(
      'Top Pages',
      ['URL', 'Views', 'Visitors'],
      pages.map((p) => [p.url, String(p.views), String(p.visitors)])
    )
  );

  sections.push(
    sectionCsv(
      'Top Sources',
      ['Referrer Domain', 'Visitors'],
      sources.map((s) => [s.domain, String(s.visitors)])
    )
  );

  sections.push(
    sectionCsv(
      'Browsers',
      ['Browser', 'Visitors'],
      browsers.map((b) => [b.name, String(b.visitors)])
    )
  );

  sections.push(
    sectionCsv(
      'Operating Systems',
      ['OS', 'Visitors'],
      osRows.map((o) => [o.name, String(o.visitors)])
    )
  );

  sections.push(
    sectionCsv(
      'Devices',
      ['Device Type', 'Visitors'],
      devices.map((d) => [d.name, String(d.visitors)])
    )
  );

  sections.push(
    sectionCsv(
      'Countries',
      ['Country', 'Visitors'],
      countries.map((c) => [c.country, String(c.visitors)])
    )
  );

  const csv = sections.join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  });
}

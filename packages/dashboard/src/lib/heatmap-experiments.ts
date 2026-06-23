import type { ExperimentSummary } from '@/components/heatmap/VariantPicker';

/**
 * Fetch the experiments that can carry a per-variant heatmap for a project.
 *
 * Drafts are excluded because they have no recorded events (and thus no
 * variant-scoped click data in `heatmap_selectors_by_variant_mv`). The result
 * feeds both the VariantPicker dropdown and the side-by-side compare grid.
 *
 * Kept as a standalone, dependency-free loader so the param flow
 * (projectId -> /api/projects/{id}/experiments) is unit-testable without
 * mounting the page.
 */
export async function loadHeatmapExperiments(
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExperimentSummary[]> {
  if (!projectId) return [];

  const res = await fetchImpl(`/api/projects/${projectId}/experiments`);
  if (!res.ok) return [];

  const data = await res.json();
  const all: ExperimentSummary[] = (data.experiments ?? []).map(
    (e: Record<string, unknown>) => ({
      id: String(e.id ?? ''),
      key: String(e.key ?? ''),
      name: String(e.name ?? e.key ?? ''),
      status: (e.status as ExperimentSummary['status']) ?? 'draft',
      variants: Array.isArray(e.variants)
        ? (e.variants as ExperimentSummary['variants'])
        : [],
    }),
  );

  // Drafts never carry events, so a heatmap arm makes no sense for them.
  return all.filter((e) => e.status !== 'draft');
}

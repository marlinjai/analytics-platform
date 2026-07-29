/**
 * project-selection.ts — the pure rule for reconciling the persisted "current
 * project" selection against the ACTIVE-company-scoped project list.
 *
 * The active company is a BOUNDARY: a stored selection whose project is not in
 * the current list belongs to a company that is no longer active and MUST be
 * discarded, not reattached. Kept pure (no localStorage, no React) so it is
 * unit-testable and shared by the switcher's load path.
 *
 *   - empty list             -> clear any stored selection (null)
 *   - stored id still listed  -> keep it
 *   - stored id absent/null   -> default to the first in-scope project
 */
export function reconcileProjectSelection(
  storedId: string | null,
  projectIds: string[],
): { next: string | null; action: 'keep' | 'default' | 'clear' } {
  if (projectIds.length === 0) {
    return { next: null, action: storedId != null ? 'clear' : 'keep' };
  }
  if (storedId != null && projectIds.includes(storedId)) {
    return { next: storedId, action: 'keep' };
  }
  return { next: projectIds[0]!, action: 'default' };
}

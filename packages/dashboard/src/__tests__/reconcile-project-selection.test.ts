/**
 * reconcileProjectSelection — the client rule that keeps the persisted project
 * selection consistent with the ACTIVE company boundary.
 *
 * This backs the RESUME and BACKTRACK requirements: after a reload or a company
 * switch, a stored selection whose project is no longer in the (active-company
 * scoped) list must be DISCARDED, not reattached. Pure, so it is tested directly.
 */
import { describe, it, expect } from 'vitest';
import { reconcileProjectSelection } from '@/lib/project-selection';

describe('reconcileProjectSelection', () => {
  it('keeps a stored selection that is still in the active-company list', () => {
    expect(reconcileProjectSelection('p2', ['p1', 'p2', 'p3'])).toEqual({
      next: 'p2',
      action: 'keep',
    });
  });

  it('RESUME/BACKTRACK: discards a stored selection whose company no longer matches', () => {
    // 'pX' belonged to the previous company; the active company only has p1/p2.
    expect(reconcileProjectSelection('pX', ['p1', 'p2'])).toEqual({
      next: 'p1',
      action: 'default',
    });
  });

  it('defaults to the first project when nothing is stored', () => {
    expect(reconcileProjectSelection(null, ['p1', 'p2'])).toEqual({
      next: 'p1',
      action: 'default',
    });
  });

  it('clears a stale stored selection when the active company has no projects', () => {
    expect(reconcileProjectSelection('pX', [])).toEqual({ next: null, action: 'clear' });
  });

  it('no-op when nothing is stored and there are no projects', () => {
    expect(reconcileProjectSelection(null, [])).toEqual({ next: null, action: 'keep' });
  });
});

import { describe, it, expect } from 'vitest';
import { assign, evaluateFlag, murmurhash3 } from '../index.js';
import type { ExperimentDefinition, FlagDefinition } from '../index.js';
// Import the browser tracker straight from source (no build step needed) to
// prove the server assignment matches the tracker's, unit for unit.
import { ExperimentManager } from '../../../tracker/src/experiment.js';

const TWO_WAY: ExperimentDefinition = {
  id: 'exp-writer',
  key: 'writer-experiment',
  status: 'running',
  variants: [
    { key: 'control', weight: 50 },
    { key: 'treatment', weight: 50 },
  ],
};

const THREE_WAY: ExperimentDefinition = {
  id: 'exp-style',
  key: 'story-style',
  status: 'running',
  variants: [
    { key: 'a', weight: 33 },
    { key: 'b', weight: 33 },
    { key: 'c', weight: 34 },
  ],
};

const UNITS = [
  'user-1',
  'user-2',
  'family-42',
  'abc123',
  'marlinjaipohl@gmail.com',
  '00000000-0000-0000-0000-000000000000',
];

describe('murmurhash3', () => {
  it('is deterministic and unsigned 32-bit', () => {
    const h = murmurhash3('writer-experiment:user-1');
    expect(h).toBe(murmurhash3('writer-experiment:user-1'));
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('assign: fixed vectors (regression guard against algorithm drift)', () => {
  // These were computed from the canonical algorithm; if they change, the
  // server SDK has silently diverged from every previously-assigned unit.
  const expectedTwoWay: Record<string, string> = {
    'user-1': 'control',
    'user-2': 'treatment',
    'family-42': 'treatment',
    abc123: 'treatment',
    'marlinjaipohl@gmail.com': 'control',
    '00000000-0000-0000-0000-000000000000': 'control',
  };
  const expectedThreeWay: Record<string, string> = {
    'user-1': 'c',
    'user-2': 'b',
    'family-42': 'b',
    abc123: 'a',
    'marlinjaipohl@gmail.com': 'a',
    '00000000-0000-0000-0000-000000000000': 'c',
  };

  for (const unit of UNITS) {
    it(`assigns ${unit} -> ${expectedTwoWay[unit]} (2-way)`, () => {
      expect(assign(TWO_WAY, unit)).toBe(expectedTwoWay[unit]);
    });
    it(`assigns ${unit} -> ${expectedThreeWay[unit]} (3-way)`, () => {
      expect(assign(THREE_WAY, unit)).toBe(expectedThreeWay[unit]);
    });
  }
});

describe('assign: parity with the browser tracker (ExperimentManager)', () => {
  // The mandatory guarantee: server assign() == tracker getVariant() for the
  // same (experimentKey, unitId). Drive the real tracker manager per unit.
  function trackerVariant(exp: ExperimentDefinition, unitId: string): string | null {
    const mgr = new ExperimentManager(unitId);
    mgr.setDefinitions(
      [{ id: exp.id, key: exp.key, variants: exp.variants }],
      [],
    );
    return mgr.getVariant(exp.key);
  }

  for (const exp of [TWO_WAY, THREE_WAY]) {
    for (const unit of UNITS) {
      it(`${exp.key} / ${unit} matches the tracker`, () => {
        expect(assign(exp, unit)).toBe(trackerVariant(exp, unit));
      });
    }
  }

  it('matches the tracker across a large sweep of synthetic units', () => {
    const exp: ExperimentDefinition = {
      id: 'sweep',
      key: 'sweep-exp',
      status: 'running',
      variants: [
        { key: 'x', weight: 20 },
        { key: 'y', weight: 30 },
        { key: 'z', weight: 50 },
      ],
    };
    for (let i = 0; i < 500; i++) {
      const unit = `unit-${i}-${(i * 7919) % 101}`;
      expect(assign(exp, unit)).toBe(trackerVariant(exp, unit));
    }
  });
});

describe('assign: edge cases', () => {
  it('returns null for an experiment with no variants', () => {
    expect(assign({ id: 'e', key: 'k', status: 'running', variants: [] }, 'u')).toBeNull();
  });

  it('returns null for a non-running experiment', () => {
    expect(assign({ ...TWO_WAY, status: 'paused' }, 'user-1')).toBeNull();
    expect(assign({ ...TWO_WAY, status: 'draft' }, 'user-1')).toBeNull();
    expect(assign({ ...TWO_WAY, status: 'completed' }, 'user-1')).toBeNull();
  });

  it('treats a missing status as assignable (remote config ships running only)', () => {
    const noStatus: ExperimentDefinition = { id: TWO_WAY.id, key: TWO_WAY.key, variants: TWO_WAY.variants };
    expect(assign(noStatus, 'user-1')).toBe('control');
  });

  it('is stable: same unit always lands in the same arm', () => {
    const first = assign(TWO_WAY, 'sticky-user');
    for (let i = 0; i < 50; i++) {
      expect(assign(TWO_WAY, 'sticky-user')).toBe(first);
    }
  });

  it('falls back to the first arm when weights sum below 100', () => {
    // A bucket above the cumulative weight must still resolve to a variant.
    const underweighted: ExperimentDefinition = {
      id: 'uw',
      key: 'underweighted',
      status: 'running',
      variants: [{ key: 'only', weight: 1 }],
    };
    for (const unit of UNITS) {
      expect(assign(underweighted, unit)).toBe('only');
    }
  });
});

describe('evaluateFlag: parity with the tracker', () => {
  function trackerFlag(flag: FlagDefinition, unitId: string): boolean {
    const mgr = new ExperimentManager(unitId);
    mgr.setDefinitions(
      [],
      [{ key: flag.key, enabled: flag.enabled, rolloutPercentage: flag.rolloutPercentage, variants: flag.variants ?? null }],
    );
    return mgr.getFlag(flag.key);
  }

  it('returns false for a disabled flag', () => {
    expect(evaluateFlag({ key: 'f', enabled: false, rolloutPercentage: 100 }, 'user-1')).toBe(false);
  });

  it('returns true for a fully rolled-out enabled flag', () => {
    expect(evaluateFlag({ key: 'f', enabled: true, rolloutPercentage: 100 }, 'user-1')).toBe(true);
  });

  it('matches the tracker for partial rollouts across many units', () => {
    const flag: FlagDefinition = { key: 'new-ui', enabled: true, rolloutPercentage: 30 };
    for (let i = 0; i < 300; i++) {
      const unit = `flag-unit-${i}`;
      expect(evaluateFlag(flag, unit)).toBe(trackerFlag(flag, unit));
    }
  });
});

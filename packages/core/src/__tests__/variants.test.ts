import { describe, it, expect } from 'vitest';
import {
  assign,
  assignAll,
  assignAllFlags,
  evaluateFlag,
  encodeVariants,
  decodeVariants,
  encodeVariantsPublic,
  decodeVariantsPublic,
  LUMITRA_VARIANTS_COOKIE,
  LUMITRA_VARIANTS_PUBLIC_COOKIE,
  LUMITRA_UID_COOKIE,
} from '../index.js';
import type { ExperimentDefinition, FlagDefinition } from '../index.js';
// Drive the real browser tracker from source to prove cookie parity end-to-end.
import { ExperimentManager } from '../../../tracker/src/experiment.js';

const SECRET = 'test-secret-do-not-use-in-prod';
const EPOCH = 'cfg-v1';

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

const PAUSED: ExperimentDefinition = {
  id: 'exp-paused',
  key: 'paused-exp',
  status: 'paused',
  variants: [{ key: 'x', weight: 100 }],
};

const FLAG_ON: FlagDefinition = {
  key: 'new-checkout',
  enabled: true,
  rolloutPercentage: 100,
};

const FLAG_OFF: FlagDefinition = {
  key: 'legacy-banner',
  enabled: false,
  rolloutPercentage: 100,
};

const FLAG_ROLLOUT: FlagDefinition = {
  key: 'partial-rollout',
  enabled: true,
  rolloutPercentage: 40,
};

const UNITS = [
  'user-1',
  'user-2',
  'family-42',
  'abc123',
  'marlinjaipohl@gmail.com',
  '00000000-0000-0000-0000-000000000000',
];

describe('cookie name constants', () => {
  it('exposes the agreed cookie names', () => {
    expect(LUMITRA_VARIANTS_COOKIE).toBe('lumitra_variants');
    expect(LUMITRA_VARIANTS_PUBLIC_COOKIE).toBe('lumitra_variants_pub');
    expect(LUMITRA_UID_COOKIE).toBe('lumitra_uid');
  });
});

describe('assignAll', () => {
  it('produces a variant per assignable experiment, keyed by experiment key', () => {
    const map = assignAll([TWO_WAY, THREE_WAY], 'user-1');
    expect(Object.keys(map).sort()).toEqual(['story-style', 'writer-experiment']);
    expect(map['writer-experiment']).toBe(assign(TWO_WAY, 'user-1'));
    expect(map['story-style']).toBe(assign(THREE_WAY, 'user-1'));
  });

  it('omits non-assignable (non-running) experiments', () => {
    const map = assignAll([TWO_WAY, PAUSED], 'user-1');
    expect(map).not.toHaveProperty('paused-exp');
    expect(map).toHaveProperty('writer-experiment');
  });

  it('returns {} when there are no experiments', () => {
    expect(assignAll([], 'user-1')).toEqual({});
  });
});

describe('assignAllFlags', () => {
  it('keeps every flag the server saw, including the false ones', () => {
    const map = assignAllFlags([FLAG_ON, FLAG_OFF], 'user-1');
    // Both keys present so a consumer can tell "decided off" (present, false)
    // from "never saw it" (absent), the distinction that lets the client fall
    // back to the tracker for unknown flags instead of forcing them off.
    expect(Object.keys(map).sort()).toEqual(['legacy-banner', 'new-checkout']);
    expect(map['new-checkout']).toBe(true);
    expect(map['legacy-banner']).toBe(false);
  });

  it('matches the canonical evaluateFlag for each flag/unit', () => {
    for (const flag of [FLAG_ON, FLAG_OFF, FLAG_ROLLOUT]) {
      for (const unit of UNITS) {
        const map = assignAllFlags([flag], unit);
        expect(map[flag.key]).toBe(evaluateFlag(flag, unit));
      }
    }
  });

  it('returns {} when there are no flags', () => {
    expect(assignAllFlags([], 'user-1')).toEqual({});
  });
});

describe('encodeVariants / decodeVariants round-trip', () => {
  it('round-trips experiment + flag maps in separate namespaces', async () => {
    const experiments = assignAll([TWO_WAY, THREE_WAY], 'user-2');
    const flags = assignAllFlags([FLAG_ON, FLAG_OFF], 'user-2');
    const cookie = await encodeVariants(experiments, flags, { secret: SECRET, epoch: EPOCH });
    const decoded = await decodeVariants(cookie, { secret: SECRET });
    expect(decoded).toEqual({ experiments, flags });
  });

  it('round-trips empty experiment + flag maps', async () => {
    const cookie = await encodeVariants({}, {}, { secret: SECRET, epoch: EPOCH });
    expect(await decodeVariants(cookie, { secret: SECRET })).toEqual({ experiments: {}, flags: {} });
  });

  it('produces a URL-safe cookie value (no +, /, = or whitespace)', async () => {
    const experiments = assignAll([TWO_WAY, THREE_WAY], 'family-42');
    const flags = assignAllFlags([FLAG_ON, FLAG_OFF], 'family-42');
    const cookie = await encodeVariants(experiments, flags, { secret: SECRET, epoch: EPOCH });
    expect(cookie).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe('decodeVariants: tamper resistance (fail closed)', () => {
  it('returns null when the payload is tampered', async () => {
    const cookie = await encodeVariants({ exp: 'control' }, {}, { secret: SECRET, epoch: EPOCH });
    const [payload, sig] = cookie.split('.');
    // Flip a character in the payload while keeping the old signature.
    const tamperedChar = payload![0] === 'A' ? 'B' : 'A';
    const tampered = tamperedChar + payload!.slice(1) + '.' + sig;
    expect(await decodeVariants(tampered, { secret: SECRET })).toBeNull();
  });

  it('returns null when the signature is tampered', async () => {
    const cookie = await encodeVariants({ exp: 'control' }, {}, { secret: SECRET, epoch: EPOCH });
    const [payload, sig] = cookie.split('.');
    const tamperedSigChar = sig![0] === 'A' ? 'B' : 'A';
    const tampered = payload + '.' + tamperedSigChar + sig!.slice(1);
    expect(await decodeVariants(tampered, { secret: SECRET })).toBeNull();
  });

  it('returns null when verified with the wrong secret', async () => {
    const cookie = await encodeVariants({ exp: 'control' }, {}, { secret: SECRET, epoch: EPOCH });
    expect(await decodeVariants(cookie, { secret: 'a-different-secret' })).toBeNull();
  });

  it('returns null for a forged unsigned-looking value', async () => {
    // Attacker base64url-encodes their own payload but cannot sign it.
    const forgedPayload = encodeVariantsPublic({ writer: 'treatment' }, {});
    const forged = `${forgedPayload}.AAAA`;
    expect(await decodeVariants(forged, { secret: SECRET })).toBeNull();
  });

  it('returns null for malformed structure (no dot, empty parts)', async () => {
    expect(await decodeVariants('not-a-cookie', { secret: SECRET })).toBeNull();
    expect(await decodeVariants('.sig', { secret: SECRET })).toBeNull();
    expect(await decodeVariants('payload.', { secret: SECRET })).toBeNull();
    expect(await decodeVariants('.', { secret: SECRET })).toBeNull();
  });
});

describe('decodeVariants: missing inputs fail closed', () => {
  it('returns null for a missing cookie value', async () => {
    expect(await decodeVariants(null, { secret: SECRET })).toBeNull();
    expect(await decodeVariants(undefined, { secret: SECRET })).toBeNull();
    expect(await decodeVariants('', { secret: SECRET })).toBeNull();
  });

  it('returns null when the secret is missing/empty (fail closed)', async () => {
    const cookie = await encodeVariants({ exp: 'control' }, {}, { secret: SECRET, epoch: EPOCH });
    expect(await decodeVariants(cookie, { secret: '' })).toBeNull();
    // @ts-expect-error -- exercising the runtime guard against a missing options object
    expect(await decodeVariants(cookie, undefined)).toBeNull();
  });
});

describe('encodeVariants: producer guards', () => {
  it('throws when no secret is supplied', async () => {
    await expect(
      encodeVariants({ exp: 'control' }, {}, { secret: '', epoch: EPOCH }),
    ).rejects.toThrow(/secret is required/);
  });
});

describe('decodeVariants: epoch binding', () => {
  it('accepts a matching epoch', async () => {
    const cookie = await encodeVariants({ exp: 'control' }, {}, { secret: SECRET, epoch: EPOCH });
    expect(await decodeVariants(cookie, { secret: SECRET, epoch: EPOCH })).toEqual({
      experiments: { exp: 'control' },
      flags: {},
    });
  });

  it('rejects a mismatched epoch', async () => {
    const cookie = await encodeVariants({ exp: 'control' }, {}, { secret: SECRET, epoch: EPOCH });
    expect(await decodeVariants(cookie, { secret: SECRET, epoch: 'cfg-v2' })).toBeNull();
  });

  it('coerces numeric epochs to strings consistently', async () => {
    const cookie = await encodeVariants({ exp: 'control' }, {}, { secret: SECRET, epoch: 7 });
    expect(await decodeVariants(cookie, { secret: SECRET, epoch: '7' })).toEqual({
      experiments: { exp: 'control' },
      flags: {},
    });
    expect(await decodeVariants(cookie, { secret: SECRET, epoch: 7 })).toEqual({
      experiments: { exp: 'control' },
      flags: {},
    });
  });
});

describe('public mirror cookie (client-readable, no secret)', () => {
  it('round-trips experiment + flag maps without a secret', () => {
    const experiments = assignAll([TWO_WAY, THREE_WAY], 'abc123');
    const flags = assignAllFlags([FLAG_ON, FLAG_OFF], 'abc123');
    const pub = encodeVariantsPublic(experiments, flags);
    expect(decodeVariantsPublic(pub)).toEqual({ experiments, flags });
  });

  it('returns null for missing/malformed input', () => {
    expect(decodeVariantsPublic(null)).toBeNull();
    expect(decodeVariantsPublic('')).toBeNull();
    expect(decodeVariantsPublic('@@not-base64@@')).toBeNull();
  });

  it('the signed cookie and the public mirror carry the same maps', async () => {
    const experiments = assignAll([TWO_WAY, THREE_WAY], 'user-1');
    const flags = assignAllFlags([FLAG_ON, FLAG_OFF, FLAG_ROLLOUT], 'user-1');
    const signed = await encodeVariants(experiments, flags, { secret: SECRET, epoch: EPOCH });
    const pub = encodeVariantsPublic(experiments, flags);
    expect(await decodeVariants(signed, { secret: SECRET })).toEqual(decodeVariantsPublic(pub));
  });
});

describe('public mirror carries the experiment key -> id map (WS-A.2 follow-up)', () => {
  it('round-trips the experiment ids alongside variants', () => {
    const experiments = assignAll([TWO_WAY, THREE_WAY], 'abc123');
    const flags = assignAllFlags([FLAG_ON, FLAG_OFF], 'abc123');
    const ids = { [TWO_WAY.key]: TWO_WAY.id, [THREE_WAY.key]: THREE_WAY.id };
    const pub = encodeVariantsPublic(experiments, flags, ids);
    const decoded = decodeVariantsPublic(pub);
    expect(decoded).toEqual({ experiments, flags, experimentIds: ids });
  });

  it('a cookie WITHOUT ids still decodes and degrades exactly as today', () => {
    const experiments = assignAll([TWO_WAY], 'user-2');
    const flags = assignAllFlags([FLAG_ON], 'user-2');
    // No ids passed: payload omits `i` and decode leaves experimentIds undefined,
    // so the variant is still known but id-tagging waits for remote config.
    const pub = encodeVariantsPublic(experiments, flags);
    const decoded = decodeVariantsPublic(pub);
    expect(decoded).toEqual({ experiments, flags });
    expect(decoded?.experimentIds).toBeUndefined();
  });

  it('an empty ids map is treated as no ids (legacy payload shape)', () => {
    const experiments = assignAll([TWO_WAY], 'user-2');
    const withEmpty = encodeVariantsPublic(experiments, {}, {});
    const without = encodeVariantsPublic(experiments, {});
    // Identical bytes: an empty map must not inflate the cookie or change shape.
    expect(withEmpty).toBe(without);
    expect(decodeVariantsPublic(withEmpty)?.experimentIds).toBeUndefined();
  });

  it('the SIGNED cookie is unchanged by ids (no id leak into the signed payload)', async () => {
    const experiments = assignAll([TWO_WAY, THREE_WAY], 'user-1');
    const flags = assignAllFlags([FLAG_ON], 'user-1');
    const signed = await encodeVariants(experiments, flags, { secret: SECRET, epoch: EPOCH });
    const decodedSigned = await decodeVariants(signed, { secret: SECRET });
    // The signed cookie never carries ids.
    expect(decodedSigned).toEqual({ experiments, flags });
    expect(decodedSigned?.experimentIds).toBeUndefined();
  });

  it('PARITY: the id-carrying mirror still agrees with the signed cookie on v + f', async () => {
    const experiments = assignAll([TWO_WAY, THREE_WAY], 'user-1');
    const flags = assignAllFlags([FLAG_ON, FLAG_OFF, FLAG_ROLLOUT], 'user-1');
    const ids = { [TWO_WAY.key]: TWO_WAY.id, [THREE_WAY.key]: THREE_WAY.id };
    const signed = await encodeVariants(experiments, flags, { secret: SECRET, epoch: EPOCH });
    const pub = encodeVariantsPublic(experiments, flags, ids);
    const decodedSigned = await decodeVariants(signed, { secret: SECRET });
    const decodedPub = decodeVariantsPublic(pub);
    expect(decodedPub?.experiments).toEqual(decodedSigned?.experiments);
    expect(decodedPub?.flags).toEqual(decodedSigned?.flags);
  });

  it('fails closed when the ids map has a non-string value', () => {
    // Hand-craft a payload whose `i` carries a number; decode must reject it.
    const bad = btoa(JSON.stringify({ v: { writer: 'control' }, i: { writer: 1 } }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(decodeVariantsPublic(bad)).toBeNull();
  });
});

describe('PARITY: decoded cookie variant === assign() === tracker getVariant()', () => {
  function trackerVariant(exp: ExperimentDefinition, unitId: string): string | null {
    const mgr = new ExperimentManager(unitId);
    mgr.setDefinitions([{ id: exp.id, key: exp.key, variants: exp.variants }], []);
    return mgr.getVariant(exp.key);
  }

  for (const exp of [TWO_WAY, THREE_WAY]) {
    for (const unit of UNITS) {
      it(`${exp.key} / ${unit}: cookie === assign === tracker`, async () => {
        const experiments = assignAll([exp], unit);
        const cookie = await encodeVariants(experiments, {}, { secret: SECRET, epoch: EPOCH });
        const decoded = await decodeVariants(cookie, { secret: SECRET });
        const fromCookie = decoded?.experiments[exp.key] ?? null;
        const fromAssign = assign(exp, unit);
        const fromTracker = trackerVariant(exp, unit);
        expect(fromCookie).toBe(fromAssign);
        expect(fromCookie).toBe(fromTracker);
      });
    }
  }

  it('holds across a large sweep of synthetic units', async () => {
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
    for (let i = 0; i < 200; i++) {
      const unit = `unit-${i}-${(i * 7919) % 101}`;
      const experiments = assignAll([exp], unit);
      const cookie = await encodeVariants(experiments, {}, { secret: SECRET, epoch: EPOCH });
      const decoded = await decodeVariants(cookie, { secret: SECRET });
      expect(decoded?.experiments[exp.key] ?? null).toBe(trackerVariant(exp, unit));
    }
  });
});

describe('PARITY: decoded cookie flag === evaluateFlag() === tracker getFlag()', () => {
  // The end-to-end proof of the flag fix: the middleware evaluates flags via
  // assignAllFlags, encodeVariants carries them in the signed + mirror cookies,
  // and the server/client read them back. If the flag map never made it into the
  // cookie (the original defect), `fromCookie` would be undefined and these fail.
  function trackerFlag(flag: FlagDefinition, unitId: string): boolean {
    const mgr = new ExperimentManager(unitId);
    mgr.setDefinitions([], [{ key: flag.key, enabled: flag.enabled, rolloutPercentage: flag.rolloutPercentage }]);
    return mgr.getFlag(flag.key);
  }

  for (const flag of [FLAG_ON, FLAG_OFF, FLAG_ROLLOUT]) {
    for (const unit of UNITS) {
      it(`${flag.key} / ${unit}: cookie === evaluateFlag === tracker`, async () => {
        const flags = assignAllFlags([flag], unit);
        const cookie = await encodeVariants({}, flags, { secret: SECRET, epoch: EPOCH });
        const decoded = await decodeVariants(cookie, { secret: SECRET });
        // Present in the map (not undefined): the cookie actually carried the flag.
        expect(decoded?.flags).toHaveProperty(flag.key);
        const fromCookie = decoded?.flags[flag.key];
        const fromEvaluate = evaluateFlag(flag, unit);
        const fromTracker = trackerFlag(flag, unit);
        expect(fromCookie).toBe(fromEvaluate);
        expect(fromCookie).toBe(fromTracker);
      });
    }
  }

  it('the public mirror carries the same flag booleans for the client', () => {
    const unit = 'user-1';
    const flags = assignAllFlags([FLAG_ON, FLAG_OFF, FLAG_ROLLOUT], unit);
    const pub = encodeVariantsPublic({}, flags);
    const decoded = decodeVariantsPublic(pub);
    for (const flag of [FLAG_ON, FLAG_OFF, FLAG_ROLLOUT]) {
      expect(decoded?.flags[flag.key]).toBe(trackerFlag(flag, unit));
    }
  });
});

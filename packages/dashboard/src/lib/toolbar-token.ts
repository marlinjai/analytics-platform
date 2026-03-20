/**
 * Toolbar token utilities — create and verify short-lived HMAC-SHA256 tokens
 * used by the heatmap toolbar bookmarklet.
 */

async function getHmacKey(): Promise<CryptoKey> {
  const secret = process.env.NEXTAUTH_SECRET!;
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createToolbarToken(
  userId: string,
  projectId: string,
): Promise<string> {
  const payload = JSON.stringify({
    sub: userId,
    pid: projectId,
    exp: Date.now() + 3_600_000, // 1 hour
  });

  const payloadB64 = Buffer.from(payload).toString('base64url');
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadB64),
  );
  const sigB64 = Buffer.from(sig).toString('base64url');

  return `${payloadB64}.${sigB64}`;
}

export async function verifyToolbarToken(
  token: string,
): Promise<{ sub: string; pid: string; exp: number } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadB64, sigB64] = parts as [string, string];

    const key = await getHmacKey();
    const sigBytes = Buffer.from(sigB64, 'base64url');

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64),
    );

    if (!valid) return null;

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8'),
    ) as { sub: string; pid: string; exp: number };

    if (payload.exp <= Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

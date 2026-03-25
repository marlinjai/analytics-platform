import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

type Params = { params: Promise<{ code: string }> };

// GET — Resolve a test link code (public, no auth needed)
// Called by the consuming app (e.g., lola-stories) to get the config for a code
export async function GET(_request: NextRequest, { params }: Params) {
  const { code } = await params;
  const db = getDb();

  const [link] = await db`
    SELECT code, label, variant, language, target_url, auto_consent
    FROM test_links
    WHERE code = ${code} AND active = true
  `;

  if (!link) {
    return NextResponse.json({ error: 'Invalid or expired invite code' }, { status: 404 });
  }

  // Cache for 5 minutes — codes don't change often
  return NextResponse.json(
    {
      code: link.code,
      label: link.label,
      variant: link.variant,
      language: link.language,
      targetUrl: link.target_url,
      autoConsent: link.auto_consent,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}

import { NextResponse } from 'next/server';

// NextAuth is no longer used. Auth is handled by auth-brain (auth.lumitra.co).
// This stub catches any stale requests to /api/auth/* and redirects to auth-brain.
const authBrainUrl = process.env.AUTH_BRAIN_URL ?? 'https://auth.lumitra.co';

export function GET() {
  return NextResponse.redirect(new URL('/login', authBrainUrl));
}

export function POST() {
  return NextResponse.redirect(new URL('/login', authBrainUrl));
}

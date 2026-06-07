---
title: Getting Started
---

# Getting Started

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose (for databases)

## Installation

```bash
cd projects/analytics-platform
pnpm install
```

## Start Development Databases

```bash
docker compose up -d postgres clickhouse
```

This starts:
- **PostgreSQL 16** on port 5432 (projects, users, API keys)
- **ClickHouse 24** on port 8123/9000 (event data)

## Start the Dashboard

```bash
pnpm dev
```

Opens at [http://localhost:3000](http://localhost:3000).

## Add the Tracker to Your Site

The tracker is **cookie-free** and does not fingerprint users — no consent banner required under GDPR/ePrivacy.

### Quick setup via CLI (recommended)

The `lumitra` CLI creates your analytics project, generates an API key, and writes the required environment variables in one command.

```bash
npx @marlinjai/analytics-cli analytics init
```

On first run it opens your browser to authenticate against your dashboard. Credentials are cached at `~/.lumitra/credentials.json` for subsequent runs.

**What it does:**

1. Authenticates via device code flow (browser, one-time)
2. Creates an analytics project for the current directory (or reuses one if the domain already exists)
3. Generates an `ap_live_` API key
4. Writes `NEXT_PUBLIC_ANALYTICS_PROJECT_ID`, `NEXT_PUBLIC_ANALYTICS_API_KEY`, and `NEXT_PUBLIC_ANALYTICS_ENDPOINT` to `.env.local`

**Infisical users** — if `.infisical.json` is present in the project directory, the CLI writes directly to Infisical instead of `.env.local`:

```bash
# Single app
npx @marlinjai/analytics-cli analytics init --infisical-env=prod

# Monorepo with per-app Infisical folders — run from the app subdirectory
npx @marlinjai/analytics-cli analytics init --infisical-env=prod --infisical-path=/landing
```

The `--infisical-path` flag maps to the folder path within your Infisical project, so secrets for each app land in the right place and Vercel sync picks them up automatically without any manual copy-paste.

**All flags:**

| Flag | Description |
|------|-------------|
| `--skill` | Only install the Claude Code skill file, skip credentials |
| `--infisical-env=<env>` | Write to this Infisical environment (default: project's `defaultEnvironment`) |
| `--infisical-path=<path>` | Write to this Infisical folder path (e.g. `/landing`) |

### Install via npm (manual)

```bash
pnpm add @marlinjai/analytics-tracker
```

### Next.js integration

Create a wrapper component and render it in your root layout:

```tsx
// components/LumitraAnalytics.tsx
'use client';

import { useEffect } from 'react';
import { init } from '@marlinjai/analytics-tracker';

export function LumitraAnalytics() {
  useEffect(() => {
    init({
      projectId: process.env.NEXT_PUBLIC_ANALYTICS_PROJECT_ID!,
      endpoint: 'https://analytics.lumitra.co/api/collect',
    });
  }, []);

  return null;
}
```

```tsx
// app/layout.tsx
import { LumitraAnalytics } from '@/components/LumitraAnalytics';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <LumitraAnalytics />
      </body>
    </html>
  );
}
```

Set `NEXT_PUBLIC_ANALYTICS_PROJECT_ID` in your `.env.local` to the project ID shown in the analytics dashboard settings.

### Plain HTML integration

```html
<script type="module">
  import { init } from 'https://unpkg.com/@marlinjai/analytics-tracker/dist/index.js';

  init({
    projectId: 'your-project-uuid',
    endpoint: 'https://analytics.lumitra.co/api/collect',
  });
</script>
```

### Optional features

```typescript
init({
  projectId: 'your-project-uuid',
  endpoint: 'https://analytics.lumitra.co/api/collect',
  replay: true,    // Enable session replay (lazy-loads rrweb)
  heatmap: true,   // Enable click heatmaps
});
```

### Privacy

The tracker uses IP hashing for anonymous session identification. No cookies are set and no persistent identifiers are stored in the browser — no consent banner is required under GDPR or ePrivacy regulations.

## Browser Extension

The analytics platform includes a Chrome extension that lets you view heatmap overlays directly on any tracked page, bypassing Content Security Policy restrictions that would otherwise block iframe or script injection.

### What it does

The extension injects a Shadow DOM overlay onto the page you are viewing, fetches heatmap click data from your dashboard, and renders it using a bundled copy of heatmap.js — no CDN requests, no CSP conflicts. A popup lets you pick the project, date range, and device type without leaving the page.

### Loading the extension in Chrome (developer mode)

1. Build the extension:

   ```bash
   pnpm --filter @analytics-platform/extension build
   ```

2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** and select the `packages/extension/dist/` directory.
5. The Lumitra Analytics extension icon will appear in your toolbar.

### Connecting it to your dashboard

1. Click the extension icon to open the popup.
2. Enter your dashboard URL (e.g. `https://analytics.lumitra.co`) and sign in when prompted — the extension stores a toolbar token in `chrome.storage.local`.
3. Select your project, date range, and device type from the popup.
4. Navigate to any page that has the tracker installed and click **Show heatmap** to activate the overlay.

The overlay persists across client-side navigation in SPAs and can be toggled on or off at any time from the popup.

## Password Reset

The dashboard ships with a built-in password reset flow. Users can request a reset link from the login page (`/login` → "Forgot your password?"). The link is sent via [Resend](https://resend.com) and expires after 1 hour.

Required env vars:

```env
RESEND_API_KEY=re_your_key_here
RESEND_FROM_EMAIL=noreply@yourdomain.com  # must be from a verified Resend domain
```

If `RESEND_API_KEY` is not set, the forgot-password form will appear but emails will not be sent.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint | `http://localhost:8123` |
| `CLICKHOUSE_USER` | ClickHouse username | `default` |
| `CLICKHOUSE_PASSWORD` | ClickHouse password | — |
| `AUTH_SECRET` | NextAuth v5 session secret — generate with `openssl rand -base64 32` | — |
| `AUTH_URL` | Public URL of the dashboard (optional in most deployments, inferred from headers) | — |
| `AUTH_GITHUB_ID` | GitHub OAuth App client ID (optional) | — |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret (optional) | — |
| `RESEND_API_KEY` | Resend API key for password reset emails | — |
| `RESEND_FROM_EMAIL` | From address for password reset emails | `noreply@lumitra.co` |
| `SEED_USER_EMAIL` | Admin user created automatically on `pnpm dev` | `admin@localhost` |
| `SEED_USER_PASSWORD` | Password for the seed admin user | `admin123` |

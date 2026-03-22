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

### Install via npm

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

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint | `http://localhost:8123` |
| `CLICKHOUSE_USER` | ClickHouse username | `default` |
| `CLICKHOUSE_PASSWORD` | ClickHouse password | — |
| `NEXTAUTH_SECRET` | NextAuth session secret | — |
| `NEXTAUTH_URL` | Public URL for NextAuth | `http://localhost:3000` |

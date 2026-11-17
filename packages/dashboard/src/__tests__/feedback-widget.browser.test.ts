// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://analytics.lumitra.co/overview" }
/**
 * In the browser on the production origin: the widget renders, and the views
 * that need data from the browser (the engagement zones table) are masked.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { EngagementZonesTable } from '@/components/charts/EngagementZonesTable';
import { RevealedKey } from '@/components/ui/RevealedKey';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
async function mount(el: ReturnType<typeof createElement>) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(el));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  vi.unstubAllGlobals();
});

describe('on https://analytics.lumitra.co', () => {
  it('renders the widget element and hoists the pinned script', async () => {
    const host = await mount(createElement(FeedbackWidget));
    expect(host.querySelector('feedback-widget')).not.toBeNull();
    expect(document.querySelector('script[src*="/widget/feedback-widget.0.0.1.js"]')?.getAttribute('integrity')).toMatch(/^sha384-/);
  });

  it('masks the engagement zones table once its rows arrive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ selectors: [{ selector: '#checkout', count: 5, sessions: 2 }] }) })),
    );
    const host = await mount(
      createElement(EngagementZonesTable, {
        projectId: 'p',
        url: '/cart?email=e',
        dateRange: { from: '2026-11-01', to: '2026-11-17' },
        deviceType: '',
      }),
    );
    await act(async () => {});
    const cell = [...host.querySelectorAll('td')].find((td) => td.textContent?.includes('#checkout'));
    expect(cell).toBeDefined();
    expect(cell!.closest('[data-feedback-mask]')).not.toBeNull();
  });

  it('masks a freshly created API key', async () => {
    const host = await mount(createElement(RevealedKey, { value: 'ap_live_example', copied: false, onCopy: () => {} }));
    const code = [...host.querySelectorAll('code')].find((c) => c.textContent === 'ap_live_example');
    expect(code?.closest('[data-feedback-mask]')).not.toBeNull();
  });
});

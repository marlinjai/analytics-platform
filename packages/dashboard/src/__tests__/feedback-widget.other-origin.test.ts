// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/overview" }
/** In the browser on any other origin the publishable key would be refused, so nothing renders. */
import { describe, it, expect } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('on another origin', () => {
  it('renders neither the element nor the script', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    await act(async () => root.render(createElement(FeedbackWidget)));
    expect(host.innerHTML).toBe('');
    expect(document.querySelector('script[src*="feedback-widget"]')).toBeNull();
    await act(async () => root.unmount());
  });
});

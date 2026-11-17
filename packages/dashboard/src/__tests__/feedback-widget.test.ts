/**
 * Lumitra Feedback in the dashboard: the pinned script and element, nothing
 * rendered away from the production origin, and the masks that keep tracked
 * visitors' data and fresh API keys out of a feedback screenshot.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FeedbackWidget,
  FeedbackWidgetView,
  FEEDBACK_WIDGET_INTEGRITY,
  FEEDBACK_WIDGET_SRC,
} from '@/components/feedback/FeedbackWidget';
import { TopPagesTable } from '@/components/charts/TopPagesTable';
import { RageClicksTable } from '@/components/charts/RageClicksTable';
import { FilterPills } from '@/components/layout/FilterPills';

describe('FeedbackWidget', () => {
  it('pins the script by its integrity hash and configures the element', () => {
    const html = renderToStaticMarkup(createElement(FeedbackWidgetView));
    expect(html).toContain(`src="${FEEDBACK_WIDGET_SRC}"`);
    expect(html).toContain(`integrity="${FEEDBACK_WIDGET_INTEGRITY}"`);
    expect(html).toContain('crossorigin="anonymous"');
    expect(html).toMatch(/<feedback-widget publishable-key="pk_live_[^"]+" api-base="https:\/\/api\.feedback\.lumitra\.co" locale="en" theme="dark">/);
  });

  it('renders nothing outside the browser on the production origin', () => {
    expect(renderToStaticMarkup(createElement(FeedbackWidget))).toBe('');
  });
});

describe('screenshot masks', () => {
  const masked = (html: string, text: string) => {
    const at = html.indexOf(text);
    expect(at).toBeGreaterThan(-1);
    expect(html.slice(0, at)).toMatch(/data-feedback-mask/);
  };

  it('masks the top pages table', () => {
    const html = renderToStaticMarkup(
      createElement(TopPagesTable, { pages: [{ url: '/reset?token=t', views: 3, visitors: 2 }], loading: false }),
    );
    masked(html, '/reset?token=t');
  });

  it('masks the rage clicks table', () => {
    const html = renderToStaticMarkup(
      createElement(RageClicksTable, { data: [{ selector: '#buy', url: '/cart?email=e', count: 4, sessions: 1 }], loading: false }),
    );
    masked(html, '/cart?email=e');
  });

  it('masks the filter pills', () => {
    const html = renderToStaticMarkup(
      createElement(FilterPills, { filters: { page: '/account?id=7' }, onRemove: () => {}, onClearAll: () => {} }),
    );
    masked(html, '/account?id=7');
  });
});

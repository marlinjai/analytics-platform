'use client';

import { useSyncExternalStore } from 'react';

/**
 * Lumitra Feedback on the signed-in dashboard (dogfood, go-live stage 4 of the
 * feedback service): a floating button that sends feedback, optionally with a
 * masked screenshot, to the feedback service's "Analytics (dogfood)" project,
 * which delivers it by email to the owner.
 *
 * Mounted only in the dashboard shell (`src/app/(dashboard)/layout.tsx`),
 * after the session, grant and company checks, so only signed-in members of a
 * granted company see it; /login and /request-access never load the script.
 *
 * - The script is the service's own copy of the widget, pinned to one version
 *   by its Subresource Integrity (SRI) hash (the hashes are listed per version
 *   in the service's `packages/sdk/cdn-releases.json`). A new widget version
 *   means a new file name and hash here.
 * - The publishable key is public by design: it only lets this origin
 *   (https://analytics.lumitra.co) send feedback to that one project. On any
 *   other origin (local development, a preview) every send would be refused,
 *   so the widget is not rendered there at all.
 * - Visitors' data stays out of a screenshot: replays and heatmaps are drawn
 *   in iframes and the URL picker is a select, which the widget paints black;
 *   the session list, the page tables (top pages, rage clicks, engagement
 *   zones), the heatmap's page lists, the filter pills and a freshly created
 *   API key are marked `data-feedback-mask`.
 * - The page address is sent without its query string; on a replay page its
 *   path carries the pseudonymous session id of a tracked visit, which only
 *   the operator receives.
 * - Feedback is anonymous by design while only the owner and Lumitra staff
 *   hold this app (the sender may leave a reply address), and there is no
 *   privacy link because the app has no privacy page yet: both to revisit
 *   before any outside company is granted the app.
 */
export const FEEDBACK_ORIGIN = 'https://analytics.lumitra.co';
export const FEEDBACK_API_BASE = 'https://api.feedback.lumitra.co';
export const FEEDBACK_WIDGET_SRC = `${FEEDBACK_API_BASE}/widget/feedback-widget.0.0.1.js`;
export const FEEDBACK_WIDGET_INTEGRITY = 'sha384-5/xhEMhMdE0ZSyKvAwQeen3uDRzV8pM5rKqNhJkAnT611nUTy7/YWwjF4Vil/k1i';
export const FEEDBACK_PUBLISHABLE_KEY = 'pk_live_5BChNOd1LgixWyLMWE4KBquJrb0QyRCO';

const noSubscribe = () => () => {};

/** True only in the browser on the production origin; false on the server and everywhere else. */
function useOnFeedbackOrigin(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => window.location.origin === FEEDBACK_ORIGIN,
    () => false,
  );
}

/** The script and the element, without the origin check (exported for tests). */
export function FeedbackWidgetView() {
  return (
    <>
      {/*
        React 19 hoists a script that has both `async` and `src` into the head and loads it once per address,
        however often this renders; without `async` it would stay in place and not be deduplicated.
      */}
      <script async src={FEEDBACK_WIDGET_SRC} integrity={FEEDBACK_WIDGET_INTEGRITY} crossOrigin="anonymous" />
      <feedback-widget
        publishable-key={FEEDBACK_PUBLISHABLE_KEY}
        api-base={FEEDBACK_API_BASE}
        locale="en"
        theme="dark"
      />
    </>
  );
}

export function FeedbackWidget() {
  return useOnFeedbackOrigin() ? <FeedbackWidgetView /> : null;
}

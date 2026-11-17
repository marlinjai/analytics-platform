/**
 * Lumitra Feedback on the signed-in dashboard (dogfood, go-live stage 4 of the
 * feedback service): a floating button that sends feedback, optionally with a
 * masked screenshot, to the feedback service's "analytics" project, which
 * delivers it by email to the owner.
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
 *   (https://analytics.lumitra.co) send feedback to that one project.
 * - Visitors' data stays out of a screenshot: replays and heatmaps are drawn
 *   in iframes, which the widget paints black, and the session list is
 *   marked `data-feedback-mask`.
 */
export const FEEDBACK_API_BASE = 'https://api.feedback.lumitra.co';
export const FEEDBACK_WIDGET_SRC = `${FEEDBACK_API_BASE}/widget/feedback-widget.0.0.1.js`;
export const FEEDBACK_WIDGET_INTEGRITY = 'sha384-5/xhEMhMdE0ZSyKvAwQeen3uDRzV8pM5rKqNhJkAnT611nUTy7/YWwjF4Vil/k1i';
export const FEEDBACK_PUBLISHABLE_KEY = 'pk_live_5BChNOd1LgixWyLMWE4KBquJrb0QyRCO';

export function FeedbackWidget() {
  return (
    <>
      {/* React 19 hoists an async script into the head and loads it once. */}
      <script async src={FEEDBACK_WIDGET_SRC} integrity={FEEDBACK_WIDGET_INTEGRITY} crossOrigin="anonymous" />
      {/* The widget adds its own shadow root and attributes once its script runs, so hydration leaves it alone. */}
      <feedback-widget
        publishable-key={FEEDBACK_PUBLISHABLE_KEY}
        api-base={FEEDBACK_API_BASE}
        locale="en"
        theme="dark"
        suppressHydrationWarning
      />
    </>
  );
}

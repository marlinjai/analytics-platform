/**
 * The analytics action vocabulary (S2: projects belong to a COMPANY).
 *
 * A project belongs to an auth-brain COMPANY (tenant); access is company
 * membership, and this map is the SINGLE SOURCE OF TRUTH for what minimum
 * company role each analytics action requires. Unlike Studio (whose every action
 * is `tenant.member`), analytics has genuinely distinct tiers:
 *
 *   - read  -> `tenant.viewer`  stats, funnels, heatmaps, session replay,
 *              reading experiments/flags, exports.
 *   - write -> `tenant.member`  create/edit/start/stop experiments, flags,
 *              funnels, test links.
 *   - admin -> `tenant.admin`   project settings, project + account API keys,
 *              the destructive project reset, project creation and deletion.
 *
 * The tenant role ladder is `owner | admin | billing_admin | member | viewer`
 * (viewer lowest, read-only). Two rules are NOT negotiable and are enforced in
 * `hasCompanyAccess` (project-access.ts), which this vocabulary feeds:
 *   - destructive and credential-minting actions require `tenant.admin`.
 *   - `billing_admin` authorises billing ONLY; it never satisfies any
 *     viewer/member/admin check here.
 *
 * The `requires` values are typed as `PermissionRequirement` (published by the
 * auth-brain SDK); the `satisfies` clause makes a typo like `tenant.editor` a
 * compile error. This is a type-only import — erased at build time, so the module
 * never pulls the SDK runtime into a route bundle.
 */
import type { PermissionRequirement } from '@marlinjai/auth-brain-sdk';

/**
 * The company-membership requirement a route enforces — the three analytics
 * tiers, derived from the published `PermissionRequirement` union via `Extract`
 * so the tie to auth-brain is compile-checked: if `tenant.viewer` were ever
 * dropped upstream, every entry below that uses it would fail to compile rather
 * than silently degrade.
 */
export type CompanyRequirement = Extract<
  PermissionRequirement,
  'tenant.viewer' | 'tenant.member' | 'tenant.admin'
>;

/** An analytics action's mapping onto a `tenant.<role>` requirement. */
interface AnalyticsPermissionDef {
  requires: CompanyRequirement;
  description: string;
}

/**
 * The analytics action vocabulary. Each action maps to the minimum company role
 * that may perform it. Derived from the real project-scoped routes.
 */
export const ANALYTICS_PERMISSIONS = {
  // --- read (tenant.viewer) ---
  'analytics.stats.read': {
    requires: 'tenant.viewer',
    description: 'Read stats: pageviews, sources, pages, devices, browsers, OS, countries, realtime, scroll, rage-clicks.',
  },
  'analytics.stats.export': {
    requires: 'tenant.viewer',
    description: 'Export stats for the project.',
  },
  'analytics.funnels.read': {
    requires: 'tenant.viewer',
    description: 'Read funnels and funnel results.',
  },
  'analytics.heatmap.read': {
    requires: 'tenant.viewer',
    description: 'Read heatmaps: snapshots, selectors, clicks, versions.',
  },
  'analytics.sessions.read': {
    requires: 'tenant.viewer',
    description: 'List sessions and read session replays.',
  },
  'analytics.experiments.read': {
    requires: 'tenant.viewer',
    description: 'Read experiments, their goals and results.',
  },
  'analytics.flags.read': {
    requires: 'tenant.viewer',
    description: 'Read feature flags.',
  },
  'analytics.toolbar.token': {
    requires: 'tenant.viewer',
    description: 'Mint a short-lived toolbar token for a project the caller can read.',
  },

  // --- write (tenant.member) ---
  'analytics.experiments.write': {
    requires: 'tenant.member',
    description: 'Create, edit, start, stop or delete experiments and their goals.',
  },
  'analytics.flags.write': {
    requires: 'tenant.member',
    description: 'Create, edit or delete feature flags.',
  },
  'analytics.funnels.write': {
    requires: 'tenant.member',
    description: 'Create, edit or delete funnels.',
  },
  'analytics.testlinks.write': {
    requires: 'tenant.member',
    description: 'Create experiment test links.',
  },

  // --- admin (tenant.admin): settings, credentials, destructive, lifecycle ---
  'analytics.project.settings': {
    requires: 'tenant.admin',
    description: 'Edit project settings (name, domain, allowed origins).',
  },
  'analytics.project.apikeys': {
    requires: 'tenant.admin',
    description: 'Create or revoke project API keys (credential minting).',
  },
  'analytics.account.apikeys': {
    requires: 'tenant.admin',
    description: 'Create or revoke account API keys (credential minting).',
  },
  'analytics.project.reset': {
    requires: 'tenant.admin',
    description: 'Destructively reset a project (wipe its analytics data).',
  },
  'analytics.project.create': {
    requires: 'tenant.admin',
    description: 'Create a project under a company.',
  },
  'analytics.project.delete': {
    requires: 'tenant.admin',
    description: 'Delete a project.',
  },
} satisfies Record<string, AnalyticsPermissionDef>;

export type AnalyticsAction = keyof typeof ANALYTICS_PERMISSIONS;

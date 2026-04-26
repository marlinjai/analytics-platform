'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCurrentProjectId } from '@/components/layout/ProjectSwitcher';
import { SkeletonProjectList, SkeletonKeyList } from '@/components/ui/Skeleton';

// ---------------------------------------------------------------------------
// SDK Settings types & defaults
// ---------------------------------------------------------------------------
interface SdkSettings {
  replay: boolean;
  heatmap: boolean;
  scrollDepth: boolean;
}

const SDK_DEFAULTS: SdkSettings = {
  replay: false,
  heatmap: true,
  scrollDepth: true,
};

const SDK_TOGGLE_LABELS: Record<keyof SdkSettings, { label: string; description: string }> = {
  replay: {
    label: 'Session Replay',
    description: 'Record and replay user sessions. Increases data volume.',
  },
  heatmap: {
    label: 'Heatmaps',
    description: 'Track click and scroll heatmap data.',
  },
  scrollDepth: {
    label: 'Scroll Depth',
    description: 'Measure how far down the page users scroll.',
  },
};

interface Project {
  id: string;
  name: string;
  domain: string;
  allowed_origins: string[];
}

interface ApiKey {
  id: string;
  prefix: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// ---------------------------------------------------------------------------
// Team types
// ---------------------------------------------------------------------------
interface Member {
  id: string;
  email: string;
  name: string | null;
  role: string;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  token: string;
  created_at: string;
  expires_at: string;
  invited_by_name: string | null;
  invited_by_email: string;
}

// ---------------------------------------------------------------------------
// Role badge helper
// ---------------------------------------------------------------------------
function RoleBadge({ role }: { role: string }) {
  const colours: Record<string, string> = {
    owner: 'bg-purple-500/10 text-purple-400',
    admin: 'bg-blue-500/10 text-blue-400',
    viewer: 'bg-gray-500/10 text-gray-400',
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${colours[role] ?? colours.viewer}`}
    >
      {role}
    </span>
  );
}

// ── Developer Tools Section ────────────────────────────────────────────────

function DeveloperToolsSection({ projectId }: { projectId: string }) {
  const [copiedApi, setCopiedApi] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);

  const endpoint = 'https://analytics.lumitra.co';

  const apiSnippet = `curl -X GET ${endpoint}/api/projects/${projectId}/experiments \\
  -H "X-API-Key: <your-api-key>"`;

  const installSnippet = 'npx @marlinjai/lumitra-cli init';

  async function copyApiSnippet() {
    await navigator.clipboard.writeText(apiSnippet);
    setCopiedApi(true);
    setTimeout(() => setCopiedApi(false), 2000);
  }

  async function copyInstallSnippet() {
    await navigator.clipboard.writeText(installSnippet);
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  }

  function handleDownloadSkill() {
    const skillContent = `---
name: lumitra
description: Create and manage A/B tests, feature flags, and experiments via Lumitra Analytics API
---

# Lumitra Analytics

## Setup
Project ID: ${projectId}
Endpoint: ${endpoint}

Read API key from environment: LUMITRA_API_KEY

## Authentication
X-API-Key: {your-api-key-here}

## API Reference

### Experiments
GET    ${endpoint}/api/projects/${projectId}/experiments
POST   ${endpoint}/api/projects/${projectId}/experiments
POST   ${endpoint}/api/projects/${projectId}/experiments/{id}/goals
POST   ${endpoint}/api/projects/${projectId}/experiments/{id}/start
POST   ${endpoint}/api/projects/${projectId}/experiments/{id}/stop
GET    ${endpoint}/api/projects/${projectId}/experiments/{id}/results

### Feature Flags
GET    ${endpoint}/api/projects/${projectId}/flags
POST   ${endpoint}/api/projects/${projectId}/flags
PATCH  ${endpoint}/api/projects/${projectId}/flags/{id}
DELETE ${endpoint}/api/projects/${projectId}/flags/{id}

### Create Experiment
POST body: { key, name, hypothesis, variants: [{key, weight}], targeting: {} }

### Create Flag
POST body: { key, name, enabled, rollout_percentage }

### Integration Code

React:
import { useLumitraVariant } from '@marlinjai/analytics-react';
const variant = useLumitraVariant('experiment-key');

Vanilla JS:
const variant = tracker.getVariant('experiment-key');

When creating experiments, generate integration code and edit the relevant component.
When checking results, call the results endpoint and report the Bayesian analysis.
`;

    const blob = new Blob([skillContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lumitra.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
      <div className="mb-1">
        <h2 className="text-lg font-semibold text-gray-100">Developer Tools</h2>
        <p className="mt-0.5 text-xs text-gray-400">
          Programmatic access, CLI tools, and AI-agent integrations for your project.
        </p>
      </div>

      <div className="mt-5 space-y-6">
        {/* API Key Usage */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-300">API Key Usage</h3>
          <p className="mb-3 text-xs text-gray-400">
            Use your API key to access experiments and flags programmatically.
          </p>
          <div className="relative rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
            <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed text-gray-300">
              <code>{apiSnippet}</code>
            </pre>
            <button
              onClick={copyApiSnippet}
              className="absolute right-2 top-2 rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600 transition"
            >
              {copiedApi ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Claude Code Skill download */}
        <div className="rounded-lg border border-gray-800 bg-gray-800/30 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-gray-200">Claude Code Skill</h3>
              <p className="mt-1 text-xs text-gray-400">
                Download a pre-configured skill file for Claude Code. It includes your project ID,
                all API endpoints, and integration patterns so the AI agent can create and manage
                experiments on your behalf.
              </p>
            </div>
            <button
              onClick={handleDownloadSkill}
              className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Skill
            </button>
          </div>
        </div>

        {/* Quick install */}
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-300">Quick Install</h3>
          <p className="mb-3 text-xs text-gray-400">
            Set up the Lumitra SDK in your project with a single command.
          </p>
          <div className="relative rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
            <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed text-gray-300">
              <code>{installSnippet}</code>
            </pre>
            <button
              onClick={copyInstallSnippet}
              className="absolute right-2 top-2 rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600 transition"
            >
              {copiedInstall ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => { if (d.id) setCurrentUserId(d.id); })
      .catch(() => {});
  }, []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const selectedProjectId = useCurrentProjectId() ?? '';
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);

  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyEnvironment, setNewKeyEnvironment] = useState<'live' | 'test'>('live');
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null);

  // SDK settings state
  const [sdkSettings, setSdkSettings] = useState<SdkSettings>(SDK_DEFAULTS);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Team state
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'viewer'>('viewer');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Allowed origins state
  const [allowedOriginsText, setAllowedOriginsText] = useState<string>('');
  const [allowedOriginsStatus, setAllowedOriginsStatus] = useState<string>('');

  useEffect(() => {
    const project = projects.find((p) => p.id === selectedProjectId);
    setAllowedOriginsText((project?.allowed_origins ?? []).join('\n'));
    setAllowedOriginsStatus('');
  }, [selectedProjectId, projects]);

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyInviteUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  /** Derive environment from stored prefix value */
  function envFromPrefix(prefix: string): 'live' | 'test' {
    return prefix.startsWith('ap_test_') ? 'test' : 'live';
  }

  // Rotate key: create new key with same label+env, then revoke old key
  async function handleRotateKey(key: ApiKey) {
    if (!confirm(`Rotate key "${key.label}"? The current key will be revoked and a new one created.`)) return;
    setRotatingKeyId(key.id);
    setRevealedKey(null);
    try {
      const environment = envFromPrefix(key.prefix);
      // 1. Create new key
      const createRes = await fetch(`/api/projects/${selectedProjectId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: key.label, environment }),
      });
      if (!createRes.ok) throw new Error('Failed to create replacement key');
      const createData = await createRes.json();
      const newFullKey: string = createData.key.fullKey;

      // 2. Revoke old key
      await fetch(`/api/projects/${selectedProjectId}/keys/${key.id}`, { method: 'DELETE' });

      // 3. Show new key
      setRevealedKey(newFullKey);
      fetchKeys(selectedProjectId);
    } catch {
      // silently ignore — user can retry
    } finally {
      setRotatingKeyId(null);
    }
  }

  // Fetch SDK settings for the selected project
  const fetchSettings = useCallback(async (projectId: string) => {
    if (!projectId) {
      setSdkSettings(SDK_DEFAULTS);
      return;
    }
    setLoadingSettings(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error('Failed to fetch settings');
      const data = await res.json();
      setSdkSettings({ ...SDK_DEFAULTS, ...(data.settings ?? {}) });
    } catch {
      setSdkSettings(SDK_DEFAULTS);
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  // Toggle a single SDK setting
  async function handleToggle(key: keyof SdkSettings) {
    if (!selectedProjectId) return;
    const newValue = !sdkSettings[key];
    setSdkSettings((prev) => ({ ...prev, [key]: newValue }));
    setSavingSettings(true);
    try {
      await fetch(`/api/projects/${selectedProjectId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newValue }),
      });
    } catch {
      // Revert optimistic update on failure
      setSdkSettings((prev) => ({ ...prev, [key]: !newValue }));
    } finally {
      setSavingSettings(false);
    }
  }

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Fetch keys when selected project changes
  const fetchKeys = useCallback(async (projectId: string) => {
    if (!projectId) {
      setKeys([]);
      return;
    }
    setLoadingKeys(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/keys`);
      if (!res.ok) throw new Error('Failed to fetch keys');
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      setKeys([]);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  // Fetch team members
  const fetchMembers = useCallback(async (projectId: string) => {
    if (!projectId) {
      setMembers([]);
      return;
    }
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`);
      if (!res.ok) throw new Error('Failed to fetch members');
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  // Fetch pending invitations
  const fetchInvitations = useCallback(async (projectId: string) => {
    if (!projectId) {
      setInvitations([]);
      return;
    }
    setLoadingInvitations(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/invitations`);
      // 403 means user is not owner/admin — silently hide invitations
      if (res.status === 403) {
        setInvitations([]);
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch invitations');
      const data = await res.json();
      setInvitations(data.invitations ?? []);
    } catch {
      setInvitations([]);
    } finally {
      setLoadingInvitations(false);
    }
  }, []);

  useEffect(() => {
    setRevealedKey(null);
    setNewInviteUrl(null);
    fetchKeys(selectedProjectId);
    fetchSettings(selectedProjectId);
    fetchMembers(selectedProjectId);
    fetchInvitations(selectedProjectId);
  }, [selectedProjectId, fetchKeys, fetchSettings, fetchMembers, fetchInvitations]);

  // Delete project
  async function handleDeleteProject(project: Project) {
    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedProjectId === project.id) {
        try { localStorage.removeItem('ap_current_project'); } catch {}
        window.dispatchEvent(new CustomEvent('ap-project-changed', { detail: '' }));
        setKeys([]);
      }
    }
  }

  // Save allowed origins
  async function saveAllowedOrigins() {
    if (!selectedProjectId) return;
    const lines = allowedOriginsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    setAllowedOriginsStatus('Saving...');
    const res = await fetch(`/api/projects/${selectedProjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowedOrigins: lines }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAllowedOriginsStatus(`Error: ${data.error ?? res.statusText}`);
      return;
    }
    const data = await res.json();
    setProjects((prev) =>
      prev.map((p) =>
        p.id === selectedProjectId
          ? { ...p, allowed_origins: data.project.allowed_origins ?? [] }
          : p
      )
    );
    setAllowedOriginsStatus('Saved');
    setTimeout(() => setAllowedOriginsStatus(''), 2000);
  }

  // Revoke key
  async function handleRevokeKey(keyId: string) {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    const res = await fetch(`/api/projects/${selectedProjectId}/keys/${keyId}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      fetchKeys(selectedProjectId);
    }
  }

  // Create key
  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProjectId || !newKeyLabel.trim()) return;
    setCreatingKey(true);
    setRevealedKey(null);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newKeyLabel.trim(), environment: newKeyEnvironment }),
      });
      if (!res.ok) throw new Error('Failed to create key');
      const data = await res.json();
      setRevealedKey(data.key.fullKey);
      setNewKeyLabel('');
      fetchKeys(selectedProjectId);
    } catch {
      // ignore
    } finally {
      setCreatingKey(false);
    }
  }

  // Remove a member
  async function handleRemoveMember(member: Member) {
    if (!confirm(`Remove ${member.name ?? member.email} from this project?`)) return;
    const res = await fetch(
      `/api/projects/${selectedProjectId}/members?userId=${member.id}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      fetchMembers(selectedProjectId);
    }
  }

  // Send invitation
  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProjectId || !inviteEmail.trim()) return;
    setSendingInvite(true);
    setNewInviteUrl(null);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? 'Failed to create invitation');
        return;
      }
      const data = await res.json();
      setNewInviteUrl(data.acceptUrl);
      setInviteEmail('');
      fetchInvitations(selectedProjectId);
    } catch {
      // ignore
    } finally {
      setSendingInvite(false);
    }
  }

  // Revoke invitation
  async function handleRevokeInvitation(invitationId: string) {
    if (!confirm('Revoke this invitation?')) return;
    const res = await fetch(
      `/api/projects/${selectedProjectId}/invitations?invitationId=${invitationId}`,
      { method: 'DELETE' }
    );
    if (res.ok) {
      fetchInvitations(selectedProjectId);
      if (newInviteUrl) setNewInviteUrl(null);
    }
  }

  // Derive the current user's role in the selected project
  const currentUserRole = members.find((m) => m.id === currentUserId)?.role ?? null;
  const isOwner = currentUserRole === 'owner';
  const isOwnerOrAdmin = isOwner || currentUserRole === 'admin';

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="text-2xl font-bold text-gray-100">Settings</h1>

      {/* Projects section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-100">Projects</h2>

        {loadingProjects ? (
          <SkeletonProjectList rows={3} />
        ) : projects.length === 0 ? (
          <p className="text-sm text-gray-400">No projects yet.</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-100">{project.name}</p>
                  <p className="text-xs text-gray-400">{project.domain}</p>
                  <button
                    onClick={() => copyToClipboard(project.id)}
                    className="flex items-center gap-1 text-xs text-gray-500 font-mono truncate hover:text-gray-300 transition"
                    title="Click to copy project ID"
                  >
                    ID: {project.id}
                    <span className="text-[10px]">{copied ? '(copied!)' : '(copy)'}</span>
                  </button>
                </div>
                <button
                  onClick={() => handleDeleteProject(project)}
                  className="rounded px-3 py-1 text-sm font-medium text-red-400 hover:bg-red-400/10 transition"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Allowed Origins section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-100">Allowed Origins</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Restrict event ingestion to specific origins. One per line. Supports exact hosts (
            <code className="text-gray-300">app.example.com</code>), wildcard subdomains (
            <code className="text-gray-300">*.example.com</code>), and dev hosts (
            <code className="text-gray-300">localhost:3000</code>). Leave empty to accept events from any origin.
          </p>
        </div>

        {!selectedProjectId ? (
          <p className="text-sm text-gray-400">Select a project above to configure allowed origins.</p>
        ) : (
          <div className="space-y-3">
            <textarea
              rows={5}
              className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
              value={allowedOriginsText}
              onChange={(e) => setAllowedOriginsText(e.target.value)}
              placeholder={'app.example.com\n*.example.com\nlocalhost:3000'}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={saveAllowedOrigins}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
              >
                Save
              </button>
              {allowedOriginsStatus && (
                <span className="text-xs text-gray-400">{allowedOriginsStatus}</span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* SDK Feature Toggles section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">SDK Configuration</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Feature toggles applied to the tracker SDK at runtime. Changes take effect within ~60 seconds.
            </p>
          </div>
          {savingSettings && (
            <span className="text-xs text-gray-500">Saving…</span>
          )}
        </div>

        {!selectedProjectId ? (
          <p className="text-sm text-gray-400">Select a project above to manage its SDK settings.</p>
        ) : loadingSettings ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-800" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-gray-800">
            {(Object.keys(SDK_DEFAULTS) as (keyof SdkSettings)[]).map((key) => {
              const { label, description } = SDK_TOGGLE_LABELS[key];
              const enabled = sdkSettings[key];
              return (
                <li key={key} className="flex items-center justify-between py-4">
                  <div className="min-w-0 pr-4">
                    <p className="text-sm font-medium text-gray-100">{label}</p>
                    <p className="text-xs text-gray-400">{description}</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Toggle ${label}`}
                    onClick={() => handleToggle(key)}
                    disabled={savingSettings}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                      enabled ? 'bg-blue-600' : 'bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                        enabled ? 'translate-x-4' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Team section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-100">Team</h2>
        <p className="mb-4 text-xs text-gray-400">
          Manage who has access to this project.
        </p>

        {!selectedProjectId ? (
          <p className="text-sm text-gray-400">Select a project above to manage its team.</p>
        ) : (
          <div className="space-y-6">
            {/* Member list */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-300">Members</h3>
              {loadingMembers ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-800" />
                  ))}
                </div>
              ) : members.length === 0 ? (
                <p className="text-sm text-gray-400">No members found.</p>
              ) : (
                <ul className="divide-y divide-gray-800">
                  {members.map((member) => {
                    const isSelf = member.id === currentUserId;
                    return (
                      <li key={member.id} className="flex items-center justify-between py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-100">
                              {member.name ?? member.email}
                              {isSelf && (
                                <span className="ml-1.5 text-xs text-gray-500">(you)</span>
                              )}
                            </p>
                            <RoleBadge role={member.role} />
                          </div>
                          {member.name && (
                            <p className="text-xs text-gray-400">{member.email}</p>
                          )}
                        </div>
                        {isOwner && !isSelf && member.role !== 'owner' && (
                          <button
                            onClick={() => handleRemoveMember(member)}
                            className="shrink-0 rounded px-3 py-1 text-sm font-medium text-red-400 hover:bg-red-400/10 transition"
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Invite form — visible to owner and admin */}
            {isOwnerOrAdmin && (
              <div>
                <h3 className="mb-3 text-sm font-medium text-gray-300">Invite a team member</h3>
                <form onSubmit={handleSendInvite} className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-48">
                    <label htmlFor="invite-email" className="mb-1 block text-sm text-gray-400">
                      Email address
                    </label>
                    <input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="colleague@example.com"
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="invite-role" className="mb-1 block text-sm text-gray-400">
                      Role
                    </label>
                    <select
                      id="invite-role"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as 'admin' | 'viewer')}
                      className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={sendingInvite || !inviteEmail.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
                  >
                    {sendingInvite ? 'Sending…' : 'Send Invite'}
                  </button>
                </form>

                {/* New invite URL to copy */}
                {newInviteUrl && (
                  <div className="mt-4 rounded-lg border border-blue-600/30 bg-blue-500/5 p-4">
                    <p className="mb-2 text-sm font-semibold text-blue-300">
                      Invitation created — share this link with the invitee
                    </p>
                    <p className="mb-2 text-xs text-gray-400">
                      No email was sent. Copy the link below and share it directly.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="block flex-1 break-all rounded bg-gray-800 px-3 py-2 text-xs text-gray-100">
                        {newInviteUrl}
                      </code>
                      <button
                        onClick={() => copyInviteUrl(newInviteUrl)}
                        className="shrink-0 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-600 transition"
                      >
                        {inviteCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pending invitations */}
            {isOwnerOrAdmin && (
              <div>
                <h3 className="mb-3 text-sm font-medium text-gray-300">Pending invitations</h3>
                {loadingInvitations ? (
                  <div className="h-10 animate-pulse rounded-lg bg-gray-800" />
                ) : invitations.length === 0 ? (
                  <p className="text-sm text-gray-400">No pending invitations.</p>
                ) : (
                  <ul className="divide-y divide-gray-800">
                    {invitations.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-100">{inv.email}</p>
                            <RoleBadge role={inv.role} />
                          </div>
                          <p className="text-xs text-gray-400">
                            Expires {new Date(inv.expires_at).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRevokeInvitation(inv.id)}
                          className="shrink-0 rounded px-3 py-1 text-sm font-medium text-red-400 hover:bg-red-400/10 transition"
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* API Keys section */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-100">API Keys</h2>

        {!selectedProjectId && (
          <p className="mb-4 text-sm text-gray-400">Select a project above to manage its API keys.</p>
        )}

        {selectedProjectId && (
          <>
            {/* Key list */}
            {loadingKeys ? (
              <SkeletonKeyList rows={3} />
            ) : keys.filter((k) => !k.revoked_at).length === 0 && !showRevoked ? (
              <p className="mb-4 text-sm text-gray-400">No active API keys for this project.</p>
            ) : (
              <ul className="mb-4 divide-y divide-gray-800">
                {keys
                  .filter((k) => showRevoked || !k.revoked_at)
                  .map((key) => {
                    const isRevoked = !!key.revoked_at;
                    return (
                      <li key={key.id} className={`flex items-center justify-between py-3 ${isRevoked ? 'opacity-50' : ''}`}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-100">
                            {key.label}
                            {isRevoked && (
                              <span className="ml-2 rounded bg-red-400/10 px-1.5 py-0.5 text-xs text-red-400">
                                Revoked
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400">
                            {key.prefix}*** &middot; Created{' '}
                            {new Date(key.created_at).toLocaleDateString()}
                            {key.last_used_at && (
                              <> &middot; Last used {new Date(key.last_used_at).toLocaleDateString()}</>
                            )}
                          </p>
                        </div>
                        {!isRevoked && (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              onClick={() => handleRotateKey(key)}
                              disabled={rotatingKeyId === key.id}
                              className="rounded px-3 py-1 text-sm font-medium text-blue-400 hover:bg-blue-400/10 disabled:opacity-50 transition"
                              title="Create a new key with the same label and revoke this one"
                            >
                              {rotatingKeyId === key.id ? 'Rotating…' : 'Rotate'}
                            </button>
                            <button
                              onClick={() => handleRevokeKey(key.id)}
                              className="rounded px-3 py-1 text-sm font-medium text-red-400 hover:bg-red-400/10 transition"
                            >
                              Revoke
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
            {keys.some((k) => !!k.revoked_at) && (
              <button
                onClick={() => setShowRevoked((v) => !v)}
                className="mb-4 text-xs text-gray-500 hover:text-gray-300 transition"
              >
                {showRevoked ? 'Hide revoked keys' : `Show revoked keys (${keys.filter((k) => !!k.revoked_at).length})`}
              </button>
            )}

            {/* Revealed key + integration guide */}
            {revealedKey && (
              <div className="mb-4 space-y-4">
                <div className="rounded-lg border border-yellow-600/50 bg-yellow-500/10 p-4">
                  <p className="mb-2 text-sm font-semibold text-yellow-300">
                    Copy this key now — it won&apos;t be shown again
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="block flex-1 break-all rounded bg-gray-800 px-3 py-2 text-sm text-gray-100">
                      {revealedKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(revealedKey)}
                      className="shrink-0 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-600 transition"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                  <p className="mb-2 text-sm font-semibold text-gray-200">Quick setup</p>
                  <p className="mb-3 text-xs text-gray-400">
                    Add this snippet to your website&apos;s {'<head>'} or before {'</body>'}:
                  </p>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded bg-gray-800 px-3 py-2 text-xs text-gray-300">
{`<script type="module">
  import { init } from 'https://analytics.lumitra.co/tracker.js';
  init({
    projectId: '${selectedProjectId}',
    endpoint: 'https://analytics.lumitra.co/api/collect',
  });
</script>`}
                    </pre>
                    <button
                      onClick={() => copyToClipboard(`<script type="module">
  import { init } from 'https://analytics.lumitra.co/tracker.js';
  init({
    projectId: '${selectedProjectId}',
    endpoint: 'https://analytics.lumitra.co/api/collect',
  });
</script>`)}
                      className="absolute right-2 top-2 rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600 transition"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Create key form */}
            <form onSubmit={handleCreateKey} className="flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <label htmlFor="key-label" className="mb-1 block text-sm text-gray-400">
                  Label
                </label>
                <input
                  id="key-label"
                  type="text"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="e.g. Production"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="key-env" className="mb-1 block text-sm text-gray-400">
                  Environment
                </label>
                <select
                  id="key-env"
                  value={newKeyEnvironment}
                  onChange={(e) => setNewKeyEnvironment(e.target.value as 'live' | 'test')}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="live">Live</option>
                  <option value="test">Test</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={creatingKey || !newKeyLabel.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition"
              >
                {creatingKey ? 'Creating...' : 'Create key'}
              </button>
            </form>
          </>
        )}
      </section>

      {/* ── Developer Tools ── */}
      {selectedProjectId && (
        <DeveloperToolsSection projectId={selectedProjectId} />
      )}

      {/* ── Danger Zone ── */}
      {selectedProjectId && (
        <section className="rounded-xl border border-red-900/50 bg-gray-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-red-400">Danger Zone</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-200">Reset all analytics data</p>
              <p className="text-xs text-gray-500 mt-1">
                Permanently delete all events, heatmap data, and session recordings for this project. This cannot be undone.
              </p>
            </div>
            <button
              onClick={async () => {
                const confirmed = window.confirm(
                  'Are you sure? This will permanently delete ALL analytics data for this project. This action cannot be undone.'
                );
                if (!confirmed) return;
                const doubleConfirm = window.confirm(
                  'This is your last chance to cancel. All heatmap data, session recordings, and events will be lost forever. Continue?'
                );
                if (!doubleConfirm) return;
                try {
                  const res = await fetch(`/api/projects/${selectedProjectId}/reset`, { method: 'DELETE' });
                  if (res.ok) {
                    alert('All analytics data has been deleted. New data will appear as events come in.');
                  } else {
                    const data = await res.json();
                    alert(`Error: ${data.error || 'Failed to reset data'}`);
                  }
                } catch {
                  alert('Failed to reset data. Check your connection.');
                }
              }}
              className="rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900 hover:text-red-300 transition flex-shrink-0"
            >
              Reset data
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

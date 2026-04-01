#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { SKILL_TEMPLATE } from './skill-template.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const DEFAULT_ENDPOINT = 'https://analytics.lumitra.co';
const CREDENTIALS_DIR = join(homedir(), '.lumitra');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

function success(msg: string): void {
  log(`${GREEN}✓${RESET} ${msg}`);
}

function warn(msg: string): void {
  log(`${YELLOW}!${RESET} ${msg}`);
}

function error(msg: string): void {
  log(`${RED}✗${RESET} ${msg}`);
}

function heading(msg: string): void {
  log(`\n${BOLD}${CYAN}${msg}${RESET}\n`);
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

type Framework = 'nextjs' | 'vite' | 'nuxt' | 'react' | 'vanilla';

function detectFramework(cwd: string): Framework {
  const files = (() => {
    try {
      return readdirSync(cwd);
    } catch {
      return [] as string[];
    }
  })();

  if (files.some((f) => f.startsWith('next.config'))) return 'nextjs';
  if (files.some((f) => f.startsWith('nuxt.config'))) return 'nuxt';
  if (files.some((f) => f.startsWith('vite.config'))) return 'vite';

  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      if ('react' in allDeps) return 'react';
    } catch {
      // ignore parse errors
    }
  }

  return 'vanilla';
}

function frameworkLabel(fw: Framework): string {
  switch (fw) {
    case 'nextjs':
      return 'Next.js';
    case 'vite':
      return 'Vite';
    case 'nuxt':
      return 'Nuxt';
    case 'react':
      return 'React';
    case 'vanilla':
      return 'Vanilla JS';
  }
}

// ---------------------------------------------------------------------------
// Project name / domain detection
// ---------------------------------------------------------------------------

function readProjectName(cwd: string): string {
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch {
      // ignore
    }
  }
  return cwd.split('/').pop() || 'my-project';
}

function detectDomain(cwd: string): string {
  for (const filename of ['.env.local', '.env.production', '.env']) {
    const p = join(cwd, filename);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, 'utf-8');
      const match = content.match(
        /(?:NEXT_PUBLIC_|NUXT_PUBLIC_|VITE_)?(?:SITE_URL|BASE_URL|APP_URL|DOMAIN)\s*=\s*(.+)/,
      );
      if (match) {
        const val = match[1]!.trim().replace(/^['"]|['"]$/g, '');
        try {
          return new URL(val).hostname;
        } catch {
          return val;
        }
      }
    } catch {
      // ignore
    }
  }
  return `${readProjectName(cwd)}.com`;
}

// ---------------------------------------------------------------------------
// Browser opener
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  const cmd =
    platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`, () => {
    // Ignore errors — we print the URL as fallback
  });
}

// ---------------------------------------------------------------------------
// Credential management
// ---------------------------------------------------------------------------

interface StoredCredentials {
  accountKey: string;
  endpoint: string;
}

function loadCredentials(): StoredCredentials | null {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
    if (data.accountKey && data.endpoint) return data as StoredCredentials;
  } catch {
    // corrupt file
  }
  return null;
}

function saveCredentials(creds: StoredCredentials): void {
  mkdirSync(CREDENTIALS_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

function deleteCredentials(): void {
  try {
    if (existsSync(CREDENTIALS_PATH)) unlinkSync(CREDENTIALS_PATH);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Device auth flow
// ---------------------------------------------------------------------------

async function pollForAuth(
  endpoint: string,
  pollSecret: string,
  timeoutMs = 600_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(`${endpoint}/api/cli-auth/poll?secret=${pollSecret}`);
      const data = (await res.json()) as { status: string; account_key?: string };
      if (data.status === 'approved' && data.account_key) return data.account_key;
      if (data.status === 'expired') throw new Error('Device code expired');
    } catch (err) {
      if ((err as Error).message === 'Device code expired') throw err;
      // Network hiccup — keep polling
    }
  }
  throw new Error('Authentication timed out');
}

async function deviceAuthFlow(endpoint: string): Promise<string> {
  log(`  ${DIM}Requesting device code...${RESET}`);

  const res = await fetch(`${endpoint}/api/cli-auth/device`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Failed to create device code (HTTP ${res.status})`);
  }

  const data = (await res.json()) as {
    device_code: string;
    poll_secret: string;
    expires_in: number;
  };

  log('');
  log(`  Your device code is: ${BOLD}${data.device_code.toUpperCase()}${RESET}`);
  log('');

  const authUrl = `${endpoint}/cli-auth?code=${data.device_code}`;
  log(`  ${DIM}Opening browser to authenticate...${RESET}`);
  log(`  ${DIM}If it doesn't open, visit: ${authUrl}${RESET}`);
  log('');

  openBrowser(authUrl);

  process.stdout.write(`  Waiting for authorization...`);

  const accountKey = await pollForAuth(endpoint, data.poll_secret);

  // Clear the "Waiting..." line
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  return accountKey;
}

// ---------------------------------------------------------------------------
// Step 1: Ensure account key
// ---------------------------------------------------------------------------

async function ensureAccountKey(): Promise<StoredCredentials> {
  // 1. Check cached credentials
  const cached = loadCredentials();
  if (cached) {
    try {
      const res = await fetch(`${cached.endpoint}/api/account/keys`, {
        headers: { 'X-API-Key': cached.accountKey },
      });
      if (res.ok) {
        success(`Authenticated ${DIM}(cached credentials)${RESET}`);
        return cached;
      }
    } catch {
      // invalid — fall through
    }
    warn('Cached credentials are invalid — re-authenticating');
    deleteCredentials();
  }

  // 2. Check environment variables (backward compat)
  const envKey = process.env.LUMITRA_ACCOUNT_KEY;
  const envEndpoint = process.env.LUMITRA_ENDPOINT || DEFAULT_ENDPOINT;
  if (envKey) {
    success(`Authenticated ${DIM}(environment variable)${RESET}`);
    return { accountKey: envKey, endpoint: envEndpoint };
  }

  // 3. Device auth flow
  const endpoint = DEFAULT_ENDPOINT;
  const accountKey = await deviceAuthFlow(endpoint);
  const creds = { accountKey, endpoint };
  saveCredentials(creds);
  success('Authenticated');

  return creds;
}

// ---------------------------------------------------------------------------
// Step 2: Ensure project
// ---------------------------------------------------------------------------

async function ensureProject(
  accountKey: string,
  endpoint: string,
  cwd: string,
): Promise<{ projectId: string; projectName: string }> {
  const domain = detectDomain(cwd);
  const projectName = readProjectName(cwd);

  // Check if project with this domain already exists
  const listRes = await fetch(
    `${endpoint}/api/projects?domain=${encodeURIComponent(domain)}`,
    { headers: { 'X-API-Key': accountKey } },
  );

  if (listRes.ok) {
    const listData = (await listRes.json()) as { projects: Array<{ id: string; name: string; domain: string }> };
    if (listData.projects.length > 0) {
      const existing = listData.projects[0]!;
      success(`Project ${BOLD}${existing.name}${RESET} already exists — using it`);
      return { projectId: existing.id, projectName: existing.name };
    }
  }

  // Create new project
  log(`  ${DIM}Creating project "${projectName}" (${domain})...${RESET}`);
  const createRes = await fetch(`${endpoint}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': accountKey },
    body: JSON.stringify({ name: projectName, domain }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Failed to create project (HTTP ${createRes.status}): ${body}`);
  }

  const createData = (await createRes.json()) as { project: { id: string } };
  success(`Created project ${BOLD}${projectName}${RESET}`);
  return { projectId: createData.project.id, projectName };
}

// ---------------------------------------------------------------------------
// Step 3: Ensure project API key
// ---------------------------------------------------------------------------

async function ensureProjectKey(
  accountKey: string,
  endpoint: string,
  projectId: string,
  projectName: string,
  cwd: string,
): Promise<string> {
  // Check if .env.local already has a live key
  const envPath = join(cwd, '.env.local');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/NEXT_PUBLIC_ANALYTICS_API_KEY\s*=\s*(.+)/);
    if (match) {
      const existingKey = match[1]!.trim().replace(/^['"]|['"]$/g, '');
      if (existingKey.startsWith('ap_live_') && existingKey.length > 16) {
        // Validate it's still active by checking prefix against project keys
        try {
          const res = await fetch(`${endpoint}/api/projects/${projectId}/keys`, {
            headers: { 'X-API-Key': accountKey },
          });
          if (res.ok) {
            const data = (await res.json()) as { keys: Array<{ prefix: string; revoked_at: string | null }> };
            const keyPrefix = existingKey.slice(0, 13); // ap_live_ + 5 chars
            const active = data.keys.find(
              (k) => !k.revoked_at && k.prefix.startsWith(keyPrefix.slice(0, 8)),
            );
            if (active) {
              success(`API key already configured ${DIM}(existing .env.local)${RESET}`);
              return existingKey;
            }
          }
        } catch {
          // Can't validate — create a new one
        }
      }
    }
  }

  // Create a new project key
  const res = await fetch(`${endpoint}/api/projects/${projectId}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': accountKey },
    body: JSON.stringify({ label: `cli-init-${projectName}`, environment: 'live' }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create API key (HTTP ${res.status}): ${body}`);
  }

  const data = (await res.json()) as { key: { fullKey: string } };
  success('Created project API key');
  return data.key.fullKey;
}

// ---------------------------------------------------------------------------
// Step 4: Write env vars
// ---------------------------------------------------------------------------

function installEnvFile(
  cwd: string,
  projectId: string,
  apiKey: string,
  endpoint: string,
): void {
  const envPath = join(cwd, '.env.local');

  const vars = [
    `NEXT_PUBLIC_ANALYTICS_PROJECT_ID=${projectId}`,
    `NEXT_PUBLIC_ANALYTICS_API_KEY=${apiKey}`,
    `NEXT_PUBLIC_ANALYTICS_ENDPOINT=${endpoint}/api/collect`,
  ];

  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, 'utf-8');

    // Check if all vars already present with same values
    const allMatch = vars.every((line) => existing.includes(line));
    if (allMatch) {
      success(`.env.local already up to date — skipping`);
      return;
    }

    // Check for existing keys with different values
    const missing = vars.filter((line) => {
      const key = line.split('=')[0]!;
      if (!existing.includes(key)) return true; // missing entirely
      // Key exists — check if value matches
      const existingLine = existing.split('\n').find((l) => l.startsWith(key + '='));
      return existingLine !== line;
    });

    if (missing.length === 0) {
      success(`.env.local already up to date — skipping`);
      return;
    }

    // Check for conflicting values
    const conflicts = missing.filter((line) => {
      const key = line.split('=')[0]!;
      return existing.includes(key + '=');
    });

    if (conflicts.length > 0) {
      warn(`.env.local has existing Lumitra values that differ — not overwriting`);
      log(`  ${DIM}To update, remove the old values and run init again.${RESET}`);
      return;
    }

    const separator = existing.endsWith('\n') ? '' : '\n';
    const block = `${separator}\n# Lumitra Analytics\n${missing.join('\n')}\n`;
    writeFileSync(envPath, existing + block, 'utf-8');
    success(`Added ${missing.length} variable(s) to .env.local`);
  } else {
    const content = `# Lumitra Analytics\n${vars.join('\n')}\n`;
    writeFileSync(envPath, content, 'utf-8');
    success('Created .env.local with Lumitra credentials');
  }
}

// ---------------------------------------------------------------------------
// Step 5: Skill file installer
// ---------------------------------------------------------------------------

function installSkillFile(cwd: string): void {
  const useProjectScope = process.argv.includes('--project-scope');
  const skillDir = useProjectScope
    ? join(cwd, '.claude', 'skills')
    : join(homedir(), '.claude', 'skills');
  const skillPath = join(skillDir, 'lumitra.md');
  const scopeLabel = useProjectScope ? 'project' : 'user';

  // Clean up old project-scoped installs when installing at user scope
  if (!useProjectScope) {
    const oldPath = join(cwd, '.claude', 'skills', 'lumitra.md');
    if (existsSync(oldPath)) {
      unlinkSync(oldPath);
      warn('Removed old project-scoped skill at .claude/skills/lumitra.md');
    }
  }

  if (existsSync(skillPath)) {
    warn(`Skill file already exists at ${scopeLabel} scope — skipping`);
    return;
  }

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillPath, SKILL_TEMPLATE, 'utf-8');
  success(`Created lumitra.md skill (${scopeLabel} scope)`);
}

// ---------------------------------------------------------------------------
// Next steps printer
// ---------------------------------------------------------------------------

function printNextSteps(fw: Framework): void {
  heading('Next steps');

  let step = 1;

  log(`  ${step}. Install the tracker:`);
  log(`     ${CYAN}pnpm add @marlinjai/analytics-tracker${RESET}`);

  if (fw === 'nextjs' || fw === 'react' || fw === 'vite') {
    log('');
    step++;
    log(`  ${step}. Install React hooks:`);
    log(`     ${CYAN}pnpm add @marlinjai/analytics-react${RESET}`);
  }

  if (fw === 'nuxt') {
    log('');
    step++;
    log(`  ${step}. Initialize the tracker in a Nuxt plugin:`);
    log(`     ${DIM}plugins/lumitra.client.ts${RESET}`);
  }

  log('');
  step++;
  log(`  ${step}. Add the ${BOLD}NEXT_PUBLIC_*${RESET} variables from .env.local to your`);
  log(`     deployment platform (Vercel, Coolify, etc.)`);

  log('');
  log(`  ${DIM}The .claude/skills/lumitra.md file teaches Claude Code how to`);
  log(`  create and manage A/B tests via the Lumitra API.${RESET}`);
  log('');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function runInit(cwd: string, skillOnly: boolean): Promise<void> {
  const fw = detectFramework(cwd);

  heading(`Lumitra Analytics — init`);
  log(`  Detected framework: ${BOLD}${frameworkLabel(fw)}${RESET}`);
  log(`  Project root: ${DIM}${cwd}${RESET}`);
  log('');

  installSkillFile(cwd);

  if (!skillOnly) {
    const { accountKey, endpoint } = await ensureAccountKey();
    const { projectId, projectName } = await ensureProject(accountKey, endpoint, cwd);
    const apiKey = await ensureProjectKey(accountKey, endpoint, projectId, projectName, cwd);
    installEnvFile(cwd, projectId, apiKey, endpoint);
  }

  printNextSteps(fw);
}

async function runLogout(): Promise<void> {
  if (existsSync(CREDENTIALS_PATH)) {
    deleteCredentials();
    success('Logged out — cached credentials removed');
  } else {
    log('No cached credentials found.');
  }
}

function printHelp(): void {
  log('');
  log(`${BOLD}Lumitra Analytics CLI${RESET}`);
  log('');
  log('Usage:');
  log(`  ${CYAN}lumitra init${RESET}          Set up Lumitra in the current project`);
  log(`  ${CYAN}lumitra init --skill${RESET}  Only install the Claude Code skill file`);
  log(`  ${CYAN}lumitra logout${RESET}        Remove cached credentials`);
  log(`  ${CYAN}lumitra --help${RESET}        Show this help message`);
  log(`  ${CYAN}lumitra --version${RESET}     Show version`);
  log('');
  log('Authentication:');
  log(`  On first run, ${CYAN}lumitra init${RESET} opens your browser to authenticate.`);
  log(`  Credentials are cached in ~/.lumitra/credentials.json.`);
  log('');
  log(`  ${DIM}You can also set LUMITRA_ACCOUNT_KEY and LUMITRA_ENDPOINT${RESET}`);
  log(`  ${DIM}environment variables for CI/CD or non-interactive use.${RESET}`);
  log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = resolve(process.cwd());

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    log('2.0.0');
    return;
  }

  const command = args[0];

  if (command === 'init') {
    const skillOnly = args.includes('--skill');
    await runInit(cwd, skillOnly);
    return;
  }

  if (command === 'logout') {
    await runLogout();
    return;
  }

  if (!command) {
    printHelp();
    return;
  }

  log(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  error(`Unexpected error: ${(err as Error).message}`);
  process.exit(1);
});

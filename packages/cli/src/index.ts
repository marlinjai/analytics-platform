#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
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
// Auto-provisioning (account key)
// ---------------------------------------------------------------------------

interface ProvisionResult {
  projectId: string;
  apiKey: string;
}

async function autoProvisionProject(cwd: string): Promise<ProvisionResult | null> {
  const accountKey = process.env.LUMITRA_ACCOUNT_KEY;
  const endpoint = process.env.LUMITRA_ENDPOINT;

  if (!accountKey || !endpoint) return null;

  const projectName = readProjectName(cwd);
  const domain = detectDomain(cwd);

  log(`  ${DIM}Auto-provisioning with account key...${RESET}`);
  log(`  Project name: ${BOLD}${projectName}${RESET}`);
  log(`  Domain: ${BOLD}${domain}${RESET}`);
  log('');

  // Step 1: Create the project
  let projectId: string;
  try {
    const res = await fetch(`${endpoint}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': accountKey,
      },
      body: JSON.stringify({ name: projectName, domain }),
    });

    if (!res.ok) {
      const body = await res.text();
      error(`Failed to create project (HTTP ${res.status}): ${body}`);
      return null;
    }

    const data = (await res.json()) as { project: { id: string } };
    projectId = data.project.id;
    success(`Created project ${BOLD}${projectId}${RESET}`);
  } catch (err) {
    error(`Network error creating project: ${(err as Error).message}`);
    return null;
  }

  // Step 2: Create a project-level API key
  try {
    const res = await fetch(`${endpoint}/api/projects/${projectId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': accountKey,
      },
      body: JSON.stringify({
        label: `cli-init-${projectName}`,
        environment: 'live',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      error(`Failed to create API key (HTTP ${res.status}): ${body}`);
      warn(`Project was created (${projectId}) but key creation failed.`);
      warn('Create a key manually in the dashboard.');
      return null;
    }

    const data = (await res.json()) as { key: { fullKey: string } };
    success('Created project API key');
    return { projectId, apiKey: data.key.fullKey };
  } catch (err) {
    error(`Network error creating API key: ${(err as Error).message}`);
    warn(`Project was created (${projectId}) but key creation failed.`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Skill file installer
// ---------------------------------------------------------------------------

function installSkillFile(cwd: string): void {
  // Default: user scope (~/.claude/skills/) — works across all projects
  // Use --project-scope flag to install at project level instead
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
// Env file installer
// ---------------------------------------------------------------------------

const ENV_PLACEHOLDERS = [
  'NEXT_PUBLIC_ANALYTICS_PROJECT_ID=your-project-id',
  'NEXT_PUBLIC_ANALYTICS_API_KEY=your-api-key',
  'NEXT_PUBLIC_ANALYTICS_ENDPOINT=https://analytics.lumitra.co/api/collect',
  'LUMITRA_API_KEY=your-api-key',
  'LUMITRA_ACCOUNT_KEY=your-account-key',
  'LUMITRA_ENDPOINT=https://analytics.lumitra.co',
];

function buildEnvVars(provision?: ProvisionResult): string[] {
  if (!provision) return ENV_PLACEHOLDERS;

  const endpoint = process.env.LUMITRA_ENDPOINT || 'https://analytics.lumitra.co';
  const accountKey = process.env.LUMITRA_ACCOUNT_KEY || '';

  return [
    `NEXT_PUBLIC_ANALYTICS_PROJECT_ID=${provision.projectId}`,
    `NEXT_PUBLIC_ANALYTICS_API_KEY=${provision.apiKey}`,
    `NEXT_PUBLIC_ANALYTICS_ENDPOINT=${endpoint}/api/collect`,
    `LUMITRA_API_KEY=${provision.apiKey}`,
    `LUMITRA_ACCOUNT_KEY=${accountKey}`,
    `LUMITRA_ENDPOINT=${endpoint}`,
  ];
}

function installEnvFile(cwd: string, provision?: ProvisionResult): void {
  const envPath = join(cwd, '.env.local');
  const vars = buildEnvVars(provision);

  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, 'utf-8');
    const missing = vars.filter((line) => {
      const key = line.split('=')[0]!;
      return !existing.includes(key);
    });

    if (missing.length === 0) {
      warn('.env.local already has all Lumitra variables — skipping');
      return;
    }

    const separator = existing.endsWith('\n') ? '' : '\n';
    const block = `${separator}\n# Lumitra Analytics\n${missing.join('\n')}\n`;
    writeFileSync(envPath, existing + block, 'utf-8');
    success(`Added ${missing.length} variable(s) to .env.local${provision ? ' with real credentials' : ''}`);
  } else {
    const content = `# Lumitra Analytics\n${vars.join('\n')}\n`;
    writeFileSync(envPath, content, 'utf-8');
    success(`Created .env.local${provision ? ' with provisioned credentials' : ' with Lumitra placeholder variables'}`);
  }
}

// ---------------------------------------------------------------------------
// Next steps printer
// ---------------------------------------------------------------------------

function printNextSteps(fw: Framework, provisioned: boolean): void {
  heading('Next steps');

  let step = 1;

  if (!provisioned) {
    log(`  ${step}. Get your project ID and API key from the Lumitra dashboard`);
    log(`     ${DIM}https://analytics.lumitra.co${RESET}`);
    log('');
    step++;
    log(`  ${step}. Update the placeholder values in ${BOLD}.env.local${RESET}`);
    log('');
    step++;
  }

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

  let provisioned = false;

  if (!skillOnly) {
    const provision = await autoProvisionProject(cwd);
    if (provision) {
      installEnvFile(cwd, provision);
      provisioned = true;
    } else {
      installEnvFile(cwd);
    }
  }

  printNextSteps(fw, provisioned);
}

function printHelp(): void {
  log('');
  log(`${BOLD}Lumitra Analytics CLI${RESET}`);
  log('');
  log('Usage:');
  log(`  ${CYAN}lumitra init${RESET}          Set up Lumitra in the current project`);
  log(`  ${CYAN}lumitra init --skill${RESET}  Only install the Claude Code skill file`);
  log(`  ${CYAN}lumitra --help${RESET}        Show this help message`);
  log(`  ${CYAN}lumitra --version${RESET}     Show version`);
  log('');
  log('Environment variables:');
  log(`  ${CYAN}LUMITRA_ACCOUNT_KEY${RESET}   Account API key — enables auto-provisioning`);
  log(`  ${CYAN}LUMITRA_ENDPOINT${RESET}      API base URL (default: https://analytics.lumitra.co)`);
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
    log('1.1.0');
    return;
  }

  const command = args[0];

  if (command === 'init') {
    const skillOnly = args.includes('--skill');
    await runInit(cwd, skillOnly);
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

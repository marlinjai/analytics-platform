#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SKILL_TEMPLATE } from './skill-template.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
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

  // Next.js
  if (files.some((f) => f.startsWith('next.config'))) {
    return 'nextjs';
  }

  // Nuxt
  if (files.some((f) => f.startsWith('nuxt.config'))) {
    return 'nuxt';
  }

  // Vite
  if (files.some((f) => f.startsWith('vite.config'))) {
    return 'vite';
  }

  // React (check package.json dependencies)
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      if ('react' in allDeps) {
        return 'react';
      }
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
// Skill file installer
// ---------------------------------------------------------------------------

function installSkillFile(cwd: string): void {
  const skillDir = join(cwd, '.claude', 'skills');
  const skillPath = join(skillDir, 'lumitra.md');

  if (existsSync(skillPath)) {
    warn('Skill file already exists at .claude/skills/lumitra.md — skipping');
    return;
  }

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillPath, SKILL_TEMPLATE, 'utf-8');
  success('Created .claude/skills/lumitra.md');
}

// ---------------------------------------------------------------------------
// Env file installer
// ---------------------------------------------------------------------------

const ENV_VARS = [
  'NEXT_PUBLIC_ANALYTICS_PROJECT_ID=your-project-id',
  'NEXT_PUBLIC_ANALYTICS_API_KEY=your-api-key',
  'NEXT_PUBLIC_ANALYTICS_ENDPOINT=https://analytics.lumitra.co/api/collect',
  'LUMITRA_API_KEY=your-api-key',
  'LUMITRA_ACCOUNT_KEY=your-account-key',
  'LUMITRA_ENDPOINT=https://analytics.lumitra.co',
];

function installEnvFile(cwd: string): void {
  const envPath = join(cwd, '.env.local');

  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, 'utf-8');
    const missing = ENV_VARS.filter((line) => {
      const key = line.split('=')[0]!;
      return !existing.includes(key);
    });

    if (missing.length === 0) {
      warn('.env.local already has all Lumitra variables — skipping');
      return;
    }

    // Append missing vars
    const separator = existing.endsWith('\n') ? '' : '\n';
    const block = `${separator}\n# Lumitra Analytics\n${missing.join('\n')}\n`;
    writeFileSync(envPath, existing + block, 'utf-8');
    success(`Added ${missing.length} missing variable(s) to .env.local`);
  } else {
    const content = `# Lumitra Analytics\n${ENV_VARS.join('\n')}\n`;
    writeFileSync(envPath, content, 'utf-8');
    success('Created .env.local with Lumitra placeholder variables');
  }
}

// ---------------------------------------------------------------------------
// Next steps printer
// ---------------------------------------------------------------------------

function printNextSteps(fw: Framework): void {
  heading('Next steps');

  log(`  1. Get your project ID and API key from the Lumitra dashboard`);
  log(`     ${DIM}https://analytics.lumitra.co${RESET}`);
  log('');
  log(`  2. Update the placeholder values in ${BOLD}.env.local${RESET}`);
  log('');
  log(`  3. Install the tracker:`);
  log(`     ${CYAN}pnpm add @marlinjai/analytics-tracker${RESET}`);

  if (fw === 'nextjs' || fw === 'react' || fw === 'vite') {
    log('');
    log(`  4. Install React hooks:`);
    log(`     ${CYAN}pnpm add @marlinjai/analytics-react${RESET}`);
  }

  if (fw === 'nuxt') {
    log('');
    log(`  4. Initialize the tracker in a Nuxt plugin:`);
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

function runInit(cwd: string, skillOnly: boolean): void {
  const fw = detectFramework(cwd);

  heading(`Lumitra Analytics — init`);
  log(`  Detected framework: ${BOLD}${frameworkLabel(fw)}${RESET}`);
  log(`  Project root: ${DIM}${cwd}${RESET}`);
  log('');

  // Always install skill file
  installSkillFile(cwd);

  // Full setup also writes env vars
  if (!skillOnly) {
    installEnvFile(cwd);
  }

  printNextSteps(fw);
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
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const cwd = resolve(process.cwd());

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    log('1.0.0');
    return;
  }

  const command = args[0];

  if (command === 'init') {
    const skillOnly = args.includes('--skill');
    runInit(cwd, skillOnly);
    return;
  }

  // No command or unknown command
  if (!command) {
    printHelp();
    return;
  }

  log(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main();

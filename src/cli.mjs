#!/usr/bin/env node
import { run as runGsc } from './audit-gsc.mjs';
import { run as runCloudflare } from './audit-cloudflare.mjs';
import { run as runSeo } from './audit-seo.mjs';

const HELP = `optimizer-tools — read-first SEO diagnostics (Compose)

Usage:
  optimizer-tools audit:gsc [--site ferrington] [--json] [gsc flags…]
  optimizer-tools audit:cloudflare [--site ferrington] [--json]
  optimizer-tools audit:seo --base <url> [--json] [seo flags…]

Run from the optimizer-tools repo root:
  docker compose run --rm optimizer-tools <subcommand> [options]

Secrets: mise/containers/optimizer-tools/env/production.env (decrypt from production.env.enc via roro).
GSC OAuth bootstrap (gsc-auth) stays host-only.

Subcommands:
  audit:gsc           Google Search Console (sitemaps, P0 queries, inspection)
  audit:cloudflare    Cloudflare DNS, SSL, redirect rules per site
  audit:seo           Live site fetch (redirect chains, meta, canonical, JSON-LD)

Use <subcommand> --help for subcommand-specific options.
`;

const [command, ...args] = process.argv.slice(2);

if (!command || command === '--help' || command === '-h' || command === 'help') {
  console.log(HELP);
  process.exit(0);
}

let exitCode = 1;

try {
  switch (command) {
    case 'audit:gsc':
      exitCode = await runGsc(args);
      break;
    case 'audit:cloudflare':
      exitCode = await runCloudflare(args);
      break;
    case 'audit:seo':
      exitCode = await runSeo(args);
      break;
    default:
      console.error(`Unknown subcommand: ${command}\n`);
      console.log(HELP);
      exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  exitCode = 1;
}

process.exit(exitCode);

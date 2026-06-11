import {
  resolveZoneId,
  listDnsRecords,
  getSslMode,
  getRedirectEntrypoint,
  buildFerringtonRedirectRules,
  summarizeDns,
  diffRedirectRules,
} from './cloudflare-api.mjs';
import { loadSite } from './sites.mjs';

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = { site: 'ferrington', json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--site') opts.site = argv[++i];
  }
  return opts;
}

function printHelp() {
  return `Usage: optimizer-tools audit:cloudflare [--site <key>] [--json]

Options:
  --site <key>   Site key from config/sites.json (default: ferrington)
  --json         JSON output
  --help         Show this help
`;
}

async function auditZone(zoneName, cachedId, canonicalHost) {
  const zoneId = await resolveZoneId(zoneName, cachedId);
  const [records, ssl, entrypoint] = await Promise.all([
    listDnsRecords(zoneId),
    getSslMode(zoneId),
    getRedirectEntrypoint(zoneId),
  ]);
  const dns = summarizeDns(records, zoneName);
  const desired = buildFerringtonRedirectRules(canonicalHost, zoneName);
  const ruleDiff = diffRedirectRules(desired, entrypoint?.rules ?? []);
  const flags = [];
  if (zoneName === canonicalHost && !dns.www) flags.push('missing_www_dns');
  if (ruleDiff.some((r) => r.status === 'missing')) flags.push('missing_redirect_rules');
  if (ruleDiff.some((r) => r.status === 'drift')) flags.push('redirect_rule_drift');

  return {
    zoneName,
    zoneId,
    ssl,
    dns: {
      apex: dns.apex
        ? { type: dns.apex.type, name: dns.apex.name, proxied: dns.apex.proxied }
        : null,
      www: dns.www
        ? { type: dns.www.type, name: dns.www.name, proxied: dns.www.proxied }
        : null,
      wildcard: dns.wildcard
        ? { type: dns.wildcard.type, name: dns.wildcard.name, proxied: dns.wildcard.proxied }
        : null,
    },
    redirectRules: ruleDiff,
    redirectRuleCount: entrypoint?.rules?.length ?? 0,
    flags,
  };
}

/** @param {string[]} argv */
export async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(printHelp());
    return 0;
  }

  const site = loadSite(opts.site);
  const canonicalHost = site.canonicalHost;
  const zones = site.zones ?? {};
  const reports = [];

  for (const [zoneName, zoneId] of Object.entries(zones)) {
    reports.push(await auditZone(zoneName, zoneId || undefined, canonicalHost));
  }

  if (opts.json) {
    console.log(JSON.stringify({ site: opts.site, canonicalHost, zones: reports }, null, 2));
  } else {
    console.log(`Cloudflare audit — ${opts.site} (canonical: https://${canonicalHost})`);
    console.log('');
    for (const z of reports) {
      console.log(`${z.zoneName} (${z.zoneId})`);
      console.log(`  ssl: ${z.ssl}`);
      console.log(`  dns apex: ${z.dns.apex ? `${z.dns.apex.type} proxied=${z.dns.apex.proxied}` : '—'}`);
      console.log(`  dns www: ${z.dns.www ? `${z.dns.www.type} proxied=${z.dns.www.proxied}` : '—'}`);
      console.log(`  dns wildcard: ${z.dns.wildcard ? `${z.dns.wildcard.type} proxied=${z.dns.wildcard.proxied}` : '—'}`);
      console.log(`  redirect rules (${z.redirectRuleCount} total in entrypoint):`);
      for (const r of z.redirectRules) {
        console.log(`    [${r.status}] ${r.ref}: ${r.description}`);
      }
      if (z.flags.length) console.log(`  flags: ${z.flags.join(', ')}`);
      console.log('');
    }
  }

  return reports.some((z) => z.flags.length > 0) ? 1 : 0;
}

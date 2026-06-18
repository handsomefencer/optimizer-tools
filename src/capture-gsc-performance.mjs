import { writeFileSync } from 'node:fs';
import { P0_QUERY_FRAGMENTS } from './gsc-api.mjs';
import { captureGscPerformanceBaseline } from './gsc-performance.mjs';
import { gscPropertiesForSite, loadSite } from './sites.mjs';

/** @param {string[]} argv */
export function parseArgs(argv) {
  const opts = {
    site: 'ferrington',
    days: 28,
    label: 'snapshot',
    out: null,
    json: false,
    help: false,
    properties: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--site') opts.site = argv[++i];
    else if (arg === '--days') opts.days = Number(argv[++i]);
    else if (arg === '--label') opts.label = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--properties') opts.properties = argv[++i];
  }

  return opts;
}

function printHelp() {
  return `GSC Performance baseline — Search Analytics snapshot (queries + pages)

Usage:
  optimizer-tools capture:gsc-performance [options]

Options:
  --site <key>           Site from config/sites.json (default: ferrington)
  --days <n>             Lookback window in days (default: 28)
  --label <name>         Label for this snapshot (e.g. phase0-pre-indexing)
  --properties <list>    Comma-separated GSC property ids (overrides site config)
  --out <path>           Write JSON to file (default: stdout with --json, else summary only)
  --json                 JSON output to stdout when --out is omitted
  --help                 This message

Notes:
  - Retrospective GSC data only; rows appear after Google records impressions.
  - Site config: gscProperty + optional gscLegacyProperties, or gscProperties[].
  - trackedQueries uses site gscQueryFragments or built-in P0 fragments.

Examples:
  docker compose run --rm optimizer-tools capture:gsc-performance --site ferrington --json
  docker compose run --rm -v $(pwd)/out:/out optimizer-tools \\
    capture:gsc-performance --site ferrington --label phase0 --out /out/baseline.json
`;
}

/** @param {string[]} argv */
export async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(printHelp());
    return 0;
  }

  const site = loadSite(opts.site);
  const properties = opts.properties
    ? opts.properties.split(',').map((p) => p.trim()).filter(Boolean)
    : gscPropertiesForSite(site);

  if (properties.length === 0) {
    throw new Error(
      `No GSC properties for site "${opts.site}". Set gscProperty or gscProperties in config/sites.json.`,
    );
  }

  const fragments = site.gscQueryFragments ?? P0_QUERY_FRAGMENTS;

  const baseline = {
    ...(await captureGscPerformanceBaseline(properties, {
      days: opts.days,
      fragments,
    })),
    site: opts.site,
    label: opts.label,
    notes: [
      'Search Analytics API snapshot (not live SERP). Rows only exist where Google recorded impressions.',
      'Compare future snapshots by totals, queries, pages, and avg position.',
    ],
  };

  const json = `${JSON.stringify(baseline, null, 2)}\n`;

  if (opts.out) {
    writeFileSync(opts.out, json);
    console.log(`Wrote ${opts.out}`);
  } else if (opts.json) {
    process.stdout.write(json);
  }

  if (!opts.json || opts.out) {
    console.log(`GSC performance — ${opts.site} (${opts.label}), ${opts.days}d`);
    for (const p of baseline.properties) {
      console.log(
        `  ${p.property}: ${p.totals.impressions} impressions, ${p.queryCount} queries, ${p.trackedQueries.length} tracked`,
      );
    }
  }

  return 0;
}

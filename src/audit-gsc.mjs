import {
  getGscConfig,
  listSites,
  listSitemaps,
  submitSitemap,
  searchAnalyticsQuery,
  inspectUrl,
  dateRange,
  P0_QUERY_FRAGMENTS,
} from './gsc-api.mjs';
import { canonicalOrigin, loadSite } from './sites.mjs';

const HUB_PATHS = [
  '/',
  '/blocks',
  '/vineyard',
  '/varietals',
  '/varietals/pinot-noir',
  '/varietals/chardonnay',
  '/wineries',
];

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
  return `GSC audit — requires GSC_* env (see docs/ferrington/todos/2026-06-09-ferrington-gsc-api-setup.md)

Usage:
  optimizer-tools audit:gsc [options]

Options:
  --site <key>         Site key from config/sites.json (default: ferrington)
  --sites              List Search Console properties
  --sitemaps           List submitted sitemaps + status
  --submit-sitemap     Submit sitemap-index.xml (API; same as GSC Sitemaps → Submit)
  --queries            P0 query performance (last 28 days)
  --inspect <path>     URL Inspection for one path (read-only)
  --inspect-hubs       Inspect all Section E hub URLs
  --json               JSON output
  --help               This message

Default (no action flags): --sitemaps --queries summary
`;
}

async function runQueries(gscProperty) {
  const { startDate, endDate } = dateRange(28);
  const { rows = [] } = await searchAnalyticsQuery(
    {
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit: 5000,
    },
    gscProperty,
  );

  const p0 = rows.filter((r) => {
    const q = (r.keys?.[0] || '').toLowerCase();
    return P0_QUERY_FRAGMENTS.some((frag) => q.includes(frag.toLowerCase()));
  });

  return { startDate, endDate, totalRows: rows.length, p0Rows: p0 };
}

/** @param {string[]} argv */
export async function run(argv) {
  const siteOpts = parseArgs(argv);
  if (siteOpts.help) {
    console.log(printHelp());
    return 0;
  }

  const site = loadSite(siteOpts.site);
  const gscProperty = site.gscProperty ?? process.env.GSC_PROPERTY;
  const origin = canonicalOrigin(siteOpts.site);
  const sitemapFeed = site.sitemapIndex ?? `${origin}/sitemap-index.xml`;
  const { property } = getGscConfig(gscProperty);

  const args = argv;
  const json = args.includes('--json');
  const report = { site: siteOpts.site, property, actions: [] };

  const want = {
    sites: args.includes('--sites'),
    sitemaps: args.includes('--sitemaps'),
    submit: args.includes('--submit-sitemap'),
    queries: args.includes('--queries'),
    inspectHubs: args.includes('--inspect-hubs'),
  };

  const inspectPathIdx = args.indexOf('--inspect');
  const inspectPath = inspectPathIdx >= 0 ? args[inspectPathIdx + 1] : null;

  const explicit =
    want.sites || want.sitemaps || want.submit || want.queries || want.inspectHubs || inspectPath;
  if (!explicit) {
    want.sitemaps = true;
    want.queries = true;
  }

  if (want.sites) {
    report.sites = await listSites();
    report.actions.push('sites');
  }

  if (want.sitemaps) {
    report.sitemaps = await listSitemaps(property);
    report.actions.push('sitemaps');
  }

  if (want.submit) {
    await submitSitemap(sitemapFeed, property);
    report.sitemapSubmitted = sitemapFeed;
    report.actions.push('submit-sitemap');
  }

  if (want.queries) {
    report.queries = await runQueries(property);
    report.actions.push('queries');
  }

  if (inspectPath) {
    const url = inspectPath.startsWith('http') ? inspectPath : `${origin}${inspectPath}`;
    report.inspection = await inspectUrl(url, property);
    report.actions.push('inspect');
  }

  if (want.inspectHubs) {
    report.hubInspections = [];
    for (const path of HUB_PATHS) {
      const url = path === '/' ? `${origin}/` : `${origin}${path}`;
      const result = await inspectUrl(url, property);
      const verdict = result.inspectionResult?.indexStatusResult?.verdict;
      report.hubInspections.push({ path, url, verdict });
    }
    report.actions.push('inspect-hubs');
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`GSC audit — ${siteOpts.site} (${property})`);
    console.log(`Actions: ${report.actions.join(', ')}\n`);

    if (report.sites) {
      console.log('Properties:');
      for (const s of report.sites) {
        console.log(`  ${s.siteUrl} (${s.permissionLevel})`);
      }
      console.log();
    }

    if (report.sitemaps) {
      console.log('Sitemaps:');
      for (const s of report.sitemaps) {
        console.log(
          `  ${s.path} — pending ${s.pending ?? 0}, errors ${s.errors ?? 0}, warnings ${s.warnings ?? 0}`,
        );
      }
      console.log();
    }

    if (report.sitemapSubmitted) {
      console.log(`Submitted: ${report.sitemapSubmitted}\n`);
    }

    if (report.queries) {
      const { startDate, endDate, p0Rows } = report.queries;
      console.log(`P0 queries (${startDate} → ${endDate}):`);
      if (p0Rows.length === 0) {
        console.log('  (no rows matching P0 fragments yet)');
      } else {
        for (const r of p0Rows
          .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
          .slice(0, 25)) {
          const q = r.keys?.[0] ?? '?';
          console.log(
            `  ${q} — clicks ${r.clicks ?? 0}, impr ${r.impressions ?? 0}, pos ${(r.position ?? 0).toFixed(1)}`,
          );
        }
      }
      console.log();
    }

    if (report.hubInspections) {
      console.log('Hub URL inspection:');
      for (const h of report.hubInspections) {
        console.log(`  ${h.path} — ${h.verdict ?? 'unknown'}`);
      }
      console.log();
    }

    if (report.inspection) {
      const v = report.inspection.inspectionResult?.indexStatusResult?.verdict;
      console.log(`Inspection verdict: ${v ?? 'unknown'}\n`);
    }
  }

  return 0;
}

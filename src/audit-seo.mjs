import {
  parseCliArgs,
  printCliHelp,
  runSeoAudit,
  formatTextReport,
} from './seo-audit-lib.mjs';

/** @param {string[]} argv */
export async function run(argv) {
  const opts = parseCliArgs(argv);

  if (opts.help || !opts.base) {
    console.log(printCliHelp());
    return opts.help ? 0 : 1;
  }

  let base;
  try {
    base = new URL(opts.base).origin;
  } catch {
    console.error(`Invalid --base URL: ${opts.base}`);
    return 1;
  }

  const report = await runSeoAudit(base, {
    compareCanonical: opts.compareCanonical,
    probeDuplicates: opts.probeDuplicates,
    maxUrls: opts.maxUrls,
    paths: opts.paths,
  });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTextReport(report));
  }

  const hasHardFailure = report.results.some((r) =>
    r.flags.some((f) => f === 'redirect_loop' || f === 'missing_canonical'),
  );

  return hasHardFailure ? 1 : 0;
}

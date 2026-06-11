import * as cheerio from 'cheerio';

const LOC_RE = /<loc>([^<]+)<\/loc>/g;

/** @param {string} xml */
export function parseSitemapLocs(xml) {
  const urls = [];
  let m;
  while ((m = LOC_RE.exec(xml)) !== null) urls.push(m[1]);
  return urls;
}

/** @param {string} html */
export function getMetaMap(html) {
  const $ = cheerio.load(html);
  const map = { title: $('title').text() || undefined };
  map.canonical = $('link[rel="canonical"]').attr('href');
  $('meta').each((_, el) => {
    const key = $(el).attr('name') || $(el).attr('property');
    const val = $(el).attr('content');
    if (key && val) map[key] = val;
  });
  return map;
}

/** @param {string} html */
export function getJsonLdTypes(html) {
  const types = new Set();
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const t = item['@type'];
        if (typeof t === 'string') types.add(t);
        else if (Array.isArray(t)) t.forEach((x) => types.add(x));
      }
    } catch {
      types.add('(parse-error)');
    }
  }
  return [...types];
}

/**
 * @param {string} url
 * @param {{ maxRedirects?: number, method?: 'GET' | 'HEAD' }} [opts]
 */
export async function fetchWithRedirectChain(url, opts = {}) {
  const maxRedirects = opts.maxRedirects ?? 10;
  const chain = [];
  let current = url;

  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(current, { method: 'HEAD', redirect: 'manual' });
    const location = res.headers.get('location');
    chain.push({ url: current, status: res.status, location: location || undefined });

    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }

    const getRes = await fetch(current, { redirect: 'manual' });
    const html =
      getRes.status === 200 || getRes.status === 404 ? await getRes.text() : '';
    return {
      chain,
      finalUrl: current,
      status: getRes.status,
      html,
    };
  }

  return {
    chain,
    finalUrl: current,
    status: 0,
    html: '',
    error: 'redirect_loop',
  };
}

/** @param {URL} base */
export function pathFromUrl(base, absoluteUrl) {
  const u = new URL(absoluteUrl);
  if (u.origin !== base.origin) return u.pathname + u.search;
  return u.pathname + u.search || '/';
}

/** Collapse index.html-style aliases for identity comparison. */
export function normalizePathname(pathname) {
  let p = pathname.replace(/\.html$/, '').replace(/\/index$/, '') || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

/** Strict path key for duplicate-surface detection (keeps `.html`). */
export function strictPathKey(pathname) {
  let p = pathname || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

/** @param {string} path */
export function duplicateVariants(path) {
  const normalized = path.replace(/\/$/, '') || '/';
  const variants = new Set([normalized]);
  if (normalized === '/') {
    variants.add('/index.html');
    variants.add('/index');
  } else {
    variants.add(`${normalized}/`);
    variants.add(`${normalized}.html`);
  }
  return [...variants];
}

const DEFAULT_DUPLICATE_SEEDS = ['/', '/blocks', '/vineyard', '/varietals', '/wineries'];

/**
 * @param {string} baseUrl
 * @param {{ probeDuplicates?: boolean, maxUrls?: number, extraPaths?: string[] }} [opts]
 */
export async function collectAuditUrls(baseUrl, opts = {}) {
  const base = new URL(baseUrl);
  const paths = new Set();

  try {
    const indexRes = await fetch(new URL('/sitemap-index.xml', base), { redirect: 'manual' });
    if (indexRes.ok) {
      const indexXml = await indexRes.text();
      const childLocs = parseSitemapLocs(indexXml);
      for (const child of childLocs) {
        const childRes = await fetch(child, { redirect: 'manual' });
        if (childRes.ok) {
          for (const loc of parseSitemapLocs(await childRes.text())) {
            paths.add(pathFromUrl(base, loc));
          }
        }
      }
    }
  } catch {
    /* sitemap optional when probing explicit paths */
  }

  if (opts.probeDuplicates !== false) {
    for (const seed of DEFAULT_DUPLICATE_SEEDS) {
      for (const v of duplicateVariants(seed)) paths.add(v);
    }
  }

  for (const p of opts.extraPaths ?? []) paths.add(p);

  let list = [...paths].sort();
  if (opts.maxUrls != null && opts.maxUrls > 0) list = list.slice(0, opts.maxUrls);
  return list;
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {{ compareCanonical?: boolean }} [opts]
 */
export async function auditPath(baseUrl, path, opts = {}) {
  const base = new URL(baseUrl);
  const url = new URL(path.startsWith('/') ? path : `/${path}`, base).toString();
  const fetched = await fetchWithRedirectChain(url);
  const meta = fetched.html ? getMetaMap(fetched.html) : {};
  const jsonLdTypes = fetched.html ? getJsonLdTypes(fetched.html) : [];
  const flags = [];

  if (fetched.error === 'redirect_loop') flags.push('redirect_loop');
  if (fetched.status !== 200) flags.push(`http_${fetched.status}`);
  if (fetched.status === 200 && !meta.description) flags.push('missing_description');
  if (fetched.status === 200 && !meta.canonical) flags.push('missing_canonical');

  if (meta.canonical) {
    try {
      const canon = new URL(meta.canonical);
      if (opts.compareCanonical && canon.origin !== base.origin) {
        flags.push('canonical_off_base');
      }
      const reqPath = new URL(fetched.finalUrl).pathname;
      const canonPath = canon.pathname;
      if (
        fetched.status === 200 &&
        (strictPathKey(reqPath) !== strictPathKey(canonPath) || reqPath !== canonPath)
      ) {
        flags.push('alternate_canonical');
      }
    } catch {
      flags.push('invalid_canonical');
    }
  }

  return {
    path,
    url,
    ...fetched,
    meta,
    jsonLdTypes,
    flags,
  };
}

/**
 * @param {string} baseUrl
 * @param {import('./seo-audit-lib.mjs').AuditOptions} [opts]
 */
export async function runSeoAudit(baseUrl, opts = {}) {
  const paths =
    opts.paths?.length > 0
      ? opts.paths
      : await collectAuditUrls(baseUrl, {
          probeDuplicates: opts.probeDuplicates,
          maxUrls: opts.maxUrls,
        });

  const results = [];
  for (const path of paths) {
    results.push(
      await auditPath(baseUrl, path, { compareCanonical: opts.compareCanonical }),
    );
  }

  const summary = {
    base: baseUrl,
    audited: results.length,
    alternates: results.filter((r) => r.flags.includes('alternate_canonical')),
    offDomainCanonical: results.filter((r) => r.flags.includes('canonical_off_base')),
    non200: results.filter((r) => r.status !== 200),
    redirectLoops: results.filter((r) => r.flags.includes('redirect_loop')),
  };

  return { paths, results, summary };
}

/** @param {{ results: ReturnType<typeof auditPath> extends Promise<infer T> ? T : never }[], summary: object }} report */
export function formatTextReport({ results, summary }) {
  const lines = [
    `SEO audit: ${summary.base}`,
    `URLs audited: ${summary.audited}`,
    '',
  ];

  for (const r of results) {
    const chain =
      r.chain.length > 1
        ? ` → ${r.chain.map((c) => `${c.status}`).join(' → ')}`
        : '';
    lines.push(`${r.path}`);
    lines.push(`  final: ${r.status} ${r.finalUrl}${chain}`);
    if (r.meta.title) lines.push(`  title: ${r.meta.title}`);
    if (r.meta.canonical) lines.push(`  canonical: ${r.meta.canonical}`);
    if (r.meta.description) {
      const d = r.meta.description;
      lines.push(`  description: ${d.length > 72 ? `${d.slice(0, 72)}…` : d}`);
    }
    if (r.jsonLdTypes.length) lines.push(`  json-ld: ${r.jsonLdTypes.join(', ')}`);
    if (r.flags.length) lines.push(`  flags: ${r.flags.join(', ')}`);
    lines.push('');
  }

  if (summary.alternates.length) {
    lines.push(`Alternate surfaces (canonical elsewhere): ${summary.alternates.length}`);
  }
  if (summary.offDomainCanonical.length) {
    lines.push(`Canonical off --base host: ${summary.offDomainCanonical.length}`);
  }
  if (summary.non200.length) {
    lines.push(`Non-200: ${summary.non200.length}`);
  }

  return lines.join('\n');
}

/** @param {string[]} argv */
export function parseCliArgs(argv) {
  const opts = {
    base: undefined,
    compareCanonical: false,
    probeDuplicates: true,
    json: false,
    maxUrls: undefined,
    paths: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--base') opts.base = argv[++i];
    else if (arg === '--compare-canonical') opts.compareCanonical = true;
    else if (arg === '--no-probe-duplicates') opts.probeDuplicates = false;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--max-urls') opts.maxUrls = Number(argv[++i]);
    else if (arg === '--paths') opts.paths = argv[++i].split(',').map((p) => p.trim());
  }

  return opts;
}

export function printCliHelp() {
  return `Usage: optimizer-tools audit:seo --base <origin> [options]

Options:
  --base <url>            Site origin (required), e.g. https://ferringtonvineyards.com
  --compare-canonical     Flag pages whose canonical origin differs from --base
  --paths <a,b,c>         Audit only these paths (skips sitemap discovery)
  --max-urls <n>          Cap number of URLs (after sitemap + duplicate probes)
  --no-probe-duplicates   Skip /foo/, /foo.html, /index.html variants
  --json                  Print JSON report
  --help                  Show this help

Examples:
  docker compose run --rm optimizer-tools audit:seo --base https://ferringtonvineyards.com
  docker compose run --rm optimizer-tools audit:seo --base https://ferrington.vin --compare-canonical --max-urls 20
`;
}

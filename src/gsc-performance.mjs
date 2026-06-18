import {
  searchAnalyticsQuery,
  dateRange,
  P0_QUERY_FRAGMENTS,
} from './gsc-api.mjs';

function normalizeQueryRow(r) {
  return {
    query: r.keys?.[0] ?? null,
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? null,
  };
}

function filterTrackedQueries(rows, fragments) {
  return rows.filter((r) => {
    const q = (r.query || '').toLowerCase();
    return fragments.some((frag) => q.includes(frag.toLowerCase()));
  });
}

/** @param {string} property GSC property id (e.g. sc-domain:example.com) */
export async function fetchGscPerformance(property, windowDays) {
  const { startDate, endDate } = dateRange(windowDays);
  const [byQuery, byPage] = await Promise.all([
    searchAnalyticsQuery(
      { startDate, endDate, dimensions: ['query'], rowLimit: 25000 },
      property,
    ),
    searchAnalyticsQuery(
      { startDate, endDate, dimensions: ['page'], rowLimit: 25000 },
      property,
    ),
  ]);

  const queries = (byQuery.rows ?? []).map(normalizeQueryRow);
  const pages = (byPage.rows ?? []).map((r) => ({
    page: r.keys?.[0] ?? null,
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? null,
  }));

  const totals = queries.reduce(
    (acc, r) => {
      acc.clicks += r.clicks;
      acc.impressions += r.impressions;
      return acc;
    },
    { clicks: 0, impressions: 0 },
  );

  const sortByImpressions = (a, b) => b.impressions - a.impressions;

  return {
    property,
    startDate,
    endDate,
    days: windowDays,
    totals,
    queryCount: queries.length,
    pageCount: pages.length,
    queries: queries.sort(sortByImpressions),
    pages: pages.sort(sortByImpressions),
  };
}

export function withTrackedQueries(snapshot, fragments) {
  return {
    ...snapshot,
    trackedQueries: filterTrackedQueries(snapshot.queries, fragments).sort(
      (a, b) => b.impressions - a.impressions,
    ),
  };
}

/** @param {string[]} properties */
export async function captureGscPerformanceBaseline(properties, opts = {}) {
  const days = opts.days ?? 28;
  const fragments = opts.fragments ?? P0_QUERY_FRAGMENTS;

  const propertySnapshots = await Promise.all(
    properties.map(async (property) =>
      withTrackedQueries(await fetchGscPerformance(property, days), fragments),
    ),
  );

  return {
    schema: 'optimizer-gsc-performance-baseline/v1',
    capturedAt: new Date().toISOString(),
    days,
    queryFragments: fragments,
    properties: propertySnapshots,
  };
}

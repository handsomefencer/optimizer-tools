const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WEBMASTERS_BASE = 'https://www.googleapis.com/webmasters/v3';
const INSPECTION_BASE = 'https://searchconsole.googleapis.com/v1';

export function getGscConfig(propertyOverride) {
  const property = propertyOverride || process.env.GSC_PROPERTY || 'sc-domain:ferringtonvineyards.com';
  const clientId = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;
  const refreshToken = process.env.GSC_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Set GSC_CLIENT_ID, GSC_CLIENT_SECRET, and GSC_REFRESH_TOKEN in mise/containers/optimizer-tools/env/production.env. See docs/ferrington/todos/2026-06-09-ferrington-gsc-api-setup.md',
    );
  }

  return { property, clientId, clientSecret, refreshToken };
}

let cachedAccessToken = null;
let tokenExpiresAt = 0;

export async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const { clientId, clientSecret, refreshToken } = getGscConfig();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GSC token refresh failed: ${data.error_description || data.error || res.statusText}`);
  }

  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cachedAccessToken;
}

/** @param {string} path path after /webmasters/v3 */
export async function gscRequest(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${WEBMASTERS_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    throw new Error(`GSC API ${method} ${path}: ${msg}`);
  }
  return data;
}

export function encodeSiteUrl(siteUrl) {
  return encodeURIComponent(siteUrl);
}

export async function listSites() {
  const data = await gscRequest('/sites');
  return data.siteEntry ?? [];
}

export async function listSitemaps(siteUrl) {
  const property = siteUrl ?? getGscConfig().property;
  const data = await gscRequest(`/sites/${encodeSiteUrl(property)}/sitemaps`);
  return data.sitemap ?? [];
}

/** @param {string} feedpath e.g. https://ferringtonvineyards.com/sitemap-index.xml */
export async function submitSitemap(feedpath, siteUrl) {
  const property = siteUrl ?? getGscConfig().property;
  const encodedFeed = encodeURIComponent(feedpath);
  return gscRequest(`/sites/${encodeSiteUrl(property)}/sitemaps/${encodedFeed}`, { method: 'PUT' });
}

/**
 * @param {{ startDate: string, endDate: string, dimensions?: string[], rowLimit?: number, dimensionFilterGroups?: unknown[] }} query
 */
export async function searchAnalyticsQuery(query, siteUrl) {
  const property = siteUrl ?? getGscConfig().property;
  return gscRequest(`/sites/${encodeSiteUrl(property)}/searchAnalytics/query`, {
    method: 'POST',
    body: {
      startDate: query.startDate,
      endDate: query.endDate,
      dimensions: query.dimensions ?? ['query'],
      rowLimit: query.rowLimit ?? 1000,
      dimensionFilterGroups: query.dimensionFilterGroups,
    },
  });
}

/** @param {string} inspectionUrl full URL */
export async function inspectUrl(inspectionUrl, siteUrl) {
  const property = siteUrl ?? getGscConfig().property;
  const token = await getAccessToken();
  const res = await fetch(`${INSPECTION_BASE}/urlInspection/index:inspect`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inspectionUrl, siteUrl: property }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`URL Inspection: ${data.error?.message || res.statusText}`);
  }
  return data;
}

export async function exchangeCodeForTokens(code, redirectUri) {
  const clientId = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Set GSC_CLIENT_ID and GSC_CLIENT_SECRET');
  }
  if (!redirectUri) {
    throw new Error('redirectUri required (use loopback URI from host-only gsc-auth.mjs)');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  }
  return data;
}

/** Last N days in YYYY-MM-DD (PT — API expects calendar dates). */
export function dateRange(days = 28) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export const P0_QUERY_FRAGMENTS = [
  'anderson valley',
  'cool climate',
  'ferrington',
  'gewurztraminer',
  'gewürztraminer',
];

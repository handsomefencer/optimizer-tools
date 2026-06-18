const API_BASE = 'https://api.cloudflare.com/client/v4';
const REDIRECT_PHASE = 'http_request_dynamic_redirect';

export function getApiToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_TOKEN;
  if (!token) {
    throw new Error(
      'Set CLOUDFLARE_API_TOKEN or CLOUDFLARE_TOKEN in clickholes/mise/containers/optimizer-tools/env/production.env. Token needs Zone DNS Read, SSL Read, Dynamic URL Redirects Edit (+ DNS Edit for --ensure-www-dns).',
    );
  }
  return token;
}

/** @param {string} path */
export async function cfRequest(path, { method = 'GET', body } = {}) {
  const token = getApiToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.success) {
    const msg = data.errors?.map((e) => e.message).join('; ') || res.statusText;
    throw new Error(`Cloudflare API ${method} ${path}: ${msg}`);
  }
  return data.result;
}

/** @param {string} zoneName */
export async function resolveZoneId(zoneName, cachedId) {
  if (cachedId) return cachedId;
  const zones = await cfRequest(`/zones?name=${encodeURIComponent(zoneName)}`);
  const match = zones?.find((z) => z.name === zoneName);
  if (!match) throw new Error(`Zone not found in account: ${zoneName}`);
  return match.id;
}

/** @param {string} zoneId */
export async function listDnsRecords(zoneId) {
  return cfRequest(`/zones/${zoneId}/dns_records?per_page=100`);
}

/** @param {string} zoneId */
export async function getSslMode(zoneId) {
  const result = await cfRequest(`/zones/${zoneId}/settings/ssl`);
  return result?.value;
}

/** @param {Error} err */
export function isMissingRedirectEntrypointError(err) {
  const msg = String(err.message).toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('10404') ||
    msg.includes('could not find entrypoint ruleset')
  );
}

/** @param {string} zoneId */
export async function getRedirectEntrypoint(zoneId) {
  try {
    return await cfRequest(`/zones/${zoneId}/rulesets/phases/${REDIRECT_PHASE}/entrypoint`);
  } catch (err) {
    if (isMissingRedirectEntrypointError(err)) {
      return null;
    }
    throw err;
  }
}

/**
 * @param {string} canonicalHost e.g. ferringtonvineyards.com
 * @param {string} zoneName
 */
export function buildFerringtonRedirectRules(canonicalHost, zoneName) {
  const targetExpr = `concat("https://${canonicalHost}", http.request.uri.path)`;
  const rules = [];

  if (zoneName === canonicalHost) {
    rules.push({
      ref: 'ferrington-seo-www-com',
      description: 'SEO: www → apex on ferringtonvineyards.com',
      expression: `(http.host eq "www.${zoneName}")`,
      action: 'redirect',
      action_parameters: {
        from_value: {
          status_code: 301,
          preserve_query_string: true,
          target_url: { expression: targetExpr },
        },
      },
    });
  }

  if (zoneName.endsWith('.vin')) {
    rules.push({
      ref: 'ferrington-seo-www-vin',
      description: `SEO: www.${zoneName} → ${canonicalHost}`,
      expression: `(http.host eq "www.${zoneName}")`,
      action: 'redirect',
      action_parameters: {
        from_value: {
          status_code: 301,
          preserve_query_string: true,
          target_url: { expression: targetExpr },
        },
      },
    });
    rules.push({
      ref: 'ferrington-seo-wildcard-vin',
      description: `SEO: *.${zoneName} (non-apex) → ${canonicalHost}`,
      expression: `(http.host ne "${zoneName}" and http.host wildcard "*.${zoneName}")`,
      action: 'redirect',
      action_parameters: {
        from_value: {
          status_code: 301,
          preserve_query_string: true,
          target_url: { expression: targetExpr },
        },
      },
    });
  }

  return rules;
}

const FERRINGTON_RULE_REFS = new Set([
  'ferrington-seo-www-com',
  'ferrington-seo-www-vin',
  'ferrington-seo-wildcard-vin',
]);

/**
 * Merge Ferrington SEO rules into entrypoint; preserve other rules.
 * @param {object|null} entrypoint
 * @param {object[]} desiredRules
 */
export function mergeRedirectRules(entrypoint, desiredRules) {
  const existing = entrypoint?.rules ?? [];
  const kept = existing.filter((r) => !FERRINGTON_RULE_REFS.has(r.ref));
  return [...desiredRules, ...kept];
}

/** @param {string} zoneId */
export async function putRedirectEntrypoint(zoneId, rules) {
  return cfRequest(`/zones/${zoneId}/rulesets/phases/${REDIRECT_PHASE}/entrypoint`, {
    method: 'PUT',
    body: { rules },
  });
}

/** @param {string} zoneId */
export async function ensureWwwCname(zoneId, apexName) {
  const records = await listDnsRecords(zoneId);
  const www = records.find(
    (r) => r.name === `www.${apexName}` || r.name === 'www',
  );
  if (www) return { created: false, record: www };

  const record = await cfRequest(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: {
      type: 'CNAME',
      name: 'www',
      content: apexName,
      proxied: true,
      ttl: 1,
    },
  });
  return { created: true, record };
}

/** @param {object[]} records @param {string} zoneName */
export function summarizeDns(records, zoneName) {
  const pick = (name) =>
    records.find((r) => r.name === name || r.name === `${name}.${zoneName}`);
  return {
    apex: pick(zoneName),
    www: pick('www') ?? pick(`www.${zoneName}`),
    wildcard: records.find((r) => r.name === `*.${zoneName}` || r.name === '*'),
  };
}

/** @param {object[]} desired @param {object[]} actual */
export function diffRedirectRules(desired, actual) {
  const byRef = new Map((actual ?? []).map((r) => [r.ref, r]));
  return desired.map((rule) => {
    const existing = byRef.get(rule.ref);
    const status = existing
      ? existing.expression === rule.expression &&
        existing.action === rule.action
        ? 'present'
        : 'drift'
      : 'missing';
    return { ref: rule.ref, description: rule.description, status };
  });
}

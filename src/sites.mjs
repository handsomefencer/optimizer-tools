import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SITES_CONFIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'sites.json');

export function loadSitesConfig() {
  return JSON.parse(readFileSync(SITES_CONFIG, 'utf8'));
}

/** @param {string} siteKey */
export function loadSite(siteKey) {
  const config = loadSitesConfig();
  const site = config.sites?.[siteKey];
  if (!site) {
    const known = Object.keys(config.sites ?? {}).join(', ') || '(none)';
    throw new Error(`Unknown site: ${siteKey}. Known: ${known}`);
  }
  return site;
}

/** @param {string} siteKey */
export function canonicalOrigin(siteKey) {
  const { canonicalHost } = loadSite(siteKey);
  return `https://${canonicalHost}`;
}

/** @param {{ gscProperty?: string, gscProperties?: string[], gscLegacyProperties?: string[] }} site */
export function gscPropertiesForSite(site) {
  if (site.gscProperties?.length) return site.gscProperties;
  const list = [];
  if (site.gscProperty) list.push(site.gscProperty);
  for (const p of site.gscLegacyProperties ?? []) {
    if (!list.includes(p)) list.push(p);
  }
  return list;
}

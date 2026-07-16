import { createHash } from 'node:crypto';
import { config } from './config.js';

/*
 * Netlify deploy — publishes a generated static site to the user's Netlify
 * account and returns the live URL. No SDK: just the REST API + fetch.
 *
 * Flow (Netlify's file-digest deploy):
 *   1. create a site
 *   2. create a deploy with a { path: sha1 } digest of every file
 *   3. upload the files Netlify says it still needs
 *
 * The token is a secret — it lives in .env (NETLIFY_TOKEN), never in the repo.
 */

const API = 'https://api.netlify.com/api/v1';

export const netlifyReady = () => Boolean(config.netlifyToken);

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${config.netlifyToken}`, ...extra };
}

const sha1 = (s) => createHash('sha1').update(s, 'utf8').digest('hex');

/**
 * Deploy a static site. `files` is a map of path → string content, e.g.
 * { '/index.html': '<!doctype html>…' }. Returns { url, adminUrl, siteId }.
 */
export async function deploySite({ files, name }) {
  if (!netlifyReady()) throw new Error('Netlify is not configured (set NETLIFY_TOKEN).');

  // Normalize to leading-slash paths and compute the digest.
  const norm = {};
  for (const [p, content] of Object.entries(files)) {
    norm[p.startsWith('/') ? p : '/' + p] = String(content);
  }
  const digest = {};
  for (const [p, content] of Object.entries(norm)) digest[p] = sha1(content);

  // 1) create the site
  const siteRes = await fetch(`${API}/sites`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(name ? { name } : {}),
  });
  const site = await siteRes.json();
  if (!siteRes.ok) throw new Error(site.message || site.error || `create site ${siteRes.status}`);

  // 2) create the deploy with the file digest
  const depRes = await fetch(`${API}/sites/${site.id}/deploys`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ files: digest }),
  });
  const deploy = await depRes.json();
  if (!depRes.ok) throw new Error(deploy.message || `create deploy ${depRes.status}`);

  // 3) upload the files Netlify still needs (matched by sha)
  const required = new Set(deploy.required || []);
  for (const [p, content] of Object.entries(norm)) {
    if (required.size && !required.has(digest[p])) continue; // already have it
    const path = p.replace(/^\//, '');
    const up = await fetch(`${API}/deploys/${deploy.id}/files/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: Buffer.from(content, 'utf8'),
    });
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      throw new Error(`upload ${path} ${up.status}: ${t.slice(0, 120)}`);
    }
  }

  return {
    url: site.ssl_url || site.url || (site.subdomain ? `https://${site.subdomain}.netlify.app` : null),
    adminUrl: site.admin_url || null,
    siteId: site.id,
    deployId: deploy.id,
  };
}

/** Delete a site (used to clean up test/preview sites). */
export async function deleteSite(siteId) {
  if (!netlifyReady()) throw new Error('Netlify is not configured.');
  const res = await fetch(`${API}/sites/${siteId}`, { method: 'DELETE', headers: authHeaders() });
  return res.ok;
}

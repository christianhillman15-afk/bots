import { config } from '../config.js';

/*
 * Minimal, polite robots.txt checker (RFC 9309). We only ever fetch a
 * business's public homepage, but we still honor Disallow rules for our
 * user-agent. Results are cached per-host for the life of the process.
 */
const cache = new Map(); // host -> { rules } | null

function uaToken() {
  // "OxsomeProspectorBot/1.0 (...)" -> "oxsomeprospectorbot"
  return (config.userAgent.split('/')[0] || 'oxsomeprospectorbot').toLowerCase();
}

async function loadRules(origin) {
  if (cache.has(origin)) return cache.get(origin);
  let rules = { '*': [], [uaToken()]: [] };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(origin + '/robots.txt', {
      signal: controller.signal,
      headers: { 'User-Agent': config.userAgent },
    });
    clearTimeout(t);
    if (res.ok) {
      const text = await res.text();
      rules = parseRobots(text);
    }
  } catch {
    /* no robots.txt or unreachable => treat as allow-all */
  }
  cache.set(origin, rules);
  return rules;
}

function parseRobots(text) {
  const groups = {};
  let current = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const key = field.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      if (!groups[agent]) groups[agent] = [];
      current = groups[agent];
    } else if (key === 'disallow' && current) {
      current.push(value);
    }
  }
  return groups;
}

/** True if our bot is allowed to fetch `url`. Defaults to allowed. */
export async function isAllowed(url) {
  let origin, path;
  try {
    const u = new URL(url);
    origin = u.origin;
    path = u.pathname || '/';
  } catch {
    return true;
  }
  const groups = await loadRules(origin);
  const disallows = groups[uaToken()] ?? groups['*'] ?? [];
  // An empty "Disallow:" means allow everything.
  return !disallows.some((rule) => rule && path.startsWith(rule));
}

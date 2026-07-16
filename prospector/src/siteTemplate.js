/*
 * Generates a top-of-the-line, self-contained one-page website for a lead.
 * Everything is inline (no external fonts, images, or scripts) so it loads
 * instantly and deploys as a single index.html — important when the rep is
 * live on a call saying "I already built you one, here's the link."
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Per-trade copy: hero tagline + service cards (title + one-line blurb + icon).
// Falls back to a solid generic set for any category not listed.
const TRADES = {
  plumbing: { tagline: 'Fast, reliable plumbing you can count on', services: [
    ['Emergency Repairs', 'Burst pipes, leaks and clogs handled fast — day or night.', 'wrench'],
    ['Water Heaters', 'Repair, replace and tankless upgrades done right.', 'flame'],
    ['Drains & Sewer', 'Clearing, camera inspection and trenchless repair.', 'drop'],
    ['Remodels & Fixtures', 'Kitchens, baths and new fixture installs.', 'home'],
  ] },
  hvac: { tagline: 'Comfortable homes, honest heating & cooling', services: [
    ['AC Repair & Install', 'Keep cool all summer with fast, fair service.', 'snow'],
    ['Heating & Furnaces', 'Repairs, tune-ups and efficient replacements.', 'flame'],
    ['Maintenance Plans', 'Seasonal tune-ups that prevent costly breakdowns.', 'shield'],
    ['Indoor Air Quality', 'Filtration and humidity control for healthier air.', 'wind'],
  ] },
  roofing: { tagline: 'Roofs that protect what matters most', services: [
    ['Roof Replacement', 'Durable, warrantied roofs installed by pros.', 'home'],
    ['Storm & Leak Repair', 'Fast response to leaks and storm damage.', 'bolt'],
    ['Inspections', 'Free, honest roof assessments and estimates.', 'shield'],
    ['Gutters', 'Seamless gutters and guards to protect your home.', 'drop'],
  ] },
  electrical: { tagline: 'Safe, code-perfect electrical work', services: [
    ['Repairs & Troubleshooting', 'Fix flickering, outages and safety issues fast.', 'bolt'],
    ['Panel Upgrades', 'Modern panels ready for today’s power needs.', 'shield'],
    ['EV Chargers', 'Home charging stations installed cleanly.', 'plug'],
    ['Lighting & Wiring', 'Indoor/outdoor lighting and full rewires.', 'bulb'],
  ] },
  remodeling: { tagline: 'Craftsmanship that transforms your home', services: [
    ['Kitchens', 'Beautiful, functional kitchens built to last.', 'home'],
    ['Bathrooms', 'Spa-worthy bathroom remodels done right.', 'drop'],
    ['Additions', 'More space, seamlessly matched to your home.', 'plus'],
    ['Whole-Home', 'Full renovations managed start to finish.', 'star'],
  ] },
  landscaping: { tagline: 'Outdoor spaces you’ll love coming home to', services: [
    ['Design & Install', 'Custom landscapes that boost curb appeal.', 'leaf'],
    ['Lawn Care', 'Reliable maintenance that keeps it pristine.', 'leaf'],
    ['Hardscapes', 'Patios, walkways and retaining walls.', 'home'],
    ['Irrigation', 'Efficient sprinkler systems installed & serviced.', 'drop'],
  ] },
  painting: { tagline: 'A flawless finish, inside and out', services: [
    ['Interior Painting', 'Clean lines and rich color, zero mess.', 'brush'],
    ['Exterior Painting', 'Weather-tough finishes that last for years.', 'home'],
    ['Cabinets', 'Factory-smooth cabinet refinishing.', 'star'],
    ['Prep & Repair', 'Patching, caulking and surface prep done right.', 'wrench'],
  ] },
};
const GENERIC = (label) => ({
  tagline: `Trusted ${label.toLowerCase()} done right the first time`,
  services: [
    ['Expert Service', `Professional ${label.toLowerCase()} you can rely on.`, 'star'],
    ['Fast Response', 'Quick scheduling and on-time arrivals.', 'bolt'],
    ['Fair Pricing', 'Upfront, honest quotes with no surprises.', 'shield'],
    ['Local & Trusted', 'Proudly serving your community.', 'home'],
  ],
});

const ICONS = {
  wrench: '<path d="M21 3a6 6 0 0 1-8 8l-8 8-2-2 8-8a6 6 0 0 1 8-8l-3 3 2 2 3-3z"/>',
  flame: '<path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s0 2 2 2c0-3 2-5 2-8z"/>',
  drop: '<path d="M12 2s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  snow: '<path d="M12 2v20M4 6l16 12M20 6L4 18"/>',
  shield: '<path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 16h14a3 3 0 1 1-3 3"/>',
  bolt: '<path d="M13 2L4 14h7l-2 8 9-12h-7z"/>',
  plug: '<path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6"/>',
  bulb: '<path d="M9 21h6M10 21v-3M14 21v-3M8 13a5 5 0 1 1 8 0c-1 1-2 2-2 4h-4c0-2-1-3-2-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="M12 3l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 10l6-1z"/>',
  leaf: '<path d="M4 20C4 10 12 4 20 4c0 10-8 16-16 16zM4 20c4-4 8-6 12-8"/>',
  brush: '<path d="M14 3l7 7-6 6-4-4M4 20s2-6 5-7l3 3c-1 3-7 5-8 4z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.star}</svg>`;

// Deterministic seed from a string, so a given business always gets the SAME
// look (stable across re-generations) but different businesses get different ones.
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

// Premium palettes — curated to be VISUALLY DISTINCT from one another (spread
// across the color wheel + a mix of dark and light), so two different businesses
// never get sites that look alike. Each: base bg/panel/ink, text/muted/line, two accents.
const THEMES = [
  { light: 0, bg: '#0b1220', panel: '#111a2e', ink: '#0f1729', txt: '#e8eefc', mut: '#9fb0d0', line: 'rgba(255,255,255,.09)', a1: '#3b82f6', a2: '#22d3ee' }, // midnight blue
  { light: 0, bg: '#08130e', panel: '#0f2119', ink: '#0a1812', txt: '#e6f6ee', mut: '#9dc3b2', line: 'rgba(255,255,255,.09)', a1: '#10b981', a2: '#a3e635' }, // emerald / lime
  { light: 0, bg: '#0e0a1a', panel: '#1a1330', ink: '#130e24', txt: '#efe9fc', mut: '#b6a8d8', line: 'rgba(255,255,255,.1)', a1: '#8b5cf6', a2: '#ec4899' }, // purple / magenta
  { light: 0, bg: '#150f08', panel: '#271b0e', ink: '#1c1309', txt: '#fdefdd', mut: '#d3b691', line: 'rgba(255,255,255,.1)', a1: '#f59e0b', a2: '#f97316' }, // amber / orange
  { light: 0, bg: '#120a0d', panel: '#241017', ink: '#1a0b10', txt: '#ffe9ec', mut: '#d69aa6', line: 'rgba(255,255,255,.1)', a1: '#ef4444', a2: '#f43f5e' }, // crimson / rose
  { light: 0, bg: '#0b0f10', panel: '#16201f', ink: '#0f1717', txt: '#eef4f3', mut: '#9fb3b1', line: 'rgba(255,255,255,.09)', a1: '#64748b', a2: '#84cc16' }, // graphite + lime
  { light: 1, bg: '#f6f8fc', panel: '#ffffff', ink: '#eef2f9', txt: '#0f1729', mut: '#54627d', line: 'rgba(15,23,41,.12)', a1: '#2563eb', a2: '#0891b2' }, // clean light (blue)
  { light: 1, bg: '#faf6f0', panel: '#ffffff', ink: '#f3ece2', txt: '#1c1917', mut: '#78716c', line: 'rgba(28,25,23,.12)', a1: '#ea580c', a2: '#d97706' }, // warm sand (light)
  { light: 1, bg: '#f2f8f5', panel: '#ffffff', ink: '#e7f1ec', txt: '#0f1c18', mut: '#4f6a60', line: 'rgba(15,28,24,.12)', a1: '#059669', a2: '#0d9488' }, // fresh light (emerald)
  { light: 0, bg: '#0a0d16', panel: '#131828', ink: '#0d1120', txt: '#e9ecf8', mut: '#9aa3c4', line: 'rgba(255,255,255,.1)', a1: '#6366f1', a2: '#22d3ee' }, // indigo + cyan
];

// Style variants — corner rounding, heading font, and hero layout.
const STYLES = [
  { radius: '16px', head: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`, hero: 'split', pill: '999px' },
  { radius: '8px', head: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`, hero: 'center', pill: '8px' },
  { radius: '22px', head: `Georgia,'Times New Roman',serif`, hero: 'split', pill: '999px' },
  { radius: '4px', head: `'Segoe UI',Tahoma,Geneva,sans-serif`, hero: 'center', pill: '4px' },
  { radius: '18px', head: `'Trebuchet MS',Verdana,sans-serif`, hero: 'split', pill: '14px' },
];

export function buildSiteHtml(business = {}) {
  const name = esc(business.name || 'Your Business');
  const label = business.categoryLabel || business.category || 'Local Services';
  const trade = TRADES[business.category] || GENERIC(String(label));
  const city = business.city ? esc(business.city) : '';
  const state = business.state ? esc(business.state) : '';
  const area = city ? `${city}${state ? ', ' + state : ''}` : 'your area';
  const phoneRaw = (business.phone || '').replace(/[^\d+]/g, '');
  const phoneDisp = esc(business.phone || '');
  const hasPhone = phoneRaw.length >= 10;
  const rating = business.rating;
  const reviews = business.reviewCount || 0;
  const stars = rating ? '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating)) : '';
  const callBtn = (cls) => hasPhone
    ? `<a class="${cls}" href="tel:${esc(phoneRaw)}">Call ${phoneDisp}</a>`
    : `<a class="${cls}" href="#contact">Get a Free Quote</a>`;

  const servicesHtml = trade.services.map(([t, d, ic]) => `
        <div class="svc">
          <div class="svc__ic">${icon(ic)}</div>
          <h3>${esc(t)}</h3>
          <p>${esc(d)}</p>
        </div>`).join('');

  const ratingHtml = rating
    ? `<div class="rating"><span class="stars">${stars}</span><span>${rating} · ${reviews} Google reviews</span></div>`
    : '';

  // Hero visual: a glass "Google reviews" trust card built from REAL data. If we
  // have no rating, fall back to a generic (still-true) trust card — never a
  // fabricated review/number that the prospect might publish as fact.
  const heroCard = rating
    ? `<div class="glass gcard">
         <div class="gcard__top"><div class="glogo">G</div><div><b>Google Reviews</b><div class="mut">Verified local business</div></div></div>
         <div class="gcard__rate"><span class="big">${rating}</span><span class="stars">${stars}</span></div>
         <div class="mut">Based on ${reviews} customer reviews</div>
       </div>`
    : `<div class="glass gcard">
         <div class="gcard__top"><div class="glogo">✓</div><div><b>Trusted Local Pro</b><div class="mut">Serving ${esc(area)}</div></div></div>
         <div class="gcard__rate"><span class="stars">★★★★★</span></div>
         <div class="mut">Licensed, insured &amp; recommended</div>
       </div>`;
  const heroVisual = `
      <div class="hero-visual">
        ${heroCard}
        <div class="glass qcard"><b>Free, no-obligation estimates</b><span class="mut">Know the price before any work begins.</span></div>
        <div class="chips"><span>Licensed</span><span>Insured</span><span>Free Estimates</span><span>Fast Response</span></div>
      </div>`;

  // Stats strip — real data only.
  const statItems = [];
  if (rating) statItems.push([`${rating}★`, 'Google rating']);
  if (reviews) statItems.push([`${reviews}+`, 'happy customers']);
  statItems.push(['100%', 'licensed &amp; insured']);
  statItems.push(['Free', 'estimates']);
  const statsStrip = `<div class="stats-strip">${statItems.map(([n, l]) => `<div class="stat"><div class="stat__n">${n}</div><div class="stat__l">${l}</div></div>`).join('')}</div>`;

  // Pick a palette + style deterministically so every business gets a distinct,
  // stable look.
  const seed = hashSeed((business.name || 'x') + '|' + (business.id || business.placeId || business.city || ''));
  // _forceTheme/_forceStyle are test-only overrides (never set in production).
  const theme = THEMES[(Number.isInteger(business._forceTheme) ? business._forceTheme : seed) % THEMES.length];
  const style = STYLES[(Number.isInteger(business._forceStyle) ? business._forceStyle : Math.floor(seed / 13)) % STYLES.length];

  const heroCopy = `
    <div class="eyebrow">${esc(label)}${city ? ' · ' + city + (state ? ', ' + state : '') : ''}</div>
    <h1>${esc(trade.tagline)}</h1>
    <p class="sub">${name} delivers dependable, high-quality ${esc(String(label).toLowerCase())} for homeowners across ${esc(area)}. Licensed, insured, and obsessed with doing it right.</p>
    ${ratingHtml}
    <div class="cta">${callBtn('btn')}<a class="btn btn--ghost" href="#services">View Services</a></div>
    <div class="badges">
      <span><span class="dot"></span> Licensed &amp; Insured</span>
      <span><span class="dot"></span> Free Estimates</span>
      <span><span class="dot"></span> Fast Response</span>
      <span><span class="dot"></span> Locally Owned</span>
    </div>`;
  const heroSection = style.hero === 'center'
    ? `<header class="hero hero--center"><div class="wrap"><div class="hero-center">${heroCopy}</div></div></header>`
    : `<header class="hero"><div class="wrap"><div class="hero-split"><div class="hero-copy">${heroCopy}</div>${heroVisual}</div></div></header>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name} — ${esc(label)}${city ? ' in ' + city : ''}</title>
<meta name="description" content="${name} — professional ${esc(String(label).toLowerCase())} serving ${esc(area)}. ${hasPhone ? 'Call ' + phoneDisp + ' for a free quote.' : 'Request a free quote today.'}" />
<style>
:root{--bg:${theme.bg};--panel:${theme.panel};--ink:${theme.ink};--txt:${theme.txt};--mut:${theme.mut};--accent:${theme.a1};--accent2:${theme.a2};--line:${theme.line};--radius:${style.radius};--pill:${style.pill};--head:${style.head}}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--txt);line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,.logo{font-family:var(--head)}
a{color:inherit;text-decoration:none}
.wrap{max-width:1140px;margin:0 auto;padding:0 22px}
.btn{display:inline-block;background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.28);font-weight:800;padding:14px 26px;border-radius:var(--pill);font-size:16px;box-shadow:0 14px 34px -10px color-mix(in srgb,var(--accent) 65%,transparent);transition:transform .15s}
.btn:hover{transform:translateY(-2px)}
.btn--ghost{background:transparent;border:1.5px solid var(--line);color:var(--txt);text-shadow:none;box-shadow:none}
nav{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;justify-content:space-between;height:66px}
.logo{font-weight:800;font-size:19px;letter-spacing:-.01em}
.logo b{background:linear-gradient(120deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.nav-call{font-weight:700}
.hero{position:relative;overflow:hidden;padding:84px 0 74px;background:radial-gradient(900px 520px at 78% -10%,color-mix(in srgb,var(--accent2) 22%,transparent),transparent 60%),radial-gradient(760px 520px at 6% 8%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 55%),var(--bg)}
.hero-split{display:grid;grid-template-columns:1.15fr .85fr;gap:40px;align-items:center}
.hero-center{max-width:52rem;margin:0 auto;text-align:center}
.hero-center .cta,.hero-center .badges,.hero-center .rating{justify-content:center}
.hero-center h1,.hero-center .sub{max-width:none}
h1{font-size:clamp(34px,5.4vw,56px);line-height:1.06;letter-spacing:-.02em;font-weight:800;max-width:15ch}
.sub{color:var(--mut);font-size:clamp(17px,2.3vw,21px);margin:18px 0 8px;max-width:46ch}
.cta{display:flex;gap:14px;flex-wrap:wrap;margin-top:26px}
.rating{display:flex;align-items:center;gap:10px;margin-top:22px;color:var(--mut);font-size:15px}
.stars{color:#f5a623;font-size:18px;letter-spacing:2px}
.badges{display:flex;gap:18px;flex-wrap:wrap;margin-top:30px;color:var(--mut);font-size:14px}
.badges span{display:flex;align-items:center;gap:8px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent2)}
/* hero visual */
.hero-visual{display:flex;flex-direction:column;gap:14px}
.glass{background:color-mix(in srgb,var(--panel) 78%,transparent);border:1px solid var(--line);border-radius:var(--radius);padding:20px;backdrop-filter:blur(8px);box-shadow:0 24px 60px -30px rgba(0,0,0,.6)}
.gcard__top{display:flex;align-items:center;gap:12px}
.glogo{width:40px;height:40px;border-radius:10px;background:color-mix(in srgb,var(--accent) 20%,transparent);color:var(--accent2);font-weight:800;font-size:20px;display:flex;align-items:center;justify-content:center}
.gcard__top b{font-size:15px}.gcard .mut{color:var(--mut);font-size:13px}
.gcard__rate{display:flex;align-items:baseline;gap:10px;margin:12px 0 4px}
.gcard__rate .big{font-size:38px;font-weight:800;font-family:var(--head)}
.qcard b{display:block;font-size:15px}.qcard .mut{color:var(--mut);font-size:13px}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chips span{font-size:12px;padding:5px 11px;border-radius:999px;border:1px solid var(--line);color:var(--mut);background:color-mix(in srgb,var(--panel) 60%,transparent)}
/* stats strip */
.stats-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.stat{background:var(--bg);padding:26px 18px;text-align:center}
.stat__n{font-size:clamp(24px,3.4vw,34px);font-weight:800;font-family:var(--head);background:linear-gradient(120deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat__l{color:var(--mut);font-size:13px;margin-top:2px}
/* sections */
section.block{padding:72px 0}
.eyebrow{color:var(--accent2);font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:13px}
h2.title{font-size:clamp(26px,4vw,38px);font-weight:800;letter-spacing:-.02em;margin:8px 0 6px}
.lead{color:var(--mut);max-width:60ch}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:38px}
.svc{background:linear-gradient(180deg,var(--panel),var(--ink));border:1px solid var(--line);border-radius:var(--radius);padding:24px;transition:transform .15s,border-color .15s}
.svc:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.svc__ic{width:46px;height:46px;border-radius:calc(var(--radius) * .6);display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent2);margin-bottom:14px}
.svc__ic svg{width:24px;height:24px}
.svc h3{font-size:17px;margin-bottom:6px}
.svc p{color:var(--mut);font-size:14px}
/* process */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:38px}
.step{background:linear-gradient(180deg,var(--panel),var(--ink));border:1px solid var(--line);border-radius:var(--radius);padding:24px}
.step .num{display:inline-flex;width:34px;height:34px;border-radius:50%;background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;font-weight:800;align-items:center;justify-content:center;margin-bottom:12px}
.step b{display:block;font-size:16px;margin-bottom:4px}.step p{color:var(--mut);font-size:14px}
/* why */
.why{background:linear-gradient(180deg,var(--panel),var(--ink));border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.why-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:34px}
.why-item{display:flex;gap:14px;align-items:flex-start}
.why-item .k{width:40px;height:40px;flex:0 0 auto;border-radius:calc(var(--radius) * .55);background:color-mix(in srgb,var(--accent2) 16%,transparent);color:var(--accent2);display:flex;align-items:center;justify-content:center}
.why-item svg{width:22px;height:22px}
.why-item b{display:block;font-size:16px}
.why-item p{color:var(--mut);font-size:14px}
/* cta */
.finalcta{text-align:center;background:radial-gradient(640px 320px at 50% 0,color-mix(in srgb,var(--accent) 22%,transparent),transparent 60%)}
.finalcta h2{margin-bottom:10px}
.finalcta .phone{font-size:clamp(28px,5vw,44px);font-weight:800;margin:14px 0 22px;letter-spacing:-.01em;font-family:var(--head)}
.finalcta .phone a{background:linear-gradient(120deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
footer{border-top:1px solid var(--line);color:var(--mut);font-size:13px;text-align:center;padding:26px 0}
@media(max-width:860px){.hero-split{grid-template-columns:1fr}.hero-visual{order:-1}.grid{grid-template-columns:1fr 1fr}.why-grid,.steps{grid-template-columns:1fr}.stats-strip{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.grid{grid-template-columns:1fr}.nav-call{display:none}}
</style>
</head>
<body>
<nav><div class="wrap">
  <div class="logo"><b>${name}</b></div>
  ${hasPhone ? `<a class="nav-call btn btn--ghost" href="tel:${esc(phoneRaw)}">📞 ${phoneDisp}</a>` : `<a class="nav-call btn btn--ghost" href="#contact">Get a Quote</a>`}
</div></nav>

${heroSection}

${statsStrip}

<section class="block" id="services"><div class="wrap">
  <div class="eyebrow">What we do</div>
  <h2 class="title">Services built around ${city || 'your'} homes</h2>
  <p class="lead">From quick fixes to full projects, our team handles it with craftsmanship and care.</p>
  <div class="grid">${servicesHtml}</div>
</div></section>

<section class="block"><div class="wrap">
  <div class="eyebrow">How it works</div>
  <h2 class="title">Getting started is easy</h2>
  <div class="steps">
    <div class="step"><span class="num">1</span><b>Reach out</b><p>Call or request a quote — we respond fast, usually same day.</p></div>
    <div class="step"><span class="num">2</span><b>Free estimate</b><p>Clear, upfront pricing so you know the cost before any work begins.</p></div>
    <div class="step"><span class="num">3</span><b>We handle it</b><p>Quality workmanship, done on time and done right — guaranteed.</p></div>
  </div>
</div></section>

<section class="block why"><div class="wrap">
  <div class="eyebrow">Why ${name}</div>
  <h2 class="title">Work with a team that shows up</h2>
  <div class="why-grid">
    <div class="why-item"><div class="k">${icon('bolt')}</div><div><b>Fast, on-time service</b><p>We answer, we schedule quickly, and we arrive when we say we will.</p></div></div>
    <div class="why-item"><div class="k">${icon('shield')}</div><div><b>Upfront, honest pricing</b><p>Clear quotes before we start — no surprises, no pressure.</p></div></div>
    <div class="why-item"><div class="k">${icon('star')}</div><div><b>Quality that lasts</b><p>${reviews ? `Trusted by ${reviews}+ happy local customers.` : 'Backed by a satisfaction guarantee on every job.'}</p></div></div>
  </div>
</div></section>

<section class="block finalcta" id="contact"><div class="wrap">
  <div class="eyebrow">Get started</div>
  <h2 class="title">Ready for ${esc(String(label).toLowerCase())} done right?</h2>
  <p class="lead" style="margin:0 auto">Reach out today for a free, no-obligation estimate in ${esc(area)}.</p>
  ${hasPhone ? `<div class="phone"><a href="tel:${esc(phoneRaw)}">${phoneDisp}</a></div>` : ''}
  ${callBtn('btn')}
</div></section>

<footer><div class="wrap">© ${name}${city ? ' · ' + city + (state ? ', ' + state : '') : ''} · All rights reserved.</div></footer>
</body>
</html>`;
}

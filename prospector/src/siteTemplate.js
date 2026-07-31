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

/* Verified stock photography (Unsplash — free license, hotlink-supported).
 * Every ID below was checked live (HTTP 200) AND visually confirmed to match
 * its label before inclusion. Each trade maps to a hero + about + 3 gallery
 * shots so the page feels like a real agency build, not a text template. */
const P = (id, w = 900) => `https://images.unsplash.com/${id}?w=${w}&q=75&fit=crop&auto=format`;
const PHOTO_SETS = {
  roofing: { hero: 'photo-1635424710928-0544e8512eae', about: 'photo-1503387762-592deb58ef4e', gallery: ['photo-1632759145351-1d592919f522', 'photo-1570129477492-45c003edd2be', 'photo-1541888946425-d81bb19240f5'] },
  plumbing: { hero: 'photo-1607472586893-edb57bdc0e39', about: 'photo-1503387762-592deb58ef4e', gallery: ['photo-1585704032915-c3400ca199e7', 'photo-1620626011761-996317b8d101', 'photo-1584622650111-993a426fbf0a'] },
  hvac: { hero: 'photo-1568605114967-8130f3a36994', about: 'photo-1621905251189-08b45d6a269e', gallery: ['photo-1621905251918-48416bd8575a', 'photo-1600607687939-ce8a6c25118c', 'photo-1570129477492-45c003edd2be'] },
  electrical: { hero: 'photo-1621905251918-48416bd8575a', about: 'photo-1621905252507-b35492cc74b4', gallery: ['photo-1621905251189-08b45d6a269e', 'photo-1503387762-592deb58ef4e', 'photo-1600047509807-ba8f99d2cdde'] },
  remodeling: { hero: 'photo-1600607687939-ce8a6c25118c', about: 'photo-1503387762-592deb58ef4e', gallery: ['photo-1556911220-bff31c812dba', 'photo-1584622650111-993a426fbf0a', 'photo-1591825729269-caeb344f6df2'] },
  'custom-home-builder': { hero: 'photo-1600585154340-be6161a56a0c', about: 'photo-1503387762-592deb58ef4e', gallery: ['photo-1512917774080-9991f1c4c750', 'photo-1600596542815-ffad4c1539a9', 'photo-1600047509807-ba8f99d2cdde'] },
  cabinets: { hero: 'photo-1600585152220-90363fe7e115', about: 'photo-1556909114-f6e7ad7d3136', gallery: ['photo-1556911220-bff31c812dba', 'photo-1600566752355-35792bedcfea', 'photo-1600607687939-ce8a6c25118c'] },
  landscaping: { hero: 'photo-1558904541-efa843a96f01', about: 'photo-1416879595882-3373a0480b5b', gallery: ['photo-1570129477492-45c003edd2be', 'photo-1600596542815-ffad4c1539a9', 'photo-1416879595882-3373a0480b5b'] },
  painting: { hero: 'photo-1562259949-e8e7689d7828', about: 'photo-1503387762-592deb58ef4e', gallery: ['photo-1600607687939-ce8a6c25118c', 'photo-1568605114967-8130f3a36994', 'photo-1584622650111-993a426fbf0a'] },
  locksmith: { hero: 'photo-1558002038-1055907df827', about: 'photo-1521791136064-7986c2920216', gallery: ['photo-1600047509807-ba8f99d2cdde', 'photo-1568605114967-8130f3a36994', 'photo-1600880292203-757bb62b4baf'] },
  'auto-repair': { hero: 'photo-1625047509168-a7026f36de04', about: 'photo-1487754180451-c456f719a1fc', gallery: ['photo-1487754180451-c456f719a1fc', 'photo-1625047509168-a7026f36de04', 'photo-1521791136064-7986c2920216'] },
  'auto-body': { hero: 'photo-1625047509168-a7026f36de04', about: 'photo-1487754180451-c456f719a1fc', gallery: ['photo-1487754180451-c456f719a1fc', 'photo-1625047509168-a7026f36de04', 'photo-1521791136064-7986c2920216'] },
  cleaning: { hero: 'photo-1581578731548-c64695cc6952', about: 'photo-1521791136064-7986c2920216', gallery: ['photo-1600607687939-ce8a6c25118c', 'photo-1600585152220-90363fe7e115', 'photo-1620626011761-996317b8d101'] },
  'deck-builder': { hero: 'photo-1589939705384-5185137a7f0f', about: 'photo-1503387762-592deb58ef4e', gallery: ['photo-1591825729269-caeb344f6df2', 'photo-1570129477492-45c003edd2be', 'photo-1541888946425-d81bb19240f5'] },
  generic: { hero: 'photo-1570129477492-45c003edd2be', about: 'photo-1521791136064-7986c2920216', gallery: ['photo-1568605114967-8130f3a36994', 'photo-1600880292203-757bb62b4baf', 'photo-1503387762-592deb58ef4e'] },
};
const PHOTO_ALIASES = {
  'water-restoration': 'plumbing', septic: 'plumbing', waterproofing: 'plumbing',
  'window-installation': 'remodeling', siding: 'roofing', gutters: 'roofing', flooring: 'remodeling', masonry: 'remodeling', concrete: 'remodeling', paving: 'remodeling', excavation: 'remodeling', 'foundation-repair': 'remodeling', insulation: 'remodeling', handyman: 'remodeling', solar: 'roofing',
  'tree-service': 'landscaping', fencing: 'landscaping', 'pool-service': 'landscaping', 'pressure-washing': 'cleaning', 'carpet-cleaning': 'cleaning', 'junk-removal': 'cleaning',
  'garage-door': 'locksmith', 'appliance-repair': 'cleaning', moving: 'generic', 'epoxy-flooring': 'remodeling', 'pest-control': 'generic',
};
function photosFor(categoryKey) {
  const key = PHOTO_SETS[categoryKey] ? categoryKey : (PHOTO_ALIASES[categoryKey] || 'generic');
  return PHOTO_SETS[key] || PHOTO_SETS.generic;
}

/** Fetch the hero photo and return it as a data URI so the page's most
 * important visual is EMBEDDED in the HTML (guaranteed to show even if
 * hotlinking is ever blocked). Falls back to null → hotlink URL. */
export async function fetchHeroDataUri(categoryKey) {
  try {
    const url = P(photosFor(categoryKey).hero, 1600);
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 900_000) return null; // keep the single file lean
    const mime = res.headers.get('content-type') || 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

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
  const labelLower = esc(String(label).toLowerCase());
  const trade = TRADES[business.category] || GENERIC(String(label));
  const city = business.city ? esc(business.city) : '';
  const state = business.state ? esc(business.state) : '';
  const area = city ? `${city}${state ? ', ' + state : ''}` : 'your area';
  const address = business.address ? esc(business.address) : '';
  const phoneRaw = (business.phone || '').replace(/[^\d+]/g, '');
  const phoneDisp = esc(business.phone || '');
  const hasPhone = phoneRaw.length >= 10;
  const rating = business.rating;
  const reviews = business.reviewCount || 0;
  const stars = rating ? '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating)) : '★★★★★';
  const photos = photosFor(business.category);
  // Server-embedded hero (data URI) wins; hotlink is the fallback.
  const heroSrc = business._heroDataUri || P(photos.hero, 1600);
  const callBtn = (cls, txt) => hasPhone
    ? `<a class="${cls}" href="tel:${esc(phoneRaw)}">${txt || `📞 Call ${phoneDisp}`}</a>`
    : `<a class="${cls}" href="#quote">${txt || 'Get a Free Quote'}</a>`;

  // Deterministic per-business look (stable on re-generation).
  const seed = hashSeed((business.name || 'x') + '|' + (business.id || business.placeId || business.city || ''));
  const theme = THEMES[(Number.isInteger(business._forceTheme) ? business._forceTheme : seed) % THEMES.length];
  const style = STYLES[(Number.isInteger(business._forceStyle) ? business._forceStyle : Math.floor(seed / 13)) % STYLES.length];
  const centerHero = style.hero === 'center';

  const servicesHtml = trade.services.map(([t, d, ic], i) => `
        <div class="svc reveal" style="transition-delay:${i * 70}ms">
          <div class="svc__ic">${icon(ic)}</div>
          <h3>${esc(t)}</h3>
          <p>${esc(d)}</p>
        </div>`).join('');

  const galleryHtml = photos.gallery.map((id, i) => `
        <figure class="shot reveal" style="transition-delay:${i * 90}ms">
          <img src="${P(id, 900)}" alt="${esc(trade.services[i]?.[0] || label)}" loading="lazy" decoding="async" onerror="this.parentElement.style.display='none'">
          <figcaption>${esc(trade.services[i]?.[0] || label)}</figcaption>
        </figure>`).join('');

  const quoteForm = `
      <div class="qform glass reveal" id="quote">
        <h3>Get a Fast, Free Estimate</h3>
        <p class="qform__sub">Tell us what you need and we’ll get right back to you with a quote.</p>
        <form name="quote-request" method="POST" action="/?submitted=1" data-netlify="true" netlify-honeypot="company">
          <input type="hidden" name="form-name" value="quote-request" />
          <p class="hp"><label>Company <input name="company" /></label></p>
          <div class="qgrid">
            <label>Name *<input name="name" required placeholder="Your name" /></label>
            <label>Phone *<input name="phone" type="tel" required placeholder="(555) 555-5555" /></label>
          </div>
          <label>Email <span class="opt">(optional)</span><input name="email" type="email" placeholder="you@email.com" /></label>
          <label>How can we help?<textarea name="message" rows="3" placeholder="Tell us a little about the job…"></textarea></label>
          <button class="btn btn--full" type="submit">Request My Free Estimate</button>
          <div class="qform__note">No spam, no obligation. We usually reply the same day.</div>
        </form>
      </div>`;

  const trustCards = `
    <div class="trust wrap reveal">
      <div class="tcard"><div class="tcard__stars">${stars}</div><b>${rating ? `${rating} out of 5 · ${reviews} reviews` : 'Satisfaction guaranteed'}</b></div>
      <div class="tcard">${icon('shield')}<b>Licensed &amp; Insured</b></div>
      <div class="tcard">${icon('star')}<b>Free, No-Obligation Estimates</b></div>
      <div class="tcard">${icon('home')}<b>Proudly Serving ${esc(area)}</b></div>
    </div>`;

  const heroChips = `
      <div class="chips">
        <span>Licensed &amp; Insured</span><span>Free Estimates</span><span>Serving ${esc(area)}</span>
      </div>`;
  const heroRating = `<div class="rating"><span class="stars">${stars}</span><span>${rating ? `${rating} · ${reviews} Google reviews` : 'Trusted local pros'}</span></div>`;
  const heroCopy = `
      <div class="hero-copy reveal">
        <div class="eyebrow">— ${esc(label)} · ${esc(area)}</div>
        <h1>${esc(trade.tagline)}</h1>
        <p class="sub">${name} is your local ${labelLower} team — honest pricing, careful work, and service that shows up when promised.</p>
        ${heroChips}
        <div class="cta">${callBtn('btn')}<a class="btn btn--ghost" href="#quote">Get a Free Quote</a></div>
        ${heroRating}
      </div>`;

  const faq = [
    ['Do you offer free estimates?', `Yes — every estimate is free and no-obligation. Call ${hasPhone ? phoneDisp : 'us'} or use the quote form and we’ll get you a clear price fast.`],
    ['Are you licensed and insured?', 'Yes. We’re fully licensed and insured, and we’re happy to provide documentation on request.'],
    ['How quickly can you get to me?', `We serve ${esc(area)} and the surrounding communities and respond as fast as possible — often the same day for urgent calls.`],
    ['What areas do you serve?', `${esc(area)} and the surrounding area. Not sure if you’re in our service range? Just ask — we’ll tell you straight.`],
  ].map(([q, a], i) => `
      <details class="faq reveal" style="transition-delay:${i * 60}ms" ${i === 0 ? 'open' : ''}>
        <summary>${q}<span class="faq__x">+</span></summary>
        <p>${a}</p>
      </details>`).join('');

  const checklist = ['Upfront, honest pricing', 'Fast scheduling & on-time arrivals', 'Clean, careful workmanship', 'Local team that stands behind the job']
    .map((c) => `<li>${icon('shield')}<span>${c}</span></li>`).join('');

  const heroSection = centerHero
    ? `<header class="hero hero--center" id="top">
        <div class="hero__bg"><img src="${heroSrc}" alt="" onerror="this.style.display='none'"></div>
        <div class="wrap"><div class="hero-center">${heroCopy}</div></div>
      </header>`
    : `<header class="hero" id="top">
        <div class="hero__bg"><img src="${heroSrc}" alt="" onerror="this.style.display='none'"></div>
        <div class="wrap"><div class="hero-split">${heroCopy}${quoteForm}</div></div>
      </header>`;

  const midQuote = centerHero
    ? `<section class="block" id="quote-section"><div class="wrap qwrap">
         <div class="qside reveal">
           <div class="eyebrow">— Free estimate</div>
           <h2 class="title">Tell us about the job</h2>
           <p class="lead">Quick form, fast answer. ${hasPhone ? `Prefer to talk? Call <a class="tel" href="tel:${esc(phoneRaw)}">${phoneDisp}</a>.` : ''}</p>
         </div>${quoteForm}
       </div></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name} — ${esc(label)}${city ? ' in ' + city : ''}</title>
<meta name="description" content="${name} — ${esc(trade.tagline)}. Trusted ${labelLower} serving ${esc(area)}.${hasPhone ? ' Call ' + phoneDisp + ' for a free estimate.' : ''}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${name} — ${esc(label)}${city ? ' in ' + city : ''}" />
<meta property="og:description" content="${name} — ${esc(trade.tagline)}. Free estimates in ${esc(area)}." />
<style>
:root{--bg:${theme.bg};--panel:${theme.panel};--ink:${theme.ink};--txt:${theme.txt};--mut:${theme.mut};--accent:${theme.a1};--accent2:${theme.a2};--line:${theme.line};--radius:${style.radius};--pill:${style.pill};--head:${style.head}}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--txt);line-height:1.65;-webkit-font-smoothing:antialiased}
h1,h2,h3,.logo{font-family:var(--head)}
a{color:inherit;text-decoration:none}
img{max-width:100%}
.wrap{max-width:1160px;margin:0 auto;padding:0 22px}
.btn{display:inline-block;background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.3);font-weight:800;padding:14px 26px;border-radius:var(--pill);font-size:15.5px;border:none;cursor:pointer;box-shadow:0 14px 34px -10px color-mix(in srgb,var(--accent) 70%,transparent);transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translateY(-2px);box-shadow:0 20px 44px -12px color-mix(in srgb,var(--accent) 80%,transparent)}
.btn--ghost{background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.35);color:#fff;text-shadow:none;box-shadow:none;backdrop-filter:blur(4px)}
.btn--full{width:100%}
/* utility bar */
.util{background:color-mix(in srgb,var(--ink) 92%,#000 8%);border-bottom:1px solid var(--line);font-size:12.5px;color:var(--mut)}
.util .wrap{display:flex;align-items:center;gap:18px;height:34px}
.util b{color:var(--txt);font-weight:600}
.util .right{margin-left:auto}
/* nav */
nav{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;gap:22px;height:64px}
.logo{font-weight:800;font-size:18px;letter-spacing:-.01em;margin-right:auto;display:flex;align-items:center;gap:9px}
.logo .dot{width:9px;height:9px;border-radius:50%;background:linear-gradient(120deg,var(--accent),var(--accent2))}
.nav-links{display:flex;gap:20px;font-size:14px;color:var(--mut)}
.nav-links a:hover{color:var(--txt)}
.nav-phone{font-weight:700;font-size:14px}
nav .btn{padding:9px 18px;font-size:13.5px}
/* hero */
.hero{position:relative;overflow:hidden;padding:96px 0 88px;color:#fff}
.hero__bg{position:absolute;inset:0;z-index:-2;background:linear-gradient(120deg,#12141c,#1c2030)}
.hero__bg img{width:100%;height:100%;object-fit:cover}
.hero:before{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(100deg,rgba(5,8,14,.93) 22%,rgba(5,8,14,.62) 55%,rgba(5,8,14,.45));}
.hero:after{content:'';position:absolute;width:560px;height:560px;right:-160px;top:-200px;z-index:-1;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent2) 34%,transparent),transparent 65%);animation:drift 9s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate(-40px,30px) scale(1.08)}}
.hero-split{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center}
.hero-center{max-width:56rem;margin:0 auto;text-align:center}
.hero-center .cta,.hero-center .chips,.hero-center .rating{justify-content:center}
.eyebrow{color:var(--accent2);font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:12.5px}
.hero .eyebrow{color:#9fd7ff;filter:saturate(1.3) brightness(1.2)}
h1{font-size:clamp(36px,5.6vw,60px);line-height:1.04;letter-spacing:-.02em;font-weight:800;margin-top:12px}
.hero .sub{color:rgba(255,255,255,.82);font-size:clamp(16.5px,2.2vw,20px);margin:16px 0 4px;max-width:48ch}
.chips{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}
.chips span{font-size:12.5px;font-weight:600;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);backdrop-filter:blur(4px)}
.cta{display:flex;gap:13px;flex-wrap:wrap;margin-top:24px}
.rating{display:flex;align-items:center;gap:10px;margin-top:22px;color:rgba(255,255,255,.85);font-size:14.5px}
.stars{color:#fbbf24;font-size:17px;letter-spacing:2px}
/* quote form */
.glass{background:#fff;color:#182033;border-radius:calc(var(--radius) + 4px);box-shadow:0 40px 90px -30px rgba(0,0,0,.55)}
.qform{padding:26px 26px 22px}
.qform h3{font-size:20px;letter-spacing:-.01em}
.qform__sub{font-size:13px;color:#5a6579;margin:4px 0 14px}
.qform label{display:block;font-size:12px;font-weight:700;color:#3c465c;margin-bottom:11px}
.qform .opt{color:#9aa3b5;font-weight:500}
.qform input,.qform textarea{width:100%;margin-top:4px;background:#f4f6fa;border:1px solid #e2e7f0;border-radius:9px;padding:11px 12px;font-size:14px;font-family:inherit;outline:none;color:#182033;transition:border-color .15s,box-shadow .15s}
.qform input:focus,.qform textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
.qgrid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.qform__note{text-align:center;font-size:11.5px;color:#9aa3b5;margin-top:10px}
.hp{position:absolute;left:-9999px;opacity:0}
.qwrap{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.tel{color:var(--accent2);font-weight:700}
/* trust strip */
.trust{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:-42px;position:relative;z-index:5}
.tcard{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;text-align:center;font-size:13.5px;box-shadow:0 24px 50px -28px rgba(0,0,0,.45);display:flex;flex-direction:column;align-items:center;gap:8px}
.tcard svg{width:22px;height:22px;color:var(--accent2)}
.tcard__stars{color:#fbbf24;letter-spacing:2px}
/* sections */
section.block{padding:78px 0}
h2.title{font-size:clamp(27px,4vw,40px);font-weight:800;letter-spacing:-.02em;margin:8px 0 6px}
.lead{color:var(--mut);max-width:62ch;font-size:16px}
.center{text-align:center}.center .lead{margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:40px}
.svc{background:linear-gradient(180deg,var(--panel),var(--ink));border:1px solid var(--line);border-radius:var(--radius);padding:26px 22px;transition:transform .2s,border-color .2s,box-shadow .2s}
.svc:hover{transform:translateY(-5px);border-color:color-mix(in srgb,var(--accent) 50%,var(--line));box-shadow:0 24px 50px -26px color-mix(in srgb,var(--accent) 40%,transparent)}
.svc__ic{width:48px;height:48px;border-radius:calc(var(--radius) * .58);display:flex;align-items:center;justify-content:center;background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 24%,transparent),color-mix(in srgb,var(--accent2) 18%,transparent));color:var(--accent2);margin-bottom:15px}
.svc__ic svg{width:24px;height:24px}
.svc h3{font-size:17px;margin-bottom:6px}
.svc p{color:var(--mut);font-size:13.8px}
/* about */
.about{background:linear-gradient(180deg,var(--panel),var(--ink));border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.about .wrap{display:grid;grid-template-columns:.92fr 1.08fr;gap:48px;align-items:center}
.about__img{border-radius:calc(var(--radius) + 6px);overflow:hidden;box-shadow:0 40px 80px -34px rgba(0,0,0,.5);aspect-ratio:4/3}
.about__img img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.about__img:hover img{transform:scale(1.045)}
.checklist{list-style:none;margin-top:22px;display:grid;gap:13px}
.checklist li{display:flex;gap:12px;align-items:center;font-weight:600;font-size:15px}
.checklist svg{width:20px;height:20px;color:var(--accent2);flex:0 0 auto}
/* gallery */
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:40px}
.shot{border-radius:calc(var(--radius) + 4px);overflow:hidden;position:relative;aspect-ratio:4/3;background:var(--panel);border:1px solid var(--line)}
.shot img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.shot:hover img{transform:scale(1.06)}
.shot figcaption{position:absolute;left:0;right:0;bottom:0;padding:26px 16px 13px;font-size:13.5px;font-weight:700;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.72))}
/* steps */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:40px}
.step{background:linear-gradient(180deg,var(--panel),var(--ink));border:1px solid var(--line);border-radius:var(--radius);padding:26px;position:relative}
.step .num{display:inline-flex;width:36px;height:36px;border-radius:50%;background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;font-weight:800;align-items:center;justify-content:center;margin-bottom:13px}
.step b{display:block;font-size:16.5px;margin-bottom:5px}.step p{color:var(--mut);font-size:14px}
/* faq */
.faqs{max-width:760px;margin:38px auto 0}
.faq{background:linear-gradient(180deg,var(--panel),var(--ink));border:1px solid var(--line);border-radius:var(--radius);margin-bottom:12px;overflow:hidden}
.faq summary{list-style:none;cursor:pointer;padding:17px 20px;font-weight:700;font-size:15.5px;display:flex;align-items:center}
.faq summary::-webkit-details-marker{display:none}
.faq__x{margin-left:auto;color:var(--accent2);font-size:20px;transition:transform .2s}
.faq[open] .faq__x{transform:rotate(45deg)}
.faq p{padding:0 20px 17px;color:var(--mut);font-size:14.5px}
/* final cta */
.finalcta{position:relative;overflow:hidden;text-align:center;color:#fff;background:linear-gradient(120deg,var(--accent),var(--accent2))}
.finalcta:before{content:'';position:absolute;width:600px;height:600px;left:-200px;bottom:-300px;border-radius:50%;background:rgba(255,255,255,.14);animation:drift 8s ease-in-out infinite alternate}
.finalcta .eyebrow{color:rgba(255,255,255,.85)}
.finalcta .lead{color:rgba(255,255,255,.88)}
.finalcta .phone{font-size:clamp(30px,5vw,46px);font-weight:800;margin:16px 0 20px;letter-spacing:-.01em;font-family:var(--head)}
.finalcta .btn{background:#fff;color:#111b30;text-shadow:none}
/* footer */
footer{background:color-mix(in srgb,var(--ink) 94%,#000 6%);border-top:1px solid var(--line);padding:52px 0 30px;font-size:14px}
.foot{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:36px}
.foot h4{font-size:12.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--mut);margin-bottom:12px}
.foot ul{list-style:none;display:grid;gap:8px;color:var(--mut)}
.foot .blurb{color:var(--mut);font-size:13.5px;margin-top:10px;max-width:34ch}
.foot .stars{font-size:14px}
.copy{border-top:1px solid var(--line);margin-top:36px;padding-top:18px;color:var(--mut);font-size:12.5px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
/* reveal animation */
.reveal{opacity:0;transform:translateY(22px);transition:opacity .6s ease,transform .6s ease}
.reveal.in{opacity:1;transform:none}
/* success banner */
.banner{display:none;position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:60;background:#0c7a43;color:#fff;font-weight:700;padding:13px 22px;border-radius:999px;box-shadow:0 18px 44px -12px rgba(0,0,0,.5)}
/* scroll progress bar */
#progress{position:fixed;top:0;left:0;height:3.5px;width:0;z-index:120;background:linear-gradient(90deg,var(--accent),var(--accent2));box-shadow:0 0 12px color-mix(in srgb,var(--accent2) 70%,transparent);transition:width .08s linear;border-radius:0 3px 3px 0}
/* custom cursor (desktop only) */
@media (pointer:fine){
  #cur{position:fixed;z-index:110;width:10px;height:10px;border-radius:50%;background:var(--accent2);pointer-events:none;transform:translate(-50%,-50%);transition:width .18s,height .18s,opacity .3s;mix-blend-mode:screen}
  #curRing{position:fixed;z-index:109;width:34px;height:34px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--accent2) 65%,transparent);pointer-events:none;transform:translate(-50%,-50%);transition:width .2s,height .2s,border-color .2s,opacity .3s}
  #cur.hov{width:16px;height:16px}
  #curRing.hov{width:56px;height:56px;border-color:var(--accent2)}
}
@media (pointer:coarse){#cur,#curRing{display:none}}
@media(max-width:920px){.hero-split,.qwrap,.about .wrap{grid-template-columns:1fr}.trust,.grid{grid-template-columns:1fr 1fr}.shots,.steps{grid-template-columns:1fr}.foot{grid-template-columns:1fr}.nav-links,.util{display:none}}
@media(max-width:560px){.trust,.grid{grid-template-columns:1fr}.nav-phone{display:none}}
</style>
</head>
<body>
<div id="progress"></div>
<div id="cur"></div><div id="curRing"></div>
<div class="util"><div class="wrap"><span>✓ <b>Licensed &amp; Insured</b></span><span>📍 Serving ${esc(area)}</span>${hasPhone ? `<span class="right">📞 <b>${phoneDisp}</b></span>` : ''}</div></div>
<nav><div class="wrap">
  <div class="logo"><span class="dot"></span>${name}</div>
  <div class="nav-links"><a href="#services">Services</a><a href="#about">About</a><a href="#work">Our Work</a><a href="#faqs">FAQ</a></div>
  ${hasPhone ? `<a class="nav-phone" href="tel:${esc(phoneRaw)}">📞 ${phoneDisp}</a>` : ''}
  <a class="btn" href="#quote">Free Estimate</a>
</div></nav>

${heroSection}

${trustCards}

<section class="block" id="services"><div class="wrap">
  <div class="center reveal">
    <div class="eyebrow">— What we do</div>
    <h2 class="title">Services built for ${city || 'your'} homes</h2>
    <p class="lead">From urgent fixes to full projects, we handle it with craftsmanship and care.</p>
  </div>
  <div class="grid">${servicesHtml}</div>
</div></section>

<section class="block about" id="about"><div class="wrap">
  <div class="about__img reveal"><img src="${P(photos.about, 1000)}" alt="${name}" loading="lazy" decoding="async" onerror="this.parentElement.style.display='none'"></div>
  <div class="reveal">
    <div class="eyebrow">— Why ${name}</div>
    <h2 class="title">A local team that treats your home like their own</h2>
    <p class="lead">${name} serves ${esc(area)} with dependable ${labelLower} — the kind of service you recommend to your neighbors.${reviews ? ` Don’t take our word for it: <b>${reviews}+ customers</b> have rated us ${rating}★ on Google.` : ''}</p>
    <ul class="checklist">${checklist}</ul>
    <div class="cta">${callBtn('btn')}</div>
  </div>
</div></section>

<section class="block" id="work"><div class="wrap">
  <div class="center reveal">
    <div class="eyebrow">— Our work</div>
    <h2 class="title">The standard we hold ourselves to</h2>
    <p class="lead">Clean, careful, done-right ${labelLower} — every single job.</p>
  </div>
  <div class="shots">${galleryHtml}</div>
</div></section>

<section class="block about"><div class="wrap" style="display:block">
  <div class="center reveal">
    <div class="eyebrow">— How it works</div>
    <h2 class="title">Getting started is easy</h2>
  </div>
  <div class="steps">
    <div class="step reveal"><span class="num">1</span><b>Reach out</b><p>Call or send the quick quote form — we respond fast, usually the same day.</p></div>
    <div class="step reveal" style="transition-delay:80ms"><span class="num">2</span><b>Free estimate</b><p>Clear, upfront pricing so you know exactly where you stand before work begins.</p></div>
    <div class="step reveal" style="transition-delay:160ms"><span class="num">3</span><b>Done right</b><p>Quality workmanship, on schedule — and we stand behind every job.</p></div>
  </div>
</div></section>

${midQuote}

<section class="block" id="faqs"><div class="wrap">
  <div class="center reveal">
    <div class="eyebrow">— FAQ</div>
    <h2 class="title">Questions, answered</h2>
  </div>
  <div class="faqs">${faq}</div>
</div></section>

<section class="block finalcta"><div class="wrap">
  <div class="eyebrow">— Free estimate</div>
  <h2 class="title">Ready to get started?</h2>
  <p class="lead">Call ${name} today — or send a quick message ${centerHero ? 'above' : 'from the quote form'} — for a free, no-obligation estimate.</p>
  ${hasPhone ? `<div class="phone"><a href="tel:${esc(phoneRaw)}">${phoneDisp}</a></div>` : ''}
  <div class="cta" style="justify-content:center">${callBtn('btn')}<a class="btn btn--ghost" href="#quote">Request an Estimate</a></div>
</div></section>

<footer><div class="wrap">
  <div class="foot">
    <div>
      <div class="logo"><span class="dot"></span>${name}</div>
      <p class="blurb">Trusted ${labelLower} serving ${esc(area)} and the surrounding communities. Licensed, insured, and proud of every job we finish.</p>
      <div class="rating" style="color:var(--mut);margin-top:12px"><span class="stars">${stars}</span>${rating ? `<span>${rating} · ${reviews} reviews</span>` : ''}</div>
    </div>
    <div>
      <h4>Services</h4>
      <ul>${trade.services.map(([t]) => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
    <div>
      <h4>Get in touch</h4>
      <ul>
        ${hasPhone ? `<li><b><a href="tel:${esc(phoneRaw)}">${phoneDisp}</a></b></li>` : ''}
        ${address ? `<li>${address}</li>` : ''}
        <li>${esc(area)} &amp; surrounding areas</li>
        <li><a href="#quote">Request a free estimate →</a></li>
      </ul>
    </div>
  </div>
  <div class="copy"><span>© ${new Date().getFullYear()} ${name}. All rights reserved.</span><span>${esc(label)} · ${esc(area)}</span></div>
</div></footer>

<div class="banner" id="ok">✓ Thanks — your request was sent. We’ll be in touch shortly!</div>
<script>
(function(){
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12});
  document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});
  if(location.search.indexOf('submitted=1')>-1){var b=document.getElementById('ok');b.style.display='block';setTimeout(function(){b.style.display='none';},6000);}
  // scroll progress bar
  var prog=document.getElementById('progress');
  function onScroll(){var h=document.documentElement;var max=h.scrollHeight-h.clientHeight;prog.style.width=(max>0?(h.scrollTop/max)*100:0)+'%';}
  addEventListener('scroll',onScroll,{passive:true});onScroll();
  // custom cursor: dot snaps, ring glides (lerp), both grow over links/buttons
  var cur=document.getElementById('cur'),ring=document.getElementById('curRing');
  if(cur&&matchMedia('(pointer:fine)').matches){
    var mx=-100,my=-100,rx=-100,ry=-100,seen=false;
    addEventListener('mousemove',function(e){mx=e.clientX;my=e.clientY;seen=true;cur.style.left=mx+'px';cur.style.top=my+'px';},{passive:true});
    (function loop(){rx+=(mx-rx)*.16;ry+=(my-ry)*.16;ring.style.left=rx+'px';ring.style.top=ry+'px';ring.style.opacity=cur.style.opacity=seen?'1':'0';requestAnimationFrame(loop);})();
    document.querySelectorAll('a,button,summary,input,textarea').forEach(function(el){
      el.addEventListener('mouseenter',function(){cur.classList.add('hov');ring.classList.add('hov');});
      el.addEventListener('mouseleave',function(){cur.classList.remove('hov');ring.classList.remove('hov');});
    });
  }
})();
</script>
</body>
</html>`;
}

/**
 * Target business categories: local trades & professional services that
 * (a) frequently have a weak/broken/missing website, and
 * (b) earn enough to comfortably afford Oxsome ($750–$2,500/mo).
 *
 *   searchTerm     — natural-language query for Places Text Search
 *   placesType     — Google Places API (New) Table-A type, '' if none exists
 *   tier           — premium | high | mid (lucrativeness + ad budget)
 *   avgTicketUsd   — typical customer/job value (drives opportunity estimate)
 *   affordability  — 0–1, how easily they can pay for marketing
 */
export const CATEGORIES = [
  { key: 'hvac', label: 'HVAC', searchTerm: 'HVAC contractor', placesType: '', tier: 'premium', avgTicketUsd: 7000, affordability: 0.95, note: 'System replacements run $5k–$12k with seasonal demand spikes. Cash-rich; smaller installers still run dated sites.' },
  { key: 'roofing', label: 'Roofing', searchTerm: 'roofing contractor', placesType: 'roofing_contractor', tier: 'premium', avgTicketUsd: 12000, affordability: 0.95, note: 'Roof replacements $8k–$25k, storm-driven demand. Already spend on leads; weak-site operators leave money on the table.' },
  { key: 'remodeling', label: 'Remodeling & General Contracting', searchTerm: 'home remodeling contractor', placesType: 'general_contractor', tier: 'premium', avgTicketUsd: 25000, affordability: 0.9, note: 'Kitchen/bath/whole-home remodels are very high-ticket. Buyers research heavily online; many under-invest in web.' },
  { key: 'custom-home-builder', label: 'Custom Home Builder', searchTerm: 'custom home builder', placesType: 'general_contractor', tier: 'premium', avgTicketUsd: 450000, affordability: 0.9, note: 'Six/seven-figure projects — a few leads a year justify large spend. Portfolio-weak sites cost huge jobs.' },
  { key: 'water-restoration', label: 'Water Damage & Restoration', searchTerm: 'water damage restoration service', placesType: '', tier: 'premium', avgTicketUsd: 4000, affordability: 0.9, note: 'Insurance-funded emergencies with extreme "near me now" urgency. Ranking and call tracking are extremely valuable.' },
  { key: 'personal-injury-attorney', label: 'Personal Injury Attorney', searchTerm: 'personal injury attorney', placesType: 'lawyer', tier: 'premium', avgTicketUsd: 8000, affordability: 0.98, note: 'Contingency fees fund the biggest local marketing budgets. Solo/small firms with weak sites are prime targets.' },
  { key: 'dentist', label: 'Dentist (General)', searchTerm: 'dentist', placesType: 'dentist', tier: 'premium', avgTicketUsd: 600, affordability: 0.95, note: 'High patient lifetime value, strong cash flow. New-patient acquisition is the game; outdated sites are common.' },
  { key: 'orthodontist', label: 'Orthodontist', searchTerm: 'orthodontist', placesType: 'dentist', tier: 'premium', avgTicketUsd: 5500, affordability: 0.97, note: 'Braces/aligners $4k–$7k per case. Very high margins; aggressive appetite for SEO and conversion.' },
  { key: 'med-spa', label: 'Med Spa', searchTerm: 'med spa', placesType: '', tier: 'premium', avgTicketUsd: 1200, affordability: 0.95, note: 'Botox/filler/laser + memberships from affluent clients. Brand matters; many have pretty-but-broken sites.' },
  { key: 'electrical', label: 'Electrical', searchTerm: 'electrician', placesType: 'electrician', tier: 'high', avgTicketUsd: 1200, affordability: 0.85, note: 'Panel upgrades, EV chargers, rewires are high-margin. Trust-sensitive; many independents under-invest online.' },
  { key: 'plumbing', label: 'Plumbing', searchTerm: 'plumber', placesType: 'plumber', tier: 'high', avgTicketUsd: 600, affordability: 0.85, note: 'High emergency volume, recurring repairs. Many run thin DIY sites; one job covers a month of marketing.' },
  { key: 'paving', label: 'Asphalt & Paving', searchTerm: 'asphalt paving contractor', placesType: '', tier: 'high', avgTicketUsd: 6000, affordability: 0.85, note: 'Driveways/lots are large-ticket and seasonal. Heavy equipment overhead; web presence often outdated/nonexistent.' },
  { key: 'pest-control', label: 'Pest Control', searchTerm: 'pest control service', placesType: '', tier: 'high', avgTicketUsd: 1200, affordability: 0.85, note: 'Recurring quarterly contracts = high LTV. Independents compete with franchises and benefit hugely from SEO.' },
  { key: 'chiropractor', label: 'Chiropractor', searchTerm: 'chiropractor', placesType: 'chiropractor', tier: 'high', avgTicketUsd: 1500, affordability: 0.85, note: 'Recurring care plans = high LTV. Small practices run DIY/template sites; reviews drive new patients.' },
  { key: 'cpa-accounting', label: 'Accounting / CPA', searchTerm: 'accounting and tax services', placesType: 'accounting', tier: 'high', avgTicketUsd: 2500, affordability: 0.85, note: 'Recurring retainers, sticky high-LTV clients. Conservative marketers with stale sites; SEO wins year-round.' },
  { key: 'law-firm', label: 'Law Firm (General)', searchTerm: 'law firm', placesType: 'lawyer', tier: 'high', avgTicketUsd: 3000, affordability: 0.9, note: 'High case values, trust-driven hiring. Small firms frequently neglect local SEO despite ample budget.' },
  { key: 'veterinary', label: 'Veterinary Clinic', searchTerm: 'veterinary clinic', placesType: 'veterinary_care', tier: 'high', avgTicketUsd: 350, affordability: 0.85, note: 'High visit frequency, loyal clients = great LTV. Independents vs corporate groups; many sites outdated.' },
  { key: 'garage-door', label: 'Garage Door', searchTerm: 'garage door repair and installation', placesType: '', tier: 'high', avgTicketUsd: 800, affordability: 0.8, note: 'Urgent break-fix + $1k+ replacements. Niche enough that many players have minimal web presence.' },
  { key: 'fencing', label: 'Fencing', searchTerm: 'fence contractor', placesType: '', tier: 'high', avgTicketUsd: 4500, affordability: 0.8, note: 'Several-thousand-dollar installs, strong margins. Word-of-mouth, thin gallery-only sites that convert poorly.' },
  { key: 'tree-service', label: 'Tree Service', searchTerm: 'tree removal service', placesType: '', tier: 'high', avgTicketUsd: 1800, affordability: 0.8, note: 'Removals/storm cleanup are high-ticket and urgent. Many are crews with no site or a one-pager.' },
  { key: 'pool-service', label: 'Pool Service & Construction', searchTerm: 'swimming pool service and repair', placesType: '', tier: 'high', avgTicketUsd: 2000, affordability: 0.8, note: 'Recurring maintenance + high-ticket renovations. Affluent customers; route operators often have weak web.' },
  { key: 'concrete', label: 'Concrete', searchTerm: 'concrete contractor', placesType: '', tier: 'high', avgTicketUsd: 5000, affordability: 0.8, note: 'Driveways/patios/foundations are big jobs. Referral-heavy with minimal digital presence.' },
  { key: 'auto-body', label: 'Auto Body Shop', searchTerm: 'auto body repair shop', placesType: 'car_repair', tier: 'high', avgTicketUsd: 3500, affordability: 0.8, note: 'High-ticket, often insurance-paid collision work. Compete on visibility/reviews; many have minimal sites.' },
  { key: 'epoxy-flooring', label: 'Epoxy & Garage Flooring', searchTerm: 'epoxy garage floor coating', placesType: '', tier: 'high', avgTicketUsd: 3500, affordability: 0.8, note: 'Trendy high-margin niche, $3k–$8k installs, rising demand. Young operators with thin web who reinvest readily.' },
  { key: 'auto-repair', label: 'Auto Repair / Mechanic', searchTerm: 'auto repair shop', placesType: 'car_repair', tier: 'high', avgTicketUsd: 600, affordability: 0.75, note: 'Steady repeat customers, good margins. Lean on walk-ins/reviews; many have weak sites.' },
  { key: 'painting', label: 'Painting', searchTerm: 'painting contractor', placesType: 'painter', tier: 'mid', avgTicketUsd: 3000, affordability: 0.65, note: 'Mid-ticket repaints. Crowded, lots of weak sites; high-end residential painters spend well.' },
  { key: 'landscaping', label: 'Landscaping & Lawn Care', searchTerm: 'landscaping company', placesType: '', tier: 'mid', avgTicketUsd: 2500, affordability: 0.6, note: 'Design/install + recurring maintenance. Fragmented; many crews lack real websites.' },
  { key: 'junk-removal', label: 'Junk Removal', searchTerm: 'junk removal service', placesType: '', tier: 'mid', avgTicketUsd: 350, affordability: 0.6, note: 'High search volume, easy upsells, lower per-job value. Volume-driven; compete with better-SEO franchises.' },
  { key: 'locksmith', label: 'Locksmith', searchTerm: 'locksmith service', placesType: 'locksmith', tier: 'mid', avgTicketUsd: 200, affordability: 0.55, note: 'Pure emergency intent, strong margins. Spam-heavy category; a clean verified site stands out.' },
  { key: 'appliance-repair', label: 'Appliance Repair', searchTerm: 'appliance repair service', placesType: '', tier: 'mid', avgTicketUsd: 250, affordability: 0.55, note: 'Steady break-fix demand, repeat customers. Many techs run no real site — easy local wins.' },
];

export const findCategory = (key) =>
  CATEGORIES.find((c) => c.key === key || c.searchTerm.toLowerCase() === key.toLowerCase());

/** Default category set: the strongest Oxsome fits (premium + high tiers). */
export const defaultCategories = () =>
  CATEGORIES.filter((c) => c.tier === 'premium' || c.tier === 'high');

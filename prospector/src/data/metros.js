/**
 * The most populous US cities, spread across the country, so the prospector
 * can hunt "very populated places" nationwide. metroPopulation drives the
 * market-demand component of the lead score — bigger market = bigger leak
 * when a business has no/bad website.
 *
 * Coordinates are city centers, used as the Places API locationBias.
 */
export const METROS = [
  { city: 'New York', state: 'NY', population: 8300000, metroPopulation: 19500000, lat: 40.7128, lng: -74.006 },
  { city: 'Los Angeles', state: 'CA', population: 3900000, metroPopulation: 12900000, lat: 34.0522, lng: -118.2437 },
  { city: 'Chicago', state: 'IL', population: 2700000, metroPopulation: 9400000, lat: 41.8781, lng: -87.6298 },
  { city: 'Houston', state: 'TX', population: 2300000, metroPopulation: 7100000, lat: 29.7604, lng: -95.3698 },
  { city: 'Phoenix', state: 'AZ', population: 1650000, metroPopulation: 4900000, lat: 33.4484, lng: -112.074 },
  { city: 'Philadelphia', state: 'PA', population: 1550000, metroPopulation: 6200000, lat: 39.9526, lng: -75.1652 },
  { city: 'San Antonio', state: 'TX', population: 1470000, metroPopulation: 2600000, lat: 29.4241, lng: -98.4936 },
  { city: 'San Diego', state: 'CA', population: 1380000, metroPopulation: 3300000, lat: 32.7157, lng: -117.1611 },
  { city: 'Dallas', state: 'TX', population: 1300000, metroPopulation: 7600000, lat: 32.7767, lng: -96.797 },
  { city: 'Austin', state: 'TX', population: 970000, metroPopulation: 2300000, lat: 30.2672, lng: -97.7431 },
  { city: 'Jacksonville', state: 'FL', population: 970000, metroPopulation: 1600000, lat: 30.3322, lng: -81.6557 },
  { city: 'Fort Worth', state: 'TX', population: 960000, metroPopulation: 7600000, lat: 32.7555, lng: -97.3308 },
  { city: 'San Jose', state: 'CA', population: 970000, metroPopulation: 2000000, lat: 37.3382, lng: -121.8863 },
  { city: 'Columbus', state: 'OH', population: 910000, metroPopulation: 2150000, lat: 39.9612, lng: -82.9988 },
  { city: 'Charlotte', state: 'NC', population: 900000, metroPopulation: 2700000, lat: 35.2271, lng: -80.8431 },
  { city: 'Indianapolis', state: 'IN', population: 880000, metroPopulation: 2100000, lat: 39.7684, lng: -86.1581 },
  { city: 'San Francisco', state: 'CA', population: 810000, metroPopulation: 4700000, lat: 37.7749, lng: -122.4194 },
  { city: 'Seattle', state: 'WA', population: 750000, metroPopulation: 4000000, lat: 47.6062, lng: -122.3321 },
  { city: 'Denver', state: 'CO', population: 715000, metroPopulation: 2960000, lat: 39.7392, lng: -104.9903 },
  { city: 'Oklahoma City', state: 'OK', population: 695000, metroPopulation: 1450000, lat: 35.4676, lng: -97.5164 },
  { city: 'Nashville', state: 'TN', population: 690000, metroPopulation: 2050000, lat: 36.1627, lng: -86.7816 },
  { city: 'Washington', state: 'DC', population: 680000, metroPopulation: 6300000, lat: 38.9072, lng: -77.0369 },
  { city: 'El Paso', state: 'TX', population: 680000, metroPopulation: 870000, lat: 31.7619, lng: -106.485 },
  { city: 'Las Vegas', state: 'NV', population: 660000, metroPopulation: 2300000, lat: 36.1699, lng: -115.1398 },
  { city: 'Boston', state: 'MA', population: 650000, metroPopulation: 4900000, lat: 42.3601, lng: -71.0589 },
  { city: 'Detroit', state: 'MI', population: 630000, metroPopulation: 4300000, lat: 42.3314, lng: -83.0458 },
  { city: 'Portland', state: 'OR', population: 640000, metroPopulation: 2500000, lat: 45.5152, lng: -122.6784 },
  { city: 'Louisville', state: 'KY', population: 625000, metroPopulation: 1300000, lat: 38.2527, lng: -85.7585 },
  { city: 'Memphis', state: 'TN', population: 630000, metroPopulation: 1340000, lat: 35.1495, lng: -90.049 },
  { city: 'Baltimore', state: 'MD', population: 580000, metroPopulation: 2800000, lat: 39.2904, lng: -76.6122 },
  { city: 'Milwaukee', state: 'WI', population: 570000, metroPopulation: 1560000, lat: 43.0389, lng: -87.9065 },
  { city: 'Albuquerque', state: 'NM', population: 560000, metroPopulation: 920000, lat: 35.0844, lng: -106.6504 },
  { city: 'Tucson', state: 'AZ', population: 545000, metroPopulation: 1050000, lat: 32.2226, lng: -110.9747 },
  { city: 'Fresno', state: 'CA', population: 545000, metroPopulation: 1010000, lat: 36.7378, lng: -119.7871 },
  { city: 'Sacramento', state: 'CA', population: 525000, metroPopulation: 2400000, lat: 38.5816, lng: -121.4944 },
  { city: 'Mesa', state: 'AZ', population: 510000, metroPopulation: 4900000, lat: 33.4152, lng: -111.8315 },
  { city: 'Kansas City', state: 'MO', population: 510000, metroPopulation: 2200000, lat: 39.0997, lng: -94.5786 },
  { city: 'Atlanta', state: 'GA', population: 500000, metroPopulation: 6100000, lat: 33.749, lng: -84.388 },
  { city: 'Omaha', state: 'NE', population: 490000, metroPopulation: 970000, lat: 41.2565, lng: -95.9345 },
  { city: 'Colorado Springs', state: 'CO', population: 490000, metroPopulation: 760000, lat: 38.8339, lng: -104.8214 },
  { city: 'Raleigh', state: 'NC', population: 470000, metroPopulation: 1450000, lat: 35.7796, lng: -78.6382 },
  { city: 'Virginia Beach', state: 'VA', population: 455000, metroPopulation: 1800000, lat: 36.8529, lng: -75.978 },
  { city: 'Long Beach', state: 'CA', population: 455000, metroPopulation: 12900000, lat: 33.7701, lng: -118.1937 },
  { city: 'Miami', state: 'FL', population: 450000, metroPopulation: 6100000, lat: 25.7617, lng: -80.1918 },
  { city: 'Oakland', state: 'CA', population: 440000, metroPopulation: 4700000, lat: 37.8044, lng: -122.2712 },
  { city: 'Minneapolis', state: 'MN', population: 430000, metroPopulation: 3700000, lat: 44.9778, lng: -93.265 },
  { city: 'Tulsa', state: 'OK', population: 410000, metroPopulation: 1020000, lat: 36.154, lng: -95.9928 },
  { city: 'Bakersfield', state: 'CA', population: 410000, metroPopulation: 910000, lat: 35.3733, lng: -119.0187 },
  { city: 'Wichita', state: 'KS', population: 395000, metroPopulation: 650000, lat: 37.6872, lng: -97.3301 },
  { city: 'Arlington', state: 'TX', population: 395000, metroPopulation: 7600000, lat: 32.7357, lng: -97.1081 },
  { city: 'Aurora', state: 'CO', population: 390000, metroPopulation: 2960000, lat: 39.7294, lng: -104.8319 },
  { city: 'Tampa', state: 'FL', population: 400000, metroPopulation: 3200000, lat: 27.9506, lng: -82.4572 },
  { city: 'New Orleans', state: 'LA', population: 380000, metroPopulation: 1270000, lat: 29.9511, lng: -90.0715 },
  { city: 'Cleveland', state: 'OH', population: 370000, metroPopulation: 2050000, lat: 41.4993, lng: -81.6944 },
  { city: 'Honolulu', state: 'HI', population: 350000, metroPopulation: 1000000, lat: 21.3069, lng: -157.8583 },
  { city: 'Anaheim', state: 'CA', population: 345000, metroPopulation: 12900000, lat: 33.8366, lng: -117.9143 },
  { city: 'Lexington', state: 'KY', population: 320000, metroPopulation: 520000, lat: 38.0406, lng: -84.5037 },
  { city: 'Stockton', state: 'CA', population: 320000, metroPopulation: 790000, lat: 37.9577, lng: -121.2908 },
  { city: 'Corpus Christi', state: 'TX', population: 315000, metroPopulation: 420000, lat: 27.8006, lng: -97.3964 },
  { city: 'Henderson', state: 'NV', population: 320000, metroPopulation: 2300000, lat: 36.0395, lng: -114.9817 },
  { city: 'Riverside', state: 'CA', population: 315000, metroPopulation: 4600000, lat: 33.9806, lng: -117.3755 },
  { city: 'Newark', state: 'NJ', population: 310000, metroPopulation: 19500000, lat: 40.7357, lng: -74.1724 },
  { city: 'Saint Paul', state: 'MN', population: 310000, metroPopulation: 3700000, lat: 44.9537, lng: -93.09 },
  { city: 'Santa Ana', state: 'CA', population: 310000, metroPopulation: 12900000, lat: 33.7455, lng: -117.8677 },
  { city: 'Cincinnati', state: 'OH', population: 310000, metroPopulation: 2260000, lat: 39.1031, lng: -84.512 },
  { city: 'Greensboro', state: 'NC', population: 300000, metroPopulation: 780000, lat: 36.0726, lng: -79.792 },
  { city: 'Pittsburgh', state: 'PA', population: 300000, metroPopulation: 2350000, lat: 40.4406, lng: -79.9959 },
  { city: 'Lincoln', state: 'NE', population: 295000, metroPopulation: 350000, lat: 40.8136, lng: -96.7026 },
  { city: 'Anchorage', state: 'AK', population: 290000, metroPopulation: 400000, lat: 61.2181, lng: -149.9003 },
  { city: 'Durham', state: 'NC', population: 290000, metroPopulation: 650000, lat: 35.994, lng: -78.8986 },
  { city: 'Orlando', state: 'FL', population: 310000, metroPopulation: 2700000, lat: 28.5383, lng: -81.3792 },
  { city: 'St. Louis', state: 'MO', population: 290000, metroPopulation: 2800000, lat: 38.627, lng: -90.1994 },
  { city: 'Boise', state: 'ID', population: 240000, metroPopulation: 810000, lat: 43.615, lng: -116.2023 },
  { city: 'Salt Lake City', state: 'UT', population: 210000, metroPopulation: 1260000, lat: 40.7608, lng: -111.891 },
  { city: 'Birmingham', state: 'AL', population: 200000, metroPopulation: 1110000, lat: 33.5186, lng: -86.8104 },
];

// Expansion tier — more populous US cities nationwide. Coordinates are omitted
// (the Places text query "<trade> in <City>, <ST>" carries the location); the
// state disambiguates same-name cities. Populations are approximate (they only
// bucket the market-size score). This roughly triples the geographic universe.
const MORE_CITIES = [
  ['Atlanta', 'GA', 500000, 6100000], ['Miami', 'FL', 440000, 6100000], ['Minneapolis', 'MN', 430000, 3700000],
  ['Sacramento', 'CA', 525000, 2400000], ['Kansas City', 'MO', 510000, 2200000], ['Tampa', 'FL', 400000, 3200000],
  ['New Orleans', 'LA', 380000, 1300000], ['Cleveland', 'OH', 370000, 2000000], ['Pittsburgh', 'PA', 300000, 2300000],
  ['Cincinnati', 'OH', 310000, 2200000], ['Raleigh', 'NC', 470000, 1400000], ['Tucson', 'AZ', 545000, 1050000],
  ['Albuquerque', 'NM', 560000, 920000], ['Fresno', 'CA', 545000, 1000000], ['Mesa', 'AZ', 510000, 4900000],
  ['Omaha', 'NE', 490000, 970000], ['Colorado Springs', 'CO', 480000, 750000], ['Long Beach', 'CA', 460000, 12900000],
  ['Virginia Beach', 'VA', 460000, 1800000], ['Oakland', 'CA', 440000, 4700000], ['Tulsa', 'OK', 410000, 1000000],
  ['Arlington', 'TX', 395000, 7600000], ['Aurora', 'CO', 390000, 2960000], ['Bakersfield', 'CA', 400000, 900000],
  ['Wichita', 'KS', 400000, 640000], ['Honolulu', 'HI', 350000, 1000000], ['Anaheim', 'CA', 350000, 3200000],
  ['Santa Ana', 'CA', 310000, 3200000], ['Riverside', 'CA', 320000, 4600000], ['Corpus Christi', 'TX', 320000, 420000],
  ['Lexington', 'KY', 320000, 520000], ['Henderson', 'NV', 320000, 2300000], ['Stockton', 'CA', 320000, 780000],
  ['Saint Paul', 'MN', 310000, 3700000], ['Newark', 'NJ', 310000, 19500000], ['Greensboro', 'NC', 300000, 780000],
  ['Plano', 'TX', 285000, 7600000], ['Lincoln', 'NE', 290000, 340000], ['Fort Wayne', 'IN', 265000, 420000],
  ['Chandler', 'AZ', 280000, 4900000], ['Toledo', 'OH', 270000, 640000], ['Madison', 'WI', 270000, 680000],
  ['Reno', 'NV', 265000, 490000], ['Scottsdale', 'AZ', 240000, 4900000], ['Chesapeake', 'VA', 250000, 1800000],
  ['Winston-Salem', 'NC', 250000, 680000], ['Norfolk', 'VA', 235000, 1800000], ['Irving', 'TX', 255000, 7600000],
  ['Garland', 'TX', 245000, 7600000], ['Richmond', 'VA', 230000, 1300000], ['Spokane', 'WA', 230000, 590000],
  ['Baton Rouge', 'LA', 225000, 870000], ['Tacoma', 'WA', 220000, 4000000], ['Des Moines', 'IA', 215000, 700000],
  ['Grand Rapids', 'MI', 200000, 1080000], ['Huntsville', 'AL', 220000, 490000], ['Providence', 'RI', 190000, 1600000],
  ['Knoxville', 'TN', 190000, 870000], ['Worcester', 'MA', 205000, 950000], ['Rochester', 'NY', 210000, 1080000],
  ['Buffalo', 'NY', 275000, 1130000], ['Little Rock', 'AR', 200000, 740000], ['Fort Lauderdale', 'FL', 180000, 6100000],
  ['Chattanooga', 'TN', 180000, 560000], ['Fort Collins', 'CO', 170000, 360000], ['Sioux Falls', 'SD', 190000, 280000],
  ['Springfield', 'MO', 170000, 470000], ['Salem', 'OR', 175000, 430000], ['Eugene', 'OR', 175000, 380000],
  ['Dayton', 'OH', 140000, 800000], ['Savannah', 'GA', 145000, 400000], ['Cape Coral', 'FL', 200000, 780000],
  ['Peoria', 'AZ', 190000, 4900000], ['Jackson', 'MS', 150000, 590000], ['Montgomery', 'AL', 195000, 380000],
  ['Shreveport', 'LA', 185000, 390000], ['Akron', 'OH', 190000, 700000], ['Augusta', 'GA', 200000, 610000],
  ['Columbus', 'GA', 205000, 330000], ['Frisco', 'TX', 210000, 7600000], ['McKinney', 'TX', 200000, 7600000],
].map(([city, state, population, metroPopulation]) => ({ city, state, population, metroPopulation }));

// Only add cities not already listed above (avoid scanning the same place twice).
const _seen = new Set(METROS.map((m) => `${m.city}|${m.state}`.toLowerCase()));
for (const m of MORE_CITIES) {
  const k = `${m.city}|${m.state}`.toLowerCase();
  if (!_seen.has(k)) { _seen.add(k); METROS.push(m); }
}

/** States with strict "mini-TCPA" laws — flagged for phone/SMS outreach. */
export const STRICT_OUTREACH_STATES = new Set(['FL', 'OK', 'WA', 'TX']);

export const findMetro = (city, state) =>
  METROS.find(
    (m) =>
      m.city.toLowerCase() === city.toLowerCase() &&
      (!state || m.state.toLowerCase() === state.toLowerCase())
  );

/**
 * The N largest cities — the default hunting ground. Ranked by *city*
 * population (not metro) so we get distinct cities with real geographic
 * spread across the country, rather than several suburbs of the same metro.
 */
export const topMetros = (n = METROS.length) =>
  [...METROS].sort((a, b) => b.population - a.population).slice(0, n);

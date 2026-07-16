/**
 * Maps our internal category keys → OpenStreetMap tag selectors used by the
 * Overpass provider. Only categories with genuine, verified OSM coverage in the
 * US are listed; anything not here simply isn't queried on Overpass (the
 * license-data providers cover the rest). Each selector is [key, value] and a
 * category may OR several.
 *
 * Coverage note (measured live): shop=car_repair is dense; the craft=* trades
 * (plumber, electrician, roofer, hvac) are real but thinner. That's fine — OSM
 * is a gap-filler on top of the government license datasets, not the whole show.
 */
export const OSM_TAGS = {
  plumbing: [['craft', 'plumber']],
  electrical: [['craft', 'electrician']],
  hvac: [['craft', 'hvac'], ['craft', 'heating_engineer']],
  roofing: [['craft', 'roofer']],
  painting: [['craft', 'painter']],
  landscaping: [['craft', 'gardener']],
  masonry: [['craft', 'stonemason']],
  'window-installation': [['craft', 'window_construction']],
  flooring: [['craft', 'floorer']],
  'auto-repair': [['shop', 'car_repair']],
  'auto-body': [['shop', 'car_repair']],
  carpentry: [['craft', 'carpenter']],
  remodeling: [['craft', 'carpenter']],
  handyman: [['craft', 'handyman']],
  'tree-service': [['craft', 'gardener']],
};

/** Category keys that have an OSM mapping (used to skip pointless queries). */
export const OSM_CATEGORY_KEYS = new Set(Object.keys(OSM_TAGS));

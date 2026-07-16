/**
 * Registry of REAL Socrata open-data datasets (verified live) that list
 * businesses / contractors with contact info. Each entry maps that dataset's
 * columns onto our standard fields so the socrata provider can pull leads with
 * one bulk query.
 *
 * fields: column names IN THAT DATASET (they differ per jurisdiction).
 *   name    — business/company name column        (required)
 *   phone   — phone column                          (optional)
 *   address — street address column                 (optional)
 *   city    — city column                           (optional)
 *   state   — state column, or omit + set `state`   (optional)
 *   zip     — postal code column                    (optional)
 *   category— column describing the trade/license   (optional, for filtering)
 *   status  — license status column                 (optional)
 * state:      2-letter state this dataset covers (used to match a metro)
 * cityField:  set when we can filter to a metro's city server-side (SoQL)
 * activeOnly: optional { field, equals } to keep only active licenses
 *
 * To add more: https://api.us.socrata.com/api/catalog/v1?q=contractor%20license
 */
export const SOCRATA_DATASETS = [
  {
    jurisdiction: 'Washington State L&I',
    domain: 'data.wa.gov',
    datasetId: 'm8qx-ubtq',
    state: 'WA',
    fields: {
      name: 'businessname',
      phone: 'phonenumber',
      address: 'address1',
      city: 'city',
      state: 'state',
      zip: 'zip',
      category: 'contractorlicensetypecodedesc',
      status: 'businesstypecode',
    },
    cityField: 'city',
  },
  {
    jurisdiction: 'Chicago Business Licenses',
    domain: 'data.cityofchicago.org',
    datasetId: 'r5kz-chrr',
    state: 'IL',
    fields: {
      name: 'doing_business_as_name',
      address: 'address',
      city: 'city',
      state: 'state',
      zip: 'zip_code',
      category: 'license_description',
      status: 'license_status',
    },
    cityField: 'city',
    activeOnly: { field: 'license_status', equals: 'AAI' },
  },
  {
    jurisdiction: 'Delaware Business Licenses',
    domain: 'data.delaware.gov',
    datasetId: '5zy2-grhr',
    state: 'DE',
    fields: {
      name: 'businessname',
      address: 'addressline1',
      city: 'city',
      state: 'state',
      zip: 'zipcode',
      category: 'licensetype',
    },
    cityField: 'city',
  },
];

/** Map an internal category key → keywords we match against a dataset's
 * license/category column (SoQL LIKE). Broad on purpose — license taxonomies
 * vary wildly by jurisdiction. */
export const SOCRATA_CATEGORY_KEYWORDS = {
  plumbing: ['plumb'],
  electrical: ['electric'],
  hvac: ['hvac', 'heating', 'refrigeration', 'mechanical'],
  roofing: ['roof'],
  remodeling: ['general', 'construction', 'contractor', 'remodel'],
  painting: ['paint'],
  landscaping: ['landscap'],
  concrete: ['concrete', 'cement'],
  masonry: ['mason'],
  flooring: ['floor'],
  fencing: ['fence'],
  'tree-service': ['tree', 'arbor'],
  'auto-repair': ['auto', 'motor vehicle repair'],
  'auto-body': ['body', 'collision'],
  excavation: ['excavat'],
  septic: ['septic'],
  siding: ['siding'],
  gutters: ['gutter'],
  'window-installation': ['window'],
};

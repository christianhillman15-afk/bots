/**
 * Registry of REAL ArcGIS FeatureServer layers (verified live) that list
 * licensed contractors / businesses with contact info. Many government portals
 * publish on ArcGIS instead of Socrata, exposed as public FeatureServer query
 * endpoints.
 *
 * url:      the FeatureServer layer query base (…/FeatureServer/<layer>)
 * state:    2-letter state used to match a metro (null = national/unknown)
 * fields:   attribute names IN THAT SERVICE mapped to our standard fields
 *   name (required), phone, address, city, state, zip, category, status
 * cityField:  attribute to filter to a metro's city server-side (optional)
 * addressField: set when city/state are embedded inside the address string
 *   (e.g. "123 MAIN ST SEATTLE, WA 98101"); the provider then scopes results to
 *   the metro by matching "CITY, ST" inside it. Without a way to geo-scope, a
 *   dataset would return the same wrong-location rows for every city — so a
 *   dataset MUST have either cityField or addressField to be usable.
 * activeOnly: optional { field, equals } to keep only active licenses
 *
 * To find more: https://hub.arcgis.com/api/search/v1/collections/dataset/items?q=contractor%20license
 * then confirm the layer's fields at  <serviceUrl>/<layer>?f=json
 */
export const ARCGIS_DATASETS = [
  {
    jurisdiction: 'Licensed Contractors (ArcGIS)',
    url: 'https://services.arcgis.com/ePKBjXrBZ2vEEgWd/arcgis/rest/services/Licensed_Contractors/FeatureServer/0',
    state: null, // national dataset — scoped to a metro via addressField below
    fields: {
      name: 'CompanyName',
      phone: 'BusinessPhone',
      address: 'Address',
      category: 'LicenseClassification',
      status: 'LicenseStatus',
    },
    addressField: 'Address',
    activeOnly: { field: 'LicenseStatus', equals: 'Issued' },
  },
];

/** Internal category key → keywords matched against an ArcGIS category field. */
export const ARCGIS_CATEGORY_KEYWORDS = {
  plumbing: ['plumb'],
  electrical: ['electric'],
  hvac: ['hvac', 'mechanical', 'heating', 'refrigeration'],
  roofing: ['roof'],
  remodeling: ['general', 'building', 'construction'],
  painting: ['paint'],
  landscaping: ['landscap'],
  concrete: ['concrete'],
  masonry: ['mason'],
  flooring: ['floor'],
  fencing: ['fence'],
  excavation: ['excavat'],
};

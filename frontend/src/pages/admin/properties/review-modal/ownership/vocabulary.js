/* `category` must match the vault category the server stores for the same document. */
export const DOC_TYPES = [
  { value: 'electricity_bill', label: 'Electricity bill', category: 'Electricity Bill' },
  { value: 'tax_receipt', label: 'Property tax receipt', category: 'Property Tax Receipt' },
  { value: 'index_ii', label: 'Index II', category: 'Index II' },
  { value: 'share_certificate', label: 'Share certificate', category: 'Share Certificate' },
  { value: 'satbara_7_12', label: '7/12 extract (Satbara)', category: '7/12 Extract' },
  { value: 'eight_a_extract', label: '8A extract', category: '8A Extract' },
  { value: 'property_card', label: 'Property Card (City Survey)', category: 'Property Card' },
  { value: 'sale_deed', label: 'Sale deed (supporting only)', category: 'Sale Deed' },
  { value: 'power_of_attorney', label: 'Power of Attorney (registered)', category: 'Power of Attorney' },
  { value: 'site_photos', label: 'Site photos (supporting only)', category: 'Site Photos' },
];

const LEGACY_DOC_LABELS = {
  aadhaar: 'Aadhaar (legacy)',
  pan: 'PAN (legacy)',
};

export const docTypeLabel = (value, fallback) =>
  DOC_TYPES.find((type) => type.value === value)?.label || LEGACY_DOC_LABELS[value] || fallback;

export const KIND_LABELS = {
  address_proof: 'Current electricity bill or property tax receipt',
  address_or_title_proof: 'Address or title proof',
  title_proof: 'Title proof',
  title_support: 'Sale deed (supporting only)',
  owner_identity: 'Identity (supporting only)',
  authority_proof: 'Authority to list',
  site_presence: 'Site photos (supporting only)',
};

export const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-IN') : 'Not recorded';

/* One spelling for both the missing-evidence list and the disabled Grant button that describes
   itself by it: a dangling `aria-describedby` neither throws nor lints, it just goes silent. */
export const missingEvidenceId = (panelId) => `${panelId}-missing`;

const IST = 'Asia/Kolkata';
/* Document issue dates are Pune calendar dates, so format in IST rather than the reviewer locale. */
export const istDate = (at = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(at);

/* The client half of the server's evidence table: `category` is the vault category the same paper
   is filed under, which lets picking a file suggest its type. The server refuses a mismatched pair,
   so this list is a convenience and never the check. */
export const DOC_TYPES = [
  { value: 'electricity_bill', label: 'Electricity bill', category: 'Electricity Bill' },
  { value: 'tax_receipt', label: 'Property tax receipt', category: 'Property Tax Receipt' },
  { value: 'index_ii', label: 'Index II', category: 'Index II' },
  { value: 'sale_deed', label: 'Sale deed (supporting only)', category: 'Sale Deed' },
  { value: 'aadhaar', label: 'Aadhaar (supporting only)', category: 'Aadhaar' },
  { value: 'pan', label: 'PAN (supporting only)', category: 'PAN' },
  { value: 'site_photos', label: 'Site photos (supporting only)', category: 'Site Photos' },
];

export const KIND_LABELS = {
  address_proof: 'Current electricity bill or property tax receipt',
  title_proof: 'Index II',
  title_support: 'Sale deed (supporting only)',
  owner_identity: 'Identity (supporting only)',
  site_presence: 'Site photos (supporting only)',
};

export const dateLabel = (value) => value ? new Date(value).toLocaleDateString('en-IN') : 'Not recorded';

/* One spelling for both the missing-evidence list and the disabled Grant button that describes
   itself by it: a dangling `aria-describedby` neither throws nor lints, it just goes silent. */
export const missingEvidenceId = (panelId) => `${panelId}-missing`;

/* A date read off a document is a calendar date, and the calendar that matters is Pune's. Anchoring
   it to UTC would, between midnight and 05:30 IST, cap the picker a day short — the reviewer could
   not enter the date printed in front of them. The API takes the day itself and applies the zone. */
const IST = 'Asia/Kolkata';
export const istDate = (at = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(at);

export const STEP_LABELS = ['Property', 'Owner', 'Tenant', 'Terms', 'Witnesses', 'Review'];

export const FURN_PRESETS = [
  ['Beds', 'bed-double'], ['Wardrobes', 'shirt'], ['Sofa', 'sofa'], ['Dining Table', 'utensils'],
  ['Table', 'table'], ['Chair', 'armchair'], ['Fridge', 'refrigerator'], ['Washing Machine', 'washing-machine'],
  ['AC', 'air-vent'], ['Geyser', 'shower-head'], ['Modular Kitchen', 'cooking-pot'], ['Microwave', 'microwave'],
  ['TV', 'tv'], ['Fan', 'fan'], ['Tube Light', 'lamp-ceiling'], ['Bulb', 'lightbulb'],
  ['Curtains', 'blinds'], ['Mirror', 'rectangle-vertical'], ['Water Purifier', 'droplets'], ['Exhaust Fan', 'wind'],
  ['Stove', 'flame'], ['Chimney', 'cooking-pot'], ['Inverter', 'battery-charging'], ['WiFi Router', 'wifi'],
];

export const OWNER_DOCS = [['PAN Card', 'o-pan'], ['Aadhaar Card', 'o-aadhaar'], ['Passport Photo', 'o-photo'], ['Ownership Proof (Index II / Bill)', 'o-own']];
export const TENANT_DOCS = ['PAN Card', 'Aadhaar Card', 'Passport Photo', 'Employment / Income Proof'];

// Mandatory KYC/ownership documents — highlighted with the app-standard required marker.
// Owner: PAN, Aadhaar, Passport Photo and Ownership Proof are all needed to register a
// Leave & License. Tenant: PAN, Aadhaar and Passport Photo (employment proof is optional).
export const OWNER_DOCS_REQUIRED = ['o-pan', 'o-aadhaar', 'o-photo', 'o-own'];
export const TENANT_DOCS_REQUIRED = [0, 1, 2];

// Maps each owner doc slot to the category it lives under in the dashboard's personal
// Document vault (getDocsForProp(mobile, 'personal')). Lets the wizard reuse KYC/ownership
// docs already on file and save fresh uploads back there. Values match DocumentsTab's KYC group.
export const OWNER_VAULT_CAT = { 'o-pan': 'PAN Card', 'o-aadhaar': 'Aadhaar Card', 'o-photo': 'Passport Photo', 'o-own': 'Ownership Proof' };

export const SERVICES = [
  ['Drafting Leave & License', 'file-pen-line', 'Legally sound, government-approved residential & commercial drafts.'],
  ['Online e-Registration', 'globe', 'End-to-end e-registration on the Maharashtra IGR portal.'],
  ['Stamp Duty Calculation & Payment', 'badge-indian-rupee', 'Accurate Art. 36A computation and online payment.'],
  ['Biometric Verification', 'fingerprint', 'Doorstep biometric (thumb) capture for all parties.'],
  ['Agreement Renewal', 'refresh-cw', 'Hassle-free renewal of expiring agreements.'],
  ['Police Verification Assistance', 'shield-check', 'Tenant police verification support where required.'],
];
export const DOC_OWNER = ['PAN Card', 'Aadhaar Card', 'Passport-size photograph', 'Ownership proof — Index II / Sale Deed', 'Latest Electricity Bill or Property Tax receipt'];
export const DOC_TENANT = ['PAN Card', 'Aadhaar Card', 'Passport-size photograph', 'Employment / Income proof (salary slip / appointment letter)', 'Proof of current address (if outstation)'];
export const DOC_OTHER = ['Two witnesses — Aadhaar / PAN + photo', 'Biometric (thumb) of all parties for e-registration', 'Registered mobile numbers (OTP based)'];
export const FAQ = [
  ['Is registration of a rent agreement mandatory in Maharashtra?', 'Yes. Under the Maharashtra Rent Control Act, a Leave & License agreement must be registered. An unregistered agreement is not valid evidence and attracts penalties.'],
  ['How is stamp duty calculated?', 'For Leave & License (Article 36A), stamp duty is 0.25% of the total of: rent for the full period + any non-refundable deposit + 10% of the refundable deposit for each year of the term.'],
  ['What is the registration fee?', '₹1,000 for properties in municipal / urban areas and ₹500 for properties in rural (Gram Panchayat) areas.'],
  ['Why is the agreement usually for 11 months?', 'An 11-month term keeps registration simpler and is the common practice, though agreements can be made for any tenure both parties agree to.'],
  ['Do all parties need to be physically present?', 'No. With e-registration and doorstep biometric (thumb impression), the process can be completed from home for owner, tenant and witnesses.'],
  ['What documents do I need?', 'PAN and Aadhaar of owner and tenant, owner’s ownership proof (Index II / electricity bill), passport photos, and two witnesses with ID.'],
];

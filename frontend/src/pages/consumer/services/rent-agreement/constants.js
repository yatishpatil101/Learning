export const STEP_LABELS = ['Property', 'Owner', 'Tenant', 'Terms', 'Witnesses', 'Review'];
/* Last step a signed-out visitor may reach: later steps collect PAN/Aadhaar, which need an account behind them. */

export const LAST_PUBLIC_STEP = 0;

export const FURN_PRESETS = [
  ['Beds', 'bed-double'], ['Wardrobes', 'shirt'], ['Sofa', 'sofa'], ['Dining Table', 'utensils'],
  ['Table', 'table'], ['Chair', 'armchair'], ['Fridge', 'refrigerator'], ['Washing Machine', 'washing-machine'],
  ['AC', 'air-vent'], ['Geyser', 'shower-head'], ['Modular Kitchen', 'cooking-pot'], ['Microwave', 'microwave'],
  ['TV', 'tv'], ['Fan', 'fan'], ['Tube Light', 'lamp-ceiling'], ['Bulb', 'lightbulb'],
  ['Curtains', 'blinds'], ['Mirror', 'rectangle-vertical'], ['Water Purifier', 'droplets'], ['Exhaust Fan', 'wind'],
  ['Stove', 'flame'], ['Chimney', 'cooking-pot'], ['Inverter', 'battery-charging'], ['WiFi Router', 'wifi'],
];

export const FIXTURES = new Set(['Fan', 'Tube Light', 'Bulb', 'Exhaust Fan', 'Geyser', 'Modular Kitchen', 'Chimney', 'Mirror', 'Curtains', 'Water Purifier', 'Inverter', 'WiFi Router']);

export const PERIODS = [11, 12, 22, 24, 36, 60];
export const MAX_OCCUPANTS = 20;
export const PARKING = ['none', 'two-wheeler', 'car', 'both'];
export const DEED_LANGUAGES = ['English', 'Marathi'];
export const VISIT_PLACES = ['property', 'licensor', 'licensee'];
export const VISIT_SLOTS = ['any', 'morning', 'afternoon', 'evening'];
export const VISIT_DATE_FUTURE_DAYS = 90;
export const AREA_UNITS = ['sqft', 'sqm'];
export const AREA_BASES = ['carpet', 'built-up'];
export const PROPERTY_ATTRIBUTE_KINDS = ['CTS No.', 'Survey No.', 'Gat No.', 'Plot No.', 'Khata No.', 'Milkat (Property) No.', 'Hissa No.'];
export const PUNE_TALUKAS = ['Pune City', 'Haveli', 'Mulshi', 'Maval', 'Khed', 'Shirur', 'Daund', 'Indapur', 'Baramati', 'Purandar', 'Bhor', 'Velhe / Rajgad', 'Junnar', 'Ambegaon', 'Pimpri-Chinchwad / Pimpri'];
export const PUNE_POLICE_STATIONS = ['Alankar', 'Airport', 'Alandi', 'Bavdhan', 'Baner', 'Bibvewadi', 'Bund Garden', 'Chandan Nagar', 'Chaturshringi', 'Dattawadi', 'Deccan Gymkhana', 'Faraskhana', 'Hadapsar', 'Hinjewadi', 'Khadak', 'Khadki', 'Kondhwa', 'Koregaon Park', 'Kothrud', 'Lashkar', 'Lonikand', 'Mundhwa', 'Sahakar Nagar', 'Shivajinagar', 'Sinhagad Road', 'Swargate', 'Vimantal', 'Vishrantwadi', 'Wakad', 'Warje Malwadi', 'Yerawada'];
export const MAX_AREA = 100000;
export const MAX_FLOOR = 200;
export const DECLARATION_VERSION = 'ra-decl-2026-09';

export const OWNER_DOCS = [['PAN Card', 'o-pan'], ['Aadhaar Card', 'o-aadhaar'], ['Passport Photo', 'o-photo'], ['Ownership Proof (Index II / Bill)', 'o-own']];
export const TENANT_DOCS = ['PAN Card', 'Aadhaar Card', 'Passport Photo', 'Employment / Income Proof'];

export const OWNER_DOCS_REQUIRED = ['o-pan', 'o-aadhaar', 'o-photo', 'o-own'];
export const TENANT_DOCS_REQUIRED = [0, 1, 2];
export const POA_DOC = 'o-poa';
export const CO_OWNER_DOCS = ['pan', 'aadhaar', 'photo'];
export const RESIDENCIES = ['resident', 'nri', 'foreign'];
export const PARTY_TYPES = ['individual', 'entity'];
export const ADDRESS_PROOF_TYPES = ['driving-license', 'election-card', 'passport', 'uid'];
export const FAMILY_MEMBER_TYPES = ['family', 'co-tenant'];
export const FAMILY_RELATIONS = ['father', 'mother', 'spouse', 'son', 'daughter', 'brother', 'sister', 'friend', 'other'];
export const MAX_POLICE_OCCUPANTS = MAX_OCCUPANTS;

/* Upload categories the server's rent-agreement checklist matches on (`ServiceRequestChecklist`). */
export const OWNER_DOC_CATEGORY = { 'o-pan': 'licensor-0-pan', 'o-aadhaar': 'licensor-0-aadhaar', 'o-passport': 'licensor-0-passport', 'o-visa': 'licensor-0-visa', 'o-photo': 'licensor-0-photo', 'o-own': 'ownership-proof', 'o-poa': 'licensor-0-poa' };
export const TENANT_DOC_SLUGS = ['pan', 'aadhaar', 'photo', 'income', 'addressproof', 'prevaddressproof'];
// Must match `RentAgreementDetailsRules` on the server.

export const MAX_LICENSORS = 4;
export const MAX_TENANTS = 6;
export const MAX_MONTHS = 60;
export const START_DATE_PAST_DAYS = 30;
export const START_DATE_FUTURE_DAYS = 180;
export const DUE_DAY_MAX = 28;
export const MH_PINCODE = /^(?!403)4[0-4]\d{4}$/;
export const CASH_LIMIT = 200000;
// The IGR portal's deposit-payment modes and the fields each one asks for. Must match `RentAgreementDetailsRules`.
export const DEPOSIT_PAY_FIELDS = {
  upi: ['ref', 'amount', 'date'],
  netbanking: ['bank', 'branch', 'ref', 'amount', 'date'],
  dd: ['bank', 'branch', 'date', 'ref', 'amount'],
  cash: ['date', 'amount'],
};
export const MAX_DEPOSIT_PAYMENTS = 10;
export const PAYMENT_REF = /^[A-Za-z0-9]{4,30}$/;
export const BANKS = ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Bank of Maharashtra', 'Bank of Baroda', 'Punjab National Bank', 'Union Bank of India', 'Canara Bank', 'Bank of India', 'IDFC FIRST Bank', 'IndusInd Bank', 'Yes Bank', 'Cosmos Co-operative Bank', 'Saraswat Co-operative Bank'];
export const TDS_RENT_THRESHOLD = 50000;
// Commercial leave & licence (GST, TDS 194-I, a different clause set) is quoted by the legal desk.

export const COMMERCIAL_ROUTE = '/services/property-legal';
export const RESIDENTIAL_PROPERTY_TYPES = ['Flat / Apartment', 'Independent House / Bungalow', 'Row House'];
// Owner doc slot -> its category in the dashboard's personal Document vault, so the wizard can
// reuse docs already on file. Values must match DocumentsTab's KYC group.

export const OWNER_VAULT_CAT = { 'o-pan': 'PAN Card', 'o-aadhaar': 'Aadhaar Card', 'o-photo': 'Passport Photo', 'o-own': 'Ownership Proof' };

export const SERVICES = [
  ['Drafting Leave & License', 'file-pen-line', 'Legally sound, government-approved residential drafts.'],
  ['Online e-Registration', 'globe', 'End-to-end e-registration on the Maharashtra IGR portal.'],
  ['Stamp Duty Calculation & Payment', 'badge-indian-rupee', 'Accurate Art. 36A computation and online payment.'],
  ['Biometric Verification', 'fingerprint', 'Doorstep biometric (thumb) capture for all parties.'],
  ['Agreement Renewal', 'refresh-cw', 'Hassle-free renewal of expiring agreements.'],
  ['Police Verification Assistance', 'shield-check', 'Tenant police verification support where required.'],
];
export const DOC_OWNER = ['PAN Card', 'Aadhaar Card', 'Passport-size photograph', 'Ownership proof — Index II / Sale Deed', 'Latest Electricity Bill or Property Tax receipt', 'Every co-owner’s PAN, Aadhaar and photo — all co-owners sign', 'Registered Power of Attorney, if signing for the owner'];
export const DOC_TENANT = ['PAN Card', 'Aadhaar Card', 'Passport-size photograph', 'Employment / Income proof (salary slip / appointment letter)', 'Proof of current address (if outstation)'];
export const DOC_OTHER = ['Two adult witnesses — name, address and Aadhaar number', 'Biometric (thumb) and live photo of all parties and witnesses at e-registration', 'Registered mobile numbers (OTP based)'];
export const FAQ = [
  ['Is registration of a rent agreement mandatory in Maharashtra?', 'Yes. Section 55 of the Maharashtra Rent Control Act, 1999 makes registration compulsory for every leave and licence agreement, whatever its term, and puts the duty on the owner. If it is not registered, the tenant\'s account of the terms prevails in a dispute, and the owner can be fined up to ₹5,000 or jailed for up to three months.'],
  ['How is stamp duty calculated?', 'For Leave & License (Article 36A), stamp duty is 0.25% of the total of: rent for the full period, including any agreed increases, + any non-refundable deposit + 10% of the refundable deposit for each year of the term.'],
  ['What is the registration fee?', '₹1,000 for properties in municipal / urban areas and ₹500 for properties in rural (Gram Panchayat) areas.'],
  ['Why is the agreement usually for 11 months?', 'Mostly habit, and a shorter term means less stamp duty and a chance to renegotiate at renewal. In Maharashtra it does not avoid registration: every leave and licence agreement must be registered, whether it runs 11 months or 60. You can choose any term up to 60 months here.'],
  ['Do all parties need to be physically present?', 'No. With e-registration and doorstep biometric (thumb impression), the process can be completed from home for owner, tenant and witnesses.'],
  ['What documents do I need?', 'PAN and Aadhaar of owner and tenant, owner’s ownership proof (Index II / electricity bill), passport photos, and two witnesses with ID.'],
];

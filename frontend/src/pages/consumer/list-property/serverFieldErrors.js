const FIELD_ALIASES = {
  area: 'carpetArea',
  builtUpArea: 'builtUp',
  superBuiltUpArea: 'superBuiltUp',
  desc: 'description',
  address: 'society',
  rera: 'reraId',
  reraNumber: 'reraId',
  electricityMeterNo: 'electricityConsumerNo',
  construction: 'possession',
};

const STEP_BY_FIELD = {
  propertyType: 1,
  deal: 1,
  bhk: 1,
  homeTypeLabel: 1,
  commercialType: 1,
  bathrooms: 1,
  balconies: 1,
  carpetArea: 1,
  builtUp: 1,
  superBuiltUp: 1,
  floor: 1,
  totalFloors: 1,
  furnishing: 1,
  shellType: 1,
  washrooms: 1,
  plotLength: 1,
  plotWidth: 1,
  naStatus: 1,
  otherRights: 1,
  buyerEligibility: 1,
  locality: 2,
  flatNumber: 2,
  tower: 2,
  society: 2,
  street: 2,
  pincode: 2,
  location: 2,
  price: 3,
  monthlyRent: 3,
  deposit: 3,
  ownership: 3,
  possession: 3,
  construction: 3,
  availableFrom: 3,
  reraId: 3,
  photos: 4,
  images: 4,
  title: 4,
  description: 4,
};

const fieldNameOf = (entry) => String(entry?.field || entry?.name || entry?.path || '').trim();
const fieldMessageOf = (entry) => String(entry?.message || entry?.reason || '').trim() || true;
const normalizedFieldName = (field) => field
  .replace(/\[(\d+)\]/g, '')
  .replace(/^(request|listing|payload|body|form)\./, '')
  .replace(/^fields\./, '')
  .replace(/^formDetails\./, '');

export function mapServerFieldErrors(form, fields = []) {
  const errors = {};
  const unknown = [];
  for (const entry of fields) {
    const raw = fieldNameOf(entry);
    if (!raw) continue;
    const normalized = normalizedFieldName(raw);
    const key = FIELD_ALIASES[normalized] || normalized;
    const formKey = key === 'price' && form?.deal === 'rent' ? 'monthlyRent' : key;
    if (!STEP_BY_FIELD[formKey]) {
      unknown.push(raw);
      continue;
    }
    if (!errors[formKey]) errors[formKey] = fieldMessageOf(entry);
  }
  const steps = Object.keys(errors).map((key) => STEP_BY_FIELD[key]).filter(Boolean);
  return {
    errors,
    step: steps.length ? Math.min(...steps) : null,
    unknown,
  };
}

import { commercialLabelOf } from './constants.js';

const TYPE_LABEL = {
  flat: 'flat',
  independent: 'independent house',
  villa: 'villa',
  openplot: 'open plot',
  farmland: 'farm land',
};

const compact = (parts) => parts.filter(Boolean).join(', ');
const money = (value) => (value ? `₹${String(value).trim()}` : '');
const bhkLabel = (form) => (form.bhk && !['commercial', 'openplot', 'farmland'].includes(form.propertyType)
  ? `${form.bhk === '0' ? '1 RK' : `${form.bhk === '5' ? '5+' : form.bhk} BHK`}` : '');
const typeLabel = (form) => (form.propertyType === 'commercial'
  ? (commercialLabelOf(form.commercialType) || 'commercial property')
  : (TYPE_LABEL[form.propertyType] || 'property'));

const T = {
  intro: (f) => `${compact([bhkLabel(f), typeLabel(f)])} in ${compact([f.society, f.locality]) || 'Pune'}.`,
  specs: (items) => `${items.join(', ')} are stated by the owner.`,
  rent: (items) => `Rent details: ${items.join(', ')}.`,
  sale: (items) => `Sale details: ${items.join(', ')}.`,
  amenities: (items) => `Key amenities/features: ${items.join(', ')}.`,
};

export function describeListing(form) {
  const specs = [
    form.carpetArea && `${form.carpetArea} ${form.areaUnit || 'sqft'} carpet`,
    form.floor && form.totalFloors && `floor ${form.floor} of ${form.totalFloors}`,
    form.facing && `${form.facing} facing`,
    form.furnishing && form.furnishing !== 'unfurnished' && form.furnishing,
    form.parkingSpaces && `${form.parkingSpaces} parking`,
  ];
  const deal = form.deal === 'rent'
    ? [
        form.monthlyRent && `${money(form.monthlyRent)}/month`,
        form.deposit && `${money(form.deposit)} deposit`,
        form.availableFrom && `available from ${form.availableFrom}`,
        form.preferredTenants?.length && `preferred tenants: ${form.preferredTenants.join(', ')}`,
      ]
    : [
        form.price && money(form.price),
        form.construction && `possession: ${form.construction}`,
        form.ownership && `ownership: ${form.ownership}`,
      ];
  return [
    T.intro(form),
    specs.filter(Boolean).length ? T.specs(specs.filter(Boolean)) : '',
    deal.filter(Boolean).length ? (form.deal === 'rent' ? T.rent(deal.filter(Boolean)) : T.sale(deal.filter(Boolean))) : '',
    form.amenities?.length ? T.amenities(form.amenities.slice(0, 6)) : '',
  ].filter(Boolean).slice(0, 4).join(' ');
}

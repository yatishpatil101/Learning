/* Owner Hub — passport completeness. A property's "passport" is complete when the
   owner has captured the basics, a valuation, at least one document, and rent
   details (or marked it vacant). Drives the completeness meter. */

export function passportChecklist(prop, docCount = 0) {
  const basics = !!(prop.locality && prop.bhkNum && prop.area);
  const valued = !!prop.valuation;
  const hasDoc = docCount > 0;
  const rentReady = prop.rented ? !!(prop.monthlyRent && prop.tenantName) : true;
  const furnished = !!prop.furnishing;
  return [
    { key: 'basics', label: 'Property basics', done: basics },
    { key: 'furnishing', label: 'Furnishing set', done: furnished },
    { key: 'valued', label: 'Valuation saved', done: valued },
    { key: 'docs', label: 'At least one document', done: hasDoc },
    { key: 'rent', label: prop.rented ? 'Rent & tenant set' : 'Occupancy set', done: rentReady },
  ];
}

export function passportPercent(prop, docCount = 0) {
  const items = passportChecklist(prop, docCount);
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

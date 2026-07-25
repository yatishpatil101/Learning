// Plain-language "what does this mean?" copy for every explained option/tile on the
// property-detail page. Keyed by a stable id (section.option). Rendered by <Tip/> on hover.
// Voice: help a first-time Pune buyer/renter understand the significance of each tile.
// Only add entries for tiles that are NOT already explained inline elsewhere.

export const OPTION_INFO = {
  // ---- Overview: Key Details ---------------------------------------------------
  'keydetail.bedrooms': { title: 'Bedrooms (BHK)', body: 'BHK = Bedroom, Hall, Kitchen — the standard way homes are sized in India. A 2 BHK has 2 bedrooms plus a living hall and kitchen.' },
  'keydetail.bathrooms': { title: 'Bathrooms', body: 'Total bathrooms in the home, including any attached to a bedroom.' },
  'keydetail.area': { title: 'Built-up area', body: "The unit's size in square feet. Divide the price by this to compare value across listings on a per-sq.ft basis." },
  'keydetail.furnishing': { title: 'Furnishing', body: 'Unfurnished (bare), Semi-furnished (usually wardrobes, fittings, modular kitchen) or Furnished (adds beds, sofa and appliances).' },
  'keydetail.floor': { title: 'Floor', body: "Which floor the unit is on, out of the building's total. Higher floors mean better views and less street noise; lower floors are easier to access." },
  'keydetail.facing': { title: 'Facing direction', body: 'The direction the main door or balcony faces. Many buyers prefer East or North for morning light and Vaastu reasons.' },
  'keydetail.parking': { title: 'Parking', body: 'Number of dedicated car-parking spaces that come with the property.' },
  'keydetail.age': { title: 'Property age', body: 'How old the building is. Newer builds need less upkeep; older ones often have larger layouts in settled localities.' },
  'keydetail.available': { title: 'Availability', body: "When you can move in. 'Immediately' means the home is vacant and ready now." },
  'keydetail.plotArea': { title: 'Plot area', body: 'The size of the land parcel in square feet — the actual ground you own.' },
  'keydetail.plotZone': { title: 'Plot zone', body: 'The land-use zone (residential, commercial, agricultural, etc.). It decides what you are legally allowed to build.' },
  'keydetail.title': { title: 'Title status', body: 'Whether ownership records are clear and verified. A clear title means no disputes, loans or dues attached to the land.' },
  'keydetail.perUnitBuy': { title: 'Price per sq.ft', body: 'The rate per square foot — the fairest way to compare value between properties of different sizes.' },
  'keydetail.perUnitRent': { title: 'Rent per sq.ft', body: 'Monthly rent divided by area — a quick way to compare how efficiently two rentals are priced.' },

  // ---- Overview: status / trust tags ------------------------------------------
  'tag.readyToMove': { title: 'Ready to Move', body: 'Construction is complete — you can occupy the home right after the paperwork, with no waiting period.' },
  'tag.underConstruction': { title: 'Under Construction', body: 'Still being built. Usually cheaper and paid in stages, but you wait for possession and take on completion risk.' },
  'tag.verifiedOwner': { title: 'Verified Owner', body: "The lister's identity has been checked against Aadhaar/phone, so you're dealing with a genuine person — not an anonymous broker." },
  'tag.ownershipVerified': { title: 'Ownership Verified', body: 'PuneNest has seen documents linking this person to the property, reducing the risk of fake or duplicate listings.' },
  'tag.rera': { title: 'RERA Approved', body: 'Registered under the Real Estate Regulatory Authority — the project is legally accountable for timelines, carpet area and quality.' },
  'tag.furnishing': { title: 'Furnishing', body: 'Unfurnished, Semi-furnished (usually wardrobes and fittings) or Furnished (adds beds, sofa and appliances).' },

  // ---- Overview: floor plan ----------------------------------------------------
  'floorplan.carpet': { title: 'Carpet area', body: 'The actual usable floor space inside your walls — what you can lay a carpet on. This is the RERA-mandated figure to compare.' },
  'floorplan.builtup': { title: 'Built-up area', body: 'Carpet area plus the walls and balconies — larger than carpet area by roughly 10–15%.' },
  'floorplan.superBuiltup': { title: 'Super built-up area', body: 'Built-up area plus a share of common spaces (lobby, stairs, lift). Often what price-per-sq.ft is quoted on.' },
  'floorplan.balconies': { title: 'Balconies', body: 'Number of open balconies — valued for ventilation, drying space and outdoor sit-outs.' },

  // ---- Location ----------------------------------------------------------------
  'location.commute': { title: 'Commute to work', body: 'Estimated drive time by road from this home to Pune\u2019s major employment hubs, so you can judge your daily commute.' },
  'location.commuteBiz': { title: 'Connectivity to business hubs', body: 'Drive time by road to Pune\u2019s main commercial hubs — a proxy for how well-placed this address is for clients, staff and footfall.' },
  'location.nearby': { title: 'What\u2019s nearby', body: 'Key landmarks — IT parks, transit, malls, schools — with their distance, to gauge day-to-day convenience.' },
  'location.livability': { title: 'Livability score', body: 'A 0\u201310 read on the locality across safety, connectivity, schools, healthcare, lifestyle and greenery.' },

  // ---- Price Insights (sale) ---------------------------------------------------
  'price.base': { title: 'Base price', body: 'The quoted sticker price of the property, before stamp duty, registration and any taxes.' },
  'price.stampDuty': { title: 'Stamp duty', body: 'A state government tax on the sale, ~6% in Pune. Paid at registration to make the transfer legally valid.' },
  'price.registration': { title: 'Registration charge', body: 'The fee to record the sale in government records — about 1% of value, capped at \u20B930,000 in Maharashtra.' },
  'price.gst': { title: 'GST', body: 'Goods & Services Tax applies only to under-construction property (1% affordable / 5% otherwise, 12% commercial). Ready-to-move homes and land are exempt.' },
  'price.emi': { title: 'Estimated EMI', body: 'Indicative monthly home-loan instalment at ~8.5% interest. Adjust the loan amount and tenure to see how it changes.' },

  // ---- Rent Details ------------------------------------------------------------
  'rent.maintenance': { title: 'Maintenance', body: 'Monthly society charge for upkeep of common areas, security and amenities — sometimes included in rent, sometimes extra.' },
  'rent.deposit': { title: 'Security deposit', body: 'A refundable sum held by the owner against damages or unpaid dues. In Pune this is commonly 2\u20133 months\u2019 rent.' },
  'rent.lockin': { title: 'Lock-in period', body: 'The minimum time you commit to stay. Leaving earlier usually means forfeiting part of the deposit or paying rent for the balance.' },
  'rent.notice': { title: 'Notice period', body: 'How much advance notice either side must give before ending the tenancy — typically one month.' },
  'rent.tenants': { title: 'Preferred tenants', body: 'Who the owner is open to renting to — family, bachelors or company lease. It sets expectations before you enquire.' },

  // ---- Verification & Docs -----------------------------------------------------
  'verification.owner': { title: 'Owner verified', body: "The lister's identity is confirmed via Aadhaar/phone — you're dealing with a real, contactable person." },
  'verification.ownership': { title: 'Ownership verified', body: 'Documents linking this person to the property have been checked, lowering the risk of a fraudulent listing.' },
  'verification.docs': { title: 'Document-backed', body: 'The owner has uploaded genuine property papers a serious buyer or their lawyer can verify before booking.' },

  // ---- Owner card --------------------------------------------------------------
  'owner.noBrokerage': { title: 'Zero brokerage', body: 'You deal directly with the owner — no agent, no brokerage fee (typically ~1\u20132% of price/rent that other portals charge).' },
  'owner.numberProtected': { title: 'Number protected', body: "The owner's phone stays hidden until they approve your request, so listings don't attract spam calls." },
};

export function tipFor(key) {
  return OPTION_INFO[key] || null;
}

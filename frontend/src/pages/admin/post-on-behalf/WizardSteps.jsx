import { ImagePlus } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import { parseAmount } from '../../../lib/format.js';
import Select from '../../../components/ui/Select.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import MultiSelect from '../../../components/ui/MultiSelect.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import {
  localities, facingOptions, ageOptions, floorOptions, totalFloorsOptions,
  typeOptions, commercialSubtypes, NONRES_TYPES, isLandType, isHouseType,
  bhkOptions, bathroomOptions, balconyOptions, pgSharingOptions, furnishingOptions, furnitureFor,
  shellTypeOptions, washroomOptions, suitableForOptions, plotZoneOptions, openSidesOptions, waterSourceOptions,
  ownershipOptions, agreementOptions, lockinOptions, noticeOptions,
  transactionTypeOptions, possessionOptions, preferredTenantsOptions, pgGenderOptions, pgMealsOptions,
  amenitiesFor, fld, label, errCls, PG_SHARING_HELP,
} from './constants.js';

const furnLabel = (v) => furnishingOptions.find((o) => o.value === v)?.label || v;
const optLabel = (opts, v) => opts.find((o) => o.value === v)?.label || v;

function CheckboxRow({ checked, onChange, children }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-white/5 text-teal-500 focus:ring-teal-400/30" />
      <span className="text-sm text-gray-300">{children}</span>
    </label>
  );
}

const formatIndian = (v) => {
  const s = String(v ?? '').replace(/\D/g, '');
  if (!s) return '';
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
};

const moneyWords = (v) => {
  const num = parseAmount(v);
  if (!num) return '';
  if (num >= 10000000) return `≈ ₹ ${(num / 10000000).toFixed(2).replace(/\.00$/, '')} Crore`;
  if (num >= 100000) return `≈ ₹ ${(num / 100000).toFixed(2).replace(/\.00$/, '')} Lakh`;
  if (num >= 1000) return `≈ ₹ ${(num / 1000).toFixed(2).replace(/\.00$/, '')} Thousand`;
  return `≈ ₹ ${num}`;
};

export function OwnerStep({ form, set, errors, pendingByMobile, standing }) {
  const mobileValid = /^[6-9]\d{9}$/.test(form.ownerMobile);
  /* Counted by the page, not here. This used to read `rawDb().listings` directly — the mock store,
     which the live provider never writes to, so against the API the warning could never appear.
     The tally now arrives as a prop from one read of the pending queue when the wizard opens; see
     `AdminPostOnBehalf`. Defaulted so the step still renders if it is mounted without one. */
  const dupCount = mobileValid ? (pendingByMobile?.get(form.ownerMobile) || 0) : 0;
  /* Shown, never enforced. The desk is exempt from the owner's plan ceiling — that exemption is
     what lets an operator record all three flats the caller is describing instead of one — so this
     is information for the call, not a gate on the form. It reads as a sales prompt rather than a
     warning for exactly that reason: nothing has gone wrong, there is simply a conversation to
     have. `known` is false on most first calls, and an owner sitting exactly on their limit is not
     over it, so neither renders anything. */
  const overage = standing?.known && standing.overAllowance ? standing : null;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
        <strong>Concierge Mode:</strong> You are posting this property on behalf of the owner. They will receive an SMS with a link to add photos, verify Aadhaar &amp; claim the listing.
      </div>
      <div><label htmlFor="pob-ownerName" className={label}>Owner Name *</label><input id="pob-ownerName" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} placeholder="Full name of the property owner" className={classNames(fld, errors.ownerName && errCls)} /><FieldError show={!!errors.ownerName}>Owner name is required.</FieldError></div>
      <div><label htmlFor="pob-ownerMobile" className={label}>Owner Mobile *</label><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">+91</span><input id="pob-ownerMobile" inputMode="numeric" value={form.ownerMobile} onChange={(e) => set('ownerMobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" className={classNames(fld, 'pl-12', errors.ownerMobile && errCls)} /></div><FieldError show={!!errors.ownerMobile}>Valid 10-digit mobile required.</FieldError>
        {dupCount > 0 && <p className="mt-1.5 text-xs text-amber-300/90">⚠ This owner already has {dupCount} pending listing{dupCount > 1 ? 's' : ''}. You can still continue if this is a different property.</p>}
        {overage && <p data-testid="pob-plan-overage" className="mt-1.5 text-xs text-sky-300/90">This owner is over their plan — {overage.held} live listing{overage.held > 1 ? 's' : ''} on a plan that includes {overage.allowance}. You can still post; worth mentioning an upgrade on the call.</p>}
      </div>
      <div><label htmlFor="pob-ownerNotes" className={label}>Internal Notes (optional)</label><textarea id="pob-ownerNotes" value={form.ownerNotes} onChange={(e) => set('ownerNotes', e.target.value)} placeholder="e.g. Owner contacted via WhatsApp, photos sent on chat..." rows={3} className={fld} /></div>
    </div>
  );
}

export function PropertyStep({ form, set, errors }) {
  const t = form.propertyType;
  const land = isLandType(t);
  const commercial = t === 'commercial';
  const pg = t === 'pg';
  const house = isHouseType(t);
  const home = !!t && !land && !commercial && !pg; // flat / independent / villa
  const amenityOptions = amenitiesFor(t, form.commercialType);
  const furnitureOptions = furnitureFor(t);
  const showFurniture = (home || pg) && (form.furnishing === 'semi' || form.furnishing === 'furnished');
  const numInput = (field) => (e) => set(field, e.target.value.replace(/\D/g, ''));
  return (
    <div className="space-y-5">
      <div><label className={label}>Property Type *</label><Select value={form.propertyType} onChange={(v) => set('propertyType', v)} options={typeOptions} placeholder="Select type" ariaLabel="Property type" invalid={!!errors.propertyType} /><FieldError show={!!errors.propertyType}>Select a property type.</FieldError></div>
      {commercial && <div><label className={label}>Commercial Type *</label><Select value={form.commercialType} onChange={(v) => set('commercialType', v)} options={commercialSubtypes} placeholder="Select commercial type" ariaLabel="Commercial type" invalid={!!errors.commercialType} /><FieldError show={!!errors.commercialType}>Select the commercial type.</FieldError></div>}
      {pg
        ? <div><label className={label}>Sharing Types *</label><p className="mb-1.5 text-xs text-gray-500">{PG_SHARING_HELP}</p><MultiSelect values={form.sharing || []} onChange={(arr) => set('sharing', arr)} options={pgSharingOptions} placeholder="Select sharing types" ariaLabel="Sharing" invalid={!!errors.sharing} /><FieldError show={!!errors.sharing}>Select at least one room sharing type.</FieldError></div>
        : !NONRES_TYPES.includes(t) && <div><label className={label}>BHK *</label><Select value={form.bhk} onChange={(v) => set('bhk', v)} options={bhkOptions} placeholder="Select BHK" ariaLabel="BHK" invalid={!!errors.bhk} /><FieldError show={!!errors.bhk}>Select the BHK configuration.</FieldError></div>}
      <div><label htmlFor="pob-carpetArea" className={label}>{land ? 'Plot Area (sq.ft) *' : 'Carpet Area (sq.ft) *'}</label><input id="pob-carpetArea" inputMode="numeric" value={form.carpetArea} onChange={numInput('carpetArea')} placeholder="e.g. 850" className={classNames(fld, errors.carpetArea && errCls)} /><FieldError show={!!errors.carpetArea}>{land ? 'Plot area is required.' : 'Carpet area is required.'}</FieldError></div>

      {home && (
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Bathrooms</label><Select value={form.bathrooms} onChange={(v) => set('bathrooms', v)} options={bathroomOptions} placeholder="Bathrooms" ariaLabel="Bathrooms" /></div>
          <div><label className={label}>Balconies</label><Select value={form.balconies} onChange={(v) => set('balconies', v)} options={balconyOptions} placeholder="Balconies" ariaLabel="Balconies" /></div>
        </div>
      )}
      {home && (
        <div><label htmlFor="pob-builtUp" className={label}>Built-up Area (sq.ft)</label><input id="pob-builtUp" inputMode="numeric" value={form.builtUp} onChange={numInput('builtUp')} placeholder="e.g. 1000" className={fld} /></div>
      )}
      {house && (
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="pob-plotArea" className={label}>Plot Area (sq.ft)</label><input id="pob-plotArea" inputMode="numeric" value={form.plotArea} onChange={numInput('plotArea')} placeholder="e.g. 1200" className={fld} /></div>
          <div><label htmlFor="pob-floorsInHouse" className={label}>Floors in Building</label><input id="pob-floorsInHouse" inputMode="numeric" value={form.floorsInHouse} onChange={numInput('floorsInHouse')} placeholder="e.g. 2" className={fld} /></div>
        </div>
      )}

      {!land && (
        <>
          <div className="grid grid-cols-2 gap-3"><div><label className={label}>Floor</label><Select value={form.floor} onChange={(v) => set('floor', v)} options={floorOptions} placeholder="Floor" ariaLabel="Floor" /></div><div><label className={label}>Total Floors</label><Select value={form.totalFloors} onChange={(v) => set('totalFloors', v)} options={totalFloorsOptions} placeholder="Total" ariaLabel="Total floors" /></div></div>
          <div className="grid grid-cols-2 gap-3"><div><label className={label}>Facing</label><Select value={form.facing} onChange={(v) => set('facing', v)} options={facingOptions} placeholder="Facing" ariaLabel="Facing" /></div><div><label className={label}>Age</label><Select value={form.age} onChange={(v) => set('age', v)} options={ageOptions} placeholder="Property age" ariaLabel="Property age" /></div></div>
          <div><label className={label}>Furnishing</label><Select value={form.furnishing} onChange={(v) => set('furnishing', v)} options={furnishingOptions} ariaLabel="Furnishing" /></div>
        </>
      )}
      {showFurniture && furnitureOptions.length > 0 && (
        <div><label className={label}>Furniture Included</label><MultiSelect values={form.furniture || []} onChange={(arr) => set('furniture', arr)} options={furnitureOptions} placeholder="Select furniture" ariaLabel="Furniture included" /></div>
      )}

      {commercial && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Shell Type</label><Select value={form.shellType} onChange={(v) => set('shellType', v)} options={shellTypeOptions} placeholder="Shell type" ariaLabel="Shell type" /></div>
            <div><label className={label}>Washrooms</label><Select value={form.washrooms} onChange={(v) => set('washrooms', v)} options={washroomOptions} placeholder="Washrooms" ariaLabel="Washrooms" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="pob-parking" className={label}>Parking Spaces</label><input id="pob-parking" inputMode="numeric" value={form.parkingSpaces} onChange={numInput('parkingSpaces')} placeholder="e.g. 4" className={fld} /></div>
            <div><label htmlFor="pob-cam" className={label}>CAM Charges (/sq.ft)</label><input id="pob-cam" inputMode="numeric" value={form.camCharges} onChange={numInput('camCharges')} placeholder="e.g. 12" className={fld} /></div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <CheckboxRow checked={form.powerBackup} onChange={(v) => set('powerBackup', v)}>Power Backup</CheckboxRow>
            <CheckboxRow checked={form.pantry} onChange={(v) => set('pantry', v)}>Pantry</CheckboxRow>
          </div>
          <div><label className={label}>Suitable For</label><MultiSelect values={form.suitableFor || []} onChange={(arr) => set('suitableFor', arr)} options={suitableForOptions} placeholder="Select uses" ariaLabel="Suitable for" /></div>
        </>
      )}

      {land && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="pob-plotLength" className={label}>Plot Length (ft)</label><input id="pob-plotLength" inputMode="numeric" value={form.plotLength} onChange={numInput('plotLength')} placeholder="e.g. 40" className={fld} /></div>
            <div><label htmlFor="pob-plotWidth" className={label}>Plot Width (ft)</label><input id="pob-plotWidth" inputMode="numeric" value={form.plotWidth} onChange={numInput('plotWidth')} placeholder="e.g. 30" className={fld} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Open Sides</label><Select value={form.openSides} onChange={(v) => set('openSides', v)} options={openSidesOptions} placeholder="Open sides" ariaLabel="Open sides" /></div>
            <div><label htmlFor="pob-roadWidth" className={label}>Road Width (ft)</label><input id="pob-roadWidth" inputMode="numeric" value={form.roadWidth} onChange={numInput('roadWidth')} placeholder="e.g. 20" className={fld} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Zone</label><Select value={form.plotZone} onChange={(v) => set('plotZone', v)} options={plotZoneOptions} placeholder="Zone" ariaLabel="Zone" /></div>
            <div><label className={label}>Water Source</label><Select value={form.waterSource} onChange={(v) => set('waterSource', v)} options={waterSourceOptions} placeholder="Water source" ariaLabel="Water source" /></div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <CheckboxRow checked={form.cornerPlot} onChange={(v) => set('cornerPlot', v)}>Corner Plot</CheckboxRow>
            <CheckboxRow checked={form.boundaryWall} onChange={(v) => set('boundaryWall', v)}>Boundary Wall</CheckboxRow>
            <CheckboxRow checked={form.naSanctioned} onChange={(v) => set('naSanctioned', v)}>NA Sanctioned</CheckboxRow>
            <CheckboxRow checked={form.electricity} onChange={(v) => set('electricity', v)}>Electricity</CheckboxRow>
            <CheckboxRow checked={form.roadAccess} onChange={(v) => set('roadAccess', v)}>Road Access</CheckboxRow>
            <CheckboxRow checked={form.satbara} onChange={(v) => set('satbara', v)}>7/12 Available</CheckboxRow>
          </div>
        </>
      )}

      {amenityOptions.length > 0 && (
        <div><label className={label}>Amenities</label><MultiSelect values={form.amenities || []} onChange={(arr) => set('amenities', arr)} options={amenityOptions} placeholder="Select amenities" ariaLabel="Amenities" /></div>
      )}
    </div>
  );
}

export function LocationStep({ form, set, errors }) {
  return (
    <div className="space-y-5">
      <div><label className={label}>Locality *</label><LocalitySelect value={form.locality} onChange={(v) => set('locality', v)} options={localities} placeholder="Select locality" ariaLabel="Locality" invalid={!!errors.locality} /><FieldError show={!!errors.locality}>Select a locality.</FieldError></div>
      <div><label htmlFor="pob-society" className={label}>Society / Building Name</label><input id="pob-society" value={form.society} onChange={(e) => set('society', e.target.value)} placeholder="e.g. Blue Ridge Township" className={fld} /></div>
      <div><label htmlFor="pob-address" className={label}>Full Address</label><textarea id="pob-address" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Flat no, wing, street..." rows={2} className={fld} /></div>
      <div><label htmlFor="pob-landmark" className={label}>Landmark</label><input id="pob-landmark" value={form.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder="Near..." className={fld} /></div>
    </div>
  );
}

export function PricingStep({ form, set, errors }) {
  const land = isLandType(form.propertyType);
  const pg = form.propertyType === 'pg';
  const residentialHome = !!form.propertyType && !NONRES_TYPES.includes(form.propertyType) && !pg;
  const money = (field) => ({ value: formatIndian(form[field]), onChange: (e) => set(field, e.target.value.replace(/\D/g, '')) });
  const setDepositMonths = (months) => {
    const rent = parseAmount(form.price);
    if (rent > 0) set('deposit', String(rent * months));
  };

  return (
    <div className="space-y-5">
      <div><label htmlFor="pob-price" className={label}>{form.deal === 'rent' ? 'Monthly Rent' : 'Expected Price'} *</label><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</span><input id="pob-price" inputMode="numeric" {...money('price')} placeholder={form.deal === 'rent' ? 'e.g. 25,000' : 'e.g. 85,00,000'} className={classNames(fld, 'pl-10', errors.price && errCls)} /></div>{errors.price ? <FieldError show>Enter the {form.deal === 'rent' ? 'monthly rent' : 'expected price'}.</FieldError> : moneyWords(form.price) && <p className="text-xs text-gray-400 mt-1.5 ml-1">{moneyWords(form.price)}</p>}</div>
      {form.deal === 'rent' && (
        <div><label htmlFor="pob-deposit" className={label}>Security Deposit</label><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</span><input id="pob-deposit" inputMode="numeric" {...money('deposit')} placeholder="e.g. 50,000" className={classNames(fld, 'pl-10')} /></div>{moneyWords(form.deposit) && <p className="text-xs text-gray-400 mt-1.5 ml-1">{moneyWords(form.deposit)}</p>}<div className="flex flex-wrap gap-2 mt-2">{[1, 2, 3].map((m) => <button key={m} type="button" onClick={() => setDepositMonths(m)} className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-gray-400 hover:border-teal-400/40 hover:text-teal-300 transition-all">{m} month{m > 1 ? 's' : ''} rent</button>)}</div></div>
      )}
      <div><label htmlFor="pob-maintenance" className={label}>Monthly Maintenance</label><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</span><input id="pob-maintenance" inputMode="numeric" {...money('maintenance')} placeholder="e.g. 3,000" className={classNames(fld, 'pl-10')} /></div>{moneyWords(form.maintenance) && <p className="text-xs text-gray-400 mt-1.5 ml-1">{moneyWords(form.maintenance)}</p>}</div>
      <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={form.priceNegotiable} onChange={(e) => set('priceNegotiable', e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-white/5 text-teal-500 focus:ring-teal-400/30" /><span className="text-sm text-gray-300">Price is negotiable</span></label>

      {/* Buy-only sale terms — kept in sync with the consumer "Post a property" flow. */}
      {form.deal === 'buy' && !land && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Sale Type</label><Select value={form.transactionType} onChange={(v) => set('transactionType', v)} options={transactionTypeOptions} placeholder="Sale type" ariaLabel="Sale type" /></div>
            <div><label className={label}>Possession</label><Select value={form.possession} onChange={(v) => set('possession', v)} options={possessionOptions} ariaLabel="Possession status" /></div>
          </div>
          {form.possession === 'available' && (
            <div><label className={label}>Available From</label><DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} ariaLabel="Available from date" className={fld} /></div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Ownership</label><Select value={form.ownership} onChange={(v) => set('ownership', v)} options={ownershipOptions} placeholder="Ownership" ariaLabel="Ownership" /></div>
            <div><label htmlFor="pob-rera" className={label}>RERA ID</label><input id="pob-rera" value={form.reraId} onChange={(e) => set('reraId', e.target.value)} placeholder="e.g. P52100012345" className={fld} /></div>
          </div>
          {residentialHome && <CheckboxRow checked={form.loanAvailable} onChange={(v) => set('loanAvailable', v)}>Home loan available (bank-approved)</CheckboxRow>}
        </>
      )}

      {/* Rent-only terms — mirrors the consumer flow so both stay in sync. */}
      {form.deal === 'rent' && (
        <div><label className={label}>Available From</label><DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} ariaLabel="Available from date" className={fld} /></div>
      )}
      {form.deal === 'rent' && pg && (
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>PG is for</label><Select value={form.pgGender} onChange={(v) => set('pgGender', v)} options={pgGenderOptions} ariaLabel="PG is for" /></div>
          <div><label className={label}>Meals</label><Select value={form.pgMeals} onChange={(v) => set('pgMeals', v)} options={pgMealsOptions} ariaLabel="Meals" /></div>
        </div>
      )}
      {form.deal === 'rent' && residentialHome && (
        <div><label className={label}>Preferred Tenants</label><MultiSelect values={form.preferredTenants || []} onChange={(arr) => set('preferredTenants', arr)} options={preferredTenantsOptions} placeholder="Select tenants" ariaLabel="Preferred tenants" /></div>
      )}
      {form.deal === 'rent' && !land && (
        <div className="grid grid-cols-3 gap-3">
          <div><label className={label}>Agreement</label><Select value={form.agreementDuration} onChange={(v) => set('agreementDuration', v)} options={agreementOptions} ariaLabel="Agreement duration" /></div>
          <div><label className={label}>Lock-in</label><Select value={form.lockIn} onChange={(v) => set('lockIn', v)} options={lockinOptions} ariaLabel="Lock-in period" /></div>
          <div><label className={label}>Notice</label><Select value={form.noticePeriod} onChange={(v) => set('noticePeriod', v)} options={noticeOptions} ariaLabel="Notice period" /></div>
        </div>
      )}

      <div><label htmlFor="pob-description" className={label}>Description (optional)</label><textarea id="pob-description" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Brief description of the property..." rows={4} className={fld} /></div>
    </div>
  );
}

export function PhotosStep({ form, set }) {
  const handlePhotoAdd = () => {
    const placeholders = [
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=600&q=80',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=600&q=80',
      'https://images.unsplash.com/photo-1600573472550-8090b5e0745e?w=600&q=80',
      'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=600&q=80',
    ];
    const next = placeholders[form.photos.length % placeholders.length];
    set('photos', [...form.photos, next]);
  };
  const removePhoto = (idx) => set('photos', form.photos.filter((_, i) => i !== idx));

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">Add photos received from the owner (optional). The owner can also upload directly from their claim link.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {form.photos.map((url, i) => (
          <div key={i} className="relative group rounded-xl overflow-hidden border border-white/10 aspect-[4/3]">
            <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
            <button onClick={() => removePhoto(i)} className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/70 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition text-xs">&times;</button>
          </div>
        ))}
        <button onClick={handlePhotoAdd} className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 aspect-[4/3] hover:border-teal-400/40 hover:bg-teal-400/5 transition cursor-pointer">
          <ImagePlus className="h-6 w-6 text-gray-500" /><span className="text-xs text-gray-400">Add Photo</span>
        </button>
      </div>
      {form.photos.length === 0 && <p className="text-xs text-amber-300/80">No photos yet — owner will be asked to upload from their end.</p>}
    </div>
  );
}

export function ReviewStep({ form }) {
  const land = isLandType(form.propertyType);
  const home = !!form.propertyType && !land && form.propertyType !== 'commercial' && form.propertyType !== 'pg';
  return (
    <div className="space-y-5">
      <h3 className="text-lg font-semibold mb-1">Review & Send to Owner</h3>
      <p className="text-sm text-gray-400 mb-4">Verify the details below. The owner will complete remaining steps (photos & Aadhaar verification).</p>
      <div className="space-y-3">
        <ReviewRow label="Owner" value={`${form.ownerName} \u2022 +91 ${form.ownerMobile}`} />
        <ReviewRow label="Type" value={`${form.deal === 'rent' ? 'For Rent' : 'For Sale'} \u2022 ${typeOptions.find((o) => o.value === form.propertyType)?.label || '-'}`} />
        {form.propertyType === 'pg' && <ReviewRow label="Config" value={`${(form.sharing || []).map((s) => pgSharingOptions.find((o) => o.value === s)?.label).filter(Boolean).join(', ') || 'Sharing'} \u2022 ${form.carpetArea} sq.ft`} />}
        {form.propertyType !== 'pg' && form.bhk && <ReviewRow label="Config" value={`${form.bhk} BHK \u2022 ${form.carpetArea} sq.ft`} />}
        {form.propertyType !== 'pg' && !form.bhk && <ReviewRow label={land ? 'Plot Area' : 'Area'} value={`${form.carpetArea} sq.ft`} />}
        {home && form.bathrooms && <ReviewRow label="Bath" value={`${form.bathrooms} Bathroom${form.bathrooms === '1' ? '' : 's'}`} />}
        {!land && form.furnishing && <ReviewRow label="Furnishing" value={furnLabel(form.furnishing)} />}
        <ReviewRow label="Location" value={[form.society, form.locality, form.landmark].filter(Boolean).join(', ') || '-'} />
        <ReviewRow label="Price" value={`₹${formatIndian(form.price)}${form.deal === 'rent' ? '/mo' : ''} ${form.priceNegotiable ? '(Negotiable)' : ''}`} />
        {form.deal === 'rent' && form.deposit && <ReviewRow label="Deposit" value={`₹${formatIndian(form.deposit)}`} />}
        {form.maintenance && <ReviewRow label="Maintenance" value={`₹${formatIndian(form.maintenance)}/mo`} />}
        {form.deal === 'buy' && !land && (form.transactionType || form.possession) && <ReviewRow label="Sale" value={[optLabel(transactionTypeOptions, form.transactionType), optLabel(possessionOptions, form.possession)].filter(Boolean).join(' \u2022 ')} />}
        {form.deal === 'rent' && form.propertyType !== 'pg' && form.preferredTenants?.length > 0 && <ReviewRow label="Tenants" value={form.preferredTenants.map((v) => optLabel(preferredTenantsOptions, v)).join(', ')} />}
        {form.deal === 'rent' && form.availableFrom && <ReviewRow label="Available" value={form.availableFrom} />}
        {form.amenities?.length > 0 && <ReviewRow label="Amenities" value={form.amenities.join(', ')} />}
        <ReviewRow label="Photos" value={`${form.photos.length} photo${form.photos.length === 1 ? '' : 's'} added`} />
        {form.description && <ReviewRow label="Description" value={form.description} />}
      </div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200 mt-6">
        <strong>What happens next:</strong> The listing will be saved as pending. An SMS with a claim link will be sent to the owner. Once they upload photos & verify Aadhaar, it will appear in your <span className="font-medium text-amber-100">Properties → Pending Verification</span> queue for final approval.
      </div>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex gap-4 rounded-lg bg-white/[0.03] px-4 py-2.5">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-200">{value}</span>
    </div>
  );
}

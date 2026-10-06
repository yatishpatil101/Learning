import { useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { classNames, parseAmount } from '../../../lib/format.js';
import { todayIso } from '../../../lib/visitWhen.js';
import Select from '../../../components/ui/Select.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import SocietySelect from '../../consumer/list-property/SocietySelect.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import {
  localities, floorOptions, totalFloorsOptions,
  typeOptions, commercialSubtypeOptions, commercialLabelOf, NONRES_TYPES, isLandType,
  bhkOptions, furnishingOptions, shellTypeOptions,
  naStatusOptions, otherRightsOptions, buyerEligibilityOptions,
  possessionOptions, fld, label, errCls, DEPOSIT_MONTHS,
} from './constants.js';

const optLabel = (opts, v) => opts.find((o) => o.value === v)?.label || v;

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

const WIDE = 'grid-cols-1 sm:grid-cols-2';

/* Short option sets as one-tap boxes instead of a dropdown, so the desk can file a call quickly.
   Re-tapping the chosen box is a no-op: a repeat `propertyType` would cascade-reset its answers. */
function ChoiceBoxes({ value, onChange, options, ariaLabel, invalid = false, cols = 'grid-cols-2 sm:grid-cols-3' }) {
  return (
    <div role="group" aria-label={ariaLabel} className={classNames('grid gap-2', cols)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => { if (!on) onChange(o.value); }}
            className={classNames('min-h-11 rounded-xl border px-3 py-2 text-sm font-medium leading-tight transition',
              on ? 'border-teal-400/60 bg-teal-500/15 text-teal-200'
                : invalid ? 'border-red-400/60 bg-white/5 text-gray-300 hover:text-white'
                  : 'border-white/10 bg-white/5 text-gray-300 hover:border-teal-400/40 hover:text-white')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function OwnerStep({ form, set, errors, standing }) {
  const mobileValid = /^[6-9]\d{9}$/.test(form.ownerMobile);
  /* The tally arrives as a prop from one read of the pending queue when the wizard opens. Defaulted
     so the step still renders if it is mounted without one. */
  const dupCount = mobileValid ? (standing?.pending || 0) : 0;
  /* Shown, never enforced: the desk is exempt from the owner's plan ceiling, so this is information
     for the call and reads as a sales prompt rather than a warning. */
  const overage = standing?.known && standing.overAllowance ? standing : null;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
        <strong>Concierge Mode:</strong> Take only the key facts on the call. The owner signs in with this mobile number, confirms the listing is theirs, and adds the rest and photos.
      </div>
      <div><label htmlFor="pob-ownerName" className={label}>Owner Name *</label><input id="pob-ownerName" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} placeholder="Full name of the property owner" className={classNames(fld, errors.ownerName && errCls)} /><FieldError show={!!errors.ownerName}>Owner name is required.</FieldError></div>
      <div><label htmlFor="pob-ownerMobile" className={label}>Owner Mobile *</label><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">+91</span><input id="pob-ownerMobile" inputMode="numeric" value={form.ownerMobile} onChange={(e) => set('ownerMobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" className={classNames(fld, 'pl-12', errors.ownerMobile && errCls)} /></div><FieldError show={!!errors.ownerMobile}>Valid 10-digit mobile required.</FieldError>
        {dupCount > 0 && <p className="mt-1.5 text-xs text-amber-300/90">⚠ This owner already has {dupCount} pending listing{dupCount > 1 ? 's' : ''}. You can still continue if this is a different property.</p>}
        {overage && <p data-testid="pob-plan-overage" className="mt-1.5 text-xs text-sky-300/90">This owner is over their plan — {overage.held} live listing{overage.held > 1 ? 's' : ''} on a plan that includes {overage.allowance}. You can still post; worth mentioning an upgrade on the call.</p>}
      </div>
      <div><label htmlFor="pob-ownerNotes" className={label}>Internal Notes (optional)</label><textarea id="pob-ownerNotes" value={form.ownerNotes} maxLength={4000} onChange={(e) => set('ownerNotes', e.target.value)} placeholder="e.g. Owner contacted via WhatsApp, photos sent on chat..." rows={3} className={fld} /></div>
    </div>
  );
}

export function PropertyStep({ form, set, errors }) {
  const t = form.propertyType;
  const land = isLandType(t);
  const commercial = t === 'commercial';
  const home = !!t && !land && !commercial;
  return (
    <div className="space-y-5">
      <div><label className={label}>Property Type *</label><ChoiceBoxes value={form.propertyType} onChange={(v) => set('propertyType', v)} options={typeOptions} ariaLabel="Property type" invalid={!!errors.propertyType} /><FieldError show={!!errors.propertyType}>Select a property type.</FieldError></div>
      {commercial && <div><label className={label}>Commercial Type *</label><ChoiceBoxes value={form.commercialType} onChange={(v) => set('commercialType', v)} options={commercialSubtypeOptions(form.commercialType)} ariaLabel="Commercial type" invalid={!!errors.commercialType} /><FieldError show={!!errors.commercialType}>Select the commercial type.</FieldError></div>}
      {!NONRES_TYPES.includes(t) && <div><label className={label}>BHK *</label><ChoiceBoxes value={form.bhk} onChange={(v) => set('bhk', v)} options={bhkOptions} ariaLabel="BHK" invalid={!!errors.bhk} cols="grid-cols-3 sm:grid-cols-5" /><FieldError show={!!errors.bhk}>Select the BHK configuration.</FieldError></div>}
      <div><label htmlFor="pob-carpetArea" className={label}>{land ? 'Plot Area (sq.ft) *' : 'Carpet Area (sq.ft) *'}</label><input id="pob-carpetArea" inputMode="numeric" value={form.carpetArea} onChange={(e) => set('carpetArea', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 850" className={classNames(fld, errors.carpetArea && errCls)} /><FieldError show={!!errors.carpetArea}>{land ? 'Plot area is required.' : 'Carpet area is required.'}</FieldError></div>

      {!land && (
        <div className="grid grid-cols-2 gap-3"><div><label className={label}>Floor</label><Select value={form.floor} onChange={(v) => set('floor', v)} options={floorOptions} placeholder="Floor" ariaLabel="Floor" invalid={!!errors.floor} /><FieldError show={!!errors.floor}>Floor is above the total floors.</FieldError></div><div><label className={label}>Total Floors</label><Select value={form.totalFloors} onChange={(v) => set('totalFloors', v)} options={totalFloorsOptions} placeholder="Total" ariaLabel="Total floors" /></div></div>
      )}
      {home && <div><label className={label}>Furnishing</label><ChoiceBoxes value={form.furnishing} onChange={(v) => set('furnishing', v)} options={furnishingOptions} ariaLabel="Furnishing" cols="grid-cols-3" /></div>}
      {commercial && <div><label className={label}>Shell Type *</label><ChoiceBoxes value={form.shellType} onChange={(v) => set('shellType', v)} options={shellTypeOptions} ariaLabel="Shell type" invalid={!!errors.shellType} cols="grid-cols-3" /><FieldError show={!!errors.shellType}>Select the shell type.</FieldError></div>}

      {land && (
        <>
          <div><label className={label}>NA Status *</label><ChoiceBoxes value={form.naStatus} onChange={(v) => set('naStatus', v)} options={naStatusOptions} ariaLabel="NA status" invalid={!!errors.naStatus} cols={WIDE} /><FieldError show={!!errors.naStatus}>Select the NA status.</FieldError></div>
          <div><label className={label}>Other Rights (7/12) *</label><ChoiceBoxes value={form.otherRights} onChange={(v) => set('otherRights', v)} options={otherRightsOptions} ariaLabel="Other rights" invalid={!!errors.otherRights} cols={WIDE} /><FieldError show={!!errors.otherRights}>Select what the Other Rights column carries.</FieldError></div>
          {form.propertyType === 'farmland' && form.deal === 'buy' && (
            <div><label className={label}>Buyer Eligibility *</label><ChoiceBoxes value={form.buyerEligibility} onChange={(v) => set('buyerEligibility', v)} options={buyerEligibilityOptions} ariaLabel="Buyer eligibility" invalid={!!errors.buyerEligibility} cols={WIDE} /><FieldError show={!!errors.buyerEligibility}>Select who can lawfully buy this land.</FieldError></div>
          )}
        </>
      )}
    </div>
  );
}

export function LocationStep({ form, set, errors }) {
  // Only a residential unit sits inside a society; land and commercial name a project as plain text.
  const residential = !NONRES_TYPES.includes(form.propertyType);
  // A pick binds the listing to the society record (dedup) and its Google pin; typing unbinds both.
  const onSocietyChange = (s) => {
    set('society', s.name || '');
    set('societyId', s.id || '');
    set('lat', s.lat ?? null);
    set('lng', s.lng ?? null);
    set('pincode', s.pincode || '');
  };
  return (
    <div className="space-y-5">
      <div><label className={label}>Locality *</label><LocalitySelect value={form.locality} onChange={(v) => set('locality', v)} options={localities} placeholder="Select locality" ariaLabel="Locality" invalid={!!errors.locality} /><FieldError show={!!errors.locality}>Select a locality.</FieldError></div>
      <div><label htmlFor="pob-society" className={label}>Society / Building Name</label>{residential
        ? <SocietySelect id="pob-society" value={form.societyId} name={form.society} localityLabel={form.locality} lat={form.lat} lng={form.lng} placeholder="Search society or building" inputClassName={fld} onChange={onSocietyChange} />
        : <input id="pob-society" value={form.society} maxLength={60} onChange={(e) => set('society', e.target.value)} placeholder="e.g. Blue Ridge Business Park" className={fld} />}</div>
      <div><label htmlFor="pob-address" className={label}>Full Address</label><textarea id="pob-address" value={form.address} maxLength={300} onChange={(e) => set('address', e.target.value)} placeholder="Flat no, wing, street..." rows={2} className={fld} /></div>
    </div>
  );
}

export function PricingStep({ form, set, errors }) {
  const land = isLandType(form.propertyType);
  const commercial = form.propertyType === 'commercial';
  const rent = form.deal === 'rent';
  const money = (field) => ({ value: formatIndian(form[field]), onChange: (e) => set(field, e.target.value.replace(/\D/g, '')) });
  const setDepositMonths = (months) => {
    const amount = parseAmount(form.price);
    if (amount > 0) set('deposit', String(amount * months));
  };

  return (
    <div className="space-y-5">
      <div><label htmlFor="pob-price" className={label}>{rent ? 'Monthly Rent' : 'Expected Price'} *</label><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</span><input id="pob-price" inputMode="numeric" {...money('price')} placeholder={rent ? 'e.g. 25,000' : 'e.g. 85,00,000'} className={classNames(fld, 'pl-10', errors.price && errCls)} /></div>{errors.price ? <FieldError show>Enter the {rent ? 'monthly rent' : 'expected price'}.</FieldError> : moneyWords(form.price) && <p className="text-xs text-gray-400 mt-1.5 ml-1">{moneyWords(form.price)}</p>}</div>
      {rent && (
        <>
          <div><label htmlFor="pob-deposit" className={label}>Security Deposit</label><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</span><input id="pob-deposit" inputMode="numeric" {...money('deposit')} placeholder="e.g. 50,000" className={classNames(fld, 'pl-10')} /></div>{moneyWords(form.deposit) && <p className="text-xs text-gray-400 mt-1.5 ml-1">{moneyWords(form.deposit)}</p>}<div className="flex flex-wrap gap-2 mt-2">{DEPOSIT_MONTHS[land ? 'land' : commercial ? 'commercial' : 'residential'].map((m) => <button key={m} type="button" onClick={() => setDepositMonths(m)} className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 text-gray-400 hover:border-teal-400/40 hover:text-teal-300 transition-all">{m} month{m > 1 ? 's' : ''} rent</button>)}</div></div>
          <div><label className={label}>Available From</label><DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} min={todayIso()} ariaLabel="Available from date" className={fld} /></div>
        </>
      )}
      {!rent && !land && (
        <>
          <div><label className={label}>Possession</label><ChoiceBoxes value={form.possession} onChange={(v) => set('possession', v)} options={possessionOptions} ariaLabel="Possession status" cols="grid-cols-3" /></div>
          <div><label htmlFor="pob-rera" className={label}>RERA ID</label><input id="pob-rera" value={form.reraId} onChange={(e) => set('reraId', e.target.value)} placeholder="e.g. P52100012345" className={fld} /></div>
          {(form.possession === 'new' || form.possession === 'under') && (
            <div><label className={label}>Available From</label><DateField value={form.availableFrom} onChange={(v) => set('availableFrom', v)} min={todayIso()} ariaLabel="Available from date" className={fld} /></div>
          )}
        </>
      )}
    </div>
  );
}

export function PhotosStep({ form, set }) {
  const [photoUrl, setPhotoUrl] = useState('');
  const handlePhotoAdd = () => {
    const next = photoUrl.trim();
    if (!next) return;
    set('photos', [...form.photos, next]);
    setPhotoUrl('');
  };
  const removePhoto = (idx) => set('photos', form.photos.filter((_, i) => i !== idx));

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">Add photos received from the owner (optional). The owner can also upload directly from their claim link.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {form.photos.map((url, i) => (
          <div key={i} className="relative group rounded-xl overflow-hidden border border-white/10 aspect-[4/3]">
            <img src={url} alt={`Owner upload ${i + 1}`} className="w-full h-full object-cover" />
            <button onClick={() => removePhoto(i)} className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/70 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition text-xs">&times;</button>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="Paste owner-provided photo URL" className={classNames(fld, 'flex-1')} />
        <button type="button" onClick={handlePhotoAdd} className="dz-btn dz-btn-ghost justify-center">
          <ImagePlus className="h-4 w-4" /> Add photo URL
        </button>
      </div>
      {form.photos.length === 0 && <p className="text-xs text-amber-300/80">No photos yet — owner will be asked to upload from their end.</p>}
    </div>
  );
}

export function ReviewStep({ form }) {
  const land = isLandType(form.propertyType);
  const commercial = form.propertyType === 'commercial';
  const home = !!form.propertyType && !land && !commercial;
  const rent = form.deal === 'rent';
  return (
    <div className="space-y-5">
      <h3 className="text-lg font-semibold mb-1">Review & Send to Owner</h3>
      <p className="text-sm text-gray-400 mb-4">Check the key facts. The owner adds the remaining details and photos.</p>
      <div className="space-y-3">
        <ReviewRow label="Owner" value={`${form.ownerName} \u2022 +91 ${form.ownerMobile}`} />
        <ReviewRow label="Type" value={`${rent ? 'For Rent' : 'For Sale'} \u2022 ${commercial ? commercialLabelOf(form.commercialType) || 'Commercial' : typeOptions.find((o) => o.value === form.propertyType)?.label || '-'}`} />
        {form.bhk && <ReviewRow label="Config" value={`${form.bhk} BHK \u2022 ${form.carpetArea} sq.ft`} />}
        {!form.bhk && <ReviewRow label={land ? 'Plot Area' : 'Area'} value={`${form.carpetArea} sq.ft`} />}
        {!land && (form.floor || form.totalFloors) && <ReviewRow label="Floor" value={[form.floor, form.totalFloors && `of ${form.totalFloors}`].filter(Boolean).join(' ')} />}
        {home && <ReviewRow label="Furnishing" value={optLabel(furnishingOptions, form.furnishing)} />}
        {commercial && <ReviewRow label="Shell" value={optLabel(shellTypeOptions, form.shellType) || '-'} />}
        {land && <ReviewRow label="Legal" value={[optLabel(naStatusOptions, form.naStatus), optLabel(otherRightsOptions, form.otherRights), form.propertyType === 'farmland' && !rent && optLabel(buyerEligibilityOptions, form.buyerEligibility)].filter(Boolean).join(' \u2022 ')} />}
        <ReviewRow label="Location" value={[form.society, form.locality].filter(Boolean).join(', ') || '-'} />
        {form.address && <ReviewRow label="Address" value={form.address} />}
        <ReviewRow label="Price" value={`₹${formatIndian(form.price)}${rent ? '/mo' : ''}`} />
        {rent && form.deposit && <ReviewRow label="Deposit" value={`₹${formatIndian(form.deposit)}`} />}
        {!rent && !land && form.possession && <ReviewRow label="Possession" value={optLabel(possessionOptions, form.possession)} />}
        {!rent && !land && form.reraId && <ReviewRow label="RERA" value={form.reraId} />}
        {form.availableFrom && (rent || (!land && (form.possession === 'new' || form.possession === 'under'))) && <ReviewRow label="Available" value={form.availableFrom} />}
        <ReviewRow label="Photos" value={`${form.photos.length} photo${form.photos.length === 1 ? '' : 's'} added`} />
      </div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200 mt-6">
        <strong>What happens next:</strong> The listing is saved as pending under the owner&apos;s mobile. Send them the claim link on WhatsApp from <span className="font-medium text-amber-100">Properties → Staff Posted</span>. It can go live only after they confirm it&apos;s their property.
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

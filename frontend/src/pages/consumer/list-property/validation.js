import {
  isResidentialType, isCommercialType, isLandType, commercialProfileFromType,
  keyPhotoCategoriesFor, MIN_PUBLISH_PHOTOS, MIN_PUBLISH_KEY_CATEGORIES, areaRangeFor,
} from './constants.js';
import { MAX_PHOTOS } from '../../../lib/uploads/policy.js';
import { ADDRESS_PARTS } from '../../../lib/listingFormDetails.js';

/* A required value only counts once it survives trimming — a field full of
   spaces is as empty as a blank one. */
const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
/* A required amount must be a real, positive number, so "0", "-5" and pasted
   junk are all rejected even though a non-empty string is truthy. */
const isPositive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0; };
/* Deposit is the one money field where zero is a real answer — a zero-deposit rental is a genuine
   offer and refusing it would force the owner to lie. It still has to be a number. */
const isNonNegative = (v) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= 0; };
/* Areas are positive but bounded. Land is bounded per unit: the sq.ft. window rejects a half-acre farm
   quoted as `0.5 acre` and accepts one the size of a district. */
const inRange = (v, [min, max]) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max; };

const isMissing = (value) => value == null || value === '';
/* A tower has floors worth asking about; a plot, a villa and a farm do not. Commercial is not a
   tower type either: a godown, a factory shed and a standalone showroom have no floor to state. */
const isTowered = (form) => form.propertyType === 'flat';
/* An industrial address is a plot number in an estate: MIDC parcels carry no flat number and belong to no
   society. Exported because `LocationStep` drops the asterisk on exactly this rule. */
export const isIndustrial = (form) => isCommercialType(form.propertyType)
  && commercialProfileFromType(form.commercialType) === 'industrial';
/* MahaRERA requires a number only for a launch or unfinished build. Land is excluded: a plot keeps the
   stale `construction` a flat left behind, which would demand a date through inputs it never renders. */
const isPreCompletion = (form) => !isLandType(form.propertyType)
  && (form.construction === 'new' || form.construction === 'under');
const sameListingKind = (form, original) => !!original
  && form.deal === original.deal && form.propertyType === original.propertyType
  && form.commercialType === original.commercialType;

/* The error key is the `data-err` hook the page scrolls to, not always the field the rule reads:
   possession is answered through `construction`, and comparing the wrong field re-demands an answer. */
const FIELD_OF = { possession: 'construction' };

// Missing legacy answers are not invented; clearing or changing a saved answer still validates.
const keepChangedErrors = (errors, form, original) => {
  if (!sameListingKind(form, original)) return errors;
  return Object.fromEntries(Object.entries(errors).filter(([key]) => {
    const field = FIELD_OF[key] ?? key;
    return !isMissing(original[field]) || !Object.is(form[field], original[field])
      || (key === 'availableFrom' && form.construction !== original.construction);
  }));
};

export const scrollToError = (err) => {
  const first = Object.keys(err)[0];
  if (!first) return;
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-err="${first}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Custom selects expose a button trigger rather than a native select. Duplicated by the
      // field-error helper in `lib/hooks.js`, and the two must not drift.
      const FOCUSABLE = 'input,select,textarea,button,[tabindex]';
      const f = el.matches(FOCUSABLE) ? el : el.querySelector(FOCUSABLE);
      f?.focus?.({ preventScroll: true });
    }
  });
};

export const validateStep1 = (form, original) => {
  const err = {};
  const commercial = isCommercialType(form.propertyType);
  const residential = isResidentialType(form.propertyType);
  if (!form.propertyType) err.propertyType = true;
  if (commercial && !form.commercialType) err.commercialType = true;
  /* Fit-out sets the rent and is the first filter every commercial enquiry applies, so a listing
     that leaves it blank is answered by a guess on the detail page rather than by its owner. */
  if (commercial && !hasText(form.shellType)) err.shellType = true;
  if (residential && !form.bhk) err.bhk = true;
  if (residential && !form.bathrooms) err.bathrooms = true;
  // Area is the one hard number every listing needs — must be a sane positive size for its unit.
  if (!inRange(form.carpetArea, areaRangeFor(form.propertyType, form.areaUnit))) err.carpetArea = true;
/* The three answers a Maharashtra land buyer cannot proceed without. Each list offers an honest "not
   checked", so this asks for a statement rather than a title search; legacy listings are exempt. */
  if (isLandType(form.propertyType)) {
    if (!hasText(form.naStatus)) err.naStatus = true;
    if (!hasText(form.otherRights)) err.otherRights = true;
    if (form.propertyType === 'farmland' && form.deal === 'buy' && !hasText(form.buyerEligibility)) {
      err.buyerEligibility = true;
    }
  }
/* A null floor is excluded, not unfiltered: `PropertySpecs` compares with `ge`/`le`. "Ground" is an
   option, so the test is emptiness, never falsiness. */
  if (isTowered(form) && isMissing(form.floor)) err.floor = true;
  if (isTowered(form) && isMissing(form.totalFloors)) err.totalFloors = true;
  return keepChangedErrors(err, form, original);
};
export const validateLocationStep = (form, original) => {
  const err = {};
  const land = isLandType(form.propertyType);
  if (!form.locality) err.locality = true;
  // Indian PIN codes are six digits and never start with 0.
  if (!/^[1-9]\d{5}$/.test(form.pincode)) err.pincode = true;
  const validated = keepChangedErrors(err, form, original);
  /* An edit whose address boxes are untouched keeps the line the server already holds, so a complete
     address is only demanded of an owner who is actually replacing it. */
  const savedLine = hasText(original?.existingAddress);
  const addressUnchanged = savedLine && sameListingKind(form, original)
    && ADDRESS_PARTS.every((key) => Object.is(form[key], original[key]))
    && Object.is(form.societyId, original.societyId);
/* A partial replacement must not reduce the preserved address to a street alone — but only where a unit
   and a project are answerable: a farm sits on a gat number, and an old plot often has no layout name. */
  if (!addressUnchanged && !land && !isIndustrial(form)) {
    if (!hasText(form.flatNumber)) validated.flatNumber = true;
    if (!hasText(form.society)) validated.society = true;
  }
  return validated;
};
export const validatePricingStep = (form, original) => {
  const err = {};
  const land = isLandType(form.propertyType);
  if (form.deal === 'rent') {
    if (!isPositive(form.monthlyRent)) err.monthlyRent = true;
    if (!isNonNegative(form.deposit)) err.deposit = true;
    if (!form.availableFrom) err.availableFrom = true;
  } else {
    if (!isPositive(form.price)) err.price = true;
    // Asked only where it is answered: the possession control is hidden for land.
    if (!land && !form.construction) err.possession = true;
    if (isPreCompletion(form) && !form.availableFrom) err.availableFrom = true;
    if (!form.ownership) err.ownership = true;
    /* Quoting the MahaRERA number is a legal condition of advertising an unfinished Maharashtra
       sale, not a ranking nicety. Resale of a completed home carries no such duty. */
    if (isPreCompletion(form) && !hasText(form.reraId)) err.reraId = true;
  }
  return keepChangedErrors(err, form, original);
};
/* Both bounds live here rather than at submit: a ceiling discovered on the last click sends the owner
   back a step to delete work nobody warned them about. */
export const validateStep3 = (form, documents, photos, original) => {
  const list = photos || [];
/* A claimed NA order changes what the parcel may be used for, so it is evidenced rather than asserted.
   Deemed NA arises by operation of s.42B/42C — there is no order to produce. */
  const claimIsNew = !original || original.form?.naStatus !== form.naStatus;
  const err = claimIsNew && form.naStatus === 'sanctioned' && isLandType(form.propertyType) && !documents['NA Order']
    ? { 'NA Order': 'naOrder' }
    : {};
  if (list.length > MAX_PHOTOS) return { ...err, photos: 'max' };
  /* Never demand more of an edit than the listing already carries: the rule arrived after these
     listings were published, and blocking a price correction on a photo shoot is not a fix. */
  const had = original ? (original.images || original.gallery || []).filter(Boolean).length : 0;
  const floor = original ? Math.min(MIN_PUBLISH_PHOTOS, Math.max(had, 1)) : MIN_PUBLISH_PHOTOS;
  if (list.length < floor) return { ...err, photos: 'min' };
/* New posts only: the edit loader cannot recover a stored photo's category and files every one as
   "Other", so asking an editor to prove coverage asks them to re-file work they already did. */
  if (original) return err;
  const keyCats = keyPhotoCategoriesFor(form.propertyType, form.commercialType);
  const covered = new Set(list.map((p) => p.category).filter((c) => keyCats.includes(c)));
  return covered.size < Math.min(MIN_PUBLISH_KEY_CATEGORIES, keyCats.length) ? { ...err, photos: 'categories' } : err;
};

// Room listings must not inherit whole-property ownership or pricing requirements.
export const validateFlatmateStep1 = (form) => {
  const err = {};
  if (!form.bhk) err.bhk = true;
  if (!form.roomType) err.roomType = true;
  return err;
};
export const validateFlatmateStep2 = (form) => {
  const err = {};
  if (!form.locality) err.locality = true;
  if (!hasText(form.society)) err.society = true;
  if (!form.pinPlaced) err.location = true;
  if (!isPositive(form.rentShare)) err.rentShare = true;
  if (!form.availableFrom) err.availableFrom = true;
  return err;
};

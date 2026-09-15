import { isResidentialType, isCommercialType, isLandType } from './constants.js';
import { ADDRESS_PARTS, hasStoredAddress } from '../../../lib/listingFormDetails.js';

/* A required value only counts once it survives trimming — a field full of
   spaces is as empty as a blank one. */
const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
/* A required amount must be a real, positive number, so "0", "-5" and pasted
   junk are all rejected even though a non-empty string is truthy. */
const isPositive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0; };
/* Areas are positive but bounded — nobody lists a 9,999,999 sq.ft. flat. */
const inRange = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max; };

const isMissing = (value) => value == null || value === '';
const sameListingKind = (form, original) => !!original
  && form.deal === original.deal && form.propertyType === original.propertyType
  && form.commercialType === original.commercialType;

// Missing legacy answers are not invented; clearing or changing a saved answer still validates.
const keepChangedErrors = (errors, form, original) => {
  if (!sameListingKind(form, original)) return errors;
  return Object.fromEntries(Object.entries(errors).filter(([key]) =>
    !isMissing(original[key]) || !Object.is(form[key], original[key])
    || (key === 'availableFrom' && form.possession !== original.possession)));
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
  if (!form.propertyType) err.propertyType = true;
  if (isCommercialType(form.propertyType) && !form.commercialType) err.commercialType = true;
  if (isResidentialType(form.propertyType) && !form.bhk) err.bhk = true;
  if (isResidentialType(form.propertyType) && !form.bathrooms) err.bathrooms = true;
  // Area is the one hard number every listing needs — must be a sane positive size.
  if (!inRange(form.carpetArea, 1, 1000000)) err.carpetArea = true;
  return keepChangedErrors(err, form, original);
};
export const validateStep2 = (form, original) => {
  const err = {};
  const land = isLandType(form.propertyType);
  if (!form.locality) err.locality = true;
  // Indian PIN codes are six digits and never start with 0.
  if (!/^[1-9]\d{5}$/.test(form.pincode)) err.pincode = true;
  if (form.deal === 'rent') {
    if (!isPositive(form.monthlyRent)) err.monthlyRent = true;
    if (!form.deposit) err.deposit = true;
    if (!form.availableFrom) err.availableFrom = true;
  } else {
    if (!isPositive(form.price)) err.price = true;
    if (!form.possession) err.possession = true;
    if (form.possession === 'available' && !form.availableFrom) err.availableFrom = true;
    if (!form.ownership) err.ownership = true;
  }
  const validated = keepChangedErrors(err, form, original);
  /* An edit whose address boxes are untouched keeps the line the server already holds, so a complete
     address is only demanded of an owner who is actually replacing it. Land is asked for a project
     name only when that line could not be decomposed into the boxes, since replacing it by hand is
     the one case where the boxes alone have to carry the whole address. */
  const savedLine = hasText(original?.existingAddress);
  const undecomposed = hasStoredAddress(original ?? {});
  const addressUnchanged = savedLine && sameListingKind(form, original)
    && ADDRESS_PARTS.every((key) => Object.is(form[key], original[key]))
    && Object.is(form.societyId, original.societyId);
  // A partial replacement must never turn the preserved address into a street or tower alone.
  if (!addressUnchanged) {
    if (!land && !hasText(form.flatNumber)) validated.flatNumber = true;
    if ((!land || undecomposed) && !hasText(form.society)) validated.society = true;
  }
  return validated;
};
// Photos make listings usable; optional ownership documents earn a verification badge.
export const validateStep3 = (form, documents, photos) => {
  const err = {};
  if (!photos || !photos.length) err.photos = true;
  return err;
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
  if (!isPositive(form.rentShare)) err.rentShare = true;
  if (!form.availableFrom) err.availableFrom = true;
  return err;
};

import { isResidentialType, isCommercialType, isLandType, isPgType } from './constants.js';

/* A required value only counts once it survives trimming — a field full of
   spaces is as empty as a blank one. */
const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
/* A required amount must be a real, positive number, so "0", "-5" and pasted
   junk are all rejected even though a non-empty string is truthy. */
const isPositive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0; };
/* Areas are positive but bounded — nobody lists a 9,999,999 sq.ft. flat. */
const inRange = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max; };

export const scrollToError = (err) => {
  const first = Object.keys(err)[0];
  if (!first) return;
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-err="${first}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      /* Custom Select/MultiSelect render their trigger as a <button>, and the very
         first field of step 1 (propertyType) is one — so a selector limited to
         input/select/textarea scrolled to the field but left focus on the Next
         button the user had just pressed. `button,[tabindex]` matches the shared
         useFieldErrors helper in lib/hooks.js; the two must not drift again. */
      const FOCUSABLE = 'input,select,textarea,button,[tabindex]';
      const f = el.matches(FOCUSABLE) ? el : el.querySelector(FOCUSABLE);
      f?.focus?.({ preventScroll: true });
    }
  });
};

export const validateStep1 = (form) => {
  const err = {};
  if (!form.propertyType) err.propertyType = true;
  if (isCommercialType(form.propertyType) && !form.commercialType) err.commercialType = true;
  const pg = isPgType(form.propertyType);
  // PG / Hostel is defined by its Sharing (occupancy) — at least one type offered.
  if (pg && !(form.sharing && form.sharing.length)) err.sharing = true;
  if (isResidentialType(form.propertyType) && !pg && !form.bhk) err.bhk = true;
  if (isResidentialType(form.propertyType) && !pg && !form.bathrooms) err.bathrooms = true;
  // Area is the one hard number every listing needs — must be a sane positive size.
  if (!inRange(form.carpetArea, 1, 1000000)) err.carpetArea = true;
  return err;
};
export const validateStep2 = (form) => {
  const err = {};
  const land = isLandType(form.propertyType);
  const pg = isPgType(form.propertyType);
  if (!form.locality) err.locality = true;
  // Land has no flat/unit number; a PG is booked by building, so its room/floor
  // number is optional. The society field turns into an optional layout name for
  // land, and the PG / building name (still required) for a PG.
  if (!land && !pg && !hasText(form.flatNumber)) err.flatNumber = true;
  if (!land && !hasText(form.society)) err.society = true;
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
  return err;
};
// Documents are entirely optional: the ownership proof earns a Verified Owner badge,
// it doesn't gate publishing. Photos remain required — a listing without them is
// unusable to a seeker, whereas an unverified one is merely unbadged.
export const validateStep3 = (form, documents, photos) => {
  const err = {};
  if (!photos || !photos.length) err.photos = true;
  return err;
};

/* Flatmate/room flow reuses the 3-step wizard but validates its own lean set —
   a room is posted by a sitting tenant or owner, so owner-only requirements
   (ownership, sale docs, whole-flat rent) don't apply. */
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

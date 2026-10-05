import {
  isResidentialType, isCommercialType, isLandType, commercialProfileFromType,
  keyPhotoCategoriesFor, MIN_PUBLISH_PHOTOS, MIN_PUBLISH_KEY_CATEGORIES, areaRangeFor,
} from './constants.js';
import { ADDRESS_PARTS } from '../../../lib/listingFormDetails.js';
import { hasContactDetails } from './contactDetails.js';
import { YOUTUBE_ID_RE, normalizeYouTubeId } from './video.js';

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
/* A required amount must be a real, positive number, so "0", "-5" and pasted junk are all
 * rejected even though a non-empty string is truthy. */
const isPositive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0; };
/* Deposit is the one money field where zero is a real answer — a zero-deposit rental is a
 * genuine offer and refusing it would force the owner to lie. */
const isNonNegative = (v) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= 0; };
const inRange = (v, [min, max]) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max; };
const SALE_PRICE_MIN = 100000;
const MONTHLY_RENT_MIN = 1000;
const RESIDENTIAL_AREA_RANGE = [100, 20000];
const DEPOSIT_RENT_MULTIPLE_MAX = 24;

const isMissing = (value) => value == null || value === '';
const hasValue = (value) => value !== '' && value != null;
const saneAreaRangeFor = (form) => (
  isResidentialType(form.propertyType) ? RESIDENTIAL_AREA_RANGE : areaRangeFor(form.propertyType, form.areaUnit)
);
const isTowered = (form) => form.propertyType === 'flat';
/* Exported because `LocationStep` drops the asterisk on exactly this rule. */
export const isIndustrial = (form) => isCommercialType(form.propertyType)
  && commercialProfileFromType(form.commercialType) === 'industrial';
export const isPreCompletion = (form) => !isLandType(form.propertyType)
  && (form.construction === 'new' || form.construction === 'under');
export const isPlotSale = (form) => form.deal === 'buy' && (form.propertyType === 'openplot' || form.propertyType === 'plot');
export const reraRequired = () => false;
const sameListingKind = (form, original) => !!original
  && form.deal === original.deal && form.propertyType === original.propertyType
  && form.commercialType === original.commercialType;
const RERA_ID = /^P[0-9]{11}$/;
const floorValue = (value) => value === 'Ground' ? 0 : Number(value);

const FIELD_OF = { possession: 'construction' };
const sanityDependenciesOf = (key, value, form) => {
  if (key === 'price' && value === 'min') return ['price'];
  if (key === 'monthlyRent' && value === 'min') return ['monthlyRent'];
  if (key === 'deposit' && value === 'max') return ['deposit', 'monthlyRent'];
  if (key === 'carpetArea' && value === 'range' && isResidentialType(form.propertyType)) return ['carpetArea'];
  if (key === 'builtUp' && value === 'min') return ['builtUp', 'carpetArea'];
  if (key === 'superBuiltUp' && value === 'min') return ['superBuiltUp', 'builtUp', 'carpetArea'];
  return null;
};

const keepChangedErrors = (errors, form, original) => {
  if (!sameListingKind(form, original)) return errors;
  return Object.fromEntries(Object.entries(errors).filter(([key, value]) => {
    const field = FIELD_OF[key] ?? key;
    const unchanged = Object.is(form[field], original[field]);
    const deps = sanityDependenciesOf(key, value, form);
    if (deps && deps.every((dep) => Object.is(form[dep], original[dep]))) return false;
    return !isMissing(original[field]) || !unchanged
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
  if (!form.deal) err.deal = true;
  if (!form.propertyType) err.propertyType = true;
  if (commercial && !form.commercialType) err.commercialType = true;
  if (commercial && !hasText(form.shellType)) err.shellType = true;
  if (residential && !form.bhk) err.bhk = true;
  if (residential && !form.bathrooms) err.bathrooms = true;
  if (!inRange(form.carpetArea, saneAreaRangeFor(form))) err.carpetArea = 'range';
  if (residential) {
    const carpet = Number(form.carpetArea);
    const builtUp = Number(form.builtUp);
    const superBuiltUp = Number(form.superBuiltUp);
    const carpetValid = hasValue(form.carpetArea) && Number.isFinite(carpet);
    const builtUpValid = hasValue(form.builtUp) && Number.isFinite(builtUp);
    if (hasValue(form.builtUp) && (!builtUpValid || (carpetValid && builtUp < carpet))) {
      err.builtUp = 'min';
    }
    const basis = builtUpValid ? builtUp : (!hasValue(form.builtUp) && carpetValid ? carpet : null);
    if (hasValue(form.superBuiltUp)
      && (!Number.isFinite(superBuiltUp) || (basis != null && superBuiltUp < basis))) {
      err.superBuiltUp = 'min';
    }
  }
  /* The three answers a Maharashtra land buyer cannot proceed without. */
  if (isLandType(form.propertyType)) {
    if (!hasText(form.naStatus)) err.naStatus = true;
    if (!hasText(form.otherRights)) err.otherRights = true;
    if (form.propertyType === 'farmland' && form.deal === 'buy' && !hasText(form.buyerEligibility)) {
      err.buyerEligibility = true;
    }
  }
  /* A null floor is excluded, not unfiltered: `PropertySpecs` compares with `ge`/`le`. */
  if (isTowered(form) && isMissing(form.floor)) err.floor = true;
  if (isTowered(form) && isMissing(form.totalFloors)) err.totalFloors = true;
  if (isTowered(form) && !isMissing(form.floor) && !isMissing(form.totalFloors)
    && floorValue(form.floor) > floorValue(form.totalFloors)) err.floor = 'aboveTotal';
  return keepChangedErrors(err, form, original);
};
export const validateLocationStep = (form, original) => {
  const err = {};
  const land = isLandType(form.propertyType);
  if (!form.locality) err.locality = true;
  // Indian PIN codes are six digits and never start with 0.
  if (!/^[1-9]\d{5}$/.test(form.pincode)) err.pincode = true;
  const validated = keepChangedErrors(err, form, original);
  /* An edit whose address boxes are untouched keeps the line the server already holds, so a
   * complete address is only demanded of an owner who is actually replacing it. */
  const savedLine = hasText(original?.existingAddress);
  const addressUnchanged = savedLine && sameListingKind(form, original)
    && ADDRESS_PARTS.every((key) => Object.is(form[key], original[key]))
    && Object.is(form.societyId, original.societyId);
  /* A partial replacement must not reduce the preserved address to a street alone — but only where a unit and a
     project are answerable: a farm sits on a gat number, and an old plot often has no layout name. */
  if (!addressUnchanged && !land && !isIndustrial(form)) {
    if (!hasText(form.flatNumber)) validated.flatNumber = true;
    if (!hasText(form.society)) validated.society = true;
  }
  if (!addressUnchanged) {
    ADDRESS_PARTS.forEach((key) => {
      if (hasContactDetails(form[key])) validated[key] = 'contact';
    });
  }
  return validated;
};
export const validatePricingStep = (form, original) => {
  const err = {};
  const land = isLandType(form.propertyType);
  if (form.deal === 'rent') {
    const rent = Number(form.monthlyRent);
    if (!isPositive(form.monthlyRent)) err.monthlyRent = true;
    else if (rent < MONTHLY_RENT_MIN) err.monthlyRent = 'min';
    if (!isNonNegative(form.deposit)) err.deposit = true;
    else if (Number(form.deposit) > rent * DEPOSIT_RENT_MULTIPLE_MAX) err.deposit = 'max';
    if (!form.availableFrom) err.availableFrom = true;
  } else {
    const price = Number(form.price);
    if (!isPositive(form.price)) err.price = true;
    else if (price < SALE_PRICE_MIN) err.price = 'min';
    if (!land && !form.construction) err.possession = true;
    if (isPreCompletion(form) && !form.availableFrom) err.availableFrom = true;
    if (!form.ownership) err.ownership = true;
    if (isPlotSale(form) && !hasText(form.plottedProject)) err.plottedProject = true;
    if (hasText(form.reraId) && !RERA_ID.test(form.reraId)) err.reraId = 'format';
  }
  return keepChangedErrors(err, form, original);
};
export const validateStep3 = (form, photos, original, maxPhotos) => {
  const list = (photos || []).filter((p) => p?.url && !p.uploading && !p.error);
  const err = {};
  let nextErr = err;
  if (list.length > maxPhotos) nextErr = { ...nextErr, photos: 'max' };
  if (form.youtubeId && !YOUTUBE_ID_RE.test(form.youtubeId) && !normalizeYouTubeId(form.youtubeId).ok) {
    nextErr = { ...nextErr, youtubeId: 'format' };
  }
  if (String(form.description ?? '').length > 4000) nextErr = { ...nextErr, description: 'length' };
  else if ((!original || original.form?.description !== form.description) && hasContactDetails(form.description)) {
    nextErr = { ...nextErr, description: 'contact' };
  }
  if ((!original || original.form?.title !== form.title) && hasContactDetails(form.title)) {
    nextErr = { ...nextErr, title: 'contact' };
  }
  /* Never demand more of an edit than the listing already carries: the rule arrived after these listings were
     published, and blocking a price correction on a photo shoot is not a fix. */
  const had = original ? (original.images || original.gallery || []).filter(Boolean).length : 0;
  const floor = original ? Math.min(MIN_PUBLISH_PHOTOS, Math.max(had, 1)) : MIN_PUBLISH_PHOTOS;
  if (list.length < floor) return { ...nextErr, photos: 'min' };
  if (original || nextErr.photos === 'max') return nextErr;
  const keyCats = keyPhotoCategoriesFor(form.propertyType, form.commercialType);
  if (list.length < Math.min(MIN_PUBLISH_KEY_CATEGORIES, keyCats.length)) return nextErr;
  const covered = new Set(list.map((p) => p.category).filter((c) => keyCats.includes(c)));
  return covered.size < Math.min(MIN_PUBLISH_KEY_CATEGORIES, keyCats.length) ? { ...nextErr, photos: 'categories' } : nextErr;
};

// Room listings must not inherit whole-property ownership or pricing requirements.
export const validateFlatmateStep1 = (form) => {
  const err = {};
  if (!form.bhk) err.bhk = true;
  if (!form.roomType) err.roomType = true;
  if (form.hostRole === 'tenant') {
    if (!form.agreementDeclared) err.agreementDeclared = true;
    if (!form.agreementDoc) err.agreementDoc = true;
    if (!form.ownerConsent) err.ownerConsent = true;
  }
  return err;
};
export const validateFlatmateLocation = (form) => {
  const err = {};
  if (!form.locality) err.locality = true;
  if (!hasText(form.society)) err.society = true;
  if (!form.pinPlaced) err.location = true;
  return err;
};
export const validateFlatmatePrice = (form) => {
  const err = {};
  if (!isPositive(form.rentShare)) err.rentShare = true;
  if (!form.availableFrom) err.availableFrom = true;
  return err;
};

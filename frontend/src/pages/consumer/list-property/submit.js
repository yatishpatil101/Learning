import { parseAmount } from '../../../lib/format.js';
import {
  addListing as saveListing,
  updateListingFields as saveListingFields,
  checkOwnDuplicate,
} from '../../../services/propertyService.js';
import { evaluateListingDedup } from '../../../lib/data/propertyIdentity.js';
import { formatIndian } from './format.js';
import { commercialLabelOf, COMMERCIAL_SPEC_KEYS, FLOOR_PLAN_CATEGORY, isResidentialType, isCommercialType, isLandType, isHouseType, landUseFor } from './constants.js';
import { matchLocalityToCanonical } from '../../../data/localities.js';
import {
  classifyChanges, displayValue, recentMaterialEdits,
  FOUNDATION_STAYS_LIVE_KEYS,
  PRICE_REDUCED_PCT, PRICE_JUMP_FLAG_PCT, MATERIAL_EDIT_CAP,
} from './editPolicy.js';
import { requestRecheckFields, clearedRecheckFields } from '../../../lib/recheckFields.js';
import { canStateBuyerEligibility, pickListingFormDetails } from '../../../lib/listingFormDetails.js';
import { editPayload } from './editPayload.js';
import { headlineOf } from '../../../lib/headline.js';
import { mapServerFieldErrors } from './serverFieldErrors.js';
export { mapServerFieldErrors } from './serverFieldErrors.js';

/* `price` and `monthlyRent` both fold onto `price`: the wizard splits sale from rent while the entity has one column,
   and the moderator must be told "price", the field they will actually look at. */
const STAYS_LIVE_FORM_TO_WIRE = Object.fromEntries(
  Object.entries(FOUNDATION_STAYS_LIVE_KEYS).flatMap(([wire, formKeys]) => formKeys.map((k) => [k, wire])),
);

const COMMERCIAL_DETAIL_KEYS = new Set([
  'commercialType', 'washrooms', 'shellType', 'powerBackup', 'pantry', 'camCharges', 'suitableFor', 'fixtures',
  'gstOnRent', 'fitOutMonths', 'escalationPct', 'tenancyStatus', 'inPlaceRent', 'leaseExpiry',
  ...COMMERCIAL_SPEC_KEYS,
]);
const RESIDENTIAL_DETAIL_KEYS = new Set([
  'foodPref', 'petsPolicy', 'rentMaintMode', 'transactionType', 'possession',
  'loanAvailable', 'furniture', 'preferredTenants',
]);

const withoutFormDetails = (form, keys) => pickListingFormDetails(Object.fromEntries(
  Object.entries(form).filter(([key]) => !keys.has(key)),
));

const formDetailsForPropertyType = (form) => {
  const excluded = isCommercialType(form.propertyType) ? RESIDENTIAL_DETAIL_KEYS : COMMERCIAL_DETAIL_KEYS;
  const normalized = form.loanAvailable === '' || form.loanAvailable == null
    ? Object.fromEntries(Object.entries(form).filter(([key]) => key !== 'loanAvailable'))
    : form;
  return withoutFormDetails(normalized, canStateBuyerEligibility(form)
    ? excluded
    : new Set([...excluded, 'buyerEligibility']));
};

const forTheWire = (record, form, isRent, storedAddress = '') => ({
  ...record,
  formDetails: formDetailsForPropertyType(form),
  /* AddressKey derives the duplicate signal from this line, so it must carry the unit token. */
  address: [form.flatNumber, form.tower, form.society, form.street]
    .map((part) => String(part ?? '').trim()).filter(Boolean).join(', ')
    || storedAddress,
  /* Guarded on `form.floor`, not `record.floor`: the latter is `parseInt(...) || 0` and cannot tell "ground" from
     "never asked", so forwarding 0 for villas and plots fabricates a duplicate signal. */
  floor: form.floor === '' || form.floor == null ? undefined : record.floor,
  maintenance: (() => {
    const value = isRent ? (form.rentMaintMode === 'extra' ? form.rentMaintenance : '') : form.monthlyMaintenance;
    return value === '' || value == null ? undefined : parseAmount(value);
  })(),
  // The record calls it `rera` and the contract calls it `reraId`; the mismatch dropped it silently.
  reraId: form.reraId || '',
  /* Lifted out of `strongIds` for the request only, and kept out of `record` on purpose: the record is buyer-readable
     (edit prefill, detail page) and a meter number belongs to the owner. */
  electricityConsumerNo: form.electricityConsumerNo || '',
});

const TYPE_LABELS = { flat: 'Flat', villa: 'Villa', independent: 'Independent House', plot: 'Plot', openplot: 'Open Plot', farmland: 'Farm Land', commercial: 'Commercial' };

export const listingLabels = (form) => {
  const subtypeLabel = commercialLabelOf(form.commercialType);
  const typeLabel = (form.propertyType === 'commercial' && subtypeLabel) ? subtypeLabel : (TYPE_LABELS[form.propertyType] || 'Property');
  const bhk = Number(form.bhk);
  const bhkLabel = (isResidentialType(form.propertyType) && form.bhk) ? (String(form.bhk) === '0' ? '1 RK' : bhk >= 5 ? '5+ BHK' : form.bhk + ' BHK') : '';
  const title = (bhkLabel ? `${bhkLabel} ` : '') + typeLabel + (form.locality ? ` in ${form.locality}` : '');
  return { typeLabel, bhkLabel, title };
};

export const roomHeadline = (form) => {
  const bhk = form.bhk ? `${form.bhk === '4' ? '4+' : form.bhk} BHK ` : '';
  const base = `${form.roomType || 'Room'} in ${bhk}${(form.homeTypeLabel || 'Flat').toLowerCase()}`;
  return headlineOf('', [base, String(form.society || '').trim(), form.locality].filter(Boolean).join(', '));
};

export const persistListing = async ({ form, user, editId, editListing, photos }) => {
    const mob = (user && user.mobile) || '';

    // "Have I already listed this?" is asked of the server, which holds the caller's real listings;
    // the cross-owner half runs server-side in `ListingDuplicateProbe` and is never reported back.
    const dedup = evaluateListingDedup({ fields: form });
    if (!editId) {
      const mine = await checkOwnDuplicate({ mobile: mob, fields: form });
      if (mine.found) {
        return { ok: false, blocked: true, existingId: mine.existingId };
      }
    }

    const isRent = form.deal === 'rent';
    const { typeLabel, bhkLabel, title: suggested } = listingLabels(form);
    const title = headlineOf(form.title, suggested);
    const priceNum = parseAmount(isRent ? form.monthlyRent : form.price);
    const priceStr = isRent ? `₹${formatIndian(form.monthlyRent)}/mo` : `₹${formatIndian(form.price)}`;
    const areaNum = Number(form.carpetArea || form.builtUp) || undefined;
    // An unmatched locality yields no slug, mirroring the server's resolver: minting one from free
    // text splits an area into three unchecked slugs, pages and facets.
    let localitySlug = '';
    if (form.locality) {
      const canon = matchLocalityToCanonical(form.locality, form.propLat, form.propLng);
      if (canon) localitySlug = canon.slug;
    }
    const loc = [form.society, form.locality, 'Pune'].filter(Boolean).join(', ');

    /* Only URLs that outlive this tab. */
    const uploaded = photos
      .map((p) => p && p.url)
      .filter((u) => typeof u === 'string' && u !== '' && !/^(data|blob):/i.test(u));
    const gallery = uploaded;
    /* Empty string, never undefined: an absent key means "leave it alone" in a PATCH, so
     * untagging would not reach. */
    const tagged = photos.find((p) => p?.category === FLOOR_PLAN_CATEGORY)?.url;
    const floorPlan = uploaded.includes(tagged) ? tagged : '';
    const cover = gallery.find((url) => url !== floorPlan) || gallery[0] || '';

    const listingId = editId || ('L' + Date.now());
    const viewUrl = `/property/${listingId}`;
    const { electricityConsumerNo: _ec, ...safeForm } = form;
    const record = {
      id: listingId,
      title,
      type: typeLabel,
      // Only a residential unit sits inside a society, so land/commercial never carry a societyId
      // even when one lingers in form state from an earlier type choice.
      societyId: (isLandType(form.propertyType) || isCommercialType(form.propertyType)) ? '' : (form.societyId || ''),
      bhk: bhkLabel,
      bhkNum: bhkLabel ? (parseInt(form.bhk, 10) || 0) : 0,
      bath: isResidentialType(form.propertyType) ? (parseInt(form.bathrooms, 10) || 0) : 0,
      locality: form.locality || 'Pune',
      localitySlug,
      loc,
      society: form.society || '',
      area: areaNum,
      price: priceNum,
      priceStr,
      deal: form.deal,
      owner: (user && user.name) || '',
      ownerMobile: mob,
      status: 'pending',
      statusClass: 'pill-pending',
      real: true,
      featured: false,
      views: 0,
      enquiries: 0,
      photoCount: gallery.length,
      furnishing: isResidentialType(form.propertyType) ? form.furnishing : undefined,
      facing: form.facing || '',
      overlooking: isLandType(form.propertyType) ? '' : form.overlooking || '',
      floor: parseInt(form.floor, 10) || 0,
      age: form.age || '',
      construction: form.construction || undefined,
      amenities: form.amenities || [],
      img: cover,
      image: cover,
      gallery,
      floorPlan,
      video: form.youtubeId || '',
      viewUrl,
      lat: form.propLat,
      lng: form.propLng,
      desc: form.description || '',
      deposit: isRent ? parseAmount(form.deposit) : 0,
      // Undefined, not false: `petsAllowed` defaults to false, so a `false` fallback turns every
      // owner who skipped the question into one who has banned pets.
      pets: isResidentialType(form.propertyType) ? (form.petsPolicy === 'yes' ? true : form.petsPolicy === 'no' ? false : undefined) : undefined,
      food: isResidentialType(form.propertyType) ? form.foodPref || 'any' : undefined,
      rera: form.reraId || '',
      lockin: form.lockIn || '0',
      notice: form.noticePeriod || '1',
      agreementDuration: form.agreementDuration || '',
      available: form.availableFrom || '',
      tenants: isResidentialType(form.propertyType) ? (form.preferredTenants?.includes('anyone') ? [] : form.preferredTenants || []) : [],
      furniture: isResidentialType(form.propertyType) ? form.furniture || [] : [],
      // Top-level spec fields the cards & detail page read directly (kept flat so
      // consumers don't have to reach into record.form). Zeroed/blank when N/A.
      balconies: isResidentialType(form.propertyType) ? (parseInt(form.balconies, 10) || 0) : 0,
      // Residential-only, and absent rather than 0 for a shop: it was never asked the question and
      // must not claim zero as an answer.
      bathrooms: isResidentialType(form.propertyType)
        ? (parseInt(form.bathrooms, 10) || 0)
        : undefined,
      carpetArea: isLandType(form.propertyType) ? undefined : Number(form.carpetArea) || undefined,
      // Commercial is quoted and rented on carpet alone; it is never asked for either of these.
      builtUp: isCommercialType(form.propertyType) ? undefined : Number(form.builtUp) || undefined,
      superBuiltUp: isCommercialType(form.propertyType) ? undefined : Number(form.superBuiltUp) || undefined,
      areaUnit: form.areaUnit || 'sqft',
      // Blank stays blank: `|| 0` would say "no parking" on behalf of every owner who skipped
      // the question.
      parkingSpaces: form.parkingSpaces === '' || form.parkingSpaces == null
        ? undefined
        : (parseInt(form.parkingSpaces, 10) || 0),
      plotArea: isHouseType(form.propertyType) ? (Number(form.plotArea) || 0) : 0,
      floorsInHouse: isHouseType(form.propertyType) ? (parseInt(form.floorsInHouse, 10) || 0) : 0,
      totalFloors: parseInt(form.totalFloors, 10) || 0,
      ownership: form.ownership || '',
      transactionType: form.transactionType || '',
      loanAvailable: !isRent && isResidentialType(form.propertyType) && typeof form.loanAvailable === 'boolean'
        ? form.loanAvailable
        : undefined,
      monthlyMaintenance: isRent ? '' : (form.monthlyMaintenance || ''),
      rentMaintMode: isRent ? (form.rentMaintMode || '') : '',
      rentMaintenance: isRent && form.rentMaintMode === 'extra' ? (form.rentMaintenance || '') : '',
      negotiable: !!form.priceNegotiable,
      ...(isCommercialType(form.propertyType) && {
        commercialType: form.commercialType || '',
        shellType: form.shellType || '',
        washrooms: parseInt(form.washrooms, 10) || 0,
        camCharges: form.camCharges || '',
        pantry: !!form.pantry,
        suitableFor: form.suitableFor || [],
        fixtures: form.fixtures || [],
        gstOnRent: isRent ? (form.gstOnRent || '') : '',
        fitOutMonths: isRent ? (form.fitOutMonths || '') : '',
        escalationPct: isRent ? (form.escalationPct || '') : '',
        tenancyStatus: isRent ? '' : (form.tenancyStatus || ''),
        inPlaceRent: !isRent && form.tenancyStatus === 'leased' ? (form.inPlaceRent || '') : '',
        leaseExpiry: !isRent && form.tenancyStatus === 'leased' ? (form.leaseExpiry || '') : '',
        ...Object.fromEntries(COMMERCIAL_SPEC_KEYS.map((key) => [key, form[key] || ''])),
      }),
      ...(isLandType(form.propertyType) && {
        plotLength: form.plotLength || '',
        plotWidth: form.plotWidth || '',
        openSides: form.openSides || '',
        roadWidth: form.roadWidth || '',
        cornerPlot: !!form.cornerPlot,
        boundaryWall: !!form.boundaryWall,
        plotZone: form.plotZone || '',
        naStatus: form.naStatus || '',
        waterSource: form.waterSource || '',
        electricity: !!form.electricity,
        roadAccess: !!form.roadAccess,
        otherRights: form.otherRights || '',
        buyerEligibility: !isRent && form.propertyType === 'farmland' ? (form.buyerEligibility || '') : '',
        landUse: landUseFor(form.propertyType, form.plotZone),
      }),
      createdAt: Date.now(),
      // Buyer-facing form snapshot with private identifiers stripped — the raw
      // electricity / tax IDs live only in strongIds (Ops-only) below.
      form: safeForm,
      flatNumber: form.flatNumber || '',
      tower: form.tower || '',
      pincode: form.pincode || '',
      fingerprint: dedup.fingerprint,
      fingerprintKeys: dedup.fingerprintKeys,
      strongIds: {
        electricityConsumerNo: form.electricityConsumerNo || '',
        reraId: form.reraId || '',
      },
      /* Duplicate claims are the server's call. */
      duplicateFlag: false,
      duplicateOf: '',
    };

    /* Ahead of all local bookkeeping and outside the try/catch that swallows a quota error:
     * losing the mirror is survivable, losing the save is not. */
    let saved;
    try {
      const payload = forTheWire(record, form, isRent, editListing?.address);
      saved = editId
        ? await saveListingFields(editId, editPayload(payload, form, editListing))
        : await saveListing(payload);
    } catch (err) {
      if (err?.isValidation && Array.isArray(err.fields) && err.fields.length) {
        const mapped = mapServerFieldErrors(form, err.fields);
        if (Object.keys(mapped.errors).length) {
          return { ok: false, fieldErrors: mapped.errors, fieldErrorStep: mapped.step, unknownFields: mapped.unknown };
        }
      }
      // An invariant violation names internal tables; the owner gets the generic line, the console
      // keeps the detail.
      if (err?.internal) {
        console.error(err);
        return { ok: false, error: 'Could not save your listing.' };
      }
      return { ok: false, error: (err && err.message) || 'Could not save your listing.' };
    }
    /* Adopt the server's id before anything local is written, or the mirror, the notification
     * link and the documents are filed under an id that exists on no server. */
    if (!editId) {
      if (!saved || !saved.id) {
        return { ok: false, error: 'Your listing was sent but the server did not confirm it. Please try again.' };
      }
      if (String(saved.id) !== record.id) {
        record.id = String(saved.id);
        record.viewUrl = `/property/${record.id}`;
      }
    }

    if (editId) {
      const oldListing = editListing || {};
      const oldForm = oldListing.form || oldListing;
      /* Mirrors the server's `isPubliclyVisible()` (`APPROVED && !archived`), read off the record the editor opened —
         raising a re-check on an archived listing queues invisible work. */
      const wasApproved = /approved|verified|live/i.test(String(oldListing.status || '')) && !oldListing.archived;
      const oldPhotoUrls = (oldListing.images || oldListing.gallery || []).filter(Boolean);
      const newPhotoUrls = photos.map((p) => p.url).filter(Boolean);
      const cls = classifyChanges(oldForm, form, oldPhotoUrls, newPhotoUrls);

      record.status = saved?.status || oldListing.status || 'pending';
      record.statusClass = (saved?.status && saved.statusClass) || oldListing.statusClass || 'pill-pending';

      // Clears only our own auto-duplicate reason: an admin's manual flag text will not match the
      // "Possible duplicate …" prefix and must survive.
      if (!dedup.flagForReview && /^Possible duplicate/.test(String(oldListing.flagReason || ''))) {
        record.flagReason = '';
      }

      const prevLog = Array.isArray(oldListing.editLog) ? oldListing.editLog : [];
      const entry = {
        at: Date.now(),
        tierA: cls.tierA.length,
        tierB: cls.tierB.length,
        fields: [...cls.tierA, ...cls.tierB].map((c) => c.label),
        priceSwing: cls.priceSwing ? Math.round(cls.priceSwing.pct * 100) : 0,
      };
      record.editLog = [entry, ...prevLog].slice(0, 20);
      record.editCount = (oldListing.editCount || 0) + 1;
      record.lastEditAt = entry.at;

      // Price-swing signals: buyer "Price reduced" badge, admin flag on a jump.
      record.priceReduced = oldListing.priceReduced || false;
      record.prevPrice = oldListing.prevPrice || 0;
      record.priceJumpFlag = oldListing.priceJumpFlag || false;
      if (cls.priceSwing && cls.priceSwing.abs >= PRICE_REDUCED_PCT) {
        const isDown = cls.priceSwing.dir === 'down';
        record.priceReduced = isDown;
        record.prevPrice = isDown ? cls.priceSwing.from : 0;
        if (!isDown && cls.priceSwing.abs >= PRICE_JUMP_FLAG_PCT) record.priceJumpFlag = true;
      }

      /* The server's verdict is already on `saved`, so recomputing would let the mirror disagree with the row it
         mirrors. */
      const serverRecheck = saved && typeof saved.recheckPending === 'boolean'
        ? {
            recheckPending: saved.recheckPending,
            recheckReason: saved.recheckReason || '',
            recheckRequestedAt: saved.recheckRequestedAt || '',
          }
        : null;
      const staysLiveWireFields = wasApproved && !cls.remoderation.length
        ? [...new Set(cls.staysLive.map((c) => STAYS_LIVE_FORM_TO_WIRE[c.key]).filter(Boolean))]
        : [];
      if (serverRecheck) {
        Object.assign(record, serverRecheck);
      } else if (staysLiveWireFields.length) {
        Object.assign(record, requestRecheckFields(oldListing, staysLiveWireFields));
      } else if (cls.remoderation.length) {
        /* Re-moderation supersedes — the server's `revertToPending()` calls `clearRecheck()`. */
        Object.assign(record, clearedRecheckFields());
      } else {
        record.recheckPending = !!oldListing.recheckPending;
        record.recheckReason = oldListing.recheckReason || '';
        record.recheckRequestedAt = oldListing.recheckRequestedAt || '';
      }

      if (wasApproved && cls.tierA.length) {
        record.reReview = {
          fields: cls.tierA.map((c) => ({ label: c.label, from: displayValue(c.from), to: displayValue(c.to) })),
          identityChanged: cls.identityChanged,
          at: Date.now(),
        };
        record.materialEditFlag = cls.identityChanged || recentMaterialEdits(record.editLog) > MATERIAL_EDIT_CAP;
      } else if (wasApproved) {
        record.reReview = null;
        record.materialEditFlag = false;
      } else {
        record.reReview = oldListing.reReview || null;
        record.materialEditFlag = oldListing.materialEditFlag || false;
      }
    }

    return { ok: true, listing: record };
};

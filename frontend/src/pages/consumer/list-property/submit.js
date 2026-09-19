import { parseAmount } from '../../../lib/format';
import {
  addListing as saveListing,
  updateListingFields as saveListingFields,
  checkOwnDuplicate,
} from '../../../services/propertyService.js';
import { uploadDocument } from '../../../services/documentService.js';
import { evaluateListingDedup } from '../../../lib/data/propertyIdentity.js';
import { formatIndian } from './format.js';
import { commercialLabelOf, COMMERCIAL_SPEC_KEYS, docsFor, FLOOR_PLAN_CATEGORY, isResidentialType, isCommercialType, isLandType, isHouseType, landUseFor } from './constants.js';
import { matchLocalityToCanonical } from '../../../data/localities.js';
import {
  classifyChanges, displayValue, recentMaterialEdits,
  FOUNDATION_STAYS_LIVE_KEYS,
  PRICE_REDUCED_PCT, PRICE_JUMP_FLAG_PCT, MATERIAL_EDIT_CAP,
} from './editPolicy.js';
import { requestRecheckFields, clearedRecheckFields } from '../../../lib/recheckFields.js';
import { pickListingFormDetails } from '../../../lib/listingFormDetails.js';
import { editPayload } from './editPayload.js';

/* `price` and `monthlyRent` both fold onto `price`: the wizard splits sale from rent while the entity has
   one column, and the moderator must be told "price", the field they will actually look at. */
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
  if (isCommercialType(form.propertyType)) return withoutFormDetails(form, RESIDENTIAL_DETAIL_KEYS);
  return withoutFormDetails(form, COMMERCIAL_DETAIL_KEYS);
};

/* `toListingCreate` picks the keys it knows and ignores the rest, so this only closes the gaps where the
   wizard's name and the contract's name diverge, plus one field the record does not carry. */
const forTheWire = (record, form, isRent, storedAddress = '') => ({
  ...record,
  formDetails: formDetailsForPropertyType(form),
/* AddressKey derives the duplicate signal from this line, so it must carry the unit token. `storedAddress`
   wins when the form has no unit, since recomposing would drop the flat number the server already holds. */
  address: [form.flatNumber, form.tower, form.society, form.street]
    .map((part) => String(part ?? '').trim()).filter(Boolean).join(', ')
    || storedAddress,
/* Guarded on `form.floor`, not `record.floor`: the latter is `parseInt(...) || 0` and cannot tell "ground"
   from "never asked", so forwarding 0 for villas and plots fabricates a duplicate signal. */
  floor: form.floor === '' || form.floor == null ? undefined : record.floor,
  // The wizard splits maintenance by deal (and by whether rent includes it); the entity has one column.
  maintenance: (() => {
    const value = isRent ? (form.rentMaintMode === 'extra' ? form.rentMaintenance : '') : form.monthlyMaintenance;
    return value === '' || value == null ? undefined : parseAmount(value);
  })(),
  // The record calls it `rera` and the contract calls it `reraId`; the mismatch dropped it silently.
  reraId: form.reraId || '',
  /* Lifted out of `strongIds` for the request only, and kept out of `record` on purpose: the record
     is buyer-readable (edit prefill, detail page) and a meter number belongs to the owner. */
  electricityConsumerNo: form.electricityConsumerNo || '',
});

/* The picker keeps only the base64 preview while the vault endpoint is multipart, so the bytes are rebuilt
   here. That is also what makes a restored draft work: no `File` survives storage, but the data URL does. */
const fileFromDataUrl = (dataUrl, name, mime) => {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma < 0) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name || 'document', { type: mime || 'application/octet-stream' });
  } catch {
    return null;
  }
};

/* ---------- listing persistence ---------- */
/* The record is built here but written through `propertyService.addListing`, the only path where
   the server can run its duplicate probe. */
export const persistListing = async ({ form, user, editId, editListing, documents, photos, photoHashes }) => {
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
    const typeMap = { flat: 'Flat', villa: 'Villa', independent: 'Independent House', plot: 'Plot', openplot: 'Open Plot', farmland: 'Farm Land', commercial: 'Commercial' };
    const subtypeLabel = commercialLabelOf(form.commercialType);
    const typeLabel = (form.propertyType === 'commercial' && subtypeLabel) ? subtypeLabel : (typeMap[form.propertyType] || 'Property');
    // BHK only qualifies a residential home; commercial and land carry none.
    const bhkLabel = (isResidentialType(form.propertyType) && form.bhk) ? (String(form.bhk) === '0' ? '1 RK' : String(form.bhk) === '4' ? '4+ BHK' : form.bhk + ' BHK') : '';
    const titlePrefix = bhkLabel ? bhkLabel + ' ' : '';
    const title = titlePrefix + typeLabel + (form.locality ? ' in ' + form.locality : '');
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

    /* Only URLs that outlive this tab. A `data:` URL is dropped deliberately: in mock mode the
       "upload" is a base64 read, and a few of those blow the localStorage quota and lose the write. */
    const uploaded = photos
      .map((p) => p && p.url)
      .filter((u) => typeof u === 'string' && u !== '' && !u.startsWith('data:'));
    const gallery = uploaded.length ? uploaded : [
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70',
      'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=800&q=70',
      'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=800&q=70',
    ];
/* Checked against `uploaded` so it inherits that filter — a `data:` plan dies with the tab. Empty string,
   never undefined: an absent key means "leave it alone" in a PATCH, so untagging would not reach. */
    const tagged = photos.find((p) => p?.category === FLOOR_PLAN_CATEGORY)?.url;
    const floorPlan = uploaded.includes(tagged) ? tagged : '';
    /* A schematic makes a poor search card, and the plan is often the first thing uploaded. Falls
       back to the plan only when it is the sole photo, where the alternative is no card image. */
    const cover = gallery.find((url) => url !== floorPlan) || gallery[0];

    const listingId = editId || ('L' + Date.now());
    const viewUrl = `/property/${listingId}`;
    // The persisted form snapshot is buyer-readable (edit prefill + detail page),
    // so strip the private ownership identifiers — they live only in strongIds.
    const { electricityConsumerNo: _ec, pmcPropertyId: _pid, ...safeForm } = form;
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
      photoCount: photos.length,
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
      viewUrl,
      lat: form.propLat,
      lng: form.propLng,
      desc: form.description || '',
      deposit: isRent ? parseAmount(form.deposit) : 0,
      // Undefined, not false: `petsAllowed` defaults to false, so the old fallback turned every
      // owner who skipped the question into one who had banned pets.
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
      plotArea: isHouseType(form.propertyType) ? (parseInt(form.plotArea, 10) || 0) : 0,
      floorsInHouse: isHouseType(form.propertyType) ? (parseInt(form.floorsInHouse, 10) || 0) : 0,
      totalFloors: parseInt(form.totalFloors, 10) || 0,
      ownership: form.ownership || '',
      transactionType: form.transactionType || '',
      loanAvailable: !isRent && !!form.loanAvailable,
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
      // Structured address (not PII — society/pincode already show on the card).
      flatNumber: form.flatNumber || '',
      tower: form.tower || '',
      pincode: form.pincode || '',
      fingerprint: dedup.fingerprint,
      fingerprintKeys: dedup.fingerprintKeys,
      // Perceptual hashes, not the images, so a re-list with the same photos matches even when the
      // typed address differs. Empty when nothing decoded.
      photoHashes: Array.isArray(photoHashes) ? photoHashes : [],
      strongIds: {
        electricityConsumerNo: form.electricityConsumerNo || '',
        pmcPropertyId: form.pmcPropertyId || '',
        reraId: form.reraId || '',
      },
      /* Blank, not false: the moderation queue reads these on rows that already carry them, and a listing
         that stops setting a field is not one that sets it false. Duplicate claims are the server's call. */
      duplicateFlag: false,
      duplicateOf: '',
    };

    /* Ahead of all local bookkeeping and outside the try/catch that swallows a quota error: losing the mirror
       is survivable, losing the save is not. A client that could assert "this edit stays live" could evade review. */
    let saved;
    try {
      const payload = forTheWire(record, form, isRent, editListing?.address);
      saved = editId
        ? await saveListingFields(editId, editPayload(payload, form, editListing))
        : await saveListing(payload);
    } catch (err) {
      // An invariant violation names internal tables; the owner gets the generic line, the console
      // keeps the detail.
      if (err?.internal) {
        console.error(err);
        return { ok: false, error: 'Could not save your listing.' };
      }
      return { ok: false, error: (err && err.message) || 'Could not save your listing.' };
    }
    /* Adopt the server's id before anything local is written, or the mirror, the notification link and the
       documents are filed under an id that exists on no server. A create without one is a failure. */
    if (!editId) {
      if (!saved || !saved.id) {
        return { ok: false, error: 'Your listing was sent but the server did not confirm it. Please try again.' };
      }
      if (String(saved.id) !== record.id) {
        record.id = String(saved.id);
        record.viewUrl = `/property/${record.id}`;
      }
    }

    // ---- Edit policy ----------------------------------------
    // Changes are classified material (Tier A: re-check while staying live) or soft (Tier B).
    if (editId) {
      /* The listing as the editor opened it, handed in by the hook: a local read would answer about
         whatever this browser wrote, so every field would classify as material. */
      const oldListing = editListing || {};
      const oldForm = oldListing.form || oldListing;
      /* Mirrors the server's `isPubliclyVisible()` (`APPROVED && !archived`), read off the record
         the editor opened — raising a re-check on an archived listing queues invisible work. */
      const wasApproved = /approved|verified|live/i.test(String(oldListing.status || '')) && !oldListing.archived;
      const oldPhotoUrls = (oldListing.images || oldListing.gallery || []).filter(Boolean);
      const newPhotoUrls = photos.map((p) => p.url).filter(Boolean);
      const cls = classifyChanges(oldForm, form, oldPhotoUrls, newPhotoUrls);

      // Preserve the live/pending state rather than defaulting to 'pending'.
      record.status = oldListing.status || 'pending';
      record.statusClass = oldListing.statusClass || 'pill-pending';

      // Keep the stored hashes when photos survive but could not be re-hashed (remote or
      // cross-origin gallery); clear them only when the owner removed every photo.
      if (!Array.isArray(photoHashes) || !photoHashes.length) {
        record.photoHashes = newPhotoUrls.length ? (oldListing.photoHashes || []) : [];
      }

      // Clears only our own auto-duplicate reason: an admin's manual flag text will not match the
      // "Possible duplicate …" prefix and must survive.
      if (!dedup.flagForReview && /^Possible duplicate/.test(String(oldListing.flagReason || ''))) {
        record.flagReason = '';
      }

      // Audit log + counters.
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

      /* The server's verdict is already on `saved`, so recomputing would let the mirror disagree with the row
         it mirrors. The local branch is the mock fallback and copies each condition — any approximation is laxer. */
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
        /* Re-moderation supersedes — the server's `revertToPending()` calls `clearRecheck()`.
           Carrying the old re-check forward would leave the listing in both queues at once. */
        Object.assign(record, clearedRecheckFields());
      } else {
        record.recheckPending = !!oldListing.recheckPending;
        record.recheckReason = oldListing.recheckReason || '';
        record.recheckRequestedAt = oldListing.recheckRequestedAt || '';
      }

      // Material change on a LIVE listing → re-check while it stays live.
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

    /* The re-review note, the duplicate case and the listing-received notification are all raised
       server-side, into the threads ops and the owner's inbox actually read. */

/* Rent as well as sale: the attachment is the evidence behind the Verified Owner badge. Non-fatal and outside
   the try above — the listing already exists, so failures are named and handed to the success screen. */
    const documentsFailed = [];
    const allowedDocumentKeys = new Set(docsFor(form.deal, form.propertyType, form.commercialType).map((doc) => doc.key));
    for (const [category, doc] of Object.entries(documents)) {
      if (!allowedDocumentKeys.has(category) || !doc || !doc.data) continue;
      const file = fileFromDataUrl(doc.data, doc.name, doc.mime);
      if (!file) { documentsFailed.push(category); continue; }
      try {
        // Already prepared at the picker by `useListingMedia.handleDocUpload`; these bytes are that
        // pass's output, round-tripped through a data URL. See `documentService.uploadDocument`.
        await uploadDocument(mob, record.id, { category, file, prepared: true });
      } catch {
        documentsFailed.push(category);
      }
    }
    // The record travels back so the success screen can offer to let a new rent listing room by
    // room, and `documentsFailed` so it can name any paper that did not make it.
    return { ok: true, listing: record, documentsFailed };
};

import { parseAmount } from '../../../lib/format';
import {
  addListing as saveListing,
  updateListingFields as saveListingFields,
  checkOwnDuplicate,
} from '../../../services/propertyService.js';
import { uploadDocument } from '../../../services/documentService.js';
import { evaluateListingDedup } from '../../../lib/data/propertyIdentity.js';
import { formatIndian } from './format.js';
import { COMMERCIAL_SUBTYPES, isResidentialType, isCommercialType, isLandType, isHouseType } from './constants.js';
import { matchLocalityToCanonical } from '../../../data/localities.js';
import {
  classifyChanges, displayValue, recentMaterialEdits,
  FOUNDATION_STAYS_LIVE_KEYS,
  PRICE_REDUCED_PCT, PRICE_JUMP_FLAG_PCT, MATERIAL_EDIT_CAP,
} from './editPolicy.js';
import { requestRecheckFields, clearedRecheckFields } from '../../../lib/recheckFields.js';
import { pickListingFormDetails } from '../../../lib/listingFormDetails.js';
import { editPayload } from './editPayload.js';

/* Wizard form key → the server's wire field name, inverted from the map the gate already pins.
   `price` and `monthlyRent` both fold onto `price`, because the wizard splits sale price from
   monthly rent while the entity has one column — and the moderator must be told "price", which is
   the field they will actually look at. */
const STAYS_LIVE_FORM_TO_WIRE = Object.fromEntries(
  Object.entries(FOUNDATION_STAYS_LIVE_KEYS).flatMap(([wire, formKeys]) => formKeys.map((k) => [k, wire])),
);

/* The record the app reads, adjusted for the one consumer that is not the app: the API contract.
   `toListingCreate` picks out the keys it knows and ignores the rest, so this only has to close the
   gaps where the wizard's name and the contract's name diverge — plus one field the record
   deliberately does not carry at all. */
const forTheWire = (record, form, isRent, storedAddress = '') => ({
  ...record,
  formDetails: pickListingFormDetails(form),
  /* AddressKey derives the duplicate signal from this line, so it must carry the unit token — with
     just building and locality every flat looks like one property. `storedAddress` wins when the
     form has no unit token, since recomposing from boxes `splitStoredAddress` could not fill would
     drop the flat number the server already holds. */
  address: [form.flatNumber, form.tower, form.society, form.street]
    .map((part) => String(part ?? '').trim()).filter(Boolean).join(', ')
    || storedAddress,
  /* Guarded on `form.floor`, not `record.floor`: the latter is `parseInt(...) || 0`, which cannot
     tell "ground floor" from "never asked" — and forwarding 0 for villas, plots and PGs fabricates a
     duplicate signal out of an input never shown. Ground surviving as 0 is intended. */
  floor: form.floor === '' || form.floor == null ? undefined : record.floor,
  // The wizard splits maintenance by deal (and by whether rent includes it); the entity has one column.
  maintenance: parseAmount(isRent ? (form.rentMaintMode === 'extra' ? form.rentMaintenance : '') : form.monthlyMaintenance) || 0,
  // The record calls it `rera` and the contract calls it `reraId`; the mismatch dropped it silently.
  reraId: form.reraId || '',
  /* Lifted out of `strongIds` for the request only, and kept out of `record` on purpose: the record
     is buyer-readable (edit prefill, detail page) and a meter number belongs to the owner. */
  electricityConsumerNo: form.electricityConsumerNo || '',
});

/* The picker keeps only the base64 preview and lets the `File` go, while the vault endpoint is
   multipart — so the bytes are reconstructed here. Doing it at upload time is also what makes a
   restored draft work: no `File` survives a round trip through storage, but the data URL does. */
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
    const subtypeLabel = COMMERCIAL_SUBTYPES.find((s) => s.value === form.commercialType)?.label || '';
    const typeLabel = (form.propertyType === 'commercial' && subtypeLabel) ? subtypeLabel : (typeMap[form.propertyType] || 'Property');
    // BHK only qualifies a residential home; commercial and land carry none.
    const bhkLabel = (isResidentialType(form.propertyType) && form.bhk) ? (String(form.bhk) === '4' ? '4+ BHK' : form.bhk + ' BHK') : '';
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
    const cover = gallery[0];

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
      furnishing: form.furnishing,
      facing: form.facing || '',
      overlooking: isLandType(form.propertyType) ? '' : form.overlooking || '',
      floor: parseInt(form.floor, 10) || 0,
      age: form.age || '',
      // Only a genuinely under-construction age makes a home "not ready"; a completed home with a
      // future handover date is still ready, and its date is captured in `available`/`possession`.
      construction: form.age === 'under-construction' ? 'under' : form.age ? 'ready' : undefined,
      amenities: form.amenities || [],
      img: cover,
      image: cover,
      gallery,
      viewUrl,
      lat: form.propLat,
      lng: form.propLng,
      desc: form.description || '',
      deposit: isRent ? parseAmount(form.deposit) : 0,
      pets: form.petsPolicy ? form.petsPolicy === 'yes' : form.petsAllowed,
      food: form.foodPref || 'any',
      rera: form.reraId || '',
      lockin: form.lockIn || '0',
      notice: form.noticePeriod || '1',
      available: (isRent || form.possession === 'available') ? form.availableFrom : '',
      tenants: (form.preferredTenants || []).join(','),
      // Top-level spec fields the cards & detail page read directly (kept flat so
      // consumers don't have to reach into record.form). Zeroed/blank when N/A.
      balconies: isResidentialType(form.propertyType) ? (parseInt(form.balconies, 10) || 0) : 0,
      // Residential-only, and absent rather than 0 for a shop: it was never asked the question and
      // must not claim zero as an answer.
      bathrooms: isResidentialType(form.propertyType)
        ? (parseInt(form.bathrooms, 10) || 0)
        : undefined,
      carpetArea: isLandType(form.propertyType) ? undefined : Number(form.carpetArea) || undefined,
      builtUp: Number(form.builtUp) || undefined,
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
      possession: form.possession || '',
      transactionType: form.transactionType || '',
      loanAvailable: !isRent && !!form.loanAvailable,
      monthlyMaintenance: isRent ? '' : (form.monthlyMaintenance || ''),
      rentMaintMode: isRent ? (form.rentMaintMode || 'included') : '',
      rentMaintenance: isRent && form.rentMaintMode === 'extra' ? (form.rentMaintenance || '') : '',
      negotiable: !!form.priceNegotiable,
      ...(isCommercialType(form.propertyType) && {
        commercialType: form.commercialType || '',
        shellType: form.shellType || '',
        washrooms: parseInt(form.washrooms, 10) || 0,
        camCharges: form.camCharges || '',
        powerBackup: !!form.powerBackup,
        pantry: !!form.pantry,
        suitableFor: form.suitableFor || [],
        fixtures: form.fixtures || [],
      }),
      ...(isLandType(form.propertyType) && {
        plotLength: form.plotLength || '',
        plotWidth: form.plotWidth || '',
        openSides: form.openSides || '',
        roadWidth: form.roadWidth || '',
        cornerPlot: !!form.cornerPlot,
        boundaryWall: !!form.boundaryWall,
        plotZone: form.plotZone || '',
        naSanctioned: !!form.naSanctioned,
        waterSource: form.waterSource || '',
        electricity: !!form.electricity,
        roadAccess: !!form.roadAccess,
        satbara: !!form.satbara,
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
      /* Duplicate claims are the server's call — this browser has only ever seen the listings it
         posted itself. The two keys stay blank because the moderation queue reads them on rows that
         already carry them, and a listing that stops setting a field is not one that sets it false. */
      duplicateFlag: false,
      duplicateOf: '',
    };

    /* The write of record, ahead of all local bookkeeping and outside the try/catch that swallows a
       localStorage quota error: losing the mirror is survivable, losing the save is not. The edit
       path sends nothing about re-checks — a client that could assert "this edit stays live" would
       be a client that could edit its way around moderation. */
    let saved;
    try {
      const payload = forTheWire(record, form, isRent, editListing?.address);
      saved = editId
        ? await saveListingFields(editId, editPayload(payload, form, editListing))
        : await saveListing(payload);
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not save your listing.' };
    }
    /* Adopt the server's id before anything local is written, or the mirror, the notification link
       and the documents are filed under an id that exists on no server. A create that resolves
       without one is a failure, not an `L<timestamp>` that looks alive only on this machine. */
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

      /* The server's verdict is already in hand on `saved`, so recomputing it here would let the
         mirror disagree with the row it mirrors. The local computation is the mock-provider
         fallback and copies each condition exactly, since any approximation is more permissive
         than the server and would pass a test the API fails. */
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

    /* Documents go through `uploadDocument` for rent as well as sale: the attachment here is the
       evidence behind the Verified Owner badge, so a moderator has to be able to reach it.
       Deliberately non-fatal and outside the try above — the listing already exists server-side, so
       failures are named and handed back for the success screen to report. */
    const documentsFailed = [];
    for (const [category, doc] of Object.entries(documents)) {
      if (!doc || !doc.data) continue;
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

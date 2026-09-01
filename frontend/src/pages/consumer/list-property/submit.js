import {
  addListing, updateListing, addRoom, parseAmount,
} from '../../../lib/store';
import {
  addListing as saveListing,
  updateListingFields as saveListingFields,
  checkOwnDuplicate,
} from '../../../services/propertyService.js';
import { uploadDocument } from '../../../services/documentService.js';
import { evaluateListingDedup } from '../../../lib/data/propertyIdentity.js';
import { evaluateHostEligibility, enqueueFlatmateReview } from '../../../lib/data/flatmates.js';
import { hasAgreementEvidence } from '../flatmates/helpers.js';
import { formatIndian } from './format.js';
import { COMMERCIAL_SUBTYPES, PG_SHARING, isResidentialType, isPgType, isCommercialType, isLandType, isHouseType } from './constants.js';
import { matchLocalityToCanonical } from '../../../data/localities.js';
import {
  classifyChanges, displayValue, recentMaterialEdits,
  FOUNDATION_STAYS_LIVE_KEYS,
  PRICE_REDUCED_PCT, PRICE_JUMP_FLAG_PCT, MATERIAL_EDIT_CAP,
} from './editPolicy.js';
import { requestRecheckFields, clearedRecheckFields } from '../../../lib/mockApi/properties.js';

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
  /* AddressKey derives the duplicate signal from this one line, so it has to carry the unit token:
     "Rohan Nilay, Kharadi" names a building, and every flat in it would look like one property.
     `street` is included because D219 made `address` a re-checked foundation field and the only
     part of the address line the wizard lets an owner edit afterwards is `street` — leave it out
     and they could move the listing without the server ever seeing the change it re-checks for.
     The landmark is not: "opposite the temple" is wayfinding, not identity.

     `storedAddress` is the line the server already holds, and it wins whenever the form has no unit
     token to offer (D237). The wire carries the address as one composed string while the wizard
     carries it as four fields, and splitting one back into four is guesswork — so on an edit opened
     from the server those boxes start empty, and recomposing from them would replace a full
     "B-1204, Tower 2, Green Acres, Baner Road" with whatever fragment the owner happened to retype.
     Losing the flat number there is not a cosmetic downgrade: it is the token that tells one flat
     from its neighbour, so the listing would stop colliding with its own duplicate. */
  address: [form.flatNumber, form.tower, form.society, form.street]
    .map((part) => String(part ?? '').trim()).filter(Boolean).join(', ')
    || storedAddress,
  /* `record.floor` is `parseInt(form.floor) || 0`, which collapses two very different blanks onto
     the same number: "ground floor" and "we never asked". The second is the dangerous one — villas,
     plots and PGs never render the field, so forwarding 0 for them would hand every such listing in
     a society the same (society, floor, bhk) tuple, a duplicate signal fabricated out of an input
     that was never shown, which D219's sweep would then re-file every ten minutes. The guard below
     is on `form.floor`, not on `record.floor`, precisely because 0 cannot tell the two apart.
     'Ground' surviving as 0 is correct and intended: the ground floor is a floor, two ground-floor
     2BHKs in one society are as much of a weak signal as two ninth-floor ones, and the option list
     offers 'Ground' rather than '0' only because that is what people say. */
  floor: form.floor === '' || form.floor == null ? undefined : record.floor,
  // The wizard splits maintenance by deal (and by whether rent includes it); the entity has one column.
  maintenance: parseAmount(isRent ? (form.rentMaintMode === 'extra' ? form.rentMaintenance : '') : form.monthlyMaintenance) || 0,
  // The record calls it `rera` and the contract calls it `reraId`; the mismatch dropped it silently.
  reraId: form.reraId || '',
  /* Lifted out of `strongIds` for the request only, and kept out of `record` on purpose: the record
     is buyer-readable (edit prefill, detail page) and a meter number belongs to the owner. */
  electricityConsumerNo: form.electricityConsumerNo || '',
});

/* The document picker keeps only the base64 preview — `useListingMedia.handleDocUpload` reads the
   file with a `FileReader` and lets the `File` go — while the vault endpoint is multipart, so the
   bytes are reconstructed here. Doing it at upload time rather than holding the `File` in state is
   also what makes a restored draft work: no `File` survives a round trip through storage, but the
   data URL does. Returns null on anything that is not a data URL, which the caller reports rather
   than silently skips. */
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
/* D219. The write crosses the seam now. Everything below still builds the same flat `record` the
   rest of the app reads, but the record is no longer *authored* here — it is handed to
   `propertyService.addListing`, and on the http provider that is `POST /me/listings`, which is the
   only place the server can run the duplicate probe. Until this slice the probe was reachable from
   exactly one screen (admin post-on-behalf), so the detector was blind to the people it was
   written for: owners.

   The local writes that follow are a mirror, not the system of record. **Edit prefill no longer
   depends on them** (D237) — it reads `propertyService.myListing(id)`, because a form that
   prefills from this browser and then PATCHes the server is a form that silently blanks a listing
   the moment the owner opens it on a second device. What still reads the mirror is
   `evaluateListingDedup`'s cross-owner scan and `lib/data/documents.js`.

   Removing the mirror is deliberately *not* part of that change, and the reason is a trap rather
   than a preference: `saveListing` is handed `forTheWire(record, …)`, which carries
   `electricityConsumerNo` — kept out of `record` on purpose, because the record is buyer-readable.
   In mock mode the seam write and this mirror are the same store function, so deleting the mirror
   would leave the wire record as the stored one and put a meter number where the detail page can
   read it. The mirror goes when those two readers do, and the wire/record split is resolved with
   them. */
export const persistListing = async ({ form, user, editId, editListing, documents, photos, photoHashes }) => {
    const mob = (user && user.mobile) || '';

    // Duplicate prevention, in two halves that go to two different places.
    //
    // "Have I already listed this?" is now a question for the server (D226), because it is a
    // question about the caller's real listings and this browser does not hold those. It used to be
    // answered out of `evaluateListingDedup`'s self-arm against the local store, which against a
    // live API is the seeded demo catalogue: the guard could refuse a genuine owner over a fixture,
    // then offer to open an id the server had never issued. Only asked on a create — an edit is by
    // definition already the listing it would match.
    //
    // The other half stays local and stays on the write: a DIFFERENT owner claiming the same unit,
    // or reusing the same photos, still posts and is flagged to Ops. That is an ops signal about
    // somebody else's property, and it is deliberately never reported back to the lister.
    const dedup = evaluateListingDedup({ mobile: mob, fields: form, excludeId: editId, photoHashes });
    if (!editId) {
      const mine = await checkOwnDuplicate({ mobile: mob, fields: form });
      if (mine.found) {
        return { ok: false, blocked: true, existingId: mine.existingId };
      }
    }

    const isRent = form.deal === 'rent';
    const pg = isPgType(form.propertyType);
    const typeMap = { flat: 'Flat', villa: 'Villa', independent: 'Independent House', pg: 'PG / Hostel', plot: 'Plot', openplot: 'Open Plot', farmland: 'Farm Land', commercial: 'Commercial' };
    const subtypeLabel = COMMERCIAL_SUBTYPES.find((s) => s.value === form.commercialType)?.label || '';
    const typeLabel = (form.propertyType === 'commercial' && subtypeLabel) ? subtypeLabel : (typeMap[form.propertyType] || 'Property');
    // BHK only qualifies a residential home; commercial, land and PG carry none.
    const bhkLabel = (isResidentialType(form.propertyType) && !pg && form.bhk) ? (String(form.bhk) === '4' ? '4+ BHK' : form.bhk + ' BHK') : '';
    // A PG is titled by its occupancy; with several offered we lead with the first.
    const primaryShare = pg && Array.isArray(form.sharing) && form.sharing.length ? form.sharing[0] : '';
    const sharingLabel = primaryShare ? (PG_SHARING.find(([v]) => v === primaryShare)?.[1] || '') : '';
    const titlePrefix = pg && sharingLabel ? sharingLabel + ' ' : bhkLabel ? bhkLabel + ' ' : '';
    const title = titlePrefix + typeLabel + (form.locality ? ' in ' + form.locality : '');
    const priceNum = parseAmount(isRent ? form.monthlyRent : form.price);
    // A PG offering multiple occupancies advertises a "from" price (its cheapest bed).
    const multiShare = pg && Array.isArray(form.sharing) && form.sharing.length > 1;
    const priceStr = isRent ? `₹${formatIndian(form.monthlyRent)}/mo${multiShare ? ' onwards' : ''}` : `₹${formatIndian(form.price)}`;
    const areaNum = parseAmount(form.carpetArea || form.builtUp);
    // Bind the listing to a canonical locality. A typed/picked locality (with its Google pin
    // coords) is matched to the registry (matchLocalityToCanonical). Never the old
    // first-word-only truncation, which broke multi-word localities ("Koregaon Park" →
    // "koregaon").
    //
    // An unmatched pick used to MINT a community-tier locality here, so that the listing bound to
    // *some* slug and appeared as a filter chip. It bound to a slug nobody had checked: free text
    // coins a key, so three spellings of one area became three localities with three landing pages
    // and three slices of the search facet — and the ops queue meant to reconcile them lived in the
    // lister's own browser.
    //
    // So an unmatched locality now yields **no slug**, which is exactly what the server does — its
    // resolver declines rather than invents. The listing is left for a human, who files it from
    // Admin ▸ Localities; until then it cannot be approved. That is deliberate: a listing with no
    // locality is absent from locality search, its locality page, saved-search alerts and its
    // society, so publishing one tells the owner it is live to buyers who cannot find it.
    let localitySlug = '';
    if (form.locality) {
      const canon = matchLocalityToCanonical(form.locality, form.propLat, form.propLng);
      if (canon) localitySlug = canon.slug;
    }
    const loc = [form.society, form.locality, 'Pune'].filter(Boolean).join(', ');

    /* The gallery is the owner's own photos when we have a URL that outlives this tab.
       `uploadPhoto` already crossed the seam in an earlier slice, so on the http photo provider
       every entry here is a CDN URL and the listing finally carries the pictures the owner chose —
       until now the record hard-coded four stock images and quietly dropped them.
       A `data:` URL is filtered out deliberately: in mock mode the "upload" is a base64 read in
       the browser, and a handful of those is several megabytes of localStorage — the write would
       blow the quota and lose the whole listing, not just its photos. Offline demo keeps the
       stock set, which is what it has always shown. */
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
      // Society ENTITY binding — the honest link the Society Hub reads (no more
      // hash-faking a listing into a random society). Only a residential/PG unit
      // sits inside a society, so land/commercial never carry a societyId even if
      // one lingers in form state from an earlier type choice.
      societyId: (isLandType(form.propertyType) || isCommercialType(form.propertyType)) ? '' : (form.societyId || ''),
      bhk: bhkLabel,
      bhkNum: bhkLabel ? (parseInt(form.bhk, 10) || 0) : 0,
      bath: (isResidentialType(form.propertyType) && !pg) ? (parseInt(form.bathrooms, 10) || 0) : 0,
      // PG/Hostel discovery signals: matched by shareType, filtered by sharing
      // (an array of the occupancy types offered) with per-type rents preserved.
      ...(pg && { shareType: 'pg', sharing: form.sharing, sharingRents: form.sharingRents || {}, room: 'shared' }),
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
      floor: parseInt(form.floor, 10) || 0,
      age: form.age || '',
      // "Ready to Move" vs "Under Construction" on the detail page reads from this.
      // Only a genuinely under-construction age makes a home "not ready" — a ready
      // home whose owner hands over on a future "Available From" date is still a
      // completed home (no under-construction badge, no GST); its handover date is
      // captured separately in `available`/`possession`.
      construction: form.age === 'under-construction' ? 'new' : 'ready',
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
      // A PG's kitchen is described by its meal plan, not a tenant food rule.
      food: pg ? (form.pgMeals === 'veg' ? 'veg' : 'any') : (form.foodPref || 'any'),
      rera: form.reraId || '',
      lockin: form.lockIn || '0',
      notice: form.noticePeriod || '1',
      available: (isRent || form.possession === 'available') ? form.availableFrom : '',
      // A PG is offered to a gender; a home lists its preferred tenant types.
      tenants: pg ? (form.pgGender || 'any') : (form.preferredTenants || []).join(','),
      // Top-level spec fields the cards & detail page read directly (kept flat so
      // consumers don't have to reach into record.form). Zeroed/blank when N/A.
      balconies: (isResidentialType(form.propertyType) && !pg) ? (parseInt(form.balconies, 10) || 0) : 0,
      builtUp: parseInt(form.builtUp, 10) || 0,
      areaUnit: form.areaUnit || 'sqft',
      parkingSpaces: parseInt(form.parkingSpaces, 10) || 0,
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
      ...(pg && { pgGender: form.pgGender || 'any', pgMeals: form.pgMeals || 'none' }),
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
      // Perceptual hashes of the uploaded photos (not the images themselves) so a
      // future re-list with the same photos can be matched even if the typed
      // address differs. Empty when nothing decoded.
      photoHashes: Array.isArray(photoHashes) ? photoHashes : [],
      strongIds: {
        electricityConsumerNo: form.electricityConsumerNo || '',
        pmcPropertyId: form.pmcPropertyId || '',
        reraId: form.reraId || '',
      },
      // A different owner already claimed this unit → post but flag for Ops.
      // Recomputed on every save (edit excludes the listing itself via excludeId),
      // so resolving a collision on edit clears the flag rather than leaving it stale.
      duplicateFlag: !!dedup.flagForReview,
      duplicateOf: dedup.flaggedAgainstId || '',
      ...(dedup.flagForReview
        ? {
            flagReason:
              dedup.flagBy === 'image'
                ? 'Possible duplicate \u2014 photos match another owner\u2019s active listing.'
                : 'Possible duplicate \u2014 same address / electricity meter as another owner\u2019s active listing.',
          }
        : {}),
    };

    /* ---- Cross the seam ------------------------------------------------
       This is the write of record, and it happens before any of the local bookkeeping below so a
       server that refuses the listing cannot leave the owner looking at a confetti screen for a
       property nobody but this browser has. It is deliberately outside the try/catch further down,
       which exists to swallow a localStorage quota error: losing the mirror is survivable, losing
       the save is not.

       The edit path sends nothing about re-checks or re-moderation. The server decides that for
       itself (ListingEditRules.apply returns an EditImpact) — the block below only mirrors the same
       verdict locally for the readers that still read localStorage, and a client that could
       *assert* "this edit stays live" would be a client that could edit its way around
       moderation. */
    let saved;
    try {
      saved = editId
        ? await saveListingFields(editId, forTheWire(record, form, isRent))
        : await saveListing(forTheWire(record, form, isRent));
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Could not save your listing.' };
    }
    /* A server-created listing gets its id from the server. Adopt it before anything local is
       written, or the mirror, the notification link and the documents would all be filed under an
       id that exists on no server — and the owner's first click after posting would 404. On the
       mock provider the record's own id comes straight back, so nothing moves.

       A create that resolves without an id is treated as a failure rather than quietly kept: the
       fallback would be `L<timestamp>`, which looks like a working listing on this machine and
       exists nowhere else. Better to make the owner retry than to hand them a success screen and a
       dead link. */
    if (!editId) {
      if (!saved || !saved.id) {
        return { ok: false, error: 'Your listing was sent but the server did not confirm it. Please try again.' };
      }
      if (String(saved.id) !== record.id) {
        record.id = String(saved.id);
        record.viewUrl = `/property/${record.id}`;
      }
    }

    try {
      // ---- Edit policy (P0 + P3) ----------------------------------------
      // Editing a listing must never silently pull it down. We classify the
      // change into material (Tier A → schedule a re-check, stays live) vs soft
      // (Tier B → instant), keep an audit log, and raise price/abuse signals.
      if (editId) {
        /* The listing as it was when the editor opened, handed in by the hook rather than read back
           out of `lib/store`. A local read answered about whatever this browser had written, which
           on a live build is usually nothing — so every edit classified as a change from an empty
           record, and every field looked material. */
        const oldListing = editListing || {};
        const oldForm = oldListing.form || oldListing;
        /* `isPubliclyVisible()` server-side is `status == APPROVED && !archived`. Read off the
           record the editor opened rather than from `isListingApproved(editId)`, which asked the
           local store the same question and got the same wrong answer for the same reason. An
           archived listing is not in search, so raising a re-check on one would queue a moderator
           to look at a listing nobody can see. */
        const wasApproved = /approved|verified|live/i.test(String(oldListing.status || '')) && !oldListing.archived;
        const oldPhotoUrls = (oldListing.images || oldListing.gallery || []).filter(Boolean);
        const newPhotoUrls = photos.map((p) => p.url).filter(Boolean);
        const cls = classifyChanges(oldForm, form, oldPhotoUrls, newPhotoUrls);

        // Preserve the live/pending state instead of the default 'pending'.
        record.status = oldListing.status || 'pending';
        record.statusClass = oldListing.statusClass || 'pill-pending';

        // Keep the stored photo hashes when this edit still has photos but they
        // couldn't be re-hashed (e.g. the owner didn't re-upload, or the prefilled
        // gallery is remote/cross-origin) — don't wipe a good fingerprint. But if
        // the owner removed every photo, clear the hashes so we don't flag future
        // listings against photos that no longer exist here.
        if (!Array.isArray(photoHashes) || !photoHashes.length) {
          record.photoHashes = newPhotoUrls.length ? (oldListing.photoHashes || []) : [];
        }

        // If this edit resolved a former auto-duplicate collision, clear our own
        // stale flag reason — but never wipe a flag an admin set manually (their
        // text won't match our "Possible duplicate …" message).
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

        /* The server's stays-live re-check (Q14), mirrored into the mock store so the moderation
           queue exists in both modes.

           When the API answers, its verdict is the one that counts, and it is already in hand:
           `PropertyResponse` carries `recheckPending`, `recheckReason` and `recheckRequestedAt`
           (mapped by `propertyMapper`), so `saved` has the answer the server actually recorded.
           Recomputing it client-side and storing that instead was how this used to work, and it
           meant the mirror could disagree with the row it mirrors -- silently, and in the direction
           the client happened to guess. The local computation below is now the fallback for the
           mock provider, which returns no such fields because it has no server to have decided
           them.

           The fallback copies three conditions rather than approximating them, because each is a
           way for the mock to be *more permissive* than the server and so to pass a test the API
           would fail:
             - only when the listing was already approved (`isPubliclyVisible`) -- a pending listing
               is in front of a moderator already and a second work item is queue noise;
             - never alongside an off-search change, because re-moderation supersedes a re-check
               (`recheckOnly && !remoderationRequired`) and looks at the whole listing anyway;
             - the timestamp is preserved across edits by `requestRecheckFields`, so age is honest. */
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
          /* Re-moderation supersedes: the server's `ListingService.update` calls
             `Property.revertToPending()` on this path, and that calls `clearRecheck()`. Carrying
             the old re-check forward instead would leave a listing sitting in *both* queues, and
             the moderator who is about to re-approve the whole thing would then still owe someone
             a re-check of a field they had already looked at. */
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

      // Mirror into the per-user store — still read by edit prefill, the browser-side dedup and
      // the documents shelf, none of which have crossed the seam yet.
      if (editId) {
        updateListing(editId, record);
        // The re-review note used to be composed here and written to localStorage, which meant the
        // sentence explaining why a listing had gone dark existed only on the machine that made the
        // edit — and was signed "PuneNest" by the very person it was addressed to. The server writes
        // it now, into the same verification thread ops reads (see ListingService.update).
      } else {
        addListing(record);
        // Likewise the duplicate warning: it was addressed to an ops desk that could not read it.
        // ListingService.create runs the probe and opens the case.
      }

      // Bug #11 fix: Push notification on new listing (mirrors HTML behavior)
      if (!editId) {
        try {
          const notifs = JSON.parse(localStorage.getItem('puneNestNotifications') || '[]');
          notifs.unshift({ id: 'n' + Date.now(), type: 'listing', title: 'Property listed!', desc: `Your ${title} is now under review.`, time: 'Just now', link: record.viewUrl, unread: true });
          localStorage.setItem('puneNestNotifications', JSON.stringify(notifs));
        } catch { /* quota */ }
      }

    } catch {
      /* localStorage quota — listing core is tiny, so this should not happen;
         swallow so the success flow still completes. */
    }

    /* The documents go to the server, not only to this browser.

       This was `addDocument(...)` straight into localStorage, and only for sale listings. Both
       halves were wrong once there is a server. The file an owner attaches here is the one that
       earns the Verified Owner badge (`ownershipDocKeyFor`), so filing it in the lister's own
       browser put the evidence in the one place the moderator who has to check it can never look:
       every owner-posted listing was unverifiable by construction, and nothing said so — the upload
       control showed a filename and the progress meter ticked over.

       The `!isRent` guard was the same mistake in miniature. Rent has its own ownership document
       ('Ownership Proof', or the 7/12 Extract on land — see `ownershipDocKeyFor`), the progress
       meter counts it, and the wizard collected it and then dropped it.

       `uploadDocument` is the seam the owner's vault tab already uses. On the mock provider it
       calls the very `addDocument` this replaces, against the same store and key, so browser
       behaviour does not move; on http it is `POST /me/documents/{propId}`, which resolves the slug
       we hold as well as a UUID (`DocumentService.ownedProperty`).

       Deliberately outside the swallowing try above, and deliberately not fatal. The listing exists
       server-side by this point, so failing the post would tell an owner their property was not
       listed when it was. The failures are named and handed back for the success screen to report,
       where the vault is one tap away — a silent drop here is exactly the bug being fixed, and
       replacing it with a different silent drop would not be an improvement.

       The old 3 MB `tooLarge` branch is gone rather than ported: `useListingMedia` refuses a file
       over `MAX_DOC_BYTES` (3 MB) at the picker, so `doc.size > CAP` could never be true here. */
    const documentsFailed = [];
    for (const [category, doc] of Object.entries(documents)) {
      if (!doc || !doc.data) continue;
      const file = fileFromDataUrl(doc.data, doc.name, doc.mime);
      if (!file) { documentsFailed.push(category); continue; }
      try {
        await uploadDocument(mob, record.id, { category, file });
      } catch {
        documentsFailed.push(category);
      }
    }
    // The record travels back so the success screen can offer to let a brand-new
    // rent listing room by room, at the moment the owner is already thinking
    // about how to fill it. `documentsFailed` travels with it so the same screen can
    // name any paper that did not make it, instead of the owner finding out from a
    // moderator weeks later that the listing cannot be verified.
    return { ok: true, listing: record, documentsFailed };
};

export const persistFlatmate = ({ form, user, photos }) => {
    const mob = (user && user.mobile) || '';
    const id = 'room-' + Date.now();
    const rent = parseAmount(form.rentShare);
    const flatType = form.bhk ? (String(form.bhk) === '4' ? '4+ BHK' : form.bhk + ' BHK') : '';
    const imgs = photos.map((p) => p.url);
    const gender = form.lookingFor || 'any';
    const lifestyle = form.lifestyle || [];

    // Host eligibility mirrors the flatmate GROUPS flow. Identity is guaranteed
    // by L1 sign-in (the floor) — not by an Aadhaar gate. Under badge-not-gate,
    // Aadhaar is an opt-in badge that earns visibility, never a precondition for
    // posting. 'owner' lists their own flat (trust is earned once Ops verifies the
    // listing docs); a 'tenant' self-attests a registered agreement, so tenant
    // posts are routed to the Ops review queue.
    const role = form.hostRole === 'tenant' ? 'tenant' : 'owner';
    // Tenant tier requires both the declaration AND the uploaded agreement Ops verifies.
    // Declared-without-upload stays identity tier (still lists, just no host badge).
    const agreementDoc = role === 'tenant' && form.agreementDeclared ? (form.agreementDoc || null) : null;
    const agreementDeclared = role === 'tenant' ? (!!form.agreementDeclared && hasAgreementEvidence(agreementDoc)) : false;
    const verificationTier = role === 'owner' ? 'owner' : (agreementDeclared ? 'tenant' : 'identity');
    // A shared room offers two beds; a private room, one. Seats start fully open
    // and the owner backfill stepper adjusts seatsOpen as flatmates come and go.
    const seatsTotal = form.roomType === 'Shared room' ? 2 : 1;

    // Anti-broker guardrails: cap live shares per identity + dedupe the address.
    // A hard block (cap hit / same host re-claiming an address) stops the save; a
    // soft flag (a different host already claimed this address) still posts but is
    // routed to Ops. Owner tier is exempt from the numeric cap.
    const guard = evaluateHostEligibility({
      mobile: mob,
      tier: verificationTier,
      address: { society: form.society, locality: form.locality },
    });
    if (guard.blocked) return { ok: false, reason: guard.reason };

    addRoom({
      id,
      type: 'flatmate',
      owner: (user && user.name) || '',
      ownerMobile: mob,
      bhk: form.bhk, flatType, roomType: form.roomType, furnishing: form.furnishing,
      // Room-specific: washroom (attached/shared) is a top seeker question; home
      // type + gated + floors-in-house cover independent houses/villas, not just
      // society flats. floorsInHouse is only meaningful for a house.
      attachedBath: form.attachedBath || '',
      propertyType: form.propertyType || 'flat',
      homeTypeLabel: form.homeTypeLabel || 'Flat',
      gatedCommunity: !!form.gatedCommunity,
      floorsInHouse: isHouseType(form.propertyType) ? (form.floorsInHouse || '') : '',
      // Physical-flat details — same asset as a whole-place let, so a room share
      // carries the same specs, address, and furniture for seekers to evaluate.
      bathrooms: parseInt(form.bathrooms, 10) || 0,
      balconies: parseInt(form.balconies, 10) || 0,
      carpetArea: parseAmount(form.carpetArea), builtUp: parseAmount(form.builtUp),
      area: parseAmount(form.carpetArea || form.builtUp),
      floor: isHouseType(form.propertyType) ? 0 : (parseInt(form.floor, 10) || 0),
      totalFloors: isHouseType(form.propertyType) ? 0 : (parseInt(form.totalFloors, 10) || 0),
      facing: form.facing || '', age: form.age || '', furniture: form.furniture || [],
      locality: form.locality, localities: form.locality ? [form.locality] : [], society: form.society, societyId: isHouseType(form.propertyType) ? '' : (form.societyId || ''),
      flatNumber: form.flatNumber || '', tower: form.tower || '', street: form.street || '',
      landmark: form.landmark || '', pincode: form.pincode || '',
      lat: form.propLat, lng: form.propLng,
      rentShare: form.rentShare, budget: rent, deposit: parseAmount(form.deposit), availableFrom: form.availableFrom,
      lookingFor: gender, gender, foodPref: form.foodPref, food: form.foodPref,
      lifestyle, tags: lifestyle,
      photos: imgs, img: imgs[0] || '', note: form.note,
      hostRole: role, verificationTier, agreementDeclared,
      ownerConsentMobile: role === 'tenant' ? (form.ownerConsentMobile || '') : '',
      seatsTotal, seatsOpen: seatsTotal,
      addressFingerprint: guard.fingerprint, flagForReview: guard.flagForReview,
      verified: false, time: 'Just now',
      status: 'pending', createdAt: new Date().toISOString(),
    });

    // Tenant declarations are self-attested, and contested addresses are fuzzy —
    // both go to Ops to verify. Owner tier is vetted via the listing's own docs.
    if (verificationTier === 'tenant' || guard.flagForReview) {
      enqueueFlatmateReview({
        roomId: id,
        kind: 'room',
        host: (user && user.name) || '',
        hostMobile: (mob || '').replace(/\D/g, ''),
        address: (form.society || 'Room') + ' · ' + (form.locality || 'Pune'),
        tier: verificationTier,
        flagForReview: guard.flagForReview,
        ownerConsent: false,
        agreementDoc,
      });
    }

    // Mirror the property-listing flow: notify the owner their post is under review.
    try {
      const notifs = JSON.parse(localStorage.getItem('puneNestNotifications') || '[]');
      notifs.unshift({ id: 'n' + Date.now(), type: 'listing', title: 'Flatmate listing posted!', desc: `Your flatmate listing${form.locality ? ' in ' + form.locality : ''} is now under review.`, time: 'Just now', link: '/dashboard#listings', unread: true });
      localStorage.setItem('puneNestNotifications', JSON.stringify(notifs));
    } catch { /* quota */ }
    return { ok: true };
};

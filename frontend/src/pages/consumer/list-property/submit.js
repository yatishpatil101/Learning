import {
  addListing, updateListing, addRoom, parseAmount,
  getListing, isListingApproved,
  ensureOwnerReview, addPropReviewAdminNote,
  addCommunityLocality,
} from '../../../lib/store';
import { mutateDb } from '../../../lib/mockApi';
import { addDocument } from '../../../lib/data/documents.js';
import { evaluateListingDedup } from '../../../lib/data/propertyIdentity.js';
import { evaluateHostEligibility, enqueueFlatmateReview } from '../../../lib/data/flatmates.js';
import { hasAgreementEvidence } from '../flatmates/helpers.js';
import { formatIndian } from './format.js';
import { COMMERCIAL_SUBTYPES, PG_SHARING, isResidentialType, isPgType, isCommercialType, isLandType, isHouseType } from './constants.js';
import { matchLocalityToCanonical, slugifyLocality } from '../../../data/localities.js';
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

/* ---------- listing persistence ---------- */
export const persistListing = ({ form, user, editId, documents, photos, photoHashes }) => {
    const mob = (user && user.mobile) || '';

    // Duplicate prevention. Same owner + same physical unit (electricity meter /
    // tax ID / society+unit+pincode) → block and send them to the existing
    // listing. A different owner claiming the same unit — or reusing the same
    // photos — still posts but is flagged to Ops. Editing excludes the listing itself.
    const dedup = evaluateListingDedup({ mobile: mob, fields: form, excludeId: editId, photoHashes });
    if (!editId && dedup.blocked) {
      return { ok: false, blocked: true, existingId: dedup.existingId };
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
    // Bind the listing to a canonical locality. A typed/picked locality (with its
    // Google pin coords) is matched to the registry (matchLocalityToCanonical);
    // an unmatched real pick MINTS a community-tier locality (system of record)
    // so the listing still binds to a stable canonical slug and surfaces as a
    // filter chip. Never the old first-word-only truncation, which broke
    // multi-word localities ("Koregaon Park" → "koregaon").
    let localitySlug = '';
    if (form.locality) {
      const canon = matchLocalityToCanonical(form.locality, form.propLat, form.propLng);
      if (canon) {
        localitySlug = canon.slug;
      } else {
        const minted = addCommunityLocality({ name: form.locality, lat: form.propLat, lng: form.propLng, pincode: form.pincode, source: 'listing' });
        localitySlug = (minted && minted.slug) || slugifyLocality(form.locality);
      }
    }
    const loc = [form.society, form.locality, 'Pune'].filter(Boolean).join(', ');

    const gallery = [
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

    try {
      // ---- Edit policy (P0 + P3) ----------------------------------------
      // Editing a listing must never silently pull it down. We classify the
      // change into material (Tier A → schedule a re-check, stays live) vs soft
      // (Tier B → instant), keep an audit log, and raise price/abuse signals.
      if (editId) {
        const oldListing = getListing(editId) || {};
        const oldForm = oldListing.form || oldListing;
        /* `isPubliclyVisible()` server-side is `status == APPROVED && !archived`. `isListingApproved`
           only matches the status half, and an archived listing is not in search — raising a
           re-check on one would queue a moderator to look at a listing nobody can see. */
        const wasApproved = isListingApproved(editId) && !oldListing.archived;
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
           queue exists in both modes. `ListingService.update` calls `Property.requestRecheck` for a
           price/furnishing/possession edit on a publicly visible listing: the listing keeps
           `approved` and stays in search, and a work item is filed for a moderator.

           Three conditions are copied rather than approximated, because each one is a way for the
           mock to be *more permissive* than the server and so to pass a test the API would fail:
             - only when the listing was already approved (`isPubliclyVisible`) — a pending listing
               is in front of a moderator already and a second work item is queue noise;
             - never alongside an off-search change, because re-moderation supersedes a re-check
               (`recheckOnly && !remoderationRequired`) and looks at the whole listing anyway;
             - the timestamp is preserved across edits by `requestRecheckFields`, so age is honest. */
        const staysLiveWireFields = wasApproved && !cls.remoderation.length
          ? [...new Set(cls.staysLive.map((c) => STAYS_LIVE_FORM_TO_WIRE[c.key]).filter(Boolean))]
          : [];
        if (staysLiveWireFields.length) {
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

      // Persist to the mock API DB
      mutateDb((db) => {
        const i = db.listings.findIndex((p) => p.id === listingId);
        if (i >= 0) db.listings[i] = { ...db.listings[i], ...record };
        else db.listings.unshift(record);
      });

      // Persist to per-user store
      if (editId) {
        updateListing(editId, record);
        // Notify the owner (and open a re-review thread) only when a live listing
        // was materially edited — soft edits go live silently.
        if (record.reReview) {
          ensureOwnerReview(record);
          const names = record.reReview.fields.map((f) => f.label).join(', ');
          addPropReviewAdminNote(
            record.id,
            `You updated: ${names}. Your listing stays live \u2014 our team is re-checking these details and will confirm shortly.`,
          );
        }
      } else {
        addListing(record);
        // A different owner already has this unit live → open an Ops review
        // thread so the team can confirm ownership before this goes public.
        if (record.duplicateFlag) {
          ensureOwnerReview(record);
          addPropReviewAdminNote(
            record.id,
            'Possible duplicate: another owner already has an active listing at this address / electricity meter. Verify ownership before approving.',
          );
        }
      }

      // Bug #11 fix: Push notification on new listing (mirrors HTML behavior)
      if (!editId) {
        try {
          const notifs = JSON.parse(localStorage.getItem('puneNestNotifications') || '[]');
          notifs.unshift({ id: 'n' + Date.now(), type: 'listing', title: 'Property listed!', desc: `Your ${title} is now under review.`, time: 'Just now', link: viewUrl, unread: true });
          localStorage.setItem('puneNestNotifications', JSON.stringify(notifs));
        } catch { /* quota */ }
      }

      // Bug #10 fix: Only store docs for sale listings (rent skips, matching HTML)
      if (!isRent) {
        const CAP = 3 * 1024 * 1024;
        Object.entries(documents).forEach(([category, doc]) => {
          if (!doc) return;
          const tooLarge = (doc.size || 0) > CAP;
          addDocument(mob, listingId, {
            category,
            name: doc.name || 'Document',
            size: doc.size || 0,
            mime: doc.mime || '',
            dataUrl: tooLarge ? null : (doc.data || null),
            tooLarge,
          });
        });
      }
    } catch {
      /* localStorage quota — listing core is tiny, so this should not happen;
         swallow so the success flow still completes. */
    }
    // The record travels back so the success screen can offer to let a brand-new
    // rent listing room by room, at the moment the owner is already thinking
    // about how to fill it.
    return { ok: true, listing: record };
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

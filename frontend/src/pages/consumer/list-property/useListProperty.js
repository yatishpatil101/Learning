import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext.jsx';
import { useFormDraft } from '../../../lib/hooks';
import { parseAmount } from '../../../lib/format';
import { myListing } from '../../../services/propertyService.js';
import { createRoom } from '../../../services/flatmateService.js';
import { loadListingQuota } from '../../../lib/data/listingQuota.js';
import { formatIndian } from './format.js';
import { haptic } from '../../../lib/haptics.js';
import {
  isResidentialType, isLandType, isCommercialType, isHouseType, isPgType,
} from './constants.js';
import { initialForm } from './initialForm.js';
import { classifyChanges } from './editPolicy.js';
import { scrollToError, validateStep1, validateStep2, validateStep3, validateFlatmateStep1, validateFlatmateStep2 } from './validation.js';
import { triggerConfetti } from './confetti.js';
import { persistListing } from './submit.js';
import { hasAgreementEvidence } from '../flatmates/helpers.js';
import { hashPhotos } from '../../../lib/data/imageHash.js';
import { computeProgress } from './progress.js';
import useListingMedia from './useListingMedia';
import useListingLocation from './useListingLocation';

export default function useListProperty() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  // Entry from Flatmates's "List your room" — a sitting tenant looking for a
  // replacement flatmate. Pre-selects the flatmate track + tenant host role so
  // they land on a ready-to-fill room form instead of re-picking those choices.
  const flatmateMode = searchParams.get('flatmate') === '1';

  const [currentStep, setCurrentStep] = useState(1);
  const [rentMode, setRentMode] = useState(() => (flatmateMode && !editId ? 'flatmate' : 'whole')); // whole | flatmate
  const [showSuccess, setShowSuccess] = useState(false);
  // The rent listing just published, when it's eligible to be let room by room.
  const [postedListing, setPostedListing] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [errors, setErrors] = useState({});

  /* Edit-mode policy state (P0/P1/P2). editOrig snapshots what the listing
     looked like when opened, so we can diff the owner's changes into tiers. */
  const editOrigRef = useRef(null);
  const [editApproved, setEditApproved] = useState(false);
  const [showIdentityGuard, setShowIdentityGuard] = useState(false);
  // Duplicate-property guard — the owner already has this unit listed.
  const [showDupGuard, setShowDupGuard] = useState(false);
  /* D219 turned posting into a network write, which widened the double-click window from a few
     milliseconds of localStorage work into a full round trip on a phone. Two POSTs mean two rows,
     and this is the one duplicate the duplicate detector cannot help with: `findDuplicateCandidates`
     excludes the caller's own listings by design, so the slice built to catch duplicates would be
     manufacturing the single kind it is blind to. */
  const [posting, setPosting] = useState(false);
  const [dupExistingId, setDupExistingId] = useState('');
  /* Freemium quota is fixed for this page load — a new post over the limit is
     paywalled; editing an existing listing never is.

     Both numbers come from the server (see `lib/data/listingQuota.js`). Starts permissive and is
     decided once they resolve. The order matters: deciding before the answer arrives would read a
     zero allowance and paywall an owner who is entitled to post. The opposite slip — a
     quota-exhausted owner seeing the form for the moment before the ceiling is known — costs
     nothing, because posting is gated again on submit, server-side. */
  const [canPost, setCanPost] = useState(true);
  const [quota, setQuota] = useState({ used: 0, allowance: null });
  useEffect(() => {
    // `authLoading` is load-bearing, not defensive. Both halves of the quota are per-user calls, so
    // deciding before the session resolves asks the server about nobody and gets an empty answer
    // back — which reads as "zero listings used" and un-gates the paywall for exactly the owner it
    // exists to stop.
    if (editId || authLoading) return undefined;
    // Deliberately no "decide only once" ref here. One was tried, and under StrictMode it made the
    // paywall vanish entirely: the first mount set the ref, its cleanup set the in-flight guard
    // false, and the second mount then returned early — so the answer arrived and was thrown away.
    // The deps are already stable enough to settle this after one round trip.
    let live = true;
    loadListingQuota(user).then((q) => {
      if (!live) return;
      setQuota({ used: q.used, allowance: q.allowance });
      setCanPost(q.canPost);
    });
    return () => { live = false; };
  }, [editId, authLoading, user]);
  /** What the paywall prints: the owner's live listings, and the ceiling they are measured against. */
  const activeListingCount = useCallback(() => quota.used, [quota.used]);
  const planListingLimit = useCallback(() => quota.allowance, [quota.allowance]);

  const [form, setForm] = useState(initialForm);
  // Always-fresh mirror of `form` so async callbacks (e.g. reverse-geocode auto-fill,
  // which resolves after a network round-trip) can read the latest field values without
  // capturing a stale render closure.
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);

  const media = useListingMedia({ errors, setErrors });
  const { photos, setPhotos, video, setVideo, documents, setDocuments } = media;

  const location = useListingLocation({ setForm, formRef, errors, setErrors });
  const { set, locationSet, setLocationSet } = location;

  const { restored: draftRestored, clear: clearFormDraft, startFresh } = useFormDraft('pnDraft:list-property', form, setForm);

  const isFlatmateMode = form.deal === 'rent' && rentMode === 'flatmate';

  /* Live completion — every applicable field feeds the meter, so it only reads
     100% once nothing (mandatory or optional) is left blank. Derived during
     render (no effect) so every keystroke nudges the meter. */
  const progressState = useMemo(
    () => computeProgress({ form, photos, documents, video, isFlatmateMode }),
    [form, photos, documents, video, isFlatmateMode],
  );

  useEffect(() => {
    // Prefill the room-listing intent when arriving from Flatmates. Runs after
    // the draft restore above so the tenant's intent wins over a stale draft, and
    // is skipped in edit mode so it never overwrites an existing listing.
    if (flatmateMode && !editId) {
      setForm((f) => ({ ...f, deal: 'rent', propertyType: 'flat', hostRole: 'tenant' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The listing being edited, read through the seam.

     This used to be a synchronous `getListing(editId)` out of localStorage, and that is the worst
     shape a stale read can take: not "the screen renders empty", but "the screen renders empty and
     then saves". An owner reaching the editor on a second device, after clearing site data, or
     through the "Add photos" link on an enquiry — which is built from a server-side id and so never
     matched this browser at all — got the blank default form, and submitting it would have PATCHed
     those defaults over a listing that was not blank.

     Kept in state as well as in the diff ref because `persistListing` needs the *opened* record to
     classify the edit, and it can no longer fetch it for itself. */
  const [editListing, setEditListing] = useState(null);
  useEffect(() => {
    if (!editId) { setEditListing(null); return undefined; }
    let alive = true;
    myListing(editId, user)
      .then((listing) => {
        if (!alive || !listing) return;
        setEditListing(listing);
        const snap = listing.form || listing;
        setForm((prev) => ({ ...prev, ...snap }));
        const imgs = listing.images || listing.gallery || [];
        if (imgs.length) setPhotos(imgs.map((url) => ({ url, category: 'Other' })));
        if (listing.video) setVideo(listing.video);
        if (listing.documents) setDocuments(listing.documents);
        // A saved listing already carries real coordinates, so treat it as located.
        if (snap.propLat != null && snap.propLng != null) setLocationSet(true);
        // Snapshot the opened state for tier diffing + remember if it's live.
        editOrigRef.current = { form: { ...initialForm, ...snap }, photoUrls: imgs.filter(Boolean) };
        setEditApproved(/approved|verified|live/i.test(String(listing.status || '')));
      })
      .catch(() => { /* the form stays on its defaults; the submit guard below refuses to save. */ });
    return () => { alive = false; };
  }, [editId, user]);

  /* Live tier classification of the owner's in-progress edit (P1). */
  const editChanges = useMemo(() => {
    if (!editId || !editOrigRef.current) return null;
    const o = editOrigRef.current;
    return classifyChanges(o.form, form, o.photoUrls, photos.map((p) => p.url).filter(Boolean));
  }, [editId, form, photos]);

  // The submit button sits at the bottom of a long step, so the window is scrolled
  // down when success fires. Snap back to the top so the centred success card is
  // in view rather than empty space below it.
  useEffect(() => {
    if (showSuccess) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [showSuccess]);

  // Keep the PG per-occupancy rents (and the derived "from" price) in sync with the
  // sharing types actually offered. Unchecking a sharing type in Step 1 must drop its
  // stale rent and recompute monthlyRent as the cheapest remaining bed — otherwise a
  // card could advertise a "from ₹X" for an occupancy no longer on offer.
  useEffect(() => {
    if (!isPgType(form.propertyType)) return;
    const selected = form.sharing || [];
    const rents = form.sharingRents || {};
    const pruned = {};
    selected.forEach((k) => { if (rents[k] != null && rents[k] !== '') pruned[k] = rents[k]; });
    const vals = Object.values(pruned).map((v) => parseInt(v, 10)).filter((n) => n > 0);
    const nextMonthly = vals.length ? String(Math.min(...vals)) : '';
    const rentsChanged = Object.keys(pruned).length !== Object.keys(rents).length;
    if (rentsChanged || nextMonthly !== form.monthlyRent) {
      setForm((prev) => ({ ...prev, sharingRents: pruned, monthlyRent: nextMonthly }));
    }
    // Intentionally keyed only on the sharing set + type; rent edits recompute inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.sharing, form.propertyType]);

  const toggleInArray = useCallback((field, value) => {
    setForm((prev) => {
      const arr = prev[field] || [];
      return { ...prev, [field]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] };
    });
  }, []);

  const toggleTenant = useCallback((value) => {
    setForm((prev) => {
      let arr = prev.preferredTenants || [];
      if (value === 'anyone') return { ...prev, preferredTenants: arr.includes('anyone') ? [] : ['anyone'] };
      arr = arr.filter((x) => x !== 'anyone');
      arr = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
      return { ...prev, preferredTenants: arr };
    });
  }, []);

  // Switching property type must not leave another type's answers hiding in state.
  // A user who filled commercial fields then picked "Flat" would otherwise silently
  // save washrooms/shell-type/CAM etc. Reset every type-specific field back to its
  // default so each category always starts clean (mirrors the admin cascade).
  const TYPE_SPECIFIC_KEYS = [
    'commercialType', 'sharing', 'sharingRents', 'pgGender', 'pgMeals',
    'washrooms', 'shellType', 'parkingSpaces', 'powerBackup', 'pantry', 'camCharges', 'suitableFor',
    'areaUnit', 'plotLength', 'plotWidth', 'openSides', 'roadWidth', 'cornerPlot', 'boundaryWall',
    'plotZone', 'naSanctioned', 'waterSource', 'electricity', 'roadAccess', 'satbara',
    'plotArea', 'floorsInHouse', 'furniture', 'monthlyRent',
  ];
  const changePropertyType = useCallback((v) => {
    setForm((prev) => {
      const next = { ...prev, propertyType: v };
      TYPE_SPECIFIC_KEYS.forEach((k) => { next[k] = initialForm[k]; });
      return next;
    });
    if (!isResidentialType(v) || isPgType(v)) setRentMode('whole');
    setErrors((prev) => {
      const n = { ...prev };
      ['propertyType', 'commercialType', 'sharing', 'monthlyRent', 'plotArea', 'washrooms', 'shellType'].forEach((k) => delete n[k]);
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isResidential = () => isResidentialType(form.propertyType);
  const isLand = () => isLandType(form.propertyType);
  const isCommercial = () => isCommercialType(form.propertyType);
  const isHouse = () => isHouseType(form.propertyType);
  const isPg = () => isPgType(form.propertyType);

  /* ---------- money / deposit ---------- */
  const money = (field) => ({
    value: formatIndian(form[field]),
    onChange: (e) => set(field, e.target.value.replace(/\D/g, '')),
  });
  const setDepositMonths = (months) => {
    const rent = parseAmount(form.monthlyRent);
    if (rent > 0) set('deposit', String(rent * months));
  };

  /* ---------- validation ---------- */
  const nextStep = () => {
    const err = isFlatmateMode
      ? (currentStep === 1 ? validateFlatmateStep1(form) : validateFlatmateStep2(form))
      : (currentStep === 1 ? validateStep1(form) : currentStep === 2 ? validateStep2(form) : {});
    // Step 2 also requires the property to be placed on the map — a locality pick,
    // a search, or a pin drag — so a listing is never geo-pinned to the default.
    if (currentStep === 2 && !locationSet) err.location = true;
    if (Object.keys(err).length) { setErrors(err); scrollToError(err); return; }
    setErrors({});
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      /* Two beats, not one: this is progress through the posting funnel, not a
         toggle. It also fires only on a *successful* advance — the early return
         above means a validation failure stays silent, so the tick means "you got
         through", never "something happened". */
      haptic('step');
    }
  };
  const prevStep = () => {
    if (currentStep > 1) { setCurrentStep(currentStep - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };

  /* Start over — wipe the saved draft and every in-memory field, then remount
     fresh. startFresh() clears the autosaved draft and reloads, which also
     resets photos, documents and the step position in one clean sweep. */
  const openResetConfirm = useCallback(() => setShowResetConfirm(true), []);
  const confirmReset = useCallback(() => startFresh(), [startFresh]);

  const finalizeListing = async () => {
    /* An edit that never loaded its listing must not save. The form is on its defaults at this
       point, so a PATCH would put those defaults over the owner's real record — the failure mode
       the seam read above exists to close, and the one place where being permissive costs data. */
    if (editId && !editListing) {
      toast(t('listProperty.editLoadFailed', 'We could not load that listing. Reload the page and try again.'), 'error');
      return;
    }
    // Perceptual hashes of the uploaded photos let Ops catch a re-list that reuses
    // the same photos under a different typed address. Computed here (browser) so
    // the store stays synchronous; failures degrade to no image signal.
    let photoHashes = [];
    try { photoHashes = await hashPhotos(photos); } catch { photoHashes = []; }
    const res = await persistListing({ form, user, editId, editListing, documents, photos, photoHashes });
    // Same owner already has this exact property live → stop and point them to it.
    if (res && res.ok === false && res.blocked) {
      setDupExistingId(res.existingId || '');
      setShowDupGuard(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    /* The save crosses the seam now, so it can fail for reasons the browser cannot fix — a
       rejected field, an expired session, a server that is down. Say so and leave the form
       exactly as it is: the draft is still saved, so nothing the owner typed is lost, and they
       can press Post again. Confetti over a listing that was never created would be worse than
       any error message. */
    if (res && res.ok === false) {
      toast(res.error || 'Could not save your listing. Please try again.', 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    clearFormDraft();
    /* The server has just incremented this account's lifetime listing tally, and nothing else would
       tell this session about it: AuthContext revalidates on mount only, so `hasEverListed` would
       keep answering false — showing a fresh owner the seeker plan card and the seeker referral
       badge — until the next full page load. Not awaited: the confetti below does not depend on it,
       and a slow /auth/me must not hold up the success screen.

       Knock-on, intended: the fresh profile is a new object identity, so the quota effect above
       (keyed on `user`) re-runs and re-decides `canPost` off the slot this post just consumed. One
       extra round trip on the success screen, and the answer is more current than the one it
       replaces — but it is a coupling, so do not narrow that effect's deps without deciding what
       should refresh the quota instead. */
    if (!editId) refreshUser();
    /* The listing is saved; one or more of its papers is not. Not an error — the property is
       genuinely listed and the confetti is earned — but it cannot be left silent either, because
       the ownership document is what earns the Verified Owner badge and an owner who is never told
       it failed will believe it is on file. Name the categories and point at the vault, which is
       where they can add it again without re-posting. */
    if (res?.documentsFailed?.length) {
      toast(`Listed, but we could not upload ${res.documentsFailed.join(', ')}. Add it again from Dashboard ▸ Documents.`, 'error');
    }
    /* Nothing is credited to the referrer here any more. This used to call
       `creditReferrerForListing()`, which queued a free listing slot into a browser-side ledger the
       same browser could drain — so posting from a second device earned the slot twice and a
       referral the fraud desk clawed back kept paying out forever. The server grants it instead,
       from the referee's first listing passing ownership verification, which is the qualifying
       action a browser cannot fake. */
    triggerConfetti();
    // A brand-new rent listing can also be let room by room — offered on the
    // success screen while the owner is still thinking about how to fill it.
    // Sale listings and edits can never be split.
    const splittable = !editId && res?.listing?.deal === 'rent';
    if (splittable) setPostedListing(res.listing);
    setShowSuccess(true);
    // Don't yank the screen away mid-decision while that offer is on it.
    if (!splittable) setTimeout(() => navigate('/dashboard'), 3200);
  };

  const submitProperty = () => {
    if (posting) return;
    const err = validateStep3(form, documents, photos);
    if (Object.keys(err).length) { setErrors(err); scrollToError(err); return; }

    if (!editId && !canPost) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (editId && editChanges?.identityChanged) { setShowIdentityGuard(true); return; }

    /* `finalizeListing` is async and nothing awaits it here, so an unhandled rejection anywhere
       after the save would leave `posting` stuck true and the button dead. Clear it in `finally`
       and surface the failure, rather than trusting every line in between not to throw. */
    setPosting(true);
    finalizeListing()
      .catch(() => toast('Could not post your listing. Please try again.', 'error'))
      .finally(() => setPosting(false));
  };

  const submitFlatmate = async () => {
    const err = {};
    if (!form.bhk) err.bhk = true;
    if (!form.roomType) err.roomType = true;
    if (!form.locality) err.locality = true;
    if (!form.society.trim()) err.society = true;
    if (!(Number(form.rentShare) > 0)) err.rentShare = true;
    if (!form.availableFrom) err.availableFrom = true;
    if (!photos.length) err.photos = true;
    if (Object.keys(err).length) { setErrors(err); scrollToError(err); return; }
    if (posting) return;
    setPosting(true);
    try {
      const agreementDoc = form.hostRole === 'tenant' && form.agreementDeclared ? form.agreementDoc : null;
      const house = isHouseType(form.propertyType);
      await createRoom({
        bhk: form.bhk,
        roomType: form.roomType,
        attachedBath: form.attachedBath,
        furnishing: form.furnishing,
        locality: form.locality,
        societyId: house ? '' : (form.societyId || ''),
        society: form.society,
        flatNumber: form.flatNumber,
        rentShare: form.rentShare,
        deposit: parseAmount(form.deposit),
        availableFrom: form.availableFrom,
        lookingFor: form.lookingFor,
        foodPref: form.foodPref,
        lifestyle: form.lifestyle,
        hostRole: form.hostRole,
        agreementDeclared: !!form.agreementDeclared && hasAgreementEvidence(agreementDoc),
        agreementDoc,
        ownerConsentMobile: form.ownerConsentMobile,
        photos: photos.map((photo) => photo.url),
        note: form.note,
        lat: form.propLat,
        lng: form.propLng,
        /* The physical detail of the flat the room sits in. A room share is the same asset a
           whole-place let would describe, so seekers get the same specs to judge it by. The wire
           contract does not carry these yet — http/flatmateProvider's `clean()` whitelist drops
           them on the way out — but they are shaped here, once, rather than in a second copy of
           this payload that only the mock could see. */
        propertyType: form.propertyType || 'flat',
        homeTypeLabel: form.homeTypeLabel || 'Flat',
        gatedCommunity: !!form.gatedCommunity,
        // Only a house has floors of its own; a flat has a floor *within* a building.
        floorsInHouse: house ? (form.floorsInHouse || '') : '',
        floor: house ? 0 : (parseInt(form.floor, 10) || 0),
        totalFloors: house ? 0 : (parseInt(form.totalFloors, 10) || 0),
        bathrooms: parseInt(form.bathrooms, 10) || 0,
        balconies: parseInt(form.balconies, 10) || 0,
        carpetArea: parseAmount(form.carpetArea),
        builtUp: parseAmount(form.builtUp),
        facing: form.facing || '',
        age: form.age || '',
        furniture: form.furniture || [],
        tower: form.tower || '',
        street: form.street || '',
        landmark: form.landmark || '',
        pincode: form.pincode || '',
      });
      clearFormDraft();
      triggerConfetti();
      setShowSuccess(true);
      setTimeout(() => navigate('/dashboard'), 3200);
    } catch (err) {
      /* A 400 is the anti-broker guardrail refusing the post — a live-share cap, or an address
         this host has already claimed. Its message is the only thing that tells the host what to
         change, so it goes in front of them verbatim; anything else is ours to apologise for. */
      const refused = err?.status === 400 && err?.message;
      toast(refused || 'Could not post your flatmate listing. Please try again.', 'error');
      if (refused) window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setPosting(false);
    }
  };

  return {
    ...media,
    ...location,
    t, navigate, editId, flatmateMode,
    currentStep, setCurrentStep, rentMode, setRentMode, isFlatmateMode,
    showSuccess, showResetConfirm, setShowResetConfirm, errors,
    postedListing,
    editApproved, editChanges, showIdentityGuard, setShowIdentityGuard,
    showDupGuard, setShowDupGuard, dupExistingId, canPost,
    form, setForm, progressState,
    toggleInArray, toggleTenant, changePropertyType,
    isResidential, isLand, isCommercial, isHouse, isPg,
    money, setDepositMonths,
    nextStep, prevStep, openResetConfirm, confirmReset, submitProperty, submitFlatmate,
    posting,
    activeListingCount, listingLimit: planListingLimit,
  };
}

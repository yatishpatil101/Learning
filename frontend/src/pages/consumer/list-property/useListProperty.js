import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext.jsx';
import { useFormDraft } from '../../../lib/hooks';
import { parseAmount } from '../../../lib/format';
import { myListing } from '../../../services/propertyService.js';
import { listDocuments } from '../../../services/documentService.js';
import { ADDRESS_PARTS, hasStoredAddress } from '../../../lib/listingFormDetails.js';
import { createRoom } from '../../../services/flatmateService.js';
import { loadListingQuota } from '../../../lib/data/listingQuota.js';
import { formatIndian } from './format.js';
import { haptic } from '../../../lib/haptics.js';
import {
  isResidentialType, isLandType, isCommercialType, isHouseType,
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
import { MAX_PHOTOS } from '../../../lib/uploads/policy.js';

export default function useListProperty() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  // Preserve the sitting tenant's intent when entering from Flatmates.
  const flatmateMode = searchParams.get('flatmate') === '1';
  /* Where an edit opens. Named rather than numbered so the link survives a step being inserted,
     and honoured only for an edit: on a new post there is nothing to skip past. Landing late is
     safe because `submitProperty` re-validates steps 1 and 2 for every edit and sends the owner
     back to the first one that fails — arriving at step 3 skips the walk, not the checks. */
  const entryStep = { details: 1, location: 2, photos: 3 }[searchParams.get('step')] || 1;

  const [currentStep, setCurrentStep] = useState(1);
  const [rentMode, setRentMode] = useState(() => (flatmateMode && !editId ? 'flatmate' : 'whole'));
  const [showSuccess, setShowSuccess] = useState(false);
  const [postedListing, setPostedListing] = useState(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [errors, setErrors] = useState({});

  const [editApproved, setEditApproved] = useState(false);
  const [showIdentityGuard, setShowIdentityGuard] = useState(false);
  const [showDupGuard, setShowDupGuard] = useState(false);
  // Prevent another submit while the network write is pending.
  const [posting, setPosting] = useState(false);
  const [dupExistingId, setDupExistingId] = useState('');
  // Avoid a false paywall while quota loads; the server also enforces it on submit.
  const [canPost, setCanPost] = useState(true);
  const [quota, setQuota] = useState({ used: 0, allowance: null });
  useEffect(() => {
    // Quota is owner-scoped and never applies to an edit.
    if (editId || authLoading) return undefined;
    let live = true;
    loadListingQuota(user).then((q) => {
      if (!live) return;
      setQuota({ used: q.used, allowance: q.allowance });
      setCanPost(q.canPost);
    });
    return () => { live = false; };
  }, [editId, authLoading, user]);
  const activeListingCount = useCallback(() => quota.used, [quota.used]);
  const planListingLimit = useCallback(() => quota.allowance, [quota.allowance]);

  const [form, setForm] = useState(initialForm);
  // Async geocodes must read the latest form rather than an older render closure.
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);

  const media = useListingMedia({ setErrors });
  const { photos, setPhotos, documents, setDocuments } = media;

  // A map lookup cannot reconstruct the missing parts of a saved legacy address.
  const setLocationForm = useCallback((update) => setForm((previous) => {
    const next = typeof update === 'function' ? update(previous) : update;
    return hasStoredAddress(previous)
      ? { ...next, ...Object.fromEntries(ADDRESS_PARTS.map((key) => [key, previous[key]])), societyId: previous.societyId }
      : next;
  }), []);
  const location = useListingLocation({ setForm: setLocationForm, formRef, errors, setErrors });
  const { set, locationSet, setLocationSet } = location;
  // Manual address entry is explicit replacement, unlike geocode auto-fill.
  const setField = (field, value) => {
    if (hasStoredAddress(form) && (ADDRESS_PARTS.includes(field) || field === 'societyId')) {
      setForm((previous) => ({ ...previous, [field]: value }));
    }
    set(field, value);
  };

  const restoreDraft = useCallback((update) => setForm((previous) => {
    const restored = typeof update === 'function' ? update(previous) : update;
    const legacyView = restored.facing === 'Park Facing' ? 'Garden'
      : restored.facing === 'Road Facing' ? 'Main Road' : null;
    // Browser drafts predate the database migration; preserve an independently stated view.
    return legacyView ? { ...restored, facing: '', overlooking: restored.overlooking || legacyView } : restored;
  }), []);
  const { clear: clearFormDraft, startFresh } = useFormDraft('dzDraft:list-property', form, restoreDraft, { enabled: !editId });

  const isFlatmateMode = !editId && form.deal === 'rent' && rentMode === 'flatmate';

  const progressState = useMemo(
    () => computeProgress({ form, photos, documents, isFlatmateMode }),
    [form, photos, documents, isFlatmateMode],
  );

  useEffect(() => {
    // Entry intent wins over a draft, but never over an existing listing.
    if (flatmateMode && !editId) {
      setForm((f) => ({ ...f, deal: 'rent', propertyType: 'flat', hostRole: 'tenant' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Readiness belongs to a listing AND owner, never merely to the last completed request.
  const [editListing, setEditListing] = useState(null);
  const [editLoad, setEditLoad] = useState(null);
  const [editAttempt, setEditAttempt] = useState(0);
  const ownerId = user?.id || user?.uuid || user?.mobile || '';
  const ownerMobile = user?.mobile || '';
  const editKey = JSON.stringify([editId, ownerId, ownerMobile]);
  const editRequest = useRef(null);
  const editReady = !editId || (!authLoading && !!ownerMobile && editLoad?.key === editKey
    && editLoad.status === 'ready' && !!editListing);
  const editLoadError = !!editId && !authLoading && (!ownerMobile
    || (editLoad?.key === editKey && editLoad.status === 'error'));
  const editLoading = !!editId && !editReady && !editLoadError;
  const retryEditLoad = () => {
    editRequest.current = null;
    setEditLoad(null);
    setEditAttempt((attempt) => attempt + 1);
  };
  useEffect(() => {
    if (!editId) return undefined;
    const request = {};
    editRequest.current = request;
    setEditListing(null);
    setEditLoad(null);
    setForm(initialForm);
    setPhotos([]);
    setDocuments({});
    setLocationSet(false);
    setEditApproved(false);
    setCurrentStep(entryStep);
    setErrors({});
    setShowSuccess(false);
    setShowResetConfirm(false);
    setShowIdentityGuard(false);
    setShowDupGuard(false);
    const load = async () => {
      try {
        const listing = await myListing(editId, { id: ownerId, mobile: ownerMobile });
        if (editRequest.current !== request) return;
        if (!listing?.form) throw new Error('Listing unavailable');
        const vault = await listDocuments(ownerMobile, listing.uuid || listing.id);
        if (editRequest.current !== request) return;
        // The service returns newest first; metadata has no upload bytes to send again.
        const slots = vault.reduce((result, doc) => Object.hasOwn(result, doc.category)
          ? result : { ...result, [doc.category]: { id: doc.id, name: doc.name, size: doc.size, mime: doc.mime, uploadedAt: doc.uploadedAt } }, {});
        const snapshot = { ...initialForm, ...listing.form };
        const imgs = (listing.images || listing.gallery || []).filter(Boolean);
        setForm(snapshot);
        setEditListing({ ...listing, form: snapshot });
        setPhotos(imgs.map((url) => ({ url, category: 'Other' })));
        setDocuments(slots);
        setLocationSet([snapshot.propLat, snapshot.propLng].every((value) => value !== '' && value != null && Number.isFinite(Number(value))));
        setEditApproved(/approved|verified|live/i.test(String(listing.status || '')));
        setEditLoad({ key: editKey, status: 'ready' });
      } catch {
        if (editRequest.current === request) setEditLoad({ key: editKey, status: 'error' });
      }
    };
    if (!authLoading && ownerMobile) void load();
    return () => { editRequest.current = null; };
  }, [editId, ownerId, ownerMobile, editKey, authLoading, editAttempt, entryStep, setPhotos, setDocuments, setLocationSet]);

  const editChanges = useMemo(() => {
    if (!editId || !editReady || !editListing) return null;
    return classifyChanges(editListing.form, form,
      (editListing.images || editListing.gallery || []).filter(Boolean), photos.map((p) => p.url).filter(Boolean));
  }, [editId, editReady, editListing, form, photos]);

  // Bring the success card into view after submitting from the bottom of a long step.
  useEffect(() => {
    if (showSuccess) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [showSuccess]);

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

  // Prevent another property's type-specific answers from silently being saved.
  const TYPE_SPECIFIC_KEYS = [
    'commercialType',
    'washrooms', 'shellType', 'parkingSpaces', 'powerBackup', 'pantry', 'camCharges', 'suitableFor',
    'areaUnit', 'plotLength', 'plotWidth', 'openSides', 'roadWidth', 'cornerPlot', 'boundaryWall',
    'plotZone', 'naSanctioned', 'waterSource', 'electricity', 'roadAccess', 'satbara',
    'plotArea', 'floorsInHouse', 'furniture', 'monthlyRent',
  ];
  const changePropertyType = useCallback((v) => {
    setForm((prev) => {
      const next = { ...prev, propertyType: v };
      TYPE_SPECIFIC_KEYS.forEach((k) => { next[k] = initialForm[k]; });
      return isLandType(v) ? { ...next, overlooking: '' } : next;
    });
    if (!isResidentialType(v)) setRentMode('whole');
    setErrors((prev) => {
      const n = { ...prev };
      ['propertyType', 'commercialType', 'monthlyRent', 'plotArea', 'washrooms', 'shellType'].forEach((k) => delete n[k]);
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isResidential = () => isResidentialType(form.propertyType);
  const isLand = () => isLandType(form.propertyType);
  const isCommercial = () => isCommercialType(form.propertyType);
  const isHouse = () => isHouseType(form.propertyType);

  const money = (field) => ({
    value: formatIndian(form[field]),
    onChange: (e) => set(field, e.target.value.replace(/\D/g, '')),
  });
  const setDepositMonths = (months) => {
    const rent = parseAmount(form.monthlyRent);
    if (rent > 0) set('deposit', String(rent * months));
  };

  const nextStep = () => {
    if (!editReady) return;
    const err = isFlatmateMode
      ? (currentStep === 1 ? validateFlatmateStep1(form) : validateFlatmateStep2(form))
      : (currentStep === 1 ? validateStep1(form, editListing?.form) : currentStep === 2 ? validateStep2(form, editListing?.form) : {});
    // Require an intentional location so the listing cannot inherit the map's default pin.
    if (currentStep === 2 && !locationSet) err.location = true;
    if (Object.keys(err).length) { setErrors(err); scrollToError(err); return; }
    setErrors({});
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // A validation failure must not produce the successful-advance haptic.
      haptic('step');
    }
  };
  const prevStep = () => {
    if (!editReady) return;
    if (currentStep > 1) { setCurrentStep(currentStep - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };

  // Resetting an edit restores the server snapshot without touching a separate new-post draft.
  const openResetConfirm = () => { if (editReady) setShowResetConfirm(true); };
  const confirmReset = () => {
    if (!editReady || posting) return;
    if (editId) window.location.reload();
    else startFresh();
  };

  const finalizeListing = async () => {
    // Never PATCH unhydrated defaults over the owner's saved listing.
    if (!editReady) {
      toast(t('listProperty.editLoadFailed', 'We could not load that listing. Reload the page and try again.'), 'error');
      return;
    }
    // Photo hashes help Ops identify a re-list; hashing failure must not block saving.
    let photoHashes = [];
    const request = editRequest.current;
    try { photoHashes = await hashPhotos(photos); } catch { photoHashes = []; }
    if (editId && request !== editRequest.current) return;
    const res = await persistListing({ form, user, editId, editListing, documents, photos, photoHashes });
    if (editId && request !== editRequest.current) return;
    // Same owner already has this exact property live → stop and point them to it.
    if (res && res.ok === false && res.blocked) {
      setDupExistingId(res.existingId || '');
      setShowDupGuard(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Keep the in-memory form available for retry after a rejected save.
    if (res && res.ok === false) {
      toast(res.error || 'Could not save your listing. Please try again.', 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!editId) clearFormDraft();
    // Refresh owner eligibility and quota after consuming a new-post allowance.
    if (!editId) refreshUser();
    // Document failure does not undo the listing; explain how to retry without re-posting.
    if (res?.documentsFailed?.length) {
      toast(`Listed, but we could not upload ${res.documentsFailed.join(', ')}. Add it again from Dashboard ▸ Documents.`, 'error');
    }
    triggerConfetti();
    // Offer room-by-room letting only after a new rental post.
    const splittable = !editId && res?.listing?.deal === 'rent';
    if (splittable) setPostedListing(res.listing);
    setShowSuccess(true);
    // Don't yank the screen away mid-decision while that offer is on it.
    if (!splittable) setTimeout(() => {
      if (!editId || request === editRequest.current) navigate('/dashboard');
    }, 3200);
  };

  const submitProperty = () => {
    if (!editReady || posting || media.isMediaProcessing()) return;
    const step1Errors = editId ? validateStep1(form, editListing.form) : {};
    const step2Errors = editId ? validateStep2(form, editListing.form) : {};
    const err = {
      ...step1Errors,
      ...step2Errors,
      ...validateStep3(form, documents, photos),
    };
    if (photos.length > MAX_PHOTOS) err.photos = 'Keep at most 10 photos. Remove the extra photos before saving.';
    if (Object.keys(err).length) {
      if (Object.keys(step1Errors).length) setCurrentStep(1);
      else if (Object.keys(step2Errors).length) setCurrentStep(2);
      setErrors(err);
      scrollToError(err);
      return;
    }

    /* Over the ceiling. Reachable now that the flatmate entry point is exempt from the paywall —
       an owner who lands there and switches to whole-flat keeps a wizard the paywall would
       otherwise have replaced. Say why, because a submit button that silently does nothing reads
       as a broken page; the server refuses this same post with the same arithmetic. */
    if (!editId && !canPost) {
      toast(`You already have ${quota.used} of ${quota.allowance} listings live. Take one down to post another — letting a room stays free.`, 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (editId && editChanges?.identityChanged) { setShowIdentityGuard(true); return; }

    // Release the submit guard even when a save throws.
    setPosting(true);
    finalizeListing()
      .catch(() => toast('Could not post your listing. Please try again.', 'error'))
      .finally(() => setPosting(false));
  };

  const submitFlatmate = async () => {
    if (!editReady || editId || posting || media.isMediaProcessing()) return;
    const err = {};
    if (!form.bhk) err.bhk = true;
    if (!form.roomType) err.roomType = true;
    if (!form.locality) err.locality = true;
    if (!form.society.trim()) err.society = true;
    if (!(Number(form.rentShare) > 0)) err.rentShare = true;
    if (!form.availableFrom) err.availableFrom = true;
    if (!photos.length) err.photos = true;
    if (photos.length > MAX_PHOTOS) err.photos = 'Keep at most 10 photos. Remove the extra photos before saving.';
    if (Object.keys(err).length) { setErrors(err); scrollToError(err); return; }
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
        overlooking: form.overlooking || '',
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
      // The eligibility refusal explains what the host must change.
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
    set: setField,
    t, navigate, editId, flatmateMode,
    editReady, editLoading, editLoadError, retryEditLoad,
    legacyAddress: editReady && hasStoredAddress(editListing?.form) ? editListing.form.existingAddress : '',
    currentStep, setCurrentStep: (step) => { if (editReady) setCurrentStep(step); }, rentMode, setRentMode, isFlatmateMode,
    showSuccess, showResetConfirm, setShowResetConfirm, errors,
    postedListing,
    editApproved, editChanges, showIdentityGuard, setShowIdentityGuard,
    showDupGuard, setShowDupGuard, dupExistingId, canPost,
    form, setForm, progressState,
    toggleInArray, toggleTenant, changePropertyType,
    isResidential, isLand, isCommercial, isHouse,
    money, setDepositMonths,
    nextStep, prevStep, openResetConfirm, confirmReset, submitProperty, submitFlatmate,
    posting,
    activeListingCount, listingLimit: planListingLimit,
  };
}

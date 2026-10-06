import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext.jsx';
import { useFormDraft } from '../../../lib/hooks';
import { parseAmount } from '../../../lib/format';
import { myListing, checkOwnDuplicate } from '../../../services/propertyService.js';
import { ADDRESS_PARTS, hasStoredAddress } from '../../../lib/listingFormDetails.js';
import { createRoom, updateRoom } from '../../../services/flatmateService.js';
import { canSplitIntoRooms } from '../../../lib/data/flatSplit.js';
import { loadListingQuota } from '../../../lib/data/listingQuota.js';
import { formatIndian } from './format.js';
import { haptic } from '../../../lib/haptics.js';
import {
  isResidentialType, isLandType, isCommercialType, isHouseType, COMMERCIAL_SPEC_KEYS,
  leaseKindOf, LEASE_DEFAULTS, defaultAreaUnitFor, FLOOR_PLAN_CATEGORY, photoCategoriesFor,
  homeTypeLabelFor, withInFlatAsFurniture,
} from './constants.js';
import { initialForm } from './initialForm.js';
import { classifyChanges } from './editPolicy.js';
import { scrollToError, validateStep1, validateLocationStep, validatePricingStep, validateStep3, validateFlatmateStep1, validateFlatmateLocation, validateFlatmatePrice } from './validation.js';
import { triggerConfetti } from './confetti.js';
import { listingLabels, persistListing, roomHeadline } from './submit.js';
import { hasContactDetails } from './contactDetails.js';
import { headlineOf } from '../../../lib/headline.js';
import { hasAgreementEvidence, numeric, terms } from '../flatmates/helpers.js';
import { computeProgress } from './progress.js';
import useListingMedia from './useListingMedia';
import useListingLocation from './useListingLocation';
import useRoomEdit from './useRoomEdit';
import { LISTING_STEPS } from './StepNav.jsx';
import { track } from '../../../lib/pmf.js';

const LIST_PROPERTY_DRAFT_PREFIX = 'dzDraft:list-property';
const LEGACY_LIST_PROPERTY_DRAFT_KEY = `${LIST_PROPERTY_DRAFT_PREFIX}:v2`;
const DRAFT_STEP_KEY = '__currentStep';
const DRAFT_PHOTOS_KEY = '__photos';
const DRAFT_OWNER_KEY = '__owner';
const DRAFT_RENT_MODE_KEY = '__rentMode';
const LIST_PROPERTY_DRAFT_KEY = `${LIST_PROPERTY_DRAFT_PREFIX}:v3`;
const dealPreset = (searchParams, flatmateMode, editId) => {
  if (editId) return '';
  const deal = searchParams.get('deal');
  if (deal === 'buy' || deal === 'rent') return deal;
  return flatmateMode ? 'rent' : '';
};
const initialForEntry = (searchParams, flatmateMode, editId) => ({
  ...initialForm,
  deal: dealPreset(searchParams, flatmateMode, editId),
});
const bathroomsForBhk = (bhk) => {
  const n = Number(bhk);
  if (!Number.isFinite(n) || n <= 1) return '1';
  if (n === 2) return '2';
  return String(Math.min(4, n - 1));
};

const parseStep = (value) => {
  const named = { details: 1, location: 2, pricing: 3, photos: 4 }[String(value || '')];
  const numeric = Number.parseInt(value, 10);
  return named || (Number.isFinite(numeric) && numeric > 0 ? numeric : 1);
};

const durablePhotos = (value) => (Array.isArray(value) ? value : [])
  .map((photo) => {
    const url = typeof photo === 'string' ? photo : photo?.url;
    if (typeof url !== 'string' || !url || /^(data|blob):/i.test(url)) return null;
    return {
      url,
      category: photo?.category || 'Other',
      ...(photo?.photoHash ? { photoHash: photo.photoHash } : {}),
    };
  })
  .filter(Boolean);
const ownerDraftId = (user) => String(user?.id || user?.uuid || user?.mobile || '').trim();
const autoPlotArea = (form, field, value) => {
  if (form.propertyType === 'farmland' || form.areaUnit !== 'sqft') return '';
  const current = String(form.carpetArea || '').trim();
  const prevProduct = Number(form.plotLength) * Number(form.plotWidth);
  if (current && !(prevProduct > 0 && current === String(Math.round(prevProduct)))) return '';
  const length = Number(field === 'plotLength' ? value : form.plotLength);
  const width = Number(field === 'plotWidth' ? value : form.plotWidth);
  return length > 0 && width > 0 ? String(Math.round(length * width)) : '';
};

export default function useListProperty() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const flatmateMode = searchParams.get('flatmate') === '1';
  const editRoomId = flatmateMode && !editId ? searchParams.get('editRoom') : null;
  const rawStepParam = searchParams.get('step');
  const entryStep = parseStep(rawStepParam);
  const editEntryStep = useRef(entryStep);

  const [currentStep, setCurrentStep] = useState(1);
  const [rentMode, setRentMode] = useState(() => (flatmateMode && !editId ? 'flatmate' : 'whole'));
  const [showSuccess, setShowSuccess] = useState(false);
  const [postedListing, setPostedListing] = useState(null);
  const [savedListingStatus, setSavedListingStatus] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [errors, setErrors] = useState({});

  const [editApproved, setEditApproved] = useState(false);
  const [showIdentityGuard, setShowIdentityGuard] = useState(false);
  const [showDupGuard, setShowDupGuard] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  // Prevent another submit while the network write is pending.
  const [posting, setPosting] = useState(false);
  const [dupExistingId, setDupExistingId] = useState('');
  const [dupPending, setDupPending] = useState(false);
  const dupSeq = useRef(0);
  const stepRef = useRef(1);
  // Avoid a false paywall while quota loads; the server also enforces it on submit.
  const [canPost, setCanPost] = useState(true);
  const [quota, setQuota] = useState({ used: 0, allowance: null });
  useEffect(() => {
    if (editId || editRoomId || authLoading) return undefined;
    if (!user) {
      setQuota({ used: 0, allowance: null });
      setCanPost(true);
      return undefined;
    }
    let live = true;
    loadListingQuota(user).then((q) => {
      if (!live) return;
      setQuota({ used: q.used, allowance: q.allowance });
      setCanPost(q.canPost);
    });
    return () => { live = false; };
  }, [editId, editRoomId, authLoading, user]);

  const [form, setForm] = useState(() => initialForEntry(searchParams, flatmateMode, editId));
  // Async geocodes must read the latest form rather than an older render closure.
  const formRef = useRef(form);
  const amenityPrefillRef = useRef({ touchedFor: '', prefilledFor: '' });
  const skipLeaveGuard = useRef(false);
  const pendingLeave = useRef(null);
  const latestWizardUrl = useRef('/list-property');
  useEffect(() => { formRef.current = form; }, [form]);

  const ownerMobile = user?.mobile || '';
  const media = useListingMedia({ setErrors });
  const { photos, setPhotos } = media;
  const ownerId = ownerDraftId(user);
  const initialOwnerId = useRef(ownerId);
  const previousOwnerId = useRef(ownerId);
  const signedIn = !!ownerId;
  const draftEnabled = !editId && !editRoomId && !authLoading;
  const writeStepParam = useCallback((step, { replace = false, pushedFrom } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (step > 1) next.set('step', String(step));
      else next.delete('step');
      return next;
    }, { replace, state: pushedFrom ? { lpPushedFrom: pushedFrom } : undefined });
  }, [setSearchParams]);

  const setLocationForm = useCallback((update, { explicit = false } = {}) => setForm((previous) => {
    const next = typeof update === 'function' ? update(previous) : update;
    return !explicit && hasStoredAddress(previous)
      ? { ...next, ...Object.fromEntries(ADDRESS_PARTS.map((key) => [key, previous[key]])), societyId: previous.societyId }
      : next;
  }), []);
  const location = useListingLocation({ setForm: setLocationForm, formRef, errors, setErrors });
  const { set } = location;
  const locationSet = !!form.pinPlaced;
  const setField = (field, value) => {
    if (hasStoredAddress(form) && (ADDRESS_PARTS.includes(field) || field === 'societyId')) {
      setForm((previous) => ({ ...previous, [field]: value }));
    }
    if (field === 'plotLength' || field === 'plotWidth') {
      const filledArea = autoPlotArea(form, field, value);
      setForm((previous) => ({ ...previous, [field]: value, ...(filledArea ? { carpetArea: filledArea } : {}) }));
      if (errors[field] || (filledArea && errors.carpetArea)) {
        setErrors((previous) => {
          const next = { ...previous };
          delete next[field];
          if (filledArea) delete next.carpetArea;
          return next;
        });
      }
      return;
    }
    if (field === 'bhk') {
      setForm((previous) => ({
        ...previous,
        bhk: value,
        bathrooms: previous.bathrooms || bathroomsForBhk(value),
      }));
      if (errors.bhk || errors.bathrooms) {
        setErrors((previous) => {
          const next = { ...previous };
          delete next.bhk;
          if (value) delete next.bathrooms;
          return next;
        });
      }
      return;
    }
    set(field, value);
  };

  const restoreDraft = useCallback((update) => setForm((previous) => {
    const restored = withInFlatAsFurniture(typeof update === 'function' ? update(previous) : update);
    const legacyView = restored.facing === 'Park Facing' ? 'Garden'
      : restored.facing === 'Road Facing' ? 'Main Road' : null;
    return legacyView ? { ...restored, facing: '', overlooking: restored.overlooking || legacyView } : restored;
  }), []);
  const restoreDraftExtras = useCallback((saved) => {
    const savedFields = { ...saved };
    delete savedFields.__documents;
    const {
      [DRAFT_STEP_KEY]: savedStep, [DRAFT_PHOTOS_KEY]: savedPhotos, [DRAFT_OWNER_KEY]: savedOwner,
      [DRAFT_RENT_MODE_KEY]: savedRentMode, ...fields
    } = savedFields;
    if (!savedOwner && ownerId && initialOwnerId.current !== '') return null;
    if (savedOwner && savedOwner !== ownerId) return null;
    const restoredPhotos = durablePhotos(savedPhotos);
    if (restoredPhotos.length) setPhotos(restoredPhotos);
    const roomDraft = !editId && (flatmateMode || savedRentMode === 'flatmate');
    if (roomDraft) setRentMode('flatmate');
    const step = Math.min(parseStep(savedStep), LISTING_STEPS.length);
    if (step > 1) writeStepParam(step, { replace: true });
    return fields;
  }, [editId, flatmateMode, ownerId, setPhotos, writeStepParam]);
  const draftForm = useMemo(() => ({
    ...form,
    [DRAFT_STEP_KEY]: currentStep,
    [DRAFT_PHOTOS_KEY]: durablePhotos(photos),
    [DRAFT_OWNER_KEY]: ownerId,
    [DRAFT_RENT_MODE_KEY]: rentMode,
  }), [currentStep, form, ownerId, photos, rentMode]);
  useEffect(() => {
    if (editId) return;
    try { localStorage.removeItem(LEGACY_LIST_PROPERTY_DRAFT_KEY); } catch {}
  }, [editId]);
  const { clear: clearFormDraft, discard: discardFormDraft, flush: flushFormDraft, startFresh } = useFormDraft(LIST_PROPERTY_DRAFT_KEY, draftForm, restoreDraft, {
    enabled: draftEnabled,
    omit: ['agreementDeclared', 'agreementDoc', 'hostRole', 'ownerConsentMobile', 'ownerConsent'],
    onRestore: restoreDraftExtras,
  });
  useLayoutEffect(() => {
    const previous = previousOwnerId.current;
    if (previous === ownerId) return;
    previousOwnerId.current = ownerId;
    if (!previous) return;
    dupSeq.current += 1;
    discardFormDraft();
    media.resetMedia();
    const fresh = initialForEntry(searchParams, flatmateMode, editId);
    setForm(fresh);
    formRef.current = fresh;
    setCurrentStep(1);
    setRentMode(flatmateMode && !editId ? 'flatmate' : 'whole');
    setShowSuccess(false);
    setPostedListing(null);
    setSavedListingStatus('');
    setShowResetConfirm(false);
    setErrors({});
    setShowIdentityGuard(false);
    setShowDupGuard(false);
    setShowLeaveConfirm(false);
    setAuthPromptOpen(false);
    setPosting(false);
    setDupExistingId('');
    setDupPending(false);
    setQuota({ used: 0, allowance: null });
    setCanPost(true);
    writeStepParam(1, { replace: true });
  }, [discardFormDraft, editId, flatmateMode, media, ownerId, writeStepParam]);
  const [draftHydrated, setDraftHydrated] = useState(false);
  useEffect(() => { if (draftEnabled) setDraftHydrated(true); }, [draftEnabled]);
  const requestAuthPrompt = useCallback(() => {
    flushFormDraft();
    setAuthPromptOpen(true);
  }, [flushFormDraft]);
  const closeAuthPrompt = useCallback(() => setAuthPromptOpen(false), []);
  const handlePhotoUpload = useCallback((event) => {
    if (!signedIn) {
      event.target.value = '';
      requestAuthPrompt();
      return;
    }
    void media.handlePhotoUpload(event);
  }, [media, requestAuthPrompt, signedIn]);

  const isFlatmateMode = !editId && form.deal === 'rent' && rentMode === 'flatmate';

  const progressState = useMemo(
    () => computeProgress({ form, photos, isFlatmateMode }),
    [form, photos, isFlatmateMode],
  );

  useEffect(() => {
    // Entry intent wins over a draft, but never over an existing listing. The home type is reset
    // with the property type because they are one answer.
    if (flatmateMode && !editId) {
      setForm((f) => ({ ...f, deal: 'rent', propertyType: 'flat', homeTypeLabel: homeTypeLabelFor('flat'), hostRole: 'tenant' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flatmate mode.
  }, []);

  // Readiness belongs to a listing AND owner, never merely to the last completed request.
  const [editListing, setEditListing] = useState(null);
  const [editLoad, setEditLoad] = useState(null);
  const [editAttempt, setEditAttempt] = useState(0);
  const editKey = JSON.stringify([editId, ownerId, ownerMobile]);
  const editRequest = useRef(null);
  const roomEdit = useRoomEdit({ roomId: editRoomId, canLoad: !authLoading, setForm, setPhotos });
  const editReady = (!editId || (!authLoading && !!ownerMobile && editLoad?.key === editKey
    && editLoad.status === 'ready' && !!editListing)) && (!editRoomId || roomEdit.status === 'ready');
  const editLoadError = (!!editId && !authLoading && (!ownerMobile
    || (editLoad?.key === editKey && editLoad.status === 'error'))) || (!!editRoomId && roomEdit.status === 'error');
  const editLoading = (!!editId || !!editRoomId) && !editReady && !editLoadError;
  const leaveGuardActive = useMemo(() => {
    if (showSuccess || skipLeaveGuard.current) return false;
    const baseline = editRoomId ? roomEdit.baseline || initialForm
      : editId && editListing?.form ? editListing.form : initialForm;
    const savedPhotoUrls = editRoomId ? roomEdit.photoUrls
      : editId ? (editListing?.images || editListing?.gallery || []).filter(Boolean) : [];
    const photoUrls = durablePhotos(photos).map((photo) => photo.url);
    const formDirty = JSON.stringify(form) !== JSON.stringify(baseline);
    const photosDirty = editId || editRoomId
      ? JSON.stringify(photoUrls) !== JSON.stringify(savedPhotoUrls)
      : photoUrls.length > 0;
    return posting || media.isMediaBusy || formDirty || photosDirty;
  }, [editId, editRoomId, editListing, form, media.isMediaBusy, photos, posting, roomEdit.baseline, roomEdit.photoUrls, showSuccess]);
  useEffect(() => {
    latestWizardUrl.current = `${routerLocation.pathname}${routerLocation.search}${routerLocation.hash || ''}`;
  }, [routerLocation.hash, routerLocation.pathname, routerLocation.search]);
  const requestLeave = useCallback((target) => {
    pendingLeave.current = target;
    setShowLeaveConfirm(true);
  }, []);
  useEffect(() => {
    if (!leaveGuardActive) return undefined;
    const beforeUnload = (event) => {
      if (skipLeaveGuard.current) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [leaveGuardActive]);
  useEffect(() => {
    if (!leaveGuardActive) return undefined;
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      let url;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || url.pathname.toLowerCase().startsWith('/list-property')) return;
      event.preventDefault();
      event.stopPropagation();
      requestLeave({ to: `${url.pathname}${url.search}${url.hash}` });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [leaveGuardActive, requestLeave]);
  useEffect(() => {
    if (!leaveGuardActive) return undefined;
    const onPopState = () => {
      const url = new URL(window.location.href);
      if (url.pathname.toLowerCase().startsWith('/list-property')) return;
      const target = `${url.pathname}${url.search}${url.hash}`;
      const restore = latestWizardUrl.current || '/list-property';
      window.history.pushState({ lpLeaveGuard: true }, '', restore);
      navigate(restore, { replace: true });
      requestLeave({ to: target });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [leaveGuardActive, navigate, requestLeave]);
  const retryEditLoad = () => {
    if (editRoomId) { roomEdit.retry(); return; }
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
    setForm(initialForEntry(searchParams, flatmateMode, editId));
    setPhotos([]);
    setEditApproved(false);
    setCurrentStep(editEntryStep.current);
    setErrors({});
    setShowSuccess(false);
    setSavedListingStatus('');
    setShowResetConfirm(false);
    setShowIdentityGuard(false);
    setShowDupGuard(false);
    const load = async () => {
      try {
        const listing = await myListing(editId, { id: ownerId, mobile: ownerMobile });
        if (editRequest.current !== request) return;
        if (!listing?.form) throw new Error('Listing unavailable');
        const placed = [listing.form.propLat, listing.form.propLng].every((value) => (typeof value === 'number'
          || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)));
        const loaded = withInFlatAsFurniture({
          ...initialForm,
          ...listing.form,
          /* Listings posted against the old boolean carry `naSanctioned`; without this the owner opens the edit on an
             unanswered picker and re-saving would erase their own answer. */
          naStatus: listing.form.naStatus || (listing.form.naSanctioned ? 'sanctioned' : ''),
          pinPlaced: placed,
          ...(placed ? {} : { propLat: initialForm.propLat, propLng: initialForm.propLng }),
        });
        const generated = listingLabels(loaded).title;
        const legacyGenerated = String(loaded.bhk) === '4' ? generated.replace(/^4 BHK /, '4+ BHK ') : generated;
        const snapshot = [generated, legacyGenerated].includes(loaded.title) ? { ...loaded, title: '' } : loaded;
        const imgs = (listing.images || listing.gallery || []).filter(Boolean);
        setForm(snapshot);
        setEditListing({ ...listing, form: snapshot });
        /* Categories are not stored, so photos come back as 'Other' — except the tagged plan, which `submit.js`
           reads: without restoring it, any save at all would withdraw the owner's floor plan unasked. */
        setPhotos(imgs.map((url) => ({
          url,
          category: url === listing.floorPlan ? FLOOR_PLAN_CATEGORY : 'Other',
        })));
        setEditApproved(/approved|verified|live/i.test(String(listing.status || '')));
        setEditLoad({ key: editKey, status: 'ready' });
      } catch {
        if (editRequest.current === request) setEditLoad({ key: editKey, status: 'error' });
      }
    };
    if (!authLoading && ownerMobile) void load();
    return () => { editRequest.current = null; };
  }, [editId, ownerId, ownerMobile, editKey, authLoading, editAttempt, setPhotos]);

  const editChanges = useMemo(() => {
    if (!editId || !editReady || !editListing) return null;
    return classifyChanges(editListing.form, form,
      (editListing.images || editListing.gallery || []).filter(Boolean), photos.map((p) => p.url).filter(Boolean));
  }, [editId, editReady, editListing, form, photos]);

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
      if (value === 'bachelors') arr = arr.filter((x) => x !== 'bachelor-male' && x !== 'bachelor-female');
      if (value === 'bachelor-male' || value === 'bachelor-female') arr = arr.filter((x) => x !== 'bachelors');
      arr = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
      return { ...prev, preferredTenants: arr };
    });
  }, []);

  // Prevent another property's type-specific answers from silently being saved.
  const TYPE_SPECIFIC_KEYS = [
    'commercialType',
    'washrooms', 'shellType', 'parkingSpaces', 'powerBackup', 'pantry', 'camCharges', 'suitableFor', 'fixtures',
    'gstOnRent', 'fitOutMonths', 'escalationPct', 'tenancyStatus', 'inPlaceRent', 'leaseExpiry',
    ...COMMERCIAL_SPEC_KEYS,
    'areaUnit', 'plotLength', 'plotWidth', 'openSides', 'roadWidth', 'cornerPlot', 'boundaryWall',
    'plotZone', 'plottedProject', 'naStatus', 'waterSource', 'electricity', 'roadAccess', 'otherRights', 'buyerEligibility',
    'plotArea', 'floorsInHouse', 'furniture', 'monthlyRent',
    // Commercial never asks for it, so a residential answer left behind would publish unseen.
    'age',
  ];
  const changePropertyType = useCallback((v) => {
    setForm((prev) => {
      const next = { ...prev, propertyType: v };
      TYPE_SPECIFIC_KEYS.forEach((k) => { next[k] = initialForm[k]; });
      /* Not a TYPE_SPECIFIC_KEY, because those reset to `initialForm` and every type would come
       * back "Flat". */
      next.homeTypeLabel = homeTypeLabelFor(v) || prev.homeTypeLabel;
      next.areaUnit = defaultAreaUnitFor(v);
      const kind = leaseKindOf(v);
      if (leaseKindOf(prev.propertyType) !== kind) Object.assign(next, LEASE_DEFAULTS[kind]);
      /* The land form renders neither control, and the stale possession is worse than cosmetic: an "under
         construction" left behind is what the validator's land exclusion exists to survive. */
      return isLandType(v) ? { ...next, overlooking: '', construction: '' } : next;
    });
    if (!photoCategoriesFor(v, '').includes(FLOOR_PLAN_CATEGORY)) {
      setPhotos((prev) => prev.map((p) => (
        p.category === FLOOR_PLAN_CATEGORY ? { ...p, category: 'Other' } : p
      )));
    }
    if (!isResidentialType(v)) setRentMode('whole');
    setErrors((prev) => {
      const n = { ...prev };
      ['propertyType', 'commercialType', 'monthlyRent', 'plotArea', 'washrooms', 'shellType'].forEach((k) => delete n[k]);
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- type changes.
  }, [form.deal]);

  /* The subtype picks a use-profile, which decides which fixtures, amenities, specs and photo categories exist at all
     — Office to Warehouse otherwise keeps a Server Room the warehouse form cannot unpick. */
  const changeCommercialType = useCallback((v) => {
    setForm((prev) => ({
      ...prev,
      commercialType: v,
      fixtures: [],
      suitableFor: [],
      amenities: [],
      pantry: false,
      ...Object.fromEntries(COMMERCIAL_SPEC_KEYS.map((k) => [k, initialForm[k]])),
    }));
    /* Floor Plan is exempt: it carries a claim, and dropping it would quietly unpublish the
     * plan. */
    setPhotos((prev) => prev.map((p) => (
      p.category && p.category !== FLOOR_PLAN_CATEGORY ? { ...p, category: 'Other' } : p
    )));
    setErrors((prev) => {
      const n = { ...prev };
      delete n.commercialType;
      COMMERCIAL_SPEC_KEYS.forEach((k) => delete n[k]);
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset follows current selectors only.
  }, [form.deal, form.propertyType]);

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

  const lastStep = LISTING_STEPS.length;
  const maxReachableStep = useCallback(() => {
    const original = editListing?.form;
    const first = isFlatmateMode ? validateFlatmateStep1(form) : validateStep1(form, original);
    if (Object.keys(first).length) return 1;
    const locationErrors = isFlatmateMode ? validateFlatmateLocation(form) : validateLocationStep(form, original);
    if (!editId && !locationSet && !editListing) locationErrors.location = true;
    if (Object.keys(locationErrors).length) return 2;
    const priceErrors = isFlatmateMode ? validateFlatmatePrice(form) : validatePricingStep(form, original);
    return Object.keys(priceErrors).length ? 3 : lastStep;
  }, [editId, editListing, form, isFlatmateMode, lastStep, locationSet]);
  const goToStep = useCallback((step, { replace = false } = {}) => {
    if (!editReady) return;
    dupSeq.current += 1;
    const next = Math.max(1, Math.min(Number(step) || 1, maxReachableStep(), lastStep));
    setCurrentStep(next);
    writeStepParam(next, { replace, pushedFrom: replace ? undefined : currentStep });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentStep, editReady, lastStep, maxReachableStep, writeStepParam]);
  useEffect(() => {
    if (!editReady || (draftEnabled && !draftHydrated)) return;
    const requested = Math.min(entryStep, lastStep);
    const clamped = Math.min(requested, maxReachableStep());
    setCurrentStep((current) => {
      if (current !== clamped) window.scrollTo({ top: 0, behavior: 'auto' });
      return clamped;
    });
    if (requested !== clamped || (clamped === 1 && rawStepParam)) writeStepParam(clamped, { replace: true });
  }, [draftEnabled, draftHydrated, editReady, entryStep, lastStep, maxReachableStep, rawStepParam, writeStepParam]);
  useEffect(() => { stepRef.current = currentStep; }, [currentStep]);
  useEffect(() => () => { dupSeq.current += 1; }, []);
  const nextStep = () => {
    if (!editReady) return;
    const err = isFlatmateMode
      ? (currentStep === 1 ? validateFlatmateStep1(form)
        : currentStep === 2 ? validateFlatmateLocation(form)
          : currentStep === 3 ? validateFlatmatePrice(form) : {})
      : (currentStep === 1 ? validateStep1(form, editListing?.form)
        : currentStep === 2 ? validateLocationStep(form, editListing?.form)
          : currentStep === 3 ? validatePricingStep(form, editListing?.form) : {});
    /* An edit is exempt: a listing published before the pin existed would otherwise be barred
     * from its own price correction. */
    if (currentStep === 2 && !locationSet && !editListing) err.location = true;
    if (Object.keys(err).length) { setErrors(err); scrollToError(err); return; }
    setErrors({});
    const advance = () => {
      if (currentStep < lastStep) {
        goToStep(currentStep + 1);
        // A validation failure must not produce the successful-advance haptic.
        haptic('step');
      }
    };
    if (currentStep === 3 && !signedIn) {
      const authStep = Math.min(currentStep + 1, lastStep);
      setCurrentStep(authStep);
      writeStepParam(authStep, { replace: false, pushedFrom: currentStep });
      requestAuthPrompt();
      return;
    }
    if (currentStep === 2 && !editId && !isFlatmateMode && signedIn) {
      if (dupPending) return;
      const seq = ++dupSeq.current;
      const stillHere = () => seq === dupSeq.current && stepRef.current === 2;
      setDupPending(true);
      checkOwnDuplicate({ fields: form })
        .then((mine) => {
          if (!stillHere()) return;
          if (!mine.found) { advance(); return; }
          setDupExistingId(mine.existingId || '');
          setShowDupGuard(true);
        }, () => { if (stillHere()) advance(); })
        .catch(() => {})
        .finally(() => setDupPending(false));
      return;
    }
    advance();
  };
  const prevStep = () => {
    if (!editReady || currentStep <= 1) return;
    dupSeq.current += 1;
    if (routerLocation.state?.lpPushedFrom === currentStep - 1) navigate(-1);
    else goToStep(currentStep - 1, { replace: true });
  };

  // Resetting an edit restores the server snapshot without touching a separate new-post draft.
  const openResetConfirm = () => { if (editReady) setShowResetConfirm(true); };
  const confirmReset = () => {
    if (!editReady || posting) return;
    skipLeaveGuard.current = true;
    if (editId || editRoomId) window.location.reload();
    else startFresh();
  };

  const finalizeListing = async () => {
    // Never PATCH unhydrated defaults over the owner's saved listing.
    if (!editReady) {
      toast(t('listProperty.editLoadFailed', 'We could not load that listing. Reload the page and try again.'), 'error');
      return;
    }
    const request = editRequest.current;
    const res = await persistListing({ form, user, editId, editListing, photos });
    if (editId && request !== editRequest.current) return;
    // Same owner already has this exact property live → stop and point them to it.
    if (res && res.ok === false && res.blocked) {
      setDupExistingId(res.existingId || '');
      setShowDupGuard(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (res && res.ok === false) {
      if (res.fieldErrors && Object.keys(res.fieldErrors).length) {
        const fieldErrors = res.fieldErrors;
        const step = Math.max(1, Math.min(res.fieldErrorStep || currentStep, lastStep));
        setCurrentStep(step);
        writeStepParam(step, { replace: true });
        setErrors((previous) => ({ ...previous, ...fieldErrors }));
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const hasTarget = Object.keys(fieldErrors).some((key) => document.querySelector(`[data-err="${key}"]`));
          if (hasTarget) scrollToError(fieldErrors);
          else toast(res.error || 'Some listing details need attention.', 'error');
        }));
        if (res.unknownFields?.length) toast(res.error || 'Some listing details need attention.', 'error');
        return;
      }
      toast(res.error || 'Could not save your listing. Please try again.', 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!editId) clearFormDraft();
    if (!editId) track('listing_submitted', { deal: res?.listing?.deal, type: res?.listing?.type });
    // Refresh owner eligibility and quota after consuming a new-post allowance.
    if (!editId) refreshUser();
    skipLeaveGuard.current = true;
    triggerConfetti();
    const splittable = !editId && canSplitIntoRooms(res?.listing);
    if (splittable) setPostedListing(res.listing);
    setSavedListingStatus(res?.listing?.status || '');
    setShowSuccess(true);
  };

  const submitProperty = () => {
    if (!editReady || posting || media.isMediaProcessing()) return;
    if (!signedIn) { requestAuthPrompt(); return; }
    const step1Errors = editId ? validateStep1(form, editListing.form) : {};
    const locationErrors = editId ? validateLocationStep(form, editListing.form) : {};
    const pricingErrors = editId ? validatePricingStep(form, editListing.form) : {};
    const err = {
      ...step1Errors,
      ...locationErrors,
      ...pricingErrors,
      ...validateStep3(form, photos, editId ? editListing : null, media.maxPhotos),
    };
    if (Object.keys(err).length) {
      const failStep = Object.keys(step1Errors).length ? 1
        : Object.keys(locationErrors).length ? 2
          : Object.keys(pricingErrors).length ? 3 : currentStep;
      setCurrentStep(failStep);
      writeStepParam(failStep, { replace: true });
      setErrors(err);
      scrollToError(err);
      return;
    }

    /* Reachable because the flatmate entry point is exempt from the paywall; the server refuses
     * the same post identically. */
    if (!editId && !canPost) {
      toast(`You already have ${quota.used} of ${quota.allowance} listings live. Take one down to post another — letting a room stays free.`, 'error');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (editId && editChanges?.identityChanged) { setShowIdentityGuard(true); return; }

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
    if (form.hostRole === 'tenant') {
      if (!form.agreementDeclared) err.agreementDeclared = true;
      if (!hasAgreementEvidence(form.agreementDoc)) err.agreementDoc = true;
      if (!form.ownerConsent) err.ownerConsent = true;
    }
    if (!form.locality) err.locality = true;
    if (!form.society.trim()) err.society = true;
    if (!form.pinPlaced) err.location = true;
    if (!(Number(form.rentShare) > 0)) err.rentShare = true;
    if (!form.availableFrom) err.availableFrom = true;
    if (photos.length > media.maxPhotos) err.photos = 'max';
    if (hasContactDetails(form.title)) err.title = true;
    if (Object.keys(err).length) { setErrors(err); scrollToError(err); return; }
    if (!signedIn) { requestAuthPrompt(); return; }
    setPosting(true);
    try {
      const agreementDoc = form.hostRole === 'tenant' && form.agreementDeclared ? form.agreementDoc : null;
      const house = isHouseType(form.propertyType);
      const room = {
        title: editRoomId && !roomEdit.storedTitle && !form.title.trim() ? undefined : headlineOf(form.title, roomHeadline(form)),
        homeTypeLabel: form.homeTypeLabel,
        bhk: form.bhk,
        roomType: form.roomType,
        attachedBath: form.attachedBath,
        ...numeric('occupants', form.occupants),
        ...terms(form),
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
        ownerConsent: form.hostRole === 'tenant' && !!form.ownerConsent,
        photos: photos.map((photo) => photo.url),
        note: form.note,
        lat: form.propLat,
        lng: form.propLng,
        gatedCommunity: house && !!form.gatedCommunity,
        details: {
          ...(house ? numeric('floorsInHouse', form.floorsInHouse) : { floor: form.floor, ...numeric('totalFloors', form.totalFloors) }),
          ...numeric('bathrooms', form.bathrooms),
          ...numeric('balconies', form.balconies),
          furniture: form.furniture,
          tower: form.tower,
          street: form.street,
          landmark: form.landmark,
          pincode: form.pincode,
        },
      };
      if (editRoomId) {
        await updateRoom(editRoomId, room);
        skipLeaveGuard.current = true;
        toast(t('listProperty.edit.roomSaved'), 'success');
        navigate('/dashboard#properties');
        return;
      }
      await createRoom(room);
      clearFormDraft();
      skipLeaveGuard.current = true;
      triggerConfetti();
      setShowSuccess(true);
    } catch (err) {
      // The eligibility refusal explains what the host must change.
      const refused = err?.status === 400 && err?.message;
      toast(refused || (editRoomId ? t('listProperty.edit.roomSaveFailed') : 'Could not post your flatmate listing. Please try again.'), 'error');
      if (refused) window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setPosting(false);
    }
  };

  const postAnother = () => {
    skipLeaveGuard.current = true;
    startFresh();
  };
  const confirmLeave = () => {
    const target = pendingLeave.current;
    pendingLeave.current = null;
    setShowLeaveConfirm(false);
    flushFormDraft();
    skipLeaveGuard.current = true;
    if (target?.to) navigate(target.to);
  };

  return {
    ...media,
    ...location,
    handlePhotoUpload,
    set: setField,
    locationSet,
    t, navigate, editId, editRoomId, flatmateMode,
    editReady, editLoading, editLoadError, retryEditLoad,
    legacyAddress: editReady && hasStoredAddress(editListing?.form) ? editListing.form.existingAddress : '',
    currentStep, setCurrentStep: (step) => goToStep(step, { replace: true }), rentMode, setRentMode, isFlatmateMode,
    showSuccess, showResetConfirm, setShowResetConfirm, errors,
    showLeaveConfirm, setShowLeaveConfirm, confirmLeave,
    postedListing,
    authPromptOpen,
    setAuthPromptOpen,
    closeAuthPrompt,
    requestAuthPrompt,
    needsAuthForMedia: !signedIn,
    savedListingStatus,
    editApproved, editChanges, showIdentityGuard, setShowIdentityGuard,
    showDupGuard, setShowDupGuard, dupExistingId, dupPending, canPost,
    form, progressState,
    amenityPrefillRef,
    toggleInArray, toggleTenant, changePropertyType, changeCommercialType,
    isResidential, isLand, isCommercial, isHouse,
    money, setDepositMonths,
    nextStep, prevStep, openResetConfirm, confirmReset, submitProperty, submitFlatmate,
    postAnother,
    posting,
    activeListingCount: quota.used, listingLimit: quota.allowance,
  };
}

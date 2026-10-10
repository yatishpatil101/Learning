import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../../../lib/useScrollReveal.js';
import { useSignInGate } from '../../../../lib/useSignInGate.js';
import { useAuth } from '../../../../context/AuthContext.jsx';
import { useToast } from '../../../../context/ToastContext.jsx';
import { inviteRouteFor, isActive } from '../../../../lib/serviceRequestStatus.js';
import { listDocuments, uploadDocument } from '../../../../services/documentService.js';
import { useFormDraft } from '../../../../lib/hooks.js';
import { OWNER_DOCS, OWNER_VAULT_CAT, LAST_PUBLIC_STEP, MAX_LICENSORS, MAX_TENANTS, DECLARATION_VERSION } from './constants.js';
import { digits, num, rentForTerm, emptyTenant, emptyProp, emptyOwner, emptyCoOwner, emptyInvite, emptyTerms, emptyWit, DETAILS_MAX_CHARS, detailsChars, largestFreeTextField, redactIdentityNumbers, hasIdentityNumbers, identityReminderFields, missingIdentityReminderFields, identityParties, fillBlanks, namesOtherFlat, filingKey, listingAnswers, readSavedKyc } from './helpers.js';
import { docReady, stepErrors as formStepErrors, startDateBounds } from './validation.js';
import { collectDocs as collectFormDocs, draftDocRefs, removeIndexedDocs, slotForCategory } from './documents.js';
import { useRaFurniture } from './useRaFurniture.js';
import { useRaPayment } from './useRaPayment.js';
import { useEntitlements } from '../../property/useEntitlements.js';
import { getDealFees } from '../../../../services/feesService.js';
import { leaveLicenceStamp } from '../../../../lib/toolCalc.js';
import { myListing, myListings } from '../../../../services/propertyService.js';
import {
  addServiceRequestDoc,
  addServiceRequestDocFromVault,
  cancelServiceRequest,
  createCoFillServiceRequest,
  decideServiceRequestInvite,
  createServiceRequest as createServiceRequestLive,
  getServiceRequest,
  inviteServiceRequestParty,
  listMyServiceRequestInvites,
  listServiceRequests,
  openServiceRequestCheckout,
  recordServiceRequestIdentities,
  submitServiceRequestPartyDetails,
  withdrawServiceRequestParty,
} from '../../../../services/serviceRequestService.js';
// Where the wizard autosaves. Named because two things have to agree on it: the autosave itself and
// the purge that cleans entries written before the identity numbers were kept out of it.

const DRAFT_KEY = 'dzDraft:rentAgreement';

const withDefaults = (base, saved) => ({ ...base, ...(saved || {}) });

const invitedRole = (s) => (s?.ownerMode === 'invite' ? 'owner' : s?.tenantMode === 'invite' ? 'tenant' : null);

export function useRentAgreement() {
  const rootRef = useScrollReveal();
  const { t: tr } = useTranslation();
  const { user, isIn, loading } = useAuth();
  const { toast } = useToast();
  const formRef = useRef(null);
  const { mountedRef, paymentPending, paymentConfirming, payAndConfirm, resetPayment } = useRaPayment({ tr, toast });
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sendToSignIn = useSignInGate();

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  /* A request already filed whose identities, papers or checkout step failed. */
  // Submission is a round-trip plus a lazily-imported SDK, so the button stays clickable for a
  // visible beat. Without this guard a second click issues a second payment session.
  const [submitting, setSubmitting] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState(null);
  const [restoredIdentityFields, setRestoredIdentityFields] = useState([]);
  const filedRef = useRef(null);
  const uploadedRef = useRef(new Map());
  const [openFaq, setOpenFaq] = useState(-1);
  // After submission the owner's create-wizard is locked (the submitted request is the legal source
  // of truth); `startNew` bypasses that lock for a separate agreement on a different property.
  const [startNew, setStartNew] = useState(false);

  // Invite mode
  const [mode, setMode] = useState('owner');
  const [inviteCtx, setInviteCtx] = useState(null);
  const { entitlements, refresh: refreshEntitlements } = useEntitlements(isIn && !inviteCtx);
  const referralCredit = (entitlements?.agreements?.remaining ?? 0) >= 1;
  const [inviteError, setInviteError] = useState(null);
  /* The owner's own listings, for the "pick one of your properties" shortcut and the `?listing=` prefill. */
  const [selectedPropertyId, setSelectedPropertyId] = useState(null);
  const [myProperties, setMyProperties] = useState([]);
  useEffect(() => {
    if (!isIn) { setMyProperties([]); return undefined; }
    let alive = true;
    myListings(user)
      .then((rows) => { if (alive) setMyProperties(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setMyProperties([]); });
    return () => { alive = false; };
  }, [isIn, user]);
  const [inviteResult, setInviteResult] = useState(null);
  const [copied, setCopied] = useState(false);
  // Step 1 — Property

  const [prop, setProp] = useState(emptyProp());
  // Step 2 — Licensors: `owner` is licensor 0, `coOwners` licensors 1..n. Their doc slots share
  // `ownerDocs` (`o-*` for the owner, `c{i}-*` per co-owner).

  const [owner, setOwner] = useState(emptyOwner(isIn, user));
  const [coOwners, setCoOwners] = useState([]);
  const [ownerDocs, setOwnerDocs] = useState({});
  const [ownerMode, setOwnerMode] = useState('fill');
  // Step 3 — Tenant

  const [tenantMode, setTenantMode] = useState('fill');
  const [tenants, setTenants] = useState([emptyTenant()]);
  const [tenantDocs, setTenantDocs] = useState({});
  const [invite, setInvite] = useState(emptyInvite());
  // Step 4 — Terms

  const [terms, setTerms] = useState(emptyTerms());
  const [maint, setMaint] = useState('Tenant');
  const regArea = prop.gramPanchayat ? 'rural' : 'urban';
  const { furnItems, setFurnItems, custom, setCustom, isChecked, toggleFurn, bumpQty, removeFurn, addCustom, furnitureText } = useRaFurniture();
  const [clauses, setClauses] = useState('');
  // Step 5 — Witnesses

  const [wit, setWit] = useState(emptyWit());
  // Step 6 — Review

  const [declare, setDeclare] = useState(false);

  const setP = (k, v) => setProp((p) => ({ ...p, [k]: v }));
  const setO = (k, v) => setOwner((p) => ({ ...p, [k]: v }));
  const setT = (k, v) => setTerms((p) => ({ ...p, [k]: v }));
  const setTenant = (i, k, v) => setTenants((arr) => arr.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));
  const setCoOwner = (i, k, v) => setCoOwners((arr) => arr.map((c, idx) => (idx === i ? { ...c, [k]: v } : c)));
  const clearErr = (k) => setErrors((e) => (e[k] ? { ...e, [k]: false } : e));
  // ── Form state capture for autosave & co-fill ──

  const captureFormState = () => ({
    step,
    prop, terms, maint, regArea, furnItems, clauses, wit, declare,
    ...(ownerMode === 'invite'
      ? { owner: { ...emptyOwner(false), oMobile: digits(invite.invMobile).slice(-10) }, coOwners: [] }
      : { owner, coOwners }),
    // The invitee files their own police record; a blank one would fail the server's workplace rule.
    tenants: tenantMode === 'invite' ? tenants.map(({ police: _police, ...invited }) => invited) : tenants,
    tenantMode, ownerMode, invite, selectedPropertyId,
  /* The same capture minus the statutory identity numbers, for anything that outlives this tab (the co-fill payload
     and the autosave) — see `docs/flows/consumer/rent-agreement.md` § 5.9. */
  });
  const captureShareableState = () => {
    const { selectedPropertyId: _selectedPropertyId, ...state } = captureFormState();
    return redactIdentityNumbers(state);
  };
  // Merged over the blank shapes: drafts saved before a field existed must not leave it undefined.

  const applyFormState = (s) => {
    if (!s || typeof s !== 'object') return;
    if (typeof s.step === 'number') setStep(s.step);
    if (s.prop) {
      const restored = withDefaults(emptyProp(), s.prop);
      if (!Array.isArray(s.prop.propertyAttributes) && s.prop.surveyNo) restored.propertyAttributes = [{ kind: 'Survey No.', number: s.prop.surveyNo }];
      setProp(restored);
    }
    if (s.selectedPropertyId) setSelectedPropertyId(s.selectedPropertyId);
    if (s.owner) setOwner(withDefaults(emptyOwner(false), s.owner));
    if (Array.isArray(s.coOwners)) setCoOwners(s.coOwners.slice(0, MAX_LICENSORS - 1).map((c) => withDefaults(emptyCoOwner(), c)));
    if (s.terms) {
      const restored = withDefaults(emptyTerms(), s.terms);
      setTerms({ ...restored, months: String(restored.months), rent: digits(s.terms.rent), deposit: digits(s.terms.deposit), nrDeposit: digits(s.terms.nrDeposit) });
    }
    if (s.maint) setMaint(s.maint);
    if (s.furnItems) setFurnItems(s.furnItems);
    if (s.clauses != null) setClauses(s.clauses);
    if (s.wit) setWit(withDefaults(emptyWit(), s.wit));
    if (s.declare != null) setDeclare(s.declare);
    if (s.tenants) setTenants(s.tenants.map((t) => withDefaults(emptyTenant(), t)));
    if (s.tenantMode === 'invite' && s.invite?.invMobile && !(s.tenants || []).some((t) => digits(t.mobile))) {
      setTenants([withDefaults(emptyTenant(), { ...(s.tenants?.[0] || {}), name: s.invite.invName || '', mobile: s.invite.invMobile })]);
    }
    if (s.tenantMode) setTenantMode(s.tenantMode);
    setOwnerMode(s.ownerMode === 'invite' ? 'invite' : 'fill');
    if (s.invite) setInvite(s.invite);
    if (s.docRefs) {
      const restore = (refs) => (cur) => ({
        ...cur,
        ...Object.fromEntries(Object.entries(draftDocRefs(refs)).filter(([k]) => !docReady(cur[k]))),
      });
      setOwnerDocs(restore(s.docRefs.owner));
      setTenantDocs(restore(s.docRefs.tenant));
    }
  };
  // Once submitted, details are locked (the request is the legal drafting basis). Read from the
  // server: a browser-store read would let the owner pay for the same agreement twice after a reload.

  const [activeRequests, setActiveRequests] = useState([]);
  const [requestsNonce, setRequestsNonce] = useState(0);
  useEffect(() => {
    if (!isIn || !user?.mobile) { setActiveRequests([]); return undefined; }
    let alive = true;
    listServiceRequests('rental')
      .then((rs) => { if (alive) setActiveRequests((rs || []).filter((r) => isActive(r.status))); })
      .catch(() => { if (alive) setActiveRequests([]); });
    return () => { alive = false; };
  }, [isIn, user, done, requestsNonce]);
  const locked = mode === 'owner' && !done && !startNew && activeRequests.length > 0;

  const stalledInvite = (() => {
    const side = (r, role) => (r.parties || []).filter((p) => p?.role === role);
    const r = activeRequests.find((x) => {
      const role = invitedRole(x.details?._state);
      if (!role) return false;
      if (role !== 'tenant') return !side(x, role).some((p) => p.status === 'invited' || p.status === 'accepted');
      const count = Math.max(1, (x.details?._state?.tenants || []).length);
      return Array.from({ length: count }).some((_, i) => !side(x, role)
        .some((p) => Number(p.partyIndex || 0) === i && (p.status === 'invited' || p.status === 'accepted')));
    });
    if (!r) return null;
    const role = invitedRole(r.details._state);
    const partyIndex = role === 'tenant'
      ? Array.from({ length: Math.max(1, (r.details?._state?.tenants || []).length) })
        .findIndex((_, i) => !side(r, role).some((p) => Number(p.partyIndex || 0) === i && (p.status === 'invited' || p.status === 'accepted')))
      : 0;
    return {
      requestId: r.id,
      role,
      partyIndex,
      declined: side(r, role).find((p) => Number(p.partyIndex || 0) === partyIndex && p.status === 'declined') || null,
    };
  })();
  const [recovering, setRecovering] = useState(false);
  const recoverInvite = async (action, mobile) => {
    if (recovering || !stalledInvite) return;
    setRecovering(true);
    try {
      if (action === 'cancel') {
        await cancelServiceRequest(stalledInvite.requestId);
      } else {
        if (stalledInvite.declined) await withdrawServiceRequestParty(stalledInvite.requestId, stalledInvite.declined.id);
        await inviteServiceRequestParty(stalledInvite.requestId, { role: stalledInvite.role, partyIndex: stalledInvite.partyIndex, mobile: digits(mobile) });
      }
      if (mountedRef.current) toast(tr(action === 'cancel' ? 'services.ra.declined.cancelled' : 'services.ra.declined.reinvited'), 'success');
    } catch (err) {
      console.error('Rent Agreement invite recovery failed', err?.status);
      if (mountedRef.current) toast(tr('services.ra.declined.failed'), 'error');
    } finally {
      if (mountedRef.current) { setRecovering(false); setRequestsNonce((n) => n + 1); }
    }
  };

  const payable = stalledInvite ? null : activeRequests.find((r) => r.status === 'awaiting_payment' && Number(r.amount) > 0
    && !(r.parties || []).some((p) => p.status === 'invited')) || null;
  const [paying, setPaying] = useState(false);
  const payingRef = useRef(false);
  const payFiled = async () => {
    if (payingRef.current || !payable) return;
    payingRef.current = true;
    setPaying(true);
    try {
      const checkout = await openServiceRequestCheckout(payable.id, DECLARATION_VERSION);
      const status = await payAndConfirm(checkout, referralCredit ? null : Number(payable.amount) || null);
      if (mountedRef.current && status === 'cancelled') toast(tr('services.ra.checkoutFailed'), 'error');
      else if (mountedRef.current && status && status !== 'awaiting_payment') toast(tr('services.ra.pay.paid'), 'success');
    } catch (err) {
      console.error('Rent Agreement checkout refused', err?.status);
      if (mountedRef.current) toast(err?.status === 409 && err?.message ? tr('services.ra.checkoutIncomplete', { detail: err.message }) : tr('services.ra.checkoutFailed'), 'error');
    } finally {
      payingRef.current = false;
      refreshEntitlements();
      if (mountedRef.current) { setPaying(false); setRequestsNonce((n) => n + 1); }
    }
  };

  const liveParty = (r, role) => (r.parties || []).some((p) => p?.role === role && (p.status === 'invited' || p.status === 'accepted'));
  const continuable = activeRequests.find((r) => r.status === 'awaiting_payment' && !r.paymentSessionId && r.details?._state
    && (invitedRole(r.details._state) ? liveParty(r, invitedRole(r.details._state)) : !(r.parties || []).length)) || null;
  const topUpRef = useRef(null);
  const topUpBaselineRef = useRef(null);
  const answersKey = () => filingKey({ ...captureShareableState(), step: 0 });
  useEffect(() => {
    if (topUpRef.current && topUpBaselineRef.current == null) topUpBaselineRef.current = answersKey();
  });
  const continueFiled = () => {
    if (!continuable) return;
    if (!restored) applyFormState(continuable.details._state);
    const filed = { owner: {}, tenant: {} };
    for (const doc of continuable.docs || []) {
      const slot = slotForCategory(doc.category);
      if (slot) filed[slot.side][slot.key] = { fileName: doc.fileName, filedOn: continuable.id };
    }
    const fill = (add) => (cur) => ({ ...cur, ...Object.fromEntries(Object.entries(add).filter(([k]) => !cur[k]?.dataUrl)) });
    setOwnerDocs(fill(filed.owner));
    setTenantDocs(fill(filed.tenant));
    if (invitedRole(continuable.details._state)) {
      topUpRef.current = continuable;
      topUpBaselineRef.current = null;
    } else filedRef.current = { key: filingKey({ details: continuable.details, propertyId: continuable.propertyId || undefined }), request: continuable };
    setPendingRequestId(continuable.id);
    setSelectedPropertyId(continuable.propertyId || null);
    setStep(0);
    setStartNew(true);
  };

  // Begin a fresh agreement for a different property: clear the saved draft and reset every field.
  const startNewAgreement = () => {
    clearDraft();
    setStep(0);
    setErrors({});
    setLiveStep(null);
    setProp(emptyProp());
    setSelectedPropertyId(null);
    setOwner(emptyOwner(isIn, user));
    setCoOwners([]);
    setOwnerDocs({});
    setOwnerMode('fill');
    setTenantMode('fill');
    setTenants([emptyTenant()]);
    setTenantDocs({});
    setInvite(emptyInvite());
    setTerms(emptyTerms());
    setMaint('Tenant');
    setFurnItems([]);
    setCustom({ name: '', qty: 1 });
    setClauses('');
    setWit(emptyWit());
    setDeclare(false);
    setInviteResult(null);
    setCopied(false);
    setOpenFaq(-1);
    // These belong to the attempt being abandoned. Left set, the "could not confirm your payment"
    // panel reappears over a fresh agreement that has not been submitted, let alone paid for.
    resetPayment();
    setPendingRequestId(null);
    filedRef.current = null;
    topUpRef.current = null;
    topUpBaselineRef.current = null;
    uploadedRef.current = new Map();
    setStartNew(true);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // ── Draft autosave/restore ──

  // Purges identity numbers from a pre-existing draft. **Must stay above the `useFormDraft` call**
  // — see `docs/flows/consumer/rent-agreement.md` § 5.9 for the ordering and why it runs on read.

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!hasIdentityNumbers(saved)) return;
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        ...redactIdentityNumbers(saved),
        identityReminders: identityReminderFields(saved),
      }));
    } catch {}
  }, []);

  // `useFormDraft` restores via a functional updater — resolve it against live state before
  // dispatching, otherwise the whole draft is dropped. Saved from the *shareable* capture (§ 5.9).
  const form = {
    ...captureShareableState(),
    identityReminders: identityReminderFields(captureFormState()),
    docRefs: { owner: draftDocRefs(ownerDocs), tenant: draftDocRefs(tenantDocs) },
  };
  const restoreFormState = (upd) => {
    const next = typeof upd === 'function' ? upd(captureFormState()) : upd;
    setRestoredIdentityFields(Array.isArray(next?.identityReminders) ? next.identityReminders : []);
    applyFormState(next);
  };
  const { restored, clear: clearDraft, flush: flushDraft, startFresh } = useFormDraft(DRAFT_KEY, form, restoreFormState, { enabled: mode === 'owner' && !done, ignore: ['oName', 'oMobile', 'step'] });
    /* `gated` represents resolved signed-out owner mode, distinct from pending authentication. */

  const gated = mode === 'owner' && !loading && !isIn;
    /* Flush the debounced owner draft before navigation so recent input survives sign-in. */

  const gateToSignIn = () => {
    flushDraft();
    sendToSignIn('services');
  };
    /* Signed-out owners remain on public steps even when restored drafts name a later step. */

  useLayoutEffect(() => {
    if (!gated) return;
    if (step > LAST_PUBLIC_STEP) setStep(LAST_PUBLIC_STEP);
  }, [gated, step]);
  // ── Owner KYC autofill ──
  // Deliberately carries no PAN or Aadhaar — see `persistOwnerKYC` — so the owner retypes those.

  useEffect(() => {
    if (mode !== 'owner' || !isIn) return;
    const kyc = readSavedKyc(user?.mobile);
    if (kyc) {
      // Purge on read: rewriting the entry here is the only moment the app is guaranteed to touch
      // this key, so a write-only fix would leave every existing browser exposed.
      setOwner((o) => ({ ...o, oName: o.oName || kyc.name || '', oMother: o.oMother || kyc.mother || '', oDob: o.oDob || kyc.dob || '', oAlias: o.oAlias || kyc.alias || '', oAge: o.oAge || kyc.age || '', oGender: o.oGender || kyc.gender || '', oOccupation: o.oOccupation || kyc.occupation || '', oMobile: o.oMobile || kyc.mobile || '', oEmail: o.oEmail || kyc.email || '', oAddr: o.oAddr || kyc.addr || '' }));
    } else {
      setOwner((o) => ({ ...o, oName: o.oName || user?.name || '', oMobile: o.oMobile || user?.mobile || '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed owner only when mode/sign-in flips
  }, [mode, isIn]);
  /* `pan` and `aadhaar` are deliberately excluded and must stay excluded: this key is plain JSON on `localStorage`,
     never expired, and Aadhaar is not ours to retain (Aadhaar Act s.29). */

  const persistOwnerKYC = () => {
    if (mode !== 'owner' || ownerMode === 'invite' || !isIn) return;
    try {
      const mob = digits(owner.oMobile || user?.mobile || '');
      if (!mob) return;
      localStorage.setItem('draazyOwnerKYC:' + mob, JSON.stringify({ name: owner.oName, mother: owner.oMother, dob: owner.oDob, alias: owner.oAlias, age: owner.oAge, gender: owner.oGender, occupation: owner.oOccupation, email: owner.oEmail, addr: owner.oAddr, mobile: owner.oMobile, savedAt: Date.now() }));
    } catch {}
  };
  /* Prefills document slots the owner already keeps in the vault. */

  const vaultEnabled = mode === 'owner' && isIn && !!user?.mobile;
  useEffect(() => {
    if (!vaultEnabled) return;
    let cancelled = false;
    (async () => {
      // A vault read must never cost the owner the wizard: an unreachable or empty vault means
      // "no prefill", not a broken step.
      const personal = await listDocuments(user.mobile, 'personal').catch(() => null);
      if (cancelled || !personal) return;
      const held = new Set(personal.map((d) => String(d.id)));
      setOwnerDocs((cur) => {
        const next = { ...cur };
        OWNER_DOCS.forEach(([, k]) => {
          const d = next[k];
          if (d?.vaultDocId && !d.dataUrl && !held.has(String(d.vaultDocId))) next[k] = { fileName: d.fileName, reattach: true };
          if (docReady(next[k])) return;
          const hit = personal.find((row) => row.category === OWNER_VAULT_CAT[k] && row.id);
          if (hit) next[k] = { fileName: hit.name, mime: hit.mime, vaultDocId: hit.id, fromVault: true };
        });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh vault only when it becomes available
  }, [vaultEnabled]);
  /* Saves a freshly uploaded owner doc back to the vault for reuse, skipping vault-sourced picks, over-size files and
     duplicates. */

  const saveOwnerDocToVault = async (k, d, file) => {
    if (!vaultEnabled || !d?.dataUrl || d.fromVault || !file) return;
    const cat = OWNER_VAULT_CAT[k];
    if (!cat) return;
    try {
      const existing = await listDocuments(user.mobile, 'personal');
      const saved = existing.find((x) => x.category === cat && x.name === d.fileName)
        || await uploadDocument(user.mobile, 'personal', { category: cat, file });
      if (!saved?.id || !mountedRef.current) return;
      setOwnerDocs((s) => (s[k]?.dataUrl === d.dataUrl ? { ...s, [k]: { ...s[k], vaultDocId: saved.id } } : s));
    } catch {}
  };

  const [feeRow, setFeeRow] = useState(null);
  const [feeStatus, setFeeStatus] = useState('loading');
  const [feeAttempt, setFeeAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFeeStatus('loading');
    getDealFees('rent')
      .then((f) => {
        if (!alive) return;
        // No published row is not an empty row: falling through to `ready` with `null` would render
        // a confident ₹0 for a price nobody published.
        setFeeRow(f || null);
        setFeeStatus(f ? 'ready' : 'error');
      })
      .catch(() => {
        if (!alive) return;
        setFeeRow(null);
        setFeeStatus('error');
      });
    return () => { alive = false; };
  }, [feeAttempt]);
  const retryFees = () => setFeeAttempt((n) => n + 1);

  const cost = useMemo(() => {
    const rent = num(terms.rent), dep = num(terms.deposit), nr = num(terms.nrDeposit);
    const months = parseInt(terms.months, 10) || 11;
    // Rent, deposit and term are the customer's own answers, not charges — they stay readable while
    // the schedule is loading or unavailable. Only the money we would be taking goes blank.
    const answers = { rent, dep, months, status: feeStatus, retry: retryFees };
    if (feeStatus !== 'ready' || !feeRow) {
      return { ...answers, stamp: null, reg: null, dhc: null, service: null, gst: null, total: null, computed: [], notes: null };
    }
    const years = Math.ceil(months / 12);
    /* `stampDuty`/`registration` arrive `null` because neither is a flat figure; anything derived here lands in
       `computed`, so the sidebar labels it an estimate. */
    const computed = [];
    let stamp = feeRow.stampDuty;
    if (stamp == null) { stamp = leaveLicenceStamp(rentForTerm(rent, months, terms.increment, terms.incrementEvery), nr, dep, years); computed.push('stamp'); }
    let reg = feeRow.registration;
    if (reg == null) { reg = regArea === 'rural' ? 500 : 1000; computed.push('reg'); }
    const dhc = 300;
    const service = feeRow.platformFee;
    const gst = feeRow.gst;
    const waived = referralCredit ? service + gst : 0;
    return {
      ...answers,
      stamp, reg, dhc, service, gst, waived,
      total: service + stamp + reg + dhc + gst - waived,
      computed,
      notes: feeRow.notes || null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retryFees is a stable state increment
  }, [terms.rent, terms.deposit, terms.nrDeposit, terms.months, terms.increment, terms.incrementEvery, regArea, feeStatus, feeRow, referralCredit]);
  // Built outside `generate` so the size guard below measures the object that will be posted.

  const propertyLine = () =>[prop.flatNo, prop.society, prop.locality, prop.city].filter(Boolean).join(', ');
  const invitedLabel = () => 'Invited: ' + (invite.invName || '••••••' + digits(invite.invMobile).slice(-4)) + ' (pending)';
  const tenantNames = () => (tenantMode === 'invite' ? invitedLabel() : tenants.map((t) => t.name.trim()).filter(Boolean).join(', '));
  const buildDetails = () => ({
    property: propertyLine(), ownerName: ownerMode === 'invite' ? invitedLabel() : owner.oName || user?.name || 'Owner', tenants: tenantNames(),
    rent: cost.rent, deposit: cost.dep, nrDeposit: num(terms.nrDeposit), months: terms.months,
    startDate: terms.startDate, regArea: regArea === 'urban' ? 'Municipal / Urban' : 'Rural',
    _state: captureShareableState(),
  });
  /* The server caps serialized `details` at `DETAILS_MAX_CHARS` and answers 400. */

  const detailsSize = detailsChars(buildDetails());
  const detailsTooLong = detailsSize > DETAILS_MAX_CHARS;
  const detailsWorstField = largestFreeTextField(captureShareableState());

  const inviteRole = inviteCtx?.invite?.toRole || null;
  const formSnapshot = () => ({ mode, inviteRole, prop, owner, coOwners, ownerMode, tenantMode, tenants, invite, terms, wit, ownerDocs, tenantDocs });
  const collectDocs = () => collectFormDocs(formSnapshot());
  // ── Parties ──

  const addTenant = () => setTenants((arr) => (arr.length < MAX_TENANTS ? [...arr, emptyTenant()] : arr));
  const removeTenant = (i) => {
    if (tenants.length <= 1) return;
    setTenants((arr) => arr.filter((_, idx) => idx !== i));
    setTenantDocs((d) => removeIndexedDocs(d, 't', i));
    setErrors({});
  };
  // Joint owners all execute the deed, so the primary's capacity follows whether there are co-owners.
  const addCoOwner = () => {
    if (coOwners.length >= MAX_LICENSORS - 1) return;
    setCoOwners((arr) => [...arr, emptyCoOwner()]);
    setOwner((o) => (o.capacity === 'owner' ? { ...o, capacity: 'co-owner' } : o));
  };
  const removeCoOwner = (i) => {
    setCoOwners((arr) => arr.filter((_, idx) => idx !== i));
    setOwnerDocs((d) => removeIndexedDocs(d, 'c', i));
    if (coOwners.length === 1) setOwner((o) => (o.capacity === 'co-owner' ? { ...o, capacity: 'owner' } : o));
    setErrors({});
  };
  const startBounds = startDateBounds();

  const signInSentRef = useRef(false);
  useEffect(() => {
    const partyId = searchParams.get('party');
    const requestId = searchParams.get('request');
    // Wait for a restore to settle before deciding: a signed-in party arriving on a cold tab has no
    // cached user for a moment, and bouncing them would lose the invitation they followed.
    if (!partyId && !requestId) return;
    if (loading) return;
    if (!isIn || !user?.mobile) {
      if (!signInSentRef.current) sendToSignIn('invite');
      signInSentRef.current = true;
      return;
    }
    let alive = true;
    (async () => {
      try {
        const invites = await listMyServiceRequestInvites();
        if (!alive) return;
        const row = (invites || []).find((inv) =>
          partyId && requestId
            ? inv?.id === partyId && inv?.requestId === requestId
            : inv?.id === partyId || inv?.requestId === requestId,
        );
        if (row && row.status === 'declined') {
          if (alive) setInviteError({ kind: 'expired' });
          return;
        /* An accepted invitation leaves the pending list, so a reload finds no row. */
        }
        const reqId = row?.requestId || requestId;
        if (!reqId) {
          if (alive) setInviteError({ kind: 'expired' });
          return;
        }
          /* Two accepts can race (StrictMode, or two tabs) and the loser is refused. */
        if (row && row.status !== 'accepted') {
          try {
            await decideServiceRequestInvite(row.id, 'accept');
          } catch {}
        }
        const req = await getServiceRequest(reqId);
        if (!req) {
          if (alive) setInviteError({ kind: 'expired' });
          return;
        }
        if (!alive) return;
        setInviteError(null);
        const partyRow = row || (req.parties || []).find((p) => p?.id === partyId);
        const role = partyRow?.role || 'tenant';
        const partyIndex = Number(partyRow?.partyIndex) || 0;
        setInviteCtx({
          invite: {
            inviteId: row?.id || partyId,
            reqId,
            toRole: role,
            partyIndex,
            toName: null,
            toMobile: digits(user.mobile),
          },
          req,
        });
        setMode('invite');
        if (req.details && req.details._state) applyFormState(req.details._state);
        const kyc = readSavedKyc(user.mobile) || {};
        if (role === 'tenant') {
          setTenants((arr) => arr.map((item, idx) => (idx === partyIndex
            ? fillBlanks(item || emptyTenant(), { name: user.name || kyc.name, mother: kyc.mother, dob: kyc.dob, alias: kyc.alias, mobile: digits(user.mobile).slice(-10), email: user.email || kyc.email, age: kyc.age, addr: kyc.addr })
            : item)));
        } else {
          setOwner((o) => ({ ...fillBlanks(o, { oName: user.name || kyc.name, oMother: kyc.mother, oDob: kyc.dob, oAlias: kyc.alias, oEmail: user.email || kyc.email, oAge: kyc.age, oGender: kyc.gender, oOccupation: kyc.occupation, oAddr: kyc.addr }), oMobile: digits(user.mobile).slice(-10) }));
        }
        setOwnerMode('fill');
        setTenantMode('fill');
        setStep(0);
      } catch {
        if (alive) setInviteError({ kind: 'expired' });
      }
    })();
    return () => { alive = false; };
    /* `sendToSignIn` is deliberately absent: its identity changes whenever `t` does, so listing it would re-run this
       invite lookup on every language switch. */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invite URL should resolve once per signed-in user
  }, [searchParams, isIn, loading, user]);
  // ── Pending co-fill invites for the signed-in user (banner outside the invite flow) ──

  const [myInvites, setMyInvites] = useState([]);
  useEffect(() => {
    if (mode === 'invite' || !isIn || !user?.mobile) { setMyInvites([]); return; }
    if (searchParams.get('party')) return;
    let alive = true;
    listMyServiceRequestInvites()
      .then((rows) => {
        if (!alive) return;
        setMyInvites((rows || []).filter((row) => row?.status === 'invited').map((row) => ({
          inviteId: row.id,
          requestId: row.requestId,
          fromName: row.invitedBy,
          property: null,
          href: inviteRouteFor(row),
        })));
      })
      .catch(() => { if (alive) setMyInvites([]); });
    return () => { alive = false; };
  }, [mode, isIn, user, searchParams]);

  // ── Property auto-fill from ?listing=<id> (or ?flat=<id> from a flatmate reissue) ──
  const listingPickRef = useRef(0);
  const propRef = useRef(prop);
  const listingRefusedRef = useRef(false);
  useEffect(() => { propRef.current = prop; }, [prop]);
  const applyListing = async (l, { overwrite }) => {
    const id = l.uuid || l.id;
    const seq = ++listingPickRef.current;
    const full = await myListing(id, user).catch(() => null);
    if (!mountedRef.current || seq !== listingPickRef.current) return false;
    const { prop: answers, terms: termAnswers } = listingAnswers(full || l);
    if (!overwrite && namesOtherFlat(propRef.current, answers)) {
      listingRefusedRef.current = true;
      toast(tr('services.ra.listingOtherFlat'), 'info');
      return false;
    }
    setSelectedPropertyId(id || null);
    const { furnish, areaBasis, areaUnit, ...rest } = answers;
    const address = { flatNo: '', society: '', societyId: '', locality: '', pincode: '', area: '', floor: '' };
    const set = overwrite ? { ...address, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v)) } : null;
    setProp((cur) => ({
      ...(set ? { ...cur, ...set } : fillBlanks(cur, rest)),
      ...(furnish && (overwrite || !restored) ? { furnish } : {}),
      ...(rest.area && (overwrite || !String(cur.area ?? '').trim()) ? { areaBasis, areaUnit } : {}),
    }));
    setTerms((cur) => fillBlanks(cur, termAnswers));
    ['flatNo', 'society', 'locality', 'pincode', 'area'].forEach(clearErr);
    return true;
  };
  const pickListing = (l) => applyListing(l, { overwrite: true });

  const listingAppliedRef = useRef(null);
  useEffect(() => {
    if (mode === 'invite') return;
    // The flatmate reissue CTA links here as `?flat=<listing-id>`, so accept `flat` as an alias
    // for `listing` — a room's propertyId is its listing id.
    const reissue = searchParams.get('reissue') === '1';
    const listingId = searchParams.get('listing') || searchParams.get('flat');
    /* Matched against the loaded rows on both `id` and `slug`: a listing created through the API has a null slug
       until moderation names one, so the two are not interchangeable. */
    if (!listingId || listingAppliedRef.current === listingId) return;
    const l = myProperties.find((row) => row.id === listingId || row.slug === listingId);
    if (!l) return;
    // eslint-disable-next-line
    // Prefill from listing
    listingAppliedRef.current = listingId;
    applyListing(l, { overwrite: false }).then((applied) => {
      if (applied && reissue) toast(tr('services.ra.reissueHint'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume listing URL once without overwriting edits
  }, [searchParams, mode, myProperties]);

  const stepErrors = (s) => formStepErrors(s, formSnapshot());
  const [liveStep, setLiveStep] = useState(null);
  const [errorFocus, setErrorFocus] = useState(0);
  const flagErrors = (s, e) => { setErrors(e); setLiveStep(s); setErrorFocus((n) => n + 1); };
  useEffect(() => {
    if (liveStep === null || liveStep !== step) return;
    setErrors(stepErrors(step));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- errors recompute from the listed form slices
  }, [prop, owner, coOwners, ownerMode, tenantMode, tenants, invite, terms, wit, ownerDocs, tenantDocs]);
  useEffect(() => {
    if (!errorFocus) return;
    const el = formRef.current?.querySelector('.step-panel.active .err, .step-panel.active .dz-invalid, .step-panel.active [aria-invalid="true"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const control = el.matches('input, select, textarea, button') ? el : el.querySelector('input, select, textarea, button');
    control?.focus({ preventScroll: true });
  }, [errorFocus]);
  const validateStep = (s) => {
    const e = stepErrors(s);
    if (Object.keys(e).length) { flagErrors(s, e); toast(tr('services.ra.validationRequired'), 'error'); return false; }
    setErrors(e);
    return true;
  };
  const next = () => {
     /* Validate before sign-in navigation so restored drafts return to a valid step. */
    if (!validateStep(step)) return;
    if (gated && step >= LAST_PUBLIC_STEP) { gateToSignIn(); return; }
    // Warned at each transition, not only at the end: the limit is on the whole form, so naming the
    // offending field here puts it beside the control that has to shrink.
    if (detailsTooLong) toast(tr('services.ra.detailsTooLong', { field: tr(detailsWorstField.label), over: detailsSize - DETAILS_MAX_CHARS }), 'error');
    setStep((s) => Math.min(5, s + 1));
    scrollTop();
  };
  const prev = () => { setStep((s) => Math.max(0, s - 1)); scrollTop(); };
  const scrollTop = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const copyInviteLink = async () => {
    if (!inviteResult?.link) return;
    try {
      await navigator.clipboard.writeText(inviteResult.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast(tr('services.ra.invite.copied'), 'success');
    } catch {
      toast(tr('services.ra.invite.copyFail'), 'error');
    }
  };
  /* Takes an unanswered invitation back (V107). */

  const [withdrawing, setWithdrawing] = useState(false);
  const withdrawInvite = async () => {
    if (withdrawing || !inviteResult?.requestId || !inviteResult?.partyId) return;
    setWithdrawing(true);
    try {
      await withdrawServiceRequestParty(inviteResult.requestId, inviteResult.partyId);
      if (!mountedRef.current) return;
      setInviteResult(null);
      toast(tr('services.ra.invite.withdrawn'), 'success');
    } catch (err) {
      console.error('Rent Agreement invite withdraw failed', err?.status || err?.message);
      if (mountedRef.current) toast(tr('services.ra.invite.withdrawFailed'), 'error');
    } finally {
      if (mountedRef.current) setWithdrawing(false);
    }
  };

  const releaseFiled = () => {
    const release = (cur) => Object.fromEntries(Object.entries(cur).map(([k, d]) => [k, d?.filedOn ? { fileName: d.fileName, reattach: true } : d]));
    setOwnerDocs(release);
    setTenantDocs(release);
  };

  // A retry skips papers that already landed on this request; a replaced file in the same slot is sent.
  const uploadDocs = async (requestId, docs) => {
    let ok = true;
    let stale = false;
    for (const d of docs) {
      if (d.file.filedOn) { stale = stale || d.file.filedOn !== requestId; continue; }
      const slot = `${requestId}:${d.key}`;
      const ref = d.file.dataUrl || `vault:${d.file.vaultDocId}`;
      if (uploadedRef.current.get(slot) === ref) continue;
      try {
        // eslint-disable-next-line no-await-in-loop -- uploads must preserve request/doc order
        await (d.file.dataUrl
          ? addServiceRequestDoc(requestId, d.file)
          : addServiceRequestDocFromVault(requestId, { documentId: d.file.vaultDocId, category: d.file.category }));
        uploadedRef.current.set(slot, ref);
      } catch (err) {
        console.error('Rent Agreement document upload failed', err?.status || err?.message);
        ok = false;
      }
    }
    if (stale) { releaseFiled(); return 'reattach'; }
    return ok;
  };
  // Never log the payload of an identities call: its body is a set of Aadhaar numbers.

  const handOff = async (requestId, parties, docs) => {
    let identitiesError = null;
    try {
      await recordServiceRequestIdentities(requestId, parties);
    } catch (err) {
      console.error('Rent Agreement identity hand-off failed', err?.status || err?.message);
      // Formats are checked before submit, so a 422 here is a number another party (often a co-filler) already holds.
      identitiesError = err?.status === 422 ? 'services.ra.identitiesDuplicate' : 'services.ra.identitiesRetry';
    }
    const docsOk = await uploadDocs(requestId, docs);
    if (identitiesError) return tr(identitiesError);
    if (docsOk === 'reattach') return tr('services.ra.docsReattach');
    if (!docsOk) return tr('services.ra.docsRetry');
    return null;
  };
  /* After the create: identities, papers, checkout. */

  const finishOwnerRequest = async (requestId, docs) => {
    const handOffFailure = await handOff(requestId, identityParties({ owner, coOwners, tenants, wit }), docs);
    if (handOffFailure) return handOffFailure;
    let checkout;
    try {
      checkout = await openServiceRequestCheckout(requestId, DECLARATION_VERSION);
    } catch (err) {
      console.error('Rent Agreement checkout refused', err?.status);
      return err?.status === 409 && err?.message ? tr('services.ra.checkoutIncomplete', { detail: err.message }) : tr('services.ra.checkoutFailed');
    }
    await payAndConfirm(checkout, referralCredit ? null : cost.total);
    refreshEntitlements();
    return null;
  };

  const shareInvite = (request, role, inviteMobile) => {
    const party = (request?.parties || []).find((p) => p?.role === role && p?.status === 'invited')
      || (request?.parties || [])[0]
      || null;
    const property = propertyLine();
    const invitePath = inviteRouteFor({ id: party?.id, requestId: request?.id });
    const link = new URL(invitePath, window.location.origin).toString();
    const signupLink = new URL(`/signup?next=${encodeURIComponent(invitePath)}`, window.location.origin).toString();
    /* The invitee is told by the server: `CoFillParties.invite` raises `service.party-invited` through the `Notifier`
       port, the only place quiet hours and preferences are applied. */
    const inviter = role === 'owner' ? tenants[0]?.name?.trim() || user?.name || 'Your tenant' : owner.oName || user?.name || 'Your owner';
    const text = `Hi${invite.invName ? ' ' + invite.invName : ''}, ${inviter} invited you to complete your rent-agreement details on Draazy${property ? ` for ${property}` : ''}. Please sign in (or create an account) first, then open this invite: ${link}\n\nSign up: ${signupLink}`;
    setInviteResult({
      toName: invite.invName || '',
      toMobile: inviteMobile,
      link,
      waLink: `https://wa.me/91${inviteMobile}?text=${encodeURIComponent(text)}`,
      // Two different waits (V107): a `pending` party is a number nobody has signed up to, so
      // "ask them to create an account" is the advice; otherwise the account just hasn't answered.
      requestId: request?.id || null,
      partyId: party?.id || null,
      pending: !!party?.pending,
      maskedMobile: party?.mobile || null,
    });
  };

  const settleFiled = () => {
    filedRef.current = null;
    setPendingRequestId(null);
  };

  const fileRequest = async (key, create, docs) => {
    const filed = filedRef.current;
    if (filed?.key === key) return filed.request;
    if (filed && docs.some((d) => d.file.filedOn)) {
      releaseFiled();
      if (mountedRef.current) toast(tr('services.ra.docsReattach'), 'error');
      return null;
    }
    if (filed) {
      await cancelServiceRequest(filed.request.id);
      settleFiled();
    }
    const request = await create();
    filedRef.current = { key, request };
    setPendingRequestId(request?.id || null);
    return request;
  };

  const submitOwner = async (details, propertyId, docs) => {
    persistOwnerKYC();
    const invitingRole = ownerMode === 'invite' ? 'owner' : tenantMode === 'invite' ? 'tenant' : null;
    const tenantInvites = tenantMode === 'invite'
      ? tenants.map((row, i) => ({ row, i, mobile: digits(row.mobile) })).filter((row) => row.mobile)
      : [];
    const inviteMobile = invitingRole === 'tenant' ? tenantInvites[0]?.mobile : digits(invite.invMobile);
    const ownParties = invitingRole === 'owner' ? { tenants, wit } : invitingRole === 'tenant' ? { owner, coOwners, wit } : { owner, coOwners, tenants, wit };
    if (topUpRef.current) {
      const request = topUpRef.current;
      if (answersKey() !== topUpBaselineRef.current) {
        toast(tr('services.ra.locked.topUpChanged', { context: invitingRole === 'owner' ? 'owner' : undefined }), 'error');
        return false;
      }
      const failure = await handOff(request.id, identityParties(ownParties), docs);
      if (!mountedRef.current) return false;
      if (failure) { toast(failure, 'error'); return false; }
      topUpRef.current = null;
      topUpBaselineRef.current = null;
      releaseFiled();
      settleFiled();
      clearDraft();
      toast(tr('services.ra.locked.toppedUp'), 'success');
      setStartNew(false);
      setRequestsNonce((n) => n + 1);
      return false;
    }
    if (invitingRole && inviteMobile) {
      const request = await fileRequest(JSON.stringify({ details, propertyId, inviteMobile }),
      // Only the requester may hand off their own side, so it happens while their session owns it.
        () => createCoFillServiceRequest({ request: { type: 'rental', details, propertyId }, role: invitingRole, mobile: inviteMobile }), docs);
      if (!request) return false;
      let invitedRequest = request;
      if (invitingRole === 'tenant') {
        for (const row of tenantInvites.slice(1)) {
          // eslint-disable-next-line no-await-in-loop -- tenant invites chain from the first request
          invitedRequest = await inviteServiceRequestParty(request.id, { role: 'tenant', mobile: row.mobile, partyIndex: row.i });
        }
      }
      const failure = await handOff(request?.id, identityParties(ownParties), docs);
      if (failure) {
        if (mountedRef.current) toast(failure, 'error');
        return false;
      }
      settleFiled();
      shareInvite(invitedRequest, invitingRole, inviteMobile);
      return true;
    }
    /* No admin lead ticket is raised: an unpaid request is invisible to the ops queue by design (§ 5.10). */
    const key = filingKey({ details, propertyId });
    const request = await fileRequest(key,
      () => createServiceRequestLive({ type: 'rental', service: 'Rent Agreement', customer: { name: details.ownerName }, details, propertyId }), docs);
    if (!request) return false;
    const failure = await finishOwnerRequest(request?.id, docs);
    if (failure) {
      if (mountedRef.current) toast(failure, 'error');
      return false;
    }
    settleFiled();
    return true;
  };

  const submitInvitee = async (details) => {
    const requestId = inviteCtx.req.id;
    await submitServiceRequestPartyDetails(requestId, details);
    const partyIndex = Number(inviteCtx.invite?.partyIndex) || 0;
    const identityRows = inviteRole === 'owner'
      ? identityParties({ owner, coOwners })
      : identityParties({ tenants: [tenants[partyIndex] || emptyTenant()] })
        .map((row) => ({ ...row, partyIndex }));
    const docs = inviteRole === 'owner' ? collectDocs() : collectDocs()
      .filter((doc) => doc.category.startsWith(`tenant-${partyIndex}-`));
    const failure = await handOff(requestId, identityRows, docs);
    if (failure) { toast(failure, 'error'); return false; }
    return true;
  };

  const generate = async () => {
    // Hold while auth is unresolved; an expired session goes through `gateToSignIn` to keep the draft.
    if (submitting || done) return;
    if (loading) return;
    if (!isIn) { gateToSignIn(); return; }
    for (let s = 0; s <= 4; s++) {
      const e = stepErrors(s);
      if (Object.keys(e).length) { setStep(s); flagErrors(s, e); toast(tr('services.ra.validationRequired'), 'error'); return; }
    }
    if (!declare) { toast(tr('services.ra.declarationRequired'), 'error'); return; }
    // Refuse before the server does, and name the field that has to shrink.
    if (detailsTooLong) {
      setStep(detailsWorstField.step);
      toast(tr('services.ra.detailsTooLong', { field: tr(detailsWorstField.label), over: detailsSize - DETAILS_MAX_CHARS }), 'error');
      scrollTop();
      return;
    }
    const details = buildDetails();
    const propertyReference = listingRefusedRef.current ? null : searchParams.get('listing') || searchParams.get('flat');
    const propertyId = selectedPropertyId
      || myProperties.find((row) => row.id === propertyReference || row.slug === propertyReference)?.uuid
      || undefined;

    setSubmitting(true);
    let finished = false;
    try {
      if (mode === 'owner') finished = await submitOwner(details, propertyId, collectDocs());
      else if (mode === 'invite' && inviteCtx) finished = await submitInvitee(details);
      if (finished && mode === 'owner') clearDraft();
    } catch (err) {
      console.error('Rent Agreement submit failed', err?.status || err?.message);
      // A 422 names the rule the server enforces (`RentAgreementDetailsRules`); say which.
      if (mountedRef.current) toast(err?.status === 422 && err?.message ? tr('services.ra.detailsRejected', { detail: err.message }) : tr('services.ra.saveError'), 'error');
      return;
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
    // The checkout modal can stay open long enough for the customer to navigate away; scrolling a
    // page they already left is a visible artefact rather than a harmless no-op.

    if (!finished || !mountedRef.current) return;
    setDone(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const chooseOwnerMode = (m) => {
    setOwnerMode(m);
    setErrors({});
    if (m !== 'invite') return;
    setTenantMode('fill');
    const self = digits(user?.mobile || '').slice(-10);
    if (!self || tenants.some((row) => digits(row.mobile).slice(-10) === self)) return;
    setTenants((arr) => [fillBlanks(arr[0] || emptyTenant(), { name: user?.name, mobile: self, email: user?.email }), ...arr.slice(1)]);
  };

  const fc = (k) => 'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors[k] ? ' err' : '');
  const labelIdentityReminder = (field) => {
    const role = tr(`services.ra.identityReminder.${field.role}`, { n: field.index + 1 });
    return `${role} ${tr(`services.ra.identityReminder.${field.field}`)}`;
  };
  const missingIdentityFields = missingIdentityReminderFields(restoredIdentityFields, captureFormState());
  const identityReminders = {
    owner: missingIdentityFields.filter((field) => field.step === 'owner').map(labelIdentityReminder),
    tenant: missingIdentityFields.filter((field) => field.step === 'tenant').map(labelIdentityReminder),
    witness: missingIdentityFields.filter((field) => field.step === 'witness').map(labelIdentityReminder),
    review: missingIdentityFields.map(labelIdentityReminder),
  };

  return {
    rootRef, formRef, tr, isIn, user, navigate,
    step, errors, done, openFaq, setOpenFaq,
    mode, inviteError, inviteResult, copied,
    withdrawInvite, withdrawing,
    prop, setP, setProp, selectedPropertyId, setSelectedPropertyId, myProperties, pickListing,
    owner, setO, coOwners, setCoOwner, addCoOwner, removeCoOwner, ownerDocs, setOwnerDocs, vaultEnabled, saveOwnerDocToVault,
    ownerMode, chooseOwnerMode, inviteRole,
    tenantMode, setTenantMode, tenants, setTenant, addTenant, removeTenant, tenantDocs, setTenantDocs, invite, setInvite,
    terms, setT, startBounds, maint, setMaint, regArea, furnItems, custom, setCustom, clauses, setClauses,
    isChecked, toggleFurn, bumpQty, removeFurn, addCustom, furnitureText,
    wit, setWit,
    declare, setDeclare, generate, submitting, pendingRequestId, paymentPending, paymentConfirming,
    clearErr, fc, cost, locked, gated, startNewAgreement, restored, startFresh, myInvites,
    identityReminders,
    stalledInvite, recoverInvite, recovering, payable, payFiled, paying, continuable, continueFiled,
    detailsSize, detailsMax: DETAILS_MAX_CHARS, detailsTooLong, detailsWorstField,
    copyInviteLink, next, prev,
  };
}

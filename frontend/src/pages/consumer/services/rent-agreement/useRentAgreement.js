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
import { OWNER_DOCS, TENANT_DOCS, OWNER_VAULT_CAT, LAST_PUBLIC_STEP } from './constants.js';
import { fmt, digits, num, emptyTenant, emptyProp, emptyOwner, emptyInvite, emptyTerms, emptyWit, DETAILS_MAX_CHARS, detailsChars, largestFreeTextField, redactIdentityNumbers, hasIdentityNumbers, identityParties } from './helpers.js';
import { useRaFurniture } from './useRaFurniture.js';
import { getDealFees } from '../../../../services/feesService.js';
import { myListings } from '../../../../services/propertyService.js';
import {
  addServiceRequestDoc,
  createCoFillServiceRequest,
  decideServiceRequestInvite,
  createServiceRequest as createServiceRequestLive,
  getServiceRequest,
  listMyServiceRequestInvites,
  listServiceRequests,
  recordServiceRequestIdentities,
  submitServiceRequestPartyDetails,
  withdrawServiceRequestParty,
} from '../../../../services/serviceRequestService.js';
import { openCashfreeCheckout } from '../../../../lib/cashfree.js';

/* Cashfree confirms payment over a server-to-server webhook, so the browser-visible status lags.
   Tight at the front, widening after — past ~10s the honest answer is "we don't know yet". */
const PAYMENT_POLL_BACKOFF_MS = [500, 1000, 2000, 3000, 3000];

// Where the wizard autosaves. Named because two things have to agree on it: the autosave itself and
// the purge that cleans entries written before the identity numbers were kept out of it.
const DRAFT_KEY = 'dzDraft:rentAgreement';

export function useRentAgreement() {
  const rootRef = useScrollReveal();
  const { t: tr } = useTranslation();
  const { user, isIn, loading } = useAuth();
  const { toast } = useToast();
  const formRef = useRef(null);
  // Re-armed in the effect body, not just cleared in the cleanup: StrictMode mounts, cleans up and
  // re-mounts, so a cleanup-only ref would stay `false` for the rest of the page's life.
  const mountedRef = useRef(true);
  // Handles for the sleep between payment re-reads, here so unmount can end that sleep at once —
  // the poll's own mount checks do not run until the timer fires.
  const pollTimerRef = useRef(null);
  const pollWakeRef = useRef(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      // Resolved rather than abandoned: an awaited promise that never settles pins the whole
      // `generate` closure — form state and uploaded document data URLs — in memory.
      const wake = pollWakeRef.current;
      pollWakeRef.current = null;
      if (wake) wake();
    };
  }, []);

  // Sleep between payment re-reads, cut short by unmount. Callers must re-check `mountedRef` on the
  // far side of the await: waking early here means "stop", not "the wait is over".
  const sleepBeforeRetry = (ms) => new Promise((resolve) => {
    pollWakeRef.current = resolve;
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      pollWakeRef.current = null;
      resolve();
    }, ms);
  });
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sendToSignIn = useSignInGate();

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  // Submission is a round-trip plus a lazily-imported SDK, so the button stays clickable for a
  // visible beat. Without this guard a second click issues a second payment session.
  const [submitting, setSubmitting] = useState(false);
  // Set only once the poll has spent its entire budget with the request still at `awaiting_payment`
  // — i.e. we genuinely could not confirm it, not merely that we had not confirmed it yet.
  const [paymentPending, setPaymentPending] = useState(false);
  // Separate from `paymentPending`: this one is "we're checking", that one is "we couldn't confirm
  // it". Collapsing them puts the failure wording on screen during the successful case.
  const [paymentConfirming, setPaymentConfirming] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);
  // After submission the owner's create-wizard is locked (the submitted request is the legal source
  // of truth); `startNew` bypasses that lock for a separate agreement on a different property.
  const [startNew, setStartNew] = useState(false);

  // Invite mode
  const [mode, setMode] = useState('owner'); // 'owner' | 'invite'
  const [inviteCtx, setInviteCtx] = useState(null);
  const [inviteError, setInviteError] = useState(null); // null | { kind: 'expired'|'wrongNumber'|'done', toMobile }
  const [showPropertyPicker, setShowPropertyPicker] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState(null);
  /* The owner's own listings, for the "pick one of your properties" shortcut and the `?listing=`
     prefill. Loaded here rather than in `StepProperty` because the URL prefill needs the same rows. */
  const [myProperties, setMyProperties] = useState([]);
  useEffect(() => {
    if (!isIn) { setMyProperties([]); return undefined; }
    let alive = true;
    myListings(user)
      .then((rows) => { if (alive) setMyProperties(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setMyProperties([]); });
    return () => { alive = false; };
  }, [isIn, user]);
  const [inviteResult, setInviteResult] = useState(null); // { waLink, link, toName, toMobile }
  const [copied, setCopied] = useState(false);

  // Step 1 — Property & Agreement
  const [aType, setAType] = useState('Residential');
  const [prop, setProp] = useState(emptyProp());

  // Step 2 — Owner
  const [owner, setOwner] = useState(emptyOwner(isIn, user));
  const [ownerDocs, setOwnerDocs] = useState({});

  // Step 3 — Tenant
  const [tenantMode, setTenantMode] = useState('fill');
  const [tenants, setTenants] = useState([emptyTenant()]);
  const [tenantDocs, setTenantDocs] = useState({});
  const [invite, setInvite] = useState(emptyInvite());

  // Step 4 — Terms
  const [terms, setTerms] = useState(emptyTerms());
  const [maint, setMaint] = useState('Tenant');
  const [regArea, setRegArea] = useState('urban');
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
  const clearErr = (k) => setErrors((e) => (e[k] ? { ...e, [k]: false } : e));

  // ── Form state capture for autosave & co-fill ──
  const captureFormState = () => ({
    step,
    aType, prop, owner, terms, maint, regArea, furnItems, clauses, wit, declare,
    tenants, tenantMode, invite, selectedPropertyId,
  });
  /* The same capture minus the statutory identity numbers, for anything that outlives this tab (the
     co-fill payload and the autosave) — see `docs/flows/consumer/rent-agreement.md` § 5.9. */
  const captureShareableState = () => {
    const { selectedPropertyId: _selectedPropertyId, ...state } = captureFormState();
    return redactIdentityNumbers(state);
  };

  const applyFormState = (s) => {
    if (!s || typeof s !== 'object') return;
    if (typeof s.step === 'number') setStep(s.step);
    if (s.aType) setAType(s.aType);
    if (s.prop) setProp(s.prop);
    if (s.selectedPropertyId) setSelectedPropertyId(s.selectedPropertyId);
    if (s.owner) setOwner(s.owner);
    if (s.terms) setTerms(s.terms);
    if (s.maint) setMaint(s.maint);
    if (s.regArea) setRegArea(s.regArea);
    if (s.furnItems) setFurnItems(s.furnItems);
    if (s.clauses != null) setClauses(s.clauses);
    if (s.wit) setWit(s.wit);
    if (s.declare != null) setDeclare(s.declare);
    if (s.tenants) setTenants(s.tenants);
    if (s.tenantMode) setTenantMode(s.tenantMode);
    if (s.invite) setInvite(s.invite);
  };

  // Once submitted, details are locked (the request is the legal drafting basis). Read from the
  // server: a browser-store read would let the owner pay for the same agreement twice after a reload.
  const [activeRequests, setActiveRequests] = useState([]);
  useEffect(() => {
    if (!isIn || !user?.mobile) { setActiveRequests([]); return undefined; }
    let alive = true;
    listServiceRequests('rental')
      .then((rs) => { if (alive) setActiveRequests((rs || []).filter((r) => isActive(r.status))); })
      .catch(() => { if (alive) setActiveRequests([]); });
    return () => { alive = false; };
  }, [isIn, user, done]);
  const locked = mode === 'owner' && !done && !startNew && activeRequests.length > 0;

  // Begin a fresh agreement for a different property: clear the saved draft and reset every field.
  const startNewAgreement = () => {
    clearDraft();
    setStep(0);
    setErrors({});
    setAType('Residential');
    setProp(emptyProp());
    setSelectedPropertyId(null);
    setOwner(emptyOwner(isIn, user));
    setOwnerDocs({});
    setTenantMode('fill');
    setTenants([emptyTenant()]);
    setTenantDocs({});
    setInvite(emptyInvite());
    setTerms(emptyTerms());
    setMaint('Tenant');
    setRegArea('urban');
    setFurnItems([]);
    setCustom({ name: '', qty: 1 });
    setClauses('');
    setWit(emptyWit());
    setDeclare(false);
    setInviteResult(null);
    setCopied(false);
    setShowPropertyPicker(false);
    setOpenFaq(-1);
    // These belong to the attempt being abandoned. Left set, the "could not confirm your payment"
    // panel reappears over a fresh agreement that has not been submitted, let alone paid for.
    setPaymentPending(false);
    setPaymentConfirming(false);
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
      localStorage.setItem(DRAFT_KEY, JSON.stringify(redactIdentityNumbers(saved)));
    } catch { /* unreadable draft or quota — useFormDraft discards what it cannot parse anyway */ }
  }, []);

  // `useFormDraft` restores via a functional updater — resolve it against live state before
  // dispatching, otherwise the whole draft is dropped. Saved from the *shareable* capture (§ 5.9).
  const form = captureShareableState();
  const { restored, clear: clearDraft, flush: flushDraft, startFresh } = useFormDraft(DRAFT_KEY, form, (upd) => applyFormState(typeof upd === 'function' ? upd(captureFormState()) : upd), { enabled: mode === 'owner' && !done, ignore: ['oName', 'oMobile', 'step'] });

    /* `gated` represents resolved signed-out owner mode, distinct from pending authentication.
      Shared consumers use it to keep owner sign-in gating consistent. */
  const gated = mode === 'owner' && !loading && !isIn;

    /* Flush the debounced owner draft before navigation so recent input survives sign-in. */
  const gateToSignIn = () => {
    flushDraft();
    sendToSignIn('services');
  };

    /* Signed-out owners remain on public steps even when restored drafts name a later step.
      Layout timing prevents identity fields from painting before the clamp. */
  useLayoutEffect(() => {
    if (!gated) return;
    if (step > LAST_PUBLIC_STEP) setStep(LAST_PUBLIC_STEP);
  }, [gated, step]);

  // ── Owner KYC autofill ──
  // Deliberately carries no PAN or Aadhaar — see `persistOwnerKYC` — so the owner retypes those.
  useEffect(() => {
    if (mode !== 'owner' || !isIn) return;
    const key = 'draazyOwnerKYC:' + digits(user?.mobile || '');
    const kycStr = localStorage.getItem(key);
    let kyc = null;
    try { kyc = kycStr ? JSON.parse(kycStr) : null; } catch { kyc = null; }
    if (kyc) {
      // Purge on read: rewriting the entry here is the only moment the app is guaranteed to touch
      // this key, so a write-only fix would leave every existing browser exposed.
      if ('pan' in kyc || 'aadhaar' in kyc) {
        const clean = { ...kyc };
        delete clean.pan;
        delete clean.aadhaar;
        kyc = clean;
        try { localStorage.setItem(key, JSON.stringify(clean)); } catch { /* quota — the prefill below still ignores both */ }
      }
      setOwner((o) => ({ ...o, oName: o.oName || kyc.name || '', oAge: o.oAge || kyc.age || '', oGender: o.oGender || kyc.gender || 'Male', oMobile: o.oMobile || kyc.mobile || '', oEmail: o.oEmail || kyc.email || '', oAddr: o.oAddr || kyc.addr || '' }));
    } else {
      setOwner((o) => ({ ...o, oName: o.oName || user?.name || '', oMobile: o.oMobile || user?.mobile || '' }));
    }
    // eslint-disable-next-line
  }, [mode, isIn]);

  /* `pan` and `aadhaar` are deliberately excluded and must stay excluded: this key is plain JSON on
     `localStorage`, never expired, and Aadhaar is not ours to retain (Aadhaar Act s.29). */
  const persistOwnerKYC = () => {
    if (mode !== 'owner' || !isIn) return;
    try {
      const mob = digits(owner.oMobile || user?.mobile || '');
      if (!mob) return;
      localStorage.setItem('draazyOwnerKYC:' + mob, JSON.stringify({ name: owner.oName, age: owner.oAge, gender: owner.oGender, email: owner.oEmail, addr: owner.oAddr, mobile: owner.oMobile, at: Date.now() }));
    } catch { /* ignore */ }
  };

  /* Prefills document slots the owner already keeps in the vault. Metadata-bound: a live vault row
     carries a signed `url` rather than bytes, so nothing is prefilled live and they upload once. */
  const vaultEnabled = mode === 'owner' && isIn && !!user?.mobile;
  useEffect(() => {
    if (!vaultEnabled) return;
    let cancelled = false;
    (async () => {
      // A vault read must never cost the owner the wizard: an unreachable or empty vault means
      // "no prefill", not a broken step.
      const personal = await listDocuments(user.mobile, 'personal').catch(() => []);
      if (cancelled || !personal.length) return;
      setOwnerDocs((cur) => {
        const next = { ...cur };
        OWNER_DOCS.forEach(([, k]) => {
          if (next[k]) return; // owner already picked something for this slot
          const hit = personal.find((d) => d.category === OWNER_VAULT_CAT[k] && d.dataUrl);
          if (hit) next[k] = { fileName: hit.name, dataUrl: hit.dataUrl, mime: hit.mime, fromVault: true };
        });
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [vaultEnabled]);

  /* Saves a freshly uploaded owner doc back to the vault for reuse, skipping vault-sourced picks,
     over-size files and duplicates. Fire-and-forget: a failed copy must not block the agreement. */
  const saveOwnerDocToVault = async (k, d, file) => {
    if (!vaultEnabled || !d || !d.dataUrl || d.tooLarge || d.fromVault || !file) return;
    const cat = OWNER_VAULT_CAT[k];
    if (!cat) return;
    try {
      const existing = await listDocuments(user.mobile, 'personal');
      if (existing.some((x) => x.category === cat && x.name === d.fileName)) return;
      await uploadDocument(user.mobile, 'personal', { category: cat, file });
    } catch { /* the wizard is unaffected — see above */ }
  };

  /* ── Cost estimate ── Charges come from the server's published `platform_fees('rent')` row, never
     derived here, so the figure on screen and the figure charged come from the same place. */
  const [feeRow, setFeeRow] = useState(null);
  const [feeStatus, setFeeStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
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
      return { ...answers, stamp: null, reg: null, service: null, gst: null, total: null, computed: [], notes: null };
    }
    const years = Math.ceil(months / 12);
    const taxable = rent * months + nr + 0.1 * dep * years;
    /* `stampDuty`/`registration` arrive `null` because neither is a flat figure; anything derived
       here lands in `computed`, so the sidebar labels it an estimate. */
    const computed = [];
    let stamp = feeRow.stampDuty;
    if (stamp == null) { stamp = Math.round(0.0025 * taxable); computed.push('stamp'); }
    let reg = feeRow.registration;
    if (reg == null) { reg = regArea === 'rural' ? 500 : 1000; computed.push('reg'); }
    const service = feeRow.platformFee;
    const gst = feeRow.gst;
    return {
      ...answers,
      stamp, reg, service, gst,
      total: service + stamp + reg + gst,
      computed,
      notes: feeRow.notes || null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms.rent, terms.deposit, terms.nrDeposit, terms.months, regArea, feeStatus, feeRow]);

  // Built outside `generate` so the size guard below measures the object that will be posted.
  const propertyLine = () =>[prop.flatNo, prop.society, prop.locality, prop.city].filter(Boolean).join(', ');
  const tenantNames = () => (tenantMode === 'invite'
    ? 'Invited: ' + (invite.invName || '••••••' + digits(invite.invMobile).slice(-4)) + ' (pending)'
    : tenants.map((t) => t.name.trim()).filter(Boolean).join(', '));
  const buildDetails = () => ({
    property: propertyLine(), ownerName: owner.oName || user?.name || 'Owner', tenants: tenantNames(),
    rent: cost.rent, deposit: Number(terms.deposit) || 0, months: terms.months,
    startDate: terms.startDate, regArea: regArea === 'urban' ? 'Municipal / Urban' : 'Rural',
    _state: captureShareableState(),
  });

  /* The server caps serialized `details` at `DETAILS_MAX_CHARS` and answers 400. Measured on every
     render because it has to be live — a warning that only appears on submit is the same ambush. */
  const detailsSize = detailsChars(buildDetails());
  const detailsTooLong = detailsSize > DETAILS_MAX_CHARS;
  const detailsWorstField = largestFreeTextField(captureShareableState());

  // Each entry carries the real file so Ops reviews genuine uploads. In invite mode the owner side
  // yields owner docs; the tenant's are attached when they submit their section.
  const collectDocs = () => {
    const out = [];
    OWNER_DOCS.forEach(([label, k]) => {
      const f = ownerDocs[k];
      if (f && f.fileName && f.dataUrl && !f.tooLarge) out.push({ id: 'd_own_' + k, name: 'Owner — ' + label, status: 'submitted', note: '', file: { fileName: f.fileName, dataUrl: f.dataUrl, mime: f.mime } });
    });
    tenants.forEach((t, i) => {
      TENANT_DOCS.forEach((label, di) => {
        const f = tenantDocs['t' + i + '-' + di];
        if (f && f.fileName && f.dataUrl && !f.tooLarge) out.push({ id: 'd_ten' + i + '_' + di, name: (tenants.length > 1 ? 'Tenant ' + (i + 1) : 'Tenant') + ' — ' + label, status: 'submitted', note: '', file: { fileName: f.fileName, dataUrl: f.dataUrl, mime: f.mime } });
      });
    });
    return out;
  };

  // ── Tenants ──
  const addTenant = () => setTenants((arr) => [...arr, emptyTenant()]);
  const removeTenant = (i) => setTenants((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));

  /* ── Invite mode init ── An invitation is addressed to an account (`?party=…&request=…`) and is
     resolved only after sign-in — a bearer-token deep link would open for whoever held it. */
  useEffect(() => {
    const partyId = searchParams.get('party');
    const requestId = searchParams.get('request');
    if (!partyId && !requestId) return;
    // Wait for a restore to settle before deciding: a signed-in party arriving on a cold tab has no
    // cached user for a moment, and bouncing them would lose the invitation they followed.
    if (loading) return;
    if (!isIn || !user?.mobile) {
      sendToSignIn('invite');
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
        }
        /* An accepted invitation leaves the pending list, so a reload finds no row. Absence is not
           expiry: the request read below is the authority on whether this account is a party. */
        const reqId = row?.requestId || requestId;
        if (!reqId) {
          if (alive) setInviteError({ kind: 'expired' });
          return;
        }
        if (row && row.status !== 'accepted') {
          /* Two accepts can race (StrictMode, or two tabs) and the loser is refused. That refusal
             means someone already accepted; the read below decides, and 404s for a non-party. */
          try {
            await decideServiceRequestInvite(row.id, 'accept');
          } catch { /* fall through to the read, which decides */ }
        }
        const req = await getServiceRequest(reqId);
        if (!req) {
          if (alive) setInviteError({ kind: 'expired' });
          return;
        }
        if (!alive) return;
        setInviteError(null);
        setInviteCtx({
          invite: {
            inviteId: row?.id || partyId,
            reqId,
            toRole: row?.role || 'tenant',
            toName: null,
            toMobile: digits(user.mobile),
          },
          req,
        });
        setMode('invite');
        if (req.details && req.details._state) applyFormState(req.details._state);
        setTenantMode('fill');
        setStep(0);
      } catch {
        if (alive) setInviteError({ kind: 'expired' });
      }
    })();
    return () => { alive = false; };
    /* `sendToSignIn` is deliberately absent: its identity changes whenever `t` does, so listing it
       would re-run this invite lookup on every language switch. The values it closes over
       (`loading`) are already listed. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  useEffect(() => {
    if (mode === 'invite') return;
    // The flatmate reissue CTA links here as `?flat=<listing-id>`, so accept `flat` as an alias
    // for `listing` — a room's propertyId is its listing id.
    const reissue = searchParams.get('reissue') === '1';
    const listingId = searchParams.get('listing') || searchParams.get('flat');
    if (!listingId) {
      // `myProperties` holds only what this account owns, so its length IS the predicate.
      if (isIn && myProperties.length > 0) setShowPropertyPicker(true);
      return;
    }
    /* Matched against the loaded rows on both `id` and `slug`: a listing created through the API
       has a null slug until moderation names one, so the two are not interchangeable. */
    const l = myProperties.find((row) => row.id === listingId || row.slug === listingId);
    if (!l) return;
    setSelectedPropertyId(l.uuid || l.id || null);
    // Prefill from listing
    const fmap = { unfurnished: 'Unfurnished', semi: 'Semi-Furnished', furnished: 'Furnished' };
    setProp((p) => ({ ...p, society: l.loc ? String(l.loc).replace(/,?\s*Pune\s*$/i, '').trim() : p.society, furnish: fmap[l.furnishing] || 'Unfurnished' }));
    setTerms((t) => ({ ...t, rent: l.price ? String(l.price).replace(/\D/g, '') : t.rent, deposit: l.deposit ? String(l.deposit).replace(/\D/g, '') : t.deposit }));
    setShowPropertyPicker(false);
    if (reissue) toast(tr('services.ra.reissueHint'));
    // eslint-disable-next-line
  }, [searchParams, mode, myProperties]);

  /* ── Validation ── Skip the steps the current actor does not own: an invitee sees Property and
     Owner read-only, and `captureShareableState` blanks the owner's PAN/Aadhaar. */
  const stepErrors = (s) => {
    const e = {};
    if (mode === 'invite' && (s === 0 || s === 1)) return e;
    const reqStr = (k, v) => { if (!String(v || '').trim()) e[k] = true; };
    if (s === 0) {
      reqStr('flatNo', prop.flatNo); reqStr('society', prop.society); reqStr('locality', prop.locality);
      if (!/^\d{6}$/.test(prop.pincode)) e.pincode = true;
    } else if (s === 1) {
      reqStr('oName', owner.oName);
      if (!/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(owner.oPan)) e.oPan = true;
      if (!/^\d{12}$/.test(digits(owner.oAadhaar))) e.oAadhaar = true;
      if (!/^[6-9]\d{9}$/.test(digits(owner.oMobile))) e.oMobile = true;
      reqStr('oAddr', owner.oAddr);
    } else if (s === 2) {
      if (tenantMode === 'invite') {
        if (!/^[6-9]\d{9}$/.test(digits(invite.invMobile))) e.invMobile = true;
      } else {
        tenants.forEach((t, i) => {
          if (!t.name.trim()) e['t' + i + 'name'] = true;
          if (!/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(t.pan)) e['t' + i + 'pan'] = true;
          if (!/^\d{12}$/.test(digits(t.aadhaar))) e['t' + i + 'aadhaar'] = true;
          if (!/^[6-9]\d{9}$/.test(digits(t.mobile))) e['t' + i + 'mobile'] = true;
          if (!t.addr.trim()) e['t' + i + 'addr'] = true;
        });
      }
    } else if (s === 3) {
      if (!terms.startDate) e.startDate = true;
      if (!num(terms.rent)) e.rent = true;
      if (!num(terms.deposit)) e.deposit = true;
    }
    return e;
  };
  const validateStep = (s) => {
    const e = stepErrors(s);
    setErrors(e);
    if (Object.keys(e).length) { toast(tr('services.ra.validationRequired'), 'error'); return false; }
    return true;
  };
  const next = () => {
    if (!validateStep(step)) return;
     /* Validate before sign-in navigation so restored drafts return to a valid step.
       Gate at `LAST_PUBLIC_STEP` so all consumers share the boundary. */
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

  /* Takes an unanswered invitation back (V107). Its own busy flag, not `saving`: this sits on the
     panel after submit finished, so a double-click would DELETE a party row already removed. */
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

  const generate = async () => {
    // Re-entrancy backstop for the gap between the click and the re-render: a second click before
    // the create and the checkout SDK settle would price and bill a second agreement.
    if (submitting || done) return;
     /* Submission requires resolved authentication; expired sessions use `gateToSignIn()` to preserve drafts.
       Hold while authentication is unresolved to avoid unauthenticated creation or premature redirect. */
    if (loading) return;
    if (!isIn) { gateToSignIn(); return; }
    for (let s = 0; s <= 3; s++) {
      const e = stepErrors(s);
      if (Object.keys(e).length) { setStep(s); setErrors(e); toast(tr('services.ra.validationRequired'), 'error'); return; }
    }
    if (!declare) { toast(tr('services.ra.declarationRequired'), 'error'); return; }
    // Refuse before the server does, and name the field that has to shrink. "Too long" on a form
    // with sixty inputs is not something a customer can act on.
    if (detailsTooLong) {
      setStep(detailsWorstField.step);
      toast(tr('services.ra.detailsTooLong', { field: tr(detailsWorstField.label), over: detailsSize - DETAILS_MAX_CHARS }), 'error');
      scrollTop();
      return;
    }
    const inviteMobile = digits(invite.invMobile);
    const property = propertyLine();
    const details = buildDetails();
    const propertyReference = searchParams.get('listing') || searchParams.get('flat');
    const propertyId = selectedPropertyId
      || myProperties.find((row) => row.id === propertyReference || row.slug === propertyReference)?.uuid
      || undefined;
    const docs = collectDocs();
    if (mode === 'owner' && docs.length && !propertyId) {
      toast('Choose one of your listed properties before submitting documents.', 'error');
      return;
    }
    if (tenantMode === 'invite' && docs.length) {
      toast('Documents cannot yet be submitted for a co-filled agreement.', 'info');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'owner') {
        /* No admin lead ticket is raised here: an unpaid request is invisible to the ops queue by
           design — see `docs/flows/consumer/rent-agreement.md` § 5.10. */
        persistOwnerKYC();
        if (tenantMode === 'invite' && inviteMobile) {
          const request = await createCoFillServiceRequest({
            request: {
              type: 'rental',
              details,
              propertyId,
            },
            role: 'tenant',
            mobile: inviteMobile,
          });
          /* A co-fill request defers checkout, not the requester's paperwork: only they may hand
             off their own identity records, so it happens while their session owns the request. */
          try {
            const ownerIdentity = identityParties(owner, []);
            if (ownerIdentity.length) await recordServiceRequestIdentities(request?.id, ownerIdentity);
          } catch (err) {
            console.error('Rent Agreement owner identity hand-off failed', err?.status || err?.message);
            toast(tr('services.ra.identitiesFailed'), 'info');
          }
          const party = (request?.parties || []).find((p) => p?.role === 'tenant' && p?.status === 'invited')
            || (request?.parties || [])[0]
            || null;
          const invitePath = inviteRouteFor({ id: party?.id, requestId: request?.id });
          const link = new URL(invitePath, window.location.origin).toString();
          const signupLink = new URL(`/signup?next=${encodeURIComponent(invitePath)}`, window.location.origin).toString();
          const text = `Hi${invite.invName ? ' ' + invite.invName : ''}, ${details.ownerName} invited you to complete your rent-agreement details on Draazy${property ? ` for ${property}` : ''}. Please sign in (or create an account) first, then open this invite: ${link}\n\nSign up: ${signupLink}`;
          const waLink = `https://wa.me/91${inviteMobile}?text=${encodeURIComponent(text)}`;
          /* The invitee is told by the server: `CoFillParties.invite` raises `service.party-invited`
             through the `Notifier` port, the only place quiet hours and preferences are applied. */
          setInviteResult({
            toName: invite.invName || '',
            toMobile: inviteMobile,
            link,
            waLink,
            // Two different waits (V107): a `pending` party is a number nobody has signed up to, so
            // "ask them to create an account" is the advice; otherwise the account just hasn't answered.
            requestId: request?.id || null,
            partyId: party?.id || null,
            pending: !!party?.pending,
            maskedMobile: party?.mobile || null,
          });
        } else {
          /* Hoisted so the create and the upload below cannot disagree; the upload's guard must be
             this value, since `toViewModel` does not carry `propertyId` back on the response. */
          const listingId = propertyId;
          const request = await createServiceRequestLive({
            type: 'rental',
            service: 'Rent Agreement',
            customer: { name: details.ownerName },
            details,
            docs: docs.length ? docs : undefined,
            propertyId: listingId,
          });
          /* The identity numbers travel on their own narrow channel: after the create, before
             checkout, and non-fatal — see § 5.10 in the flow doc. */
          try {
            await recordServiceRequestIdentities(request?.id, identityParties(owner, tenants));
          } catch (err) {
            // Never log the payload: this is the one call whose body is a set of Aadhaar numbers.
            console.error('Rent Agreement identity hand-off failed', err?.status || err?.message);
            toast(tr('services.ra.identitiesFailed'), 'info');
          }
          /* The owner's papers, one upload call per file. Guarded on `listingId` because the server
             answers 409 for a request not linked to a property — see § 5.10 in the flow doc. */
          const ownerUploads = listingId ? docs.map((d) => d?.file).filter(Boolean) : [];
          for (const file of ownerUploads) {
            try {
              // eslint-disable-next-line no-await-in-loop
              await addServiceRequestDoc(request?.id, file);
            } catch (err) {
              console.error('Rent Agreement document upload failed', err?.status || err?.message);
              toast(tr('services.ra.docsFailed'), 'info');
            }
          }
          if (request?.paymentSessionId) {
            // The sidebar renders the server's own published breakdown, so these agree by
            // construction except when a fees read failed.
            const charged = Number(request.amount);
            if (Number.isFinite(charged) && charged > 0 && charged !== cost.total) {
              toast(tr('services.ra.cost.chargedDiffers', { amount: fmt(charged) }), 'info');
            }
            try {
              await openCashfreeCheckout(request.paymentSessionId);
            } catch (err) {
              // The SDK failed to load or open. The request exists and is still payable from the
              // tracker, so this is not the lost submission the generic save-error claims.
              console.error('Rent Agreement checkout could not open');
              if (import.meta.env.DEV) console.error(err);
            }
            // The modal closing is not proof of payment — only the webhook is, and it lands seconds
            // later, so poll and treat "still awaiting" as not-yet-known (§ 5.10 in the flow doc).
            setPaymentConfirming(true);
            let status = 'awaiting_payment';
            for (let attempt = 0; attempt <= PAYMENT_POLL_BACKOFF_MS.length; attempt++) {
              if (attempt > 0) {
                await sleepBeforeRetry(PAYMENT_POLL_BACKOFF_MS[attempt - 1]);
                if (!mountedRef.current) break;
              }
              const settled = await getServiceRequest(request.id).catch(() => null);
              // Only overwrite on a status actually received: a dropped request mid-poll would
              // otherwise erase a verdict already read.
              if (settled?.status) status = settled.status;
              if (!mountedRef.current || status !== 'awaiting_payment') break;
            }
            // Guarded because the loop breaks on unmount too, and every branch above sits behind an
            // await — an unguarded `setState` here leaks on a page left mid-poll.
            if (mountedRef.current) {
              setPaymentConfirming(false);
              setPaymentPending(status === 'awaiting_payment');
            }
          }
        }
        clearDraft();
      } else if (mode === 'invite' && inviteCtx) {
        // Invited tenant submits their part — attach their real documents to the request.
        await submitServiceRequestPartyDetails(inviteCtx.req.id, details);
        const uploads = collectDocs().map((d) => d?.file).filter(Boolean);
        for (const file of uploads) {
          // eslint-disable-next-line no-await-in-loop
          await addServiceRequestDoc(inviteCtx.req.id, file);
        }
      }
    } catch (err) {
      console.error('Rent Agreement submit failed', err);
      toast(tr('services.ra.saveError'), 'error');
      return;
    } finally {
      setSubmitting(false);
    }

    // The checkout modal can stay open long enough for the customer to navigate away; scrolling a
    // page they already left is a visible artefact rather than a harmless no-op.
    if (!mountedRef.current) return;
    setDone(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fc = (k) => 'field w-full px-4 py-3 rounded-xl text-white text-sm' + (errors[k] ? ' err' : '');

  return {
    rootRef, formRef, tr, isIn, user, navigate,
    step, errors, done, openFaq, setOpenFaq,
    mode, inviteError, inviteResult, copied,
    withdrawInvite, withdrawing,
    aType, setAType, prop, setP, setProp, setShowPropertyPicker, selectedPropertyId, setSelectedPropertyId, myProperties,
    owner, setO, ownerDocs, setOwnerDocs, vaultEnabled, saveOwnerDocToVault,
    tenantMode, setTenantMode, tenants, setTenant, addTenant, removeTenant, tenantDocs, setTenantDocs, invite, setInvite,
    terms, setT, maint, setMaint, regArea, setRegArea, furnItems, custom, setCustom, clauses, setClauses,
    isChecked, toggleFurn, bumpQty, removeFurn, addCustom, furnitureText,
    wit, setWit,
    declare, setDeclare, generate, submitting, paymentPending, paymentConfirming,
    clearErr, fc, cost, locked, gated, startNewAgreement, restored, startFresh, myInvites,
    detailsSize, detailsMax: DETAILS_MAX_CHARS, detailsTooLong, detailsWorstField,
    copyInviteLink, next, prev,
  };
}

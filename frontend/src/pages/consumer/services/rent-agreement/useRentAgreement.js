import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../../../lib/useScrollReveal.js';
import { useAuth } from '../../../../context/AuthContext.jsx';
import { useToast } from '../../../../context/ToastContext.jsx';
import { createCoFill, inviteContext, submitInviteDetails, buildInviteWaLink, inviteLink, findInviteById, pendingInvites, isActive } from '../../../../lib/serviceFlow.js';
import { getListings, getListing, pushNotificationFor } from '../../../../lib/store.js';
import { getDocsForProp, addDocument } from '../../../../lib/data/documents.js';
import { useFormDraft } from '../../../../lib/hooks.js';
import { OWNER_DOCS, TENANT_DOCS, OWNER_VAULT_CAT } from './constants.js';
import { fmt, digits, num, emptyTenant, emptyProp, emptyOwner, emptyInvite, emptyTerms, emptyWit, DETAILS_MAX_CHARS, detailsChars, largestFreeTextField, redactIdentityNumbers, hasIdentityNumbers, identityParties } from './helpers.js';
import { useRaFurniture } from './useRaFurniture.js';
import { getDealFees } from '../../../../services/feesService.js';
import {
  createServiceRequest as createServiceRequestLive,
  getServiceRequest,
  listServiceRequests,
  recordServiceRequestIdentities,
} from '../../../../services/serviceRequestService.js';
import { openCashfreeCheckout } from '../../../../lib/cashfree.js';
import { createServiceRequest } from '../../../../lib/mockApi.js';

/* Waits between the re-reads that follow checkout. Cashfree confirms payment over a server-to-server
   webhook, so the status the browser can see lags the customer's own experience of having paid by a
   second or several. Tight at the front because the webhook usually lands almost immediately and
   every extra second there is a customer staring at a spinner they earned nothing by waiting for;
   widening after that so a slow bank costs a handful of requests rather than a fixed-interval
   hammering of the API. Five retries, ~9.5s in total: past roughly ten seconds the honest answer is
   "we don't know yet", and the tracker — which re-reads whenever it is opened — is a better place to
   wait than this page. */
const PAYMENT_POLL_BACKOFF_MS = [500, 1000, 2000, 3000, 3000];

// Where the wizard autosaves. Named because two things have to agree on it: the autosave itself and
// the purge that cleans entries written before the identity numbers were kept out of it.
const DRAFT_KEY = 'pnDraft:rentAgreement';

export function useRentAgreement() {
  const rootRef = useScrollReveal();
  const { t: tr } = useTranslation();
  const { user, isIn } = useAuth();
  const { toast } = useToast();
  const formRef = useRef(null);
  // Re-armed in the effect body, not just cleared in the cleanup: StrictMode mounts, cleans up and
  // re-mounts, so a cleanup-only ref stays `false` for the rest of the page's life and would
  // silently swallow the submission's done state.
  const mountedRef = useRef(true);
  // Handles for the sleep between payment re-reads. They live here so unmount can end that sleep at
  // once: left to expire on its own, a 3s timer keeps a `getServiceRequest` scheduled against a
  // screen the customer has already left, and the poll's own mount checks do not get to run until
  // the timer fires — so "navigate away" would still cost another request and another few seconds
  // of a loop nobody can see.
  const pollTimerRef = useRef(null);
  const pollWakeRef = useRef(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      // Resolved rather than abandoned: an awaited promise that never settles pins the whole
      // `generate` closure — captured form state and uploaded document data URLs included — in
      // memory for the rest of the session.
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
  const location = useLocation();

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  // Submission is a network round-trip plus a lazily-imported Cashfree SDK, so the button stays
  // clickable for a visible beat. Without this guard a second click re-enters `generate`, prices a
  // second rent agreement and issues a second payment session — the customer can be charged twice.
  const [submitting, setSubmitting] = useState(false);
  // The checkout modal resolves when it *closes*, paid or not. Set only once the poll below has
  // spent its entire budget with the request still parked at `awaiting_payment` — i.e. we genuinely
  // could not confirm it, not merely that we had not confirmed it yet.
  const [paymentPending, setPaymentPending] = useState(false);
  // True while that poll is still running. Deliberately a separate flag: the two say opposite things
  // to the customer — this one is "we're checking", that one is "we couldn't confirm it" — and
  // collapsing them puts the failure wording on screen during the ordinary *successful* case, which
  // is the exact bug the poll exists to fix.
  const [paymentConfirming, setPaymentConfirming] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);
  // After submission the owner's create-wizard is locked (the submitted request is
  // the legal source of truth). `startNew` lets them explicitly begin a separate
  // agreement for a different property, bypassing that lock for a fresh form.
  const [startNew, setStartNew] = useState(false);

  // Invite mode
  const [mode, setMode] = useState('owner'); // 'owner' | 'invite'
  const [inviteCtx, setInviteCtx] = useState(null);
  const [inviteError, setInviteError] = useState(null); // null | { kind: 'expired'|'wrongNumber'|'done', toMobile }
  const [showPropertyPicker, setShowPropertyPicker] = useState(false);
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
    tenants, tenantMode, invite,
  });
  /*
     The same capture, minus the statutory identity numbers, for anything that outlives this tab.

     `captureFormState` is also the co-fill payload: it is posted as `details._state` so an invited
     tenant can open the owner's half-filled form. But `details` is stored as plaintext jsonb and
     echoed verbatim by `ServiceRequestMapper` on *every* read — including the paged ops queue — so
     sending the raw state handed the owner's PAN and Aadhaar, and every tenant's, to the invited
     stranger and to any staff account that listed the queue. That is a bulk identity-document dump,
     and Aadhaar in particular is not ours to spread (Aadhaar Act s.29).

     It is also what the `pnDraft:rentAgreement` autosave writes. That is the same threat model on a
     shorter path: `localStorage`, same origin, written on every keystroke and never expired. Both
     callers get the redacted shape; the raw capture is for the submission and for resolving
     `useFormDraft`'s functional updater against live state, and for nothing else.

     Redacted here rather than at the server so the numbers never cross the wire at all — the
     server-side `details` allowlist is the belt to this pair of braces. See `redactIdentityNumbers`
     for why the fields are blanked rather than deleted.
  */
  const captureShareableState = () => redactIdentityNumbers(captureFormState());

  const applyFormState = (s) => {
    if (!s || typeof s !== 'object') return;
    if (typeof s.step === 'number') setStep(s.step);
    if (s.aType) setAType(s.aType);
    if (s.prop) setProp(s.prop);
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

  // The owner has already-submitted rent-agreement request(s) in flight. Once
  // submitted, details are locked (the request is the legal drafting basis) — so we
  // hide the editable create-wizard and point them to the tracker's Messages /
  // draft-approval instead. Terminal (completed/cancelled) requests don't lock.
  //
  // Read through the seam rather than `serviceFlow.list()`: against the live API the request lives
  // on the server and never touches localStorage, so a mock-store read would report "none in
  // flight", reopen the wizard after a reload and let the owner submit — and pay for — the same
  // agreement twice. `awaiting_payment` counts as active, so an unpaid request locks too.
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

  // Begin a fresh agreement for a different property: clear the saved draft and
  // reset every field to its blank default, then reveal the wizard.
  const startNewAgreement = () => {
    clearDraft();
    setStep(0);
    setErrors({});
    setAType('Residential');
    setProp(emptyProp());
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
    // The two payment flags belong to the attempt being abandoned, not to the blank form replacing
    // it. Left set, the amber "we could not confirm your payment" panel — or the confirming
    // spinner — reappears over a fresh agreement that has not been submitted, let alone paid for,
    // and tells the customer a previous attempt's story about this one. Booleans, so unlike the
    // form slices there is no shared object to alias and no factory is needed.
    setPaymentPending(false);
    setPaymentConfirming(false);
    setStartNew(true);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Draft autosave/restore ──

  // Purge on read, not merely on write — the same rule `puneNestOwnerKYC` follows below. Every
  // owner who used this wizard before the draft stopped carrying identity numbers already has a PAN
  // and an Aadhaar sitting in their browser, and nothing else ever revisits this key: a change that
  // only stops *new* writes leaves all of them exposed for good.
  //
  // Runs unconditionally, including in invite mode where the autosave itself is disabled — cleaning
  // the entry is worth doing whether or not this visit would have written one.
  //
  // **Must stay above the `useFormDraft` call below.** Effects fire in the order their hooks were
  // called during render, so declaring this one first is what guarantees the entry is rewritten
  // before the restore reads it back into the form. Reordering the two would put the numbers back on
  // screen for one keystroke's worth of time before the next save overwrote them.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!hasIdentityNumbers(saved)) return;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(redactIdentityNumbers(saved)));
    } catch { /* unreadable draft or quota — useFormDraft discards what it cannot parse anyway */ }
  }, []);

  // useFormDraft restores via a functional updater — resolve it against the live
  // state before dispatching to applyFormState, otherwise the whole draft is dropped.
  //
  // Saved from the *shareable* capture: this goes to disk, so PAN and Aadhaar must not be in it. The
  // price is that a mid-form refresh brings back every answer except those two, which the owner
  // retypes — the restored-draft banner says so rather than claiming everything came back.
  const form = captureShareableState();
  const { restored, clear: clearDraft, startFresh } = useFormDraft(DRAFT_KEY, form, (upd) => applyFormState(typeof upd === 'function' ? upd(captureFormState()) : upd), { enabled: mode === 'owner' && !done, ignore: ['oName', 'oMobile', 'step'] });

  // ── Owner KYC autofill ──
  // Prefills the owner step from the last agreement this browser submitted. It deliberately does
  // *not* carry PAN or Aadhaar — see `persistOwnerKYC` — so the owner retypes those two each time.
  useEffect(() => {
    if (mode !== 'owner' || !isIn) return;
    const key = 'puneNestOwnerKYC:' + digits(user?.mobile || '');
    const kycStr = localStorage.getItem(key);
    let kyc = null;
    try { kyc = kycStr ? JSON.parse(kycStr) : null; } catch { kyc = null; }
    if (kyc) {
      // Purge on read, not merely on write. Every owner who used this wizard before the fix already
      // has a PAN and an Aadhaar sitting in their browser; a change that only stops *new* writes
      // leaves all of them exposed, and nothing else ever revisits this key. Rewriting the entry
      // here is the only moment the app is guaranteed to touch it.
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

  /*
     Persist the owner's details for next time — everything except the two numbers that matter.

     `pan` and `aadhaar` are deliberately excluded and must stay excluded. This key is plain JSON on
     `localStorage`, keyed by mobile number and never expired: any XSS anywhere on this origin reads
     it, and so does the next person to use a shared, borrowed or resold device. A PAN plus an
     Aadhaar plus a name and a permanent address is a complete identity set, and Aadhaar in
     particular is not ours to retain at all (Aadhaar Act s.29).

     Yes, this means the owner retypes twelve digits and ten characters on their second agreement.
     That is the cost, it was weighed, and it is the smaller one. If prefilling them is ever wanted
     back, it belongs behind the access-controlled vault (`/me/owner-kyc`), not in the browser — do
     not "fix" the missing prefill by putting them back here.
  */
  const persistOwnerKYC = () => {
    if (mode !== 'owner' || !isIn) return;
    try {
      const mob = digits(owner.oMobile || user?.mobile || '');
      if (!mob) return;
      localStorage.setItem('puneNestOwnerKYC:' + mob, JSON.stringify({ name: owner.oName, age: owner.oAge, gender: owner.oGender, email: owner.oEmail, addr: owner.oAddr, mobile: owner.oMobile, at: Date.now() }));
    } catch { /* ignore */ }
  };

  // ── Reuse mandatory docs from the dashboard Document vault ──
  // PAN, Aadhaar, Passport photo and Ownership proof are personal documents. If the owner
  // already keeps them under Dashboard → Documents → Personal, prefill those slots (marked
  // fromVault) so they never upload the same paper twice. Uses the exact vault key the
  // dashboard writes to (user.mobile, 'personal') so the two stores stay in sync.
  const vaultEnabled = mode === 'owner' && isIn && !!user?.mobile;
  useEffect(() => {
    if (!vaultEnabled) return;
    const personal = getDocsForProp(user.mobile, 'personal');
    if (!personal.length) return;
    setOwnerDocs((cur) => {
      const next = { ...cur };
      OWNER_DOCS.forEach(([, k]) => {
        if (next[k]) return; // owner already picked something for this slot
        const hit = personal.find((d) => d.category === OWNER_VAULT_CAT[k] && d.dataUrl);
        if (hit) next[k] = { fileName: hit.name, dataUrl: hit.dataUrl, mime: hit.mime, fromVault: true };
      });
      return next;
    });
    // eslint-disable-next-line
  }, [vaultEnabled]);

  // Save a freshly uploaded owner doc back to the dashboard Document vault, so it is kept
  // for reuse. Skips vault-sourced picks, over-size files, and duplicates (same category+name).
  const saveOwnerDocToVault = (k, d) => {
    if (!vaultEnabled || !d || !d.dataUrl || d.tooLarge || d.fromVault) return;
    const cat = OWNER_VAULT_CAT[k];
    if (!cat) return;
    const existing = getDocsForProp(user.mobile, 'personal');
    if (existing.some((x) => x.category === cat && x.name === d.fileName)) return;
    addDocument(user.mobile, 'personal', { category: cat, name: d.fileName, size: d.size || 0, mime: d.mime, dataUrl: d.dataUrl });
  };

  // ── Cost estimate ──
  /*
     The charges are read from the server, not derived here (D9, D150).

     This sidebar used to price the agreement itself: stamp duty from the Art. 36A formula,
     registration from a ₹500/₹1000 rule, service fee from the mock back-office panel. The server
     bills from its published `platform_fees('rent')` row — `platformFee + stampDuty + registration
     + gst` — so the figure on screen and the figure charged were computed by different code from
     different data and agreed only by coincidence. They now come from the same place, and the total
     below is summed in the same order the server sums it.

     `fees` is a public read, so this runs for a signed-out visitor filling the wizard too. It is
     fetched once on mount: the published schedule does not depend on anything the form collects.
  */
  const [feeRow, setFeeRow] = useState(null);
  const [feeStatus, setFeeStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [feeAttempt, setFeeAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setFeeStatus('loading');
    getDealFees('rent')
      .then((f) => {
        if (!alive) return;
        // No published row is not an empty row. Falling through to `ready` with `null` would render
        // a confident ₹0 for a price nobody published, which is the exact failure this read exists
        // to remove — so an unpublished schedule takes the same neutral, price-less state a failed
        // request does.
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
    /*
       `stampDuty` and `registration` arrive as `null` from the **live** provider too, and this
       block is the path that then runs. V52 dropped NOT NULL from both columns for the `rent` row
       precisely because neither is a flat figure: Art. 36A duty is 0.25% of a consideration built
       from the rent, the term and the deposit, and registration is Rs 1000 municipal / Rs 500 rural.
       One column cannot say either, so it says nothing and the arithmetic happens per agreement.

       (This comment used to assert the opposite — "the columns are NOT NULL and always send a
       figure" — which had been false since V52 and made this branch look like mock-only scaffolding
       that a future edit could safely delete. Deleting it would have quoted every customer zero.)

       Every figure produced here is recorded in `computed` so the sidebar labels it an estimate
       rather than passing it off as the price. Nothing in this block derives the platform fee any
       more; that number is the server's alone.
    */
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

  // ── The `details` payload, and the size it has to fit in (D157) ──
  // Built here rather than inside `generate` so the guard below can measure the *same* object that
  // will actually be posted. A guard that measures an approximation of the payload is a guard that
  // passes on the submission that fails.
  const propertyLine = () => [prop.flatNo, prop.society, prop.locality, prop.city].filter(Boolean).join(', ');
  const tenantNames = () => (tenantMode === 'invite'
    ? 'Invited: ' + (invite.invName || '••••••' + digits(invite.invMobile).slice(-4)) + ' (pending)'
    : tenants.map((t) => t.name.trim()).filter(Boolean).join(', '));
  const buildDetails = () => ({
    property: propertyLine(), ownerName: owner.oName || user?.name || 'Owner', tenants: tenantNames(),
    rent: cost.rent, deposit: Number(terms.deposit) || 0, months: terms.months,
    startDate: terms.startDate, regArea: regArea === 'urban' ? 'Municipal / Urban' : 'Rural',
    _state: captureShareableState(),
  });

  /*
     The server caps the serialized `details` at `DETAILS_MAX_CHARS` and answers 400 when it is
     exceeded. Without this the customer meets that limit at the end of a six-step form, as a save
     failure naming nothing — and the form's one genuinely unbounded field (special clauses) is
     invisible in the message. Measured on every render because it has to be *live*: a warning that
     only appears on submit is the same ambush a beat earlier.
  */
  const detailsSize = detailsChars(buildDetails());
  const detailsTooLong = detailsSize > DETAILS_MAX_CHARS;
  const detailsWorstField = largestFreeTextField(captureShareableState());

  // ── Collect the customer's actual uploaded documents into request docs ──
  // Each entry carries the real file (name + dataUrl) so Ops reviews genuine uploads,
  // not placeholders. In invite mode the owner side yields owner docs; the invited
  // tenant's docs are attached when they submit their section.
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

  // ── Invite mode init ──
  // The invite id in the deep link is a bearer token. Resolve it up-front (before
  // sign-in) so we can (a) bounce a signed-out invitee to a prefilled sign-in and
  // (b) confirm the signed-in number matches the one the owner invited.
  useEffect(() => {
    const inviteId = searchParams.get('invite');
    if (!inviteId) return;
    const rec = findInviteById(inviteId);
    // Signed-out invitee → sign in with the invited number, then return here.
    if (!isIn || !user?.mobile) {
      const next = location.pathname + location.search;
      const qs = new URLSearchParams({ reason: 'invite', next });
      if (rec?.toMobile) qs.set('mobile', rec.toMobile);
      navigate('/signin?' + qs.toString());
      return;
    }
    if (!rec) { setInviteError({ kind: 'expired' }); return; }
    if (digits(user.mobile) !== digits(rec.toMobile)) { setInviteError({ kind: 'wrongNumber', toMobile: rec.toMobile }); return; }
    if (rec.status !== 'pending') { setInviteError({ kind: rec.status === 'filled' ? 'done' : 'expired' }); return; }
    const ctx = inviteContext(digits(user.mobile), inviteId);
    if (!ctx || !ctx.invite || !ctx.req) { setInviteError({ kind: 'expired' }); return; }
    setInviteError(null);
    setInviteCtx(ctx);
    setMode('invite');
    if (ctx.req.details && ctx.req.details._state) applyFormState(ctx.req.details._state);
    setTenantMode('fill'); // invited tenant fills their part
    setStep(0); // start at the top, not wherever the owner left off
    // eslint-disable-next-line
  }, [searchParams, isIn, user]);

  // ── Pending co-fill invites for the signed-in user (banner outside the invite flow) ──
  const [myInvites, setMyInvites] = useState([]);
  useEffect(() => {
    if (mode === 'invite' || !isIn || !user?.mobile) { setMyInvites([]); return; }
    if (searchParams.get('invite')) return;
    setMyInvites(pendingInvites(digits(user.mobile)));
  }, [mode, isIn, user, searchParams]);

  // ── Property auto-fill from ?listing=<id> (or ?flat=<id> from a flatmate reissue) ──
  useEffect(() => {
    if (mode === 'invite') return;
    // The flatmate board's "reissue the joint agreement" CTA links here as
    // ?flat=<listing-id>&reissue=1 (a room's propertyId is its listing id), so
    // accept `flat` as an alias for `listing` — otherwise that CTA opened a blank
    // wizard because only `listing` was ever read.
    const reissue = searchParams.get('reissue') === '1';
    const listingId = searchParams.get('listing') || searchParams.get('flat');
    if (!listingId) {
      // Show property picker if owner has listings
      if (isIn && user?.role === 'owner') {
        const listings = getListings();
        if (listings && listings.length > 0) setShowPropertyPicker(true);
      }
      return;
    }
    const l = getListing(listingId);
    if (!l) return;
    // Prefill from listing
    const fmap = { unfurnished: 'Unfurnished', semi: 'Semi-Furnished', furnished: 'Furnished' };
    setProp((p) => ({ ...p, society: l.loc ? String(l.loc).replace(/,?\s*Pune\s*$/i, '').trim() : p.society, furnish: fmap[l.furnishing] || 'Unfurnished' }));
    setTerms((t) => ({ ...t, rent: l.price ? String(l.price).replace(/\D/g, '') : t.rent, deposit: l.deposit ? String(l.deposit).replace(/\D/g, '') : t.deposit }));
    setShowPropertyPicker(false);
    if (reissue) toast(tr('services.ra.reissueHint'));
    // eslint-disable-next-line
  }, [searchParams, mode]);

  // ── File uploads ──
  // Owner/tenant documents are captured (file name) directly inside their step components
  // via setOwnerDocs / setTenantDocs.

  // ── Validation ──
  // An invited tenant sees the Property and Owner steps read-only ("Set up by the owner"), so
  // validating them would gate them behind fields they physically cannot type into. That was
  // survivable while the owner's whole state round-tripped verbatim; now that `captureShareableState`
  // blanks the owner's PAN and Aadhaar before they leave the owner's browser, the Owner step is
  // *always* invalid for the invitee and the wizard would dead-end on step 1. Skip the steps the
  // current actor does not own — the owner already passed them before the request existed.
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
    // Warn on the way through, not only at the end. The size limit is on the whole form, so it can
    // be crossed on any step; saying so at each transition — naming the field that has to shrink —
    // means the customer learns about it beside the offending control rather than six steps later.
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

  const generate = async () => {
    // Re-entrancy guard. `generate` is an onClick handler that now awaits a create round-trip and a
    // lazily-imported checkout SDK; a second click before either settles would price and bill a
    // second rent agreement. The button is disabled too — this is the backstop for the gap between
    // the click and the re-render.
    if (submitting || done) return;
    // Wizard is fillable publicly; generating the agreement requires sign-in (draft is restored on return).
    if (!isIn) { navigate(`/signin?reason=service&next=${encodeURIComponent(location.pathname + location.search)}`); return; }
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
    const tNames = tenantNames();
    const property = propertyLine();
    const ownerMobile = digits(owner.oMobile) || user?.mobile || '';
    const details = buildDetails();

    setSubmitting(true);
    try {
      if (mode === 'owner') {
        // Link the admin service-ticket to the ops workflow request so its status stays
        // truthful (no phantom "new" after the agreement moves to draft/registration/done).
        // Raised only *after* the request it references exists, so a failed create cannot leave
        // admin holding a ticket that points at nothing.
        const ticketRef = 'TR' + Date.now() + Math.floor(Math.random() * 1000);
        const raiseAdminTicket = () => createServiceRequest({
          team: 'rental', service: 'Rent Agreement', customer: owner.oName || user?.name || 'Customer', mobile: ownerMobile,
          detail: `${aType} · ${property} · ${tNames || '—'} · ${fmt(cost.rent)}/mo · ${terms.months}m`, value: cost.total ?? 0, ref: ticketRef,
        });
        persistOwnerKYC();
        const docs = collectDocs();
        if (tenantMode === 'invite' && inviteMobile) {
          // Co-fill stays on `serviceFlow` and is not charged here: the server scopes every request
          // to its requester, so there is no endpoint that can represent a two-party draft, and
          // `createCoFill` below already creates the request record. Calling the live create as well
          // would bill the owner for a request that exists twice. The owner pays when the completed
          // agreement is submitted, not when the tenant is invited to fill their half.
          const { invite: inv } = createCoFill(ownerMobile, {
            type: 'rental', service: 'Rent Agreement', customer: { name: details.ownerName }, details,
            docs, ticketRef,
            initiatorRole: 'owner', initiatorName: details.ownerName,
            parties: [{ role: 'owner', mobile: ownerMobile, name: details.ownerName }, { role: 'tenant', mobile: inviteMobile, name: invite.invName }],
            invite: { toMobile: inviteMobile, toName: invite.invName, toRole: 'tenant', sections: ['tenant'], fromName: details.ownerName, fromRole: 'owner', property, message: invite.invMessage },
          });
          raiseAdminTicket();
          if (inv) {
            setInviteResult({
              toName: invite.invName || '',
              toMobile: inviteMobile,
              link: inviteLink(inv.inviteId),
              waLink: buildInviteWaLink({ toMobile: invite.invMobile, toName: invite.invName, toRole: 'tenant', fromName: details.ownerName, property, message: invite.invMessage, inviteId: inv.inviteId }),
            });
            // In-app nudge for the tenant if they already have a PuneNest account.
            // Route to "My Rental" first (their hub), where the pending request is
            // surfaced and they can open it to fill their details.
            pushNotificationFor(inviteMobile, {
              id: 'ra_invite_' + inv.inviteId,
              type: 'service',
              title: 'Complete your Rent Agreement details',
              desc: `${details.ownerName} invited you to add your tenant details & documents${property ? ' for ' + property : ''}. Open it from My Rental to complete your part.`,
              link: '/dashboard#rental',
            });
          }
        } else {
          // The paid desk. The server prices `rent-agreement` (platform fee + stamp duty +
          // registration + GST) and parks the request at `awaiting-payment`, invisible to the ops
          // queue, handing back a single-use `paymentSessionId`. `propertyId` binds it to the
          // listing when the wizard was opened for one — a request without it cannot carry
          // documents later. Free desks return no session and go straight into the queue.
          const request = await createServiceRequestLive({
            type: 'rental',
            service: 'Rent Agreement',
            customer: { name: details.ownerName },
            details,
            docs: docs.length ? docs : undefined,
            propertyId: searchParams.get('listing') || searchParams.get('flat') || undefined,
            ticketRef,
          });
          raiseAdminTicket();
          /*
             ── The identity numbers, on their own narrow channel (D151) ──

             `details` above carries none: the wizard redacts them out of `_state` and the server
             refuses them at any nesting depth, because `details` is plaintext `jsonb` echoed
             verbatim to every staff read — carrying them there made the ops queue's first page a
             bulk identity dump. But a Leave & License names each party by PAN and Aadhaar, so the
             desk still needs them, and until this call nothing carried them at all.

             `PUT /service-requests/{id}/identities` is that channel and it is narrow on purpose: the
             server answers 204 (nothing to echo), stores the rows outside `details`, refuses every
             reader except the operator the request is assigned to — an admin included, until they
             take it — writes an audit row for each read *and* each refusal, and blanks the numbers
             the moment the request completes or is cancelled. Nothing is written to `localStorage`
             on the way; `identityParties` reads live component state and the result is not held.

             Separate from the create, and after it: the id has to exist first, and a create body
             that carried an Aadhaar would put one on the response the tracker renders and logs.

             Before the checkout modal opens, because that modal can outlive this page — the
             customer can close the tab on it — and a request that reaches the desk without the
             numbers is one the desk has to chase the customer for. The request is at
             `awaiting-payment` here, which is not terminal, so the write is accepted.

             Non-fatal, and this is the important part: the request exists and is about to be paid
             for, so throwing into the outer `catch` would tell a charged customer their submission
             was lost. Say what actually happened instead — the desk will ask — and carry on.
          */
          try {
            await recordServiceRequestIdentities(request?.id, identityParties(owner, tenants));
          } catch (err) {
            // Never log the payload: this is the one call whose body is a set of Aadhaar numbers.
            console.error('Rent Agreement identity hand-off failed', err?.status || err?.message);
            toast(tr('services.ra.identitiesFailed'), 'info');
          }
          if (request?.paymentSessionId) {
            // The sidebar now renders the server's own published breakdown, so against the live API
            // these two agree by construction rather than by coincidence (D150). The notice stays
            // for the cases where they still can't: a fees read that failed (the sidebar showed no
            // price at all), and mock mode, where the statutory figures are derived locally because
            // the mock publishes none. Nobody should meet a number for the first time inside a
            // payment modal, so if they differ, say so and let the server's figure win.
            const charged = Number(request.amount);
            if (Number.isFinite(charged) && charged > 0 && charged !== cost.total) {
              toast(tr('services.ra.cost.chargedDiffers', { amount: fmt(charged) }), 'info');
            }
            try {
              await openCashfreeCheckout(request.paymentSessionId);
            } catch (err) {
              // The SDK failed to load or open. The request itself exists and is still payable from
              // the tracker, so this is not the lost submission the generic save-error claims.
              console.error('Rent Agreement checkout could not open');
              if (import.meta.env.DEV) console.error(err);
            }
            // The modal closing is not proof of payment — only the signature-verified webhook moves
            // the request to `new` (or cancels it), and being server-to-server it lands seconds
            // after the customer is already back on this page. A single re-read therefore reads
            // `awaiting_payment` on almost every *successful* payment, so the ordinary reward for
            // paying was an amber panel telling the customer it had not gone through — correctable
            // only by reloading, and an invitation to pay a second time. Poll instead, and treat
            // "still awaiting" as not-yet-known rather than as a verdict until the budget is gone.
            setPaymentConfirming(true);
            let status = 'awaiting_payment';
            for (let attempt = 0; attempt <= PAYMENT_POLL_BACKOFF_MS.length; attempt++) {
              if (attempt > 0) {
                await sleepBeforeRetry(PAYMENT_POLL_BACKOFF_MS[attempt - 1]);
                if (!mountedRef.current) break;
              }
              const settled = await getServiceRequest(request.id).catch(() => null);
              // Only overwrite on a status we actually received: one dropped request mid-poll would
              // otherwise erase a verdict already read and hand the customer the amber panel for a
              // payment the webhook had confirmed.
              if (settled?.status) status = settled.status;
              if (!mountedRef.current || status !== 'awaiting_payment') break;
            }
            // Guarded because that loop breaks on unmount as well as on a verdict, and every branch
            // above it sits behind an await — an unguarded `setState` here is a leak on the page the
            // customer left mid-poll. `break` rather than `return`, so the unmounted case still
            // falls through to `clearDraft()`: a paid request that leaves its draft behind re-offers
            // the owner a form they have already submitted and been charged for.
            if (mountedRef.current) {
              setPaymentConfirming(false);
              setPaymentPending(status === 'awaiting_payment');
            }
          }
        }
        clearDraft();
      } else if (mode === 'invite' && inviteCtx) {
        // Invited tenant submits their part — attach their real documents to the request.
        // No new admin ticket here; the owner's ticket already represents this agreement.
        const pname = tenants.length && tenants[0].name ? tenants[0].name : (user?.name || 'Tenant');
        submitInviteDetails(digits(user.mobile), inviteCtx.invite.inviteId, details, collectDocs(), { name: pname, mobile: digits(user.mobile) });
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
    aType, setAType, prop, setP, setProp, setShowPropertyPicker,
    owner, setO, ownerDocs, setOwnerDocs, vaultEnabled, saveOwnerDocToVault,
    tenantMode, setTenantMode, tenants, setTenant, addTenant, removeTenant, tenantDocs, setTenantDocs, invite, setInvite,
    terms, setT, maint, setMaint, regArea, setRegArea, furnItems, custom, setCustom, clauses, setClauses,
    isChecked, toggleFurn, bumpQty, removeFurn, addCustom, furnitureText,
    wit, setWit,
    declare, setDeclare, generate, submitting, paymentPending, paymentConfirming,
    clearErr, fc, cost, locked, startNewAgreement, restored, startFresh, myInvites,
    detailsSize, detailsMax: DETAILS_MAX_CHARS, detailsTooLong, detailsWorstField,
    copyInviteLink, next, prev,
  };
}

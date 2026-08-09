import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../../../lib/useScrollReveal.js';
import { useAuth } from '../../../../context/AuthContext.jsx';
import { useToast } from '../../../../context/ToastContext.jsx';
import { createServiceRequest } from '../../../../lib/mockApi.js';
import { create as createFlowRequest, createCoFill, inviteContext, submitInviteDetails, buildInviteWaLink, inviteLink, findInviteById, pendingInvites, list, isActive } from '../../../../lib/serviceFlow.js';
import { getListings, getListing, getFees, pushNotificationFor } from '../../../../lib/store.js';
import { getDocsForProp, addDocument } from '../../../../lib/data/documents.js';
import { useFormDraft } from '../../../../lib/hooks.js';
import { OWNER_DOCS, TENANT_DOCS, OWNER_VAULT_CAT } from './constants.js';
import { fmt, digits, num, emptyTenant } from './helpers.js';
import { useRaFurniture } from './useRaFurniture.js';

export function useRentAgreement() {
  const rootRef = useScrollReveal();
  const { t: tr } = useTranslation();
  const { user, isIn } = useAuth();
  const { toast } = useToast();
  const formRef = useRef(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
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
  const [prop, setProp] = useState({ propType: 'Flat / Apartment', furnish: 'Unfurnished', flatNo: '', society: '', locality: '', city: 'Pune', pincode: '', area: '' });

  // Step 2 — Owner
  const [owner, setOwner] = useState({ oName: isIn ? user?.name || '' : '', oAge: '', oGender: 'Male', oPan: '', oAadhaar: '', oMobile: isIn ? user?.mobile || '' : '', oEmail: '', oAddr: '' });
  const [ownerDocs, setOwnerDocs] = useState({});

  // Step 3 — Tenant
  const [tenantMode, setTenantMode] = useState('fill');
  const [tenants, setTenants] = useState([emptyTenant()]);
  const [tenantDocs, setTenantDocs] = useState({});
  const [invite, setInvite] = useState({ invMobile: '', invName: '', invMessage: '' });

  // Step 4 — Terms
  const [terms, setTerms] = useState({ startDate: '', months: '11', rent: '', deposit: '', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' });
  const [maint, setMaint] = useState('Tenant');
  const [regArea, setRegArea] = useState('urban');
  const { furnItems, setFurnItems, custom, setCustom, isChecked, toggleFurn, bumpQty, removeFurn, addCustom, furnitureText } = useRaFurniture();
  const [clauses, setClauses] = useState('');

  // Step 5 — Witnesses
  const [wit, setWit] = useState({ w1Name: '', w1Addr: '', w2Name: '', w2Addr: '' });

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
  const activeRequests = useMemo(
    () => (isIn && user?.mobile ? list(user.mobile).filter((r) => r.type === 'rental' && isActive(r.status)) : []),
    [isIn, user],
  );
  const locked = mode === 'owner' && !done && !startNew && activeRequests.length > 0;

  // Begin a fresh agreement for a different property: clear the saved draft and
  // reset every field to its blank default, then reveal the wizard.
  const startNewAgreement = () => {
    clearDraft();
    setStep(0);
    setErrors({});
    setAType('Residential');
    setProp({ propType: 'Flat / Apartment', furnish: 'Unfurnished', flatNo: '', society: '', locality: '', city: 'Pune', pincode: '', area: '' });
    setOwner({ oName: isIn ? user?.name || '' : '', oAge: '', oGender: 'Male', oPan: '', oAadhaar: '', oMobile: isIn ? user?.mobile || '' : '', oEmail: '', oAddr: '' });
    setOwnerDocs({});
    setTenantMode('fill');
    setTenants([emptyTenant()]);
    setTenantDocs({});
    setInvite({ invMobile: '', invName: '', invMessage: '' });
    setTerms({ startDate: '', months: '11', rent: '', deposit: '', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' });
    setMaint('Tenant');
    setRegArea('urban');
    setFurnItems([]);
    setCustom({ name: '', qty: 1 });
    setClauses('');
    setWit({ w1Name: '', w1Addr: '', w2Name: '', w2Addr: '' });
    setDeclare(false);
    setInviteResult(null);
    setCopied(false);
    setShowPropertyPicker(false);
    setOpenFaq(-1);
    setStartNew(true);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Draft autosave/restore ──
  // useFormDraft restores via a functional updater — resolve it against the live
  // state before dispatching to applyFormState, otherwise the whole draft is dropped.
  const form = captureFormState();
  const { restored, clear: clearDraft, startFresh } = useFormDraft('pnDraft:rentAgreement', form, (upd) => applyFormState(typeof upd === 'function' ? upd(captureFormState()) : upd), { enabled: mode === 'owner' && !done, ignore: ['oName', 'oMobile', 'step'] });

  // ── Owner KYC autofill ──
  useEffect(() => {
    if (mode !== 'owner' || !isIn) return;
    const kycStr = localStorage.getItem('puneNestOwnerKYC:' + digits(user?.mobile || ''));
    let kyc = null;
    try { kyc = kycStr ? JSON.parse(kycStr) : null; } catch { kyc = null; }
    if (kyc) {
      setOwner((o) => ({ ...o, oName: o.oName || kyc.name || '', oAge: o.oAge || kyc.age || '', oGender: o.oGender || kyc.gender || 'Male', oPan: o.oPan || kyc.pan || '', oAadhaar: o.oAadhaar || kyc.aadhaar || '', oMobile: o.oMobile || kyc.mobile || '', oEmail: o.oEmail || kyc.email || '', oAddr: o.oAddr || kyc.addr || '' }));
    } else {
      setOwner((o) => ({ ...o, oName: o.oName || user?.name || '', oMobile: o.oMobile || user?.mobile || '' }));
    }
    // eslint-disable-next-line
  }, [mode, isIn]);

  // Persist owner KYC on submission
  const persistOwnerKYC = () => {
    if (mode !== 'owner' || !isIn) return;
    try {
      const mob = digits(owner.oMobile || user?.mobile || '');
      if (!mob) return;
      localStorage.setItem('puneNestOwnerKYC:' + mob, JSON.stringify({ name: owner.oName, age: owner.oAge, gender: owner.oGender, pan: owner.oPan, aadhaar: owner.oAadhaar, email: owner.oEmail, addr: owner.oAddr, mobile: owner.oMobile, at: Date.now() }));
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
  // Platform service fee is admin-controlled (Settings → Fees → "Rent Agreement Platform").
  // Stamp duty + registration fee are statutory (Maharashtra), so they stay fixed.
  const serviceFee = Number(getFees().rentAgreementPlatform) || 0;
  const cost = useMemo(() => {
    const rent = num(terms.rent), dep = num(terms.deposit), nr = num(terms.nrDeposit);
    const months = parseInt(terms.months, 10) || 11;
    const years = Math.ceil(months / 12);
    const taxable = rent * months + nr + 0.1 * dep * years;
    const stamp = Math.round(0.0025 * taxable);
    const reg = regArea === 'rural' ? 500 : 1000;
    return { rent, dep, months, stamp, reg, service: serviceFee, total: stamp + reg + serviceFee };
  }, [terms.rent, terms.deposit, terms.nrDeposit, terms.months, regArea, serviceFee]);

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
  const stepErrors = (s) => {
    const e = {};
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
  const next = () => { if (validateStep(step)) { setStep((s) => Math.min(5, s + 1)); scrollTop(); } };
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

  const generate = () => {
    // Wizard is fillable publicly; generating the agreement requires sign-in (draft is restored on return).
    if (!isIn) { navigate(`/signin?reason=service&next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    for (let s = 0; s <= 3; s++) {
      const e = stepErrors(s);
      if (Object.keys(e).length) { setStep(s); setErrors(e); toast(tr('services.ra.validationRequired'), 'error'); return; }
    }
    if (!declare) { toast(tr('services.ra.declarationRequired'), 'error'); return; }
    const tNames = tenantMode === 'invite' ? 'Invited: ' + (invite.invName || '••••••' + digits(invite.invMobile).slice(-4)) + ' (pending)' : tenants.map((t) => t.name.trim()).filter(Boolean).join(', ');
    const property = [prop.flatNo, prop.society, prop.locality, prop.city].filter(Boolean).join(', ');
    const ownerMobile = digits(owner.oMobile) || user?.mobile || '';
    const details = {
      property, ownerName: owner.oName || user?.name || 'Owner', tenants: tNames,
      rent: cost.rent, deposit: Number(terms.deposit) || 0, months: terms.months,
      startDate: terms.startDate, regArea: regArea === 'urban' ? 'Municipal / Urban' : 'Rural',
      _state: captureFormState(),
    };

    try {
      if (mode === 'owner') {
        // Link the admin service-ticket to the ops workflow request so its status stays
        // truthful (no phantom "new" after the agreement moves to draft/registration/done).
        const ticketRef = 'TR' + Date.now() + Math.floor(Math.random() * 1000);
        createServiceRequest({
          team: 'rental', service: 'Rent Agreement', customer: owner.oName || user?.name || 'Customer', mobile: digits(owner.oMobile) || user?.mobile || '',
          detail: `${aType} · ${property} · ${tNames || '—'} · ${fmt(cost.rent)}/mo · ${terms.months}m`, value: cost.total, ref: ticketRef,
        });
        persistOwnerKYC();
        const docs = collectDocs();
        if (tenantMode === 'invite' && digits(invite.invMobile)) {
          const { invite: inv } = createCoFill(ownerMobile, {
            type: 'rental', service: 'Rent Agreement', customer: { name: details.ownerName }, details,
            docs, ticketRef,
            initiatorRole: 'owner', initiatorName: details.ownerName,
            parties: [{ role: 'owner', mobile: ownerMobile, name: details.ownerName }, { role: 'tenant', mobile: digits(invite.invMobile), name: invite.invName }],
            invite: { toMobile: digits(invite.invMobile), toName: invite.invName, toRole: 'tenant', sections: ['tenant'], fromName: details.ownerName, fromRole: 'owner', property, message: invite.invMessage },
          });
          if (inv) {
            setInviteResult({
              toName: invite.invName || '',
              toMobile: digits(invite.invMobile),
              link: inviteLink(inv.inviteId),
              waLink: buildInviteWaLink({ toMobile: invite.invMobile, toName: invite.invName, toRole: 'tenant', fromName: details.ownerName, property, message: invite.invMessage, inviteId: inv.inviteId }),
            });
            // In-app nudge for the tenant if they already have a PuneNest account.
            // Route to "My Rental" first (their hub), where the pending request is
            // surfaced and they can open it to fill their details.
            pushNotificationFor(digits(invite.invMobile), {
              id: 'ra_invite_' + inv.inviteId,
              type: 'service',
              title: 'Complete your Rent Agreement details',
              desc: `${details.ownerName} invited you to add your tenant details & documents${property ? ' for ' + property : ''}. Open it from My Rental to complete your part.`,
              link: '/dashboard#rental',
            });
          }
        } else {
          createFlowRequest(ownerMobile, { type: 'rental', service: 'Rent Agreement', customer: { name: details.ownerName }, details, docs: docs.length ? docs : undefined, ticketRef });
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
    }

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
    declare, setDeclare, generate,
    clearErr, fc, cost, locked, startNewAgreement, restored, startFresh, myInvites,
    copyInviteLink, next, prev,
  };
}

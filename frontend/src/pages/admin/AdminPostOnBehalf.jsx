import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Send } from 'lucide-react';
import { createListingOnBehalf, ownerListingStanding } from '../../services/propertyService.js';
import { addNote } from '../../services/noteService.js';
import { classNames, parseAmount } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import {
  STEPS, LAST_STEP, INITIAL_FORM, NONRES_TYPES, LAND_TYPES, DRAFT_KEY, commercialLabelOf, landUseFor,
} from './post-on-behalf/constants.js';
import { OwnerStep, PropertyStep, LocationStep, PricingStep, PhotosStep, ReviewStep } from './post-on-behalf/WizardSteps.jsx';

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && d.form && (d.form.ownerName || d.form.ownerMobile || d.form.propertyType)) return d;
  } catch { /* ignore corrupt draft */ }
  return null;
}

export default function AdminPostOnBehalf() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [localityBusy, setLocalityBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdId, setCreatedId] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [draft, setDraft] = useState(() => loadDraft());
  const [restored, setRestored] = useState(false);

  /* The desk is exempt from the freemium ceiling, but an owner past their plan is an upgrade conversation
     only the operator can have. A reply for an edited number is dropped so standing never crosses owners. */
  const [standing, setStanding] = useState(null);
  const ownerMobile = form.ownerMobile;
  useEffect(() => {
    const m = String(ownerMobile || '').replace(/\D/g, '');
    if (m.length !== 10) { setStanding(null); return undefined; }
    let alive = true;
    ownerListingStanding(m)
      .then((s) => { if (alive && s && s.mobile === m) setStanding(s); })
      .catch(() => { /* advisory only — see above */ });
    return () => { alive = false; };
  }, [ownerMobile]);

  // Autosave the in-progress form so an accidental refresh mid-call doesn't lose
  // everything. Skipped once the wizard is submitted (success) — the draft is cleared then.
  useEffect(() => {
    if (success) return;
    if (form === INITIAL_FORM) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step, savedAt: Date.now() })); } catch { /* quota */ }
  }, [form, step, success]);

  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } setDraft(null); };

  const resumeDraft = () => {
    if (!draft) return;
    setForm({ ...INITIAL_FORM, ...draft.form });
    setStep(Math.min(Math.max(draft.step || 1, 1), LAST_STEP));
    setRestored(true);
    setDraft(null);
  };

  const set = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Cascade resets so stale config from a previous choice can never leak into
      // the saved listing or the Review screen.
      if (field === 'propertyType') {
        next.bhk = '';
        next.commercialType = '';
        next.shellType = '';
        next.naStatus = ''; next.otherRights = ''; next.buyerEligibility = '';
        if (NONRES_TYPES.includes(value)) next.furnishing = 'unfurnished';
        if (LAND_TYPES.includes(value)) { next.floor = ''; next.totalFloors = ''; }
      }
      // Sale has no security deposit or preferred-tenant list — drop rent-era values.
      if (field === 'deal' && value === 'buy') next.deposit = '';
      return next;
    });
    setErrors((prev) => { if (prev[field] === undefined) return prev; const n = { ...prev }; delete n[field]; return n; });
  };

  function validateStep(s) {
    const err = {};
    if (s === 1) {
      if (!form.ownerName.trim()) err.ownerName = true;
      if (!/^[6-9]\d{9}$/.test(form.ownerMobile)) err.ownerMobile = true;
      if (!form.propertyType) err.propertyType = true;
      if (form.propertyType === 'commercial' && !form.commercialType) err.commercialType = true;
      if (form.propertyType === 'commercial' && !form.shellType) err.shellType = true;
      if (!form.bhk && !NONRES_TYPES.includes(form.propertyType)) err.bhk = true;
      if (!form.carpetArea) err.carpetArea = true;
      /* The server 422s this unnamed, so the operator would only see a generic toast on the last step. */
      if (form.floor && form.totalFloors && (parseInt(form.floor, 10) || 0) > Number(form.totalFloors)) err.floor = true;
      /* Held to the same bar as the owner's own wizard: a land listing that reaches a buyer without
         these is one the ops desk has to chase the owner about later anyway. */
      if (LAND_TYPES.includes(form.propertyType)) {
        if (!form.naStatus) err.naStatus = true;
        if (!form.otherRights) err.otherRights = true;
        if (form.propertyType === 'farmland' && form.deal === 'buy' && !form.buyerEligibility) err.buyerEligibility = true;
      }
    } else if (s === 2) {
      if (!form.locality) err.locality = true;
    } else if (s === 3) {
      if (!form.price) err.price = true;
    }
    setErrors(err);
    return Object.keys(err).length === 0;
  }

  function next() { if (!validateStep(step)) return; setStep((s) => Math.min(s + 1, LAST_STEP)); }
  function prev() { setStep((s) => Math.max(s - 1, 1)); }

  async function handleSubmit() {
    const firstInvalidStep = [1, 2, 3].find((candidate) => !validateStep(candidate));
    if (firstInvalidStep) { setStep(firstInvalidStep); return; }
    setSubmitting(true);
    try {
      const land = LAND_TYPES.includes(form.propertyType);
      const isCommercial = form.propertyType === 'commercial';
      const sale = form.deal === 'buy';
      const residentialHome = !NONRES_TYPES.includes(form.propertyType);
      const datedPossession = !sale || (!land && (form.possession === 'new' || form.possession === 'under'));
      const availableFrom = datedPossession ? form.availableFrom || '' : '';
      const bhkNum = residentialHome ? (Number(form.bhk) || 0) : 0;
      const typeMap = { flat: 'Flat', independent: 'Independent House', villa: 'Villa', commercial: 'Commercial', openplot: 'Open Plot', farmland: 'Farm Land' };
      const subtypeLabel = commercialLabelOf(form.commercialType);
      const typeLabel = (isCommercial && subtypeLabel) ? subtypeLabel : (typeMap[form.propertyType] || 'Property');
      const titlePrefix = bhkNum ? bhkNum + ' BHK ' : '';
      const title = titlePrefix + typeLabel + ' in ' + (form.locality || 'Pune');
      const society = form.societyId ? form.society : '';
      /* Only keys `toListingCreate` reads travel; everything else the owner adds after claiming. */
      const listing = {
        title, type: typeLabel, bhkNum, deal: form.deal,
        locality: form.locality || 'Pune',
        localitySlug: form.localitySlug || undefined,
        area: Number(form.carpetArea) || 0,
        floor: land || !form.floor ? undefined : parseInt(form.floor, 10) || 0,
        totalFloors: land ? undefined : form.totalFloors,
        furnishing: residentialHome ? form.furnishing : undefined,
        price: parseAmount(form.price),
        images: form.photos,
        reraId: sale && !land ? form.reraId.trim() : '',
        landUse: landUseFor(form.propertyType),
        /* Possession is a sale-only question here and on the consumer form, so a rental or a plot
           states nothing rather than claiming "ready to move". `writePossession` omits the key. */
        construction: sale && !land ? (form.possession || 'ready') : undefined,
        available: availableFrom,
        society,
        societyId: form.societyId || undefined,
        lat: form.lat ?? undefined,
        lng: form.lng ?? undefined,
        pincode: form.pincode || undefined,
        address: form.address || '',
        deposit: sale ? 0 : parseAmount(form.deposit),
        formDetails: {
          society,
          availableFrom,
          ...(isCommercial && {
            commercialType: form.commercialType || '',
            shellType: form.shellType || '',
          }),
          ...(land && {
            naStatus: form.naStatus || '',
            otherRights: form.otherRights || '',
            buyerEligibility: sale && form.propertyType === 'farmland' ? (form.buyerEligibility || '') : '',
          }),
        },
      };

      const created = await createListingOnBehalf(form.ownerMobile, form.ownerName, listing);
      /* No client-side audit write: `OnBehalfListingService` records both rows itself, naming the
         staff member from their token, and the Staff Activity console reads those. */
      setCreatedId(created.id);
      setSuccess(true);
      clearDraft();
      toast('Listing created \u2014 send the owner their claim link', 'success');
      /* `ListingCreate` has no notes field, so the call notes go to the listing's internal-notes
         timeline. The listing already exists, so a failure here is reported, not retried. */
      if (form.ownerNotes.trim()) {
        addNote('listing', created.uuid, form.ownerNotes)
          .catch(() => toast('Listing created, but the internal note was not saved', 'error'));
      }
    } catch (err) {
      /* A 422 names its field and `writePossession` names an unmappable value, but the toast can say
         neither — so log it, or staff can only report "it failed". */
      console.error(err);
      toast('Failed to create listing \u2014 please try again', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-teal-500/15"><CheckCircle2 className="h-10 w-10 text-teal-400" /></div>
        <h2 className="text-2xl font-bold mb-2">Listing Sent to Owner</h2>
        <p className="text-gray-400 mb-2 max-w-md">Saved under <span className="text-white font-medium">{form.ownerName}</span> (+91 {form.ownerMobile}). Send them the claim link on WhatsApp from Properties → Staff Posted; the listing can go live once they confirm it&apos;s theirs.</p>
        <p className="text-sm text-gray-500 mb-8">Listing ID: {createdId}</p>
        <div className="flex gap-3">
          <button onClick={() => navigate('/admin/properties')} className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium hover:bg-white/10 transition">View All Properties</button>
          <button onClick={() => { setSuccess(false); setStep(1); setForm(INITIAL_FORM); setRestored(false); }} className="rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-teal-400 transition">Post Another</button>
        </div>
      </div>
    );
  }

  const stepContent = () => {
    switch (step) {
      case 1: return (
        <div className="space-y-6">
          <OwnerStep form={form} set={set} errors={errors} standing={standing} />
          <div className="border-t border-white/10 pt-6"><PropertyStep form={form} set={set} errors={errors} /></div>
        </div>
      );
      case 2: return <LocationStep form={form} set={set} errors={errors} onLocalityBusy={setLocalityBusy} />;
      case 3: return <PricingStep form={form} set={set} errors={errors} />;
      case 4: return (
        <div className="space-y-6">
          <PhotosStep form={form} set={set} />
          <div className="border-t border-white/10 pt-6"><ReviewStep form={form} /></div>
        </div>
      );
      default: return null;
    }
  };

  return (
    <div>
      <PageHeader title="Post on Behalf of Owner" subtitle="Create a listing for an owner who shared details via WhatsApp/call" actions={<button onClick={() => navigate('/admin/properties')} className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 transition"><ArrowLeft className="h-4 w-4" /> Back</button>} />

      {draft && !restored && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-teal-400/30 bg-teal-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-teal-100">You have an unsaved draft{draft.form?.ownerName ? <> for <span className="font-medium">{draft.form.ownerName}</span></> : ''}. Resume where you left off?</p>
          <div className="flex gap-2">
            <button onClick={resumeDraft} className="rounded-lg bg-teal-500 px-4 py-1.5 text-sm font-semibold text-ink hover:bg-teal-400 transition">Resume</button>
            <button onClick={clearDraft} className="rounded-lg border border-white/15 bg-white/5 px-4 py-1.5 text-sm font-medium hover:bg-white/10 transition">Discard</button>
          </div>
        </div>
      )}

      {/* Rent vs Sale is the first decision staff make on the call — surface it up
          top and keep it visible on every step (it drives deposit, price labels & fields). */}
      <div className="mb-6 max-w-2xl">
        <span className="mb-1.5 block text-sm font-medium text-gray-300">Listing for</span>
        <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1" role="group" aria-label="Listing deal type">
          {[{ v: 'rent', l: 'For Rent' }, { v: 'buy', l: 'For Sale' }].map(({ v, l }) => (
            <button key={v} type="button" aria-pressed={form.deal === v} onClick={() => set('deal', v)} className={classNames('rounded-lg px-6 py-2 text-sm font-semibold transition', form.deal === v ? 'bg-teal-500 text-ink' : 'text-gray-300 hover:text-white')}>{l}</button>
          ))}
        </div>
      </div>

      <HScroll wrapClassName="mb-8" className="flex items-center gap-1 pb-2">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const active = step === s.id;
          const done = step > s.id;
          return (
            <button key={s.id} onClick={() => { if (done) setStep(s.id); }} className={classNames('flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium whitespace-nowrap transition', active ? 'bg-teal-500/15 text-teal-300 border border-teal-400/30' : done ? 'bg-white/5 text-teal-400 border border-white/5 cursor-pointer hover:bg-white/10' : 'bg-white/[0.02] text-gray-500 border border-white/5')}>
              {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{s.label}</span>
            </button>
          );
        })}
      </HScroll>

      <div className="max-w-2xl rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-8">
        {stepContent()}
        <div className="mt-8 flex items-center justify-between">
          {step > 1 ? <button onClick={prev} className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium hover:bg-white/10 transition"><ArrowLeft className="h-4 w-4" /> Back</button> : <div />}
          {step < LAST_STEP ? (
            <button onClick={next} disabled={localityBusy} className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-teal-400 transition disabled:opacity-50">Next <ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting} className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-teal-400 transition disabled:opacity-50">{submitting ? 'Saving...' : 'Send to Owner'} <Send className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

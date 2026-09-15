import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Send } from 'lucide-react';
import { createListingOnBehalf, listForModeration, ownerListingStanding } from '../../services/propertyService.js';
import { parseAmount } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { classNames } from '../../lib/format.js';
import { STEPS, INITIAL_FORM, NONRES_TYPES, LAND_TYPES, DRAFT_KEY, commercialSubtypes } from './post-on-behalf/constants.js';
import { OwnerStep, PropertyStep, LocationStep, PricingStep, PhotosStep, ReviewStep } from './post-on-behalf/WizardSteps.jsx';
import { resolveLocalitySlug } from '../../data/localities.js';

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
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdId, setCreatedId] = useState(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [draft, setDraft] = useState(() => loadDraft());
  const [restored, setRestored] = useState(false);

  /* Backs the "this owner already has N pending listings" warning, the desk's one chance to notice
     it is taking the same flat down twice. Read once on open, keyed by mobile because that is the
     only identifier an operator has on the phone; failure is advisory, so it stays silent. */
  const [pendingByMobile, setPendingByMobile] = useState(() => new Map());
  useEffect(() => {
    let alive = true;
    listForModeration({ status: 'pending' })
      .then((rows) => {
        if (!alive) return;
        const tally = new Map();
        for (const l of rows || []) {
          const m = String(l.ownerMobile || '').replace(/\D/g, '').slice(-10);
          if (m) tally.set(m, (tally.get(m) || 0) + 1);
        }
        setPendingByMobile(tally);
      })
      .catch(() => { /* advisory only — see above */ });
    return () => { alive = false; };
  }, []);

  /* The desk is exempt from the freemium ceiling — it is a rule about self-service — but an owner
     past their plan is an upgrade conversation only the operator can have, so show the numbers and
     let the desk decide. Asked at ten digits, and a reply for an edited number is dropped so one
     owner's standing never renders against another's name. */
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
    setForm(draft.form);
    setStep(Math.min(Math.max(draft.step || 1, 1), 6));
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
        next.amenities = [];
        next.furniture = [];
        next.bathrooms = ''; next.balconies = ''; next.builtUp = ''; next.plotArea = ''; next.floorsInHouse = '';
        next.washrooms = ''; next.shellType = ''; next.parkingSpaces = ''; next.powerBackup = false; next.pantry = false; next.camCharges = ''; next.suitableFor = [];
        next.plotLength = ''; next.plotWidth = ''; next.openSides = ''; next.roadWidth = ''; next.cornerPlot = false; next.boundaryWall = false; next.plotZone = ''; next.naSanctioned = false; next.waterSource = ''; next.electricity = false; next.roadAccess = false; next.satbara = false;
        if (value !== 'commercial') next.commercialType = '';
        if (LAND_TYPES.includes(value)) {
          next.floor = ''; next.totalFloors = ''; next.facing = ''; next.overlooking = ''; next.age = ''; next.furnishing = 'unfurnished';
        }
      }
      // Sale has no security deposit or preferred-tenant list — drop rent-era values.
      if (field === 'deal' && value === 'buy') { next.deposit = ''; next.preferredTenants = []; }
      return next;
    });
    if (errors[field]) setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  };

  function validateStep(s) {
    const err = {};
    if (s === 1) {
      if (!form.ownerName.trim()) err.ownerName = true;
      if (!/^[6-9]\d{9}$/.test(form.ownerMobile)) err.ownerMobile = true;
    } else if (s === 2) {
      if (!form.propertyType) err.propertyType = true;
      if (form.propertyType === 'commercial' && !form.commercialType) err.commercialType = true;
      if (!form.bhk && !NONRES_TYPES.includes(form.propertyType)) err.bhk = true;
      if (!form.carpetArea) err.carpetArea = true;
    } else if (s === 3) {
      if (!form.locality) err.locality = true;
    } else if (s === 4) {
      if (!form.price) err.price = true;
    }
    setErrors(err);
    return Object.keys(err).length === 0;
  }

  function next() { if (!validateStep(step)) return; setStep((s) => Math.min(s + 1, 6)); }
  function prev() { setStep((s) => Math.max(s - 1, 1)); }

  async function handleSubmit() {
    if (!validateStep(step)) return;
    setSubmitting(true);
    try {
      const land = NONRES_TYPES.includes(form.propertyType) && LAND_TYPES.includes(form.propertyType);
      const isCommercial = form.propertyType === 'commercial';
      const residentialHome = !NONRES_TYPES.includes(form.propertyType);
      const bhkNum = NONRES_TYPES.includes(form.propertyType) ? 0 : (Number(form.bhk) || 0);
      const typeMap = { flat: 'Flat', independent: 'Independent House', villa: 'Villa', commercial: 'Commercial', openplot: 'Open Plot', farmland: 'Farm Land' };
      const subtypeLabel = commercialSubtypes.find((s) => s.value === form.commercialType)?.label || '';
      const typeLabel = (form.propertyType === 'commercial' && subtypeLabel) ? subtypeLabel : (typeMap[form.propertyType] || 'Property');
      const titlePrefix = bhkNum ? bhkNum + ' BHK ' : '';
      const title = titlePrefix + typeLabel + ' in ' + (form.locality || 'Pune');

      const listing = {
        title, type: typeLabel,
        bhk: bhkNum ? bhkNum + ' BHK' : '', bhkNum, deal: form.deal,
        bath: residentialHome ? (Number(form.bathrooms) || 0) : 0,
        balconies: residentialHome ? (Number(form.balconies) || 0) : 0,
        builtUpArea: Number(form.builtUp) || 0,
        plotArea: Number(form.plotArea) || 0,
        floorsInHouse: Number(form.floorsInHouse) || 0,
        furniture: form.furniture || [],
        ...(isCommercial && { shellType: form.shellType || '', washrooms: form.washrooms || '', parkingSpaces: Number(form.parkingSpaces) || 0, powerBackup: form.powerBackup, pantry: form.pantry, camCharges: parseAmount(form.camCharges), suitableFor: form.suitableFor || [] }),
        ...(land && { plotLength: Number(form.plotLength) || 0, plotWidth: Number(form.plotWidth) || 0, openSides: form.openSides || '', roadWidth: Number(form.roadWidth) || 0, cornerPlot: form.cornerPlot, boundaryWall: form.boundaryWall, plotZone: form.plotZone || '', naSanctioned: form.naSanctioned, waterSource: form.waterSource || '', electricity: form.electricity, roadAccess: form.roadAccess, satbara: form.satbara }),
        locality: form.locality || 'Pune',
        localitySlug: resolveLocalitySlug(form.locality || 'Pune'),
        area: Number(form.carpetArea) || 0, floor: form.floor || 'N/A',
        totalFloors: Number(form.totalFloors) || 0, facing: form.facing || '', overlooking: form.overlooking || '',
        age: form.age || 'new', furnishing: form.furnishing,
        price: parseAmount(form.price), priceNegotiable: form.priceNegotiable,
        monthlyMaintenance: parseAmount(form.maintenance),
        owner: form.ownerName, ownerMobile: form.ownerMobile,
        ownerVerified: false, ownershipVerified: false,
        image: form.photos[0] || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80',
        gallery: form.photos, amenities: form.amenities || [], rera: form.reraId || '',
        transactionType: form.deal === 'buy' ? (form.transactionType || '') : '',
        possession: form.possession || 'ready',
        ownership: form.deal === 'buy' ? (form.ownership || '') : '',
        loanAvailable: residentialHome ? form.loanAvailable : false,
        available: (form.deal === 'rent' || form.possession === 'available') ? (form.availableFrom || '') : '',
        tenants: (form.preferredTenants || []).join(','),
        food: 'any',
        lockin: form.lockIn || '0', notice: form.noticePeriod || '1', agreementDuration: form.agreementDuration || '11',
        description: form.description || '', society: form.society || '',
        address: form.address || '', landmark: form.landmark || '',
        deposit: form.deal === 'rent' ? parseAmount(form.deposit) : 0,
        /* The staff actor is server-set: a client that names the actor is a client asking to be
           believed about it. Owner identity goes as request arguments, not listing fields. */
        adminNotes: form.ownerNotes || '', status: 'pending',
      };

      const created = await createListingOnBehalf(form.ownerMobile, form.ownerName, listing);
      /* No client-side audit write: `OnBehalfListingService` records both rows itself, naming the
         staff member from their token, and the Staff Activity console reads those. */
      setCreatedId(created.id);
      setSuccess(true);
      clearDraft();
      toast('Listing created \u2014 owner will receive claim link', 'success');
    } catch {
      toast('Failed to create listing \u2014 please try again', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    const hasPhotos = form.photos.length > 0;
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-teal-500/15"><CheckCircle2 className="h-10 w-10 text-teal-400" /></div>
        <h2 className="text-2xl font-bold mb-2">Listing Sent to Owner</h2>
        <p className="text-gray-400 mb-2 max-w-md">A claim link has been sent to <span className="text-white font-medium">{form.ownerName}</span> (+91 {form.ownerMobile}). {hasPhotos
          ? <>Photos are already attached — once they complete Aadhaar verification, the listing will appear in your verification queue.</>
          : <>Once they upload photos &amp; complete Aadhaar verification, the listing will appear in your verification queue.</>}</p>
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
      case 1: return <OwnerStep form={form} set={set} errors={errors} pendingByMobile={pendingByMobile} standing={standing} />;
      case 2: return <PropertyStep form={form} set={set} errors={errors} />;
      case 3: return <LocationStep form={form} set={set} errors={errors} />;
      case 4: return <PricingStep form={form} set={set} errors={errors} />;
      case 5: return <PhotosStep form={form} set={set} />;
      case 6: return <ReviewStep form={form} />;
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

      {/* Rent vs Sale is the first decision an agent makes on the call — surface it up
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
          {step < 6 ? (
            <button onClick={next} className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-teal-400 transition">Next <ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting} className="flex items-center gap-1.5 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-teal-400 transition disabled:opacity-50">{submitting ? 'Saving...' : 'Send to Owner'} <Send className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

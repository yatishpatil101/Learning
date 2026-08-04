import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import { localityNames } from '../../../data/localities.js';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileField from '../../../components/MobileField.jsx';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { createServiceRequest } from '../../../lib/mockApi.js';
import ServiceTracker from '../../../components/ServiceTracker.jsx';
import { create as createFlowRequest } from '../../../lib/serviceFlow.js';
import AutosaveBanner from '../../../components/AutosaveBanner.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import { useFormDraft, useFieldErrors } from '../../../lib/hooks.js';

const IMG = (id, w = 900) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80`;
const BEFORE = 'images/before.png';
const AFTER = 'images/after.png';

const SERVICES = [
  ['Full Home Interiors', '1600596542815-ffad4c1539a9', 'Turnkey design & build for your entire home — one team, one timeline.'],
  ['Modular Kitchen', '1556909114-f6e7ad7d3136', 'Ergonomic, durable kitchens with smart storage and premium finishes.'],
  ['Wardrobes & Storage', '1558997519-83ea9252edf8', 'Custom wardrobes, lofts and storage that fit every inch of your space.'],
  ['Living & Dining', '1502672260266-1c1ef2d93688', 'TV units, false ceilings, lighting and décor that set the mood.'],
  ['Bedroom Design', '1600566753190-17f0baa2a6c3', 'Restful bedrooms with bespoke beds, side units and ambient lighting.'],
  ['Bathroom Renovation', '1620626011761-996317b8d101', 'Modern, waterproofed bathrooms with quality fittings and tiling.'],
];
const STYLES = [['Modern', '1600585154340-be6161a56a0c'], ['Scandinavian', '1493809842364-78817add7ffb'], ['Contemporary', '1600210492493-0946911123ea'], ['Luxe', '1600047509807-ba8f99d2cdde'], ['Minimalist', '1560448204-e02f11c3d0e2'], ['Indian Ethnic', '1613977257363-707ba9348227']];
const PROJECTS = [['3 BHK in Baner', '1600596542815-ffad4c1539a9'], ['2 BHK in Wakad', '1522708323590-d24dbb6b0267'], ['Villa in Kothrud', '1600210492493-0946911123ea'], ['Studio in Hinjawadi', '1540518614846-7eded433c457'], ['4 BHK in Kalyani Nagar', '1600047509807-ba8f99d2cdde'], ['2 BHK in Viman Nagar', '1560448204-e02f11c3d0e2']];
const PACKAGES = [
  ['Essentials', '1,499', 'Smart, budget-friendly interiors for first homes.', ['Modular kitchen + wardrobes', 'Laminate finishes', 'Essential false ceiling & lighting', '5-year warranty'], false],
  ['Premium', '1,999', 'Our most popular, balanced design & quality.', ['Full home interiors', 'Acrylic / membrane finishes', 'Designer ceilings & lighting', 'Custom storage solutions', '10-year warranty'], true],
  ['Luxe', '2,999', 'Bespoke, high-end materials and detailing.', ['Bespoke turnkey interiors', 'Premium veneer / lacquered glass', 'Imported hardware & appliances', 'Dedicated design lead', '10-year warranty'], false],
];
const STEPS = [['Consultation', 'calendar-heart', 'Share your space, style and budget with our designer — free.'], ['3D Design', 'box', 'Get a photorealistic 3D design and a transparent, itemised quote.'], ['Production', 'hammer', 'Vetted partners manufacture and execute with quality checks.'], ['Move In', 'key-round', 'On-time handover with a 10-year warranty. Welcome home!']];
const TRUST = [['10-Year Warranty', 'shield-check', 'Comprehensive warranty on modular work and materials, in writing.'], ['45-Day Move-in', 'timer', 'On-time delivery guarantee for standard full-home projects.'], ['Transparent Pricing', 'badge-indian-rupee', 'Itemised quotes with no hidden charges — pay in easy milestones.'], ['Dedicated Designer', 'user-round', 'One designer + project manager from concept to handover.']];
const FAQ = [
  ['How long does a full home interior take?', 'A standard 2–3 BHK is typically designed, manufactured and installed in about 45 days from design sign-off, depending on scope and site readiness.'],
  ['Is the 3D design really free?', 'Yes — the consultation and 3D design concept are free. You only pay once you approve the design and quote and decide to proceed.'],
  ['What does the 10-year warranty cover?', 'It covers modular cabinetry, hardware and workmanship against manufacturing defects, as detailed in your written warranty card.'],
  ['Can you work on an under-construction or occupied home?', 'Both. We plan around possession and, for occupied homes, sequence work room-by-room to minimise disruption.'],
  ['How is pricing calculated?', 'Pricing is itemised by scope and finishes (indicative per-sq.ft. packages above). Your final, transparent quote is shared after the consultation and measurements.'],
];

export default function InteriorRenovation() {
  const { t: tr } = useTranslation();
  const rootRef = useScrollReveal();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isIn } = useAuth();
  const { toast } = useToast();
  const [lightbox, setLightbox] = useState(null);
  const [ba, setBa] = useState(50);
  const [openFaq, setOpenFaq] = useState(-1);
  const [done, setDone] = useState(false);
  const formRef = useRef(null);
  const [form, setForm] = useState({ name: isIn ? user?.name || '' : '', mobile: isIn ? user?.mobile || '' : '', scope: '', config: '2 BHK', status: 'Ready to move', budget: 'Under ₹3 Lakh', location: '' });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const draft = useFormDraft('pnDraft:interior-renovation', form, setForm, { ignore: ['name', 'mobile', 'config', 'status', 'budget'] });
  const err = useFieldErrors(formRef);

  // Prefill scope from URL (?scope=kitchen)
  useEffect(() => {
    const scopeParam = searchParams.get('scope');
    if (scopeParam) {
      const options = ['Full Home Interiors', 'Modular Kitchen', 'Wardrobes & Storage', 'Home Renovation', 'Painting & Finishes', 'False Ceiling & Lighting'];
      const match = options.find(opt => opt.toLowerCase().includes(scopeParam.toLowerCase()));
      if (match) setForm((p) => ({ ...p, scope: match }));
    }
  }, [searchParams]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    // Public page; book the free consult only after sign-in (draft is restored on return).
    if (!isIn) { navigate(`/signin?reason=service&next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    const ok = err.check([
      { name: 'name', ok: !!form.name.trim(), msg: tr('services.interior.errName') },
      { name: 'mobile', ok: /^[6-9]\d{9}$/.test((form.mobile || '').replace(/\D/g, '')), msg: tr('services.interior.errMobile') },
      { name: 'scope', ok: !!form.scope, msg: tr('services.interior.errScope') },
    ], toast);
    if (!ok) return;
    const ref = 'TR' + Date.now() + Math.floor(Math.random() * 1000);
    createServiceRequest({ team: 'interior', service: form.scope, customer: form.name, mobile: form.mobile, detail: `${form.config} · ${form.status} · ${form.budget}${form.location ? ' · ' + form.location : ''}`, ref });
    createFlowRequest(form.mobile, { type: 'interior', service: 'Interior & Renovation', customer: { name: form.name }, ticketRef: ref, details: { property: form.location || '', scope: form.scope, rooms: form.config, budget: form.budget, timeline: form.status } });
    draft.clear();
    setDone(true);
  };
  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const Field = ({ label, name, type = 'select', options, placeholder, req, full }) => (
    <div className={full ? 'sm:col-span-2' : ''} data-err={name}>
      <label className="block text-xs font-medium text-gray-300 mb-1.5">{label}{req ? <span className="text-rose-400"> *</span> : null}</label>
      {type === 'select' ? (
        <NativeSelect value={form[name]} onChange={(e) => { set(name, e.target.value); err.clear(name); }} className="field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm" invalid={err.has(name)}>
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </NativeSelect>
      ) : (
        <input value={form[name]} onChange={(e) => { set(name, e.target.value); err.clear(name); }} placeholder={placeholder} className={'field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500' + err.cx(name)} />
      )}
      <FieldError show={err.has(name)}>{err.msg(name)}</FieldError>
    </div>
  );

  return (
    <div ref={rootRef}>
      <div>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1600&q=80')" }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(120deg,rgba(15,13,26,.96) 0%,rgba(15,13,26,.82) 45%,rgba(13,148,136,.45) 100%)' }} />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
            <div className="max-w-2xl reveal">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-xs text-teal-200 font-medium mb-5"><Icon name="sparkles" className="w-3.5 h-3.5" /> {tr('services.interior.heroBadge')}</span>
              <h1 className="text-4xl sm:text-6xl font-extrabold text-white leading-[1.05]">{tr('services.interior.heroTitle1')}<br /><span className="gradient-text">{tr('services.interior.heroTitleAccent')}</span></h1>
              <p className="text-gray-200 text-base sm:text-lg mt-5 max-w-xl">{tr('services.interior.heroSubtitle')}</p>
              <div className="flex flex-col sm:flex-row gap-3 mt-8">
                <button onClick={scrollToForm} className="btn btn-primary btn-lg min-w-[220px]"><Icon name="calendar-heart" className="w-4 h-4" /> {tr('services.interior.bookConsult')}</button>
                <a href="#gallery" className="min-w-[220px] px-6 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-semibold hover:bg-white/15 inline-flex items-center justify-center gap-2 transition-all"><Icon name="image" className="w-4 h-4" /> {tr('services.interior.viewWork')}</a>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10">
          <div className="glass-card rounded-2xl p-6 grid grid-cols-2 lg:grid-cols-4 gap-6 reveal">
            {[['2,500+', 'homesDesigned'], ['45', 'daysToMoveIn'], ['10 yr', 'warranty'], ['4.8★', 'customerRating']].map(([v, slug]) => <div key={slug} className="text-center"><p className="text-3xl font-extrabold gradient-text">{v}</p><p className="text-gray-500 text-xs mt-1">{tr('services.interior.stat.' + slug)}</p></div>)}
          </div>
        </section>

        {/* Services */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-y">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.servicesTitle')}</h2><p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{tr('services.interior.servicesSub')}</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SERVICES.map(([t, id, d], i) => (
              <div key={t} className="glass-card rounded-2xl overflow-hidden tile" onClick={() => setLightbox(IMG(id, 1400))}>
                <div className="zoom h-44"><img src={IMG(id)} alt={tr('services.interior.service.' + i + '.name')} className="w-full h-full object-cover" loading="lazy" /></div>
                <div className="p-5"><h3 className="text-white font-bold mb-1.5">{tr('services.interior.service.' + i + '.name')}</h3><p className="text-gray-400 text-sm leading-relaxed">{tr('services.interior.service.' + i + '.desc')}</p></div>
              </div>
            ))}
          </div>
        </section>

        {/* Design styles */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.stylesTitle')}</h2><p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{tr('services.interior.stylesSub')}</p></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {STYLES.map(([t, id], i) => (
              <div key={t} className="zoom tile rounded-2xl relative h-40 sm:h-44" onClick={() => setLightbox(IMG(id, 1400))}>
                <img src={IMG(id)} alt={tr('services.interior.style.' + i)} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,transparent 45%,rgba(8,7,16,.85) 100%)' }} />
                <span className="absolute bottom-3 left-3 text-white font-semibold text-sm">{tr('services.interior.style.' + i)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Before / After */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-8"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.transformTitle')}</h2><p className="text-gray-400 text-sm mt-2">{tr('services.interior.transformSub')}</p></div>
          <div className="ba glass-card reveal">
            <img className="ba-before" src={BEFORE} alt={tr('services.interior.beforeAlt')} />
            <div className="ba-after" style={{ clipPath: `inset(0 ${100 - ba}% 0 0)` }}><img src={AFTER} alt={tr('services.interior.afterAlt')} /></div>
            <span className="ba-tag left-3 text-gray-200">{tr('services.interior.before')}</span>
            <span className="ba-tag right-3 text-teal-300">{tr('services.interior.after')}</span>
            <div className="ba-div" style={{ left: `${ba}%` }}><span className="ba-knob"><Icon name="chevrons-left-right" className="w-5 h-5 text-white" /></span></div>
            <input type="range" min="0" max="100" value={ba} onChange={(e) => setBa(+e.target.value)} className="ba-range" aria-label={tr('services.interior.baSliderAria')} />
          </div>
        </section>

        {/* Project gallery */}
        <section id="gallery" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.projectsTitle')}</h2><p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{tr('services.interior.projectsSub')}</p></div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {PROJECTS.map(([t, id], i) => (
              <div key={t} className="zoom tile rounded-2xl relative h-48 sm:h-60 group" onClick={() => setLightbox(IMG(id, 1400))}>
                <img src={IMG(id)} alt={tr('services.interior.project.' + i)} className="w-full h-full object-cover" loading="lazy" />
                <div className="reveal-on-hover absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: 'linear-gradient(180deg,transparent 40%,rgba(8,7,16,.88) 100%)' }} />
                <div className="reveal-on-hover absolute bottom-0 left-0 right-0 p-4 translate-y-2 opacity-0 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                  <p className="text-white font-semibold text-sm flex items-center gap-2"><Icon name="maximize-2" className="w-4 h-4 text-teal-300" /> {tr('services.interior.project.' + i)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Packages */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.packagesTitle')}</h2><p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{tr('services.interior.packagesSub')}</p></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {PACKAGES.map(([t, p, d, feats, hot], pi) => (
              <div key={t} className={'glass-card rounded-2xl p-6 relative reveal ' + (hot ? 'border-teal-400/40 ring-1 ring-teal-400/30' : '')}>
                {hot ? <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold px-3 py-1 rounded-full bg-gradient-to-r from-teal-500 to-teal-600 text-white">{tr('services.interior.mostPopular')}</span> : null}
                <h3 className="text-white font-bold text-lg">{tr('services.interior.package.' + pi + '.name')}</h3>
                <p className="text-gray-400 text-xs mt-1 mb-4">{tr('services.interior.package.' + pi + '.desc')}</p>
                <p className="mb-5"><span className="text-gray-500 text-sm">{tr('services.interior.priceFrom')} </span><span className="text-3xl font-extrabold gradient-text">₹{p}</span><span className="text-gray-500 text-sm"> {tr('services.interior.perSqft')}</span></p>
                <ul className="space-y-2.5 mb-6">{feats.map((x, fi) => <li key={x} className="flex items-start gap-2.5 text-gray-300 text-sm"><Icon name="check-circle-2" className="w-4 h-4 text-teal-400 mt-0.5 flex-shrink-0" /><span>{tr('services.interior.package.' + pi + '.feats.' + fi)}</span></li>)}</ul>
                <button onClick={scrollToForm} className={(hot ? 'btn-teal text-white' : 'border border-white/10 text-gray-200 hover:bg-white/5') + ' w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all'}><Icon name="calendar-heart" className="w-4 h-4" /> {tr('services.interior.getPackage')}</button>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.howItWorks')}</h2></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5">
            {STEPS.map(([t, ic, d], idx) => (
              <div key={t} className="text-center reveal">
                <div className="relative w-16 h-16 mx-auto mb-4"><div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center"><Icon name={ic} className="w-7 h-7 text-teal-400" /></div></div>
                <h3 className="text-white font-semibold flex items-center justify-center gap-1.5"><span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/25 text-teal-300 text-[11px] font-bold shrink-0">{idx + 1}</span><span>{tr('services.interior.step.' + idx + '.t')}</span></h3><p className="text-gray-500 text-xs mt-1">{tr('services.interior.step.' + idx + '.d')}</p>
              </div>
            ))}
          </div>
        </section>

        <ServiceTracker typeFilter="interior" title={tr('services.interior.trackerTitle')} sampleName={undefined} />

        {/* Book consultation */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            <div className="zoom rounded-2xl relative min-h-[320px] hidden lg:block">
              <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1000&q=80" alt="Designed living room" className="w-full h-full object-cover rounded-2xl" />
              <div className="absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(180deg,transparent 40%,rgba(15,13,26,.85) 100%)' }} />
              <div className="absolute bottom-6 left-6 right-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex items-center gap-1.5 text-xs text-white bg-white/10 border border-white/20 rounded-full px-3 py-1.5"><Icon name="shield-check" className="w-3.5 h-3.5 text-teal-300" /> {tr('services.interior.consultBadge1')}</span>
                  <span className="flex items-center gap-1.5 text-xs text-white bg-white/10 border border-white/20 rounded-full px-3 py-1.5"><Icon name="badge-indian-rupee" className="w-3.5 h-3.5 text-teal-300" /> {tr('services.interior.consultBadge2')}</span>
                </div>
                <p className="text-white font-bold text-lg">{tr('services.interior.consultPromo')}</p>
              </div>
            </div>
            <div ref={formRef} className="glass-card rounded-2xl p-6 sm:p-8">
              {!done ? (
                <>
                  <div className="flex items-center gap-2 mb-1"><Icon name="calendar-heart" className="w-5 h-5 text-teal-400" /><h2 className="text-lg font-bold text-white">{tr('services.interior.bookConsultTitle')}</h2></div>
                  <p className="text-gray-400 text-xs mb-6">{tr('services.interior.bookConsultSub')}</p>
                  <AutosaveBanner restored={draft.restored} onStartFresh={draft.startFresh} />
                  <form onSubmit={submit} noValidate>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.interior.fullName')} <span className="text-rose-400">*</span></label>
                        <input value={form.name} onChange={(e) => { set('name', e.target.value); err.clear('name'); }} placeholder={tr('services.interior.namePlaceholder')} className={'field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500' + err.cx('name')} data-err="name" />
                        <FieldError show={err.has('name')}>{err.msg('name')}</FieldError>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.interior.mobileNumber')} <span className="text-rose-400">*</span></label>
                        <div data-err="mobile"><MobileField value={form.mobile} onChange={(v) => { set('mobile', v); err.clear('mobile'); }} error={err.has('mobile')} /></div>
                        <FieldError show={err.has('mobile')}>{err.msg('mobile')}</FieldError>
                      </div>
                      <Field label={tr('services.interior.scopeLabel')} name="scope" req placeholder={tr('services.interior.scopePlaceholder')} options={['Full Home Interiors', 'Modular Kitchen', 'Wardrobes & Storage', 'Home Renovation', 'Painting & Finishes', 'False Ceiling & Lighting']} />
                      <Field label={tr('services.interior.configLabel')} name="config" options={['1 BHK', '2 BHK', '3 BHK', '4 BHK / Villa']} />
                      <Field label={tr('services.interior.statusLabel')} name="status" options={['Ready to move', 'Under construction', 'Renovating existing home']} />
                      <Field label={tr('services.interior.budgetLabel')} name="budget" options={['Under ₹3 Lakh', '₹3 – 6 Lakh', '₹6 – 10 Lakh', '₹10 Lakh +']} />
                    </div>
                    <div className="mt-4">
                      <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.interior.locationLabel')}</label>
                      <LocalitySelect value={form.location} onChange={(v) => set('location', v)} options={localityNames()} placeholder={tr('services.interior.locationPlaceholder')} ariaLabel={tr('services.interior.locationLabel')} className="w-full" />
                    </div>
                    <button type="submit" className="btn-teal w-full mt-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"><Icon name="send" className="w-4 h-4" /> {tr('services.interior.bookMyConsult')}</button>
                    <p className="text-center text-[11px] text-gray-500 mt-3">{tr('services.interior.consentText')}</p>
                  </form>
                </>
              ) : (
                <div className="text-center py-10">
                  <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4"><Icon name="check" className="w-7 h-7 text-emerald-400" /></div>
                  <h3 className="text-white font-bold text-lg">{tr('services.interior.consultBookedTitle')}</h3>
                  <p className="text-gray-400 text-sm mt-2 max-w-sm mx-auto">{tr('services.interior.consultBookedDesc')}</p>
                  <button onClick={() => setDone(false)} className="mt-5 text-teal-400 text-sm font-medium hover:underline">{tr('services.interior.bookAnother')}</button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Why choose */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.whyTitle')}</h2></div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {TRUST.map(([t, ic, d], i) => (
              <div key={t} className="glass-card rounded-2xl p-5 sm:p-6 reveal"><div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center mb-4"><Icon name={ic} className="w-5 h-5 text-teal-400" /></div><h3 className="text-white font-semibold mb-1.5 text-sm">{tr('services.interior.trust.' + i + '.t')}</h3><p className="text-gray-500 text-xs leading-relaxed">{tr('services.interior.trust.' + i + '.d')}</p></div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.faqTitle')}</h2></div>
          <div className="space-y-3">
            {FAQ.map(([q, a], i) => (
              <div key={q} className={'faq-item glass-card rounded-2xl overflow-hidden ' + (openFaq === i ? 'open' : '')}>
                <button type="button" className="faq-q flex items-center justify-between gap-4 p-5 w-full text-left" onClick={() => setOpenFaq(openFaq === i ? -1 : i)} aria-expanded={openFaq === i}><span className="text-white font-medium text-sm">{tr('services.interior.faq.' + i + '.q')}</span><Icon name="chevron-down" className="faq-chev w-5 h-5 text-teal-400 flex-shrink-0" /></button>
                <div className="faq-a"><p className="px-5 pb-5 text-gray-400 text-sm leading-relaxed">{tr('services.interior.faq.' + i + '.a')}</p></div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="rounded-2xl p-8 sm:p-12 text-center relative overflow-hidden reveal">
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=1400&q=80')" }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(120deg,rgba(15,13,26,.94),rgba(49,46,129,.7),rgba(13,148,136,.55))' }} />
            <div className="relative">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.interior.ctaTitle')}</h2>
              <p className="text-gray-200 mt-3 mb-7">{tr('services.interior.ctaSub')}</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={scrollToForm} className="btn-teal px-6 py-3.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2"><Icon name="calendar-heart" className="w-4 h-4" /> {tr('services.interior.ctaBook')}</button>
                <a href="tel:18002000000" className="px-6 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white text-sm font-semibold hover:bg-white/15 inline-flex items-center justify-center gap-2 transition-all"><Icon name="phone" className="w-4 h-4" /> {tr('services.interior.ctaCall')}</a>
              </div>
            </div>
          </div>
        </section>
      </div>

      {lightbox ? (
        /* 1500 = the "blocking modals" rung. This was an ad-hoc 2000, which put it
           above the toast layer (1600), so a confirmation fired while the lightbox
           was open would have been painted behind it. See the ladder in index.css. */
        <div className="fixed inset-0 z-[1500] flex items-center justify-center p-6" style={{ background: 'rgba(8,7,16,.92)', backdropFilter: 'blur(8px)' }} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt={tr('services.interior.lightboxAlt')} className="rounded-2xl" style={{ maxWidth: '92vw', maxHeight: '86vh', boxShadow: '0 24px 80px rgba(0,0,0,.6)' }} />
        </div>
      ) : null}
    </div>
  );
}

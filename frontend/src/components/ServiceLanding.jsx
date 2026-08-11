import NativeSelect from './ui/NativeSelect.jsx';
import LocalitySelect from './ui/LocalitySelect.jsx';
import { localityNames } from '../data/localities.js';
import FieldError from './ui/FieldError.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import Icon from './Icon.jsx';
import MobileField from './MobileField.jsx';
import { useScrollReveal } from '../lib/useScrollReveal.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { createServiceRequest } from '../lib/mockApi.js';
// Flow request creation crosses the seam (mock or live per VITE_API_DOMAINS); the ops lead ticket
// (`createServiceRequest` from mockApi) stays a separate, synchronous mock system.
import { createServiceRequest as createFlowRequest } from '../services/serviceRequestService.js';
import ServiceTracker from './ServiceTracker.jsx';
import AutosaveBanner from './AutosaveBanner.jsx';
import { useFormDraft, useFieldErrors } from '../lib/hooks.js';
import { srcSetFor } from '../lib/imgSrcSet.js';

/* The hero is full-bleed, so it needs a wider candidate ladder than imgSrcSet's
   card default (which tops out at 960w) — the largest entry matches the 1600px
   source every caller passes, so desktop quality is unchanged while a phone
   fetches ~640w instead of the full 1.26 MB asset. */
const HERO_WIDTHS = [640, 960, 1280, 1600];

/* Shared shell for the service landing pages (packers, legal, home-loans, interior, valuation).
   Faithful to the prototype's per-service pages: hero + quick-quote form, stats, services grid,
   why-choose, how-it-works, FAQ accordion and CTA. The quote form creates an ops ticket. */
export default function ServiceLanding({
  team, heroGradient = 'linear-gradient(140deg,#0a1120 0%,#0c2321 52%,#0e332f 100%)',
  heroImage, heroOverlay = 'linear-gradient(140deg,rgba(10,17,32,.93) 0%,rgba(12,35,33,.87) 52%,rgba(14,51,47,.9) 100%)',
  badge, badgeIcon = 'badge-check', titleTop, titleAccent, subtitle,
  features = [], quote, stats = [], services = [], trust = [], steps = [], faqs = [],
  cta, extra, flowType, trackerTitle, draftKey,
}) {
  const rootRef = useScrollReveal();
  const { user, isIn } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const formRef = useRef(null);

  const initial = { name: isIn ? user?.name || '' : '', mobile: isIn ? user?.mobile || '' : '' };
  (quote?.fields || []).forEach((f) => { initial[f.name] = f.value || ''; });
  const [form, setForm] = useState(initial);
  const [done, setDone] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  // Never autosave contact PII to localStorage — matches the ignore list every service page uses,
  // so name/mobile are not left at rest on a shared device.
  const draft = useFormDraft(draftKey || 'pnDraft:service', form, setForm, { enabled: !!draftKey, ignore: ['name', 'mobile'] });
  const err = useFieldErrors(formRef);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Apply field default/prefill values (e.g. from ?type=/?scope=/?service= query params that
  // resolve after mount) without clobbering anything the user has already entered.
  const fieldDefaults = (quote?.fields || []).map((f) => f.value || '').join('|');
  useEffect(() => {
    const flds = quote?.fields || [];
    setForm((p) => {
      let changed = false;
      const next = { ...p };
      flds.forEach((f) => { if (f.value && !p[f.name]) { next[f.name] = f.value; changed = true; } });
      return changed ? next : p;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldDefaults]);

  const submit = (e) => {
    e.preventDefault();
    // Page is public; enforce sign-in only when the visitor actually uses the service.
    // Their input is preserved via the autosave draft and restored after they return.
    if (!isIn) { navigate(`/signin?reason=service&next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    const reqd = (quote?.fields || []).find((f) => f.required && !form[f.name]);
    const ok = err.check([
      { name: 'name', ok: !!form.name.trim(), msg: 'Please enter your name.' },
      { name: 'mobile', ok: /^[6-9]\d{9}$/.test((form.mobile || '').replace(/\D/g, '')), msg: 'Enter a valid 10-digit mobile number.' },
      ...(reqd ? [{ name: reqd.name, ok: false, msg: `Please fill: ${reqd.label}` }] : []),
    ], toast);
    if (!ok) return;
    const detail = (quote?.fields || []).filter((f) => form[f.name]).map((f) => `${f.label}: ${form[f.name]}`).join(' · ');
    // For services with an ops workflow, link the admin ticket and the ops flow via one
    // shared ref so ops progress mirrors onto the admin ticket (via syncServiceTicket) —
    // no more phantom "new" leads. syncServiceTicket no-ops for unlinked (flow-less) tickets.
    const ref = flowType ? 'TR' + Date.now() + Math.floor(Math.random() * 1000) : null;
    createServiceRequest({ team, service: form[quote?.serviceField] || quote?.title || 'Service request', customer: form.name, mobile: form.mobile, detail, ...(ref ? { ref } : {}) });
    if (flowType) {
      // Identity is the session (the page is sign-in gated above), so the mobile is no longer passed.
      // Optimistic: the UI proceeds regardless, matching the mock's synchronous behaviour; a live POST
      // failure is swallowed rather than blocking the confirmation the lead ticket already earned.
      createFlowRequest({ type: flowType, service: form[quote?.serviceField] || quote?.title || 'Service request', customer: { name: form.name }, ticketRef: ref, details: (quote?.fields || []).filter((f) => form[f.name]).reduce((o, f) => { o[f.name] = form[f.name]; return o; }, {}) }).catch(() => {});
    }
    draft.clear();
    setDone(true);
  };

  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <div ref={rootRef}>
      <div>
        {/* Hero + quote */}
        <section className="relative overflow-hidden" style={{ background: heroGradient }}>
          {/* A real <img> rather than a background div so srcSetFor actually applies (a srcset has
              no effect on a CSS background). absolute inset-0 + object-cover/center reproduces the
              previous `bg-cover bg-center` exactly, and keeps the hero out of layout flow so it
              cannot shift anything. Decorative — the headline below carries the meaning. */}
          {heroImage && (
            <img
              src={heroImage} srcSet={srcSetFor(heroImage, HERO_WIDTHS)} sizes="100vw"
              alt="" width={1600} height={900} fetchPriority="high" decoding="async"
              className="absolute inset-0 w-full h-full object-cover object-center"
            />
          )}
          {heroImage && <div className="absolute inset-0" style={{ background: heroOverlay }} />}
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 18% 30%,rgba(255,255,255,.3) 0,transparent 40%),radial-gradient(circle at 85% 70%,rgba(20,184,166,.5) 0,transparent 42%)' }} />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="reveal">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs text-teal-200 font-medium mb-5"><Icon name={badgeIcon} className="w-3.5 h-3.5" /> {badge}</span>
              <h1 className="text-3xl sm:text-5xl font-extrabold text-white leading-tight">{titleTop}<br /><span className="gradient-text">{titleAccent}</span></h1>
              <p className="text-gray-200 text-base sm:text-lg mt-5 max-w-xl">{subtitle}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-3 mt-7">
                {features.map(([ic, label]) => (
                  <span key={label} className="flex items-center gap-2 text-sm text-gray-100"><Icon name={ic} className="w-4 h-4 text-teal-300" /> {label}</span>
                ))}
              </div>
            </div>

            {/* Quick quote form */}
            <div ref={formRef} id="quote" className="glass-card svc-quote rounded-2xl p-6 sm:p-7 reveal">
              {!done ? (
                <>
                  <div className="flex items-center gap-2 mb-1"><Icon name={quote?.icon || 'send'} className="w-5 h-5 text-teal-400" /><h2 className="text-lg font-bold text-white">{quote?.title || 'Get a Free Quote'}</h2></div>
                  <p className="text-gray-400 text-xs mb-5">{quote?.subtitle || "Fill in a few details — we'll call you back within 24 hours."}</p>
                  <AutosaveBanner restored={draft.restored} onStartFresh={draft.startFresh} />
                  <form onSubmit={submit} className="space-y-4" noValidate>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">Full Name <span className="text-rose-400">*</span></label>
                        <input value={form.name} onChange={(e) => { set('name', e.target.value); err.clear('name'); }} placeholder="Your name" className={'field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500' + err.cx('name')} data-err="name" />
                        <FieldError show={err.has('name')}>{err.msg('name')}</FieldError>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">Mobile Number <span className="text-rose-400">*</span></label>
                        <div data-err="mobile"><MobileField value={form.mobile} onChange={(v) => { set('mobile', v); err.clear('mobile'); }} error={err.has('mobile')} /></div>
                        <FieldError show={err.has('mobile')}>{err.msg('mobile')}</FieldError>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {(quote?.fields || []).map((f) => (
                        <div key={f.name} className={f.full ? 'sm:col-span-2' : ''} data-err={f.name}>
                          <label className="block text-xs font-medium text-gray-300 mb-1.5">{f.label}{f.required ? <span className="text-rose-400"> *</span> : null}</label>
                          {f.type === 'select' ? (
                            <NativeSelect value={form[f.name]} onChange={(e) => { set(f.name, e.target.value); err.clear(f.name); }} className="field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm" invalid={err.has(f.name)}>
                              <option value="">{f.placeholder || 'Select'}</option>
                              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </NativeSelect>
                          ) : f.type === 'locality' ? (
                            <LocalitySelect value={form[f.name]} onChange={(v) => { set(f.name, v); err.clear(f.name); }} options={localityNames()} unrestricted={f.unrestricted} placeholder={f.placeholder || 'Select locality'} ariaLabel={f.label} dataErr={f.name} invalid={err.has(f.name)} className="w-full" />
                          ) : f.type === 'textarea' ? (
                            <textarea rows={2} value={form[f.name]} onChange={(e) => { set(f.name, e.target.value); err.clear(f.name); }} placeholder={f.placeholder} className={'field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 resize-none' + err.cx(f.name)} />
                          ) : f.type === 'money' ? (
                            <input type="text" inputMode="numeric" value={form[f.name]} onChange={(e) => { const raw = e.target.value.replace(/[^\d]/g, ''); const formatted = raw ? raw.replace(/\B(?=(\d{2})+(\d)(?!\d))/g, ',') : ''; set(f.name, formatted); err.clear(f.name); }} placeholder={f.placeholder} className={'field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500' + err.cx(f.name)} />
                          ) : (
                            <input type={f.type || 'text'} value={form[f.name]} onChange={(e) => { set(f.name, e.target.value); err.clear(f.name); }} placeholder={f.placeholder} className={'field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500' + err.cx(f.name)} />
                          )}
                          <FieldError show={err.has(f.name)}>{err.msg(f.name)}</FieldError>
                        </div>
                      ))}
                    </div>
                    <button type="submit" className="btn-teal w-full py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"><Icon name="send" className="w-4 h-4" /> {quote?.submitLabel || 'Request Free Quote'}</button>
                    <p className="text-center text-[11px] text-gray-500">By submitting, you agree to be contacted by PuneNest &amp; its verified partners.</p>
                  </form>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4"><Icon name="check" className="w-7 h-7 text-emerald-400" /></div>
                  <h3 className="text-white font-bold text-lg">Request received!</h3>
                  <p className="text-gray-400 text-sm mt-2 max-w-xs mx-auto">{quote?.successMessage || <>Our team will call you back within <span className="text-teal-400 font-semibold">24 hours</span>. Your request is queued with our verified partners.</>}</p>
                  <button onClick={() => { setDone(false); setForm(initial); }} className="mt-5 text-teal-400 text-sm font-medium hover:underline">Submit another request</button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Stats */}
        {flowType ? <ServiceTracker typeFilter={flowType} title={trackerTitle || 'Your requests'} sampleName={undefined} /> : null}
        {stats.length ? (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-10">
            <div className="glass-card rounded-2xl p-6 grid grid-cols-2 lg:grid-cols-4 gap-6 reveal">
              {stats.map(([v, l]) => <div key={l} className="text-center"><p className="text-3xl font-extrabold gradient-text">{v}</p><p className="text-gray-500 text-xs mt-1">{l}</p></div>)}
            </div>
          </section>
        ) : null}

        {/* Why choose */}
        {services.length ? (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-y">
            <div className="text-center mb-6 sm:mb-10 reveal">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">{quote?.servicesHeading || 'Our Services'}</h2>
              {quote?.servicesSub ? <p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{quote.servicesSub}</p> : null}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {services.map(([t, ic, d]) => (
                <div key={t} className="svc rounded-2xl p-5 sm:p-6 reveal">
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center mb-3 sm:mb-4"><Icon name={ic} className="w-5 h-5 sm:w-6 sm:h-6 text-teal-400" /></div>
                  <h3 className="text-white font-bold mb-2">{t}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{d}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {extra}

        {/* Why choose */}
        {trust.length ? (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
            <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{quote?.trustHeading || 'Why choose PuneNest'}</h2></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {trust.map(([t, ic, d]) => (
                <div key={t} className="glass-card rounded-2xl p-5 sm:p-6 reveal">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center mb-4"><Icon name={ic} className="w-5 h-5 text-teal-400" /></div>
                  <h3 className="text-white font-semibold mb-1.5 text-sm">{t}</h3>
                  <p className="text-gray-500 text-xs leading-relaxed">{d}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* How it works */}
        {steps.length ? (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
            <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">How it works</h2></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5">
              {steps.map(([t, ic, d], idx) => (
                <div key={t} className="text-center reveal">
                  <div className="relative w-16 h-16 mx-auto mb-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center"><Icon name={ic} className="w-7 h-7 text-teal-400" /></div>
                  </div>
                  <h3 className="text-white font-semibold flex items-center justify-center gap-1.5"><span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/25 text-teal-300 text-[11px] font-bold shrink-0">{idx + 1}</span><span>{t}</span></h3>
                  <p className="text-gray-500 text-xs mt-1">{d}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* FAQ */}
        {faqs.length ? (
          <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
            <div className="text-center mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">Frequently asked questions</h2></div>
            <div className="space-y-3">
              {faqs.map(([q, a], i) => (
                <div key={q} className={'faq-item glass-card rounded-2xl overflow-hidden ' + (openFaq === i ? 'open' : '')}>
                  <button type="button" className="faq-q flex items-center justify-between gap-4 p-5 w-full text-left" onClick={() => setOpenFaq(openFaq === i ? -1 : i)} aria-expanded={openFaq === i}>
                    <span className="text-white font-medium text-sm">{q}</span>
                    <Icon name="chevron-down" className="faq-chev w-5 h-5 text-teal-400 flex-shrink-0" />
                  </button>
                  <div className="faq-a"><p className="px-5 pb-5 text-gray-400 text-sm leading-relaxed">{a}</p></div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* CTA */}
        {cta ? (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
            <div className="glass-card rounded-2xl p-8 sm:p-12 text-center relative overflow-hidden reveal">
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%,#14b8a6 0,transparent 40%),radial-gradient(circle at 70% 50%,#0d9488 0,transparent 40%)' }} />
              <div className="relative">
                <h2 className="text-2xl sm:text-3xl font-bold text-white">{cta.title}</h2>
                <p className="text-gray-400 mt-3 mb-7">{cta.sub}</p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button onClick={scrollToForm} className="btn-teal px-6 py-3.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2"><Icon name={cta.icon || 'send'} className="w-4 h-4" /> {cta.primary}</button>
                  {cta.phone ? <a href={`tel:${cta.phone.replace(/\s/g, '')}`} className="px-6 py-3.5 rounded-xl border border-white/10 text-gray-200 text-sm font-semibold hover:bg-white/5 inline-flex items-center justify-center gap-2"><Icon name="phone" className="w-4 h-4" /> Call {cta.phone}</a> : null}
                  {cta.link ? <Link to={cta.link} className="px-6 py-3.5 rounded-xl border border-white/10 text-gray-200 text-sm font-semibold hover:bg-white/5 inline-flex items-center justify-center gap-2">{cta.linkLabel}</Link> : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

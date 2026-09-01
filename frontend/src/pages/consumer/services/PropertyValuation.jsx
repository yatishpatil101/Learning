import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { localityNames } from '../../../data/localities.js';
import MobileField from '../../../components/MobileField.jsx';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import ServiceTracker from '../../../components/ServiceTracker.jsx';
import { createServiceRequest as createFlowRequest } from '../../../services/serviceRequestService.js';
import AutosaveBanner from '../../../components/AutosaveBanner.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import { useFormDraft, useFieldErrors } from '../../../lib/hooks.js';

const RATES= { 'Koregaon Park': 16500, 'Kalyani Nagar': 15500, Kothrud: 13000, 'Viman Nagar': 12500, Baner: 11500, Aundh: 12000, Kharadi: 10500, Wakad: 9200, Hadapsar: 8800, Hinjawadi: 8200, Wagholi: 6800, Undri: 7200, Ravet: 7800 };
const YOY = { 'Koregaon Park': 6.2, 'Kalyani Nagar': 6.8, Kothrud: 7.1, 'Viman Nagar': 7.5, Baner: 8.4, Aundh: 7.8, Kharadi: 9.6, Wakad: 8.9, Hadapsar: 7.2, Hinjawadi: 9.2, Wagholi: 10.1, Undri: 8.0, Ravet: 9.4 };
// City-average fallbacks so the estimator still returns an indicative figure for
// any Pune locality (curated or user-minted) that has no hand-tuned rate/YoY.
const PUNE_AVG_RATE = Math.round(Object.values(RATES).reduce((a, b) => a + b, 0) / Object.values(RATES).length);
const PUNE_AVG_YOY = +(Object.values(YOY).reduce((a, b) => a + b, 0) / Object.values(YOY).length).toFixed(1);
const fmtShort = (n) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : '₹' + (n / 1e5).toFixed(1) + ' L');
const TREND = Object.keys(RATES).map((k) => ({ k, rate: RATES[k], yoy: YOY[k] })).sort((a, b) => b.yoy - a.yoy);

const SERVICES = [
  ['Market Value Estimate', 'line-chart', 'A fair, current market value based on recent sale comparables in your micro-market.'],
  ['Bank / Mortgage Valuation', 'landmark', 'Lender-accepted valuation for home loans, balance transfers and top-ups.'],
  ['Capital Gains / Tax', 'receipt-indian-rupee', 'Fair-market-value & indexation reports for capital gains and income-tax filing.'],
  ['Legal / Dispute Valuation', 'scale', 'Defensible valuations for court cases, partition, divorce and probate matters.'],
  ['Insurance Valuation', 'shield', 'Reinstatement-cost assessment so your property cover is neither short nor excess.'],
  ['Pre-sale Pricing Advisory', 'tag', 'Price your home right to sell faster — backed by demand and comparable data.'],
];
const FACTORS = [['Location & locality', 'map-pin'], ['Carpet area & layout', 'ruler'], ['Property age & condition', 'calendar-clock'], ['Floor, view & facing', 'building'], ['Amenities & parking', 'dumbbell'], ['Construction quality', 'hard-hat'], ['Demand & recent deals', 'trending-up']];
const STEPS = [['Share Details', 'clipboard-list', 'Try the instant estimate, then request a certified report in a minute.'], ['Site Inspection', 'home', 'An IBBI valuer visits to verify area, condition, amenities and surroundings.'], ['Data Analysis', 'line-chart', 'We benchmark against recent comparable deals and ready-reckoner rates.'], ['Certified Report', 'file-badge', 'You receive a signed, bank- & court-accepted valuation report.']];
const TRUST = [['IBBI Certified', 'badge-check', 'Reports are signed by registered valuers and accepted by banks, courts & tax authorities.'], ['Data-backed', 'database', 'Valuations use real recent comparables and ready-reckoner rates — not gut feel.'], ['Fast Turnaround', 'timer', 'Most certified reports are ready within 48 hours of the site inspection.'], ['Transparent Fees', 'indian-rupee', 'A clear, fixed valuation fee shared upfront before we begin.']];
const FAQ = [
  ['Is the instant estimate accurate?', "It's a free, indicative range from current locality rates and your inputs — great for a quick idea. For an exact, official figure you need a certified valuation with a physical inspection."],
  ['What is a certified valuation report?', "A signed report by an IBBI-registered valuer detailing the property's fair market value with methodology and comparables — accepted by banks, courts and tax authorities."],
  ['How is property value calculated?', 'Mainly the comparable-sales method (recent deals nearby) cross-checked with ready-reckoner rates, adjusted for area, age, floor, amenities and condition.'],
  ['How long does it take and what does it cost?', 'A certified report is typically ready within 48 hours of inspection. Fees are fixed and shared upfront — the instant online estimate is always free.'],
  ['Will banks accept this valuation?', 'Yes — our valuers are IBBI-registered and on major bank panels, so reports are accepted for home loans and mortgages.'],
];

export default function PropertyValuation() {
  const { t: tr } = useTranslation();
  const rootRef = useScrollReveal();
  const { user, isIn } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const formRef = useRef(null);
  const [loc, setLoc] = useState('Baner');
  const [type, setType] = useState('1');
  const [area, setArea] = useState(850);
  const [age, setAge] = useState('1');
  const [floor, setFloor] = useState('1');
  const [openFaq, setOpenFaq] = useState(-1);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ name: isIn ? user?.name || '' : '', mobile: isIn ? user?.mobile || '' : '', purpose: '', ptype: 'Flat', location: '', area: '' });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const draft = useFormDraft('dzDraft:property-valuation', form, setForm, { ignore: ['name', 'mobile', 'ptype'] });
  const err = useFieldErrors(formRef);

  // Every Pune locality (curated registry + user-minted community ones) is
  // selectable; the 13 with hand-tuned rates lead, the rest use the city avg.
  const locOptions = useMemo(() => {
    const known = Object.keys(RATES);
    const knownLower = new Set(known.map((k) => k.toLowerCase()));
    const rest = localityNames().filter((n) => !knownLower.has(n.toLowerCase())).sort((a, b) => a.localeCompare(b));
    return known.concat(rest);
  }, []);

  const est = useMemo(() => {
    const known = RATES[loc] != null;
    const base = known ? RATES[loc] : PUNE_AVG_RATE;
    const typeM = +type;
    const ageM = +age;
    const floorM = type === '0.55' ? 1 : +floor;
    const a = Math.max(+area || 0, 0);
    const rate = base * typeM * ageM * floorM * 1.15;
    const mid = rate * a;
    if (!a) return null;
    const yoy = YOY[loc] ?? PUNE_AVG_YOY;
    const comps = Math.min(180, 24 + Math.round(a / 40) + Math.round(base / 1000));
    let conf = 92;
    if (a < 400 || a > 3000) conf -= 12;
    if (ageM < 0.9) conf -= 3;
    if (!known) conf -= 8;
    conf = Math.max(72, Math.min(95, conf));
    return { range: `${fmtShort(mid * 0.93)}  –  ${fmtShort(mid * 1.07)}`, rateValue: Math.round(rate).toLocaleString('en-IN'), known, loc, conf: conf + '%', comps, trend: '+' + yoy.toFixed(1) + '%' };
  }, [loc, type, area, age, floor]);

  const submit = (e) => {
    e.preventDefault();
    // Instant estimate is public; the certified report requires sign-in (draft is restored on return).
    if (!isIn) { navigate(`/signin?reason=service&next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    const ok = err.check([
      { name: 'name', ok: !!form.name.trim(), msg: tr('services.valuation.errName') },
      { name: 'mobile', ok: /^[6-9]\d{9}$/.test((form.mobile || '').replace(/\D/g, '')), msg: tr('services.valuation.errMobile') },
      { name: 'purpose', ok: !!form.purpose, msg: tr('services.valuation.errPurpose') },
    ], toast);
    if (!ok) return;
    /* One write, not two — see the note in InteriorRenovation.jsx. The mock ticket went to browser
       storage no operator can read, while the service request reaches the ops queue; keeping both
       meant two records of one lead with nothing reconciling them. The contact fields move into
       `details`, which `toCreate` passes through untouched, because the ticket was the only thing
       carrying them and the form asks who to call about this valuation rather than who owns the
       account. */
    createFlowRequest({
      type: 'valuation',
      service: 'Property Valuation',
      customer: { name: form.name },
      details: {
        property: form.location || '',
        ptype: form.ptype,
        area: form.area ? form.area + ' sq.ft' : '',
        purpose: form.purpose,
        contactName: form.name,
        contactMobile: form.mobile,
      },
    }).catch(() => {});
    draft.clear();
    setDone(true);
  };
  const scrollToForm = () => {
    // Carry the instant-estimate inputs into the certified-report lead so the
    // customer doesn't re-enter locality/area (fill only empty fields).
    setForm((p) => ({ ...p, location: p.location || loc, area: p.area || String(area || '') }));
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const sel = 'field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm';

  return (
    <div ref={rootRef}>
      <div>
        {/* Hero + estimate. A dark, valuation-specific gradient (deep emerald/graphite)
            keeps the estimator card and its select options legible — the old bright-teal
            --hero-gradient washed the translucent controls out. */}
        <section className="relative overflow-hidden" style={{ background: 'linear-gradient(140deg,#0a1120 0%,#0d2b24 55%,#0f3d31 100%)' }}>
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1600&q=80')" }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(140deg,rgba(10,17,32,.93) 0%,rgba(13,43,36,.9) 55%,rgba(15,61,49,.92) 100%)' }} />
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 18% 30%,rgba(255,255,255,.3) 0,transparent 40%),radial-gradient(circle at 85% 70%,rgba(20,184,166,.5) 0,transparent 42%)' }} />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="reveal">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs text-teal-200 font-medium mb-5"><Icon name="trending-up" className="w-3.5 h-3.5" /> {tr('services.valuation.heroBadge')}</span>
              <h1 className="text-3xl sm:text-5xl font-extrabold text-white leading-tight">{tr('services.valuation.heroTitle1')}<br /><span className="gradient-text">{tr('services.valuation.heroTitleAccent')}</span></h1>
              <p className="text-gray-200 text-base sm:text-lg mt-5 max-w-xl">{tr('services.valuation.heroSubtitle')}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-3 mt-7">
                <span className="flex items-center gap-2 text-sm text-gray-100"><Icon name="zap" className="w-4 h-4 text-teal-300" /> {tr('services.valuation.heroChip1')}</span>
                <span className="flex items-center gap-2 text-sm text-gray-100"><Icon name="file-badge" className="w-4 h-4 text-teal-300" /> {tr('services.valuation.heroChip2')}</span>
                <span className="flex items-center gap-2 text-sm text-gray-100"><Icon name="map-pinned" className="w-4 h-4 text-teal-300" /> {tr('services.valuation.heroChip3')}</span>
              </div>
            </div>

            {/* Estimate widget */}
            <div className="glass-card svc-quote rounded-2xl p-6 sm:p-7 reveal">
              <div className="flex items-center gap-2 mb-1"><Icon name="calculator" className="w-5 h-5 text-teal-400" /><h2 className="text-lg font-bold text-white">{tr('services.valuation.widgetTitle')}</h2></div>
              <p className="text-gray-400 text-xs mb-5">{tr('services.valuation.widgetSub')}</p>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.locality')}</label>
                    <NativeSelect value={loc} onChange={(e) => setLoc(e.target.value)} className={sel}>{locOptions.map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.propertyType')}</label>
                    <NativeSelect value={type} onChange={(e) => setType(e.target.value)} className={sel}><option value="1">{tr('services.valuation.typeFlat')}</option><option value="1.18">{tr('services.valuation.typeVilla')}</option><option value="0.55">{tr('services.valuation.typePlot')}</option></NativeSelect>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-300">{tr('services.valuation.carpetArea')}</label>
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1">
                      <input type="number" value={area} onChange={(e) => setArea(e.target.value)} className="field w-16 !bg-transparent text-right text-white text-sm font-semibold focus:outline-none" />
                      <span className="text-teal-400 text-xs">{tr('services.valuation.sqft')}</span>
                    </div>
                  </div>
                  <input type="range" min="200" max="5000" step="25" value={area} onChange={(e) => setArea(e.target.value)} className="w-full accent-teal-400" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.propertyAge')}</label>
                    <NativeSelect value={age} onChange={(e) => setAge(e.target.value)} className={sel}><option value="1.05">{tr('services.valuation.ageNew')}</option><option value="1">{tr('services.valuation.age0_5')}</option><option value="0.92">{tr('services.valuation.age5_10')}</option><option value="0.82">{tr('services.valuation.age10plus')}</option></NativeSelect>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.floorPosition')}</label>
                    <NativeSelect value={floor} onChange={(e) => setFloor(e.target.value)} disabled={type === '0.55'} className={sel + (type === '0.55' ? ' opacity-50' : '')}><option value="0.98">{tr('services.valuation.floorGround')}</option><option value="1">{tr('services.valuation.floorMid')}</option><option value="1.05">{tr('services.valuation.floorHigh')}</option><option value="1.1">{tr('services.valuation.floorTop')}</option></NativeSelect>
                  </div>
                </div>

                <div className="mt-1 rounded-xl bg-teal-500/8 border border-teal-400/20 p-5 text-center">
                  <p className="text-xs text-gray-400 mb-1 flex items-center justify-center gap-1.5"><span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider text-teal-200 bg-teal-500/25"><Icon name="sparkles" className="w-2.5 h-2.5" /> AI</span> {tr('services.valuation.aiEstLabel')}</p>
                  <p className="text-2xl font-extrabold gradient-text">{est ? est.range : '—'}</p>
                  <p className="text-[11px] text-gray-500 mt-1.5">{est ? tr(est.known ? 'services.valuation.rateBasedComparables' : 'services.valuation.rateBasedCityAvg', { rate: est.rateValue, comps: est.comps, loc: est.loc }) : '—'}</p>
                  <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-[10px] text-gray-500">{tr('services.valuation.confidence')}</p><p className="text-sm font-bold text-teal-300">{est ? est.conf : '—'}</p></div>
                    <div><p className="text-[10px] text-gray-500">{tr('services.valuation.comparables')}</p><p className="text-sm font-bold text-white">{est ? est.comps : '—'}</p></div>
                    <div><p className="text-[10px] text-gray-500">{tr('services.valuation.trendYoY')}</p><p className="text-sm font-bold text-emerald-300">{est ? est.trend : '—'}</p></div>
                  </div>
                </div>
                <button onClick={scrollToForm} className="btn-teal w-full py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"><Icon name="file-badge" className="w-4 h-4" /> {tr('services.valuation.getCertified')}</button>
                <p className="text-center text-[11px] text-gray-500">{tr('services.valuation.indicativeOnly')}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-10">
          <div className="glass-card rounded-2xl p-6 grid grid-cols-2 lg:grid-cols-4 gap-6 reveal">
            {[['20K+', 'valuationsDone'], ['150+', 'puneLocalities'], ['48 hrs', 'reportTurnaround'], ['IBBI', 'certifiedValuers']].map(([v, slug]) => <div key={slug} className="text-center"><p className="text-3xl font-extrabold gradient-text">{v}</p><p className="text-gray-500 text-xs mt-1">{tr('services.valuation.stat.' + slug)}</p></div>)}
          </div>
        </section>

        {/* Locality price-trend strip — the valuation page's signature data touch */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-y">
          <div className="text-center mb-8 reveal">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.valuation.trend.title')}</h2>
            <p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{tr('services.valuation.trend.sub')}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 reveal">
            {TREND.map(({ k, rate, yoy }) => (
              <div key={k} className="rounded-xl bg-white/[.03] p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white text-sm font-semibold truncate">{k}</p>
                  <p className="text-gray-500 text-xs mt-0.5">₹{rate.toLocaleString('en-IN')}<span className="text-[10px]"> {tr('services.valuation.trend.perSqft')}</span></p>
                </div>
                <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-bold text-emerald-400"><Icon name="trending-up" className="w-3.5 h-3.5" />{yoy}%</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-4 text-center reveal">{tr('services.valuation.trend.note')}</p>
        </section>

        {/* Services */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-y">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.valuation.servicesTitle')}</h2><p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{tr('services.valuation.servicesSub')}</p></div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {SERVICES.map(([t, ic, d], i) => (
              <div key={t} className="svc rounded-2xl p-5 sm:p-6 reveal"><div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center mb-3 sm:mb-4"><Icon name={ic} className="w-5 h-5 sm:w-6 sm:h-6 text-teal-400" /></div><h3 className="text-white font-bold mb-2">{tr('services.valuation.service.' + i + '.name')}</h3><p className="text-gray-400 text-sm leading-relaxed">{tr('services.valuation.service.' + i + '.desc')}</p></div>
            ))}
          </div>
        </section>

        {/* Report form + factors */}
        <ServiceTracker typeFilter="valuation" title={tr('services.valuation.trackerTitle')} />
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
            <div ref={formRef} className="glass-card rounded-2xl p-6 sm:p-8">
              {!done ? (
                <>
                  <div className="flex items-center gap-2 mb-1"><Icon name="file-badge" className="w-5 h-5 text-teal-400" /><h2 className="text-lg font-bold text-white">{tr('services.valuation.formTitle')}</h2></div>
                  <p className="text-gray-400 text-xs mb-6">{tr('services.valuation.formSub')}</p>
                  <AutosaveBanner restored={draft.restored} onStartFresh={draft.startFresh} />
                  <form onSubmit={submit} noValidate>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.fullName')} <span className="text-rose-400">*</span></label>
                        <input value={form.name} onChange={(e) => { set('name', e.target.value); err.clear('name'); }} placeholder={tr('services.valuation.namePlaceholder')} className={'field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500' + err.cx('name')} data-err="name" />
                        <FieldError show={err.has('name')}>{err.msg('name')}</FieldError>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.mobileNumber')} <span className="text-rose-400">*</span></label>
                        <div data-err="mobile"><MobileField value={form.mobile} onChange={(v) => { set('mobile', v); err.clear('mobile'); }} error={err.has('mobile')} /></div>
                        <FieldError show={err.has('mobile')}>{err.msg('mobile')}</FieldError>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.purpose')} <span className="text-rose-400">*</span></label>
                        <NativeSelect value={form.purpose} onChange={(e) => { set('purpose', e.target.value); err.clear('purpose'); }} className={sel} invalid={err.has('purpose')} dataErr="purpose"><option value="">{tr('services.valuation.purposePlaceholder')}</option>{['Sale / Purchase pricing', 'Home loan / Mortgage', 'Capital gains / Income tax', 'Legal / Dispute / Court', 'Insurance', 'Just curious'].map((o) => <option key={o} value={o}>{o}</option>)}</NativeSelect>
                        <FieldError show={err.has('purpose')}>{err.msg('purpose')}</FieldError>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.ptype')}</label>
                        <NativeSelect value={form.ptype} onChange={(e) => set('ptype', e.target.value)} className={sel}>{['Flat', 'Villa / House', 'Plot / Land', 'Commercial'].map((o) => <option key={o} value={o}>{o}</option>)}</NativeSelect>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.location')}</label>
                        <LocalitySelect value={form.location} onChange={(v) => set('location', v)} options={localityNames()} placeholder={tr('services.valuation.locationPlaceholder')} ariaLabel={tr('services.valuation.location')} className="w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-300 mb-1.5">{tr('services.valuation.carpetAreaSqft')}</label>
                        <input type="number" value={form.area} onChange={(e) => set('area', e.target.value)} placeholder={tr('services.valuation.areaPlaceholder')} className="field w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500" />
                      </div>
                    </div>
                    <button type="submit" className="btn-teal w-full mt-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"><Icon name="send" className="w-4 h-4" /> {tr('services.valuation.requestValuation')}</button>
                    <p className="text-center text-[11px] text-gray-500 mt-3">{tr('services.valuation.consentText')}</p>
                  </form>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4"><Icon name="check" className="w-7 h-7 text-emerald-400" /></div>
                  <h3 className="text-white font-bold text-lg">{tr('services.valuation.receivedTitle')}</h3>
                  <p className="text-gray-400 text-sm mt-2 max-w-sm mx-auto">{tr('services.valuation.receivedDesc')}</p>
                  <button onClick={() => setDone(false)} className="mt-5 text-teal-400 text-sm font-medium hover:underline">{tr('services.valuation.submitAnother')}</button>
                </div>
              )}
            </div>

            <div className="glass-card rounded-2xl p-6 sm:p-7">
              <div className="flex items-center gap-2 mb-4"><Icon name="sliders-horizontal" className="w-5 h-5 text-teal-400" /><h3 className="text-white font-bold">{tr('services.valuation.factorsTitle')}</h3></div>
              <ul className="space-y-3">
                {FACTORS.map(([t, ic], i) => (
                  <li key={t} className="flex items-center gap-3 text-gray-300 text-sm"><span className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0"><Icon name={ic} className="w-4 h-4 text-teal-400" /></span>{tr('services.valuation.factor.' + i)}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.valuation.howItWorks')}</h2></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5">
            {STEPS.map(([t, ic, d], idx) => (
              <div key={t} className="text-center reveal">
                <div className="relative w-16 h-16 mx-auto mb-4"><div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center"><Icon name={ic} className="w-7 h-7 text-teal-400" /></div></div>
                <h3 className="text-white font-semibold flex items-center justify-center gap-1.5"><span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/25 text-teal-300 text-[11px] font-bold shrink-0">{idx + 1}</span><span>{tr('services.valuation.step.' + idx + '.t')}</span></h3><p className="text-gray-500 text-xs mt-1">{tr('services.valuation.step.' + idx + '.d')}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Why choose */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-6 sm:mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.valuation.whyTitle')}</h2></div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {TRUST.map(([t, ic, d], i) => (
              <div key={t} className="glass-card rounded-2xl p-5 sm:p-6 reveal"><div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center mb-4"><Icon name={ic} className="w-5 h-5 text-teal-400" /></div><h3 className="text-white font-semibold mb-1.5 text-sm">{tr('services.valuation.trust.' + i + '.t')}</h3><p className="text-gray-500 text-xs leading-relaxed">{tr('services.valuation.trust.' + i + '.d')}</p></div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="text-center mb-10 reveal"><h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.valuation.faqTitle')}</h2></div>
          <div className="space-y-3">
            {FAQ.map(([q, a], i) => (
              <div key={q} className={'faq-item glass-card rounded-2xl overflow-hidden ' + (openFaq === i ? 'open' : '')}>
                <button type="button" className="faq-q flex items-center justify-between gap-4 p-5 w-full text-left" onClick={() => setOpenFaq(openFaq === i ? -1 : i)} aria-expanded={openFaq === i}><span className="text-white font-medium text-sm">{tr('services.valuation.faq.' + i + '.q')}</span><Icon name="chevron-down" className="faq-chev w-5 h-5 text-teal-400 flex-shrink-0" /></button>
                <div className="faq-a"><p className="px-5 pb-5 text-gray-400 text-sm leading-relaxed">{tr('services.valuation.faq.' + i + '.a')}</p></div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
          <div className="glass-card rounded-2xl p-8 sm:p-12 text-center relative overflow-hidden reveal">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 50%,#14b8a6 0,transparent 40%),radial-gradient(circle at 70% 50%,#0d9488 0,transparent 40%)' }} />
            <div className="relative">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">{tr('services.valuation.ctaTitle')}</h2>
              <p className="text-gray-400 mt-3 mb-7">{tr('services.valuation.ctaSub')}</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={scrollToForm} className="btn-teal px-6 py-3.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2"><Icon name="file-badge" className="w-4 h-4" /> {tr('services.valuation.ctaRequest')}</button>
                <a href="tel:18002000000" className="px-6 py-3.5 rounded-xl border border-white/10 text-gray-200 text-sm font-semibold hover:bg-white/5 inline-flex items-center justify-center gap-2"><Icon name="phone" className="w-4 h-4" /> {tr('services.valuation.ctaCall')}</a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

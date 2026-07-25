import NativeSelect from '../../components/ui/NativeSelect.jsx';
import DateField from '../../components/ui/DateField.jsx';
import AadhaarVerifyModal from '../../components/auth/AadhaarVerifyModal.jsx';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { maskPhone } from '../../lib/contact.js';

import { getTenantProfile, saveTenantProfile, tenantScore, getAadhaarVerification } from '../../lib/store.js';

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function TenantProfile() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => {
    const base = getTenantProfile()
      || { name: user?.name || '', employment: '', income: '', occupants: '', moveIn: '', priorLandlord: '', about: '', idVerified: false, kyc: null };
    // Identity is one Aadhaar per person — if the user already verified elsewhere
    // (e.g. the contact-owner gate), reflect that here instead of asking again.
    const rec = getAadhaarVerification();
    if (rec?.verified && !base.idVerified) {
      base.idVerified = true;
      base.kyc = { type: 'aadhaar', label: 'Aadhaar', masked: maskPhone(rec.aadhaarMobile || user?.mobile || ''), verifiedAt: rec.at || Date.now() };
    }
    return base;
  });
  const [errors, setErrors] = useState({});
  const [justSaved, setJustSaved] = useState(false);
  const [kycOpen, setKycOpen] = useState(false);
  const nameRef = useRef(null);

  const set = (k, v) => { setForm((p) => ({ ...p, [k]: v })); setJustSaved(false); };
  const setIncome = (v) => set('income', String(v).replace(/\D/g, '').slice(0, 9));
  const s = useMemo(() => tenantScore(form), [form]);

  // Score factors — mirror tenantScore() in store.js so the checklist is truthful.
  const factors = [
    { key: 'idVerified', label: t('misc.tpBoostId'), pts: 30, done: !!form.idVerified },
    { key: 'employment', label: t('misc.tpBoostOccupation'), pts: 20, done: !!form.employment },
    { key: 'income', label: t('misc.tpBoostIncome'), pts: 15, done: !!(form.income && Number(form.income) > 0) },
    { key: 'priorLandlord', label: t('misc.tpBoostLandlord'), pts: 15, done: !!form.priorLandlord },
    { key: 'about', label: t('misc.tpBoostAbout'), pts: 10, done: !!form.about },
    { key: 'occupants', label: t('misc.tpBoostOccupants'), pts: 10, done: !!form.occupants },
  ];
  const pending = factors.filter((f) => !f.done);

  // Re-verification is only warranted when the identity assurance breaks — i.e. the
  // Aadhaar-linked mobile the user verified against no longer matches their current
  // account number (number change / account moved). An unchanged verified user is
  // never nagged to re-verify. (Admin/ops revocation clears idVerified separately,
  // which falls back to the normal "Verify now" prompt.)
  const verificationStale = !!(form.idVerified && form.kyc?.masked && user?.mobile && form.kyc.masked !== maskPhone(user.mobile));

  const onVerified = () => {
    // The shared AadhaarVerifyModal has already recorded the verification against
    // the Aadhaar-linked mobile (setAadhaarVerified). Mirror it into the profile and
    // persist immediately so it isn't lost if the user leaves before pressing Save.
    const rec = getAadhaarVerification();
    const masked = maskPhone(rec?.aadhaarMobile || user?.mobile || '');
    const next = { ...form, idVerified: true, kyc: { type: 'aadhaar', label: 'Aadhaar', masked, verifiedAt: rec?.at || Date.now() } };
    setForm(next);
    saveTenantProfile(next);
    setKycOpen(false);
    setJustSaved(false);
    toast(t('misc.tpKycVerified', { label: 'Aadhaar' }), 'success');
  };

  const save = (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: true });
      toast(t('misc.tpNameRequired'), 'error');
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setErrors({});
    saveTenantProfile({ ...form, name: form.name.trim() });
    setJustSaved(true);
    toast(t('misc.tpProfileSaved'), 'success');
  };

  const incomeDisplay = form.income ? Number(form.income).toLocaleString('en-IN') : '';

  const meta = [];
  if (form.employment) meta.push(['briefcase', form.employment]);
  if (form.income && Number(form.income) > 0) meta.push(['wallet', '₹' + Number(form.income).toLocaleString('en-IN') + t('misc.tpMoIncomeSuffix')]);
  if (form.occupants) meta.push(['users', form.occupants]);
  if (form.moveIn) meta.push(['calendar', t('misc.tpMoveInPrefix') + form.moveIn]);

  return (
    <main className="pt-8 sm:pt-10 pb-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-xl bg-emerald-400/15 flex items-center justify-center"><Icon name="user-check" className="w-6 h-6 text-emerald-300" /></div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold">{t('misc.tpTitle')}</h1>
          <p className="text-gray-400 text-sm">{t('misc.tpSubtitle')}</p>
        </div>
      </div>

      {/* Mobile-only progress header — puts the payoff and live feedback above the form
          so tenants see their score climb as they fill each field. Desktop shows this in the aside. */}
      <div className="glass rounded-2xl p-4 mt-4 lg:hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold inline-flex items-center gap-2"><Icon name="trending-up" className="w-4 h-4 text-emerald-400" /> {t('misc.tpTrustScore')}</span>
          <span className="text-emerald-300 font-bold text-lg">{s}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-label={t('misc.tpTrustScore')} aria-valuenow={s} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full" style={{ width: s + '%', background: 'linear-gradient(90deg,#0d9488,#14b8a6)' }} /></div>
        <p className="text-xs text-gray-400 mt-2">{pending.length ? t('misc.tpBoostSub', { count: pending.length }) : t('misc.tpBoostDone')}</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        {/* Form */}
        <form onSubmit={save} className="lg:col-span-2 glass rounded-2xl p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="lbl" htmlFor="tp-name">{t('misc.tpFullName')}</label>
              <input ref={nameRef} id="tp-name" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} className={'fld' + (errors.name ? ' !border-red-400/60' : '')} placeholder={t('misc.tpFullNamePlaceholder')} aria-invalid={!!errors.name} />
              {errors.name && <p className="text-xs text-red-400 mt-1">{t('misc.tpNameRequired')}</p>}
            </div>
            <div><label className="lbl" htmlFor="tp-occ">{t('misc.tpOccupation')}</label><input id="tp-occ" value={form.employment} onChange={(e) => set('employment', e.target.value)} className="fld" placeholder={t('misc.tpOccupationPlaceholder')} /></div>
            <div>
              <label className="lbl" htmlFor="tp-income">{t('misc.tpIncome')}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">₹</span>
                <input id="tp-income" value={incomeDisplay} onChange={(e) => setIncome(e.target.value)} className="fld !pl-7" inputMode="numeric" placeholder={t('misc.tpIncomePlaceholder')} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('misc.tpIncomePrivacy')}</p>
            </div>
            <div>
              <label className="lbl">{t('misc.tpWhoLives')}</label>
              <NativeSelect value={form.occupants} onChange={(e) => set('occupants', e.target.value)} className="fld"><option value="">{t('misc.tpSelect')}</option><option>Family</option><option>Bachelor (Male)</option><option>Bachelor (Female)</option><option>Company lease</option></NativeSelect>
            </div>
            <div><label className="lbl">{t('misc.tpMoveInBy')}</label><DateField value={form.moveIn} onChange={(v) => set('moveIn', v)} min={todayISO()} className="fld" ariaLabel={t('misc.tpMoveInAria')} /></div>
            <div><label className="lbl" htmlFor="tp-landlord">{t('misc.tpPriorLandlord')}</label><input id="tp-landlord" value={form.priorLandlord} onChange={(e) => set('priorLandlord', e.target.value)} className="fld" placeholder={t('misc.tpPriorLandlordPlaceholder')} /></div>
          </div>
          <div><label className="lbl" htmlFor="tp-about">{t('misc.tpAbout')}</label><textarea id="tp-about" value={form.about} onChange={(e) => set('about', e.target.value)} rows={3} className="fld" placeholder={t('misc.tpAboutPlaceholder')} /></div>

          <div className="rounded-xl border border-emerald-500/25 p-4" style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Icon name="shield-check" className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t('misc.tpIdVerification')}</p>
                  {form.idVerified && form.kyc
                    ? (verificationStale
                      ? <p className="text-amber-300 text-xs">{t('misc.tpVerifyStale')}</p>
                      : <p className="text-emerald-300 text-xs">{form.kyc.label} · {form.kyc.masked}</p>)
                    : <p className="text-gray-400 text-xs">{t('misc.tpKycPrompt')}</p>}
                </div>
              </div>
              {form.idVerified && !verificationStale
                ? (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-400/15 text-emerald-300 inline-flex items-center gap-1 flex-shrink-0"><Icon name="badge-check" className="w-3.5 h-3.5" /> {t('misc.tpVerifiedCheck')}</span>
                )
                : <button type="button" onClick={() => setKycOpen(true)} className="px-4 py-2 rounded-lg text-sm font-semibold btn-teal flex-shrink-0">{form.idVerified ? t('misc.tpReverify') : t('misc.tpVerifyNow')}</button>}
            </div>
          </div>

          <button type="submit" className="btn-teal w-full py-3 rounded-xl font-semibold inline-flex items-center justify-center gap-2"><Icon name="save" className="w-4 h-4" /> {t('misc.tpSaveProfile')}</button>

          {justSaved && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-400/10 p-4">
              <p className="text-sm font-semibold text-emerald-200 flex items-center gap-2"><Icon name="check-circle" className="w-4 h-4" /> {t('misc.tpSavedTitle')}</p>
              <p className="text-xs text-gray-300 mt-0.5">{t('misc.tpSavedBody')}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" onClick={() => navigate('/listings')} className="btn-teal px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5"><Icon name="search" className="w-4 h-4" /> {t('misc.tpBrowseRentals')}</button>
                <button type="button" onClick={() => navigate('/dashboard')} className="btn-outline px-4 py-2 rounded-lg text-sm font-semibold">{t('misc.tpBackToDashboard')}</button>
              </div>
            </div>
          )}
        </form>

        {/* Live preview + score booster */}
        <aside className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-6 order-2 lg:order-1">
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wider">{t('misc.tpHowOwnersSee')}</p>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center font-bold text-lg">{(form.name || 'T').trim().charAt(0).toUpperCase()}</div>
              <div>
                <div className="flex items-center gap-1.5"><span className="font-semibold">{form.name || t('misc.tpYourName')}</span>{form.idVerified && <Icon name="badge-check" className="w-4 h-4 text-emerald-400" />}</div>
                <span className={form.idVerified ? 'text-xs text-emerald-300 font-semibold' : 'text-xs text-gray-500'}>{form.idVerified ? t('misc.tpVerifiedTenant') : t('misc.tpUnverifiedTenant')}</span>
              </div>
            </div>
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1"><span className="text-gray-400">{t('misc.tpTrustScore')}</span><span className="text-emerald-300 font-bold">{s}%</span></div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-label={t('misc.tpTrustScore')} aria-valuenow={s} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full" style={{ width: s + '%', background: 'linear-gradient(90deg,#0d9488,#14b8a6)' }} /></div>
            </div>
            <div className="space-y-1.5 text-sm text-gray-300">
              {meta.length ? meta.map(([ic, txt]) => <p key={txt} className="flex items-center gap-2"><Icon name={ic} className="w-4 h-4 text-teal-400" /> {txt}</p>) : <p className="text-gray-500 text-xs">{t('misc.tpFillToPreview')}</p>}
              {form.about && <p className="text-gray-400 text-xs italic border-l-2 border-white/10 pl-2 mt-2 line-clamp-3">{form.about}</p>}
            </div>
          </div>

          {/* Booster checklist — the actionable core of the page. On mobile it sits directly
              under the form (order-1); on desktop it keeps its place below the preview. */}
          <div className="glass rounded-2xl p-5 order-1 lg:order-2">
            <h3 className="font-bold text-sm mb-1 flex items-center gap-2"><Icon name="trending-up" className="w-4 h-4 text-emerald-400" /> {t('misc.tpBoostTitle')}</h3>
            <p className="text-xs text-gray-500 mb-3">{pending.length ? t('misc.tpBoostSub', { count: pending.length }) : t('misc.tpBoostDone')}</p>
            <ul className="space-y-2">
              {factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className={'flex items-center gap-2 ' + (f.done ? 'text-gray-400' : 'text-gray-200')}>
                    <Icon name={f.done ? 'check-circle' : 'circle'} className={'w-4 h-4 ' + (f.done ? 'text-emerald-400' : 'text-gray-600')} />
                    <span className={f.done ? 'line-through decoration-white/20' : ''}>{f.label}</span>
                  </span>
                  <span className={'text-xs font-semibold ' + (f.done ? 'text-emerald-400/70' : 'text-emerald-300')}>{f.done ? '✓' : '+' + f.pts + '%'}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass rounded-2xl p-5 order-3 lg:order-3">
            <h3 className="font-bold text-sm mb-2 flex items-center gap-2"><Icon name="zap" className="w-4 h-4 text-amber-400" /> {t('misc.tpWhyVerify')}</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {t('misc.tpWhy1')}</li>
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {t('misc.tpWhy2')}</li>
              <li className="flex gap-2"><Icon name="check" className="w-4 h-4 text-emerald-400 mt-0.5" /> {t('misc.tpWhy3')}</li>
            </ul>
          </div>
        </aside>
      </div>

      {kycOpen && (
        <AadhaarVerifyModal
          subtitle={t('misc.tpKycModalSubtitle')}
          note={t('misc.tpKycModalNote')}
          onClose={() => setKycOpen(false)}
          onVerified={onVerified}
        />
      )}
    </main>
  );
}

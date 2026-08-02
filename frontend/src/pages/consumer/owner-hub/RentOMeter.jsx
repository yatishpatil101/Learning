import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { fmtINR, fmtNum } from '../../../lib/format.js';
import { estimateValuation } from '../../../lib/data/valuation.js';
import { registerManagedProp } from '../../../lib/data/managedProperty.js';
import { HUB_LOCALITIES, HOME_TYPES, BHK_OPTIONS, FURNISHING_OPTIONS, FIELD_CLS } from './constants.js';

/* The Rent-o-meter — the acquisition hero. An owner gets an instant, indicative
   rent + sale estimate with zero commitment, and can turn that estimate into a
   registered (private) property in one tap. */
export default function RentOMeter({ onSaved }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const rentStr = (n) => t('ownerHub.rentPerMo', { amount: fmtNum(n) });
  const [form, setForm] = useState({ deal: 'rent', locality: '', type: 'Flat', bhk: '2', area: '', furnishing: 'semi-furnished' });
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setResult(null); };

  const est = useMemo(() => (result ? result.est : null), [result]);
  const isRent = form.deal === 'rent';

  const estimate = () => {
    if (!form.locality) { toast(t('ownerHub.pickLocality'), 'error'); return; }
    const out = estimateValuation({ locality: form.locality, bhk: form.bhk, area: form.area, furnishing: form.furnishing });
    setResult({ est: out });
  };

  const save = () => {
    if (!est) return;
    setSaving(true);
    const price = isRent ? est.rent.mid : est.sale.mid;
    const prop = registerManagedProp({
      deal: isRent ? 'rent' : 'sale',
      locality: form.locality,
      type: form.type,
      bhk: form.bhk,
      area: est.area,
      furnishing: form.furnishing,
      price,
      rented: false,
      monthlyRent: est.rent.mid,
      valuation: { rent: est.rent, sale: est.sale, perSqft: est.perSqft, at: Date.now() },
    });
    toast(t('ownerHub.savedToast'), 'success');
    if (onSaved) onSaved(prop);
    navigate(`/owner-hub/property/${prop.id}`);
  };

  return (
    <div className="glass-card rounded-2xl p-6 sm:p-8">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="gauge" className="w-5 h-5 text-brand-teal-2" />
        <h2 className="text-lg font-bold text-white">{t('ownerHub.rentometer')}</h2>
      </div>
      <p className="text-gray-400 text-sm mb-5">{t('ownerHub.rentometerSub')}</p>

      {/* Deal toggle */}
      <div className="inline-flex p-1 rounded-xl bg-white/5 border border-white/10 mb-5">
        {[['rent', 'ownerHub.rentItOut'], ['sale', 'ownerHub.sellIt']].map(([v, labelKey]) => (
          <button
            key={v}
            type="button"
            onClick={() => { setForm((f) => ({ ...f, deal: v })); setResult(null); }}
            className={'px-4 py-1.5 rounded-lg text-sm font-medium transition-all ' + (form.deal === v ? 'bg-brand-teal-2 text-white' : 'text-gray-400 hover:text-white')}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs text-gray-400 mb-1.5 block">{t('ownerHub.locality')}</span>
          <NativeSelect value={form.locality} onChange={set('locality')} title={t('ownerHub.locality')} searchable>
            <option value="">{t('ownerHub.selectLocality')}</option>
            {HUB_LOCALITIES.map((l) => <option key={l} value={l}>{l}</option>)}
          </NativeSelect>
        </label>
        <label className="block">
          <span className="text-xs text-gray-400 mb-1.5 block">{t('ownerHub.propertyType')}</span>
          <NativeSelect value={form.type} onChange={set('type')} title={t('ownerHub.propertyType')}>
            {HOME_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
          </NativeSelect>
        </label>
        <label className="block">
          <span className="text-xs text-gray-400 mb-1.5 block">{t('ownerHub.configuration')}</span>
          <NativeSelect value={form.bhk} onChange={set('bhk')} title={t('ownerHub.configuration')}>
            {BHK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
          </NativeSelect>
        </label>
        <label className="block">
          <span className="text-xs text-gray-400 mb-1.5 block">{t('ownerHub.carpetArea')} <span className="text-gray-600">{t('ownerHub.optional')}</span></span>
          <input type="number" min="150" inputMode="numeric" value={form.area} onChange={set('area')} placeholder={t('ownerHub.areaPlaceholder')} className={FIELD_CLS} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-gray-400 mb-1.5 block">{t('ownerHub.furnishing')}</span>
          <NativeSelect value={form.furnishing} onChange={set('furnishing')} title={t('ownerHub.furnishing')}>
            {FURNISHING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
          </NativeSelect>
        </label>
      </div>

      <button onClick={estimate} className="btn-teal w-full mt-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2">
        <Icon name="sparkles" className="w-4 h-4" /> {t('ownerHub.estimateNow')}
      </button>

      {est && (
        <div className="mt-6 pt-6 border-t border-white/10 fade-in visible">
          {/* The number is the hero. */}
          <p className="text-xs text-gray-400 mb-1">{isRent ? t('ownerHub.estMonthlyRent') : t('ownerHub.estSaleValue')} · {est.locality}</p>
          <p className="text-4xl sm:text-5xl font-extrabold gradient-text leading-tight">
            {isRent ? rentStr(est.rent.mid) : fmtINR(est.sale.mid)}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {isRent
              ? t('ownerHub.range', { low: rentStr(est.rent.low), high: rentStr(est.rent.high) })
              : t('ownerHub.range', { low: fmtINR(est.sale.low), high: fmtINR(est.sale.high) })}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-5">
            <div className="rd-cell">
              <p className="text-[11px] text-gray-400">{t('ownerHub.localityRate')}</p>
              <p className="text-white font-semibold">₹{fmtNum(est.perSqft)}<span className="text-xs text-gray-400">{t('locality.perSqft')}</span></p>
            </div>
            <div className="rd-cell">
              <p className="text-[11px] text-gray-400">{t('ownerHub.trend12')}</p>
              <p className="text-emerald-400 font-semibold flex items-center gap-1"><Icon name="trending-up" className="w-4 h-4" /> +{est.yoy}%</p>
            </div>
            <div className="rd-cell">
              <p className="text-[11px] text-gray-400">{t('ownerHub.otherSide')}</p>
              <p className="text-white font-semibold">{isRent ? fmtINR(est.sale.mid) : rentStr(est.rent.mid)}</p>
            </div>
          </div>

          {!est.known && (
            <p className="text-[11px] text-amber-300/90 mt-3 flex items-start gap-1.5">
              <Icon name="info" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {t('ownerHub.noCurated')}
            </p>
          )}

          <button onClick={save} disabled={saving} className="btn-teal w-full mt-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            <Icon name="folder-plus" className="w-4 h-4" /> {t('ownerHub.saveAsMine')}
          </button>
          <p className="text-[11px] text-gray-500 mt-2 text-center">
            <Trans i18nKey="ownerHub.staysPrivate" components={{ 1: <button type="button" onClick={() => navigate('/services/property-valuation')} className="text-brand-teal-3 hover:underline" /> }} />
          </p>
        </div>
      )}
    </div>
  );
}

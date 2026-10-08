import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { fmtINR, fmtNum } from '../../../lib/format.js';
import { estimateValuation } from '../../../lib/data/valuation.js';
import { getLocality } from '../../../services/localityService.js';
import { registerManaged } from '../../../services/managedService.js';
import { HOME_TYPES, BHK_OPTIONS, FURNISHING_OPTIONS, FIELD_CLS } from './constants.js';

export default function RentOMeter({ onSaved }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const rentStr = (n) => t('ownerHub.rentPerMo', { amount: fmtNum(n) });
  const [form, setForm] = useState({ deal: 'rent', locality: '', localitySlug: '', type: 'Flat', bhk: '2', area: '', furnishing: 'semi-furnished' });
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const slugRef = useRef('');

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setResult(null); };
  const clearLocality = (v) => { slugRef.current = ''; setForm((f) => ({ ...f, locality: v, localitySlug: '' })); setResult(null); };
  const pickLocality = ({ slug, name }) => { slugRef.current = slug; setForm((f) => ({ ...f, locality: name, localitySlug: slug })); setResult(null); };

  const shown = result && result.slug === form.localitySlug ? result : null;
  const est = shown ? shown.est : null;
  const isRent = form.deal === 'rent';

  const estimate = async () => {
    const slug = form.localitySlug;
    if (!slug) { toast(t('ownerHub.pickLocality'), 'error'); return; }
    setEstimating(true);
    try {
      const loc = await getLocality(slug);
      if (slugRef.current !== slug) return;
      setResult({ slug, name: loc.name, est: estimateValuation({ locality: loc, bhk: form.bhk, area: form.area, furnishing: form.furnishing }) });
    } catch (e) {
      toast(e?.message || t('ownerHub.estimateFailed'), 'error');
    } finally {
      setEstimating(false);
    }
  };

  const save = async () => {
    if (!est) return;
    setSaving(true);
    const price = isRent ? est.rent.mid : est.sale.mid;
    let prop;
    try {
      prop = await registerManaged({
        deal: isRent ? 'rent' : 'sale',
        locality: form.locality,
        localitySlug: form.localitySlug,
        type: form.type,
        bhk: form.bhk,
        area: est.area,
        furnishing: form.furnishing,
        price,
        rented: false,
        monthlyRent: est.rent.mid,
        // Kept verbatim: the owner's evidence for the number shown; re-deriving later would rewrite history.
        valuation: { rent: est.rent, sale: est.sale, perSqft: est.perSqft, at: Date.now() },
      });
    } catch (e) {
      // Without this the button stays in its saving state forever on a failure, with no explanation.
      setSaving(false);
      toast(e?.message || t('ownerHub.publishFailed'), 'error');
      return;
    }
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
          <LocalitySelect
            value={form.locality}
            onChange={clearLocality}
            onSelect={pickLocality}
            placeholder={t('ownerHub.selectLocality')}
            ariaLabel={t('ownerHub.locality')}
            className="w-full"
          />
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

      <button onClick={estimate} disabled={estimating} className="btn-teal w-full mt-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
        <Icon name="sparkles" className="w-4 h-4" /> {t('ownerHub.estimateNow')}
      </button>

      {shown && !est && (
        <p className="mt-5 text-sm text-amber-300/90 flex items-start gap-1.5" data-testid="rentometer-not-enough">
          <Icon name="info" className="w-4 h-4 flex-shrink-0 mt-0.5" /> {t('ownerHub.notEnough', { name: shown.name })}
        </p>
      )}

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

          <div className="grid grid-cols-2 gap-2.5 mt-5">
            <div className="rd-cell">
              <p className="text-[11px] text-gray-400">{t('ownerHub.localityRate')}</p>
              <p className="text-white font-semibold">₹{fmtNum(est.perSqft)}<span className="text-xs text-gray-400">{t('locality.perSqft')}</span></p>
            </div>
            <div className="rd-cell">
              <p className="text-[11px] text-gray-400">{t('ownerHub.otherSide')}</p>
              <p className="text-white font-semibold">{isRent ? fmtINR(est.sale.mid) : rentStr(est.rent.mid)}</p>
            </div>
          </div>

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

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { fmtINR, fmtNum } from '../../../lib/format.js';
import { estimateValuation } from '../../../lib/data/valuation.js';
import { registerManagedProp } from '../../../lib/data/managedProperty.js';
import { HUB_LOCALITIES, HOME_TYPES, BHK_OPTIONS, FURNISHING_OPTIONS, FIELD_CLS } from './constants.js';

const rentStr = (n) => '₹' + fmtNum(n) + '/mo';

/* The Rent-o-meter — the acquisition hero. An owner gets an instant, indicative
   rent + sale estimate with zero commitment, and can turn that estimate into a
   registered (private) property in one tap. */
export default function RentOMeter({ onSaved }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = useState({ deal: 'rent', locality: '', type: 'Flat', bhk: '2', area: '', furnishing: 'semi-furnished' });
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setResult(null); };

  const est = useMemo(() => (result ? result.est : null), [result]);
  const isRent = form.deal === 'rent';

  const estimate = () => {
    if (!form.locality) { toast('Pick a locality to estimate', 'error'); return; }
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
    toast('Property saved to your hub — private until you publish.', 'success');
    if (onSaved) onSaved(prop);
    navigate(`/owner-hub/property/${prop.id}`);
  };

  return (
    <div className="glass-card rounded-2xl p-6 sm:p-8">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="gauge" className="w-5 h-5 text-brand-teal-2" />
        <h2 className="text-lg font-bold text-white">Rent-o-meter</h2>
      </div>
      <p className="text-gray-400 text-sm mb-5">What can your home earn or sell for? Get an instant, indicative estimate — free, no sign-up wall.</p>

      {/* Deal toggle */}
      <div className="inline-flex p-1 rounded-xl bg-white/5 border border-white/10 mb-5">
        {[['rent', 'Rent it out'], ['sale', 'Sell it']].map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => { setForm((f) => ({ ...f, deal: v })); setResult(null); }}
            className={'px-4 py-1.5 rounded-lg text-sm font-medium transition-all ' + (form.deal === v ? 'bg-brand-teal-2 text-white' : 'text-gray-400 hover:text-white')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs text-gray-400 mb-1.5 block">Locality</span>
          <NativeSelect value={form.locality} onChange={set('locality')} title="Locality" searchable>
            <option value="">Select locality</option>
            {HUB_LOCALITIES.map((l) => <option key={l} value={l}>{l}</option>)}
          </NativeSelect>
        </label>
        <label className="block">
          <span className="text-xs text-gray-400 mb-1.5 block">Property type</span>
          <NativeSelect value={form.type} onChange={set('type')} title="Property type">
            {HOME_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </NativeSelect>
        </label>
        <label className="block">
          <span className="text-xs text-gray-400 mb-1.5 block">Configuration</span>
          <NativeSelect value={form.bhk} onChange={set('bhk')} title="BHK">
            {BHK_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </NativeSelect>
        </label>
        <label className="block">
          <span className="text-xs text-gray-400 mb-1.5 block">Carpet area (sq.ft.) <span className="text-gray-600">— optional</span></span>
          <input type="number" min="150" inputMode="numeric" value={form.area} onChange={set('area')} placeholder="e.g. 900" className={FIELD_CLS} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-gray-400 mb-1.5 block">Furnishing</span>
          <NativeSelect value={form.furnishing} onChange={set('furnishing')} title="Furnishing">
            {FURNISHING_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </NativeSelect>
        </label>
      </div>

      <button onClick={estimate} className="btn-teal w-full mt-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2">
        <Icon name="sparkles" className="w-4 h-4" /> Estimate now
      </button>

      {est && (
        <div className="mt-6 pt-6 border-t border-white/10 fade-in visible">
          {/* The number is the hero. */}
          <p className="text-xs text-gray-400 mb-1">{isRent ? 'Estimated monthly rent' : 'Estimated sale value'} · {est.locality}</p>
          <p className="text-4xl sm:text-5xl font-extrabold gradient-text leading-tight">
            {isRent ? rentStr(est.rent.mid) : fmtINR(est.sale.mid)}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            Range {isRent ? `${rentStr(est.rent.low)} – ${rentStr(est.rent.high)}` : `${fmtINR(est.sale.low)} – ${fmtINR(est.sale.high)}`}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-5">
            <div className="rd-cell">
              <p className="text-[11px] text-gray-400">Locality rate</p>
              <p className="text-white font-semibold">₹{fmtNum(est.perSqft)}<span className="text-xs text-gray-400">/sq.ft.</span></p>
            </div>
            <div className="rd-cell">
              <p className="text-[11px] text-gray-400">12-mo trend</p>
              <p className="text-emerald-400 font-semibold flex items-center gap-1"><Icon name="trending-up" className="w-4 h-4" /> +{est.yoy}%</p>
            </div>
            <div className="rd-cell">
              <p className="text-[11px] text-gray-400">The other side</p>
              <p className="text-white font-semibold">{isRent ? fmtINR(est.sale.mid) : rentStr(est.rent.mid)}</p>
            </div>
          </div>

          {!est.known && (
            <p className="text-[11px] text-amber-300/90 mt-3 flex items-start gap-1.5">
              <Icon name="info" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> We don't have curated data for this area yet — this is a wider city-level estimate.
            </p>
          )}

          <button onClick={save} disabled={saving} className="btn-teal w-full mt-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            <Icon name="folder-plus" className="w-4 h-4" /> Save as my property
          </button>
          <p className="text-[11px] text-gray-500 mt-2 text-center">
            Stays private. Indicative estimate — <button type="button" onClick={() => navigate('/services/property-valuation')} className="text-brand-teal-3 hover:underline">get an accurate valuation</button>.
          </p>
        </div>
      )}
    </div>
  );
}

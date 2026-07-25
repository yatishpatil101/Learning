import { useMemo, useState } from 'react';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import Icon from '../../../components/Icon.jsx';

/* Instant moving-cost estimator — the signature "customer touch" for the packers page.
   Indicative only; the real quote comes from the hero form (anchored via #quote). Pure
   cost math lives in estimateMove() so it stays testable. */
const BASE = {
  '1 RK': [4000, 7000],
  '1 BHK': [6000, 12000],
  '2 BHK': [9000, 18000],
  '3 BHK': [14000, 26000],
  '4 BHK / Villa': [22000, 40000],
  'Few items only': [2000, 5000],
};
const DIST = {
  'Within Pune (local)': 1,
  '< 500 km (Mumbai, Nashik, Nagpur)': 2.2,
  '500–1200 km (Delhi, Bengaluru)': 3,
  '> 1200 km (Kolkata, Chennai)': 3.8,
};
const PACK = { 'Standard packing': 1, 'Premium / fragile-safe': 1.18 };
const LIFT = { 'Ground floor / lift available': 1, 'Upper floor, no lift': 1.08 };

export function estimateMove(size, dist, pack, lift) {
  const b = BASE[size] || BASE['2 BHK'];
  const f = (DIST[dist] ?? 1) * (PACK[pack] ?? 1) * (LIFT[lift] ?? 1);
  return [Math.round((b[0] * f) / 500) * 500, Math.round((b[1] * f) / 500) * 500];
}
const fmt = (n) => '₹' + n.toLocaleString('en-IN');

export default function PackersEstimator({ t }) {
  const [size, setSize] = useState('2 BHK');
  const [dist, setDist] = useState('Within Pune (local)');
  const [pack, setPack] = useState('Standard packing');
  const [lift, setLift] = useState('Ground floor / lift available');
  const [lo, hi] = useMemo(() => estimateMove(size, dist, pack, lift), [size, dist, pack, lift]);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
      <div className="text-center mb-10 reveal">
        <h2 className="text-2xl sm:text-3xl font-bold text-white">{t('services.packers.estimator.title')}</h2>
        <p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{t('services.packers.estimator.sub')}</p>
      </div>
      <div className="glass-card svc-quote rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 lg:gap-8 items-stretch reveal">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1.5">{t('services.packers.estimator.fSize')}</label>
            <NativeSelect value={size} onChange={(e) => setSize(e.target.value)}>{Object.keys(BASE).map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1.5">{t('services.packers.estimator.fDistance')}</label>
            <NativeSelect value={dist} onChange={(e) => setDist(e.target.value)}>{Object.keys(DIST).map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1.5">{t('services.packers.estimator.fPacking')}</label>
            <NativeSelect value={pack} onChange={(e) => setPack(e.target.value)}>{Object.keys(PACK).map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1.5">{t('services.packers.estimator.fFloor')}</label>
            <NativeSelect value={lift} onChange={(e) => setLift(e.target.value)}>{Object.keys(LIFT).map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect>
          </div>
        </div>
        <div className="rounded-xl bg-teal-500/[0.07] p-6 flex flex-col justify-center text-center">
          <p className="text-xs text-gray-400 mb-1 flex items-center justify-center gap-1.5"><Icon name="calculator" className="w-3.5 h-3.5 text-teal-400" /> {t('services.packers.estimator.estLabel')}</p>
          <p className="text-2xl sm:text-3xl font-extrabold gradient-text">{fmt(lo)} – {fmt(hi)}</p>
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">{t('services.packers.estimator.note')}</p>
          <a href="#quote" className="btn-teal mt-4 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2"><Icon name="send" className="w-4 h-4" /> {t('services.packers.estimator.cta')}</a>
        </div>
      </div>
    </section>
  );
}

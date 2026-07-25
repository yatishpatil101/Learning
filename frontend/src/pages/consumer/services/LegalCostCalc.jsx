import { useMemo, useState } from 'react';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';

/* Maharashtra stamp-duty & registration cost calculator— the signature, high-trust
   "customer touch" for the legal page. Indicative, purpose-built for Pune buyers.
   Pure math in computeStampDuty() so it stays testable. */
const AREA = {
  'Municipal Corporation (Pune / PCMC)': 6,
  'Municipal Council / Nagar Panchayat': 5,
  'Gram Panchayat (rural)': 4,
};
const BUYER = { 'Male / Joint owners': false, 'Female (sole owner)': true };

export function computeStampDuty(value, ratePct, femaleConcession) {
  const v = Math.max(value, 0);
  const rate = Math.max(ratePct - (femaleConcession ? 1 : 0), 1); // MH: 1% concession for women (residential)
  const stamp = Math.round((v * rate) / 100);
  const reg = Math.min(Math.round(v * 0.01), 30000); // registration 1%, capped at ₹30,000
  return { stamp, reg, total: stamp + reg, rate };
}
const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtShort = (n) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : '₹' + (n / 1e5).toFixed(1) + ' L');

export default function LegalCostCalc({ t }) {
  const [value, setValue] = useState(7500000);
  const [area, setArea] = useState('Municipal Corporation (Pune / PCMC)');
  const [buyer, setBuyer] = useState('Male / Joint owners');
  const { stamp, reg, total, rate } = useMemo(() => computeStampDuty(value, AREA[area], BUYER[buyer]), [value, area, buyer]);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
      <div className="text-center mb-10 reveal">
        <h2 className="text-2xl sm:text-3xl font-bold text-white">{t('services.legal.calc.title')}</h2>
        <p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{t('services.legal.calc.sub')}</p>
      </div>
      <div className="glass-card svc-quote rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6 lg:gap-10 items-center reveal">
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-300">{t('services.legal.calc.propertyValue')}</label>
              <span className="text-sm font-semibold text-teal-300">{fmtShort(value)}</span>
            </div>
            <input type="range" min={1000000} max={50000000} step={100000} value={value} onChange={(e) => setValue(+e.target.value)} className="w-full accent-teal-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1.5">{t('services.legal.calc.areaType')}</label>
            <NativeSelect value={area} onChange={(e) => setArea(e.target.value)}>{Object.keys(AREA).map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1.5">{t('services.legal.calc.buyer')}</label>
            <NativeSelect value={buyer} onChange={(e) => setBuyer(e.target.value)}>{Object.keys(BUYER).map((k) => <option key={k} value={k}>{k}</option>)}</NativeSelect>
          </div>
        </div>
        <div className="rounded-xl bg-teal-500/[0.07] p-6 text-center">
          <p className="text-xs text-gray-400 mb-1">{t('services.legal.calc.govtCharges')}</p>
          <p className="text-3xl font-extrabold gradient-text">{fmt(total)}</p>
          <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-2 text-center">
            <div><p className="text-[10px] text-gray-500">{t('services.legal.calc.stampDuty')} ({rate}%)</p><p className="text-sm font-bold text-white mt-0.5">{fmtShort(stamp)}</p></div>
            <div><p className="text-[10px] text-gray-500">{t('services.legal.calc.registration')}</p><p className="text-sm font-bold text-white mt-0.5">{fmt(reg)}</p></div>
          </div>
          <p className="text-[11px] text-gray-500 mt-4 leading-relaxed">{t('services.legal.calc.note')}</p>
        </div>
      </div>
    </section>
  );
}

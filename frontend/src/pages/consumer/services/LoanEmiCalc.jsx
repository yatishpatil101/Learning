import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';

/* Interactive EMI / affordability calculator — the signature "customer touch" for the
   home-loans page. Pure math in computeEmi() so it stays testable; the full-featured
   page lives at /emi-calculator for depth. */
export function computeEmi(principal, annualRate, years) {
  const p = Math.max(principal, 0);
  const n = Math.max(years, 1) * 12;
  const r = annualRate / 12 / 100;
  const emi = r === 0 ? p / n : (p * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  const total = emi * n;
  return { emi: Math.round(emi), total: Math.round(total), interest: Math.round(total - p) };
}
const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtShort = (n) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : '₹' + (n / 1e5).toFixed(1) + ' L');

// Module-level so its identity is stable across renders — a Row defined inside the
// component would be a new type every render, remounting the range input and dropping
// the native slider drag between pointer events.
const Row = ({ label, value, min, max, step, onChange, val }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <label className="text-xs font-medium text-gray-300">{label}</label>
      <span className="text-sm font-semibold text-teal-300">{value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => onChange(+e.target.value)} className="w-full accent-teal-400" />
  </div>
);

export default function LoanEmiCalc({ t }) {
  const { flagEnabled } = useAppFlags();
  const [amount, setAmount] = useState(5000000);
  const [rate, setRate] = useState(8.5);
  const [years, setYears] = useState(20);
  const { emi, total, interest } = useMemo(() => computeEmi(amount, rate, years), [amount, rate, years]);
  const principalPct = total ? Math.round((amount / total) * 100) : 0;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
      <div className="text-center mb-10 reveal">
        <h2 className="text-2xl sm:text-3xl font-bold text-white">{t('services.homeLoans.emiCalc.title')}</h2>
        <p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{t('services.homeLoans.emiCalc.sub')}</p>
      </div>
      <div className="glass-card svc-quote rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6 lg:gap-10 items-center reveal">
        <div className="space-y-6">
          <Row label={t('services.homeLoans.emiCalc.loanAmount')} value={fmtShort(amount)} min={500000} max={30000000} step={100000} val={amount} onChange={setAmount} />
          <Row label={t('services.homeLoans.emiCalc.interestRate')} value={rate.toFixed(2) + '%'} min={7} max={12} step={0.05} val={rate} onChange={setRate} />
          <Row label={t('services.homeLoans.emiCalc.tenure')} value={years + ' ' + t('services.homeLoans.emiCalc.years')} min={5} max={30} step={1} val={years} onChange={setYears} />
          <div className="h-2 rounded-full overflow-hidden bg-white/10 flex" role="presentation">
            <div className="h-full bg-teal-400" style={{ width: principalPct + '%' }} />
            <div className="h-full bg-amber-400/70" style={{ width: 100 - principalPct + '%' }} />
          </div>
          <div className="flex items-center gap-5 text-[11px] text-gray-400">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-400" /> {t('services.homeLoans.emiCalc.principal')} {fmtShort(amount)}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/70" /> {t('services.homeLoans.emiCalc.interest')} {fmtShort(interest)}</span>
          </div>
        </div>
        <div className="rounded-xl bg-teal-500/[0.07] p-6 text-center">
          <p className="text-xs text-gray-400 mb-1">{t('services.homeLoans.emiCalc.monthlyEmi')}</p>
          <p className="text-3xl font-extrabold gradient-text">{fmt(emi)}</p>
          <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-2 text-center">
            <div><p className="text-[10px] text-gray-500">{t('services.homeLoans.emiCalc.totalInterest')}</p><p className="text-sm font-bold text-white mt-0.5">{fmtShort(interest)}</p></div>
            <div><p className="text-[10px] text-gray-500">{t('services.homeLoans.emiCalc.totalPayable')}</p><p className="text-sm font-bold text-white mt-0.5">{fmtShort(total)}</p></div>
          </div>
          {flagEnabled('emiCalculator') && <Link to="/emi-calculator" className="btn-teal mt-5 py-2.5 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 w-full"><Icon name="trending-up" className="w-4 h-4" /> {t('services.homeLoans.emiCalc.openFull')}</Link>}
        </div>
      </div>
    </section>
  );
}

import '../../styles/routes/emi.css';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { DoughnutChart } from '../../components/charts/index.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';

const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtShort = (n) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : '₹' + Math.round(n).toLocaleString('en-IN'));
const LENDERS = [{ n: 'SBI', r: 8.5 }, { n: 'HDFC', r: 8.6 }, { n: 'ICICI', r: 8.65 }, { n: 'Axis', r: 8.75 }, { n: 'LIC HFL', r: 8.45 }];

const AMT = { min: 500000, max: 50000000, step: 100000 };
const RATE = { min: 5, max: 15, step: 0.05 };
const TEN = { min: 1, max: 30, step: 1 };
const DEFAULTS = { amt: 8000000, rate: 8.5, ten: 20 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pctOf = (v, { min, max }) => (clamp(+v || 0, min, max) - min) / (max - min) * 100;
/* Only the fill percentage crosses from JS to CSS; the gradient itself lives in
   index.css. It used to be an inline `background:` shorthand built here, which
   made the rail impossible to restyle from a media query — an inline shorthand
   resets background-size/position/repeat and outranks any stylesheet rule short
   of !important. The touch-target rule for these sliders needs exactly those
   sub-properties, so the percentage became a variable instead. */
const trackPct = (p) => ({ '--emi-pct': `${p}%` });

export default function EmiCalculator() {
  const rootRef = useScrollReveal();
  const { t } = useTranslation();
  const [amt, setAmt] = useState(DEFAULTS.amt);
  const [rate, setRate] = useState(DEFAULTS.rate);
  const [ten, setTen] = useState(DEFAULTS.ten);
  const [showSchedule, setShowSchedule] = useState(false);

  const reset = () => { setAmt(DEFAULTS.amt); setRate(DEFAULTS.rate); setTen(DEFAULTS.ten); };
  const applyLender = (r) => setRate(r);

  const out = useMemo(() => {
    const P = Math.max(0, +amt || 0);
    const r = Math.max(0, +rate || 0) / 12 / 100;
    const n = Math.max(0, Math.floor(+ten || 0)) * 12;
    let emi = 0;
    if (n > 0) {
      if (r === 0) emi = P / n;
      else emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }
    if (!Number.isFinite(emi) || emi < 0) emi = 0;
    const total = emi * n;
    const interest = Math.max(total - P, 0);
    return { P, emi, total, interest };
  }, [amt, rate, ten]);

  // Year-wise amortization: how principal vs interest is repaid over the loan.
  const schedule = useMemo(() => {
    const { P, emi } = out;
    const r = Math.max(0, +rate || 0) / 12 / 100;
    const years = clamp(Math.floor(+ten || 0), 0, TEN.max);
    if (!(emi > 0) || years <= 0) return [];
    let bal = P;
    const rows = [];
    for (let y = 1; y <= years; y++) {
      let yPrin = 0, yInt = 0;
      for (let m = 0; m < 12; m++) {
        const interest = bal * r;
        const principal = Math.min(emi - interest, bal);
        bal = Math.max(bal - principal, 0);
        yPrin += principal;
        yInt += interest;
      }
      rows.push({ year: y, principal: yPrin, interest: yInt, balance: bal });
    }
    return rows;
  }, [out, rate, ten]);

  return (
    <div ref={rootRef} className="emi-page">
      <div className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-6 sm:mb-10 reveal">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-4"><Icon name="calculator" className="w-4 h-4" /> {t('misc1.emiBadge')}</div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white">{t('misc1.emiTitle')}</h1>
            <p className="text-gray-400 text-sm mt-2">{t('misc1.emiSubtitle')}</p>
          </div>

          {/* Mobile-only sticky result: keeps the primary answer in view while sliders change. */}
          <div className="pn-docks-under-nav lg:hidden sticky top-[var(--pn-nav-h)] z-30 -mx-4 sm:-mx-6 mb-6 border-b border-white/10 bg-[#0f0d1a]/95 backdrop-blur-xl">
            <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] text-gray-400 leading-none mb-1.5">{t('misc1.emiMonthlyEmi')}</p>
                <p className="text-2xl font-extrabold gradient-text leading-none" aria-live="polite" aria-atomic="true">{fmt(out.emi)} <span className="text-xs font-semibold text-gray-400">{t('misc1.emiPerMo')}</span></p>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-right">
                <div>
                  <p className="text-[10px] text-gray-500 leading-none mb-1.5">{t('misc1.emiTotalInterest')}</p>
                  <p className="text-xs font-bold text-amber-400 leading-none">{fmtShort(out.interest)}</p>
                </div>
                <div className="w-px h-7 bg-white/10" />
                <div>
                  <p className="text-[10px] text-gray-500 leading-none mb-1.5">{t('misc1.emiTotalPayable')}</p>
                  <p className="text-xs font-bold text-white leading-none">{fmtShort(out.total)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
            {/* Inputs */}
            <div className="glass-card rounded-2xl p-5 sm:p-8 reveal">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm font-semibold text-gray-200">{t('misc1.emiAdjust')}</h2>
                <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-teal-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40 rounded-md px-1.5 py-1">
                  <Icon name="rotate-ccw" className="w-3.5 h-3.5" /> {t('misc1.emiReset')}
                </button>
              </div>
              <div className="mb-6 sm:mb-7">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-300">{t('misc1.emiLoanAmount')}</label>
                  <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
                    <span className="text-teal-400 text-sm">₹</span>
                    <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} onBlur={() => setAmt(clamp(Math.round(+amt || 0), AMT.min, AMT.max))} min={AMT.min} max={AMT.max} inputMode="numeric" aria-label={t('misc1.emiAriaAmount')} className="num-field w-28 bg-transparent text-right text-white text-sm font-semibold focus:outline-none" />
                  </div>
                </div>
                <input type="range" min={AMT.min} max={AMT.max} step={AMT.step} value={clamp(+amt || 0, AMT.min, AMT.max)} onChange={(e) => setAmt(e.target.value)} aria-label={t('misc1.emiAriaAmountSlider')} className="w-full" style={trackPct(pctOf(amt, AMT))} />
                <div className="flex justify-between text-[11px] text-gray-500 mt-1"><span>₹5 L</span><span>₹5 Cr</span></div>
              </div>
              <div className="mb-6 sm:mb-7">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-300">{t('misc1.emiInterestRate')}</label>
                  <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
                    <input type="number" step="0.05" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={() => setRate(clamp(+rate || 0, RATE.min, RATE.max))} min={RATE.min} max={RATE.max} inputMode="decimal" aria-label={t('misc1.emiAriaRate')} className="num-field w-16 bg-transparent text-right text-white text-sm font-semibold focus:outline-none" />
                    <span className="text-teal-400 text-sm">%</span>
                  </div>
                </div>
                <input type="range" min={RATE.min} max={RATE.max} step={RATE.step} value={clamp(+rate || 0, RATE.min, RATE.max)} onChange={(e) => setRate(e.target.value)} aria-label={t('misc1.emiAriaRateSlider')} className="w-full" style={trackPct(pctOf(rate, RATE))} />
                <div className="flex justify-between text-[11px] text-gray-500 mt-1"><span>5%</span><span>15%</span></div>
              </div>
              <div className="mb-2">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-300">{t('misc1.emiLoanTenure')}</label>
                  <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
                    <input type="number" value={ten} onChange={(e) => setTen(e.target.value)} onBlur={() => setTen(clamp(Math.round(+ten || 0), TEN.min, TEN.max))} min={TEN.min} max={TEN.max} inputMode="numeric" aria-label={t('misc1.emiAriaTenure')} className="num-field w-12 bg-transparent text-right text-white text-sm font-semibold focus:outline-none" />
                    <span className="text-teal-400 text-sm">yrs</span>
                  </div>
                </div>
                <input type="range" min={TEN.min} max={TEN.max} step={TEN.step} value={clamp(+ten || 0, TEN.min, TEN.max)} onChange={(e) => setTen(e.target.value)} aria-label={t('misc1.emiAriaTenureSlider')} className="w-full" style={trackPct(pctOf(ten, TEN))} />
                <div className="flex justify-between text-[11px] text-gray-500 mt-1"><span>1 yr</span><span>30 yrs</span></div>
              </div>

              <div className="mt-8 hidden lg:grid grid-cols-3 gap-3">
                <div className="bg-black/20 rounded-xl p-3 text-center"><p className="text-[11px] text-gray-500 mb-1">{t('misc1.emiPrincipal')}</p><p className="text-sm font-bold text-white">{fmtShort(out.P)}</p></div>
                <div className="bg-black/20 rounded-xl p-3 text-center"><p className="text-[11px] text-gray-500 mb-1">{t('misc1.emiTotalInterest')}</p><p className="text-sm font-bold text-amber-400">{fmtShort(out.interest)}</p></div>
                <div className="bg-black/20 rounded-xl p-3 text-center"><p className="text-[11px] text-gray-500 mb-1">{t('misc1.emiTotalPayable')}</p><p className="text-sm font-bold text-white">{fmtShort(out.total)}</p></div>
              </div>
            </div>

            {/* Result */}
            <div className="glass-card rounded-2xl p-5 sm:p-8 flex flex-col reveal">
              <p className="text-sm text-gray-400 text-center mb-1 hidden lg:block">{t('misc1.emiMonthlyEmi')}</p>
              <p className="text-4xl font-extrabold gradient-text text-center mb-6 hidden lg:block" aria-live="polite" aria-atomic="true">{fmt(out.emi)} {t('misc1.emiPerMo')}</p>
              <div className="relative mx-auto" style={{ width: '200px', height: '200px' }}>
                <DoughnutChart labels={[t('misc1.emiPrincipal'), t('misc1.emiInterest')]} values={[out.P, out.interest]} colors={['#14b8a6', '#f59e0b']} height={200} options={{ cutout: '72%', plugins: { legend: { display: false } } }} />
              </div>
              <div className="mt-6 space-y-2">
                <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-gray-400"><span className="w-3 h-3 rounded-full bg-[#14b8a6]" /> {t('misc1.emiPrincipal')}</span><span className="text-white font-medium">{fmtShort(out.P)}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-gray-400"><span className="w-3 h-3 rounded-full bg-[#f59e0b]" /> {t('misc1.emiInterest')}</span><span className="text-white font-medium">{fmtShort(out.interest)}</span></div>
              </div>
              <Link to="/contact?subject=Home%20Loan%20Assistance" className="btn-teal mt-7 py-3 rounded-xl text-white text-sm font-semibold text-center flex items-center justify-center gap-2"><Icon name="badge-percent" className="w-4 h-4" /> {t('misc1.emiCheckEligibility')}</Link>
            </div>
          </div>

          {/* Year-wise breakup */}
          {schedule.length > 0 && (
            <div className="mt-8 reveal">
              <button type="button" onClick={() => setShowSchedule((s) => !s)} aria-expanded={showSchedule} className="w-full flex items-center justify-between glass-card rounded-xl px-5 py-4 hover:border-teal-400/30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40">
                <span className="flex items-center gap-2 text-sm font-semibold text-white"><Icon name="table" className="w-4 h-4 text-teal-400" /> {t('misc1.emiYearlyTitle')}</span>
                <Icon name="chevron-down" className={`w-4 h-4 text-gray-400 transition-transform ${showSchedule ? 'rotate-180' : ''}`} />
              </button>
              {showSchedule && (
                <div className="mt-3 glass-card rounded-xl overflow-hidden">
                  <div className="overflow-auto max-h-[26rem]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-white/10 sticky top-0 bg-[#141221]">
                          <th className="text-left font-medium px-4 py-3">{t('misc1.emiYear')}</th>
                          <th className="text-right font-medium px-4 py-3">{t('misc1.emiPrincipalPaid')}</th>
                          <th className="text-right font-medium px-4 py-3">{t('misc1.emiInterestPaid')}</th>
                          <th className="text-right font-medium px-4 py-3">{t('misc1.emiBalance')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedule.map((row) => (
                          <tr key={row.year} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                            <td className="px-4 py-2.5 text-gray-300">{row.year}</td>
                            <td className="px-4 py-2.5 text-right text-white">{fmtShort(row.principal)}</td>
                            <td className="px-4 py-2.5 text-right text-amber-400">{fmtShort(row.interest)}</td>
                            <td className="px-4 py-2.5 text-right text-gray-300">{fmtShort(row.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Lenders */}
          <div className="mt-10 reveal">
            <h2 className="text-lg font-bold text-white mb-1">{t('misc1.emiCompareRates')}</h2>
            <p className="text-gray-400 text-xs mb-4">{t('misc1.emiTapToApply')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {LENDERS.map((l) => {
                const active = Math.abs((+rate || 0) - l.r) < 0.001;
                return (
                  <button
                    key={l.n}
                    type="button"
                    onClick={() => applyLender(l.r)}
                    aria-pressed={active}
                    aria-label={t('misc1.emiUseRate', { bank: l.n })}
                    className={`glass-card rounded-xl p-4 text-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40 ${active ? 'border-teal-400 ring-1 ring-teal-400/40' : 'hover:border-teal-400/30'}`}
                  >
                    <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-gradient-to-br from-teal-400/20 to-teal-600/20 flex items-center justify-center relative">
                      <Icon name="landmark" className="w-5 h-5 text-teal-400" />
                      {active && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-teal-400 flex items-center justify-center"><Icon name="check" className="w-2.5 h-2.5 text-[#0f0d1a]" /></span>}
                    </div>
                    <p className="text-white font-semibold text-sm">{l.n}</p>
                    <p className="text-teal-400 text-xs mt-0.5">{l.r.toFixed(2)}% {t('misc1.emiOnwards')}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

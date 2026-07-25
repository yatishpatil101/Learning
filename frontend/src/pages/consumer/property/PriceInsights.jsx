import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { fmtINR, fmtNum } from '../../../lib/format.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { propertyKind } from './derivations.js';
import { valueBenchmark } from './locationIntel.js';

/* Price Insights (BUY). Two jobs a serious buyer has on this tab:
   1. "Is this price fair?" — benchmark ₹/sq.ft vs the locality + a 4-year trend.
   2. "What will it actually cost me?" — EMI affordability AND the acquisition
      costs Indian buyers always underestimate (stamp duty, registration, GST).
   Styled with the same tile language as the Overview tab (rd-cell / detail-card
   / teal icon chips / glass panels / insight-bar). */
export function PriceInsights({ p }) {
  const { t } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const [dp, setDp] = useState(20);
  const [tenure, setTenure] = useState(20);

  const bench = valueBenchmark(p);
  const perSqft = bench.perSqft;
  // Real appreciation from the curated locality YoY (falls back to a neutral
  // market figure when we have no verified locality data — never a made-up number).
  const yoy = bench.yoy || 0;
  const g = 1 + (yoy || 8) / 100;
  const trendIdx = [1 / g ** 3, 1 / g ** 2, 1 / g, 1];
  const trendMin = trendIdx[0];
  const trendBars = trendIdx.map((v) => Math.round(45 + ((v - trendMin) / (1 - trendMin || 1)) * 55));
  const TONE = {
    good: { text: 'text-emerald-400', arrow: 'arrow-down', note: t('property.toneBetter') },
    fair: { text: 'text-brand-teal-3', arrow: 'minus', note: t('property.toneAtMarket') },
    high: { text: 'text-amber-400', arrow: 'arrow-up', note: t('property.tonePremium') },
  }[bench.tone] || { text: 'text-brand-teal-3', arrow: 'minus', note: t('property.toneAtMarket') };

  const loan = Math.round(p.price * (1 - dp / 100));
  const r = 8.5 / 1200;
  const n = tenure * 12;
  const emi = Math.round((loan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)) || 0;

  // Acquisition costs — indicative Pune (Maharashtra) rates. Stamp duty ~6% (incl.
  // metro cess; women buyers get a 1% concession), registration 1% capped at
  // ₹30,000, and GST only on genuinely under-construction built homes. Ready-to-move
  // homes and land are exempt — and so is a ready home whose owner simply hands over
  // on a future "Available From" date (that's not under construction). Affordable
  // homes (≤₹45L) are taxed at 1%, others at 5% (both without input-tax credit).
  const isLand = propertyKind(p) === 'land';
  const isCommercial = propertyKind(p) === 'commercial';
  const stampDuty = Math.round(p.price * 0.06);
  const registration = Math.min(30000, Math.round(p.price * 0.01));
  const availableFromResale = p.possession === 'available' && p.age !== 'under-construction';
  const underConstruction = !isLand && p.construction === 'new' && !availableFromResale;
  // Under-construction GST: 12% for commercial units, 1% (affordable ≤₹45L) / 5% for homes.
  const gstRate = isCommercial ? 0.12 : (p.price <= 4500000 ? 0.01 : 0.05);
  const gst = underConstruction ? Math.round(p.price * gstRate) : 0;
  const allIn = p.price + stampDuty + registration + gst;
  const needsTds = p.price > 5000000;

  const costTile = (icon, label, value, tipKey) => {
    const tile = (
      <div className="detail-card">
        <span className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center flex-shrink-0">
          <Icon name={icon} className="w-4 h-4 text-brand-teal-3" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400 leading-tight mb-0.5">{label}</p>
          <p className="text-sm font-semibold text-white truncate">{value}</p>
        </div>
      </div>
    );
    return tipKey ? <Tip k={tipKey}>{tile}</Tip> : tile;
  };

  return (
    <section className="fade-in section-mb">
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name="trending-up" className="w-5 h-5 text-brand-teal-2" /> {t('property.priceInsightsHeading')}</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fair-price analysis */}
        <div className="glass rounded-2xl p-6 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4"><Icon name="scale" className="w-4 h-4 text-brand-teal-2" /><h3 className="font-semibold text-white">{t('property.isPriceFair')}</h3></div>
          {bench.hasData ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-6">
                <div className="rd-cell">
                  <p className="rd-lbl">{t('property.thisPropertyC')}</p>
                  <p className="rd-val-lg">₹{fmtNum(perSqft)}<span className="text-sm font-medium text-slate-400">/sq.ft.</span></p>
                </div>
                <div className="rd-cell">
                  <p className="rd-lbl">{t('property.localityAverageC', { locality: p.locality })}</p>
                  <p className="rd-val-lg text-slate-300">₹{fmtNum(bench.localityAvg)}<span className="text-sm font-medium text-slate-400">/sq.ft.</span></p>
                </div>
                <div className="rd-cell">
                  <p className="rd-lbl">{t('property.valueRating')}</p>
                  <p className={'rd-val-lg flex items-center gap-1.5 ' + TONE.text}><Icon name={bench.tone === 'high' ? 'trending-up' : 'badge-check'} className="w-5 h-5" /> {bench.rating}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>{bench.diffPct === 0 ? t('property.onParLocality') : t('property.diffLocalityShort', { pct: Math.abs(bench.diffPct), dir: bench.diffPct < 0 ? t('property.dirBelow') : t('property.dirAbove') })}</span>
                <span className={'font-semibold flex items-center gap-1 ' + TONE.text}><Icon name={TONE.arrow} className="w-3.5 h-3.5" /> {TONE.note}</span>
              </div>
              <div className="insight-bar"><span style={{ width: `${bench.pct}%` }} /></div>
              <div className="mt-6 pt-5 border-t border-white/5">
                <p className="text-xs text-slate-400 mb-3 flex items-center gap-1.5"><Icon name="trending-up" className="w-3.5 h-3.5 text-brand-teal-2" /> {t('property.priceTrend', { locality: p.locality })}</p>
                <div className="flex items-end gap-2.5 h-20">
                  {trendBars.map((h, i) => (
                    <div key={i} className="flex-1 h-full flex flex-col items-center justify-end gap-1">
                      <div className={'w-full bar3d ' + (i === 3 ? 'bar3d--teal bg-gradient-to-t from-brand-teal-2 to-brand-teal-3' : 'bar3d--muted bg-gradient-to-t from-brand-indigo-3/40 to-brand-teal-1/60')} style={{ height: `${h}%` }} />
                      <span className={'text-[10px] ' + (i === 3 ? 'text-brand-teal-3 font-semibold' : 'text-slate-500')}>&apos;{22 + i}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-emerald-400 mt-3 flex items-center gap-1.5"><Icon name="trending-up" className="w-3.5 h-3.5" /> {t('property.appreciation', { pct: yoy.toFixed(1) })}</p>
              </div>
            </>
          ) : (
            <div className="rd-cell">
              <p className="rd-lbl">{t('property.thisPropertyC')}</p>
              <p className="rd-val-lg">₹{fmtNum(perSqft)}<span className="text-sm font-medium text-slate-400">/sq.ft.</span></p>
              <p className="text-xs text-slate-400 mt-3 flex items-start gap-1.5"><Icon name="info" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-brand-teal-3" /> {t('property.noPriceBenchmark', { locality: p.locality })}</p>
            </div>
          )}
        </div>

        {/* Affordability / EMI */}
        <div className="glass-strong rounded-2xl p-6">
          <h3 className="font-semibold text-white mb-1 flex items-center gap-2"><Icon name="calculator" className="w-4 h-4 text-brand-teal-2" /> {t('property.affordability')}</h3>
          <p className="text-xs text-slate-400 mb-4">{t('property.estimateEmi')}</p>
          <div className="mb-4">
            <div className="flex justify-between items-center text-xs text-slate-400 mb-1.5"><span>{t('property.downPayment')}</span>
              <span className="flex items-center gap-1">
                <input type="number" min={10} max={50} value={dp} aria-label={t('property.downPaymentAria')}
                  onChange={(e) => setDp(e.target.value)}
                  onBlur={() => setDp((d) => Math.min(50, Math.max(10, Math.round(+d) || 10)))}
                  className="w-12 bg-white/10 border border-white/10 rounded px-1 py-0.5 text-right text-white font-semibold focus:outline-none focus:ring-1 focus:ring-teal-400" />
                <span className="text-white font-semibold">%</span>
              </span>
            </div>
            <input type="range" min="10" max="50" value={dp} onChange={(e) => setDp(+e.target.value)} className="w-full accent-teal-400" />
          </div>
          <div className="mb-5">
            <div className="flex justify-between items-center text-xs text-slate-400 mb-1.5"><span>{t('property.loanTenure')}</span>
              <span className="flex items-center gap-1">
                <input type="number" min={5} max={30} value={tenure} aria-label={t('property.loanTenureAria')}
                  onChange={(e) => setTenure(e.target.value)}
                  onBlur={() => setTenure((t2) => Math.min(30, Math.max(5, Math.round(+t2) || 5)))}
                  className="w-12 bg-white/10 border border-white/10 rounded px-1 py-0.5 text-right text-white font-semibold focus:outline-none focus:ring-1 focus:ring-teal-400" />
                <span className="text-white font-semibold">{t('property.yrs')}</span>
              </span>
            </div>
            <input type="range" min="5" max="30" value={tenure} onChange={(e) => setTenure(+e.target.value)} className="w-full accent-teal-400" />
          </div>
          <div className="space-y-2 text-sm border-t border-white/5 pt-4">
            <div className="flex justify-between"><span className="text-slate-400">{t('property.loanAmount')}</span><span className="text-white font-semibold">{fmtINR(loan)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">{t('property.monthlyEmi')}</span><span className="text-brand-teal-3 font-extrabold text-lg">₹{fmtNum(emi)}</span></div>
            <p className="text-[11px] text-slate-500 pt-1">{t('property.emiIndicative')}</p>
          </div>
          {flagEnabled('emiCalculator') && <Link to="/emi-calculator" className="mt-4 w-full block text-center py-2.5 rounded-xl border border-brand-teal-2/40 text-brand-teal-3 text-sm font-semibold hover:bg-brand-teal-1/10 transition-smooth">{t('property.fullEmiCalculator')}</Link>}
        </div>
      </div>

      {/* The real cost to buy — acquisition costs buyers routinely miss. */}
      <div className="glass rounded-2xl p-6 sm:p-8 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-brand-teal-1/20 flex items-center justify-center flex-shrink-0"><Icon name="receipt-indian-rupee" className="w-6 h-6 text-brand-teal-3" /></div>
            <div>
              <p className="font-bold text-white text-lg">{t('property.realCostToBuy')}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t('property.realCostSub')}</p>
            </div>
          </div>
          <span className="tag tag-teal flex items-center gap-1.5"><Icon name="wallet" className="w-3.5 h-3.5" /> {t('property.allInApprox', { amount: fmtINR(allIn) })}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {costTile('tag', t('property.basePrice'), fmtINR(p.price), 'price.base')}
          {costTile('scale', t('property.stampDuty'), fmtINR(stampDuty), 'price.stampDuty')}
          {costTile('landmark', t('property.registration'), fmtINR(registration), 'price.registration')}
          {gst > 0
            ? costTile('percent', t('property.gstPct', { pct: Math.round(gstRate * 100) }), fmtINR(gst), 'price.gst')
            : costTile('badge-check', t('property.gst'), isLand ? t('property.gstNotApplicable') : t('property.gstNoneReady', { kind: isCommercial ? t('property.readyProperty') : t('property.readyHome') }), 'price.gst')}
        </div>
        <div className="mt-3 rounded-xl border border-emerald-500/25 p-4 flex flex-wrap items-center justify-between gap-4" style={{ background: 'rgba(16,185,129,.07)' }}>
          <div>
            <p className="text-xs text-slate-400">{t('property.allInAcquisition')}</p>
            <p className="text-2xl font-extrabold text-white leading-tight">{fmtINR(allIn)}</p>
            <p className="text-[11px] text-emerald-300 flex items-center gap-1 mt-0.5"><Icon name="hand-coins" className="w-3 h-3" /> {t('property.zeroBrokeragePortals')}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">{t('property.overSticker')}</p>
            <p className="text-xl font-extrabold text-brand-teal-3">+{fmtINR(allIn - p.price)}</p>
            <p className="text-[11px] text-slate-500">{t('property.stampRegLine')}{gst > 0 ? t('property.gstSuffix') : ''}</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-3 flex items-start gap-1.5">
          <Icon name="info" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {t('property.disclaimerPre', { kind: isCommercial ? t('property.commercialUnits') : t('property.homesWord') })}{needsTds ? t('property.disclaimerTds') : ''}{t('property.disclaimerRates')}{isCommercial ? '' : t('property.disclaimerWomen')}{t('property.disclaimerPost')}
        </p>
      </div>
    </section>
  );
}

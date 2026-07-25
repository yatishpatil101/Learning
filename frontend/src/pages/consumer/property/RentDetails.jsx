import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import { fmtNum, isoToDisplay } from '../../../lib/format.js';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { propertyKind } from './derivations.js';
import { valueBenchmark } from './locationIntel.js';
import { fixturesFor, commercialProfileFromType } from '../list-property/constants.js';

/* Rent Details (RENT). The RENT twin of PriceInsights — same tile language as the
   Overview tab (detail-card / rd-cell / teal icon chips / glass panels / insight-bar),
   driven by the listing's real fields (deposit, maintenance mode, available-from,
   lock-in, notice, furnishing, preferred tenants, pets, food) with graceful fallbacks
   for legacy seed data. Grouped by the three jobs a renter has here:
   1. "What will it cost me?"  — monthly outgo + one-time move-in.
   2. "What are the terms?"     — available-from, lock-in, notice, furnishing.
   3. "Is it a fit / fair?"     — who it's for + rent-vs-locality benchmark. */

// Inventory tiers store i18n key-suffixes (translated at render via property.inventory.*).
const RENT_INVENTORY = {
  furnished: ['wardrobes', 'beds', 'sofa', 'fridge', 'washingMachine', 'ac', 'modularKitchen', 'geyser'],
  semi: ['wardrobes', 'modularKitchen', 'geyser', 'fansLights'],
  unfurnished: ['fansLights'],
};
// Commercial fit-out is spoken in shell terms, not household furniture — keyed by the same
// furnishing tier the owner sets, but with vocabulary true across office/shop/warehouse/co-working.
const COMMERCIAL_INVENTORY = {
  furnished: ['fittedInteriors', 'airConditioning', 'powerBackup', 'washrooms'],
  semi: ['warmShell', 'powerBackup', 'washrooms'],
  unfurnished: ['bareShell', 'washrooms'],
};

const toNum = (v) => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;

export function RentDetails({ p }) {
  const { t: tr } = useTranslation();
  const { flagEnabled } = useAppFlags();
  const isResidential = propertyKind(p) === 'residential';
  const isLand = propertyKind(p) === 'land';
  const isCommercial = propertyKind(p) === 'commercial';

  const monthsLabel = (m) => {
    const n = Number(m) || 0;
    return n <= 0 ? tr('property.monthsNone') : tr('property.months', { count: n });
  };

  const rent = toNum(p.price);
  // Deposit is a real field on posted rentals; legacy seed rows lack it, so fall back to
  // the common ~2 months' rent (kept as a fallback, never overwriting authored data).
  const deposit = toNum(p.deposit) || rent * 2;
  // Maintenance: only charge extra when the owner said so — an unknown mode is treated
  // as "included", never fabricated into an inflated all-in figure.
  const maintExtra = p.rentMaintMode === 'extra' ? toNum(p.rentMaintenance) : 0;
  const maintLabel = p.rentMaintMode === 'extra' ? (maintExtra ? '₹' + fmtNum(maintExtra) : tr('property.maintExtra')) : tr('property.maintIncluded');
  const allIn = rent + maintExtra;
  const moveIn = rent + deposit;
  const savings = rent; // ~1 month's rent is the brokerage a renter avoids here

  const available = p.available ? (isoToDisplay(p.available) || p.available) : tr('property.immediately');
  const furnishing = tr('property.rentFurnishing.' + (['furnished', 'semi', 'unfurnished'].includes(p.furnishing) ? p.furnishing : 'semi'));
  // Commercial fit-out: prefer the owner's real, sub-type-specific fixtures (filtered to the
  // profile's valid options so stale cross-profile picks never show), enriched with the shell /
  // power / pantry / washroom signals already captured at posting. Legacy seed rows with none
  // of these fall back to the generic furnishing-keyed list — nothing is ever fabricated.
  const commercialFitOut = () => {
    const opts = fixturesFor(commercialProfileFromType(p.commercialType || p.type));
    const declared = (Array.isArray(p.fixtures) ? p.fixtures : []).filter((f) => opts.includes(f));
    const signals = [];
    if (['bareShell', 'warmShell', 'furnished'].includes(p.shellType)) signals.push(tr('property.shell.' + p.shellType));
    const wr = parseInt(p.washrooms, 10) || 0;
    if (wr) signals.push(tr('property.washroom', { count: wr }));
    if (p.powerBackup) signals.push(tr('property.inventory.powerBackup'));
    if (p.pantry) signals.push(tr('property.pantry'));
    const tags = [...new Set([...declared, ...signals])];
    return tags.length ? tags : (COMMERCIAL_INVENTORY[p.furnishing] || COMMERCIAL_INVENTORY.semi).map((k) => tr('property.inventory.' + k));
  };
  const inventory = isCommercial ? commercialFitOut() : (RENT_INVENTORY[p.furnishing] || RENT_INVENTORY.semi).map((k) => tr('property.inventory.' + k));

  const tenantList = String(p.tenants || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((t) => { const key = t === 'any' ? 'anyone' : t; return ['family', 'bachelors', 'company', 'anyone'].includes(key) ? tr('property.tenant.' + key) : t; });
  const petsLabel = p.pets === true ? tr('property.petsAllowed') : p.pets === false ? tr('property.petsNotAllowed') : tr('property.askOwner');
  const foodLabel = p.food === 'veg' ? tr('property.foodVeg') : p.food === 'any' ? tr('property.foodBoth') : tr('property.askOwner');
  const depMonths = rent ? Math.round(deposit / rent) : 0;
  const depMonthsLabel = depMonths ? tr('property.depMonths', { count: depMonths }) : '—';

  // Fair-rent benchmark — this listing's rent/sq.ft vs the CURATED locality
  // rent average (only for residential listings in a known locality; we never
  // fabricate an average for commercial/land or an unknown area).
  const bench = valueBenchmark(p);
  const perSqft = bench.perSqft;
  const RENT_TONE = {
    good: 'text-emerald-400',
    fair: 'text-brand-teal-3',
    high: 'text-amber-400',
  }[bench.tone] || 'text-brand-teal-3';

  const tile = (icon, label, value, tipKey) => {
    const el = (
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
    return tipKey ? <Tip k={tipKey}>{el}</Tip> : el;
  };

  return (
    <section className="fade-in section-mb">
      <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 flex items-center gap-2"><Icon name="indian-rupee" className="w-5 h-5 text-brand-teal-2" /> {tr('property.rentDetailsHeading')}</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* What it costs + terms */}
        <div className="glass rounded-2xl p-6 lg:col-span-2">
          <div className="flex items-center gap-2 mb-1"><Icon name="wallet" className="w-4 h-4 text-brand-teal-2" /><h3 className="font-semibold text-white">{tr('property.whatYoullPay')}</h3></div>
          <p className="rd-sub">{tr('property.whatYoullPaySub')}</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {tile('indian-rupee', tr('property.monthlyRent'), '₹' + fmtNum(rent))}
            {tile('receipt-indian-rupee', tr('property.maintenance'), maintLabel, 'rent.maintenance')}
            {tile('landmark', tr('property.deposit'), '₹' + fmtNum(deposit), 'rent.deposit')}
          </div>

          {/* All-in highlight — mirrors the SALE "real cost" box. */}
          <div className="mt-3 rounded-xl border border-emerald-500/25 p-4 flex flex-wrap items-center justify-between gap-4" style={{ background: 'rgba(16,185,129,.07)' }}>
            <div>
              <p className="text-xs text-slate-400">{tr('property.allInMonthly')}</p>
              <p className="text-2xl font-extrabold text-white leading-tight">₹{fmtNum(allIn)}</p>
              <p className="text-[11px] text-emerald-300 flex items-center gap-1 mt-0.5"><Icon name="hand-coins" className="w-3 h-3" /> {maintExtra ? tr('property.inclMaintenance') : ''}{tr('property.brokerageSave', { amount: fmtNum(savings) })}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">{tr('property.oneTimeMoveIn')}</p>
              <p className="text-xl font-extrabold text-brand-teal-3">₹{fmtNum(moveIn)}</p>
              <p className="text-[11px] text-slate-500">{tr('property.firstMonthDeposit')}</p>
            </div>
          </div>

          {/* Tenancy terms */}
          <div className="mt-6 pt-5 border-t border-white/5">
            <p className="text-xs text-slate-400 mb-2.5 flex items-center gap-1.5"><Icon name="file-signature" className="w-4 h-4 text-brand-teal-3" /> {tr('property.tenancyTerms')}</p>
            <div className={`grid grid-cols-2 ${isLand ? 'sm:grid-cols-3' : 'sm:grid-cols-4'} gap-2.5`}>
              {tile('calendar-check', tr('property.available'), available)}
              {tile('lock', tr('property.lockIn'), monthsLabel(p.lockin), 'rent.lockin')}
              {tile('clock', tr('property.notice'), monthsLabel(p.notice ?? 1), 'rent.notice')}
              {!isLand ? tile('sofa', tr('property.furnishingLabel'), furnishing) : null}
            </div>
          </div>

          {/* What's included — furniture/appliances only make sense for built space, not bare land.
              Commercial speaks in fit-out/shell terms, not household furniture. */}
          {!isLand ? (
          <div className="mt-5 pt-5 border-t border-white/5">
            <p className="text-xs text-slate-400 mb-2.5 flex items-center gap-1.5"><Icon name={isCommercial ? 'building-2' : 'sofa'} className="w-4 h-4 text-brand-teal-3" /> {isCommercial ? tr('property.fitOutFixtures') : tr('property.whatsIncluded')}</p>
            <div className="flex flex-wrap gap-2">{inventory.map((it) => <span key={it} className="tag tag-teal">{it}</span>)}</div>
          </div>
          ) : null}

          {/* Is the rent fair? — only when we have a verified locality rent benchmark. */}
          {bench.hasData ? (
            <div className="mt-5 pt-5 border-t border-white/5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
                <div className="rd-cell">
                  <p className="rd-lbl">{tr('property.thisProperty')}</p>
                  <p className="rd-val-lg">₹{fmtNum(perSqft)}<span className="text-sm font-medium text-slate-400">/sq.ft.</span></p>
                </div>
                <div className="rd-cell">
                  <p className="rd-lbl">{tr('property.localityAverage', { locality: p.locality })}</p>
                  <p className="rd-val-lg text-slate-300">₹{fmtNum(bench.localityAvg)}<span className="text-sm font-medium text-slate-400">/sq.ft.</span></p>
                </div>
                <div className="rd-cell">
                  <p className="rd-lbl">{tr('property.rentRating')}</p>
                  <p className={'rd-val-lg flex items-center gap-1.5 ' + RENT_TONE}><Icon name={bench.tone === 'high' ? 'trending-up' : 'badge-check'} className="w-5 h-5" /> {bench.rating}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-slate-400">{bench.diffPct === 0 ? tr('property.onParLocality') : tr('property.diffLocality', { pct: Math.abs(bench.diffPct), dir: bench.diffPct < 0 ? tr('property.dirBelow') : tr('property.dirAbove') })}</span>
                <span className={'font-semibold ' + RENT_TONE}>{bench.rating}</span>
              </div>
              <div className="insight-bar"><span style={{ width: `${bench.pct}%` }} /></div>
            </div>
          ) : perSqft ? (
            <div className="mt-5 pt-5 border-t border-white/5">
              <div className="rd-cell">
                <p className="rd-lbl">{tr('property.thisProperty')}</p>
                <p className="rd-val-lg">₹{fmtNum(perSqft)}<span className="text-sm font-medium text-slate-400">/sq.ft.</span></p>
                <p className="text-xs text-slate-400 mt-3 flex items-start gap-1.5"><Icon name="info" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-brand-teal-3" /> {tr('property.noRentBenchmark', { locality: p.locality })}</p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Who it's for */}
        <div className="glass-strong rounded-2xl p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-1"><Icon name="users" className="w-4 h-4 text-brand-teal-2" /><h3 className="font-semibold text-white">{tr('property.whoItsFor')}</h3></div>
          <p className="rd-sub">{tr('property.whoItsForSub')}</p>

          {isResidential ? (
            <>
              <Tip k="rent.tenants"><p className="rd-lbl mb-2">{tr('property.preferredTenants')}</p></Tip>
              <div className="flex flex-wrap gap-2 mb-4">
                {tenantList.length ? tenantList.map((t) => <span key={t} className="tag tag-teal">{t}</span>) : <span className="tag tag-teal">{tr('property.tenant.anyone')}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2.5 mb-4">
                {tile('paw-print', tr('property.pets'), petsLabel)}
                {tile('utensils', tr('property.food'), foodLabel)}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 mb-4">
              {tile('users', tr('property.suitableFor'), tenantList.length ? tenantList.join(', ') : tr('property.anyBusiness'))}
            </div>
          )}

          <div className="rounded-xl border border-emerald-500/20 px-3.5 py-3 mb-4 flex items-center gap-2" style={{ background: 'rgba(16,185,129,.06)' }}>
            <Icon name="hand-coins" className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <p className="text-xs text-slate-300">{tr('property.zeroBrokerageOwner')}</p>
          </div>

          {/* Move-in snapshot — the numbers a renter actually decides on, in one glance.
              Also gives this column real substance for commercial/land (which have few tenant fields). */}
          <div className="rounded-xl border border-white/10 p-4 mb-4">
            <p className="rd-lbl mb-3 flex items-center gap-1.5"><Icon name="wallet" className="w-4 h-4 text-brand-teal-3" /> {tr('property.moveInSnapshot')}</p>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">{tr('property.oneTimeMoveIn')}</dt>
                <dd className="font-semibold text-brand-teal-3">₹{fmtNum(moveIn)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">{tr('property.deposit')}</dt>
                <dd className="font-semibold text-white">{depMonthsLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">{tr('property.allInMonthly')}</dt>
                <dd className="font-semibold text-white">₹{fmtNum(allIn)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-400">{tr('property.available')}</dt>
                <dd className="font-semibold text-white">{available}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-auto space-y-2">
            <Link to="/services/rent-agreement" className="w-full block text-center py-2.5 rounded-xl border border-brand-teal-2/40 text-brand-teal-3 text-sm font-semibold hover:bg-brand-teal-1/10 transition-smooth">{tr('property.getRentAgreement')}</Link>
            {flagEnabled('onlineRentPayment') && <Link to="/pay-rent" className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm font-medium hover:bg-white/5 transition-smooth"><Icon name="wallet" className="w-4 h-4" /> {tr('property.payRentSplit')}</Link>}
          </div>
        </div>
      </div>
    </section>
  );
}
